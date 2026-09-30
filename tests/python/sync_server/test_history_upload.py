"""Tests for generated history upload contract."""

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
            "&title=generated.bin"
            "&filename=generated.bin"
            "&mimeType=application%2Foctet-stream"
            "&size=4"
            "&totalFrames=12"
            "&minFrames=7"
            "&chunkMinFrames=%5B3%2C4%5D"
            "&createdAt=2026-03-29T12%3A00%3A00Z"
            "&updatedAt=2026-03-29T12%3A01%3A00Z"
        ),
        body=b"abcd",
        content_type="application/octet-stream",
    )

    SyncRequestHandler._handle_history_item(handler)

    handler._send_json.assert_called_once_with(HTTPStatus.OK, {"ok": True})
    item = storage.read_history_item("history-raw")
    assert item is not None
    assert item["title"] == "generated.bin"
    assert item["filename"] == "generated.bin"
    assert item["size"] == 4
    assert item["mimeType"] == "application/octet-stream"
    assert item["totalFrames"] == 12
    assert item["minFrames"] == 7
    assert item["chunkMinFrames"] == [3, 4]
    saved_file = storage.resolve_relative_path(item["filePath"])
    assert saved_file.read_bytes() == b"abcd"


def test_handle_history_item_rejects_legacy_json_file_base64_contract(tmp_path: Path) -> None:
    handler, storage = _make_handler(
        tmp_path / "storage",
        path="/api/history/item",
        body=(
            b'{"historyId":"history-json","title":"generated.bin","filename":"generated.bin",'
            b'"mimeType":"application/octet-stream","fileBase64":"YWJjZA=="}'
        ),
        content_type="application/json",
    )
    handler._read_json = MagicMock(
        return_value={
            "historyId": "history-json",
            "title": "generated.bin",
            "filename": "generated.bin",
            "mimeType": "application/octet-stream",
            "fileBase64": "YWJjZA==",
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
