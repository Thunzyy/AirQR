"""Tests for generated history item upload handling."""

from __future__ import annotations

import io
from http import HTTPStatus
from pathlib import Path
from unittest.mock import MagicMock

from sync_server.handler import SyncRequestHandler
from sync_server.storage import Storage


def _make_handler(
    storage_dir: Path,
    *,
    path: str,
    body: bytes,
    content_type: str,
) -> tuple[MagicMock, Storage]:
    storage = Storage(storage_dir)
    storage.ensure_dirs()

    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.storage = storage
    handler.context.export_manager = MagicMock()
    handler._require_auth = MagicMock(return_value=True)
    handler._send_json = MagicMock()
    handler._emit_event = MagicMock()
    handler._emit_history_event = MagicMock()
    handler.path = path
    handler.headers = {
        "Content-Type": content_type,
        "Content-Length": str(len(body)),
    }
    handler.rfile = io.BytesIO(body)
    handler._stream_request_body_to_file = SyncRequestHandler._stream_request_body_to_file.__get__(
        handler, SyncRequestHandler
    )
    return handler, storage


def test_handle_history_item_accepts_binary_stream_payload(tmp_path: Path) -> None:
    handler, storage = _make_handler(
        tmp_path / "storage",
        path=(
            "/api/history/item"
            "?historyId=history-raw"
            "&title=NAS%20Archive"
            "&filename=archive.zip"
            "&mimeType=application%2Fzip"
            "&size=4"
            "&totalFrames=12"
            "&minFrames=10"
            "&chunkMinFrames=%5B4%2C6%5D"
            "&createdAt=2026-03-29T12%3A00%3A00Z"
            "&updatedAt=2026-03-29T12%3A00%3A05Z"
        ),
        body=b"abcd",
        content_type="application/zip",
    )

    SyncRequestHandler._handle_history_item(handler)

    handler._send_json.assert_called_once_with(HTTPStatus.OK, {"ok": True})
    item = storage.read_history_item("history-raw")
    assert item is not None
    assert item["title"] == "NAS Archive"
    assert item["filename"] == "archive.zip"
    assert item["mimeType"] == "application/zip"
    assert item["size"] == 4
    assert item["totalFrames"] == 12
    assert item["minFrames"] == 10
    assert item["chunkMinFrames"] == [4, 6]
    saved_file = storage.resolve_relative_path(item["filePath"])
    assert saved_file.read_bytes() == b"abcd"
    handler._emit_event.assert_called_once_with(
        "history",
        {
            "type": "history-item",
            "origin": "generated",
            "historyId": "history-raw",
            "updatedAt": "2026-03-29T12:00:05Z",
        },
    )


def test_handle_history_item_rejects_legacy_json_file_base64_payload(tmp_path: Path) -> None:
    handler, storage = _make_handler(
        tmp_path / "storage",
        path="/api/history/item",
        body=b'{"historyId":"history-json","title":"Legacy","filename":"legacy.bin","fileBase64":"YWJjZA==","mimeType":"application/octet-stream"}',
        content_type="application/json",
    )
    handler._read_json = MagicMock(
        return_value={
            "historyId": "history-json",
            "title": "Legacy",
            "filename": "legacy.bin",
            "fileBase64": "YWJjZA==",
            "mimeType": "application/octet-stream",
        }
    )

    SyncRequestHandler._handle_history_item(handler)

    handler._send_json.assert_called_once_with(
        HTTPStatus.BAD_REQUEST,
        {
            "error": (
                "Legacy JSON fileBase64 uploads are no longer supported; "
                "send the file as a binary request body instead"
            )
        },
    )
    assert storage.read_history_item("history-json") is None
    handler._emit_event.assert_not_called()
