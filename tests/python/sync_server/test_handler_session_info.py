"""Tests for scan session info request handling."""

from __future__ import annotations

from http import HTTPStatus
from pathlib import Path
from unittest.mock import MagicMock

from sync_server.handler import SyncRequestHandler
from sync_server.routes_history import handle_scan_history
from sync_server.sqlite_storage import SqliteStorage
from sync_server.ws_scan_session import ScanSessionStore


def _build_streaming_packet(
    *,
    session_id: int,
    chunk_id: int,
    total_chunks: int,
    packet_index: int,
    total_size: int = 6,
    packet_size: int = 6,
    exact_chunk_packets: int = 12,
) -> bytes:
    payload = b"packet"

    data = bytearray()
    data.append(2)
    data.extend(session_id.to_bytes(4, "big", signed=False))
    data.extend(chunk_id.to_bytes(4, "big", signed=False))
    data.extend(total_chunks.to_bytes(4, "big", signed=False))
    data.extend((0).to_bytes(8, "big", signed=False))
    data.extend(total_size.to_bytes(4, "big", signed=False))
    data.extend(packet_size.to_bytes(2, "big", signed=False))
    data.extend(exact_chunk_packets.to_bytes(4, "big", signed=False))
    data.extend(packet_index.to_bytes(4, "big", signed=False))
    data.extend(payload)
    return bytes(data)


def _assert_chunk_states_contain(
    actual: list[dict[str, object]],
    expected: list[dict[str, object]],
) -> None:
    assert len(actual) == len(expected)
    for actual_chunk, expected_chunk in zip(actual, expected):
        for key, value in expected_chunk.items():
            assert actual_chunk.get(key) == value


def test_handle_session_info_reconstructs_chunk_states_from_stored_packets(
    tmp_path: Path,
) -> None:
    storage = SqliteStorage(tmp_path / "storage")
    storage.ensure_dirs()
    storage.write_session(
        "scan-1",
        {
            "sessionId": "scan-1",
            "status": "active",
            "filename": "scan.bin",
            "totalChunks": 3,
            "receivedCount": 2,
        },
    )
    storage.save_session_packet(
        "scan-1",
        _build_streaming_packet(
            session_id=1774902900,
            chunk_id=0,
            total_chunks=3,
            packet_index=0,
        ),
        "00000000-a",
    )
    storage.save_session_packet(
        "scan-1",
        _build_streaming_packet(
            session_id=1774902900,
            chunk_id=2,
            total_chunks=3,
            packet_index=5,
        ),
        "00000005-b",
    )

    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.storage = storage
    handler._require_auth = MagicMock(return_value=True)
    handler._send_json = MagicMock()
    handler._handle_session_info = SyncRequestHandler._handle_session_info.__get__(
        handler, SyncRequestHandler
    )

    handler._handle_session_info("scan-1")

    handler._send_json.assert_called_once()
    status, payload = handler._send_json.call_args.args
    assert status == HTTPStatus.OK
    assert payload["sessionId"] == "scan-1"
    _assert_chunk_states_contain(payload["chunkStates"], [
        {
            "chunkId": 0,
            "receivedCount": 1,
            "lastContiguous": 0,
            "missing": [],
            "expectedPackets": 1,
            "totalPackets": 12,
            "totalPacketsExact": True,
        },
        {
            "chunkId": 2,
            "receivedCount": 1,
            "lastContiguous": -1,
            "missing": [[0, 4]],
            "expectedPackets": 1,
            "totalPackets": 12,
            "totalPacketsExact": True,
        },
    ])


def test_handle_session_info_prefers_live_scan_session_state() -> None:
    session_store = ScanSessionStore()
    live_session = session_store.get_or_create("scan-live")
    live_session.set_metadata(
        filename="live.bin",
        mime_type="application/octet-stream",
        expected_packets=772,
        total_packets=1181,
        total_chunks=3,
        packet_size=250,
    )
    assert live_session.record_packet(0, 0) is True
    assert live_session.record_packet(5, 2) is True

    storage = MagicMock()
    storage.read_session.return_value = {
        "sessionId": "scan-live",
        "status": "active",
        "filename": "stale.bin",
        "receivedCount": 1,
    }
    storage.list_packet_entries.return_value = None

    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.storage = storage
    handler.server = MagicMock()
    handler.server.scan_session_store = session_store
    handler._require_auth = MagicMock(return_value=True)
    handler._send_json = MagicMock()
    handler._handle_session_info = SyncRequestHandler._handle_session_info.__get__(
        handler, SyncRequestHandler
    )

    handler._handle_session_info("scan-live")

    storage.list_packet_entries.assert_called_once_with("scan-live")
    handler._send_json.assert_called_once()
    status, payload = handler._send_json.call_args.args
    assert status == HTTPStatus.OK
    assert payload["filename"] == "live.bin"
    assert payload["receivedCount"] == 2
    assert payload["totalChunks"] == 3
    _assert_chunk_states_contain(payload["chunkStates"], [
        {
            "chunkId": 0,
            "receivedCount": 1,
            "lastContiguous": 0,
            "missing": [],
        },
        {
            "chunkId": 2,
            "receivedCount": 1,
            "lastContiguous": -1,
            "missing": [[0, 4]],
        },
    ])


def test_handle_session_info_reconstructs_chunk_aware_thresholds_from_stored_packets(
    tmp_path: Path,
) -> None:
    storage = SqliteStorage(tmp_path / "storage")
    storage.ensure_dirs()
    storage.write_session(
        "scan-hetero",
        {
            "sessionId": "scan-hetero",
            "status": "active",
            "filename": "hetero.bin",
            "totalChunks": 3,
            "expectedPackets": 6,
            "totalPackets": 5,
            "receivedCount": 5,
        },
    )

    packets = [
        _build_streaming_packet(
            session_id=1774906017,
            chunk_id=0,
            total_chunks=3,
            packet_index=0,
            total_size=20,
            packet_size=10,
            exact_chunk_packets=5,
        ),
        _build_streaming_packet(
            session_id=1774906017,
            chunk_id=0,
            total_chunks=3,
            packet_index=1,
            total_size=20,
            packet_size=10,
            exact_chunk_packets=5,
        ),
        _build_streaming_packet(
            session_id=1774906017,
            chunk_id=1,
            total_chunks=3,
            packet_index=0,
            total_size=20,
            packet_size=10,
            exact_chunk_packets=5,
        ),
        _build_streaming_packet(
            session_id=1774906017,
            chunk_id=1,
            total_chunks=3,
            packet_index=1,
            total_size=20,
            packet_size=10,
            exact_chunk_packets=5,
        ),
        _build_streaming_packet(
            session_id=1774906017,
            chunk_id=2,
            total_chunks=3,
            packet_index=0,
            total_size=10,
            packet_size=10,
            exact_chunk_packets=3,
        ),
    ]
    for index, packet in enumerate(packets):
        storage.save_session_packet("scan-hetero", packet, f"{index:08x}-pkt")

    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.storage = storage
    handler._require_auth = MagicMock(return_value=True)
    handler._send_json = MagicMock()
    handler._handle_session_info = SyncRequestHandler._handle_session_info.__get__(
        handler, SyncRequestHandler
    )

    handler._handle_session_info("scan-hetero")

    handler._send_json.assert_called_once()
    status, payload = handler._send_json.call_args.args
    assert status == HTTPStatus.OK
    assert payload["sessionId"] == "scan-hetero"
    assert payload["expectedPackets"] == 5
    assert payload["totalPackets"] == 13
    _assert_chunk_states_contain(payload["chunkStates"], [
        {
            "chunkId": 0,
            "receivedCount": 2,
            "lastContiguous": 1,
            "missing": [],
            "expectedPackets": 2,
            "totalPackets": 5,
            "totalPacketsExact": True,
        },
        {
            "chunkId": 1,
            "receivedCount": 2,
            "lastContiguous": 1,
            "missing": [],
            "expectedPackets": 2,
            "totalPackets": 5,
            "totalPacketsExact": True,
        },
        {
            "chunkId": 2,
            "receivedCount": 1,
            "lastContiguous": 0,
            "missing": [],
            "expectedPackets": 1,
            "totalPackets": 3,
            "totalPacketsExact": True,
        },
    ])


def test_handle_session_info_skips_chunk_reconstruction_for_non_streaming_ws_payloads(
    tmp_path: Path,
) -> None:
    storage = SqliteStorage(tmp_path / "storage")
    storage.ensure_dirs()
    storage.write_session(
        "scan-ws-raw",
        {
            "sessionId": "scan-ws-raw",
            "status": "active",
            "filename": "scan.bin",
            "encoding": "ws-binary-v1",
            "expectedPackets": 230,
            "totalPackets": 230,
            "receivedCount": 1,
        },
    )
    storage.save_session_packet(
        "scan-ws-raw",
        b"raw-file-payload-without-transport-metadata",
        "raw-packet",
    )

    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.storage = storage
    handler._require_auth = MagicMock(return_value=True)
    handler._send_json = MagicMock()
    handler._handle_session_info = SyncRequestHandler._handle_session_info.__get__(
        handler, SyncRequestHandler
    )

    handler._handle_session_info("scan-ws-raw")

    handler._send_json.assert_called_once()
    status, payload = handler._send_json.call_args.args
    assert status == HTTPStatus.OK
    assert payload["sessionId"] == "scan-ws-raw"
    assert payload["receivedCount"] == 1
    assert payload["expectedPackets"] == 230
    assert payload.get("chunkStates") in (None, [])


def test_handle_session_info_reconstructs_chunk_identity_from_ws_packet_filename(
    tmp_path: Path,
) -> None:
    storage = SqliteStorage(tmp_path / "storage")
    storage.ensure_dirs()
    storage.write_session(
        "scan-ws-multichunk",
        {
            "sessionId": "scan-ws-multichunk",
            "status": "active",
            "filename": "multiview.bin",
            "encoding": "ws-binary-v1",
            "expectedPackets": 772,
            "totalPackets": 158,
            "totalChunks": 6,
            "receivedCount": 1,
        },
    )
    storage.save_session_packet(
        "scan-ws-multichunk",
        b"ABCDEF\x00\x00\x00\x07",
        "0001-00000000-from-filename",
    )

    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.storage = storage
    handler._require_auth = MagicMock(return_value=True)
    handler._send_json = MagicMock()
    handler._handle_session_info = SyncRequestHandler._handle_session_info.__get__(
        handler, SyncRequestHandler
    )

    handler._handle_session_info("scan-ws-multichunk")

    handler._send_json.assert_called_once()
    status, payload = handler._send_json.call_args.args
    assert status == HTTPStatus.OK
    assert payload["sessionId"] == "scan-ws-multichunk"
    assert payload["receivedCount"] == 1
    assert payload["expectedPackets"] == 772
    _assert_chunk_states_contain(payload["chunkStates"], [
        {
            "chunkId": 1,
            "receivedCount": 1,
            "lastContiguous": 0,
            "missing": [],
        }
    ])


def test_handle_session_info_prefers_durable_packet_counts_over_stale_session_row(
    tmp_path: Path,
) -> None:
    storage = SqliteStorage(tmp_path / "storage")
    storage.ensure_dirs()
    storage.write_session(
        "scan-stale",
        {
            "sessionId": "scan-stale",
            "status": "active",
            "filename": "stale.bin",
            "totalChunks": 2,
            "expectedPackets": 12,
            "totalPackets": 8,
            "receivedCount": 354,
            "receivedPackets": 354,
            "packetCount": 354,
            "lastContiguous": 353,
        },
    )

    packets = [
        _build_streaming_packet(
            session_id=1774907201,
            chunk_id=0,
            total_chunks=2,
            packet_index=10,
            total_size=60,
            packet_size=10,
            exact_chunk_packets=8,
        ),
        _build_streaming_packet(
            session_id=1774907201,
            chunk_id=1,
            total_chunks=2,
            packet_index=2,
            total_size=60,
            packet_size=10,
            exact_chunk_packets=8,
        ),
    ]
    for index, packet in enumerate(packets):
        storage.save_session_packet("scan-stale", packet, f"{index:08x}-pkt")

    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.storage = storage
    handler._require_auth = MagicMock(return_value=True)
    handler._send_json = MagicMock()
    handler._handle_session_info = SyncRequestHandler._handle_session_info.__get__(
        handler, SyncRequestHandler
    )

    handler._handle_session_info("scan-stale")

    handler._send_json.assert_called_once()
    status, payload = handler._send_json.call_args.args
    assert status == HTTPStatus.OK
    assert payload["sessionId"] == "scan-stale"
    assert payload["receivedCount"] == 2
    assert payload["receivedPackets"] == 2
    assert payload["packetCount"] == 2
    assert payload["lastContiguous"] == -1
    _assert_chunk_states_contain(payload["chunkStates"], [
        {
            "chunkId": 0,
            "receivedCount": 1,
            "lastContiguous": -1,
            "missing": [[0, 9]],
            "expectedPackets": 6,
            "totalPackets": 8,
            "totalPacketsExact": True,
        },
        {
            "chunkId": 1,
            "receivedCount": 1,
            "lastContiguous": -1,
            "missing": [[0, 1]],
            "expectedPackets": 6,
            "totalPackets": 8,
            "totalPacketsExact": True,
        },
    ])


def test_handle_session_info_prefers_durable_packet_counts_over_live_session_state(
    tmp_path: Path,
) -> None:
    storage = SqliteStorage(tmp_path / "storage")
    storage.ensure_dirs()
    storage.write_session(
        "scan-live-stale",
        {
            "sessionId": "scan-live-stale",
            "status": "active",
            "filename": "live-stale.bin",
            "encoding": "ws-binary-v1",
            "totalChunks": 2,
            "expectedPackets": 12,
            "totalPackets": 8,
        },
    )
    storage.save_session_packet(
        "scan-live-stale",
        _build_streaming_packet(
            session_id=1774907401,
            chunk_id=0,
            total_chunks=2,
            packet_index=27,
        ),
        "00000000-a",
    )
    storage.save_session_packet(
        "scan-live-stale",
        _build_streaming_packet(
            session_id=1774907401,
            chunk_id=1,
            total_chunks=2,
            packet_index=408,
        ),
        "00000001-b",
    )

    session_store = ScanSessionStore()
    live_session = session_store.get_or_create("scan-live-stale")
    live_session.set_metadata(
        filename="live-stale.bin",
        mime_type="application/octet-stream",
        expected_packets=12,
        total_packets=8,
        total_chunks=2,
        packet_size=6,
    )
    for packet_index in range(35):
        assert live_session.record_packet(packet_index, 0) is True
    for packet_index in range(15):
        assert live_session.record_packet(packet_index, 1) is True

    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.storage = storage
    handler.server = MagicMock()
    handler.server.scan_session_store = session_store
    handler._require_auth = MagicMock(return_value=True)
    handler._send_json = MagicMock()
    handler._handle_session_info = SyncRequestHandler._handle_session_info.__get__(
        handler, SyncRequestHandler
    )

    handler._handle_session_info("scan-live-stale")

    handler._send_json.assert_called_once()
    status, payload = handler._send_json.call_args.args
    assert status == HTTPStatus.OK
    assert payload["sessionId"] == "scan-live-stale"
    assert payload["receivedCount"] == 2
    assert payload["receivedPackets"] == 2
    assert payload["packetCount"] == 2
    assert payload["lastContiguous"] == -1
    _assert_chunk_states_contain(payload["chunkStates"], [
        {
            "chunkId": 0,
            "receivedCount": 1,
            "lastContiguous": -1,
            "missing": [[0, 26]],
            "expectedPackets": 1,
            "totalPackets": 12,
            "totalPacketsExact": True,
        },
        {
            "chunkId": 1,
            "receivedCount": 1,
            "lastContiguous": -1,
            "missing": [[0, 407]],
            "expectedPackets": 1,
            "totalPackets": 12,
            "totalPacketsExact": True,
        },
    ])


def test_handle_session_info_returns_canonical_scan_state() -> None:
    session_store = ScanSessionStore()
    live_session = session_store.get_or_create("scan-state")
    live_session.set_metadata(expected_packets=2, total_chunks=1)
    assert live_session.record_packet(0, 0) is True
    assert live_session.record_packet(1, 0) is True

    storage = MagicMock()
    storage.read_session.return_value = {
        "sessionId": "scan-state",
        "status": "active",
        "filename": "scan.bin",
        "expectedPackets": 2,
        "receivedCount": 1,
        "totalChunks": 1,
    }
    storage.list_packets.return_value = None

    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.storage = storage
    handler.server = MagicMock()
    handler.server.scan_session_store = session_store
    handler._require_auth = MagicMock(return_value=True)
    handler._send_json = MagicMock()
    handler._handle_session_info = SyncRequestHandler._handle_session_info.__get__(
        handler,
        SyncRequestHandler,
    )

    handler._handle_session_info("scan-state")

    status, payload = handler._send_json.call_args.args
    assert status == HTTPStatus.OK
    assert payload["scanState"]["type"] == "scan-session-state"
    assert payload["scanState"]["sessionId"] == "scan-state"
    assert payload["scanState"]["receivedUnique"] == 2
    assert payload["scanState"]["decodeState"] == "threshold_reached"
    assert payload["receivedUnique"] == 2
    assert payload["decodeState"] == "threshold_reached"
    assert payload["decodeThreshold"] == 2
    assert payload["completionPercent"] == 99.9
    assert payload["fileAvailable"] is False
    assert payload["chunksMissing"] == 1
    assert payload["chunksComplete"] == 0
    assert payload["chunks"] == payload["scanState"]["chunks"]


def test_handle_scan_history_returns_canonical_scan_state_for_incomplete_rows() -> None:
    storage = MagicMock()
    storage.list_sessions.return_value = [
        {
            "sessionId": "scan-history",
            "status": "active",
            "filename": "history.bin",
            "expectedPackets": 4,
            "receivedCount": 2,
            "totalChunks": 1,
            "updatedAt": "2026-06-10T08:00:00Z",
        }
    ]

    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.storage = storage
    handler.headers = {}
    handler.path = "/api/scan/history"
    handler._require_auth = MagicMock(return_value=True)
    handler._send_json = MagicMock()

    handle_scan_history(handler)

    handler._send_json.assert_called_once()
    status, payload, _headers = handler._send_json.call_args.args
    assert status == HTTPStatus.OK
    assert len(payload) == 1
    entry = payload[0]
    assert entry["sessionId"] == "scan-history"
    assert entry["scanState"]["type"] == "scan-session-state"
    assert entry["scanState"]["receivedUnique"] == 2
    assert entry["receivedUnique"] == 2
    assert entry["decodeState"] == "scanning"
    assert entry["completionPercent"] == 50


def test_handle_scan_history_returns_canonical_scan_state_for_completed_rows() -> None:
    storage = MagicMock()
    storage.list_sessions.return_value = [
        {
            "sessionId": "scan-complete",
            "status": "complete",
            "completed": True,
            "filePath": "sessions/scan-complete/files/complete.bin",
            "filename": "complete.bin",
            "expectedPackets": 4,
            "receivedCount": 4,
            "totalChunks": 1,
            "updatedAt": "2026-06-10T08:00:00Z",
        }
    ]

    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.storage = storage
    handler.headers = {}
    handler.path = "/api/scan/history"
    handler._require_auth = MagicMock(return_value=True)
    handler._send_json = MagicMock()

    handle_scan_history(handler)

    handler._send_json.assert_called_once()
    status, payload, _headers = handler._send_json.call_args.args
    assert status == HTTPStatus.OK
    assert len(payload) == 1
    entry = payload[0]
    assert entry["sessionId"] == "scan-complete"
    assert entry["scanState"]["type"] == "scan-session-state"
    assert entry["scanState"]["decodeState"] == "complete"
    assert entry["scanState"]["fileAvailable"] is True
    assert entry["fileAvailable"] is True
    assert entry["completionPercent"] == 100
    assert entry["chunksMissing"] == 0


def test_handle_scan_history_filters_incomplete_before_applying_limit() -> None:
    storage = MagicMock()
    newer_completed = [
        {
            "sessionId": f"scan-complete-{index}",
            "completed": True,
            "updatedAt": f"2026-07-02T12:{index // 60:02d}:{index % 60:02d}Z",
        }
        for index in range(501)
    ]
    storage.list_sessions.return_value = [
        *newer_completed,
        {
            "sessionId": "scan-older-incomplete",
            "completed": False,
            "receivedCount": 7,
            "expectedPackets": 10,
            "updatedAt": "2026-06-24T13:11:46Z",
        },
    ]

    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.storage = storage
    handler.headers = {}
    handler.path = "/api/scan/history?completed=false&limit=1"
    handler._require_auth = MagicMock(return_value=True)
    handler._send_json = MagicMock()

    handle_scan_history(handler)

    status, payload, headers = handler._send_json.call_args.args
    assert status == HTTPStatus.OK
    assert [entry["sessionId"] for entry in payload] == ["scan-older-incomplete"]
    assert headers["X-Total-Count"] == "1"


def test_handle_scan_history_total_count_is_computed_before_pagination() -> None:
    storage = MagicMock()
    storage.list_sessions.return_value = [
        {
            "sessionId": f"scan-incomplete-{index}",
            "completed": False,
            "updatedAt": f"2026-07-02T12:00:{index:02d}Z",
        }
        for index in range(3)
    ]

    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.storage = storage
    handler.headers = {}
    handler.path = "/api/scan/history?completed=0&limit=1"
    handler._require_auth = MagicMock(return_value=True)
    handler._send_json = MagicMock()

    handle_scan_history(handler)

    status, payload, headers = handler._send_json.call_args.args
    assert status == HTTPStatus.OK
    assert len(payload) == 1
    assert headers["X-Total-Count"] == "3"
