from __future__ import annotations

from http import HTTPStatus
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .handler import SyncRequestHandler


SENSITIVE_KEYS = {
    "apiKey",
    "authorization",
    "cookie",
    "headers",
    "password",
    "packet",
    "packetBase64",
    "packets",
    "secret",
    "token",
}
SENSITIVE_KEYS_NORMALIZED = {key.lower() for key in SENSITIVE_KEYS}

TOP_LEVEL_ALLOWED_KEYS = {
    "at",
    "authSnapshot",
    "history",
    "online",
    "scanner",
    "server",
    "sessionId",
    "transport",
    "visibilityState",
}


def _sanitize_value(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            str(key): _sanitize_value(nested)
            for key, nested in value.items()
            if str(key).lower() not in SENSITIVE_KEYS_NORMALIZED
        }
    if isinstance(value, list):
        return [_sanitize_value(item) for item in value[:120]]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def sanitize_debug_snapshot(session_id: str, raw_snapshot: Any) -> dict[str, Any]:
    if not isinstance(raw_snapshot, dict):
        return {"sessionId": session_id}

    sanitized = {
        key: _sanitize_value(raw_snapshot[key])
        for key in TOP_LEVEL_ALLOWED_KEYS
        if key in raw_snapshot
    }
    sanitized["sessionId"] = session_id
    return sanitized


def handle_debug_scan_snapshot(
    handler: "SyncRequestHandler",
    session_id: str,
) -> None:
    if not handler._require_auth():
        return

    raw_snapshot = handler._read_json()
    if raw_snapshot is None:
        handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON"})
        return

    snapshot = sanitize_debug_snapshot(session_id, raw_snapshot)
    handler.context.debug_scan_store.add_snapshot(session_id, snapshot)
    handler._send_json(HTTPStatus.OK, {"ok": True})


def handle_debug_scan_live(
    handler: "SyncRequestHandler",
    session_id: str,
) -> None:
    if not handler._require_auth():
        return

    handler._send_json(
        HTTPStatus.OK,
        handler.context.debug_scan_store.get_live(session_id),
    )
