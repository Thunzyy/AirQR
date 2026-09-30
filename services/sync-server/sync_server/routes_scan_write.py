from __future__ import annotations

import base64
import logging
from http import HTTPStatus
from pathlib import Path
from typing import TYPE_CHECKING, Any, Optional
from urllib.parse import parse_qs, urlparse

from .packet_assembler import (
    ScanAssemblyError,
    ScanAssemblyUnavailableError,
    assemble_scan_session_file,
)
from .handler_http import (
    sanitize_request_body_error_message,
    sanitize_scan_assembly_error_message,
)
from .observability import format_kv_log
from .scan_session_state import build_scan_session_state
from .utils import compute_hash, safe_session_id, utc_now

if TYPE_CHECKING:
    from .handler import SyncRequestHandler

logger = logging.getLogger(__name__)

SCAN_COMPLETE_FILE_BASE64_REMOVED_ERROR = (
    "Legacy JSON fileBase64 uploads are no longer supported; "
    "send the final file as a binary request body instead"
)


def _first_query_value(params: dict[str, list[str]], key: str) -> Optional[str]:
    values = params.get(key)
    if not values:
        return None
    value = values[0]
    return value if isinstance(value, str) else None


def _parse_optional_int(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _emit_canonical_scan_session_state(
    handler: "SyncRequestHandler",
    session_id: str,
    session: dict[str, Any],
) -> dict[str, Any]:
    canonical_payload = build_scan_session_state(session_id, session)
    handler._emit_event("scan-session-state", canonical_payload)
    handler._emit_history_event({"type": "scan-session-state", **canonical_payload})
    return canonical_payload


def _sync_http_packet_chunk_state(
    session: dict[str, Any],
    payload: dict[str, Any],
    received_count: int,
    is_new_packet: bool,
) -> None:
    chunk_id = _parse_optional_int(payload.get("chunkId")) or 0
    total_chunks = _parse_optional_int(session.get("totalChunks")) or 1
    chunk_states = session.get("chunkStates")
    if not isinstance(chunk_states, list):
        chunk_states = []

    chunk_state: dict[str, Any] | None = None
    for item in chunk_states:
        if not isinstance(item, dict):
            continue
        if _parse_optional_int(item.get("chunkId")) == chunk_id:
            chunk_state = item
            break
    if chunk_state is None:
        chunk_state = {"chunkId": chunk_id}
        chunk_states.append(chunk_state)

    previous_chunk_count = _parse_optional_int(chunk_state.get("receivedCount")) or 0
    if total_chunks <= 1:
        next_chunk_count = max(previous_chunk_count, received_count)
    elif is_new_packet:
        next_chunk_count = previous_chunk_count + 1
    else:
        next_chunk_count = previous_chunk_count
    chunk_state["receivedCount"] = max(
        previous_chunk_count,
        next_chunk_count,
    )
    chunk_state["lastContiguous"] = max(
        _parse_optional_int(chunk_state.get("lastContiguous")) or -1,
        chunk_state["receivedCount"] - 1,
    )
    chunk_state.setdefault("missing", [])
    if total_chunks <= 1 and payload.get("expectedPackets") is not None:
        chunk_state["expectedPackets"] = int(payload.get("expectedPackets"))
    if total_chunks <= 1 and payload.get("totalPackets") is not None:
        chunk_state["totalPackets"] = int(payload.get("totalPackets"))
    if total_chunks <= 1 and payload.get("totalPacketsExact") is not None:
        chunk_state["totalPacketsExact"] = bool(payload.get("totalPacketsExact"))

    session["chunkStates"] = chunk_states


def _finalize_scan_completion(
    handler: "SyncRequestHandler",
    *,
    session_id: str,
    file_path: Path,
    mime_type: Optional[str],
    file_size: int,
    duration: Any,
    total_chunks: Any,
    chunks_completed: Any,
    completed_at: Optional[str],
    device_id: Optional[str],
    device_name: Optional[str],
) -> None:
    completed_value = completed_at or utc_now()

    session = handler.context.storage.read_session(session_id) or {}
    session.setdefault("sessionId", session_id)
    session.setdefault("createdAt", completed_value)
    session["updatedAt"] = utc_now()
    session["status"] = "complete"
    session["completed"] = True
    session["completedAt"] = completed_value
    session["filename"] = file_path.name
    session["mimeType"] = mime_type or "application/octet-stream"
    session["size"] = file_size
    session["duration"] = duration
    if total_chunks is not None:
        session["totalChunks"] = total_chunks
    if chunks_completed is not None:
        session["chunksCompleted"] = chunks_completed
    if device_id:
        session["deviceId"] = device_id
    if device_name:
        session["deviceName"] = device_name
    try:
        session["filePath"] = str(file_path.relative_to(handler.context.storage.base_dir))
    except ValueError:
        session["filePath"] = str(file_path)

    handler.context.storage.write_session(session_id, session)
    logger.info(
        format_kv_log(
            "scan.complete.finalized",
            chunksCompleted=session.get("chunksCompleted"),
            completedAt=completed_value,
            deviceId=device_id or session.get("deviceId"),
            fileSize=file_size,
            filename=session.get("filename"),
            sessionId=session_id,
            totalChunks=session.get("totalChunks"),
        )
    )

    complete_payload = {
        "origin": "scanned",
        "sessionId": session_id,
        "updatedAt": session.get("updatedAt"),
        "completed": True,
        "filename": session.get("filename"),
        "deviceId": device_id or session.get("deviceId"),
        "deviceName": device_name or session.get("deviceName"),
        "size": session.get("size"),
        "mimeType": session.get("mimeType"),
        "duration": session.get("duration"),
        "totalChunks": session.get("totalChunks"),
        "chunksCompleted": session.get("chunksCompleted"),
    }

    _emit_canonical_scan_session_state(handler, session_id, session)
    handler._emit_event("scan-complete", complete_payload)
    handler._emit_history_event({"type": "scan-complete", **complete_payload})
    handler._send_json(HTTPStatus.OK, {"ok": True})


def _maybe_finalize_scan_packet_session(
    handler: "SyncRequestHandler",
    session_id: str,
    session: dict[str, Any],
) -> bool:
    if bool(session.get("completed")) or session.get("status") == "complete":
        return False

    decode_threshold = _parse_optional_int(
        session.get("expectedPackets", session.get("totalPackets"))
    )
    received_count = _parse_optional_int(session.get("receivedCount"))
    if decode_threshold is None or received_count is None or received_count < decode_threshold:
        return False

    try:
        assembled_name, file_bytes = assemble_scan_session_file(
            handler.context.storage,
            session_id,
        )
    except ScanAssemblyError as exc:
        logger.info(
            format_kv_log(
                "scan.packet.threshold_pending",
                decodeThreshold=decode_threshold,
                error=str(exc),
                receivedCount=received_count,
                sessionId=session_id,
            )
        )
        return False
    except ScanAssemblyUnavailableError as exc:
        logger.error("Scan packet auto-completion unavailable: %s", exc)
        return False

    file_path = handler.context.storage.save_session_file(
        session_id,
        assembled_name,
        file_bytes,
    )
    handler.context.export_manager.export_path(
        "scanned",
        file_path,
        filename=file_path.name,
        timestamp=utc_now(),
    )
    _finalize_scan_completion(
        handler,
        session_id=session_id,
        file_path=file_path,
        mime_type=session.get("mimeType"),
        file_size=len(file_bytes),
        duration=session.get("duration"),
        total_chunks=session.get("totalChunks"),
        chunks_completed=session.get("chunksCompleted"),
        completed_at=utc_now(),
        device_id=session.get("deviceId"),
        device_name=session.get("deviceName"),
    )
    logger.info(
        format_kv_log(
            "scan.packet.auto_completed",
            decodeThreshold=decode_threshold,
            fileSize=len(file_bytes),
            filename=assembled_name,
            receivedCount=received_count,
            sessionId=session_id,
        )
    )
    return True


def handle_packet(handler: "SyncRequestHandler") -> None:
    if not handler._require_auth():
        return
    payload = handler._read_json()
    if not payload:
        handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON"})
        return
    session_id = payload.get("sessionId")
    if not isinstance(session_id, str) or not safe_session_id(session_id):
        handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid sessionId"})
        return
    packet_b64 = payload.get("packetBase64")
    if not isinstance(packet_b64, str):
        handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Missing packetBase64"})
        return

    try:
        packet_bytes = base64.b64decode(packet_b64, validate=True)
    except Exception:
        handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid packetBase64"})
        return

    session = handler.context.storage.read_session(session_id) or {}
    if (
        bool(session.get("completed"))
        or session.get("status") == "complete"
        or bool(session.get("completedAt"))
    ):
        handler._send_json(HTTPStatus.OK, {"ok": True, "ignored": "completed"})
        return

    packet_hash = compute_hash(packet_bytes)
    _, is_new_packet = handler.context.storage.save_session_packet(
        session_id,
        packet_bytes,
        packet_hash,
    )

    session.setdefault("sessionId", session_id)
    session.setdefault("createdAt", utc_now())
    session["updatedAt"] = utc_now()
    received_count = int(session.get("receivedCount", 0))
    if is_new_packet:
        received_count += 1
    filename = payload.get("filename")
    if isinstance(filename, str) and filename and not filename.startswith("DBG:"):
        session["filename"] = filename
    if payload.get("isStreaming") is not None:
        session["isStreaming"] = bool(payload.get("isStreaming"))
    if payload.get("resultType"):
        session["resultType"] = payload.get("resultType")
    if payload.get("packetSize") is not None:
        session["packetSize"] = int(payload.get("packetSize"))
    if payload.get("capturedAt"):
        session["lastPacketAt"] = payload.get("capturedAt")
    if payload.get("deviceId"):
        session["deviceId"] = payload.get("deviceId")
    if payload.get("deviceName"):
        session["deviceName"] = payload.get("deviceName")
    if payload.get("totalChunks") is not None:
        session["totalChunks"] = payload.get("totalChunks")
    if payload.get("chunkId") is not None:
        session["chunksCompleted"] = max(
            int(session.get("chunksCompleted", 0)),
            int(payload.get("chunkId")) + 1,
        )
    if payload.get("chunksCompleted") is not None:
        session["chunksCompleted"] = max(
            int(session.get("chunksCompleted", 0)),
            int(payload.get("chunksCompleted")),
        )
    session["receivedCount"] = received_count
    session["receivedPackets"] = received_count
    if payload.get("expectedPackets") is not None:
        session["expectedPackets"] = max(
            int(session.get("expectedPackets", 0)),
            int(payload.get("expectedPackets")),
        )
    if payload.get("totalPackets") is not None:
        session["totalPackets"] = max(
            int(session.get("totalPackets", 0)),
            int(payload.get("totalPackets")),
        )
    if payload.get("totalPacketsExact") is not None:
        session["totalPacketsExact"] = bool(payload.get("totalPacketsExact"))
    if payload.get("chunksSaved") is not None:
        session["chunksSaved"] = max(
            int(session.get("chunksSaved", 0)),
            int(payload.get("chunksSaved")),
        )
    _sync_http_packet_chunk_state(session, payload, received_count, is_new_packet)

    handler.context.storage.write_session(session_id, session)

    scan_payload = {
        "origin": "scanned",
        "sessionId": session_id,
        "updatedAt": session.get("updatedAt"),
        "completed": session.get("completed", False),
        "deviceId": payload.get("deviceId") or session.get("deviceId"),
        "deviceName": payload.get("deviceName") or session.get("deviceName"),
        "receivedPackets": session.get("receivedCount"),
        "expectedPackets": session.get("expectedPackets"),
        "totalPackets": session.get("totalPackets"),
        "totalPacketsExact": bool(session.get("totalPacketsExact")),
        "receivedCount": session.get("receivedCount"),
        "filename": session.get("filename"),
    }

    handler._emit_event("scan-progress", scan_payload)
    handler._emit_history_event({"type": "scan-progress", **scan_payload})
    _emit_canonical_scan_session_state(handler, session_id, session)
    if _maybe_finalize_scan_packet_session(handler, session_id, session):
        return
    handler._send_json(HTTPStatus.OK, {"ok": True})


def handle_complete(handler: "SyncRequestHandler") -> None:
    if not handler._require_auth():
        return
    parsed = urlparse(handler.path)
    content_type = (handler.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
    if content_type and content_type != "application/json":
        params = parse_qs(parsed.query)
        session_id = _first_query_value(params, "sessionId")
        if not isinstance(session_id, str) or not safe_session_id(session_id):
            handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid sessionId"})
            return

        file_size_raw = _first_query_value(params, "fileSize")
        duration_raw = _first_query_value(params, "duration")
        total_chunks_raw = _first_query_value(params, "totalChunks")
        chunks_completed_raw = _first_query_value(params, "chunksCompleted")
        file_size = _parse_optional_int(file_size_raw)
        duration = _parse_optional_int(duration_raw)
        total_chunks = _parse_optional_int(total_chunks_raw)
        chunks_completed = _parse_optional_int(chunks_completed_raw)
        if file_size_raw is not None and file_size is None:
            handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid fileSize"})
            return
        if duration_raw is not None and duration is None:
            handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid duration"})
            return
        if total_chunks_raw is not None and total_chunks is None:
            handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid totalChunks"})
            return
        if chunks_completed_raw is not None and chunks_completed is None:
            handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid chunksCompleted"})
            return
        filename = _first_query_value(params, "filename") or "file.bin"
        mime_type = _first_query_value(params, "mimeType") or content_type
        completed_at = _first_query_value(params, "completedAt")
        device_id = _first_query_value(params, "deviceId")
        device_name = _first_query_value(params, "deviceName")

        file_path = handler._build_session_file_path(session_id, filename)
        try:
            written_size = handler._stream_request_body_to_file(file_path)
        except ValueError as exc:
            handler._send_json(
                HTTPStatus.BAD_REQUEST,
                {"error": sanitize_request_body_error_message(exc)},
            )
            return
        except Exception:
            logger.exception("Failed to store streamed scan completion for %s", session_id)
            handler._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": "Internal server error"},
            )
            return

        if file_size is not None and file_size != written_size:
            logger.warning(
                "Binary scan completion size mismatch for %s: declared=%s written=%s",
                session_id,
                file_size,
                written_size,
            )
        handler.context.export_manager.export_path(
            "scanned",
            file_path,
            filename=file_path.name,
            timestamp=completed_at,
        )
        _finalize_scan_completion(
            handler,
            session_id=session_id,
            file_path=file_path,
            mime_type=mime_type,
            file_size=written_size,
            duration=duration,
            total_chunks=total_chunks,
            chunks_completed=chunks_completed,
            completed_at=completed_at,
            device_id=device_id,
            device_name=device_name,
        )
        return

    payload = handler._read_json()
    if not payload:
        handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON"})
        return
    session_id = payload.get("sessionId")
    if not isinstance(session_id, str) or not safe_session_id(session_id):
        handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid sessionId"})
        return

    if "fileBase64" in payload:
        handler._send_json(
            HTTPStatus.BAD_REQUEST,
            {"error": SCAN_COMPLETE_FILE_BASE64_REMOVED_ERROR},
        )
        return

    try:
        assembled_name, file_bytes = assemble_scan_session_file(
            handler.context.storage,
            session_id,
        )
        if isinstance(assembled_name, str) and assembled_name:
            payload["filename"] = assembled_name
    except ScanAssemblyError as exc:
        logger.info(
            format_kv_log(
                "scan.complete.assembly_failed",
                error=str(exc),
                mode="json",
                sessionId=session_id,
            )
        )
        handler._send_json(
            HTTPStatus.BAD_REQUEST,
            {"error": sanitize_scan_assembly_error_message(exc)},
        )
        return
    except ScanAssemblyUnavailableError as exc:
        logger.error(
            format_kv_log(
                "scan.complete.assembly_unavailable",
                error=str(exc),
                mode="json",
                sessionId=session_id,
            )
        )
        handler._send_json(
            HTTPStatus.INTERNAL_SERVER_ERROR,
            {"error": "Internal server error"},
        )
        return

    filename = payload.get("filename") or "file.bin"
    file_path = handler.context.storage.save_session_file(session_id, filename, file_bytes)
    handler.context.export_manager.export_path(
        "scanned",
        file_path,
        filename=file_path.name,
        timestamp=payload.get("completedAt"),
    )
    _finalize_scan_completion(
        handler,
        session_id=session_id,
        file_path=file_path,
        mime_type=payload.get("mimeType"),
        file_size=int(payload.get("fileSize") or len(file_bytes)),
        duration=payload.get("duration"),
        total_chunks=payload.get("totalChunks"),
        chunks_completed=payload.get("chunksCompleted"),
        completed_at=payload.get("completedAt"),
        device_id=payload.get("deviceId"),
        device_name=payload.get("deviceName"),
    )
