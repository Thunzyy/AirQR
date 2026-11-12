from __future__ import annotations

from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler
from unittest.mock import MagicMock, patch

from sync_server.handler import SyncRequestHandler


def test_end_headers_handles_parse_errors_without_headers() -> None:
    handler = object.__new__(SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.allowed_origins = []
    handler.path = "/"
    handler.send_header = MagicMock()

    with patch.object(SimpleHTTPRequestHandler, "end_headers", autospec=True) as super_end_headers:
        SyncRequestHandler.end_headers(handler)

    super_end_headers.assert_called_once_with(handler)


def test_send_json_ignores_client_disconnects() -> None:
    handler = object.__new__(SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.allowed_origins = []
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock(side_effect=ConnectionAbortedError())
    handler.wfile = MagicMock()

    SyncRequestHandler._send_json(handler, HTTPStatus.OK, {"ok": True})

    handler.send_response.assert_called_once_with(HTTPStatus.OK)
    handler.send_header.assert_any_call("Content-Type", "application/json")
    handler.wfile.write.assert_not_called()


def test_send_bytes_ignores_client_disconnects() -> None:
    handler = object.__new__(SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.allowed_origins = []
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock(side_effect=ConnectionAbortedError())
    handler.wfile = MagicMock()

    SyncRequestHandler._send_bytes(
        handler,
        HTTPStatus.OK,
        b"payload",
        "application/octet-stream",
    )

    handler.send_response.assert_called_once_with(HTTPStatus.OK)
    handler.send_header.assert_any_call("Content-Type", "application/octet-stream")
    handler.wfile.write.assert_not_called()
