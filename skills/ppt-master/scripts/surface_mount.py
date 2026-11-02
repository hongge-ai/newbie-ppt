#!/usr/bin/env python3
"""
PPT Master - Per-Project Surface Mount

The workbench is the one local service. Its own pages cover tasks and runs;
this module puts the three project surfaces — confirmation, live preview, and
spec review — behind the same port:

    /p/<slug>/confirm/...    Stage 1 / Stage 2 confirmation for one project
    /p/<slug>/preview/...    live page preview and annotation for one project
    /p/<slug>/spec/...       design-spec block review for one project

Each surface is an ordinary Flask app built by its own module's ``create_app``.
Mounting rather than rewriting keeps their contracts intact: the app still sees
``/api/...`` and its own static files. Two adjustments make the browser agree:

* every served HTML page gets its ``/static/`` references rewritten to relative
  ones, so assets resolve under the mount prefix;
* one same-origin helper script prefixes ``fetch`` and ``XMLHttpRequest`` calls
  that start with ``/``, so the surfaces' absolute API paths land on their own
  app instead of the workbench root.

Surfaces are created lazily per project and never own a port, a lock file, or a
lifecycle thread; the resident workbench owns all three.

Usage:
    from surface_mount import mount_surfaces
    mount_surfaces(app, projects_root)

Dependencies:
    flask (already required by the workbench)
"""

from __future__ import annotations

import importlib
import re
import threading
from pathlib import Path
from typing import Optional

from werkzeug.routing import Map, Rule
from werkzeug.wrappers import Request, Response


# Mount path -> the package that builds that surface's app.
SURFACES = {
    "confirm": "confirm_ui.server",
    "preview": "svg_editor.server",
    "spec": "spec_review.server",
}

MOUNT_RULE = "/p/<slug>/<kind>/<path:rest>"
BASE_NAME = "/p"
HELPER_PATH = "/static/surface_base.js"
MOUNT_STYLE_PATH = "/static/surface_mount.css"
ICON_PATH = "/static/favicon.svg"

_HEAD_RE = re.compile(r"<head[^>]*>", re.IGNORECASE)
_STATIC_ATTR_RE = re.compile(r"""=(['"])/static/""")



def _validate_slug(slug: str) -> bool:
    return bool(slug) and slug not in (".", "..") and "/" not in slug and "\\" not in slug


class SurfaceMount:
    """Resolve ``/p/<slug>/<kind>/...`` to one cached per-project app."""

    def __init__(self, projects_root: Path) -> None:
        self.projects_root = Path(projects_root).resolve()
        self._apps: dict[tuple[str, str], object] = {}
        self._guard = threading.Lock()
        self.map = Map([
            Rule("/p/<slug>/<kind>/", endpoint="surface", defaults={"rest": ""}),
            Rule("/p/<slug>/<kind>", endpoint="surface", defaults={"rest": ""}),
            Rule(MOUNT_RULE, endpoint="surface"),
            # Page SVGs reference their images as `../images/x.png`; from
            # /p/<slug>/preview/ that resolves to /p/<slug>/images/x.png.
            Rule("/p/<slug>/images/<path:rest>", endpoint="surface_images",
                 defaults={"kind": "preview"}),
        ])

    def resolve(self, path: str) -> Optional[tuple[str, str, str]]:
        """Return (slug, kind, rest) for a mount path, or None."""
        adapter = self.map.bind("")
        try:
            endpoint, values = adapter.match(path)
        except Exception:  # noqa: BLE001 - any mismatch simply is not a mount
            return None
        if endpoint not in ("surface", "surface_images") or values["kind"] not in SURFACES:
            return None
        slug = values["slug"]
        if not _validate_slug(slug):
            return None
        if endpoint == "surface_images":
            return slug, values["kind"], "images/" + values["rest"]
        return slug, values["kind"], values["rest"]

    def app_for(self, slug: str, kind: str):
        """Return the cached surface app for one project, building it once."""
        key = (slug, kind)
        with self._guard:
            app = self._apps.get(key)
            if app is not None:
                return app
            project = (self.projects_root / slug).resolve()
            try:
                project.relative_to(self.projects_root)
            except ValueError:
                raise KeyError(slug) from None
            if not project.is_dir():
                raise KeyError(slug)
            module = importlib.import_module(SURFACES[kind])
            app = module.create_app(str(project), idle_timeout=0, embedded=True)
            app.config["SURFACE_MOUNT"] = f"{BASE_NAME}/{slug}/{kind}"
            _rewrite_html(app)
            self._apps[key] = app
            return app

    def __call__(self, environ, start_response):
        resolved = self.resolve(environ.get("PATH_INFO", ""))
        if resolved is None:
            return Response("not mounted", status=404)(environ, start_response)
        slug, kind, rest = resolved
        try:
            app = self.app_for(slug, kind)
        except KeyError:
            return Response("unknown project", status=404)(environ, start_response)
        environ = dict(environ)
        environ["PATH_INFO"] = "/" + rest
        environ["SCRIPT_NAME"] = environ.get("SCRIPT_NAME", "") + f"{BASE_NAME}/{slug}/{kind}"
        return app(environ, start_response)


def _rewrite_html(app) -> None:
    """Make one mounted app's HTML usable under its prefix."""

    @app.after_request
    def _surface_prefix(response):
        if response.mimetype != "text/html":
            return response
        response.direct_passthrough = False
        html = response.get_data(as_text=True)
        html = _STATIC_ATTR_RE.sub(r"""=\1static/""", html)
        html = _HEAD_RE.sub(
            lambda match: (
                match.group(0)
                + f'\n    <script src="{HELPER_PATH}"></script>'
                + f'\n    <link rel="stylesheet" href="{MOUNT_STYLE_PATH}">'
                + f'\n    <link rel="icon" href="{ICON_PATH}" type="image/svg+xml">' 
            ),
            html,
            count=1,
        )
        response.set_data(html)
        return response


def mount_surfaces(app, projects_root: Path):
    """Wrap one Flask app's WSGI entry so surface paths go to their own apps."""
    mount = SurfaceMount(Path(projects_root))
    inner = app.wsgi_app

    def outer(environ, start_response):
        if mount.resolve(environ.get("PATH_INFO", "")) is not None:
            return mount(environ, start_response)
        return inner(environ, start_response)

    app.wsgi_app = outer
    app.extensions["surface_mount"] = mount
    return mount
