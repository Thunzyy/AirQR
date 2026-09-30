from __future__ import annotations

from http import HTTPStatus
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import unquote, urlparse

from .constants import SECURITY_HEADERS

if TYPE_CHECKING:
    from .handler import SyncRequestHandler


def _request_path(handler: "SyncRequestHandler") -> str:
    return urlparse(getattr(handler, "path", "/")).path


def _is_api_path(path: str) -> bool:
    return path.startswith("/api/")


def _is_auth_enabled(handler: "SyncRequestHandler") -> bool:
    auth = getattr(handler.context, "auth", None)
    return bool(getattr(auth, "enabled", False))


def apply_surface_headers(handler: "SyncRequestHandler") -> None:
    headers = getattr(handler, "headers", None)
    origin = headers.get("Origin") if headers is not None else None
    allowed_origins = getattr(handler.context, "allowed_origins", [])
    path = _request_path(handler)
    cors_matched = False
    allow_credentials = False
    vary_origin = False

    if "*" in allowed_origins:
        handler.send_header("Access-Control-Allow-Origin", "*")
        cors_matched = True
    elif origin and origin in allowed_origins:
        handler.send_header("Access-Control-Allow-Origin", origin)
        cors_matched = True
        allow_credentials = True
        vary_origin = True
    elif origin and _is_api_path(path) and _is_auth_enabled(handler):
        handler.send_header("Access-Control-Allow-Origin", origin)
        cors_matched = True
        vary_origin = True

    if cors_matched:
        if allow_credentials:
            handler.send_header("Access-Control-Allow-Credentials", "true")
        if vary_origin:
            handler.send_header("Vary", "Origin")
        handler.send_header(
            "Access-Control-Allow-Headers",
            "Authorization, Content-Type, X-API-Key, X-AirQR-CSRF",
        )
        handler.send_header(
            "Access-Control-Allow-Methods",
            "GET, POST, DELETE, OPTIONS",
        )

    if _is_api_path(path):
        handler.send_header("Cross-Origin-Resource-Policy", "cross-origin")
    else:
        for header, value in SECURITY_HEADERS.items():
            handler.send_header(header, value)


def handle_options(handler: "SyncRequestHandler") -> None:
    handler.send_response(HTTPStatus.NO_CONTENT)
    handler.end_headers()


def should_serve_spa_fallback(handler: "SyncRequestHandler", path: str) -> bool:
    if not handler.context.static_dir:
        return False
    if not path or path == "/" or path.startswith("/api/"):
        return False

    accept = (handler.headers.get("Accept") or "").lower()
    if "text/html" not in accept and "*/*" not in accept:
        return False

    clean_path = unquote(path.split("?", 1)[0].split("#", 1)[0])
    requested = Path(clean_path)
    if requested.suffix:
        return False

    resolved = Path(handler.translate_path(path))
    return not resolved.exists()
