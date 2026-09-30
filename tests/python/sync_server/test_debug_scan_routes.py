from __future__ import annotations

from http import HTTPStatus
from unittest.mock import MagicMock

from sync_server.handler import SyncRequestHandler
from sync_server.routes_debug import handle_debug_scan_live, handle_debug_scan_snapshot
from sync_server.routes_dispatch import dispatch_get, dispatch_post


def _build_handler(*, authorized: bool = True) -> MagicMock:
    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.debug_scan_store = MagicMock()
    handler._require_auth.return_value = authorized
    handler._read_json = MagicMock()
    handler._send_json = MagicMock()
    return handler


def test_debug_scan_snapshot_upload_sanitizes_sensitive_fields() -> None:
    handler = _build_handler()
    handler._read_json.return_value = {
        "sessionId": "scan-live",
        "scanner": {
            "scanStats": {"received": 42, "total": 100},
            "secret": "remove-me",
        },
        "transport": {
            "state": "ready",
            "queuedPackets": 3,
            "recentEvents": [{"type": "packets-sent"}],
            "Authorization": "Basic nope",
        },
        "server": {"receivedCount": 40},
        "password": "not-stored",
        "apiKey": "not-stored",
        "authorization": "Basic nope",
    }

    handle_debug_scan_snapshot(
        handler,
        "scan-live",
    )

    handler._require_auth.assert_called_once()
    handler.context.debug_scan_store.add_snapshot.assert_called_once()
    session_id, stored_snapshot = handler.context.debug_scan_store.add_snapshot.call_args.args
    assert session_id == "scan-live"
    assert stored_snapshot["sessionId"] == "scan-live"
    assert stored_snapshot["scanner"]["scanStats"]["received"] == 42
    assert stored_snapshot["transport"]["queuedPackets"] == 3
    assert stored_snapshot["server"]["receivedCount"] == 40
    assert "password" not in stored_snapshot
    assert "apiKey" not in stored_snapshot
    assert "authorization" not in stored_snapshot
    assert "secret" not in stored_snapshot["scanner"]
    assert "Authorization" not in stored_snapshot["transport"]
    handler._send_json.assert_called_once_with(HTTPStatus.OK, {"ok": True})


def test_debug_scan_snapshot_upload_requires_auth() -> None:
    handler = _build_handler(authorized=False)

    handle_debug_scan_snapshot(
        handler,
        "scan-live",
    )

    handler._require_auth.assert_called_once()
    handler._read_json.assert_not_called()
    handler.context.debug_scan_store.add_snapshot.assert_not_called()


def test_debug_scan_live_returns_recent_snapshots() -> None:
    handler = _build_handler()
    handler.context.debug_scan_store.get_live.return_value = {
        "sessionId": "scan-live",
        "snapshots": [{"sessionId": "scan-live", "at": "2026-06-24T12:00:00Z"}],
        "count": 1,
        "maxSnapshots": 120,
        "retentionSeconds": 600,
    }

    handle_debug_scan_live(handler, "scan-live")

    handler._require_auth.assert_called_once()
    handler.context.debug_scan_store.get_live.assert_called_once_with("scan-live")
    handler._send_json.assert_called_once_with(
        HTTPStatus.OK,
        {
            "sessionId": "scan-live",
            "snapshots": [{"sessionId": "scan-live", "at": "2026-06-24T12:00:00Z"}],
            "count": 1,
            "maxSnapshots": 120,
            "retentionSeconds": 600,
        },
    )


def test_debug_scan_live_rejects_invalid_session_id() -> None:
    handler = _build_handler()

    handled = dispatch_get(handler, "/api/debug/scan-sessions/../live")

    assert handled is True
    handler._require_auth.assert_not_called()
    handler.context.debug_scan_store.get_live.assert_not_called()
    handler._send_json.assert_called_once_with(
        HTTPStatus.BAD_REQUEST,
        {"error": "Invalid sessionId"},
    )


def test_debug_scan_snapshot_dispatches_valid_session_id() -> None:
    handler = _build_handler()
    handler._handle_debug_scan_snapshot = MagicMock()

    handled = dispatch_post(
        handler,
        "/api/debug/scan-sessions/scan-live/snapshots",
    )

    assert handled is True
    handler._handle_debug_scan_snapshot.assert_called_once_with("scan-live")


def test_debug_scan_live_dispatches_valid_session_id() -> None:
    handler = _build_handler()
    handler._handle_debug_scan_live = MagicMock()

    handled = dispatch_get(handler, "/api/debug/scan-sessions/scan-live/live")

    assert handled is True
    handler._handle_debug_scan_live.assert_called_once_with("scan-live")
