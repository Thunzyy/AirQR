from __future__ import annotations

from http import HTTPStatus
from typing import TYPE_CHECKING
from urllib.parse import parse_qs, urlparse

from .utils import safe_history_id, safe_session_id

if TYPE_CHECKING:
    from .handler import SyncRequestHandler


def dispatch_post(handler: "SyncRequestHandler", path: str) -> bool:
    if path.startswith("/api/debug/scan-sessions/") and path.endswith("/snapshots"):
        parts = path.strip("/").split("/")
        if len(parts) == 5:
            session_id = safe_session_id(parts[3])
            if session_id:
                handler._handle_debug_scan_snapshot(session_id)
                return True
        handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid sessionId"})
        return True
    if path == "/api/auth/login":
        handler._handle_auth_login()
        return True
    if path == "/api/auth/logout":
        handler._handle_auth_logout()
        return True
    if path == "/api/auth/credentials":
        handler._handle_auth_credentials_post()
        return True
    if path == "/api/scan/packet":
        handler._handle_packet()
        return True
    if path == "/api/scan/complete":
        handler._handle_complete()
        return True
    if path == "/api/history/item":
        handler._handle_history_item()
        return True
    if path == "/api/config/export":
        handler._handle_export_config_post()
        return True
    if path == "/api/config/settings":
        handler._handle_settings_post()
        return True
    return False


def dispatch_get(handler: "SyncRequestHandler", path: str) -> bool:
    if path.startswith("/api/debug/scan-sessions/") and path.endswith("/live"):
        parts = path.strip("/").split("/")
        if len(parts) == 5:
            session_id = safe_session_id(parts[3])
            if session_id:
                handler._handle_debug_scan_live(session_id)
                return True
        handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid sessionId"})
        return True
    if path == "/health":
        handler._handle_health()
        return True
    if path == "/version":
        handler._handle_version()
        return True
    if path == "/ready":
        handler._handle_ready()
        return True
    if path == "/api/scan/history":
        handler._handle_scan_history()
        return True
    if path == "/api/history":
        handler._handle_history_all()
        return True
    if path == "/api/events":
        parsed = urlparse(handler.path)
        params = parse_qs(parsed.query)
        if not handler._require_sse_auth(params):
            return True
        handler._handle_sse_events()
        return True
    if path == "/api/config/export":
        handler._handle_export_config_get()
        return True
    if path == "/api/auth/status":
        handler._handle_auth_status()
        return True
    if path == "/api/config/settings":
        handler._handle_settings_get()
        return True
    if path.startswith("/api/scan/session/") and path.endswith("/file"):
        parts = path.strip("/").split("/")
        if len(parts) == 5:
            session_id = safe_session_id(parts[3])
            if session_id:
                handler._handle_file_download(session_id)
                return True
        handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid sessionId"})
        return True
    if path.startswith("/api/scan/session/") and path.endswith("/packets"):
        parts = path.strip("/").split("/")
        if len(parts) == 5:
            session_id = safe_session_id(parts[3])
            if session_id:
                handler._handle_packets(session_id)
                return True
        handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid sessionId"})
        return True
    if path.startswith("/api/scan/session/"):
        parts = path.strip("/").split("/")
        if len(parts) == 4:
            session_id = safe_session_id(parts[3])
            if session_id:
                handler._handle_session_info(session_id)
                return True
        handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid sessionId"})
        return True
    if path.startswith("/api/history/item/") and path.endswith("/file"):
        parts = path.strip("/").split("/")
        if len(parts) == 5:
            history_id = safe_history_id(parts[3])
            if history_id:
                handler._handle_history_item_download(history_id)
                return True
        handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid historyId"})
        return True
    return False


def dispatch_delete(handler: "SyncRequestHandler", path: str) -> bool:
    if path.startswith("/api/scan/session/"):
        parts = path.strip("/").split("/")
        if len(parts) == 4:
            session_id = safe_session_id(parts[3])
            if session_id:
                handler._handle_delete_session(session_id)
                return True
        handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid sessionId"})
        return True
    if path.startswith("/api/history/item/"):
        parts = path.strip("/").split("/")
        if len(parts) == 4:
            history_id = safe_history_id(parts[3])
            if history_id:
                handler._handle_delete_history_item(history_id)
                return True
        handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid historyId"})
        return True
    return False
