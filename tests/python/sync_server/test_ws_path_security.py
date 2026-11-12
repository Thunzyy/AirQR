from __future__ import annotations

import asyncio
import json
import os
import queue
import socket
import threading
from pathlib import Path
from typing import Any

import pytest

from sync_server import app as sync_app
from sync_server.app import run_ws_server
from sync_server.auth import AuthManager
from sync_server.events import EventHub
from sync_server.packet_assembler import assemble_scan_session_file
from sync_server.sqlite_storage import SqliteStorage
from sync_server.storage import Storage
from sync_server.ws_events import WebSocketEventHub
from sync_server.ws_same_port import detect_same_port_websocket_target
from sync_server.ws_scan_session import ScanSessionStore

try:
    import websockets
    from websockets.exceptions import InvalidStatus
except Exception:  # pragma: no cover - handled by skipif
    websockets = None
    InvalidStatus = Exception


def test_sync_server_pins_supported_websockets_api_range() -> None:
    repo_root = Path(__file__).resolve().parents[3]
    requirements = (
        repo_root / "services" / "sync-server" / "requirements.txt"
    ).read_text(encoding="utf-8").splitlines()

    assert "websockets>=15.0.1,<17" in requirements


class _ModernConnection:
    def respond(self, status: int, text: str) -> tuple[int, str]:
        return status, text


class _ModernRequest:
    def __init__(self, path: str) -> None:
        self.path = path


class _PeekSocket:
    def __init__(self, request: bytes) -> None:
        self.request = request

    def recv(self, size: int, flags: int = 0) -> bytes:
        assert flags == socket.MSG_PEEK
        return self.request[:size]


def _websocket_upgrade_request(path: str) -> bytes:
    return (
        f"GET {path} HTTP/1.1\r\n"
        "Host: 127.0.0.1\r\n"
        "Connection: Upgrade\r\n"
        "Upgrade: websocket\r\n"
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
        "\r\n"
    ).encode("ascii")


@pytest.mark.parametrize(
    "path",
    ("/api/v1/ws/scan/../../escape", r"/api/v1/ws/scan/..\escape"),
)
def test_process_request_rejects_invalid_scan_paths(path: str) -> None:
    connection = _ModernConnection()

    response = sync_app._process_ws_request(connection, _ModernRequest(path))

    assert response == (400, "Invalid session ID\n")


@pytest.mark.parametrize(
    "arguments",
    (
        (_ModernConnection(), _ModernRequest("/api/v1/ws/scan/valid-session")),
        (_ModernConnection(), _ModernRequest("/api/v1/ws/events")),
    ),
)
def test_process_request_preserves_valid_and_non_scan_paths(
    arguments: tuple[Any, Any],
) -> None:
    process_request = getattr(sync_app, "_process_ws_request")

    assert process_request(*arguments) is None


@pytest.fixture(scope="module")
def separate_port_ws_server(
    tmp_path_factory: pytest.TempPathFactory,
) -> dict[str, Any]:
    root = tmp_path_factory.mktemp("separate-port-ws")
    storage = SqliteStorage(root / "storage")
    storage.ensure_dirs()
    lifecycle: queue.Queue[tuple[str, Any]] = queue.Queue()
    stop_event = threading.Event()

    def run() -> None:
        try:
            run_ws_server(
                WebSocketEventHub(),
                ScanSessionStore(),
                storage,
                "127.0.0.1",
                0,
                AuthManager(root / "users.json"),
                None,
                EventHub(),
                ready_callback=lambda port: lifecycle.put(("ready", port)),
                stop_event=stop_event,
            )
        except BaseException as exc:
            lifecycle.put(("error", exc))

    thread = threading.Thread(
        target=run,
        name="test-separate-port-websocket",
    )
    thread.start()
    state, value = lifecycle.get(timeout=5)
    if state == "error":
        thread.join(timeout=5)
        raise RuntimeError("WebSocket test server failed to start") from value

    try:
        yield {"base_url": f"ws://127.0.0.1:{value}"}
    finally:
        stop_event.set()
        thread.join(timeout=5)
        assert not thread.is_alive(), "WebSocket test server did not stop"
        if not lifecycle.empty():
            state, value = lifecycle.get_nowait()
            if state == "error":
                raise RuntimeError("WebSocket test server failed") from value


@pytest.mark.parametrize(
    "prefix",
    ("/api/v1/ws/scan/", "/api/ws/scan/", "/ws/scan/"),
)
@pytest.mark.parametrize("malicious_id", ("../../escape", r"..\..\escape"))
def test_same_port_upgrade_rejects_traversal_session_ids(
    prefix: str, malicious_id: str
) -> None:
    sock = _PeekSocket(_websocket_upgrade_request(f"{prefix}{malicious_id}"))

    target, prepared_sock = detect_same_port_websocket_target(sock)  # type: ignore[arg-type]

    assert target is None
    assert prepared_sock is sock


@pytest.mark.asyncio
@pytest.mark.skipif(websockets is None, reason="websockets dependency not available")
@pytest.mark.parametrize(
    "prefix",
    ("/api/v1/ws/scan/", "/api/ws/scan/", "/ws/scan/"),
)
@pytest.mark.parametrize("malicious_id", ("../../escape", r"..\escape"))
async def test_separate_port_rejects_traversal_before_websocket_opens(
    separate_port_ws_server: dict[str, Any], prefix: str, malicious_id: str
) -> None:
    url = f"{separate_port_ws_server['base_url']}{prefix}{malicious_id}"

    with pytest.raises(InvalidStatus) as exc_info:
        async with websockets.connect(url):
            pytest.fail("invalid scan path reached the OPEN state")

    assert exc_info.value.response.status_code == 400


@pytest.mark.asyncio
@pytest.mark.skipif(websockets is None, reason="websockets dependency not available")
@pytest.mark.parametrize("path", ("/api/v1/ws/events", "/api/v1/ws/scan/valid-session"))
async def test_separate_port_preserves_valid_websocket_endpoints(
    separate_port_ws_server: dict[str, Any], path: str
) -> None:
    protocol = "airqr-events" if path.endswith("events") else "airqr-scan"
    url = f"{separate_port_ws_server['base_url']}{path}"

    async with websockets.connect(url) as websocket:
        await websocket.send(
            json.dumps(
                {
                    "type": "hello",
                    "protocol": protocol,
                    "version": 1,
                    "clientId": "path-security-test",
                }
            )
        )
        message = json.loads(await asyncio.wait_for(websocket.recv(), timeout=3.0))

    assert message["type"] == "welcome"


@pytest.mark.parametrize("storage_type", (Storage, SqliteStorage))
@pytest.mark.parametrize(
    ("directory_method", "invalid_id"),
    (
        ("session_dir", "../../escape"),
        ("session_dir", r"..\..\escape"),
        ("history_dir", "../../escape"),
        ("history_dir", r"..\..\escape"),
    ),
)
def test_storage_directories_reject_path_traversal(
    tmp_path: Path,
    storage_type: type[Storage] | type[SqliteStorage],
    directory_method: str,
    invalid_id: str,
) -> None:
    storage = storage_type(tmp_path / "storage")

    with pytest.raises(ValueError, match="Invalid .* ID"):
        getattr(storage, directory_method)(invalid_id)


@pytest.mark.parametrize("storage_type", (Storage, SqliteStorage))
@pytest.mark.parametrize(
    ("directory_method", "valid_id", "root_name"),
    (
        ("session_dir", "scan_valid-123", "sessions"),
        ("history_dir", "history_valid-123", "history"),
    ),
)
def test_storage_directories_preserve_valid_ids(
    tmp_path: Path,
    storage_type: type[Storage] | type[SqliteStorage],
    directory_method: str,
    valid_id: str,
    root_name: str,
) -> None:
    storage = storage_type(tmp_path / "storage")

    result = getattr(storage, directory_method)(valid_id)

    assert result == (tmp_path / "storage" / root_name / valid_id).resolve()


@pytest.mark.parametrize("storage_type", (Storage, SqliteStorage))
@pytest.mark.parametrize(
    "operation",
    (
        "save_session_file",
        "save_history_file",
        "save_session_packet",
        "list_packets",
        "list_packet_entries",
        "count_packets",
        "list_packets_page",
    ),
)
def test_storage_file_sinks_reject_nested_links_outside_root(
    tmp_path: Path,
    storage_type: type[Storage] | type[SqliteStorage],
    operation: str,
) -> None:
    storage = storage_type(tmp_path / "storage")
    storage.ensure_dirs()
    outside = tmp_path / "outside"
    outside.mkdir()

    if operation == "save_history_file":
        parent = storage.history_dir("valid-history")
        child_name = "files"
    else:
        parent = storage.session_dir("valid-session")
        child_name = "files" if operation == "save_session_file" else "packets"
    parent.mkdir(parents=True)
    os.symlink(outside, parent / child_name, target_is_directory=True)

    if operation in {
        "list_packets",
        "list_packet_entries",
        "count_packets",
        "list_packets_page",
    }:
        (outside / "packet-external-1.bin").write_bytes(b"external")

    with pytest.raises(ValueError, match="Invalid file path"):
        if operation == "save_session_file":
            storage.save_session_file("valid-session", "safe.bin", b"data")
        elif operation == "save_history_file":
            storage.save_history_file("valid-history", "safe.bin", b"data")
        elif operation == "save_session_packet":
            storage.save_session_packet("valid-session", b"data", "hash")
        else:
            getattr(storage, operation)("valid-session")


@pytest.mark.parametrize("storage_type", (Storage, SqliteStorage))
def test_packet_assembler_rejects_linked_packet_directory(
    tmp_path: Path,
    storage_type: type[Storage] | type[SqliteStorage],
) -> None:
    storage = storage_type(tmp_path / "storage")
    storage.ensure_dirs()
    session_dir = storage.session_dir("valid-session")
    session_dir.mkdir(parents=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    os.symlink(outside, session_dir / "packets", target_is_directory=True)

    with pytest.raises(ValueError, match="Invalid file path"):
        assemble_scan_session_file(storage, "valid-session")
