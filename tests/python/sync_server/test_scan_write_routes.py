from __future__ import annotations

import base64
import io
from http import HTTPStatus
from pathlib import Path
from unittest.mock import MagicMock, patch

from sync_server.handler import SyncRequestHandler
from sync_server.packet_assembler import ScanAssemblyError
from sync_server.routes_scan_write import handle_complete, handle_packet
from sync_server.storage import Storage


def _make_binary_complete_handler(
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
    return handler, storage


def test_handle_complete_accepts_binary_stream_payload(tmp_path: Path) -> None:
    handler, storage = _make_binary_complete_handler(
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

    handle_complete(handler)

    handler._send_json.assert_called_once_with(HTTPStatus.OK, {"ok": True})
    session = storage.read_session("scan-raw")
    assert session is not None
    assert session["completed"] is True
    assert session["status"] == "complete"
    assert session["filename"] == "scan.bin"
    assert session["size"] == 3


def test_handle_complete_assembles_from_stored_packets_when_file_payload_is_missing(
    tmp_path: Path,
) -> None:
    handler = MagicMock(spec=SyncRequestHandler)
    handler._require_auth.return_value = True
    handler._send_json = MagicMock()
    handler._emit_event = MagicMock()
    handler._emit_history_event = MagicMock()
    handler.path = "/api/scan/complete"
    handler.headers = {"Content-Type": "application/json"}
    handler.context = MagicMock()
    handler.context.storage = MagicMock()
    handler.context.storage.base_dir = tmp_path
    handler.context.storage.read_session.return_value = {
        "sessionId": "scan-session",
        "createdAt": "2026-03-29T10:00:00Z",
    }
    handler.context.storage.save_session_file.return_value = (
        tmp_path / "sessions" / "scan-session" / "files" / "decoded.bin"
    )
    handler.context.export_manager = MagicMock()
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
        handle_complete(handler)

    assemble_mock.assert_called_once_with(handler.context.storage, "scan-session")
    handler.context.storage.save_session_file.assert_called_once_with(
        "scan-session",
        "decoded.bin",
        b"data",
    )
    handler._send_json.assert_called_once_with(HTTPStatus.OK, {"ok": True})


def test_handle_packet_auto_completes_when_expected_threshold_is_reached(
    tmp_path: Path,
) -> None:
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

    with patch(
        "sync_server.routes_scan_write.assemble_scan_session_file",
        return_value=("decoded.bin", b"packet"),
    ):
        handle_packet(handler)

    session = storage.read_session("scan-session")
    assert session is not None
    assert session["completed"] is True
    assert session["status"] == "complete"
    assert session["expectedPackets"] == 1
    assert session["totalPackets"] == 3
    handler._send_json.assert_called_once_with(HTTPStatus.OK, {"ok": True})
    event_types = [call.args[0] for call in handler._emit_event.call_args_list]
    assert event_types == [
        "scan-progress",
        "scan-session-state",
        "scan-session-state",
        "scan-complete",
    ]
    final_state = handler._emit_event.call_args_list[2].args[1]
    assert final_state["type"] == "scan-session-state"
    assert final_state["sessionId"] == "scan-session"
    assert final_state["decodeState"] == "complete"
    assert final_state["completionPercent"] == 100
    assert final_state["fileAvailable"] is True
    assert final_state["chunksMissing"] == 0


def test_handle_packet_emits_canonical_scan_session_state_after_progress(
    tmp_path: Path,
) -> None:
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
        "filename": "scan.bin",
        "mimeType": "application/octet-stream",
        "expectedPackets": 2,
        "totalPackets": 3,
        "totalPacketsExact": True,
        "totalChunks": 1,
    }

    handle_packet(handler)

    handler._send_json.assert_called_once_with(HTTPStatus.OK, {"ok": True})
    event_types = [call.args[0] for call in handler._emit_event.call_args_list]
    assert event_types == ["scan-progress", "scan-session-state"]
    state_event = handler._emit_event.call_args_list[1].args[1]
    assert state_event["type"] == "scan-session-state"
    assert state_event["sessionId"] == "scan-session"
    assert state_event["receivedUnique"] == 1
    assert state_event["decodeThreshold"] == 2
    assert state_event["decodeState"] == "scanning"
    assert state_event["completionPercent"] == 50
    assert state_event["fileAvailable"] is False
    assert state_event["chunks"][0]["receivedUnique"] == 1


def test_handle_packet_logs_structured_threshold_pending_message(
    tmp_path: Path,
    caplog,
) -> None:
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
        "expectedPackets": 1,
        "totalPackets": 3,
        "totalPacketsExact": True,
    }

    with patch(
        "sync_server.routes_scan_write.assemble_scan_session_file",
        side_effect=ScanAssemblyError("No decodable packets stored for session"),
    ):
        with caplog.at_level("INFO", logger="sync_server.routes_scan_write"):
            handle_packet(handler)

    assert "scan.packet.threshold_pending" in caplog.text
    assert "sessionId=scan-session" in caplog.text
    assert "receivedCount=1" in caplog.text
    assert "decodeThreshold=1" in caplog.text
    assert 'error="No decodable packets stored for session"' in caplog.text


def test_handle_complete_rejects_missing_file_when_packets_cannot_be_assembled(
    tmp_path: Path,
) -> None:
    handler = MagicMock(spec=SyncRequestHandler)
    handler._require_auth.return_value = True
    handler._send_json = MagicMock()
    handler._emit_event = MagicMock()
    handler._emit_history_event = MagicMock()
    handler.path = "/api/scan/complete"
    handler.headers = {"Content-Type": "application/json"}
    handler.context = MagicMock()
    handler.context.storage = MagicMock()
    handler.context.storage.base_dir = tmp_path
    handler.context.storage.read_session.return_value = {
        "sessionId": "scan-session",
        "createdAt": "2026-03-29T10:00:00Z",
    }
    handler.context.export_manager = MagicMock()
    handler._read_json.return_value = {
        "sessionId": "scan-session",
        "filename": "fallback.bin",
    }

    with patch(
        "sync_server.routes_scan_write.assemble_scan_session_file",
        side_effect=ScanAssemblyError("No decodable packets stored for session"),
    ):
        handle_complete(handler)

    handler.context.storage.save_session_file.assert_not_called()
    handler._send_json.assert_called_once_with(
        HTTPStatus.BAD_REQUEST,
        {"error": "Stored scan packets are not yet decodable"},
    )


def test_handle_complete_logs_structured_assembly_failure(
    tmp_path: Path,
    caplog,
) -> None:
    handler = MagicMock(spec=SyncRequestHandler)
    handler._require_auth.return_value = True
    handler._send_json = MagicMock()
    handler._emit_event = MagicMock()
    handler._emit_history_event = MagicMock()
    handler.path = "/api/scan/complete"
    handler.headers = {"Content-Type": "application/json"}
    handler.context = MagicMock()
    handler.context.storage = MagicMock()
    handler.context.storage.base_dir = tmp_path
    handler.context.storage.read_session.return_value = {
        "sessionId": "scan-session",
        "createdAt": "2026-03-29T10:00:00Z",
    }
    handler.context.export_manager = MagicMock()
    handler._read_json.return_value = {
        "sessionId": "scan-session",
        "filename": "fallback.bin",
    }

    with patch(
        "sync_server.routes_scan_write.assemble_scan_session_file",
        side_effect=ScanAssemblyError("No decodable packets stored for session"),
    ):
        with caplog.at_level("INFO", logger="sync_server.routes_scan_write"):
            handle_complete(handler)

    assert "scan.complete.assembly_failed" in caplog.text
    assert "sessionId=scan-session" in caplog.text
    assert 'error="No decodable packets stored for session"' in caplog.text


def test_handle_complete_sanitizes_stream_upload_body_errors(tmp_path: Path) -> None:
    handler, storage = _make_binary_complete_handler(
        tmp_path / "storage",
        path="/api/scan/complete?sessionId=scan-raw&filename=scan.bin",
        body=b"abc",
        content_type="application/octet-stream",
    )
    handler.headers["Content-Length"] = "invalid"

    handle_complete(handler)

    handler._send_json.assert_called_once_with(
        HTTPStatus.BAD_REQUEST,
        {"error": "Invalid request body"},
    )
    assert storage.read_session("scan-raw") is None
