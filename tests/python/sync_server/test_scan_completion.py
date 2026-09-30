"""Tests for scan completion contract."""

from __future__ import annotations

import base64
from http import HTTPStatus
from pathlib import Path
from unittest.mock import MagicMock, patch

from sync_server.handler import SyncRequestHandler
from sync_server.packet_assembler import ScanAssemblyError
from sync_server.storage import Storage


def _make_handler(tmp_path: Path) -> MagicMock:
    handler = MagicMock(spec=SyncRequestHandler)
    handler._require_auth.return_value = True
    handler._send_json = MagicMock()
    handler._emit_event = MagicMock()
    handler._emit_history_event = MagicMock()
    handler.path = "/api/scan/complete"
    handler.headers = {
        "Content-Type": "application/json",
    }
    handler.context = MagicMock()
    handler.context.storage = MagicMock()
    handler.context.storage.base_dir = tmp_path
    handler.context.storage.read_session.return_value = {
        "sessionId": "scan-session",
        "createdAt": "2026-03-29T10:00:00Z",
    }
    handler.context.storage.save_session_file.return_value = tmp_path / "sessions" / "scan-session" / "files" / "decoded.bin"
    handler.context.export_manager = MagicMock()
    handler._finalize_scan_completion = SyncRequestHandler._finalize_scan_completion.__get__(
        handler, SyncRequestHandler
    )
    return handler


def test_complete_assembles_from_stored_packets_when_file_payload_is_missing(tmp_path: Path) -> None:
    handler = _make_handler(tmp_path)
    handler._read_json.return_value = {
        "sessionId": "scan-session",
        "filename": "fallback.bin",
        "mimeType": "application/octet-stream",
        "fileSize": 4,
        "completedAt": "2026-03-29T10:05:00Z",
    }

    with patch(
        "sync_server.routes_scan_write.assemble_scan_session_file",
        return_value=("decoded.bin", b"data"),
    ) as assemble_mock:
        SyncRequestHandler._handle_complete(handler)

    assemble_mock.assert_called_once_with(handler.context.storage, "scan-session")
    handler.context.storage.save_session_file.assert_called_once_with(
        "scan-session",
        "decoded.bin",
        b"data",
    )
    handler._send_json.assert_called_once_with(HTTPStatus.OK, {"ok": True})


def test_complete_rejects_missing_file_when_packets_cannot_be_assembled(tmp_path: Path) -> None:
    handler = _make_handler(tmp_path)
    handler._read_json.return_value = {
        "sessionId": "scan-session",
        "filename": "fallback.bin",
    }

    with patch(
        "sync_server.routes_scan_write.assemble_scan_session_file",
        side_effect=ScanAssemblyError("No decodable packets stored for session"),
    ):
        SyncRequestHandler._handle_complete(handler)

    handler.context.storage.save_session_file.assert_not_called()
    handler._send_json.assert_called_once_with(
        HTTPStatus.BAD_REQUEST,
        {"error": "Stored scan packets are not yet decodable"},
    )


def test_complete_rejects_legacy_file_base64_payloads(tmp_path: Path) -> None:
    handler = _make_handler(tmp_path)
    handler._read_json.return_value = {
        "sessionId": "scan-session",
        "filename": "legacy.bin",
        "fileBase64": "bGVnYWN5",
        "completedAt": "2026-03-29T10:05:00Z",
    }

    with patch("sync_server.routes_scan_write.assemble_scan_session_file") as assemble_mock:
        SyncRequestHandler._handle_complete(handler)

    assemble_mock.assert_not_called()
    handler.context.storage.save_session_file.assert_not_called()
    handler._send_json.assert_called_once_with(
        HTTPStatus.BAD_REQUEST,
        {
            "error": (
                "Legacy JSON fileBase64 uploads are no longer supported; "
                "send the final file as a binary request body instead"
            )
        },
    )


def test_packet_upload_auto_completes_when_expected_threshold_is_reached(tmp_path: Path) -> None:
    storage = Storage(tmp_path / "storage")
    storage.ensure_dirs()

    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.storage = storage
    handler.context.storage.base_dir = storage.base_dir
    handler.context.export_manager = MagicMock()
    handler._require_auth.return_value = True
    handler._send_json = MagicMock()
    handler._emit_event = MagicMock()
    handler._emit_history_event = MagicMock()
    handler._read_json.return_value = {
        "sessionId": "scan-session",
        "packetBase64": base64.b64encode(b"packet").decode("ascii"),
        "filename": "fallback.bin",
        "mimeType": "application/octet-stream",
        "expectedPackets": 1,
        "totalPackets": 3,
        "totalPacketsExact": True,
    }
    handler._finalize_scan_completion = SyncRequestHandler._finalize_scan_completion.__get__(
        handler, SyncRequestHandler
    )
    handler._maybe_finalize_scan_packet_session = (
        SyncRequestHandler._maybe_finalize_scan_packet_session.__get__(
            handler, SyncRequestHandler
        )
    )
    handler._handle_packet = SyncRequestHandler._handle_packet.__get__(
        handler, SyncRequestHandler
    )

    with patch(
        "sync_server.routes_scan_write.assemble_scan_session_file",
        return_value=("decoded.bin", b"packet"),
    ):
        handler._handle_packet()

    session = storage.read_session("scan-session")
    assert session is not None
    assert session["completed"] is True
    assert session["status"] == "complete"
    assert session["expectedPackets"] == 1
    assert session["totalPackets"] == 3
    assert session["totalPacketsExact"] is True
    handler._send_json.assert_called_once_with(HTTPStatus.OK, {"ok": True})
