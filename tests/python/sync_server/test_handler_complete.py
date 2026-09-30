"""Tests for scan completion request handling."""

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
    handler._build_session_file_path = SyncRequestHandler._build_session_file_path.__get__(
        handler, SyncRequestHandler
    )
    handler._stream_request_body_to_file = SyncRequestHandler._stream_request_body_to_file.__get__(
        handler, SyncRequestHandler
    )
    handler._finalize_scan_completion = SyncRequestHandler._finalize_scan_completion.__get__(
        handler, SyncRequestHandler
    )
    return handler, storage


def test_handle_complete_accepts_binary_stream_payload(tmp_path: Path) -> None:
    handler, storage = _make_handler(
        tmp_path / "storage",
        path=(
            "/api/scan/complete"
            "?sessionId=scan-raw"
            "&filename=scan.bin"
            "&mimeType=application%2Foctet-stream"
            "&completedAt=2026-03-29T10%3A00%3A00Z"
            "&duration=12"
            "&totalChunks=4"
            "&chunksCompleted=4"
            "&deviceId=device-1"
            "&deviceName=NAS%20Tester"
        ),
        body=b"abc",
        content_type="application/octet-stream",
    )

    SyncRequestHandler._handle_complete(handler)

    handler._send_json.assert_called_once_with(HTTPStatus.OK, {"ok": True})
    session = storage.read_session("scan-raw")
    assert session is not None
    assert session["completed"] is True
    assert session["status"] == "complete"
    assert session["filename"] == "scan.bin"
    assert session["size"] == 3
    assert session["mimeType"] == "application/octet-stream"
    assert session["duration"] == 12
    assert session["totalChunks"] == 4
    assert session["chunksCompleted"] == 4
    saved_file = storage.resolve_relative_path(session["filePath"])
    assert saved_file.read_bytes() == b"abc"


def test_handle_complete_rejects_legacy_json_file_base64_payload(tmp_path: Path) -> None:
    handler, storage = _make_handler(
        tmp_path / "storage",
        path="/api/scan/complete",
        body=b'{"sessionId":"scan-json","filename":"legacy.bin","fileBase64":"YWJj","mimeType":"application/octet-stream"}',
        content_type="application/json",
    )
    handler._read_json = MagicMock(
        return_value={
            "sessionId": "scan-json",
            "filename": "legacy.bin",
            "fileBase64": "YWJj",
            "mimeType": "application/octet-stream",
        }
    )

    SyncRequestHandler._handle_complete(handler)

    handler._send_json.assert_called_once_with(
        HTTPStatus.BAD_REQUEST,
        {
            "error": (
                "Legacy JSON fileBase64 uploads are no longer supported; "
                "send the final file as a binary request body instead"
            )
        },
    )
    assert storage.read_session("scan-json") is None


def test_handle_complete_rejects_invalid_binary_query_metadata(tmp_path: Path) -> None:
    handler, storage = _make_handler(
        tmp_path / "storage",
        path="/api/scan/complete?sessionId=scan-raw&filename=scan.bin&duration=abc",
        body=b"abc",
        content_type="application/octet-stream",
    )

    SyncRequestHandler._handle_complete(handler)

    handler._send_json.assert_called_once_with(
        HTTPStatus.BAD_REQUEST,
        {"error": "Invalid duration"},
    )
    assert storage.read_session("scan-raw") is None
