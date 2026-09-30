from __future__ import annotations

from http import HTTPStatus
from unittest.mock import MagicMock

from sync_server.handler import SyncRequestHandler
from sync_server.routes_dispatch import dispatch_delete, dispatch_get, dispatch_post


def test_dispatch_get_routes_scan_session_file_download() -> None:
    handler = MagicMock(spec=SyncRequestHandler)
    handler._handle_file_download = MagicMock()
    handler._send_json = MagicMock()

    handled = dispatch_get(handler, "/api/scan/session/scan-1/file")

    assert handled is True
    handler._handle_file_download.assert_called_once_with("scan-1")
    handler._send_json.assert_not_called()


def test_dispatch_get_rejects_invalid_scan_session_id() -> None:
    handler = MagicMock(spec=SyncRequestHandler)
    handler._handle_file_download = MagicMock()
    handler._send_json = MagicMock()

    handled = dispatch_get(handler, "/api/scan/session/not valid/file")

    assert handled is True
    handler._handle_file_download.assert_not_called()
    handler._send_json.assert_called_once_with(
        HTTPStatus.BAD_REQUEST,
        {"error": "Invalid sessionId"},
    )


def test_dispatch_post_routes_history_item_upload() -> None:
    handler = MagicMock(spec=SyncRequestHandler)
    handler._handle_history_item = MagicMock()

    handled = dispatch_post(handler, "/api/history/item")

    assert handled is True
    handler._handle_history_item.assert_called_once_with()


def test_dispatch_delete_routes_history_item_delete() -> None:
    handler = MagicMock(spec=SyncRequestHandler)
    handler._handle_delete_history_item = MagicMock()
    handler._send_json = MagicMock()

    handled = dispatch_delete(handler, "/api/history/item/history-1")

    assert handled is True
    handler._handle_delete_history_item.assert_called_once_with("history-1")
    handler._send_json.assert_not_called()
