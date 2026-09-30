from __future__ import annotations

import io
import threading
from http import HTTPStatus
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from sync_server.handler import SyncRequestHandler
from sync_server.routes_history import (
    handle_delete_session,
    handle_file_download,
    handle_history_all,
    handle_history_item,
    handle_history_item_download,
)
from sync_server.packet_assembler import WS_BINARY_ENCODING
from sync_server.sqlite_storage import SqliteStorage
from sync_server.storage import Storage
from sync_server.ws_scan_handler import _begin_session_commit, _commit_binary_packet
from sync_server.ws_scan_session import ScanSessionState, ScanSessionStore


def _make_storage(storage_dir: Path) -> Storage:
    storage = Storage(storage_dir)
    storage.ensure_dirs()
    return storage


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


def test_handle_history_all_merges_scanned_and_generated_entries(tmp_path: Path) -> None:
    storage = _make_storage(tmp_path / "storage")
    storage.write_session(
        "scan-1",
        {
            "sessionId": "scan-1",
            "filename": "scan.bin",
            "completed": True,
            "createdAt": "2026-04-02T09:00:00Z",
            "updatedAt": "2026-04-02T10:00:00Z",
        },
    )
    storage.write_history_item(
        "history-1",
        {
            "historyId": "history-1",
            "title": "archive",
            "createdAt": "2026-04-02T08:00:00Z",
            "updatedAt": "2026-04-02T11:00:00Z",
        },
    )

    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.storage = storage
    handler._require_auth = MagicMock(return_value=True)
    handler._send_json = MagicMock()
    handler.headers = {}
    handler.path = "/api/history"

    handle_history_all(handler)

    handler._send_json.assert_called_once()
    status, payload, headers = handler._send_json.call_args.args
    assert status == HTTPStatus.OK
    assert [entry["id"] for entry in payload] == ["history-1", "scan-1"]
    assert payload[0]["origin"] == "generated"
    assert payload[1]["origin"] == "scanned"
    assert headers["Cache-Control"] == "no-cache"
    assert headers["X-Total-Count"] == "2"


def test_handle_history_all_reconstructs_multichunk_incomplete_progress(tmp_path: Path) -> None:
    storage = _make_storage(tmp_path / "storage")
    storage.write_session(
        "scan-hetero",
        {
            "sessionId": "scan-hetero",
            "status": "active",
            "filename": "hetero.bin",
            "encoding": WS_BINARY_ENCODING,
            "totalChunks": 3,
            "expectedPackets": 1182,
            "totalPackets": 472,
            "receivedCount": 35,
            "createdAt": "2026-04-02T09:00:00Z",
            "updatedAt": "2026-04-02T10:00:00Z",
        },
    )

    packets = []
    for packet_index in range(20):
        packets.append(
            _build_streaming_packet(
                session_id=1774906017,
                chunk_id=0,
                total_chunks=3,
                packet_index=packet_index,
                total_size=200,
                packet_size=10,
                exact_chunk_packets=24,
            )
        )
    for packet_index in range(21):
        packets.append(
            _build_streaming_packet(
                session_id=1774906017,
                chunk_id=1,
                total_chunks=3,
                packet_index=packet_index,
                total_size=210,
                packet_size=10,
                exact_chunk_packets=24,
            )
        )
    for index, packet in enumerate(packets):
        storage.save_session_packet("scan-hetero", packet, f"{index:08x}-pkt")

    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.storage = storage
    handler._require_auth = MagicMock(return_value=True)
    handler._send_json = MagicMock()
    handler.headers = {}
    handler.path = "/api/history?origin=scanned"

    handle_history_all(handler)

    handler._send_json.assert_called_once()
    status, payload, headers = handler._send_json.call_args.args
    assert status == HTTPStatus.OK
    assert headers["X-Total-Count"] == "1"
    assert len(payload) == 1
    assert payload[0]["id"] == "scan-hetero"
    assert payload[0]["origin"] == "scanned"
    assert payload[0]["receivedCount"] == 41
    assert payload[0]["receivedPackets"] == 41
    assert payload[0]["expectedPackets"] == 1182
    assert payload[0]["totalPackets"] == 472
    _assert_chunk_states_contain(payload[0]["chunkStates"], [
        {
            "chunkId": 0,
            "receivedCount": 20,
            "lastContiguous": 19,
            "missing": [],
            "expectedPackets": 20,
            "totalPackets": 24,
            "totalPacketsExact": True,
        },
        {
            "chunkId": 1,
            "receivedCount": 21,
            "lastContiguous": 20,
            "missing": [],
            "expectedPackets": 21,
            "totalPackets": 24,
            "totalPacketsExact": True,
        },
    ])


def test_handle_history_all_prefers_durable_packet_counts_over_stale_session_row(
    tmp_path: Path,
) -> None:
    storage = _make_storage(tmp_path / "storage")
    storage.write_session(
        "scan-stale",
        {
            "sessionId": "scan-stale",
            "status": "active",
            "filename": "stale.bin",
            "encoding": WS_BINARY_ENCODING,
            "totalChunks": 2,
            "expectedPackets": 12,
            "totalPackets": 8,
            "receivedCount": 99,
            "receivedPackets": 99,
            "packetCount": 99,
            "lastContiguous": 98,
            "createdAt": "2026-04-02T09:00:00Z",
            "updatedAt": "2026-04-02T10:00:00Z",
        },
    )

    packets = [
        _build_streaming_packet(
            session_id=1774907001,
            chunk_id=0,
            total_chunks=2,
            packet_index=4,
            total_size=60,
            packet_size=10,
            exact_chunk_packets=8,
        ),
        _build_streaming_packet(
            session_id=1774907001,
            chunk_id=0,
            total_chunks=2,
            packet_index=5,
            total_size=60,
            packet_size=10,
            exact_chunk_packets=8,
        ),
        _build_streaming_packet(
            session_id=1774907001,
            chunk_id=1,
            total_chunks=2,
            packet_index=1,
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
    handler.headers = {}
    handler.path = "/api/history?origin=scanned"

    handle_history_all(handler)

    handler._send_json.assert_called_once()
    status, payload, headers = handler._send_json.call_args.args
    assert status == HTTPStatus.OK
    assert headers["X-Total-Count"] == "1"
    assert payload[0]["id"] == "scan-stale"
    assert payload[0]["receivedCount"] == 3
    assert payload[0]["receivedPackets"] == 3
    assert payload[0]["packetCount"] == 3
    assert payload[0]["lastContiguous"] == -1
    _assert_chunk_states_contain(payload[0]["chunkStates"], [
        {
            "chunkId": 0,
            "receivedCount": 2,
            "lastContiguous": -1,
            "missing": [[0, 3]],
            "expectedPackets": 6,
            "totalPackets": 8,
            "totalPacketsExact": True,
        },
        {
            "chunkId": 1,
            "receivedCount": 1,
            "lastContiguous": -1,
            "missing": [[0, 0]],
            "expectedPackets": 6,
            "totalPackets": 8,
            "totalPacketsExact": True,
        },
    ])


def test_handle_history_all_prefers_durable_packet_counts_over_live_session_state(
    tmp_path: Path,
) -> None:
    storage = _make_storage(tmp_path / "storage")
    storage.write_session(
        "scan-live-stale",
        {
            "sessionId": "scan-live-stale",
            "status": "active",
            "filename": "live-stale.bin",
            "encoding": WS_BINARY_ENCODING,
            "totalChunks": 2,
            "expectedPackets": 12,
            "totalPackets": 8,
            "createdAt": "2026-04-02T09:00:00Z",
            "updatedAt": "2026-04-02T10:00:00Z",
        },
    )
    storage.save_session_packet(
        "scan-live-stale",
        _build_streaming_packet(
            session_id=1774907301,
            chunk_id=0,
            total_chunks=2,
            packet_index=27,
            total_size=60,
            packet_size=10,
            exact_chunk_packets=8,
        ),
        "00000000-pkt",
    )
    storage.save_session_packet(
        "scan-live-stale",
        _build_streaming_packet(
            session_id=1774907301,
            chunk_id=1,
            total_chunks=2,
            packet_index=408,
            total_size=60,
            packet_size=10,
            exact_chunk_packets=8,
        ),
        "00000001-pkt",
    )

    session_store = ScanSessionStore()
    live_session = session_store.get_or_create("scan-live-stale")
    live_session.set_metadata(
        filename="live-stale.bin",
        mime_type="application/octet-stream",
        expected_packets=12,
        total_packets=8,
        total_chunks=2,
        packet_size=10,
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
    handler.headers = {}
    handler.path = "/api/history?origin=scanned"

    handle_history_all(handler)

    handler._send_json.assert_called_once()
    status, payload, headers = handler._send_json.call_args.args
    assert status == HTTPStatus.OK
    assert headers["X-Total-Count"] == "1"
    assert payload[0]["id"] == "scan-live-stale"
    assert payload[0]["receivedCount"] == 2
    assert payload[0]["packetCount"] == 2
    assert payload[0]["lastContiguous"] == -1
    _assert_chunk_states_contain(payload[0]["chunkStates"], [
        {
            "chunkId": 0,
            "receivedCount": 1,
            "lastContiguous": -1,
            "missing": [[0, 26]],
            "expectedPackets": 6,
            "totalPackets": 8,
            "totalPacketsExact": True,
        },
        {
            "chunkId": 1,
            "receivedCount": 1,
            "lastContiguous": -1,
            "missing": [[0, 407]],
            "expectedPackets": 6,
            "totalPackets": 8,
            "totalPacketsExact": True,
        },
    ])


def test_handle_history_item_download_streams_attachment(tmp_path: Path) -> None:
    storage = _make_storage(tmp_path / "storage")
    file_path = storage.history_dir("history-1") / "files" / "archive.zip"
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_bytes(b"zip-bytes")
    storage.write_history_item(
        "history-1",
        {
            "historyId": "history-1",
            "filename": "archive.zip",
            "mimeType": "application/zip",
            "filePath": str(file_path.relative_to(storage.base_dir)),
        },
    )

    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.storage = storage
    handler._require_auth = MagicMock(return_value=True)
    handler._send_json = MagicMock()
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()
    handler.wfile = io.BytesIO()

    handle_history_item_download(handler, "history-1")

    handler.send_response.assert_called_once_with(HTTPStatus.OK)
    assert handler.wfile.getvalue() == b"zip-bytes"
    content_types = [call.args for call in handler.send_header.call_args_list]
    assert ("Content-Type", "application/zip") in content_types


def test_handle_file_download_streams_scan_attachment(tmp_path: Path) -> None:
    storage = _make_storage(tmp_path / "storage")
    file_path = storage.session_dir("scan-1") / "files" / "scan.bin"
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_bytes(b"scan-bytes")
    storage.write_session(
        "scan-1",
        {
            "sessionId": "scan-1",
            "filename": "scan.bin",
            "mimeType": "application/octet-stream",
            "filePath": str(file_path.relative_to(storage.base_dir)),
        },
    )

    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.storage = storage
    handler._require_auth = MagicMock(return_value=True)
    handler._send_json = MagicMock()
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()
    handler.wfile = io.BytesIO()

    handle_file_download(handler, "scan-1")

    handler.send_response.assert_called_once_with(HTTPStatus.OK)
    assert handler.wfile.getvalue() == b"scan-bytes"
    content_types = [call.args for call in handler.send_header.call_args_list]
    assert ("Content-Type", "application/octet-stream") in content_types


def test_handle_delete_session_emits_delete_events(tmp_path: Path) -> None:
    storage = _make_storage(tmp_path / "storage")
    storage.write_session(
        "scan-1",
        {
            "sessionId": "scan-1",
            "filename": "scan.bin",
            "completed": False,
        },
    )

    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.storage = storage
    handler._require_auth = MagicMock(return_value=True)
    handler._send_json = MagicMock()
    handler._emit_event = MagicMock()
    handler._emit_history_event = MagicMock()

    handle_delete_session(handler, "scan-1")

    assert storage.read_session("scan-1") is None
    handler._emit_event.assert_called_once_with(
        "delete",
        {"origin": "scanned", "sessionId": "scan-1"},
    )
    handler._emit_history_event.assert_called_once_with(
        {"type": "delete", "origin": "scanned", "sessionId": "scan-1"},
    )
    handler._send_json.assert_called_once_with(HTTPStatus.OK, {"ok": True})


@pytest.mark.parametrize(
    "storage_type",
    [Storage, SqliteStorage],
    ids=["filesystem", "sqlite"],
)
def test_delete_session_waits_for_in_flight_packet_commit(
    tmp_path: Path,
    storage_type: type[Storage] | type[SqliteStorage],
) -> None:
    """A delete started during a packet commit must run after that commit."""

    class CoordinatedStorage(storage_type):  # type: ignore[valid-type,misc]
        def __init__(self, base_dir: Path) -> None:
            super().__init__(base_dir)
            self.block_session_write = False
            self.session_write_entered = threading.Event()
            self.release_session_write = threading.Event()
            self.delete_entered = threading.Event()

        def write_session(self, session_id: str, session: dict[str, object]) -> None:
            if self.block_session_write:
                self.session_write_entered.set()
                assert self.release_session_write.wait(timeout=2.0)
            super().write_session(session_id, session)

        def delete_session(self, session_id: str) -> bool:
            self.delete_entered.set()
            return super().delete_session(session_id)

    session_id = "scan-delete-race"
    storage = CoordinatedStorage(tmp_path / storage_type.__name__)
    storage.ensure_dirs()
    storage.write_session(
        session_id,
        {"sessionId": session_id, "status": "active"},
    )
    storage.block_session_write = True

    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.storage = storage
    delete_authenticated = threading.Event()

    def require_auth() -> bool:
        delete_authenticated.set()
        return True

    handler._require_auth = MagicMock(side_effect=require_auth)
    handler._send_json = MagicMock()
    handler._emit_event = MagicMock()
    handler._emit_history_event = MagicMock()

    commit_results: list[str] = []
    commit_errors: list[BaseException] = []

    def commit_packet() -> None:
        try:
            commit_results.append(
                _commit_binary_packet(
                    storage,
                    ScanSessionState(session_id),
                    b"packet",
                    0,
                    0,
                    None,
                )
            )
        except BaseException as exc:
            commit_errors.append(exc)

    commit_thread = threading.Thread(
        target=commit_packet,
        daemon=True,
    )
    delete_thread = threading.Thread(
        target=handle_delete_session,
        args=(handler, session_id),
        daemon=True,
    )

    commit_thread.start()
    assert storage.session_write_entered.wait(timeout=1.0)
    delete_thread.start()
    assert delete_authenticated.wait(timeout=1.0)
    deleted_while_commit_blocked = storage.delete_entered.wait(timeout=0.2)

    storage.release_session_write.set()
    commit_thread.join(timeout=2.0)
    delete_thread.join(timeout=2.0)

    assert not commit_thread.is_alive()
    assert not delete_thread.is_alive()
    assert deleted_while_commit_blocked is False
    assert commit_errors == []
    assert commit_results == ["new"]
    assert storage.read_session(session_id) is None
    assert storage.count_packets(session_id) == 0
    handler._send_json.assert_called_once_with(HTTPStatus.OK, {"ok": True})


@pytest.mark.parametrize(
    "storage_type",
    [Storage, SqliteStorage],
    ids=["filesystem", "sqlite"],
)
def test_delete_session_invalidates_packet_commit_already_waiting_for_lock(
    tmp_path: Path,
    storage_type: type[Storage] | type[SqliteStorage],
) -> None:
    """DELETE wins over a packet commit that started before it completed."""

    class CoordinatedStorage(storage_type):  # type: ignore[valid-type,misc]
        def __init__(self, base_dir: Path) -> None:
            super().__init__(base_dir)
            self.delete_entered = threading.Event()
            self.release_delete = threading.Event()

        def delete_session(self, session_id: str) -> bool:
            self.delete_entered.set()
            assert self.release_delete.wait(timeout=2.0)
            return super().delete_session(session_id)

    session_id = "scan-delete-first-race"
    storage = CoordinatedStorage(tmp_path / f"delete-first-{storage_type.__name__}")
    storage.ensure_dirs()
    storage.write_session(
        session_id,
        {"sessionId": session_id, "status": "active"},
    )

    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.storage = storage
    handler._require_auth = MagicMock(return_value=True)
    handler._send_json = MagicMock()
    handler._emit_event = MagicMock()
    handler._emit_history_event = MagicMock()

    commit_started = threading.Event()
    lifecycle_captured = threading.Event()
    commit_results: list[str] = []
    commit_errors: list[BaseException] = []

    def commit_packet() -> None:
        commit_started.set()
        try:
            commit_results.append(
                _commit_binary_packet(
                    storage,
                    ScanSessionState(session_id),
                    b"stale-packet",
                    0,
                    0,
                    None,
                )
            )
        except BaseException as exc:
            commit_errors.append(exc)

    delete_thread = threading.Thread(
        target=handle_delete_session,
        args=(handler, session_id),
        daemon=True,
    )
    commit_thread = threading.Thread(target=commit_packet, daemon=True)

    delete_thread.start()
    assert storage.delete_entered.wait(timeout=1.0)
    original_begin = _begin_session_commit

    def begin_commit(session_id: str):  # type: ignore[no-untyped-def]
        lifecycle = original_begin(session_id)
        lifecycle_captured.set()
        return lifecycle

    with patch(
        "sync_server.ws_scan_handler._begin_session_commit",
        side_effect=begin_commit,
    ):
        commit_thread.start()
        assert commit_started.wait(timeout=1.0)
        assert lifecycle_captured.wait(timeout=1.0)
        assert commit_thread.is_alive()

    storage.release_delete.set()
    delete_thread.join(timeout=2.0)
    commit_thread.join(timeout=2.0)

    assert not delete_thread.is_alive()
    assert not commit_thread.is_alive()
    assert commit_errors == []
    assert commit_results == ["deleted"]
    assert storage.read_session(session_id) is None
    assert storage.count_packets(session_id) == 0

    # A genuinely new operation that starts after DELETE may reuse the ID.
    new_commit = _commit_binary_packet(
        storage,
        ScanSessionState(session_id),
        b"new-packet",
        0,
        0,
        None,
    )
    assert new_commit == "new"
    assert storage.read_session(session_id) is not None
    assert storage.count_packets(session_id) == 1


def test_handle_history_item_accepts_binary_stream_payload(tmp_path: Path) -> None:
    storage = _make_storage(tmp_path / "storage")
    body = b"abcd"

    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.storage = storage
    handler.context.export_manager = MagicMock()
    handler._require_auth = MagicMock(return_value=True)
    handler._send_json = MagicMock()
    handler._emit_event = MagicMock()
    handler._emit_history_event = MagicMock()
    handler.path = (
        "/api/history/item"
        "?historyId=history-raw"
        "&title=generated.bin"
        "&filename=generated.bin"
        "&mimeType=application%2Foctet-stream"
        "&totalFrames=12"
        "&minFrames=7"
        "&chunkMinFrames=%5B3%2C4%5D"
        "&createdAt=2026-03-29T12%3A00%3A00Z"
        "&updatedAt=2026-03-29T12%3A01%3A00Z"
    )
    handler.headers = {
        "Content-Type": "application/octet-stream",
        "Content-Length": str(len(body)),
    }
    handler.rfile = io.BytesIO(body)
    handler._stream_request_body_to_file = SyncRequestHandler._stream_request_body_to_file.__get__(
        handler, SyncRequestHandler
    )

    handle_history_item(handler)

    handler._send_json.assert_called_once_with(HTTPStatus.OK, {"ok": True})
    item = storage.read_history_item("history-raw")
    assert item is not None
    assert item["filename"] == "generated.bin"
    assert item["mimeType"] == "application/octet-stream"
    assert item["totalFrames"] == 12
    assert item["minFrames"] == 7
    assert item["chunkMinFrames"] == [3, 4]


def test_handle_history_item_sanitizes_stream_upload_body_errors(tmp_path: Path) -> None:
    storage = _make_storage(tmp_path / "storage")
    body = b"abcd"

    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.storage = storage
    handler.context.export_manager = MagicMock()
    handler._require_auth = MagicMock(return_value=True)
    handler._send_json = MagicMock()
    handler._emit_event = MagicMock()
    handler._emit_history_event = MagicMock()
    handler.path = (
        "/api/history/item"
        "?historyId=history-raw"
        "&title=generated.bin"
        "&filename=generated.bin"
    )
    handler.headers = {
        "Content-Type": "application/octet-stream",
        "Content-Length": "invalid",
    }
    handler.rfile = io.BytesIO(body)
    handler._stream_request_body_to_file = SyncRequestHandler._stream_request_body_to_file.__get__(
        handler, SyncRequestHandler
    )

    handle_history_item(handler)

    handler._send_json.assert_called_once_with(
        HTTPStatus.BAD_REQUEST,
        {"error": "Invalid request body"},
    )
    assert storage.read_history_item("history-raw") is None
