from __future__ import annotations

import base64
import json
import logging
from datetime import datetime, timezone
from email.utils import format_datetime
from http import HTTPStatus
from pathlib import Path
from typing import TYPE_CHECKING, Any, Optional
from urllib.parse import parse_qs, quote, urlparse

from .packet_assembler import WS_BINARY_ENCODING
from .handler_http import sanitize_request_body_error_message
from .scan_session_state import build_scan_session_state
from .sqlite_storage import SqliteStorage
from .storage import Storage
from .utils import (
    build_history_etag,
    get_entry_datetime,
    parse_bool,
    parse_iso_datetime,
    parse_limit,
    safe_filename,
    safe_history_id,
    utc_now,
)
from .ws_scan_handler import (
    _discard_live_session_states,
    _extract_stored_packet_chunk_transport_metadata,
    _extract_stored_packet_identity_from_entry,
    _list_stored_packet_entries,
    _serialized_session_delete,
    _serialized_session_commit,
)
from .ws_scan_session import (
    ScanSessionState,
    reconstruct_packets_by_chunk_from_chunk_states,
)

if TYPE_CHECKING:
    from .handler import SyncRequestHandler

logger = logging.getLogger(__name__)

PACKET_PAGE_CONTENT_TYPE = "application/vnd.airqr.packet-page"
PACKET_PAGE_MAGIC = b"AQPK"
PACKET_PAGE_VERSION = 1
HISTORY_ITEM_FILE_BASE64_REMOVED_ERROR = (
    "Legacy JSON fileBase64 uploads are no longer supported; "
    "send the file as a binary request body instead"
)
HISTORY_ITEM_BINARY_UPLOAD_REQUIRED_ERROR = (
    "Generated history uploads must use a binary request body"
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


def _extract_stored_packet_total_chunks(packet: bytes) -> Optional[int]:
    if not isinstance(packet, bytes) or len(packet) < 13:
        return None

    mode = packet[0]
    if mode not in (1, 2):
        return None

    return int.from_bytes(packet[9:13], "big", signed=False)


def _count_stored_packets(
    storage: Storage | SqliteStorage,
    session_id: str,
) -> Optional[int]:
    try:
        return int(storage.count_packets(session_id))
    except Exception:
        return None


def _augment_session_with_chunk_states(
    session_id: str,
    session: Optional[dict[str, Any]],
    storage: Storage | SqliteStorage,
) -> dict[str, Any]:
    enriched = dict(session or {})
    stored_packet_entries = _list_stored_packet_entries(storage, session_id)

    packets_by_chunk: dict[int, set[int]] = {}
    observed_total_chunks = 0
    for packet_name, packet in stored_packet_entries:
        try:
            chunk_id, packet_index = _extract_stored_packet_identity_from_entry(
                packet,
                packet_name,
            )
        except Exception as exc:
            logger.debug(
                "Failed to parse stored packet identity for session %s: %s",
                session_id,
                exc,
            )
            continue

        packets_by_chunk.setdefault(chunk_id, set()).add(packet_index)
        total_chunks = _extract_stored_packet_total_chunks(packet)
        if total_chunks is not None:
            observed_total_chunks = max(observed_total_chunks, total_chunks)

    if not packets_by_chunk:
        return enriched

    state = ScanSessionState(session_id)
    state.set_metadata(
        filename=enriched.get("filename"),
        mime_type=enriched.get("mimeType"),
        file_size=_parse_optional_int(enriched.get("size")),
        expected_packets=_parse_optional_int(enriched.get("expectedPackets")),
        total_packets=_parse_optional_int(enriched.get("totalPackets")),
        total_packets_exact=enriched.get("totalPacketsExact"),
        total_chunks=_parse_optional_int(enriched.get("totalChunks")),
        packet_size=_parse_optional_int(enriched.get("packetSize")),
    )
    for _packet_name, packet in stored_packet_entries:
        try:
            chunk_meta = _extract_stored_packet_chunk_transport_metadata(packet)
        except Exception as exc:
            logger.debug(
                "Failed to parse stored packet transport metadata for session %s: %s",
                session_id,
                exc,
            )
            chunk_meta = None
        if chunk_meta is not None:
            state.observe_chunk_transport_metadata(
                chunk_meta["chunkId"],
                expected_packets=chunk_meta.get("expectedPackets"),
                total_packets=chunk_meta.get("exactChunkPackets"),
                total_chunks=chunk_meta.get("totalChunks"),
            )
    state.hydrate_chunk_packets(packets_by_chunk)
    enriched["chunkStates"] = state.get_chunk_states()
    enriched["receivedCount"] = state.received_count
    enriched["receivedPackets"] = state.received_count
    enriched["packetCount"] = state.received_count
    enriched["lastContiguous"] = state.last_contiguous
    if not enriched.get("totalChunks") and observed_total_chunks > 0:
        enriched["totalChunks"] = observed_total_chunks
    if state.total_packets is not None:
        enriched["expectedPackets"] = int(state.total_packets)
    if state.reported_total_packets is not None:
        enriched["totalPackets"] = int(state.reported_total_packets)
    if state.total_packets_exact:
        enriched["totalPacketsExact"] = True

    return enriched


def _augment_session_with_live_state(
    session: Optional[dict[str, Any]],
    live_session: ScanSessionState,
) -> dict[str, Any]:
    enriched = dict(session or {})
    live_state = live_session.get_state_dict()
    live_received_count = _parse_optional_int(live_state.get("receivedCount")) or 0

    enriched["chunkStates"] = live_state.get("chunkStates") or []
    enriched["receivedCount"] = live_received_count
    enriched["receivedPackets"] = live_received_count
    enriched["packetCount"] = live_received_count
    enriched["lastContiguous"] = _parse_optional_int(live_state.get("lastContiguous")) or -1

    if live_session.total_packets is not None:
        enriched["expectedPackets"] = int(live_session.total_packets)
    if live_session.reported_total_packets is not None:
        enriched["totalPackets"] = int(live_session.reported_total_packets)
    if live_state.get("totalPacketsExact") is not None:
        enriched["totalPacketsExact"] = bool(live_state.get("totalPacketsExact"))
    if live_session.total_chunks is not None:
        enriched["totalChunks"] = int(live_session.total_chunks)
    if live_session.packet_size is not None:
        enriched["packetSize"] = int(live_session.packet_size)
    if live_session.filename:
        enriched["filename"] = live_session.filename
    if live_session.mime_type:
        enriched["mimeType"] = live_session.mime_type
    if live_session.file_size is not None:
        enriched["size"] = int(live_session.file_size)
    if live_session.producer_device_id:
        enriched["deviceId"] = live_session.producer_device_id
        enriched["producerDeviceId"] = live_session.producer_device_id

    return enriched


def _attach_canonical_scan_state(
    session_id: str,
    session: dict[str, Any],
    live_session: Optional[ScanSessionState] = None,
) -> dict[str, Any]:
    enriched = dict(session)
    state_version = live_session.state_version if live_session is not None else None
    assembly = live_session.get_assembly_snapshot() if live_session is not None else None
    canonical = build_scan_session_state(
        session_id,
        enriched,
        state_version=state_version,
        assembly=assembly,
    )
    enriched["scanState"] = canonical
    enriched["receivedUnique"] = canonical["receivedUnique"]
    enriched["decodeState"] = canonical["decodeState"]
    enriched["decodeThreshold"] = canonical["decodeThreshold"]
    enriched["completionPercent"] = canonical["completionPercent"]
    enriched["fileAvailable"] = canonical["fileAvailable"]
    enriched["chunksMissing"] = canonical["chunksMissing"]
    enriched["chunksComplete"] = canonical["chunksComplete"]
    enriched["chunks"] = canonical["chunks"]
    return enriched


def _read_live_scan_session(
    handler: "SyncRequestHandler",
    session_id: str,
) -> Optional[ScanSessionState]:
    session_store = getattr(getattr(handler, "server", None), "scan_session_store", None)
    if session_store is None:
        return None

    try:
        return session_store.get(session_id)
    except Exception as exc:
        logger.debug("Failed to read live scan session %s: %s", session_id, exc)
        return None


def _should_reconstruct_chunk_states(session: dict[str, Any]) -> bool:
    if isinstance(session.get("chunkStates"), list):
        return False
    return _should_reconcile_with_stored_packets(session)


def _should_reconcile_with_stored_packets(session: dict[str, Any]) -> bool:
    persisted_chunk_packets = reconstruct_packets_by_chunk_from_chunk_states(
        session.get("chunkStates")
    )
    if persisted_chunk_packets and any(persisted_chunk_packets.values()):
        return False
    if bool(session.get("isStreaming")):
        return True
    total_chunks = _parse_optional_int(session.get("totalChunks")) or 0
    return total_chunks > 1


def _augment_history_scan_session(
    handler: "SyncRequestHandler",
    session: dict[str, Any],
) -> dict[str, Any]:
    session_id = session.get("sessionId") or session.get("id")
    if not isinstance(session_id, str) or len(session_id) == 0:
        return session
    if bool(session.get("completed")):
        return _attach_canonical_scan_state(session_id, session)

    live_session = _read_live_scan_session(handler, session_id)
    if live_session is not None:
        live_enriched = _augment_session_with_live_state(session, live_session)
        live_received_count = _parse_optional_int(live_enriched.get("receivedCount")) or 0
        durable_packet_count = _count_stored_packets(handler.context.storage, session_id) or 0
        should_prefer_durable_packets = (
            durable_packet_count > 0 and durable_packet_count != live_received_count
        )
        if (
            should_prefer_durable_packets
            or _should_reconcile_with_stored_packets(session)
            or _should_reconcile_with_stored_packets(live_enriched)
        ):
            return _attach_canonical_scan_state(
                session_id,
                _augment_session_with_chunk_states(
                    session_id,
                    live_enriched,
                    handler.context.storage,
                ),
                live_session,
            )
        return _attach_canonical_scan_state(session_id, live_enriched, live_session)
    if _should_reconstruct_chunk_states(session):
        return _attach_canonical_scan_state(
            session_id,
            _augment_session_with_chunk_states(
                session_id,
                session,
                handler.context.storage,
            ),
        )
    return _attach_canonical_scan_state(session_id, session)


def _encode_binary_packet_page(offset: int, total_count: int, packets: list[bytes]) -> bytes:
    parts = [
        PACKET_PAGE_MAGIC,
        bytes([PACKET_PAGE_VERSION]),
        int(offset).to_bytes(4, "big", signed=False),
        len(packets).to_bytes(4, "big", signed=False),
        int(total_count).to_bytes(4, "big", signed=False),
    ]
    for packet in packets:
        parts.append(len(packet).to_bytes(4, "big", signed=False))
        parts.append(packet)
    return b"".join(parts)


def _stream_download_response(
    handler: "SyncRequestHandler",
    *,
    file_path: Path,
    filename: str,
    original_filename: str,
    mime_type: str,
) -> None:
    file_size = file_path.stat().st_size
    handler.send_response(HTTPStatus.OK)
    handler.send_header("Content-Type", mime_type)
    handler.send_header(
        "Content-Disposition",
        f"attachment; filename=\"{filename}\"; filename*=UTF-8''{quote(original_filename)}",
    )
    handler.send_header("Content-Length", str(file_size))
    handler.end_headers()
    with open(file_path, "rb") as file_obj:
        while True:
            chunk = file_obj.read(65536)
            if not chunk:
                break
            handler.wfile.write(chunk)


def _apply_history_response(
    handler: "SyncRequestHandler",
    entries: list[dict[str, Any]],
    *,
    total_count: int | None = None,
) -> None:
    etag, latest_dt = build_history_etag(entries)
    if latest_dt and latest_dt.tzinfo is None:
        latest_dt = latest_dt.replace(tzinfo=timezone.utc)

    if handler.headers.get("If-None-Match") == etag:
        handler.send_response(HTTPStatus.NOT_MODIFIED)
        handler.send_header("ETag", etag)
        if latest_dt:
            handler.send_header("Last-Modified", format_datetime(latest_dt))
        handler.send_header("Cache-Control", "no-cache")
        handler.end_headers()
        return

    headers = {
        "ETag": etag,
        "Cache-Control": "no-cache",
        "X-Total-Count": str(len(entries) if total_count is None else total_count),
    }
    if latest_dt:
        headers["Last-Modified"] = format_datetime(latest_dt)

    handler._send_json(HTTPStatus.OK, entries, headers)


def handle_scan_history(handler: "SyncRequestHandler") -> None:
    if not handler._require_auth():
        return
    parsed = urlparse(handler.path)
    params = parse_qs(parsed.query)
    limit = parse_limit((params.get("limit") or [None])[0], default=0)
    include_incomplete = parse_bool(
        (params.get("includeIncomplete") or [None])[0],
        True,
    )
    completed_raw = (params.get("completed") or [None])[0]
    since_raw = (params.get("since") or [None])[0]
    since_dt = parse_iso_datetime(since_raw) if isinstance(since_raw, str) else None
    if since_dt and since_dt.tzinfo is None:
        since_dt = since_dt.replace(tzinfo=timezone.utc)

    entries = []
    for entry in handler.context.storage.list_sessions():
        session_id = entry.get("sessionId")
        entry["id"] = session_id
        entry["origin"] = "scanned"
        entry = _augment_history_scan_session(handler, entry)
        entries.append(entry)

    if not include_incomplete:
        entries = [entry for entry in entries if entry.get("completed")]
    if isinstance(completed_raw, str):
        normalized_completed = completed_raw.strip().lower()
        if normalized_completed in ("0", "false", "no", "off"):
            entries = [entry for entry in entries if not entry.get("completed")]
        elif normalized_completed in ("1", "true", "yes", "on"):
            entries = [entry for entry in entries if entry.get("completed")]
    if since_dt:
        entries = [
            entry
            for entry in entries
            if (get_entry_datetime(entry) or datetime.min.replace(tzinfo=timezone.utc))
            >= since_dt
        ]
    entries.sort(key=lambda entry: entry.get("updatedAt", ""), reverse=True)
    total_count = len(entries)
    if limit:
        entries = entries[:limit]

    _apply_history_response(handler, entries, total_count=total_count)


def handle_history_all(handler: "SyncRequestHandler") -> None:
    if not handler._require_auth():
        return
    parsed = urlparse(handler.path)
    params = parse_qs(parsed.query)
    limit = parse_limit((params.get("limit") or [None])[0], default=0)
    origin_filter = (params.get("origin") or [None])[0]
    origin_filter = origin_filter.lower() if isinstance(origin_filter, str) else None
    include_incomplete = parse_bool(
        (params.get("includeIncomplete") or [None])[0],
        True,
    )
    since_raw = (params.get("since") or [None])[0]
    since_dt = parse_iso_datetime(since_raw) if isinstance(since_raw, str) else None
    if since_dt and since_dt.tzinfo is None:
        since_dt = since_dt.replace(tzinfo=timezone.utc)

    entries: list[dict[str, Any]] = []
    for entry in handler.context.storage.list_sessions():
        session_id = entry.get("sessionId")
        entry["id"] = session_id
        entry["origin"] = "scanned"
        entry = _augment_history_scan_session(handler, entry)
        entries.append(entry)
    for entry in handler.context.storage.list_history_items():
        history_id = entry.get("historyId")
        entry["id"] = history_id
        entry["origin"] = "generated"
        entries.append(entry)

    if origin_filter in ("scanned", "generated"):
        entries = [entry for entry in entries if entry.get("origin") == origin_filter]
    if not include_incomplete:
        entries = [
            entry
            for entry in entries
            if entry.get("origin") != "scanned" or entry.get("completed")
        ]
    if since_dt:
        entries = [
            entry
            for entry in entries
            if (get_entry_datetime(entry) or datetime.min.replace(tzinfo=timezone.utc))
            >= since_dt
        ]
    entries.sort(
        key=lambda entry: entry.get("updatedAt") or entry.get("createdAt") or "",
        reverse=True,
    )
    total_count = len(entries)
    if limit:
        entries = entries[:limit]

    _apply_history_response(handler, entries, total_count=total_count)


def handle_packets(handler: "SyncRequestHandler", session_id: str) -> None:
    if not handler._require_auth():
        return

    parsed = urlparse(handler.path)
    params = parse_qs(parsed.query)
    response_format = (_first_query_value(params, "format") or "json").strip().lower()

    def _parse_non_negative_int(name: str) -> int:
        value = _first_query_value(params, name)
        if value in (None, ""):
            return 0
        try:
            parsed_value = int(value)
        except (TypeError, ValueError):
            raise ValueError(f"Invalid {name}") from None
        if parsed_value < 0:
            raise ValueError(f"Invalid {name}")
        return parsed_value

    def _parse_positive_int(name: str) -> Optional[int]:
        value = _first_query_value(params, name)
        if value in (None, ""):
            return None
        try:
            parsed_value = int(value)
        except (TypeError, ValueError):
            raise ValueError(f"Invalid {name}") from None
        if parsed_value <= 0:
            raise ValueError(f"Invalid {name}")
        return parsed_value

    try:
        offset = _parse_non_negative_int("offset")
        limit = _parse_positive_int("limit")
    except ValueError as exc:
        handler._send_json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        return

    total_count = handler.context.storage.count_packets(session_id)
    packets = handler.context.storage.list_packets_page(session_id, offset, limit)

    if packets is None:
        handler._send_json(HTTPStatus.NOT_FOUND, {"error": "Packets not found"})
        return

    safe_total_count = total_count if total_count > 0 else len(packets)
    if response_format == "binary":
        payload = _encode_binary_packet_page(offset, safe_total_count, packets)
        handler._send_bytes(
            HTTPStatus.OK,
            payload,
            PACKET_PAGE_CONTENT_TYPE,
            {"Cache-Control": "no-store"},
        )
        return

    packets_b64 = [base64.b64encode(packet).decode("ascii") for packet in packets]
    session = handler.context.storage.read_session(session_id) or {}
    payload = {
        "sessionId": session_id,
        "packetCount": len(packets_b64),
        "offset": offset,
        "totalCount": safe_total_count,
        "packets": packets_b64,
        "meta": {
            "filename": session.get("filename"),
            "totalChunks": session.get("totalChunks"),
            "chunksCompleted": session.get("chunksCompleted"),
            "receivedPackets": session.get("receivedPackets"),
            "expectedPackets": session.get("expectedPackets"),
            "totalPackets": session.get("totalPackets"),
        },
    }
    handler._send_json(HTTPStatus.OK, payload)


def handle_history_item_download(handler: "SyncRequestHandler", history_id: str) -> None:
    if not handler._require_auth():
        return
    item = handler.context.storage.read_history_item(history_id)
    if not item:
        handler._send_json(HTTPStatus.NOT_FOUND, {"error": "Item not found"})
        return
    file_rel = item.get("filePath")
    if not file_rel:
        handler._send_json(HTTPStatus.NOT_FOUND, {"error": "File not found"})
        return
    try:
        file_path = handler.context.storage.resolve_relative_path(file_rel)
    except ValueError:
        handler._send_json(HTTPStatus.NOT_FOUND, {"error": "File not found"})
        return
    if not file_path.exists():
        handler._send_json(HTTPStatus.NOT_FOUND, {"error": "File missing"})
        return

    _stream_download_response(
        handler,
        file_path=file_path,
        filename=safe_filename(item.get("filename", file_path.name)),
        original_filename=item.get("filename", file_path.name),
        mime_type=item.get("mimeType", "application/octet-stream"),
    )


def handle_history_item(handler: "SyncRequestHandler") -> None:
    if not handler._require_auth():
        return
    content_type = (handler.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
    file_path: Path
    item: dict[str, Any]

    if content_type and content_type != "application/json":
        parsed = urlparse(handler.path)
        params = parse_qs(parsed.query)
        history_id = _first_query_value(params, "historyId") or _first_query_value(params, "id")
        if not isinstance(history_id, str) or not safe_history_id(history_id):
            handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid historyId"})
            return

        payload_name = (
            _first_query_value(params, "filename")
            or _first_query_value(params, "title")
            or "file.bin"
        )
        storage = handler.context.storage
        safe_name = safe_filename(payload_name)
        file_path = storage.history_file_path(history_id, safe_name)
        try:
            file_size = handler._stream_request_body_to_file(file_path)
        except ValueError as exc:
            handler._send_json(
                HTTPStatus.BAD_REQUEST,
                {"error": sanitize_request_body_error_message(exc)},
            )
            return
        except Exception:
            logger.exception("Failed to store streamed history item %s", history_id)
            handler._send_json(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                {"error": "Internal server error"},
            )
            return

        chunk_min_frames_raw = _first_query_value(params, "chunkMinFrames")
        chunk_min_frames = None
        if chunk_min_frames_raw is not None:
            try:
                parsed_chunk_frames = json.loads(chunk_min_frames_raw)
            except json.JSONDecodeError:
                handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid chunkMinFrames"})
                return
            if parsed_chunk_frames is not None and not isinstance(parsed_chunk_frames, list):
                handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid chunkMinFrames"})
                return
            chunk_min_frames = parsed_chunk_frames

        item = handler.context.storage.read_history_item(history_id) or {}
        item["historyId"] = history_id
        item["origin"] = "generated"
        item["title"] = _first_query_value(params, "title") or file_path.name
        item["filename"] = file_path.name
        item["mimeType"] = (
            _first_query_value(params, "mimeType")
            or content_type
            or "application/octet-stream"
        )
        item["size"] = file_size
        item.setdefault("createdAt", _first_query_value(params, "createdAt") or utc_now())
        item["updatedAt"] = _first_query_value(params, "updatedAt") or utc_now()
        total_frames = _parse_optional_int(_first_query_value(params, "totalFrames"))
        min_frames = _parse_optional_int(_first_query_value(params, "minFrames"))
        if total_frames is not None:
            item["totalFrames"] = total_frames
        if min_frames is not None:
            item["minFrames"] = min_frames
        if chunk_min_frames is not None:
            item["chunkMinFrames"] = chunk_min_frames
    else:
        payload = handler._read_json()
        if not payload:
            handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON"})
            return
        history_id = payload.get("historyId") or payload.get("id")
        if not isinstance(history_id, str) or not safe_history_id(history_id):
            handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid historyId"})
            return
        if "fileBase64" in payload:
            handler._send_json(
                HTTPStatus.BAD_REQUEST,
                {"error": HISTORY_ITEM_FILE_BASE64_REMOVED_ERROR},
            )
            return
        handler._send_json(
            HTTPStatus.BAD_REQUEST,
            {"error": HISTORY_ITEM_BINARY_UPLOAD_REQUIRED_ERROR},
        )
        return

    handler.context.export_manager.export_path(
        "generated",
        file_path,
        filename=file_path.name,
        timestamp=item.get("createdAt"),
    )

    try:
        item["filePath"] = str(file_path.relative_to(handler.context.storage.base_dir))
    except ValueError:
        item["filePath"] = str(file_path)

    handler.context.storage.write_history_item(history_id, item)
    handler._emit_event(
        "history",
        {
            "type": "history-item",
            "origin": "generated",
            "historyId": history_id,
            "updatedAt": item.get("updatedAt"),
        },
    )
    handler._send_json(HTTPStatus.OK, {"ok": True})


def handle_delete_history_item(handler: "SyncRequestHandler", history_id: str) -> None:
    if not handler._require_auth():
        return
    if not handler.context.storage.delete_history_item(history_id):
        handler._send_json(HTTPStatus.NOT_FOUND, {"error": "Item not found"})
        return
    delete_payload = {"origin": "generated", "historyId": history_id}
    handler._emit_event("delete", delete_payload)
    handler._emit_history_event({"type": "delete", **delete_payload})
    handler._send_json(HTTPStatus.OK, {"ok": True})


def handle_file_download(handler: "SyncRequestHandler", session_id: str) -> None:
    if not handler._require_auth():
        return
    session = handler.context.storage.read_session(session_id)
    if not session:
        handler._send_json(HTTPStatus.NOT_FOUND, {"error": "Session not found"})
        return
    file_rel = session.get("filePath")
    if not file_rel:
        handler._send_json(HTTPStatus.NOT_FOUND, {"error": "File not found"})
        return
    try:
        file_path = handler.context.storage.resolve_relative_path(file_rel)
    except ValueError:
        handler._send_json(HTTPStatus.NOT_FOUND, {"error": "File not found"})
        return
    if not file_path.exists():
        handler._send_json(HTTPStatus.NOT_FOUND, {"error": "File missing"})
        return

    _stream_download_response(
        handler,
        file_path=file_path,
        filename=safe_filename(session.get("filename", file_path.name)),
        original_filename=session.get("filename", file_path.name),
        mime_type=session.get("mimeType", "application/octet-stream"),
    )


def handle_delete_session(handler: "SyncRequestHandler", session_id: str) -> None:
    """Delete after any packet commit already in flight for this session."""
    if not handler._require_auth():
        return
    with _serialized_session_delete(session_id) as lifecycle:
        deleted = handler.context.storage.delete_session(session_id)
        if deleted:
            lifecycle.mark_deleted()
            _discard_live_session_states(handler.context.storage, session_id)
            session_store = getattr(
                getattr(handler, "server", None), "scan_session_store", None
            )
            if session_store is not None:
                session_store.remove(session_id)
    if not deleted:
        handler._send_json(HTTPStatus.NOT_FOUND, {"error": "Session not found"})
        return
    delete_payload = {"origin": "scanned", "sessionId": session_id}
    handler._emit_event("delete", delete_payload)
    handler._emit_history_event({"type": "delete", **delete_payload})
    handler._send_json(HTTPStatus.OK, {"ok": True})


def handle_session_info(handler: "SyncRequestHandler", session_id: str) -> None:
    if not handler._require_auth():
        return
    session = handler.context.storage.read_session(session_id)
    if not session:
        handler._send_json(HTTPStatus.NOT_FOUND, {"error": "Session not found"})
        return
    live_session = None
    session_store = getattr(getattr(handler, "server", None), "scan_session_store", None)
    if session_store is not None:
        try:
            live_session = session_store.get(session_id)
        except Exception as exc:
            logger.debug("Failed to read live scan session %s: %s", session_id, exc)

    if live_session is not None:
        live_enriched = _augment_session_with_live_state(session, live_session)
        live_session_is_chunk_aware = bool(live_session.total_chunks and live_session.total_chunks > 1)
        if (
            _should_reconcile_with_stored_packets(session)
            or _should_reconcile_with_stored_packets(live_enriched)
            or live_session_is_chunk_aware
        ):
            session = _augment_session_with_chunk_states(
                session_id,
                live_enriched,
                handler.context.storage,
            )
        else:
            session = live_enriched
    elif _should_reconstruct_chunk_states(session):
        session = _augment_session_with_chunk_states(
            session_id,
            session,
            handler.context.storage,
        )
    session = _attach_canonical_scan_state(session_id, session, live_session)
    session["sessionId"] = session_id
    session["id"] = session_id
    handler._send_json(HTTPStatus.OK, session)
