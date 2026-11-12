"""Tests for paged packet retrieval request handling."""

from __future__ import annotations

import base64
import io
from http import HTTPStatus
from pathlib import Path
from unittest.mock import MagicMock

from sync_server.handler import SyncRequestHandler
from sync_server.storage import Storage


def _make_handler(storage_dir: Path, *, path: str) -> tuple[MagicMock, Storage]:
    storage = Storage(storage_dir)
    storage.ensure_dirs()

    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.storage = storage
    handler._require_auth = MagicMock(return_value=True)
    handler._send_json = MagicMock()
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()
    handler.wfile = io.BytesIO()
    handler.path = path
    handler._handle_packets = SyncRequestHandler._handle_packets.__get__(
        handler, SyncRequestHandler
    )
    handler._send_bytes = SyncRequestHandler._send_bytes.__get__(
        handler, SyncRequestHandler
    )
    return handler, storage


def _decode_binary_packet_page(payload: bytes) -> tuple[int, int, int, list[bytes]]:
    assert payload[:4] == b"AQPK"
    assert payload[4] == 1
    offset = int.from_bytes(payload[5:9], "big", signed=False)
    packet_count = int.from_bytes(payload[9:13], "big", signed=False)
    total_count = int.from_bytes(payload[13:17], "big", signed=False)
    cursor = 17
    packets: list[bytes] = []
    for _ in range(packet_count):
        packet_length = int.from_bytes(payload[cursor : cursor + 4], "big", signed=False)
        cursor += 4
        packets.append(payload[cursor : cursor + packet_length])
        cursor += packet_length
    return offset, packet_count, total_count, packets


def test_handle_packets_returns_requested_page_metadata(tmp_path: Path) -> None:
    handler, storage = _make_handler(
        tmp_path / "storage",
        path="/api/scan/session/scan-1/packets?offset=1&limit=1",
    )

    storage.write_session(
        "scan-1",
        {
            "sessionId": "scan-1",
            "filename": "scan.bin",
            "receivedPackets": 3,
            "expectedPackets": 3,
            "totalPackets": 3,
        },
    )
    storage.save_session_packet("scan-1", b"a", "0001")
    storage.save_session_packet("scan-1", b"b", "0002")
    storage.save_session_packet("scan-1", b"c", "0003")

    handler._handle_packets("scan-1")

    handler._send_json.assert_called_once()
    status, payload = handler._send_json.call_args.args
    assert status == HTTPStatus.OK
    assert payload["sessionId"] == "scan-1"
    assert payload["offset"] == 1
    assert payload["packetCount"] == 1
    assert payload["totalCount"] == 3
    assert payload["packets"] == [base64.b64encode(b"b").decode("ascii")]
    assert payload["meta"]["filename"] == "scan.bin"


def test_handle_packets_returns_binary_page_payload_when_requested(tmp_path: Path) -> None:
    handler, storage = _make_handler(
        tmp_path / "storage",
        path="/api/scan/session/scan-1/packets?offset=1&limit=1&format=binary",
    )

    storage.write_session(
        "scan-1",
        {
            "sessionId": "scan-1",
            "filename": "scan.bin",
            "receivedPackets": 3,
            "expectedPackets": 3,
            "totalPackets": 3,
        },
    )
    storage.save_session_packet("scan-1", b"a", "0001")
    storage.save_session_packet("scan-1", b"b", "0002")
    storage.save_session_packet("scan-1", b"c", "0003")

    handler._handle_packets("scan-1")

    handler._send_json.assert_not_called()
    handler.send_response.assert_called_once_with(HTTPStatus.OK)
    offset, packet_count, total_count, packets = _decode_binary_packet_page(
        handler.wfile.getvalue()
    )
    assert offset == 1
    assert packet_count == 1
    assert total_count == 3
    assert packets == [b"b"]


def test_handle_packets_rejects_invalid_offset(tmp_path: Path) -> None:
    handler, _storage = _make_handler(
        tmp_path / "storage",
        path="/api/scan/session/scan-1/packets?offset=-1",
    )

    handler._handle_packets("scan-1")

    handler._send_json.assert_called_once_with(
        HTTPStatus.BAD_REQUEST,
        {"error": "Invalid offset"},
    )
