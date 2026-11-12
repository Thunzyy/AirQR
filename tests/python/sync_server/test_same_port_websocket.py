from __future__ import annotations

import asyncio
import json
import socket
import ssl
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

from sync_server.app import create_server
from sync_server.auth import AuthManager, save_user
from sync_server.config import ServerConfig
from sync_server.events import EventHub
from sync_server.exporter import ExportManager
from sync_server.handler import ServerContext
from sync_server.settings_store import SettingsStore
from sync_server.sqlite_storage import SqliteStorage
from sync_server.ws_events import WebSocketEventHub

try:
    import websockets
except Exception:  # pragma: no cover - handled by skipif
    websockets = None

from sync_server.ws_scan_protocol import build_binary_header, compute_crc32


async def _drain_websocket_events(
    websocket: Any,
    *,
    timeout: float = 0.25,
) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    while True:
        try:
            raw = await asyncio.wait_for(websocket.recv(), timeout=timeout)
        except asyncio.TimeoutError:
            return events
        events.append(json.loads(raw))


async def _recv_websocket_event_type(
    websocket: Any,
    event_type: str,
    *,
    timeout: float = 3.0,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    skipped: list[dict[str, Any]] = []

    while True:
        remaining = deadline - loop.time()
        if remaining <= 0:
            raise asyncio.TimeoutError
        message = json.loads(
            await asyncio.wait_for(websocket.recv(), timeout=remaining)
        )
        if message.get("type") == event_type:
            return message, skipped
        skipped.append(message)


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


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


@pytest.fixture()
def same_port_sync_server(tmp_path: Path) -> dict[str, Any]:
    storage_dir = tmp_path / "storage"
    storage = SqliteStorage(storage_dir)
    storage.ensure_dirs()

    port = _free_port()
    context = ServerContext(
        storage=storage,
        auth=AuthManager(tmp_path / "users.json"),
        export_manager=ExportManager(storage_dir / "export_config.json", None),
        settings_store=SettingsStore(storage_dir / "app_settings.json"),
        event_hub=EventHub(),
        ws_hub=WebSocketEventHub(),
        allowed_origins=["*"],
        static_dir=None,
        verbose=False,
    )
    config = ServerConfig(
        host="127.0.0.1",
        port=port,
        storage_dir=storage_dir,
        static_dir=None,
        users_file=tmp_path / "users.json",
        allowed_origins=["*"],
        tls_cert=None,
        tls_key=None,
        export_dir=None,
        verbose=False,
        use_sqlite=True,
        ws_port=port,
    )

    server = create_server(config, context)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    _wait_for_port("127.0.0.1", port)

    yield {
        "port": port,
        "server": server,
    }

    server.shutdown()
    server.server_close()
    thread.join(timeout=2)


@pytest.mark.asyncio
@pytest.mark.skipif(websockets is None, reason="websockets dependency not available")
async def test_events_websocket_can_share_the_http_port(same_port_sync_server: dict[str, Any]) -> None:
    ws_url = f"ws://127.0.0.1:{same_port_sync_server['port']}/api/v1/ws/events"

    async with websockets.connect(ws_url) as websocket:
        await websocket.send(
            json.dumps(
                {
                    "type": "hello",
                    "protocol": "airqr-events",
                    "version": 1,
                    "clientId": "same-port-test",
                }
            )
        )

        raw = await asyncio.wait_for(websocket.recv(), timeout=3.0)
        message = json.loads(raw)

        assert message["type"] == "welcome"
        assert "clientId" in message


@pytest.mark.asyncio
@pytest.mark.skipif(websockets is None, reason="websockets dependency not available")
async def test_scan_websocket_can_share_the_http_port(same_port_sync_server: dict[str, Any]) -> None:
    session_id = "same-port-scan"
    ws_url = f"ws://127.0.0.1:{same_port_sync_server['port']}/api/v1/ws/scan/{session_id}"

    async with websockets.connect(ws_url) as websocket:
        await websocket.send(
            json.dumps(
                {
                    "type": "hello",
                    "protocol": "airqr-scan",
                    "version": 1,
                    "clientId": "same-port-scan-test",
                }
            )
        )

        raw = await asyncio.wait_for(websocket.recv(), timeout=3.0)
        message = json.loads(raw)

        assert message["type"] == "welcome"
        assert message["windowSize"] > 0
        assert message["sessionState"]["receivedCount"] == 0


@pytest.mark.asyncio
@pytest.mark.skipif(websockets is None, reason="websockets dependency not available")
async def test_scan_complete_from_scan_ws_is_broadcast_to_events_clients(
    same_port_sync_server: dict[str, Any]
) -> None:
    session_id = "same-port-scan-complete"
    base_url = f"ws://127.0.0.1:{same_port_sync_server['port']}"

    async with websockets.connect(f"{base_url}/api/v1/ws/events") as events_ws:
        await events_ws.send(
            json.dumps(
                {
                    "type": "hello",
                    "protocol": "airqr-events",
                    "version": 1,
                    "clientId": "history-listener",
                }
            )
        )
        welcome = json.loads(await asyncio.wait_for(events_ws.recv(), timeout=3.0))
        assert welcome["type"] == "welcome"

        async with websockets.connect(
            f"{base_url}/api/v1/ws/scan/{session_id}"
        ) as scan_ws:
            await scan_ws.send(
                json.dumps(
                    {
                        "type": "hello",
                        "protocol": "airqr-scan",
                        "version": 1,
                        "clientId": "scanner-device",
                    }
                )
            )
            welcome = json.loads(await asyncio.wait_for(scan_ws.recv(), timeout=3.0))
            assert welcome["type"] == "welcome"

            await scan_ws.send(json.dumps({"type": "claimProducer"}))
            producer_claimed = json.loads(
                await asyncio.wait_for(scan_ws.recv(), timeout=3.0)
            )
            assert producer_claimed["type"] == "producerClaimed"

            await scan_ws.send(
                json.dumps(
                    {
                        "type": "meta",
                        "filename": "scan-complete.bin",
                        "mimeType": "application/octet-stream",
                        "totalPackets": 1,
                    }
                )
            )
            meta_ack = json.loads(await asyncio.wait_for(scan_ws.recv(), timeout=3.0))
            assert meta_ack["type"] == "metaAck"

            await scan_ws.send(json.dumps({"type": "resume", "fromPacketIndex": 0}))
            resume_state = json.loads(
                await asyncio.wait_for(scan_ws.recv(), timeout=3.0)
            )
            assert resume_state["type"] == "resumeState"

            payload = b"scan packet payload"
            packet = build_binary_header(1, 0, 0, 0, compute_crc32(payload)) + payload
            await scan_ws.send(packet)

            first_ack, _ = await _recv_websocket_event_type(scan_ws, "packetAck")
            assert first_ack["acked"] == {"chunkId": 0, "packetIndex": 0}

            progress_event = json.loads(
                await asyncio.wait_for(events_ws.recv(), timeout=3.0)
            )
            assert progress_event["type"] == "scan-progress"
            assert progress_event["payload"]["sessionId"] == session_id

            pending_events = await _drain_websocket_events(events_ws)
            canonical_events = [
                event
                for event in pending_events
                if event["type"] == "scan-session-state"
            ]
            assert canonical_events
            assert all(
                event["payload"]["sessionId"] == session_id
                for event in canonical_events
            )

            await scan_ws.send(packet)
            retry_ack, _ = await _recv_websocket_event_type(scan_ws, "packetAck")
            assert retry_ack["acked"] == {"chunkId": 0, "packetIndex": 0}
            with pytest.raises(asyncio.TimeoutError):
                await asyncio.wait_for(events_ws.recv(), timeout=0.25)

            with patch(
                "sync_server.ws_scan_handler.assemble_scan_session_file",
                return_value=("scan-complete.bin", payload),
            ):
                await scan_ws.send(
                    json.dumps(
                        {
                            "type": "complete",
                            "filename": "scan-complete.bin",
                            "completedAt": "2026-03-29T23:53:00Z",
                        }
                    )
                )

                completed_message = json.loads(
                    await asyncio.wait_for(scan_ws.recv(), timeout=3.0)
                )
            assert completed_message["type"] == "completed"
            assert completed_message["success"] is True

            complete_event, skipped_events = await _recv_websocket_event_type(
                events_ws, "scan-complete"
            )
            assert all(event["type"] == "scan-session-state" for event in skipped_events)
            assert complete_event["type"] == "scan-complete"
            assert complete_event["payload"]["sessionId"] == session_id
            assert complete_event["payload"]["completed"] is True

            post_complete_events = await _drain_websocket_events(events_ws)
            assert all(
                event["type"] == "scan-session-state"
                and event["payload"]["sessionId"] == session_id
                for event in post_complete_events
            )

            await scan_ws.send(packet)
            with pytest.raises(asyncio.TimeoutError):
                await asyncio.wait_for(events_ws.recv(), timeout=0.25)


@pytest.mark.asyncio
@pytest.mark.skipif(websockets is None, reason="websockets dependency not available")
async def test_events_websocket_can_share_the_https_port(tmp_path: Path) -> None:
    cert_path = _repo_root() / "services" / "sync-server" / "cert.pem"
    key_path = _repo_root() / "services" / "sync-server" / "key.pem"
    if not cert_path.exists() or not key_path.exists():
        pytest.skip("local TLS cert/key not available")

    storage_dir = tmp_path / "storage"
    storage = SqliteStorage(storage_dir)
    storage.ensure_dirs()

    port = _free_port()
    context = ServerContext(
        storage=storage,
        auth=AuthManager(tmp_path / "users.json"),
        export_manager=ExportManager(storage_dir / "export_config.json", None),
        settings_store=SettingsStore(storage_dir / "app_settings.json"),
        event_hub=EventHub(),
        ws_hub=WebSocketEventHub(),
        allowed_origins=["*"],
        static_dir=None,
        verbose=False,
    )
    config = ServerConfig(
        host="127.0.0.1",
        port=port,
        storage_dir=storage_dir,
        static_dir=None,
        users_file=tmp_path / "users.json",
        allowed_origins=["*"],
        tls_cert=cert_path,
        tls_key=key_path,
        export_dir=None,
        verbose=False,
        use_sqlite=True,
        ws_port=port,
    )

    server = create_server(config, context)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    _wait_for_port("127.0.0.1", port)

    try:
        ssl_context = ssl._create_unverified_context()
        ws_url = f"wss://127.0.0.1:{port}/api/v1/ws/events"

        async with websockets.connect(ws_url, ssl=ssl_context) as websocket:
            await websocket.send(
                json.dumps(
                    {
                        "type": "hello",
                        "protocol": "airqr-events",
                        "version": 1,
                        "clientId": "same-port-tls-test",
                    }
                )
            )

            raw = await asyncio.wait_for(websocket.recv(), timeout=3.0)
            message = json.loads(raw)

            assert message["type"] == "welcome"
            assert "clientId" in message
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def test_https_post_login_can_share_the_same_port(tmp_path: Path) -> None:
    cert_path = _repo_root() / "services" / "sync-server" / "cert.pem"
    key_path = _repo_root() / "services" / "sync-server" / "key.pem"
    if not cert_path.exists() or not key_path.exists():
        pytest.skip("local TLS cert/key not available")

    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")

    storage_dir = tmp_path / "storage"
    storage = SqliteStorage(storage_dir)
    storage.ensure_dirs()

    port = _free_port()
    context = ServerContext(
        storage=storage,
        auth=AuthManager(users_file),
        export_manager=ExportManager(storage_dir / "export_config.json", None),
        settings_store=SettingsStore(storage_dir / "app_settings.json"),
        event_hub=EventHub(),
        ws_hub=WebSocketEventHub(),
        allowed_origins=["*"],
        static_dir=None,
        verbose=False,
    )
    config = ServerConfig(
        host="127.0.0.1",
        port=port,
        storage_dir=storage_dir,
        static_dir=None,
        users_file=users_file,
        allowed_origins=["*"],
        tls_cert=cert_path,
        tls_key=key_path,
        export_dir=None,
        verbose=False,
        use_sqlite=True,
        ws_port=port,
    )

    server = create_server(config, context)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    _wait_for_port("127.0.0.1", port)

    try:
        request = urllib.request.Request(
            f"https://127.0.0.1:{port}/api/auth/login",
            data=json.dumps({"username": "admin", "password": "admin"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        ssl_context = ssl._create_unverified_context()
        with urllib.request.urlopen(request, timeout=5, context=ssl_context) as response:
            payload = json.loads(response.read().decode("utf-8"))
            cookie_header = response.headers.get("Set-Cookie")

        assert payload["ok"] is True
        assert payload["authorized"] is True
        assert payload["username"] == "admin"
        assert cookie_header is not None
        assert "airqr_session=" in cookie_header
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
