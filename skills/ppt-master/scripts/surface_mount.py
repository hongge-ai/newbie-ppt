#!/usr/bin/env python3
"""
PPT Master - Per-Project Surface Mount

The workbench is the one local service and owns all browser UI rendering.
This module mounts the backend APIs (and project image assets) for the
confirmation and preview surfaces under the same port:

    /p/<slug>/confirm/api/...      Stage 1 / Stage 2 confirmation JSON API
    /p/<slug>/confirm/ai-image-... AI rendering comparison reference images
    /p/<slug>/preview/api/...      live page preview & annotation JSON API
    /p/<slug>/images/...           project image assets

Direct browser visits to the legacy page roots ``/p/<slug>/confirm/`` or
``/p/<slug>/preview/`` redirect (302) to the native Workbench SPA route
(``/#/task/<task_id>/<kind>`` when bound to a task, else
``/#/project/<slug>/<kind>``). The legacy ``spec_review`` web UI is retired.

Dependencies:
    flask (already required by the workbench)
"""

from __future__ import annotations

import importlib
import threading
import urllib.parse
from pathlib import Path
from typing import Callable, Optional

from werkzeug.routing import Map, Rule
from werkzeug.wrappers import Response


# Mount path -> the package that builds that surface's Flask API app.
SURFACES = {
    "confirm": "confirm_ui.server",
    "preview": "svg_editor.server",
}

MOUNT_RULE = "/p/<slug>/<kind>/<path:rest>"
BASE_NAME = "/p"


def _validate_slug(slug: str) -> bool:
    return bool(slug) and slug not in (".", "..") and "/" not in slug and "\\" not in slug


class SurfaceMount:
    """Resolve ``/p/<slug>/<kind>/...`` to per-project API apps or SPA redirects."""

    def __init__(
        self,
        projects_root: Path,
        task_id_resolver: Optional[Callable[[str], Optional[str]]] = None,
    ) -> None:
        self.projects_root = Path(projects_root).resolve()
        self.task_id_resolver = task_id_resolver
        self._apps: dict[tuple[str, str], object] = {}
        self._guard = threading.Lock()
        self.map = Map([
            Rule("/p/<slug>/<kind>/", endpoint="surface", defaults={"rest": ""}),
            Rule("/p/<slug>/<kind>", endpoint="surface", defaults={"rest": ""}),
            Rule(MOUNT_RULE, endpoint="surface"),
            # Page SVGs reference their images as `../images/x.png`; from
            # /p/<slug>/preview/ that resolves to /p/<slug>/images/x.png.
            Rule(
                "/p/<slug>/images/<path:rest>",
                endpoint="surface_images",
                defaults={"kind": "preview"},
            ),
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

    def _project_dir(self, slug: str) -> Path:
        project = (self.projects_root / slug).resolve()
        try:
            project.relative_to(self.projects_root)
        except ValueError:
            raise KeyError(slug) from None
        if not project.is_dir():
            raise KeyError(slug)
        return project

    def app_for(self, slug: str, kind: str):
        """Return the cached surface app for one project, building it once."""
        key = (slug, kind)
        with self._guard:
            app = self._apps.get(key)
            if app is not None:
                return app
            project = self._project_dir(slug)
            module = importlib.import_module(SURFACES[kind])
            app = module.create_app(str(project), idle_timeout=0, embedded=True)
            app.config["SURFACE_MOUNT"] = f"{BASE_NAME}/{slug}/{kind}"
            self._apps[key] = app
            return app

    def _redirect_location(self, slug: str, kind: str, query_string: str) -> str:
        task_id = self.task_id_resolver(slug) if self.task_id_resolver else None
        if task_id:
            target = f"/#/task/{urllib.parse.quote(task_id)}/{kind}"
        else:
            target = f"/#/project/{urllib.parse.quote(slug)}/{kind}"
        if query_string:
            params = urllib.parse.parse_qs(query_string)
            slide = (params.get("slide") or [None])[0]
            if slide:
                target += f"?slide={urllib.parse.quote(slide)}"
        return target

    def __call__(self, environ, start_response):
        resolved = self.resolve(environ.get("PATH_INFO", ""))
        if resolved is None:
            return Response("not mounted", status=404)(environ, start_response)
        slug, kind, rest = resolved
        try:
            if not rest:
                self._project_dir(slug)
                location = self._redirect_location(
                    slug, kind, environ.get("QUERY_STRING", ""),
                )
                return Response(
                    "",
                    status=302,
                    headers={"Location": location, "Cache-Control": "no-store"},
                )(environ, start_response)
            app = self.app_for(slug, kind)
        except KeyError:
            return Response("unknown project", status=404)(environ, start_response)
        environ = dict(environ)
        environ["PATH_INFO"] = "/" + rest
        environ["SCRIPT_NAME"] = environ.get("SCRIPT_NAME", "") + f"{BASE_NAME}/{slug}/{kind}"
        return app(environ, start_response)


def mount_surfaces(
    app,
    projects_root: Path,
    *,
    task_id_resolver: Optional[Callable[[str], Optional[str]]] = None,
):
    """Wrap one Flask app's WSGI entry so surface paths go to their own apps."""
    mount = SurfaceMount(Path(projects_root), task_id_resolver=task_id_resolver)
    inner = app.wsgi_app

    def outer(environ, start_response):
        if mount.resolve(environ.get("PATH_INFO", "")) is not None:
            return mount(environ, start_response)
        return inner(environ, start_response)

    app.wsgi_app = outer
    app.extensions["surface_mount"] = mount
    return mount
