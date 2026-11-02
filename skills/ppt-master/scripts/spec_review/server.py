#!/usr/bin/env python3
"""
PPT Master - Spec Review Server

Serve a local Markdown review surface with staged edits and sidecar comments.
See scripts/docs/spec_review.md for commands, APIs, and runtime files.

Usage:
    python3 scripts/spec_review/server.py <project_path> [--daemon]

Examples:
    python3 scripts/spec_review/server.py projects/example --daemon --no-browser
    python3 scripts/spec_review/server.py projects/example --hold on

Dependencies:
    Flask (already used by svg_editor and confirm_ui)
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import signal
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

_SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

from console_encoding import configure_utf8_stdio  # noqa: E402

configure_utf8_stdio()

from flask import Flask, jsonify, request, send_from_directory  # noqa: E402
from werkzeug.exceptions import HTTPException  # noqa: E402
from werkzeug.serving import make_server  # noqa: E402

from server_common import (  # noqa: E402
    claim_lock,
    clear_lock,
    find_free_port,
    lock_pid,
    open_preview_browser,
    plain_request_log,
    popen_detached,
    process_alive,
    read_lock,
    release_lock,
    validate_port,
)
from spec_review.store import ReviewError, ReviewStore, file_mutex  # noqa: E402


PUBLIC_HOST = "127.0.0.1"
DEFAULT_PORT = 6060
logger = logging.getLogger("spec_review")


class _QuietPolls(logging.Filter):
    """Drop successful state polls so real requests stay findable in server.log."""

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        return not ('"GET /api/state ' in message and '" 200 ' in message)


def create_app(project_dir: str, idle_timeout: int = 7200, embedded: bool = False) -> Flask:
    """Create the testable HTTP surface; lifecycle belongs to the workbench."""
    store = ReviewStore(Path(project_dir))
    store.document()
    app = Flask(__name__, static_folder="static", static_url_path="/static")
    app.config.update(MAX_CONTENT_LENGTH=4 * 1024 * 1024, LAST_ACTIVITY=time.monotonic(), IDLE_TIMEOUT=idle_timeout)
    app.extensions["review_store"] = store
    app.extensions["stop_event"] = threading.Event()

    @app.before_request
    def protect_local_service():
        try:
            host = urllib.parse.urlsplit("//" + request.host)
            if host.hostname not in {PUBLIC_HOST, "localhost", "::1"} or host.username or host.password:
                raise ValueError("Host")
            host_port = host.port or 80
            origin = request.headers.get("Origin")
            if origin is not None:
                parsed = urllib.parse.urlsplit(origin)
                if (parsed.scheme != request.scheme or parsed.hostname != host.hostname
                        or (parsed.port or 80) != host_port or parsed.username or parsed.password
                        or parsed.path or parsed.query or parsed.fragment):
                    raise ValueError("Origin")
        except ValueError:
            return jsonify(error="Forbidden Host or Origin header"), 403
        if request.path not in {"/api/state", "/api/health"}:
            app.config["LAST_ACTIVITY"] = time.monotonic()

    @app.after_request
    def secure_response(response):
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        # Mounted inside the workbench the page is framed by that same origin,
        # so it must allow exactly that ancestor; standalone stays unframeable.
        ancestors = "'self'" if embedded else "'none'"
        response.headers["Content-Security-Policy"] = (
            "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; "
            f"img-src 'none'; base-uri 'none'; frame-ancestors {ancestors}; form-action 'none'"
        )
        return response

    @app.errorhandler(ReviewError)
    def review_error(error):
        return jsonify(error=str(error)), error.status

    @app.errorhandler(OSError)
    @app.errorhandler(ValueError)
    def storage_error(error):
        logger.error("spec review storage: %s", error)
        return jsonify(error=str(error)), 500

    @app.errorhandler(HTTPException)
    def http_error(error):
        return jsonify(error=error.description), error.code

    def payload(*strings: str) -> dict:
        data = request.get_json(silent=True)
        if not isinstance(data, dict) or any(not isinstance(data.get(key), str) for key in strings):
            raise ReviewError("Send a JSON object with string fields: " + ", ".join(strings))
        return data

    @app.get("/")
    def index():
        return send_from_directory(app.static_folder, "index.html")

    @app.get("/api/health")
    def health():
        return jsonify(status="ok", service="spec_review", pid=os.getpid(), project=str(store.project))

    @app.get("/api/state")
    def state():
        return jsonify(store.state())

    @app.get("/api/blocks")
    def blocks():
        return jsonify(store.snapshot())

    @app.get("/api/spec")
    def spec():
        return jsonify(store.document())

    @app.get("/api/blocks/<path:key>")
    def block(key):
        return jsonify(store.block(key))

    @app.put("/api/drafts/<path:key>")
    def stage(key):
        data = payload("text", "sha256")
        return jsonify(store.stage(key, data["text"], data["sha256"], data.get("version")))

    @app.delete("/api/drafts/<path:key>")
    def discard(key):
        data = payload("version")
        store.discard(key, data["version"])
        return jsonify(status="ok")

    @app.post("/api/apply/<path:key>")
    def apply(key):
        data = payload("sha256", "version")
        return jsonify(store.apply(key, data["sha256"], data["version"]))

    @app.route("/api/annotations", methods=["GET", "POST"])
    def annotations():
        if request.method == "GET":
            return jsonify(annotations=store.annotations())
        data = payload("key", "body")
        return jsonify(store.save_annotation(data["key"], data["body"])), 201

    @app.route("/api/annotations/<item_id>", methods=["PUT", "DELETE"])
    def annotation(item_id):
        data = payload("revision", *( ["body"] if request.method == "PUT" else []))
        if request.method == "DELETE":
            store.remove_annotation(item_id, data["revision"])
            return jsonify(status="ok")
        return jsonify(store.save_annotation("", data["body"], item_id, data["revision"]))

    @app.post("/api/hold")
    def hold():
        data = payload()
        if not isinstance(data.get("hold"), bool):
            raise ReviewError("hold must be true or false")
        return jsonify(store.set_hold(data["hold"]))

    @app.post("/api/shutdown")
    def shutdown():
        if embedded:
            # Mounted inside the resident workbench: closing the view must not
            # end the shared process.
            return jsonify(status="embedded")
        store.set_hold(True)
        app.extensions["stop_event"].set()
        return jsonify(status="ok")

    return app


def _call(port: int, path: str, data: dict | None = None) -> dict:
    url = f"http://{PUBLIC_HOST}:{validate_port(port)}{path}"
    request_data = None if data is None else json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=request_data, headers={"Content-Type": "application/json"})
    with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(req, timeout=2) as response:
        return json.load(response)


def _running(project: Path) -> dict | None:
    lock = read_lock(project / "spec_review" / "lock.json")
    if not lock or not process_alive(lock_pid(lock)):
        return None
    health = _call(lock.get("port"), "/api/health")
    if health.get("service") != "spec_review" or health.get("project") != str(project) or (
        health.get("pid") != lock_pid(lock)
    ):
        raise ValueError("The lock does not identify this project's spec review service.")
    return lock


