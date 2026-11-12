"""Canonical scan session state payload builder."""

from __future__ import annotations

from datetime import datetime, timezone
import math
from typing import Any, Dict, List, Optional


def _as_int(value: Any, default: int = 0) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(0, parsed)


def _optional_int(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _max_counter(*values: Any) -> int:
    return max((_as_int(value, 0) for value in values), default=0)


def _session_dict(session: Any) -> Dict[str, Any]:
    if session is None:
        return {}
    if isinstance(session, dict):
        return dict(session)
    if hasattr(session, "get_state_dict"):
        state = session.get_state_dict()
        if isinstance(state, dict):
            return state
    return {}


def _normalize_missing_ranges(value: Any) -> List[List[int]]:
    if not isinstance(value, list):
        return []

    ranges: List[List[int]] = []
    for entry in value:
        if not isinstance(entry, (list, tuple)) or len(entry) != 2:
            continue
        start = _optional_int(entry[0])
        end = _optional_int(entry[1])
        if start is None or end is None or end < start:
            continue
        ranges.append([start, end])
    return ranges


def _missing_count(
    *,
    received: int,
    threshold: Optional[int],
    total_packets: Optional[int],
    missing_ranges: List[List[int]],
) -> Optional[int]:
    if missing_ranges:
        return sum((end - start + 1) for start, end in missing_ranges)
    if threshold is not None:
        return max(threshold - received, 0)
    if total_packets is not None:
        return max(total_packets - received, 0)
    return None


def _range_count(ranges: List[List[int]]) -> Optional[int]:
    if not ranges:
        return None
    return sum((end - start + 1) for start, end in ranges)


def _build_chunk(
    raw: Dict[str, Any],
    *,
    fallback_threshold: Optional[int],
    fallback_total_packets: Optional[int],
    fallback_total_packets_exact: bool,
) -> Dict[str, Any]:
    received = _max_counter(
        raw.get("receivedUnique"),
        raw.get("receivedCount"),
        raw.get("receivedPackets"),
        raw.get("packetCount"),
    )
    threshold = (
        _optional_int(raw.get("decodeThreshold"))
        or _optional_int(raw.get("expectedPackets"))
        or fallback_threshold
    )
    raw_total_packets = _optional_int(raw.get("totalPackets"))
    total_packets = (
        raw_total_packets if raw_total_packets is not None else fallback_total_packets
    )
    total_packets_exact = (
        bool(raw.get("totalPacketsExact"))
        if "totalPacketsExact" in raw
        else fallback_total_packets_exact and raw_total_packets is None
    )
    missing_ranges = _normalize_missing_ranges(
        raw.get("missingRanges") if "missingRanges" in raw else raw.get("missing")
    )
    missing_count = _missing_count(
        received=received,
        threshold=threshold,
        total_packets=total_packets,
        missing_ranges=missing_ranges,
    )
    target_frame_ranges = _normalize_missing_ranges(raw.get("targetFrameRanges"))
    raw_target_frame_count = _optional_int(raw.get("targetFrameCount"))
    target_frame_count = (
        raw_target_frame_count
        if raw_target_frame_count is not None
        else _range_count(target_frame_ranges)
    )
    unseen_frame_count = _optional_int(raw.get("unseenFrameCount"))
    unseen_frame_ranges = _normalize_missing_ranges(raw.get("unseenFrameRanges"))

    raw_state = raw.get("state")
    if raw_state == "failed":
        state = "failed"
    elif total_packets_exact and total_packets is not None and received >= total_packets:
        state = "complete"
        missing_count = 0
        missing_ranges = []
        target_frame_count = 0
        target_frame_ranges = []
        unseen_frame_count = 0
        unseen_frame_ranges = []
    elif threshold is not None and received >= threshold:
        state = "threshold_reached"
    elif received > 0:
        state = "scanning"
    else:
        state = "missing"

    return {
        "chunkId": _as_int(raw.get("chunkId"), 0),
        "receivedUnique": received,
        "decodeThreshold": threshold,
        "totalPackets": total_packets,
        "totalPacketsExact": total_packets_exact,
        "state": state,
        "missingCount": missing_count,
        "missingRanges": missing_ranges,
        "targetFrameCount": target_frame_count,
        "targetFrameRanges": target_frame_ranges,
        "unseenFrameCount": unseen_frame_count,
        "unseenFrameRanges": unseen_frame_ranges,
    }


def _allows_single_chunk_fallback(
    raw_chunks: Any, chunks_total: Optional[int]
) -> bool:
    if chunks_total != 1 or not isinstance(raw_chunks, list):
        return False

    chunk_ids: set[int] = set()
    for raw_chunk in raw_chunks:
        if not isinstance(raw_chunk, dict):
            continue
        if "chunkId" not in raw_chunk or raw_chunk.get("chunkId") in (None, ""):
            chunk_id = 0
        else:
            chunk_id = _optional_int(raw_chunk.get("chunkId"))
            if chunk_id is None:
                return False
        chunk_ids.add(chunk_id)

    return chunk_ids == {0}


def _normalize_chunks(
    raw_chunks: Any,
    *,
    chunks_total: Optional[int],
    fallback_threshold: Optional[int],
    fallback_total_packets: Optional[int],
    fallback_total_packets_exact: bool,
) -> List[Dict[str, Any]]:
    chunks_by_id: Dict[int, Dict[str, Any]] = {}

    if isinstance(raw_chunks, list):
        for raw_chunk in raw_chunks:
            if not isinstance(raw_chunk, dict):
                continue
            chunk = _build_chunk(
                raw_chunk,
                fallback_threshold=fallback_threshold,
                fallback_total_packets=fallback_total_packets,
                fallback_total_packets_exact=fallback_total_packets_exact,
            )
            chunks_by_id[chunk["chunkId"]] = chunk

    effective_chunks_total = _effective_chunks_total(
        chunks_total, list(chunks_by_id.values())
    )
    if effective_chunks_total is not None:
        for chunk_id in range(effective_chunks_total):
            if chunk_id not in chunks_by_id:
                chunks_by_id[chunk_id] = _build_chunk(
                    {"chunkId": chunk_id},
                    fallback_threshold=fallback_threshold,
                    fallback_total_packets=fallback_total_packets,
                    fallback_total_packets_exact=fallback_total_packets_exact,
                )

    return [chunks_by_id[chunk_id] for chunk_id in sorted(chunks_by_id)]


def _effective_chunks_total(
    chunks_total: Optional[int], chunks: List[Dict[str, Any]]
) -> Optional[int]:
    if chunks_total is None and not chunks:
        return None

    observed_count = max(
        (_as_int(chunk.get("chunkId"), 0) + 1 for chunk in chunks), default=0
    )
    return max(chunks_total or 0, len(chunks), observed_count)


def _normalize_assembly(assembly: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    raw = assembly or {}
    return {
        "inProgress": bool(raw.get("inProgress") or raw.get("in_progress")),
        "attempts": _as_int(raw.get("attempts"), 0),
        "lastAttemptAt": raw.get("lastAttemptAt") or raw.get("last_attempt_at"),
        "lastError": raw.get("lastError") or raw.get("last_error"),
    }


def _file_available(session: Dict[str, Any]) -> bool:
    return bool(session.get("completed")) and bool(session.get("filePath"))


def _decode_state(
    *,
    status: str,
    received: int,
    threshold: Optional[int],
    file_available: bool,
    assembly: Dict[str, Any],
) -> str:
    if file_available:
        return "complete"
    if status == "failed":
        return "failed"
    if assembly["inProgress"]:
        return "assembling"
    if assembly["lastError"] and threshold is not None and received >= threshold:
        return "decode_pending"
    if threshold is not None and received >= threshold:
        return "threshold_reached"
    return "scanning"


def _completion_percent(
    *,
    received: int,
    threshold: Optional[int],
    total_packets: Optional[int],
    file_available: bool,
) -> int | float:
    if file_available:
        return 100

    denominator = threshold or total_packets
    if denominator is None or denominator <= 0:
        return 0

    percent = min(99.9, max(0.0, (received / denominator) * 100))
    percent = math.floor(percent * 10) / 10
    return int(percent) if percent.is_integer() else percent


def _chunk_threshold_progress(
    chunks: List[Dict[str, Any]],
    chunks_total: Optional[int],
) -> Optional[Dict[str, int]]:
    if chunks_total is None or chunks_total <= 1 or len(chunks) < chunks_total:
        return None

    threshold = 0
    capped_received = 0
    for chunk in chunks:
        chunk_threshold = _optional_int(chunk.get("decodeThreshold"))
        if chunk_threshold is None or chunk_threshold <= 0:
            return None
        received = _as_int(chunk.get("receivedUnique"), 0)
        threshold += chunk_threshold
        capped_received += min(received, chunk_threshold)

    if threshold <= 0:
        return None

    return {
        "received": capped_received,
        "threshold": threshold,
    }


def build_scan_session_state(
    session_id: str,
    session: Any,
    *,
    state_version: Optional[int] = None,
    assembly: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Build the canonical server-owned scan-session-state payload."""
    meta = _session_dict(session)
    assembly_state = _normalize_assembly(assembly)
    received = _max_counter(
        meta.get("receivedUnique"),
        meta.get("receivedCount"),
        meta.get("receivedPackets"),
        meta.get("packetCount"),
    )
    threshold = (
        _optional_int(meta.get("decodeThreshold"))
        or _optional_int(meta.get("expectedPackets"))
        or _optional_int(meta.get("totalExpected"))
    )
    total_packets = _optional_int(meta.get("totalPackets"))
    chunks_total = _optional_int(meta.get("chunksTotal")) or _optional_int(
        meta.get("totalChunks")
    )
    raw_chunks = meta.get("chunks") if "chunks" in meta else meta.get("chunkStates")
    file_available = _file_available(meta)
    single_chunk_fallback = _allows_single_chunk_fallback(raw_chunks, chunks_total)
    fallback_total_packets = (
        total_packets
        if single_chunk_fallback
        and file_available
        and bool(meta.get("totalPacketsExact"))
        else None
    )
    chunks = _normalize_chunks(
        raw_chunks,
        chunks_total=chunks_total,
        fallback_threshold=threshold if single_chunk_fallback else None,
        fallback_total_packets=fallback_total_packets,
        fallback_total_packets_exact=fallback_total_packets is not None,
    )
    effective_chunks_total = _effective_chunks_total(chunks_total, chunks)
    if file_available:
        chunks = [
            {
                **chunk,
                "state": "complete",
                "missingCount": 0,
                "missingRanges": [],
                "targetFrameCount": 0,
                "targetFrameRanges": [],
                "unseenFrameCount": 0,
                "unseenFrameRanges": [],
            }
            for chunk in chunks
        ]
        chunks_complete = (
            effective_chunks_total if effective_chunks_total is not None else len(chunks)
        )
        chunks_missing = 0
    else:
        chunks_complete = sum(1 for chunk in chunks if chunk["state"] == "complete")
        chunks_non_complete = sum(1 for chunk in chunks if chunk["state"] != "complete")
        if effective_chunks_total is not None:
            chunks_missing = max(
                effective_chunks_total - chunks_complete, chunks_non_complete
            )
        else:
            chunks_missing = None

    raw_status = str(meta.get("status") or "active")
    if file_available:
        status = "complete"
    elif raw_status == "failed":
        status = "failed"
    else:
        status = "active"

    chunk_threshold_progress = (
        None
        if file_available
        else _chunk_threshold_progress(chunks, effective_chunks_total)
    )
    progress_received = (
        chunk_threshold_progress["received"]
        if chunk_threshold_progress is not None
        else received
    )
    progress_threshold = (
        chunk_threshold_progress["threshold"]
        if chunk_threshold_progress is not None
        else threshold
    )

    decode_state = _decode_state(
        status=status,
        received=progress_received,
        threshold=progress_threshold,
        file_available=file_available,
        assembly=assembly_state,
    )

    return {
        "type": "scan-session-state",
        "stateVersion": _as_int(
            state_version if state_version is not None else meta.get("stateVersion"),
            0,
        ),
        "sessionId": session_id,
        "status": status,
        "updatedAt": meta.get("updatedAt") or _iso_now(),
        "filename": meta.get("filename"),
        "receivedUnique": received,
        "decodeThreshold": threshold,
        "totalPackets": total_packets,
        "totalPacketsExact": bool(meta.get("totalPacketsExact")),
        "completionPercent": _completion_percent(
            received=progress_received,
            threshold=progress_threshold,
            total_packets=total_packets,
            file_available=file_available,
        ),
        "decodeState": decode_state,
        "isComplete": file_available,
        "fileAvailable": file_available,
        "chunksTotal": effective_chunks_total,
        "chunksComplete": chunks_complete,
        "chunksMissing": chunks_missing,
        "chunks": chunks,
        "assembly": assembly_state,
    }
