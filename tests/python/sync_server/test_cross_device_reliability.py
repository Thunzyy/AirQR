"""Cross-device reliability integration tests.

These tests exercise the real HTTP + SSE + WebSocket stack against a live
in-process sync server. They validate counter consistency, deduplication,
and realtime broadcast behavior across simulated devices (web + flutter).
"""

from __future__ import annotations

import asyncio
import base64
import json
import queue
import socket
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest

from sync_server.app import ThreadedHTTPServer, run_ws_server
from sync_server.auth import AuthManager
from sync_server.events import EventHub
from sync_server.exporter import ExportManager
from sync_server.handler import ServerContext, create_handler
from sync_server.settings_store import SettingsStore
from sync_server.sqlite_storage import SqliteStorage
from sync_server.ws_events import WebSocketEventHub
from sync_server.ws_scan_protocol import build_binary_header, compute_crc32
from sync_server.ws_scan_session import ScanSessionStore

try:
    import websockets
except Exception:  # pragma: no cover - handled by skipif
    websockets = None


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _wait_for_port(host: str, port: int, timeout: float = 5.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.25):
                return
        except OSError:
            time.sleep(0.05)
    raise AssertionError(f"Port {host}:{port} did not become ready in {timeout}s")


def _packet_bytes(index: int, size: int = 810) -> bytes:
    seed = f"pkt-{index}-cross-device".encode("utf-8")
    payload = bytearray()
    while len(payload) < size:
        payload.extend(seed)
    return bytes(payload[:size])


def _streaming_packet_payload(
    *,
    session_id: int,
    chunk_id: int,
    total_chunks: int,
    packet_index: int,
    total_size: int,
    packet_size: int,
    exact_chunk_packets: int,
) -> bytes:
    packet_body = _packet_bytes((chunk_id * 1000) + packet_index)
    payload = bytearray()
    payload.append(2)
    payload.extend(session_id.to_bytes(4, "big", signed=False))
    payload.extend(chunk_id.to_bytes(4, "big", signed=False))
    payload.extend(total_chunks.to_bytes(4, "big", signed=False))
    payload.extend((0).to_bytes(8, "big", signed=False))
    payload.extend(total_size.to_bytes(4, "big", signed=False))
    payload.extend(packet_size.to_bytes(2, "big", signed=False))
    payload.extend(exact_chunk_packets.to_bytes(4, "big", signed=False))
    payload.extend(packet_index.to_bytes(4, "big", signed=False))
    payload.extend(packet_body)
    return bytes(payload)


def _json_request(
    method: str,
    url: str,
    payload: Optional[Dict[str, Any]] = None,
    headers: Optional[Dict[str, str]] = None,
) -> Tuple[int, Dict[str, Any]]:
    body = None
    merged_headers = {"Content-Type": "application/json"}
    if headers:
        merged_headers.update(headers)
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
    request = Request(url, data=body, method=method, headers=merged_headers)
    try:
        with urlopen(request, timeout=5) as response:
            raw = response.read().decode("utf-8")
            parsed = json.loads(raw) if raw else {}
            return int(response.status), parsed
    except HTTPError as exc:
        raw = exc.read().decode("utf-8")
        parsed = json.loads(raw) if raw else {}
        return int(exc.code), parsed


def _make_http_packet_payload(
    session_id: str,
    packet: bytes,
    expected_packets: int,
    device_name: str,
    device_id: str,
) -> Dict[str, Any]:
    return {
        "sessionId": session_id,
        "packetBase64": base64.b64encode(packet).decode("ascii"),
        "expectedPackets": expected_packets,
        "totalPackets": expected_packets,
        "receivedPackets": 0,  # server remains authoritative; clients can send stale values
        "filename": "cross-device-test.bin",
        "deviceName": device_name,
        "deviceId": device_id,
        "isStreaming": False,
    }


def _run_sse_listener(
    events_url: str,
    out_queue: "queue.Queue[Tuple[str, Dict[str, Any]]]",
    stop_event: threading.Event,
) -> None:
    request = Request(events_url, method="GET")
    try:
        with urlopen(request, timeout=10) as response:
            event_type: Optional[str] = None
            data_lines: list[str] = []
            while not stop_event.is_set():
                raw_line = response.readline()
                if not raw_line:
                    return
                line = raw_line.decode("utf-8").strip()
                if line.startswith("event:"):
                    event_type = line[6:].strip()
                elif line.startswith("data:"):
                    data_lines.append(line[5:].strip())
                elif line == "":
                    if event_type:
                        data_raw = "".join(data_lines) if data_lines else "{}"
                        try:
                            payload = json.loads(data_raw)
                        except json.JSONDecodeError:
                            payload = {}
                        out_queue.put((event_type, payload))
                    event_type = None
                    data_lines = []
    except Exception:
        return


def _next_event(
    q: "queue.Queue[Tuple[str, Dict[str, Any]]]",
    wanted_type: str,
    timeout: float = 5.0,
) -> Dict[str, Any]:
    deadline = time.time() + timeout
    while time.time() < deadline:
        remaining = max(0.05, deadline - time.time())
        try:
            event_type, payload = q.get(timeout=remaining)
        except queue.Empty:
            continue
        if event_type == wanted_type:
            return payload
    raise AssertionError(f"Did not receive SSE event '{wanted_type}' within {timeout}s")


@pytest.fixture()
def running_sync_server(tmp_path: Path) -> Dict[str, Any]:
    storage_dir = tmp_path / "storage"
    storage = SqliteStorage(storage_dir)
    storage.ensure_dirs()

    auth = AuthManager(tmp_path / "users.json")  # auth disabled (file missing)
    event_hub = EventHub()
    ws_hub = WebSocketEventHub()
    scan_session_store = ScanSessionStore()

    context = ServerContext(
        storage=storage,
        auth=auth,
        export_manager=ExportManager(storage_dir / "export_config.json", None),
        settings_store=SettingsStore(storage_dir / "app_settings.json"),
        event_hub=event_hub,
        ws_hub=ws_hub,
        allowed_origins=["*"],
        static_dir=None,
        verbose=False,
    )

    http_server = ThreadedHTTPServer(
        ("127.0.0.1", 0),
        create_handler(context),
        verbose=False,
        scan_session_store=scan_session_store,
    )
    http_port = int(http_server.server_address[1])
    http_thread = threading.Thread(target=http_server.serve_forever, daemon=True)
    http_thread.start()
    _wait_for_port("127.0.0.1", http_port)

    ws_port = _free_port()
    ws_thread = threading.Thread(
        target=run_ws_server,
        args=(
            ws_hub,
            scan_session_store,
            storage,
            "127.0.0.1",
            ws_port,
            auth,
            None,
        ),
        daemon=True,
    )
    ws_thread.start()
    _wait_for_port("127.0.0.1", ws_port)

    yield {
        "http_base_url": f"http://127.0.0.1:{http_port}",
        "ws_events_url": f"ws://127.0.0.1:{ws_port}/api/v1/ws/events",
        "ws_scan_base_url": f"ws://127.0.0.1:{ws_port}/api/v1/ws/scan",
    }

    http_server.shutdown()
    http_server.server_close()


def test_http_cross_device_keeps_one_session_and_monotonic_counter(
    running_sync_server: Dict[str, Any],
) -> None:
    base = running_sync_server["http_base_url"]
    session_id = "1771457942610"
    expected = 230

    # Device A (web/iPhone) uploads first packets.
    for idx in range(7):
        status, payload = _json_request(
            "POST",
            f"{base}/api/scan/packet",
            _make_http_packet_payload(
                session_id,
                _packet_bytes(idx),
                expected,
                device_name="iPhone-web",
                device_id="web-device-a",
            ),
        )
        assert status == 200
        assert payload.get("ok") is True

    # Device B (flutter/Android) resumes and continues same session.
    for idx in range(7, 14):
        status, payload = _json_request(
            "POST",
            f"{base}/api/scan/packet",
            _make_http_packet_payload(
                session_id,
                _packet_bytes(idx),
                expected,
                device_name="Android-flutter",
                device_id="flutter-device-b",
            ),
        )
        assert status == 200
        assert payload.get("ok") is True

    # Duplicate packet must not increase receivedCount.
    status, payload = _json_request(
        "POST",
        f"{base}/api/scan/packet",
        _make_http_packet_payload(
            session_id,
            _packet_bytes(13),
            expected,
            device_name="Android-flutter",
            device_id="flutter-device-b",
        ),
    )
    assert status == 200
    assert payload.get("ok") is True

    status, session = _json_request("GET", f"{base}/api/scan/session/{session_id}")
    assert status == 200
    assert session["sessionId"] == session_id
    assert session["completed"] is False
    assert session["receivedCount"] == 14
    assert session["expectedPackets"] == 230

    status, history_entries = _json_request("GET", f"{base}/api/history?origin=scanned")
    assert status == 200
    session_entry = next((entry for entry in history_entries if entry.get("sessionId") == session_id), None)
    assert session_entry is not None
    assert session_entry["receivedCount"] == 14
    assert session_entry["expectedPackets"] == 230
    assert session_entry["completed"] is False


def test_http_alternating_devices_progress_stays_monotonic(
    running_sync_server: Dict[str, Any],
) -> None:
    base = running_sync_server["http_base_url"]
    session_id = "1771458054321"
    expected = 230

    for idx in range(40):
        is_web = idx % 2 == 0
        status, payload = _json_request(
            "POST",
            f"{base}/api/scan/packet",
            _make_http_packet_payload(
                session_id,
                _packet_bytes(idx),
                expected,
                device_name="iPhone-web" if is_web else "Android-flutter",
                device_id="web-a" if is_web else "flutter-b",
            ),
        )
        assert status == 200
        assert payload.get("ok") is True

        # Checkpoints across alternating device uploads.
        if idx in {0, 1, 9, 19, 39}:
            status, session = _json_request("GET", f"{base}/api/scan/session/{session_id}")
            assert status == 200
            assert session["receivedCount"] == idx + 1
            assert session["expectedPackets"] == expected
            assert session["completed"] is False

def test_sse_emits_scan_progress_for_cross_device_upload(
    running_sync_server: Dict[str, Any],
) -> None:
    base = running_sync_server["http_base_url"]
    session_id = "1771458000000"

    events_queue: "queue.Queue[Tuple[str, Dict[str, Any]]]" = queue.Queue()
    stop_event = threading.Event()
    listener = threading.Thread(
        target=_run_sse_listener,
        args=(f"{base}/api/events", events_queue, stop_event),
        daemon=True,
    )
    listener.start()

    try:
        # Wait for initial handshake event to ensure listener is active.
        _next_event(events_queue, "hello", timeout=3.0)

        status, payload = _json_request(
            "POST",
            f"{base}/api/scan/packet",
            _make_http_packet_payload(
                session_id,
                _packet_bytes(1),
                expected_packets=230,
                device_name="iPhone-web",
                device_id="web-device-a",
            ),
        )
        assert status == 200
        assert payload.get("ok") is True

        progress = _next_event(events_queue, "scan-progress", timeout=5.0)
        assert progress["sessionId"] == session_id
        assert progress["receivedPackets"] == 1
        assert progress["expectedPackets"] == 230
    finally:
        stop_event.set()


async def _ws_recv_until(ws: Any, wanted_type: str, timeout: float = 5.0) -> Dict[str, Any]:
    deadline = time.time() + timeout
    while time.time() < deadline:
        remaining = max(0.05, deadline - time.time())
        raw = await asyncio.wait_for(ws.recv(), timeout=remaining)
        message = json.loads(raw)
        if message.get("type") == wanted_type:
            return message
    raise AssertionError(f"Did not receive WebSocket message '{wanted_type}' within {timeout}s")


async def _drain_packet_acks(ws: Any, expected_count: int) -> None:
    for _ in range(expected_count):
        ack = await _ws_recv_until(ws, "packetAck", timeout=5.0)
        assert ack["type"] == "packetAck"


def _fetch_packets_total_count(base_url: str, session_id: str) -> int:
    status, payload = _json_request("GET", f"{base_url}/api/scan/session/{session_id}/packets")
    assert status == 200
    return int(payload["totalCount"])


@pytest.mark.asyncio
@pytest.mark.skipif(websockets is None, reason="websockets dependency not available")
async def test_websocket_broadcasts_scan_progress_between_clients(
    running_sync_server: Dict[str, Any],
) -> None:
    events_url = running_sync_server["ws_events_url"]
    scan_base_url = running_sync_server["ws_scan_base_url"]
    http_base = running_sync_server["http_base_url"]
    session_id = "1771458100000"

    async with websockets.connect(
        f"{scan_base_url}/{session_id}"
    ) as producer, websockets.connect(events_url) as observer:
        await producer.send(
            json.dumps(
                {
                    "type": "hello",
                    "protocol": "airqr-scan",
                    "version": 1,
                    "clientId": "flutter-producer",
                }
            )
        )
        await observer.send(
            json.dumps(
                {
                    "type": "hello",
                    "protocol": "airqr-events",
                    "version": 1,
                    "clientId": "web-observer",
                }
            )
        )

        welcome_a = await _ws_recv_until(producer, "welcome", timeout=3.0)
        welcome_b = await _ws_recv_until(observer, "welcome", timeout=3.0)
        assert welcome_a["type"] == "welcome"
        assert welcome_b["type"] == "welcome"

        await producer.send(
            json.dumps(
                {
                    "type": "claimProducer",
                }
            )
        )
        producer_claimed = await _ws_recv_until(producer, "producerClaimed", timeout=3.0)
        assert producer_claimed["type"] == "producerClaimed"

        await producer.send(
            json.dumps(
                {
                    "type": "meta",
                    "expectedPackets": 230,
                    "totalPackets": 230,
                    "filename": "cross-device-test.bin",
                    "mimeType": "application/octet-stream",
                }
            )
        )
        meta_ack = await _ws_recv_until(producer, "metaAck", timeout=3.0)
        assert meta_ack["type"] == "metaAck"

        packet_payload = _packet_bytes(1)
        packet = build_binary_header(1, 0, 0, 0, compute_crc32(packet_payload)) + packet_payload
        await producer.send(packet)

        event = await _ws_recv_until(observer, "scan-progress", timeout=5.0)
        payload = event["payload"]
        assert payload["sessionId"] == session_id
        assert payload["receivedPackets"] == 1
        assert payload["expectedPackets"] == 230

    status, session = _json_request("GET", f"{http_base}/api/scan/session/{session_id}")
    assert status == 200
    assert session["receivedCount"] == 1


@pytest.mark.asyncio
@pytest.mark.skipif(websockets is None, reason="websockets dependency not available")
async def test_websocket_scan_accepts_parallel_producers_on_same_session(
    running_sync_server: Dict[str, Any],
) -> None:
    scan_base_url = running_sync_server["ws_scan_base_url"]
    http_base = running_sync_server["http_base_url"]
    session_id = "1771458109999"

    async with websockets.connect(
        f"{scan_base_url}/{session_id}"
    ) as producer_a, websockets.connect(f"{scan_base_url}/{session_id}") as producer_b:
        await producer_a.send(
            json.dumps(
                {
                    "type": "hello",
                    "protocol": "airqr-scan",
                    "version": 1,
                    "clientId": "scanner-a",
                }
            )
        )
        await producer_b.send(
            json.dumps(
                {
                    "type": "hello",
                    "protocol": "airqr-scan",
                    "version": 1,
                    "clientId": "scanner-b",
                }
            )
        )

        assert (await _ws_recv_until(producer_a, "welcome", timeout=3.0))["type"] == "welcome"
        assert (await _ws_recv_until(producer_b, "welcome", timeout=3.0))["type"] == "welcome"

        await producer_a.send(json.dumps({"type": "claimProducer"}))
        assert (
            await _ws_recv_until(producer_a, "producerClaimed", timeout=3.0)
        )["deviceId"] == "scanner-a"

        await producer_a.send(
            json.dumps(
                {
                    "type": "meta",
                    "expectedPackets": 2,
                    "totalPackets": 2,
                    "filename": "handoff.bin",
                    "mimeType": "application/octet-stream",
                }
            )
        )
        assert (await _ws_recv_until(producer_a, "metaAck", timeout=3.0))["type"] == "metaAck"

        await producer_b.send(json.dumps({"type": "claimProducer"}))
        assert (
            await _ws_recv_until(producer_b, "producerClaimed", timeout=3.0)
        )["deviceId"] == "scanner-b"
        with pytest.raises(asyncio.TimeoutError):
            await asyncio.wait_for(producer_a.recv(), timeout=0.25)

        packet_a_payload = _packet_bytes(0)
        packet_a = (
            build_binary_header(1, 0, 0, 0, compute_crc32(packet_a_payload))
            + packet_a_payload
        )
        await producer_a.send(packet_a)

        await producer_b.send(json.dumps({"type": "resume", "fromPacketIndex": 0}))
        resume = await _ws_recv_until(producer_b, "resumeState", timeout=3.0)
        assert resume["lastContiguous"] == 0
        assert resume["receivedCount"] == 1

        packet_b_payload = _packet_bytes(1)
        packet_b = (
            build_binary_header(1, 0, 0, 1, compute_crc32(packet_b_payload))
            + packet_b_payload
        )
        await producer_b.send(packet_b)

    status, session = _json_request("GET", f"{http_base}/api/scan/session/{session_id}")
    assert status == 200
    assert session["receivedCount"] == 2
    assert session["chunkStates"] == [
        {
            "chunkId": 0,
            "receivedCount": 2,
            "lastContiguous": 1,
            "missing": [],
        },
    ]
    assert session["lastContiguous"] == 1


@pytest.mark.asyncio
@pytest.mark.skipif(websockets is None, reason="websockets dependency not available")
async def test_websocket_scan_counts_same_local_packet_index_on_different_chunks(
    running_sync_server: Dict[str, Any],
) -> None:
    scan_base_url = running_sync_server["ws_scan_base_url"]
    http_base = running_sync_server["http_base_url"]
    session_id = "1771458112222"

    async with websockets.connect(
        f"{scan_base_url}/{session_id}"
    ) as producer_a, websockets.connect(f"{scan_base_url}/{session_id}") as producer_b:
        await producer_a.send(
            json.dumps(
                {
                    "type": "hello",
                    "protocol": "airqr-scan",
                    "version": 1,
                    "clientId": "scanner-a",
                }
            )
        )
        await producer_b.send(
            json.dumps(
                {
                    "type": "hello",
                    "protocol": "airqr-scan",
                    "version": 1,
                    "clientId": "scanner-b",
                }
            )
        )

        assert (await _ws_recv_until(producer_a, "welcome", timeout=3.0))["type"] == "welcome"
        assert (await _ws_recv_until(producer_b, "welcome", timeout=3.0))["type"] == "welcome"

        await producer_a.send(json.dumps({"type": "claimProducer"}))
        assert (
            await _ws_recv_until(producer_a, "producerClaimed", timeout=3.0)
        )["deviceId"] == "scanner-a"

        await producer_a.send(
            json.dumps(
                {
                    "type": "meta",
                    "expectedPackets": 772,
                    "totalPackets": 158,
                    "totalChunks": 6,
                    "filename": "multiview.bin",
                    "mimeType": "application/octet-stream",
                }
            )
        )
        assert (await _ws_recv_until(producer_a, "metaAck", timeout=3.0))["type"] == "metaAck"

        await producer_b.send(json.dumps({"type": "claimProducer"}))
        assert (
            await _ws_recv_until(producer_b, "producerClaimed", timeout=3.0)
        )["deviceId"] == "scanner-b"

        packet_chunk_0 = _packet_bytes(0)
        await producer_a.send(
            build_binary_header(1, 0, 0, 0, compute_crc32(packet_chunk_0))
            + packet_chunk_0
        )

        await producer_b.send(json.dumps({"type": "resume", "fromPacketIndex": 0}))
        resume = await _ws_recv_until(producer_b, "resumeState", timeout=3.0)
        assert resume["receivedCount"] == 1
        assert resume["chunkStates"] == [
            {
                "chunkId": 0,
                "receivedCount": 1,
                "lastContiguous": 0,
                "missing": [],
            }
        ]

        packet_chunk_1 = _packet_bytes(1)
        await producer_b.send(
            build_binary_header(1, 0, 1, 0, compute_crc32(packet_chunk_1))
            + packet_chunk_1
        )

    status, session = _json_request("GET", f"{http_base}/api/scan/session/{session_id}")
    assert status == 200
    assert session["receivedCount"] == 2
    assert _fetch_packets_total_count(http_base, session_id) == 2


@pytest.mark.asyncio
@pytest.mark.skipif(websockets is None, reason="websockets dependency not available")
async def test_websocket_multichunk_parallel_producers_keep_live_and_packet_store_counts_aligned(
    running_sync_server: Dict[str, Any],
) -> None:
    scan_base_url = running_sync_server["ws_scan_base_url"]
    http_base = running_sync_server["http_base_url"]
    session_id = "1771458113333"
    encoded_session_id = 1771458113

    async with websockets.connect(
        f"{scan_base_url}/{session_id}"
    ) as producer_a, websockets.connect(f"{scan_base_url}/{session_id}") as producer_b:
        for ws, client_id in ((producer_a, "scanner-a"), (producer_b, "scanner-b")):
            await ws.send(
                json.dumps(
                    {
                        "type": "hello",
                        "protocol": "airqr-scan",
                        "version": 1,
                        "clientId": client_id,
                    }
                )
            )
            assert (await _ws_recv_until(ws, "welcome", timeout=3.0))["type"] == "welcome"
            await ws.send(json.dumps({"type": "claimProducer"}))
            assert (await _ws_recv_until(ws, "producerClaimed", timeout=3.0))["type"] == "producerClaimed"

        await producer_a.send(
            json.dumps(
                {
                    "type": "meta",
                    "expectedPackets": 1182,
                    "totalPackets": 472,
                    "totalChunks": 3,
                    "filename": "multiview.bin",
                    "mimeType": "application/octet-stream",
                }
            )
        )
        assert (await _ws_recv_until(producer_a, "metaAck", timeout=3.0))["type"] == "metaAck"

        for packet_index in range(24):
            payload = _streaming_packet_payload(
                session_id=encoded_session_id,
                chunk_id=0,
                total_chunks=3,
                packet_index=packet_index,
                total_size=315200,
                packet_size=800,
                exact_chunk_packets=472,
            )
            frame = build_binary_header(1, 0, 0, packet_index, compute_crc32(payload)) + payload
            await producer_a.send(frame)

        for packet_index in range(18):
            payload = _streaming_packet_payload(
                session_id=encoded_session_id,
                chunk_id=1,
                total_chunks=3,
                packet_index=packet_index,
                total_size=315200,
                packet_size=800,
                exact_chunk_packets=472,
            )
            frame = build_binary_header(1, 0, 1, packet_index, compute_crc32(payload)) + payload
            await producer_b.send(frame)

        # A producer may close only after every durable commit has been acknowledged.
        await asyncio.gather(
            _drain_packet_acks(producer_a, 24),
            _drain_packet_acks(producer_b, 18),
        )

    status, session = _json_request("GET", f"{http_base}/api/scan/session/{session_id}")
    assert status == 200
    assert session["receivedCount"] == 42
    assert session["chunkStates"] == [
        {
            "chunkId": 0,
            "receivedCount": 24,
            "lastContiguous": 23,
            "missing": [],
                "expectedPackets": 394,
                "totalPackets": 472,
                "totalPacketsExact": True,
                "targetFrameCount": 370,
                "targetFrameRanges": [[24, 393]],
                "unseenFrameCount": 448,
                "unseenFrameRanges": [[24, 471]],
        },
        {
            "chunkId": 1,
            "receivedCount": 18,
            "lastContiguous": 17,
            "missing": [],
                "expectedPackets": 394,
                "totalPackets": 472,
                "totalPacketsExact": True,
                "targetFrameCount": 376,
                "targetFrameRanges": [[18, 393]],
                "unseenFrameCount": 454,
                "unseenFrameRanges": [[18, 471]],
        },
    ]
    assert _fetch_packets_total_count(http_base, session_id) == 42
