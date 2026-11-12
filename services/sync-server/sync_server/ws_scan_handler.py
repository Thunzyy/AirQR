"""WebSocket scan channel handler."""

from __future__ import annotations

import asyncio
import json
import logging
import re
import threading
import weakref
from collections import OrderedDict
from collections.abc import Callable, Mapping
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Dict, Optional
from urllib.parse import parse_qsl, urlsplit

from .auth import client_ip_from_peer
from .packet_assembler import (
    ScanAssemblyError,
    ScanAssemblyUnavailableError,
    WS_BINARY_ENCODING,
    assemble_scan_session_file,
)
from .scan_session_state import build_scan_session_state
from .observability import format_kv_log
from .ws_scan_protocol import (
    PROTOCOL_VERSION,
    DEFAULT_WINDOW_SIZE,
    HEADER_SIZE,
    parse_binary_header,
    compute_crc32,
)
from .ws_scan_session import (
    ScanSessionState,
    ScanSessionStore,
    reconstruct_packets_by_chunk_from_chunk_states,
)
from .ws_auth import strip_cross_origin_cookie_auth
from .utils import compute_hash, utc_now

logger = logging.getLogger(__name__)

STALE_ASSEMBLY_RETRY_AFTER_SECONDS = 60.0

_WS_STORED_PACKET_FILENAME_RE = re.compile(
    r"^packet-([0-9a-fA-F]{4})-([0-9a-fA-F]{8})(?:-.+)?\.bin$"
)
_WS_CANONICAL_PACKET_FILENAME_RE = re.compile(
    r"^packet-[0-9a-fA-F]{4}-[0-9a-fA-F]{8}\.bin$"
)
_MAX_LEGACY_SESSION_INDEXES = 256
_LEGACY_PACKET_INDEX_GUARD = threading.Lock()
_LEGACY_PACKET_INDEXES: weakref.WeakKeyDictionary[
    Any, OrderedDict[str, Dict[tuple[int, int], str]]
] = weakref.WeakKeyDictionary()


class _SessionCommitLock:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.condition = threading.Condition(self.lock)
        self.generation = 0
        self.active_operations = 0
        self.deleting = False


class _SessionCommitLifecycle:
    """A weakly-held session generation captured before waiting for its lock."""

    def __init__(self, holder: _SessionCommitLock, generation: int) -> None:
        self.holder = holder
        self.generation = generation
        self._engaged = False

    @property
    def invalidated(self) -> bool:
        return self.holder.generation != self.generation

    def mark_deleted(self) -> None:
        """Linearize a successful DELETE and invalidate older waiters."""
        self.holder.generation += 1

    def engage(self) -> bool:
        """Join this generation until the complete async operation has replied."""
        with self.holder.condition:
            if self._engaged:
                return True
            if self.invalidated or self.holder.deleting:
                return False
            self.holder.active_operations += 1
            self._engaged = True
            return True

    def finish(self) -> None:
        with self.holder.condition:
            if not self._engaged:
                return
            self._engaged = False
            self.holder.active_operations -= 1
            self.holder.condition.notify_all()


_SESSION_COMMIT_LOCKS_GUARD = threading.Lock()
_SESSION_COMMIT_LOCKS: weakref.WeakValueDictionary[str, _SessionCommitLock] = (
    weakref.WeakValueDictionary()
)
_MAX_LIVE_SESSION_STATE_SETS = 1024
_LIVE_SESSION_STATES_GUARD = threading.Lock()
_LIVE_SESSION_STATES: weakref.WeakKeyDictionary[
    Any, OrderedDict[str, weakref.WeakSet[ScanSessionState]]
] = weakref.WeakKeyDictionary()


def _begin_session_commit(session_id: str) -> _SessionCommitLifecycle:
    """Capture the current lifecycle before waiting for the session lock."""
    with _SESSION_COMMIT_LOCKS_GUARD:
        holder = _SESSION_COMMIT_LOCKS.get(session_id)
        if holder is None:
            holder = _SessionCommitLock()
            _SESSION_COMMIT_LOCKS[session_id] = holder
        return _SessionCommitLifecycle(holder, holder.generation)


@contextmanager
def _serialized_session_commit(session_id: str):  # type: ignore[no-untyped-def]
    """Serialize mutations and expose deletion since the operation began."""
    lifecycle = _begin_session_commit(session_id)
    with lifecycle.holder.lock:
        yield lifecycle


@contextmanager
def _serialized_session_delete(session_id: str):  # type: ignore[no-untyped-def]
    """Reject new work and wait for already-engaged operations before DELETE."""
    lifecycle = _begin_session_commit(session_id)
    with lifecycle.holder.condition:
        lifecycle.holder.deleting = True
        try:
            while lifecycle.holder.active_operations:
                lifecycle.holder.condition.wait()
            yield lifecycle
        finally:
            lifecycle.holder.deleting = False
            lifecycle.holder.condition.notify_all()


def _register_live_session_state(
    storage: Any,
    session: ScanSessionState,
) -> list[ScanSessionState]:
    """Register an active state without extending its or the storage's lifetime."""
    with _LIVE_SESSION_STATES_GUARD:
        try:
            storage_sessions = _LIVE_SESSION_STATES.setdefault(
                storage, OrderedDict()
            )
        except TypeError:
            # Exotic storage adapters may not support weak references.
            return [session]

        empty_session_ids = [
            session_id
            for session_id, live_states in storage_sessions.items()
            if not live_states
        ]
        for session_id in empty_session_ids:
            storage_sessions.pop(session_id, None)

        live_states = storage_sessions.get(session.session_id)
        if live_states is None:
            live_states = weakref.WeakSet()
            storage_sessions[session.session_id] = live_states
        live_states.add(session)
        storage_sessions.move_to_end(session.session_id)

        while len(storage_sessions) > _MAX_LIVE_SESSION_STATE_SETS:
            evictable_session_id = next(
                (
                    session_id
                    for session_id, registered_states in storage_sessions.items()
                    if not registered_states
                ),
                None,
            )
            if evictable_session_id is None:
                # Active session state is correctness-critical. The registry may
                # temporarily exceed its soft bound until weak entries expire.
                break
            storage_sessions.pop(evictable_session_id, None)

        return list(live_states)


def _discard_live_session_states(storage: Any, session_id: str) -> None:
    """Detach and reset every live state associated with a deleted session."""
    with _LIVE_SESSION_STATES_GUARD:
        try:
            storage_sessions = _LIVE_SESSION_STATES.get(storage)
        except TypeError:
            return
        if storage_sessions is None:
            return
        live_states = list(storage_sessions.pop(session_id, ()))

    for live_state in live_states:
        live_state.reset_after_delete()


def _observe_chunk_metadata_for_live_states(
    live_states: list[ScanSessionState],
    chunk_meta: Optional[Dict[str, int]],
) -> None:
    if chunk_meta is None:
        return
    for live_state in live_states:
        live_state.observe_chunk_transport_metadata(
            chunk_meta["chunkId"],
            expected_packets=chunk_meta.get("expectedPackets"),
            total_packets=chunk_meta.get("exactChunkPackets"),
            total_chunks=chunk_meta.get("totalChunks"),
        )


def _record_packet_for_live_states(
    live_states: list[ScanSessionState],
    packet_index: int,
    chunk_id: int,
) -> None:
    for live_state in live_states:
        live_state.record_packet(packet_index, chunk_id)


def _coerce_optional_int(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _extract_stored_packet_identity(packet: bytes) -> tuple[int, int]:
    """Extract (chunk_id, packet_index) from a stored scan packet payload."""
    if not isinstance(packet, bytes) or len(packet) < 1:
        raise ValueError("Packet payload is empty")

    mode = packet[0]
    if mode in (1, 2):
        symbol_offset = 31 if mode == 2 else 27
        minimum_size = symbol_offset + 4
        if len(packet) < minimum_size:
            raise ValueError("Streaming packet payload is truncated")
        chunk_id = int.from_bytes(packet[5:9], "big", signed=False)
        packet_index = int.from_bytes(
            packet[symbol_offset : symbol_offset + 4],
            "big",
            signed=False,
        )
        return chunk_id, packet_index

    if len(packet) < 10:
        raise ValueError("Legacy packet payload is truncated")

    packet_index = int.from_bytes(packet[6:10], "big", signed=False)
    return 0, packet_index


def _extract_stored_packet_identity_from_filename(
    packet_name: Optional[str],
) -> Optional[tuple[int, int]]:
    if not isinstance(packet_name, str) or len(packet_name) == 0:
        return None

    match = _WS_STORED_PACKET_FILENAME_RE.match(Path(packet_name).name)
    if match is None:
        return None
    return int(match.group(1), 16), int(match.group(2), 16)


def _extract_stored_packet_identity_from_entry(
    packet: bytes,
    packet_name: Optional[str] = None,
) -> tuple[int, int]:
    from_filename = _extract_stored_packet_identity_from_filename(packet_name)
    if from_filename is not None:
        return from_filename
    if packet[:1] in (b"\x01", b"\x02"):
        return _extract_stored_packet_identity(packet)
    raise ValueError("Stored packet identity is unavailable")


def _normalize_stored_packet_entries(
    raw_entries: Any,
) -> Optional[list[tuple[Optional[str], bytes]]]:
    if raw_entries is None:
        return []
    if not isinstance(raw_entries, list):
        return None

    normalized: list[tuple[Optional[str], bytes]] = []
    for entry in raw_entries:
        if not isinstance(entry, (list, tuple)) or len(entry) != 2:
            return None
        packet_name, packet = entry
        if packet_name is not None and not isinstance(packet_name, str):
            return None
        if not isinstance(packet, bytes):
            return None
        normalized.append((packet_name, packet))
    return normalized


def _list_stored_packet_entries(
    storage: Any,
    session_id: str,
) -> list[tuple[Optional[str], bytes]]:
    try:
        raw_entries = storage.list_packet_entries(session_id)
    except Exception as exc:
        logger.debug(
            "Failed to list stored packet entries for session %s: %s",
            session_id,
            exc,
        )
        return []
    normalized = _normalize_stored_packet_entries(raw_entries)
    return normalized or []


def _extract_stored_packet_chunk_transport_metadata(
    packet: bytes,
) -> Optional[Dict[str, int]]:
    """Extract chunk-level transport metadata from a stored streaming packet payload."""
    if not isinstance(packet, bytes) or len(packet) < 27:
        return None

    mode = packet[0]
    if mode not in (1, 2):
        return None

    symbol_offset = 31 if mode == 2 else 27
    if len(packet) < symbol_offset:
        raise ValueError("Streaming packet payload is truncated")

    chunk_id = int.from_bytes(packet[5:9], "big", signed=False)
    total_chunks = int.from_bytes(packet[9:13], "big", signed=False)
    total_size = int.from_bytes(packet[21:25], "big", signed=False)
    packet_size = int.from_bytes(packet[25:27], "big", signed=False)
    if packet_size <= 0:
        return None

    metadata: Dict[str, int] = {
        "chunkId": chunk_id,
        "totalChunks": total_chunks,
        "totalSize": total_size,
        "packetSize": packet_size,
        "expectedPackets": (total_size + packet_size - 1) // packet_size,
    }
    if mode == 2:
        metadata["exactChunkPackets"] = int.from_bytes(
            packet[27:31],
            "big",
            signed=False,
        )
    return metadata


def _extract_request_headers(websocket: Any) -> dict[str, str]:
    request = getattr(websocket, "request", None)
    if request is not None:
        headers = getattr(request, "headers", None)
        if isinstance(headers, Mapping):
            return dict(headers)

    headers = getattr(websocket, "request_headers", None)
    if isinstance(headers, Mapping):
        return dict(headers)

    return {}


def _extract_request_path(websocket: Any) -> str:
    request = getattr(websocket, "request", None)
    if request is not None:
        path = getattr(request, "path", None)
        if isinstance(path, str):
            return path

    path = getattr(websocket, "path", None)
    if isinstance(path, str):
        return path

    return ""


def _get_request_header(headers: Mapping[str, Any], name: str) -> Optional[str]:
    target = name.lower()
    for key, value in headers.items():
        if str(key).lower() != target:
            continue
        if isinstance(value, str):
            return value
        if isinstance(value, (list, tuple)):
            for entry in value:
                if isinstance(entry, str) and entry:
                    return entry
        elif value is not None:
            return str(value)
    return None


def _extract_request_context(websocket: Any) -> Dict[str, str]:
    headers = _extract_request_headers(websocket)
    raw_path = _extract_request_path(websocket)
    parsed = urlsplit(raw_path or "")
    params = dict(parse_qsl(parsed.query, keep_blank_values=True))

    context: Dict[str, str] = {
        "path": parsed.path or raw_path or "",
    }
    if parsed.query:
        context["query"] = parsed.query

    for query_name, context_key in (
        ("connectionId", "connectionId"),
        ("deviceId", "deviceId"),
    ):
        value = params.get(query_name)
        if value:
            context[context_key] = value

    for header_name, context_key in (
        ("origin", "origin"),
        ("x-forwarded-host", "xForwardedHost"),
        ("user-agent", "userAgent"),
    ):
        value = _get_request_header(headers, header_name)
        if value:
            context[context_key] = value

    return context


def _count_durable_packets(storage: Optional[Any], session_id: str) -> Optional[int]:
    if storage is None:
        return None

    try:
        return int(storage.count_packets(session_id))
    except Exception:
        return None


def _read_session_meta(storage: Optional[Any], session_id: str) -> Dict[str, Any]:
    if storage is None:
        return {}

    try:
        session_meta = storage.read_session(session_id) or {}
    except Exception:
        return {}

    return session_meta if isinstance(session_meta, dict) else {}


def _build_scan_log_context(
    websocket: Any,
    session_id: str,
    *,
    session: Optional[ScanSessionState] = None,
    client_id: Optional[str] = None,
    storage: Optional[Any] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    context: Dict[str, Any] = {
        "sessionId": session_id,
        **_extract_request_context(websocket),
    }

    remote_address = getattr(websocket, "remote_address", None)
    if isinstance(remote_address, tuple) and remote_address:
        context["remoteAddress"] = remote_address[0]

    if client_id:
        context["clientId"] = client_id

    if session is not None:
        state = session.get_state_dict(0)
        context["liveReceivedCount"] = state.get("receivedCount")
        context["liveLastContiguous"] = state.get("lastContiguous")
        chunk_states = state.get("chunkStates")
        if isinstance(chunk_states, list):
            context["liveChunkCount"] = len(chunk_states)
        if state.get("totalExpected") is not None:
            context["expectedPackets"] = state.get("totalExpected")
        if state.get("totalPackets") is not None:
            context["totalPackets"] = state.get("totalPackets")
        if session.total_chunks is not None:
            context["totalChunks"] = session.total_chunks
        if session.packet_size is not None:
            context["packetSize"] = session.packet_size

    durable_received_count = _count_durable_packets(storage, session_id)
    if durable_received_count is not None:
        context["durableReceivedCount"] = durable_received_count

    session_meta = _read_session_meta(storage, session_id)
    for source_key, target_key in (
        ("receivedCount", "persistedReceivedCount"),
        ("lastContiguous", "persistedLastContiguous"),
        ("expectedPackets", "persistedExpectedPackets"),
        ("totalChunks", "persistedTotalChunks"),
        ("status", "persistedStatus"),
        ("updatedAt", "persistedUpdatedAt"),
    ):
        value = session_meta.get(source_key)
        if value is not None:
            context[target_key] = value

    if extra:
        context.update(extra)

    return context


def _build_scan_event_fields(
    websocket: Any,
    session_id: str,
    *,
    client_id: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    context: Dict[str, Any] = {
        "sessionId": session_id,
        **_extract_request_context(websocket),
    }

    remote_address = getattr(websocket, "remote_address", None)
    if isinstance(remote_address, tuple) and remote_address:
        context["remoteAddress"] = remote_address[0]

    if client_id:
        context["clientId"] = client_id

    if extra:
        context.update(extra)

    return context


def _format_scan_log_event(
    event: str,
    websocket: Any,
    session_id: str,
    *,
    client_id: Optional[str] = None,
    extra: Optional[Dict[str, Any]] = None,
) -> str:
    return format_kv_log(
        event,
        **_build_scan_event_fields(
            websocket,
            session_id,
            client_id=client_id,
            extra=extra,
        ),
    )


async def handle_scan_client(
    websocket: Any,
    session_id: str,
    session_store: ScanSessionStore,
    auth_manager: Optional[Any] = None,
    storage: Optional[Any] = None,
    emit_event: Optional[Callable[[str, dict[str, Any]], None]] = None,
    emit_history_event: Optional[Callable[[dict[str, Any]], None]] = None,
) -> None:
    """Handle a WebSocket connection for the scan channel.

    Args:
        websocket: WebSocket connection
        session_id: Session ID from URL path
        session_store: Store for session state
        auth_manager: Optional auth manager
    """
    client_id: Optional[str] = None
    session: Optional[ScanSessionState] = None
    logger.info(
        _format_scan_log_event(
            "ws.scan.connection_opened",
            websocket,
            session_id,
        ),
    )

    try:
        async for message in websocket:
            # Handle text (JSON) messages
            if isinstance(message, str):
                try:
                    data = json.loads(message)
                except json.JSONDecodeError:
                    await _send_error(websocket, "invalid_json", "Invalid JSON", fatal=True)
                    return

                msg_type = data.get("type")

                if msg_type == "hello":
                    result = await _handle_hello(
                        websocket, data, session_id, session_store, auth_manager, storage
                    )
                    if result is None:
                        return  # Error sent, close connection
                    client_id, session = result

                elif msg_type == "claimProducer":
                    if session and client_id:
                        await _handle_claim_producer(websocket, session, client_id)

                elif msg_type == "meta":
                    if session:
                        await _handle_meta(websocket, data, session)

                elif msg_type == "metaUpdate":
                    if session:
                        await _handle_meta_update(websocket, data, session)

                elif msg_type == "resume":
                    if session:
                        await _handle_resume(
                            websocket,
                            data,
                            session,
                            storage,
                            emit_event=emit_event,
                            emit_history_event=emit_history_event,
                        )

                elif msg_type == "ping":
                    await _handle_ping(websocket, session)

                elif msg_type == "complete":
                    if session:
                        await _handle_complete(
                            websocket,
                            data,
                            session,
                            storage,
                            emit_event=emit_event,
                            emit_history_event=emit_history_event,
                        )

                else:
                    logger.warning("Unknown message type: %s", msg_type)

            # Handle binary (packet) messages
            elif isinstance(message, bytes):
                if session and client_id and session.is_producer(client_id, websocket):
                    await _handle_binary_packet(
                        websocket,
                        message,
                        session,
                        storage,
                        emit_event=emit_event,
                        emit_history_event=emit_history_event,
                    )
                else:
                    await _send_error(
                        websocket, "not_producer",
                        "Must claim producer before sending packets",
                        fatal=False
                    )

    except Exception as e:
        logger.warning(
            _format_scan_log_event(
                "ws.scan.connection_error",
                websocket,
                session_id,
                client_id=client_id,
                extra={"error": repr(e)},
            ),
        )

    finally:
        # Cleanup: revoke only this producer if it had joined the session.
        if session and client_id:
            session.revoke_producer(client_id, websocket)
        logger.info(
            _format_scan_log_event(
                "ws.scan.connection_closed",
                websocket,
                session_id,
                client_id=client_id,
            ),
        )


async def _handle_hello(
    websocket: Any,
    data: Dict[str, Any],
    session_id: str,
    session_store: ScanSessionStore,
    auth_manager: Optional[Any],
    storage: Optional[Any] = None,
) -> Optional[tuple[str, ScanSessionState]]:
    """Handle hello message."""
    # Validate protocol
    if data.get("protocol") != "airqr-scan":
        await _send_error(
            websocket, "invalid_protocol",
            "Expected protocol: airqr-scan",
            fatal=True
        )
        return None

    # Validate version
    version = data.get("version", 1)
    if version != PROTOCOL_VERSION:
        await _send_error(
            websocket, "version_mismatch",
            f"Expected version {PROTOCOL_VERSION}",
            fatal=True
        )
        return None

    # Authenticate if auth is enabled
    if auth_manager and auth_manager.enabled:
        remote_address = getattr(websocket, "remote_address", None)
        headers = strip_cross_origin_cookie_auth(
            _extract_request_headers(websocket)
        )
        client_ip = client_ip_from_peer(
            remote_address,
            websocket,
            headers=headers,
            trusted_proxies=getattr(auth_manager, "trusted_proxies", ()),
        )
        rate_limit_key = f"ws-scan:{client_ip}"
        rate_limiter = getattr(auth_manager, "rate_limiter", None)
        api_key = data.get("apiKey")
        is_cheaply_authed = auth_manager.is_cookie_or_api_key_authorized(
            headers
        ) or bool(
            isinstance(api_key, str)
            and api_key
            and auth_manager.authorize_api_key(api_key)
        )
        if is_cheaply_authed:
            if rate_limiter:
                rate_limiter.reset(rate_limit_key)
        else:
            if rate_limiter and not rate_limiter.try_reserve(rate_limit_key):
                await _send_error(
                    websocket, "rate_limited",
                    "Too many attempts. Try again later.",
                    fatal=True
                )
                return None

            try:
                if "username" in data or "password" in data:
                    username = data.get("username")
                    password = data.get("password")
                    credentials = (
                        (username, password)
                        if isinstance(username, str)
                        and username
                        and isinstance(password, str)
                        and password
                        else None
                    )
                else:
                    credentials = auth_manager.get_basic_credentials(headers)
                is_basic_authed = bool(
                    credentials
                    and credentials[0]
                    and credentials[1]
                    and auth_manager.authorize_basic(*credentials)
                )
            except BaseException:
                if rate_limiter:
                    rate_limiter.cancel_reservation(rate_limit_key)
                raise

            if is_basic_authed:
                if rate_limiter:
                    rate_limiter.complete_success(rate_limit_key)
            else:
                if rate_limiter:
                    rate_limiter.complete_failure(rate_limit_key)

                await _send_error(
                    websocket, "auth_failed",
                    "Authentication required",
                    fatal=True
                )
                return None

    # Get or create session
    session = session_store.get_or_create(session_id)
    if storage is not None:
        _hydrate_session_from_storage(session, session_id, storage)
    client_id = data.get("clientId") or "anonymous"

    # Build producer info
    producer_info = None
    if session.producer_device_id:
        producer_info = {
            "deviceId": session.producer_device_id,
        }

    # Send welcome
    await websocket.send(json.dumps({
        "type": "welcome",
        "version": PROTOCOL_VERSION,
        "sessionState": session.get_state_dict(),
        "producer": producer_info,
        "windowSize": DEFAULT_WINDOW_SIZE,
        "packetAck": True,
    }))
    logger.info(
        _format_scan_log_event(
            "ws.scan.hello_accepted",
            websocket,
            session_id,
            client_id=client_id,
        )
    )

    return client_id, session


def _hydrate_session_from_storage(
    session: ScanSessionState,
    session_id: str,
    storage: Any,
) -> None:
    if session.is_durable_state_hydrated():
        return
    _hydrate_session_from_storage_once(session, session_id, storage)
    session.mark_durable_state_hydrated()


def _hydrate_session_from_storage_once(
    session: ScanSessionState,
    session_id: str,
    storage: Any,
) -> None:
    persisted = storage.read_session(session_id) or {}
    if persisted:
        session.set_metadata(
            filename=persisted.get("filename"),
            mime_type=persisted.get("mimeType"),
            file_size=persisted.get("size"),
            expected_packets=persisted.get("expectedPackets"),
            total_packets=persisted.get("totalPackets"),
            total_packets_exact=persisted.get("totalPacketsExact"),
            total_chunks=persisted.get("totalChunks"),
            packet_size=persisted.get("packetSize"),
        )

    persisted_chunk_packets = reconstruct_packets_by_chunk_from_chunk_states(
        persisted.get("chunkStates")
    )
    if persisted_chunk_packets and any(persisted_chunk_packets.values()):
        session.hydrate_chunk_packets(persisted_chunk_packets)
        return

    persisted_total_chunks = _coerce_optional_int(persisted.get("totalChunks")) or 0
    should_reconstruct_from_packets = (
        not persisted
        or bool(persisted.get("isStreaming"))
        or persisted_total_chunks > 1
    )

    if should_reconstruct_from_packets:
        stored_packet_entries = _list_stored_packet_entries(storage, session_id)
        packets_by_chunk: Dict[int, set[int]] = {}
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
                session.observe_chunk_transport_metadata(
                    chunk_meta["chunkId"],
                    expected_packets=chunk_meta.get("expectedPackets"),
                    total_packets=chunk_meta.get("exactChunkPackets"),
                    total_chunks=chunk_meta.get("totalChunks"),
                )

        if packets_by_chunk:
            session.hydrate_chunk_packets(packets_by_chunk)
            return

    get_packet_ranges = getattr(storage, "get_packet_ranges", None)
    if not callable(get_packet_ranges):
        return

    try:
        packet_ranges = get_packet_ranges(session_id)
    except Exception as exc:
        logger.debug("Failed to hydrate packet ranges for session %s: %s", session_id, exc)
        return

    if not packet_ranges:
        return

    session.hydrate_packet_ranges(packet_ranges)


async def _handle_claim_producer(
    websocket: Any,
    session: ScanSessionState,
    client_id: str,
) -> None:
    """Handle claimProducer message."""
    claim = session.claim_producer(client_id, websocket)

    await websocket.send(json.dumps({
        "type": "producerClaimed",
        "deviceId": client_id,
        "leaseExpires": claim.lease.expires_at.isoformat(),
        "leaseDurationMs": claim.lease.duration_ms,
    }))
    logger.info(
        _format_scan_log_event(
            "ws.scan.producer_claimed",
            websocket,
            session.session_id,
            client_id=client_id,
            extra={"leaseExpires": claim.lease.expires_at.isoformat()},
        ),
    )


async def _handle_meta(
    websocket: Any,
    data: Dict[str, Any],
    session: ScanSessionState,
) -> None:
    """Handle meta message."""
    session.set_metadata(
        filename=data.get("filename"),
        mime_type=data.get("mimeType"),
        file_size=data.get("fileSize"),
        expected_packets=data.get("expectedPackets"),
        total_packets=data.get("totalPackets"),
        total_packets_exact=data.get("totalPacketsExact"),
        total_chunks=data.get("totalChunks"),
        packet_size=data.get("packetSize"),
    )

    await websocket.send(json.dumps({
        "type": "metaAck",
        "accepted": True,
        "sessionId": session.session_id,
    }))


async def _handle_meta_update(
    websocket: Any,
    data: Dict[str, Any],
    session: ScanSessionState,
) -> None:
    """Handle metaUpdate message."""
    session.set_metadata(
        file_size=data.get("fileSize"),
        expected_packets=data.get("expectedPackets"),
        total_packets=data.get("totalPackets"),
        total_packets_exact=data.get("totalPacketsExact"),
        total_chunks=data.get("totalChunks"),
    )

    await websocket.send(json.dumps({
        "type": "metaUpdateAck",
        "accepted": True,
    }))


async def _handle_resume(
    websocket: Any,
    data: Dict[str, Any],
    session: ScanSessionState,
    storage: Optional[Any] = None,
    *,
    emit_event: Optional[Callable[[str, dict[str, Any]], None]] = None,
    emit_history_event: Optional[Callable[[dict[str, Any]], None]] = None,
    stale_retry_after_seconds: float = STALE_ASSEMBLY_RETRY_AFTER_SECONDS,
) -> None:
    """Handle resume message."""
    from_index = data.get("fromPacketIndex", 0)
    if storage is not None:
        before_state = session.get_state_dict(from_index)
        _hydrate_session_from_storage(session, session.session_id, storage)
        after_state = session.get_state_dict(from_index)
        if (
            before_state.get("receivedCount") != after_state.get("receivedCount")
            or before_state.get("lastContiguous") != after_state.get("lastContiguous")
            or before_state.get("chunkStates") != after_state.get("chunkStates")
        ):
            logger.warning(
                "Reconciled live WS scan session %s with durable packet store before resume "
                "(liveReceived=%s durableReceived=%s liveLastContiguous=%s durableLastContiguous=%s)",
                session.session_id,
                before_state.get("receivedCount"),
                after_state.get("receivedCount"),
                before_state.get("lastContiguous"),
                after_state.get("lastContiguous"),
            )

    resume_state = session.get_state_dict(from_index)
    logger.info(
        _format_scan_log_event(
            "ws.scan.resume_state",
            websocket,
            session.session_id,
            extra={
                "fromPacketIndex": from_index,
                "resumeReceivedCount": resume_state.get("receivedCount"),
                "resumeLastContiguous": resume_state.get("lastContiguous"),
                "resumeChunkCount": len(resume_state.get("chunkStates") or []),
            },
        ),
    )
    await websocket.send(
        json.dumps(
            {
                "type": "resumeState",
                **resume_state,
            }
        )
    )
    await _maybe_auto_complete_session(
        websocket,
        session,
        storage,
        emit_event=emit_event,
        emit_history_event=emit_history_event,
        allow_stale_retry=True,
        stale_retry_after_seconds=stale_retry_after_seconds,
    )


async def _handle_ping(
    websocket: Any,
    session: Optional[ScanSessionState],
) -> None:
    """Handle ping message."""
    response: Dict[str, Any] = {"type": "pong"}

    if session:
        lease = session.renew_lease()
        if lease:
            response["leaseExpires"] = lease.expires_at.isoformat()

    await websocket.send(json.dumps(response))


async def _handle_complete(
    websocket: Any,
    data: Dict[str, Any],
    session: ScanSessionState,
    storage: Optional[Any] = None,
    *,
    emit_event: Optional[Callable[[str, dict[str, Any]], None]] = None,
    emit_history_event: Optional[Callable[[dict[str, Any]], None]] = None,
) -> None:
    """Handle complete message."""
    if storage is None:
        missing = session.get_missing_ranges()
        response = (
            {
                "type": "completed",
                "success": False,
                "error": "missing_packets",
                "missing": missing,
            }
            if missing
            else {
                "type": "completed",
                "success": True,
                "filename": session.filename,
            }
        )
        await websocket.send(json.dumps(response))
        return

    response: Dict[str, Any]
    with _serialized_session_commit(session.session_id):
        raw_durable_meta = storage.read_session(session.session_id) or {}
        durable_meta = (
            raw_durable_meta if isinstance(raw_durable_meta, dict) else {}
        )
        if _session_is_complete(durable_meta):
            response = {
                "type": "completed",
                "success": True,
                "filename": durable_meta.get("filename") or session.filename,
                "fileSize": durable_meta.get("size"),
                "completedAt": durable_meta.get("completedAt"),
            }
        elif (missing := session.get_missing_ranges()):
            response = {
                "type": "completed",
                "success": False,
                "error": "missing_packets",
                "missing": missing,
            }
        else:
            try:
                filename, file_bytes = assemble_scan_session_file(
                    storage, session.session_id
                )
            except ScanAssemblyError as exc:
                message = str(exc)
                error_code = (
                    "missing_packets" if "Missing" in message else "decode_failed"
                )
                logger.info(
                    _format_scan_log_event(
                        "ws.scan.complete_failed",
                        websocket,
                        session.session_id,
                        extra={
                            "error": message,
                            "errorCode": error_code,
                            "receivedCount": session.received_count,
                        },
                    )
                )
                response = {
                    "type": "completed",
                    "success": False,
                    "error": error_code,
                    "message": message,
                }
            except ScanAssemblyUnavailableError as exc:
                logger.error(
                    _format_scan_log_event(
                        "ws.scan.complete_unavailable",
                        websocket,
                        session.session_id,
                        extra={"error": str(exc)},
                    )
                )
                response = {
                    "type": "completed",
                    "success": False,
                    "error": "assembly_unavailable",
                    "message": str(exc),
                }
            else:
                completed_at = data.get("completedAt") or utc_now()
                session_meta = _commit_completed_session(
                    storage,
                    session,
                    filename,
                    file_bytes,
                    completed_at,
                    duration=data.get("duration"),
                    emit_event=emit_event,
                    emit_history_event=emit_history_event,
                )
                logger.info(
                    _format_scan_log_event(
                        "ws.scan.complete_succeeded",
                        websocket,
                        session.session_id,
                        extra={
                            "fileSize": session_meta.get("size"),
                            "filename": session_meta.get("filename"),
                            "receivedCount": session.received_count,
                        },
                    )
                )
                response = {
                    "type": "completed",
                    "success": True,
                    "filename": filename,
                    "fileSize": len(file_bytes),
                    "completedAt": completed_at,
                }

    # Network I/O is deliberately outside the process-wide session lock.
    await websocket.send(json.dumps(response))


def _finalize_session_storage(
    storage: Any,
    session: ScanSessionState,
    filename: str,
    file_bytes: bytes,
    completed_at: str,
    *,
    duration: Any = None,
    mark_all_chunks_complete: bool = False,
) -> Dict[str, Any]:
    """Persist the assembled file and monotonic terminal session metadata."""
    file_path = storage.save_session_file(session.session_id, filename, file_bytes)
    session_meta = storage.read_session(session.session_id) or {}
    session_meta.setdefault("sessionId", session.session_id)
    session_meta.setdefault("createdAt", completed_at)
    session_meta["updatedAt"] = utc_now()
    session_meta["status"] = "complete"
    session_meta["completed"] = True
    session_meta["completedAt"] = completed_at
    session_meta["filename"] = filename
    session_meta["mimeType"] = session.mime_type or "application/octet-stream"
    session_meta["size"] = len(file_bytes)
    session_meta["encoding"] = WS_BINARY_ENCODING
    session_meta["receivedCount"] = session.received_count
    session_meta["receivedPackets"] = session.received_count
    session_meta["packetCount"] = session.received_count
    session_meta["lastContiguous"] = session.last_contiguous
    if session.total_packets is not None:
        session_meta["expectedPackets"] = int(session.total_packets)
    if session.reported_total_packets is not None:
        session_meta["totalPackets"] = int(session.reported_total_packets)
    elif session.total_packets is not None:
        session_meta["totalPackets"] = int(session.total_packets)
    session_meta["totalPacketsExact"] = bool(session.total_packets_exact)
    if session.total_chunks is not None:
        session_meta["totalChunks"] = int(session.total_chunks)
        if mark_all_chunks_complete:
            session_meta["chunksCompleted"] = int(session.total_chunks)
    if session.packet_size is not None:
        session_meta["packetSize"] = int(session.packet_size)
    if session.producer_device_id:
        session_meta["deviceId"] = session.producer_device_id
        session_meta["producerDeviceId"] = session.producer_device_id
    if duration is not None:
        session_meta["duration"] = duration
    try:
        session_meta["filePath"] = str(file_path.relative_to(storage.base_dir))
    except ValueError:
        session_meta["filePath"] = str(file_path)
    storage.write_session(session.session_id, session_meta)
    return session_meta


def _emit_completed_session_events(
    session: ScanSessionState,
    storage: Any,
    session_meta: Dict[str, Any],
    *,
    emit_event: Optional[Callable[[str, dict[str, Any]], None]],
    emit_history_event: Optional[Callable[[dict[str, Any]], None]],
) -> None:
    _emit_canonical_scan_session_state(
        session,
        storage,
        emit_event=emit_event,
        emit_history_event=emit_history_event,
    )
    _emit_scan_event(
        "scan-complete",
        {
            "origin": "scanned",
            "sessionId": session.session_id,
            "updatedAt": session_meta.get("updatedAt"),
            "completed": True,
            "filename": session_meta.get("filename"),
            "deviceId": session_meta.get("deviceId"),
            "deviceName": session_meta.get("deviceName"),
            "size": session_meta.get("size"),
            "mimeType": session_meta.get("mimeType"),
            "duration": session_meta.get("duration"),
            "totalChunks": session_meta.get("totalChunks"),
            "chunksCompleted": session_meta.get("chunksCompleted"),
        },
        emit_event=emit_event,
        emit_history_event=emit_history_event,
    )


def _commit_completed_session(
    storage: Any,
    session: ScanSessionState,
    filename: str,
    file_bytes: bytes,
    completed_at: str,
    *,
    duration: Any = None,
    mark_all_chunks_complete: bool = False,
    finish_assembly_success: bool = False,
    emit_event: Optional[Callable[[str, dict[str, Any]], None]],
    emit_history_event: Optional[Callable[[dict[str, Any]], None]],
) -> Dict[str, Any]:
    """Apply the shared locked terminal transition and publish its events."""
    with _serialized_session_commit(session.session_id):
        session_meta = _finalize_session_storage(
            storage,
            session,
            filename,
            file_bytes,
            completed_at,
            duration=duration,
            mark_all_chunks_complete=mark_all_chunks_complete,
        )
        if finish_assembly_success:
            session.finish_assembly_attempt(success=True, error=None)
        _emit_completed_session_events(
            session,
            storage,
            session_meta,
            emit_event=emit_event,
            emit_history_event=emit_history_event,
        )
        return session_meta


def _prepare_auto_complete_session(
    websocket: Any,
    session: ScanSessionState,
    storage: Optional[Any] = None,
    *,
    emit_event: Optional[Callable[[str, dict[str, Any]], None]] = None,
    emit_history_event: Optional[Callable[[dict[str, Any]], None]] = None,
    allow_stale_retry: bool = False,
    stale_retry_after_seconds: float = STALE_ASSEMBLY_RETRY_AFTER_SECONDS,
) -> Optional[Dict[str, Any]]:
    if storage is None:
        return False
    decode_threshold = session.total_packets or session.reported_total_packets
    if decode_threshold is None or session.received_count < decode_threshold:
        return False
    if not session.is_decode_threshold_reached():
        _emit_canonical_scan_session_state(
            session,
            storage,
            emit_event=emit_event,
            emit_history_event=emit_history_event,
        )
        return False

    session_meta = storage.read_session(session.session_id) or {}
    if (
        bool(session_meta.get("completed"))
        or session_meta.get("status") == "complete"
        or bool(session_meta.get("completedAt"))
    ):
        return False

    if not session.begin_assembly_attempt(
        allow_stale_retry=allow_stale_retry,
        stale_retry_after_seconds=stale_retry_after_seconds,
    ):
        _emit_canonical_scan_session_state(
            session,
            storage,
            emit_event=emit_event,
            emit_history_event=emit_history_event,
        )
        return False

    _emit_canonical_scan_session_state(
        session,
        storage,
        emit_event=emit_event,
        emit_history_event=emit_history_event,
    )

    try:
        filename, file_bytes = assemble_scan_session_file(storage, session.session_id)
    except ScanAssemblyError as exc:
        session.finish_assembly_attempt(success=False, error=str(exc))
        logger.info(
            format_kv_log(
                "ws.scan.auto_complete_threshold_pending",
                decodeThreshold=decode_threshold,
                error=str(exc),
                receivedCount=session.received_count,
                sessionId=session.session_id,
            )
        )
        _emit_canonical_scan_session_state(
            session,
            storage,
            emit_event=emit_event,
            emit_history_event=emit_history_event,
        )
        return False
    except ScanAssemblyUnavailableError as exc:
        session.finish_assembly_attempt(success=False, error=str(exc))
        logger.error(
            format_kv_log(
                "ws.scan.auto_complete_unavailable",
                error=str(exc),
                sessionId=session.session_id,
            )
        )
        _emit_canonical_scan_session_state(
            session,
            storage,
            emit_event=emit_event,
            emit_history_event=emit_history_event,
        )
        return False
    except Exception as exc:
        session.finish_assembly_attempt(success=False, error=str(exc))
        _emit_canonical_scan_session_state(
            session,
            storage,
            emit_event=emit_event,
            emit_history_event=emit_history_event,
        )
        raise

    completed_at = utc_now()
    try:
        session_meta = _commit_completed_session(
            storage,
            session,
            filename,
            file_bytes,
            completed_at,
            mark_all_chunks_complete=True,
            finish_assembly_success=True,
            emit_event=emit_event,
            emit_history_event=emit_history_event,
        )
    except Exception as exc:
        session.finish_assembly_attempt(success=False, error=str(exc))
        _emit_canonical_scan_session_state(
            session,
            storage,
            emit_event=emit_event,
            emit_history_event=emit_history_event,
        )
        raise

    logger.info(
        format_kv_log(
            "ws.scan.auto_completed",
            decodeThreshold=decode_threshold,
            fileSize=session_meta.get("size"),
            filename=session_meta.get("filename"),
            receivedCount=session.received_count,
            sessionId=session.session_id,
        )
    )
    return {
        "type": "completed",
        "success": True,
        "filename": filename,
        "fileSize": len(file_bytes),
        "completedAt": completed_at,
        "autoCompleted": True,
    }


def _commit_auto_complete_session(
    websocket: Any,
    session: ScanSessionState,
    storage: Optional[Any] = None,
    *,
    emit_event: Optional[Callable[[str, dict[str, Any]], None]] = None,
    emit_history_event: Optional[Callable[[dict[str, Any]], None]] = None,
    allow_stale_retry: bool = False,
    stale_retry_after_seconds: float = STALE_ASSEMBLY_RETRY_AFTER_SECONDS,
    lifecycle: Optional[_SessionCommitLifecycle] = None,
) -> Optional[Dict[str, Any]]:
    lifecycle = lifecycle or _begin_session_commit(session.session_id)
    with lifecycle.holder.lock:
        if lifecycle.invalidated:
            return None
        return _prepare_auto_complete_session(
            websocket,
            session,
            storage,
            emit_event=emit_event,
            emit_history_event=emit_history_event,
            allow_stale_retry=allow_stale_retry,
            stale_retry_after_seconds=stale_retry_after_seconds,
        )


async def _maybe_auto_complete_session(
    websocket: Any,
    session: ScanSessionState,
    storage: Optional[Any] = None,
    *,
    emit_event: Optional[Callable[[str, dict[str, Any]], None]] = None,
    emit_history_event: Optional[Callable[[dict[str, Any]], None]] = None,
    allow_stale_retry: bool = False,
    stale_retry_after_seconds: float = STALE_ASSEMBLY_RETRY_AFTER_SECONDS,
) -> bool:
    response = _commit_auto_complete_session(
        websocket,
        session,
        storage,
        emit_event=emit_event,
        emit_history_event=emit_history_event,
        allow_stale_retry=allow_stale_retry,
        stale_retry_after_seconds=stale_retry_after_seconds,
    )
    if not response:
        return False
    # Completion durability and events precede network I/O.
    await websocket.send(json.dumps(response))
    return True


async def _commit_and_publish_binary_packet(
    websocket: Any,
    session: ScanSessionState,
    storage: Any,
    payload: bytes,
    packet_index: int,
    chunk_id: int,
    chunk_meta: Optional[Dict[str, int]],
    *,
    emit_event: Optional[Callable[[str, dict[str, Any]], None]] = None,
    emit_history_event: Optional[Callable[[dict[str, Any]], None]] = None,
) -> None:
    """Keep DELETE ordered behind the complete persisted packet operation."""
    lifecycle = _begin_session_commit(session.session_id)
    if not lifecycle.engage():
        await _send_error(
            websocket,
            "session_deleted",
            "The scan session is being deleted",
            fatal=False,
            extra={"packetIndex": packet_index, "chunkId": chunk_id},
        )
        return

    try:
        try:
            commit_status = _commit_binary_packet(
                storage,
                session,
                payload,
                packet_index,
                chunk_id,
                chunk_meta,
                lifecycle=lifecycle,
            )
        except Exception as exc:
            logger.warning(
                _format_scan_log_event(
                    "ws.scan.packet_persist_failed",
                    websocket,
                    session.session_id,
                    extra={
                        "chunkId": chunk_id,
                        "error": repr(exc),
                        "packetIndex": packet_index,
                    },
                ),
            )
            await _send_error(
                websocket,
                "persist_failed",
                "Failed to persist packet",
                fatal=False,
                extra={"packetIndex": packet_index, "chunkId": chunk_id},
            )
            return

        progress_payload: Optional[Dict[str, Any]] = None
        completion_response: Optional[Dict[str, Any]] = None
        with lifecycle.holder.lock:
            if lifecycle.invalidated:
                commit_status = "deleted"
            elif commit_status in {"new", "repaired"}:
                progress_payload = _build_scan_progress_payload(session, storage)
                _emit_scan_event(
                    "scan-progress",
                    progress_payload,
                    emit_event=emit_event,
                    emit_history_event=emit_history_event,
                )
                _emit_canonical_scan_session_state(
                    session,
                    storage,
                    emit_event=emit_event,
                    emit_history_event=emit_history_event,
                )
                completion_response = _commit_auto_complete_session(
                    websocket,
                    session,
                    storage,
                    emit_event=emit_event,
                    emit_history_event=emit_history_event,
                    lifecycle=lifecycle,
                )

        error_by_status = {
            "conflict": (
                "packet_conflict",
                "A different packet is already stored for this identity",
            ),
            "completed": (
                "session_completed",
                "The scan session is already complete",
            ),
            "deleted": (
                "session_deleted",
                "The scan session was deleted while this packet was waiting to commit",
            ),
        }
        error = error_by_status.get(commit_status)
        if error is not None:
            await _send_error(
                websocket,
                error[0],
                error[1],
                fatal=False,
                extra={"packetIndex": packet_index, "chunkId": chunk_id},
            )
            return

        await _send_packet_ack(websocket, session, chunk_id, packet_index)
        if completion_response:
            await websocket.send(json.dumps(completion_response))

        if progress_payload is None:
            return
        logger.debug(
            "Broadcasted WS scan-progress for session %s "
            "(received=%s expected=%s packetIndex=%s)",
            session.session_id,
            progress_payload.get("receivedCount"),
            progress_payload.get("expectedPackets"),
            packet_index,
        )
        if session.received_count == 1 or session.received_count % 32 == 0:
            logger.info(
                _format_scan_log_event(
                    "ws.scan.progress_checkpoint",
                    websocket,
                    session.session_id,
                    extra={
                        "chunkId": chunk_id,
                        "expectedPackets": progress_payload.get("expectedPackets"),
                        "packetIndex": packet_index,
                        "progressReceivedCount": progress_payload.get("receivedCount"),
                    },
                ),
            )
    finally:
        lifecycle.finish()


async def _handle_binary_packet(
    websocket: Any,
    data: bytes,
    session: ScanSessionState,
    storage: Optional[Any] = None,
    *,
    emit_event: Optional[Callable[[str, dict[str, Any]], None]] = None,
    emit_history_event: Optional[Callable[[dict[str, Any]], None]] = None,
) -> None:
    """Handle binary packet frame."""
    if len(data) < HEADER_SIZE:
        await _send_error(websocket, "invalid_header", "Packet too short", fatal=False)
        return

    header = parse_binary_header(data)
    payload = data[HEADER_SIZE:]
    try:
        chunk_meta = _extract_stored_packet_chunk_transport_metadata(payload)
    except Exception as exc:
        logger.debug(
            "Failed to parse streaming packet metadata for session %s: %s",
            session.session_id,
            exc,
        )
        chunk_meta = None
    # Verify CRC
    computed_crc = compute_crc32(payload)
    if computed_crc != header["crc32"]:
        await _send_error(
            websocket, "invalid_checksum",
            f"CRC32 mismatch for packet {header['pkt_index']}",
            fatal=False,
            extra={"packetIndex": header["pkt_index"]}
        )
        return

    packet_index = int(header["pkt_index"])
    chunk_id = int(header["chunk_id"])
    if payload[:1] in (b"\x01", b"\x02"):
        try:
            payload_chunk_id, payload_packet_index = _extract_stored_packet_identity(payload)
        except Exception:
            payload_chunk_id = None
            payload_packet_index = None
        else:
            if payload_chunk_id != chunk_id or payload_packet_index != packet_index:
                logger.warning(
                    _format_scan_log_event(
                        "ws.scan.packet_identity_mismatch",
                        websocket,
                        session.session_id,
                        extra={
                            "packetIndex": packet_index,
                            "chunkId": chunk_id,
                            "payloadPacketIndex": payload_packet_index,
                            "payloadChunkId": payload_chunk_id,
                        },
                    ),
                )
                await _send_error(
                    websocket,
                    "packet_identity_mismatch",
                    "WS header does not match packet transport identity",
                    fatal=False,
                    extra={
                        "packetIndex": packet_index,
                        "chunkId": chunk_id,
                        "payloadPacketIndex": payload_packet_index,
                        "payloadChunkId": payload_chunk_id,
                    },
                )
                return

    if storage is not None:
        await _commit_and_publish_binary_packet(
            websocket,
            session,
            storage,
            payload,
            packet_index,
            chunk_id,
            chunk_meta,
            emit_event=emit_event,
            emit_history_event=emit_history_event,
        )
        return

    commit_status = "new"
    if chunk_meta is not None:
        session.observe_chunk_transport_metadata(
            chunk_meta["chunkId"],
            expected_packets=chunk_meta.get("expectedPackets"),
            total_packets=chunk_meta.get("exactChunkPackets"),
            total_chunks=chunk_meta.get("totalChunks"),
        )
    if not session.record_packet(packet_index, chunk_id):
        commit_status = "duplicate"

    progress_payload: Optional[Dict[str, Any]] = None
    completion_response: Optional[Dict[str, Any]] = None
    if commit_status in {"new", "repaired"}:
        progress_payload = _build_scan_progress_payload(session, storage)
        _emit_scan_event(
            "scan-progress",
            progress_payload,
            emit_event=emit_event,
            emit_history_event=emit_history_event,
        )
        _emit_canonical_scan_session_state(
            session,
            storage,
            emit_event=emit_event,
            emit_history_event=emit_history_event,
        )

        # The terminal transition is published before any network send.
        completion_response = _commit_auto_complete_session(
            websocket,
            session,
            storage,
            emit_event=emit_event,
            emit_history_event=emit_history_event,
        )
    await _send_packet_ack(websocket, session, chunk_id, packet_index)
    if completion_response:
        await websocket.send(json.dumps(completion_response))

    if progress_payload is None:
        return
    logger.debug(
        "Broadcasted WS scan-progress for session %s (received=%s expected=%s packetIndex=%s)",
        session.session_id,
        progress_payload.get("receivedCount"),
        progress_payload.get("expectedPackets"),
        packet_index,
    )
    if session.received_count == 1 or session.received_count % 32 == 0:
        logger.info(
            _format_scan_log_event(
                "ws.scan.progress_checkpoint",
                websocket,
                session.session_id,
                extra={
                    "chunkId": chunk_id,
                    "expectedPackets": progress_payload.get("expectedPackets"),
                    "packetIndex": packet_index,
                    "progressReceivedCount": progress_payload.get("receivedCount"),
                },
            ),
        )


def _build_legacy_packet_index(
    storage: Any,
    session_id: str,
) -> Dict[tuple[int, int], str]:
    index: Dict[tuple[int, int], str] = {}
    list_names = getattr(storage, "list_session_packet_names", None)
    packet_path_for = getattr(storage, "session_packet_path", None)
    if callable(list_names) and callable(packet_path_for):
        for packet_name in list_names(session_id):
            if _WS_CANONICAL_PACKET_FILENAME_RE.match(packet_name):
                continue
            identity = _extract_stored_packet_identity_from_filename(packet_name)
            if identity is None:
                try:
                    identity = _extract_stored_packet_identity(
                        packet_path_for(session_id, packet_name).read_bytes()
                    )
                except (OSError, ValueError):
                    continue
            index.setdefault(identity, packet_name)
        return index

    for packet_name, packet in _list_stored_packet_entries(storage, session_id):
        if packet_name and _WS_CANONICAL_PACKET_FILENAME_RE.match(packet_name):
            continue
        try:
            identity = _extract_stored_packet_identity_from_entry(packet, packet_name)
        except (TypeError, ValueError):
            continue
        if packet_name is not None:
            index.setdefault(identity, packet_name)
    return index


def _legacy_packet_index(
    storage: Any,
    session_id: str,
) -> Dict[tuple[int, int], str]:
    try:
        with _LEGACY_PACKET_INDEX_GUARD:
            storage_indexes = _LEGACY_PACKET_INDEXES.get(storage)
            if storage_indexes is not None and session_id in storage_indexes:
                storage_indexes.move_to_end(session_id)
                return storage_indexes[session_id]
    except TypeError:
        return _build_legacy_packet_index(storage, session_id)

    index = _build_legacy_packet_index(storage, session_id)
    with _LEGACY_PACKET_INDEX_GUARD:
        storage_indexes = _LEGACY_PACKET_INDEXES.setdefault(storage, OrderedDict())
        storage_indexes[session_id] = index
        storage_indexes.move_to_end(session_id)
        while len(storage_indexes) > _MAX_LEGACY_SESSION_INDEXES:
            storage_indexes.popitem(last=False)
    return index


def _invalidate_legacy_packet_index(storage: Any, session_id: str) -> None:
    try:
        with _LEGACY_PACKET_INDEX_GUARD:
            storage_indexes = _LEGACY_PACKET_INDEXES.get(storage)
            if storage_indexes is not None:
                storage_indexes.pop(session_id, None)
    except TypeError:
        pass


def _stored_packet_for_identity(
    storage: Any,
    session_id: str,
    chunk_id: int,
    packet_index: int,
) -> Optional[bytes]:
    canonical_name = f"packet-{int(chunk_id):04x}-{int(packet_index):08x}.bin"
    packet_path_for = getattr(storage, "session_packet_path", None)
    if callable(packet_path_for):
        canonical_path = packet_path_for(session_id, canonical_name)
        if isinstance(canonical_path, Path) and canonical_path.exists():
            return canonical_path.read_bytes()

    identity = (int(chunk_id), int(packet_index))
    legacy_name = _legacy_packet_index(storage, session_id).get(identity)
    if legacy_name is not None and callable(packet_path_for):
        legacy_path = packet_path_for(session_id, legacy_name)
        if isinstance(legacy_path, Path) and legacy_path.exists():
            return legacy_path.read_bytes()
        _invalidate_legacy_packet_index(storage, session_id)
    return None


def _session_is_complete(session_meta: Mapping[str, Any]) -> bool:
    return bool(
        session_meta.get("completed")
        or session_meta.get("status") == "complete"
        or session_meta.get("completedAt")
    )


def _packet_commit_needs_repair(
    storage: Any,
    session: ScanSessionState,
    session_meta: Mapping[str, Any],
    packet_index: int,
    chunk_id: int,
) -> bool:
    def as_int(value: Any, default: int = 0) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    persisted_count = max(
        as_int(session_meta.get("receivedCount")),
        as_int(session_meta.get("receivedPackets")),
        as_int(session_meta.get("packetCount")),
    )
    try:
        durable_count = int(storage.count_packets(session.session_id))
    except (AttributeError, TypeError, ValueError):
        durable_count = persisted_count
    if persisted_count < durable_count:
        return True

    total_chunks = as_int(
        session_meta.get("totalChunks"),
        as_int(session.total_chunks, 1),
    )
    get_ranges = getattr(storage, "get_packet_ranges", None)
    if int(chunk_id) == 0 and total_chunks <= 1 and callable(get_ranges):
        try:
            ranges = get_ranges(session.session_id)
        except Exception:
            return True
        if not isinstance(ranges, list):
            return False
        return not any(
            as_int(start, -1) <= int(packet_index) <= as_int(end, -1)
            for start, end in ranges
        )
    return False


def _commit_binary_packet(
    storage: Any,
    session: ScanSessionState,
    payload: bytes,
    packet_index: int,
    chunk_id: int,
    chunk_meta: Optional[Dict[str, int]],
    *,
    lifecycle: Optional[_SessionCommitLifecycle] = None,
) -> str:
    """Commit a packet and its derived state as one process-local transaction."""
    lifecycle = lifecycle or _begin_session_commit(session.session_id)
    with lifecycle.holder.lock:
        if lifecycle.invalidated:
            return "deleted"
        session_meta = storage.read_session(session.session_id) or {}
        _hydrate_session_from_storage(session, session.session_id, storage)
        live_states = _register_live_session_state(storage, session)
        existing = _stored_packet_for_identity(
            storage, session.session_id, chunk_id, packet_index
        )
        if existing is not None:
            if existing != payload:
                return "conflict"
            needs_repair = _packet_commit_needs_repair(
                storage,
                session,
                session_meta,
                packet_index,
                chunk_id,
            )
            _observe_chunk_metadata_for_live_states(live_states, chunk_meta)
            _record_packet_for_live_states(live_states, packet_index, chunk_id)
            if not _session_is_complete(session_meta) and needs_repair:
                _persist_binary_packet_state(
                    storage,
                    session,
                    packet_index,
                    chunk_id,
                    session_meta=session_meta,
                )
                return "repaired"
            return "duplicate"
        if _session_is_complete(session_meta):
            return "completed"

        _observe_chunk_metadata_for_live_states(live_states, chunk_meta)

        persist_status = _persist_binary_packet(
            storage,
            session.session_id,
            payload,
            packet_index,
            chunk_id,
        )
        if persist_status != "new":
            return persist_status

        _record_packet_for_live_states(live_states, packet_index, chunk_id)
        _persist_binary_packet_state(
            storage,
            session,
            packet_index,
            chunk_id,
            session_meta=session_meta,
        )
        return "new"


def _persist_binary_packet(
    storage: Any,
    session_id: str,
    payload: bytes,
    packet_index: int,
    chunk_id: int = 0,
) -> str:
    save_identity = getattr(storage, "save_session_packet_identity", None)
    if callable(save_identity):
        save_result = save_identity(
            session_id, payload, int(chunk_id), int(packet_index)
        )
        if (
            isinstance(save_result, tuple)
            and len(save_result) >= 2
            and save_result[1] in {"new", "duplicate", "conflict"}
        ):
            return str(save_result[1])

    packet_hash = f"{int(chunk_id):04x}-{packet_index:08x}-{compute_hash(payload)}"
    save_result = storage.save_session_packet(session_id, payload, packet_hash)
    if isinstance(save_result, tuple) and len(save_result) >= 2:
        return "new" if bool(save_result[1]) else "duplicate"
    return "new"


def _persist_binary_packet_state(
    storage: Any,
    session: ScanSessionState,
    packet_index: int,
    chunk_id: int = 0,
    *,
    session_meta: Optional[Dict[str, Any]] = None,
) -> None:
    """Persist WS scan packet and update server-visible session metadata."""

    def _as_int(value: Any, default: int = 0) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    session_meta = dict(
        session_meta
        if session_meta is not None
        else (storage.read_session(session.session_id) or {})
    )
    session_meta.setdefault("sessionId", session.session_id)
    session_meta.setdefault("createdAt", utc_now())
    session_meta["updatedAt"] = utc_now()
    session_meta["status"] = session_meta.get("status") or "active"
    session_meta["encoding"] = WS_BINARY_ENCODING

    received_count = max(
        _as_int(session_meta.get("receivedCount", 0)),
        _as_int(session_meta.get("receivedPackets", 0)),
        _as_int(session.received_count, 0),
    )
    session_meta["receivedCount"] = received_count
    session_meta["receivedPackets"] = max(
        _as_int(session_meta.get("receivedPackets", 0)),
        received_count,
    )
    session_meta["packetCount"] = received_count
    session_meta["lastContiguous"] = max(
        _as_int(session_meta.get("lastContiguous", -1), -1),
        _as_int(session.last_contiguous, -1),
    )
    session_meta["chunkStates"] = session.get_chunk_states()

    if session.total_packets is not None:
        expected_packets = _as_int(session.total_packets, 0)
        session_meta["expectedPackets"] = expected_packets
    if session.reported_total_packets is not None:
        total_packets = _as_int(session.reported_total_packets, 0)
        session_meta["totalPackets"] = total_packets
    elif session.total_packets is not None:
        session_meta["totalPackets"] = _as_int(session.total_packets, 0)
    session_meta["totalPacketsExact"] = bool(session.total_packets_exact)

    if session.total_chunks is not None:
        total_chunks = _as_int(session.total_chunks, 0)
        session_meta["totalChunks"] = max(
            _as_int(session_meta.get("totalChunks", 0)),
            total_chunks,
        )

    if session.filename:
        session_meta["filename"] = session.filename
    if session.mime_type:
        session_meta["mimeType"] = session.mime_type
    if session.file_size is not None:
        session_meta["size"] = max(
            _as_int(session_meta.get("size", 0)),
            _as_int(session.file_size, 0),
        )
    if session.packet_size is not None:
        session_meta["packetSize"] = max(
            _as_int(session_meta.get("packetSize", 0)),
            _as_int(session.packet_size, 0),
        )
    if session.producer_device_id:
        session_meta["deviceId"] = session.producer_device_id
        session_meta["producerDeviceId"] = session.producer_device_id

    storage.write_session(session.session_id, session_meta)

    add_packet_range = getattr(storage, "add_packet_range", None)
    if callable(add_packet_range) and _as_int(session.total_chunks, 1) <= 1 and int(chunk_id) == 0:
        add_packet_range(session.session_id, packet_index, packet_index)


def _build_scan_progress_payload(
    session: ScanSessionState,
    storage: Optional[Any] = None,
) -> Dict[str, Any]:
    session_meta = storage.read_session(session.session_id) if storage is not None else None
    session_meta = session_meta or {}
    return {
        "origin": "scanned",
        "sessionId": session.session_id,
        "updatedAt": session_meta.get("updatedAt"),
        "completed": bool(session_meta.get("completed", False)),
        "deviceId": session_meta.get("deviceId") or session.producer_device_id,
        "deviceName": session_meta.get("deviceName"),
        "receivedPackets": session_meta.get("receivedCount", session.received_count),
        "expectedPackets": session_meta.get("expectedPackets", session.total_packets),
        "totalPackets": session_meta.get(
            "totalPackets",
            session.reported_total_packets or session.total_packets,
        ),
        "totalPacketsExact": bool(
            session_meta.get("totalPacketsExact", session.total_packets_exact)
        ),
        "receivedCount": session_meta.get("receivedCount", session.received_count),
        "filename": session_meta.get("filename") or session.filename,
    }


def _build_canonical_scan_session_state(
    session: ScanSessionState,
    storage: Optional[Any] = None,
) -> Dict[str, Any]:
    session_meta = storage.read_session(session.session_id) if storage is not None else None
    session_meta = dict(session_meta or {})
    session_meta.setdefault("sessionId", session.session_id)
    session_meta.setdefault("receivedCount", session.received_count)
    session_meta.setdefault("expectedPackets", session.total_packets)
    session_meta.setdefault("totalPackets", session.reported_total_packets)
    session_meta.setdefault("totalPacketsExact", session.total_packets_exact)
    session_meta.setdefault("totalChunks", session.total_chunks)
    session_meta.setdefault("chunkStates", session.get_chunk_states())
    session_meta.setdefault("filename", session.filename)
    return build_scan_session_state(
        session.session_id,
        session_meta,
        state_version=session.state_version,
        assembly=session.get_assembly_snapshot(),
    )


def _emit_canonical_scan_session_state(
    session: ScanSessionState,
    storage: Optional[Any] = None,
    *,
    emit_event: Optional[Callable[[str, dict[str, Any]], None]] = None,
    emit_history_event: Optional[Callable[[dict[str, Any]], None]] = None,
) -> Dict[str, Any]:
    canonical_payload = _build_canonical_scan_session_state(session, storage)
    _emit_scan_event(
        "scan-session-state",
        canonical_payload,
        emit_event=emit_event,
        emit_history_event=emit_history_event,
    )
    return canonical_payload


def _emit_scan_event(
    event_type: str,
    payload: Dict[str, Any],
    *,
    emit_event: Optional[Callable[[str, dict[str, Any]], None]] = None,
    emit_history_event: Optional[Callable[[dict[str, Any]], None]] = None,
) -> None:
    if emit_event is not None:
        try:
            emit_event(event_type, payload)
        except Exception as exc:
            logger.warning("Failed to emit %s WebSocket event: %s", event_type, exc)
    if emit_history_event is not None:
        try:
            emit_history_event({"type": event_type, **payload})
        except Exception as exc:
            logger.warning("Failed to emit history mirror for %s: %s", event_type, exc)


async def _send_packet_ack(
    websocket: Any,
    session: ScanSessionState,
    chunk_id: int,
    packet_index: int,
) -> None:
    """Acknowledge that a packet is durably stored and reflected in live state."""
    state = session.get_state_dict()
    await websocket.send(
        json.dumps(
            {
                "type": "packetAck",
                "sessionId": session.session_id,
                "stateVersion": state.get("stateVersion"),
                "receivedCount": state.get("receivedCount"),
                "lastContiguous": state.get("lastContiguous"),
                "missing": state.get("missing", []),
                "chunkStates": state.get("chunkStates", []),
                "totalExpected": state.get("totalExpected"),
                "totalPackets": state.get("totalPackets"),
                "totalPacketsExact": state.get("totalPacketsExact"),
                "acked": {
                    "chunkId": int(chunk_id),
                    "packetIndex": int(packet_index),
                },
                "windowSize": DEFAULT_WINDOW_SIZE,
            }
        )
    )


async def _send_error(
    websocket: Any,
    code: str,
    message: str,
    fatal: bool = False,
    extra: Optional[Dict[str, Any]] = None,
) -> None:
    """Send error message."""
    error = {
        "type": "error",
        "code": code,
        "message": message,
        "fatal": fatal,
    }
    if extra:
        error.update(extra)

    await websocket.send(json.dumps(error))
