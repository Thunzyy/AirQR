from __future__ import annotations

import asyncio
import io
import logging
import socket
import ssl
import threading
from dataclasses import dataclass
from typing import Any, Optional
from urllib.parse import urlparse

from websockets.exceptions import ConnectionClosed
from websockets.sync.server import ServerConnection, ServerProtocol

from .utils import safe_session_id
from .ws_events import handle_events_client
from .ws_scan_handler import handle_scan_client

logger = logging.getLogger(__name__)

EVENT_PATHS = {
    "/api/v1/ws/events",
    "/api/ws/events",
    "/ws/events",
}
SCAN_PATH_PREFIXES = (
    "/api/v1/ws/scan/",
    "/api/ws/scan/",
    "/ws/scan/",
)


def scan_session_id_from_path(path: str) -> Optional[str]:
    parsed_path = urlparse(path).path
    for prefix in SCAN_PATH_PREFIXES:
        if parsed_path.startswith(prefix):
            return safe_session_id(parsed_path[len(prefix):])
    return None


@dataclass(frozen=True)
class SamePortWebSocketTarget:
    path: str
    session_id: Optional[str] = None
    request_headers: Optional[dict[str, str]] = None


class AsyncServerConnectionAdapter:
    def __init__(
        self,
        connection: ServerConnection,
        request_headers: Optional[dict[str, str]] = None,
    ) -> None:
        self._connection = connection
        self._send_lock = threading.Lock()
        self.request_headers = request_headers or {}

    @property
    def closed(self) -> bool:
        return self._connection.state.name == "CLOSED"

    async def send(self, message: Any) -> None:
        def _send() -> None:
            with self._send_lock:
                self._connection.send(message)

        await asyncio.to_thread(_send)

    async def close(self, code: int = 1000, reason: str = "") -> None:
        def _close() -> None:
            with self._send_lock:
                self._connection.close(code, reason)

        await asyncio.to_thread(_close)

    def __aiter__(self) -> "AsyncServerConnectionAdapter":
        return self

    async def __anext__(self) -> str | bytes:
        try:
            return await asyncio.to_thread(self._connection.recv)
        except ConnectionClosed as exc:
            raise StopAsyncIteration from exc


class _PrefixBuffer:
    def __init__(self, data: bytes) -> None:
        self._data = bytearray(data)
        self._lock = threading.Lock()

    def peek(self, size: int) -> bytes:
        with self._lock:
            return bytes(self._data[:size])

    def consume(self, size: int) -> bytes:
        with self._lock:
            chunk = bytes(self._data[:size])
            del self._data[: len(chunk)]
            return chunk

    def __bool__(self) -> bool:
        with self._lock:
            return bool(self._data)


class PrefixedSocket:
    def __init__(self, sock: socket.socket, prefix: bytes) -> None:
        self._sock = sock
        self._prefix = _PrefixBuffer(prefix)

    def recv(self, bufsize: int, flags: int = 0) -> bytes:
        if flags == socket.MSG_PEEK and self._prefix:
            return self._prefix.peek(bufsize)
        if flags != 0 and not self._prefix:
            return self._sock.recv(bufsize, flags)
        if flags != 0 and self._prefix:
            raise ValueError("non-zero flags not supported while prefetched data is buffered")
        if self._prefix:
            return self._prefix.consume(bufsize)
        return self._sock.recv(bufsize)

    def recv_into(self, buffer: bytearray, nbytes: int = 0, flags: int = 0) -> int:
        target_size = nbytes if nbytes > 0 else len(buffer)
        chunk = self.recv(target_size, flags)
        size = len(chunk)
        memoryview(buffer)[:size] = chunk
        return size

    def makefile(
        self,
        mode: str = "r",
        buffering: int | None = None,
        *,
        encoding: str | None = None,
        errors: str | None = None,
        newline: str | None = None,
    ) -> Any:
        if "b" in mode:
            raw_mode = mode.replace("b", "")
            raw = socket.SocketIO(self, raw_mode)
            buffer_size = buffering if buffering and buffering > 0 else io.DEFAULT_BUFFER_SIZE
            if buffering == 0:
                return raw
            if "r" in raw_mode and "w" in raw_mode:
                return io.BufferedRWPair(raw, raw, buffer_size)
            if "r" in raw_mode:
                return io.BufferedReader(raw, buffer_size=buffer_size)
            if "w" in raw_mode:
                return io.BufferedWriter(raw, buffer_size=buffer_size)
        return self._sock.makefile(
            mode,
            buffering if buffering is not None else -1,
            encoding=encoding,
            errors=errors,
            newline=newline,
        )

    def __getattr__(self, name: str) -> Any:
        return getattr(self._sock, name)


def detect_same_port_websocket_target(
    sock: socket.socket,
) -> tuple[Optional[SamePortWebSocketTarget], Any]:
    try:
        if isinstance(sock, ssl.SSLSocket):
            method_preview = sock.recv(4)
            if not method_preview:
                return None, sock
            if method_preview != b"GET ":
                return None, PrefixedSocket(sock, method_preview)
            remaining_preview = sock.recv(4092)
            preview = method_preview + remaining_preview
            prepared_sock = PrefixedSocket(sock, preview)
        else:
            preview = sock.recv(4096, socket.MSG_PEEK)
            prepared_sock = sock
    except OSError:
        return None, sock
    except ValueError:
        return None, sock

    if not preview:
        return None, prepared_sock

    header_end = preview.find(b"\r\n\r\n")
    if header_end < 0:
        return None, prepared_sock

    try:
        request_text = preview[:header_end].decode("latin-1")
    except UnicodeDecodeError:
        return None, prepared_sock

    lines = request_text.split("\r\n")
    if not lines:
        return None, prepared_sock

    request_line = lines[0].split(" ", 2)
    if len(request_line) < 2 or request_line[0] != "GET":
        return None, prepared_sock

    headers: dict[str, str] = {}
    for line in lines[1:]:
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        headers[key.strip().lower()] = value.strip()

    connection_header = headers.get("connection", "").lower()
    upgrade_header = headers.get("upgrade", "").lower()
    websocket_key = headers.get("sec-websocket-key")
    if "upgrade" not in connection_header or upgrade_header != "websocket" or not websocket_key:
        return None, prepared_sock

    path = urlparse(request_line[1]).path
    if path in EVENT_PATHS:
        return SamePortWebSocketTarget(path=path, request_headers=headers), prepared_sock

    for prefix in SCAN_PATH_PREFIXES:
        if path.startswith(prefix):
            session_id = scan_session_id_from_path(path)
            if session_id:
                return SamePortWebSocketTarget(
                    path=path,
                    session_id=session_id,
                    request_headers=headers,
                ), prepared_sock
            return None, prepared_sock

    return None, prepared_sock


def handle_same_port_websocket(
    sock: Any,
    target: SamePortWebSocketTarget,
    *,
    event_hub: Any,
    ws_hub: Any,
    scan_session_store: Any,
    auth_manager: Any,
    storage: Any,
) -> None:
    connection = ServerConnection(
        sock,
        ServerProtocol(),
        ping_interval=None,
        ping_timeout=None,
    )
    connection.handshake(server_header="AirQR Sync Server")
    adapter = AsyncServerConnectionAdapter(connection, request_headers=target.request_headers)

    if target.session_id is None:
        asyncio.run(handle_events_client(adapter, ws_hub, auth_manager))
        return

    asyncio.run(
        handle_scan_client(
            adapter,
            target.session_id,
            scan_session_store,
            auth_manager,
            storage=storage,
            emit_event=lambda event_type, payload: ws_hub.broadcast_threadsafe(
                event_type, payload
            ),
            emit_history_event=lambda payload: event_hub.publish("history", payload),
        )
    )
