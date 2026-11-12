"""Tests for WebSocket scan handler."""

import asyncio
import json
import tempfile
import threading
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from sync_server.auth import AuthManager, RateLimiter, save_user
from sync_server.packet_assembler import ScanAssemblyError, ScanAssemblyUnavailableError
from sync_server.sqlite_storage import SqliteStorage
from sync_server.ws_scan_handler import (
    _extract_request_context,
    _handle_hello,
    _handle_claim_producer,
    _handle_meta,
    _handle_resume,
    _handle_complete,
    _handle_binary_packet,
    _maybe_auto_complete_session,
    _send_error,
    _hydrate_session_from_storage,
)
from sync_server.storage import Storage
from sync_server.ws_scan_session import ScanSessionStore, ScanSessionState


def _build_streaming_payload(
    *,
    session_id: int,
    chunk_id: int,
    total_chunks: int,
    packet_index: int,
    total_size: int,
    packet_size: int,
    exact_chunk_packets: int,
) -> bytes:
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
    payload.extend(b"x")
    return bytes(payload)


def _build_streaming_frame(
    *,
    session_id: int,
    chunk_id: int,
    total_chunks: int,
    packet_index: int,
    total_size: int,
    packet_size: int,
    exact_chunk_packets: int,
) -> bytes:
    from sync_server.ws_scan_protocol import build_binary_header, compute_crc32

    payload = _build_streaming_payload(
        session_id=session_id,
        chunk_id=chunk_id,
        total_chunks=total_chunks,
        packet_index=packet_index,
        total_size=total_size,
        packet_size=packet_size,
        exact_chunk_packets=exact_chunk_packets,
    )
    header = build_binary_header(
        1,
        0,
        chunk_id,
        packet_index,
        compute_crc32(payload),
    )
    return header + payload


def _emitted_events(mock_emit_event: MagicMock) -> list[tuple[str, dict[str, object]]]:
    return [(call.args[0], call.args[1]) for call in mock_emit_event.call_args_list]


class TestScanHandlerHandshake:
    """Test scan handler handshake."""

    @pytest.mark.asyncio
    async def test_hello_sends_welcome(self) -> None:
        """Should respond to hello with welcome and session state."""
        store = ScanSessionStore()
        mock_ws = AsyncMock()

        data = {
            "type": "hello",
            "protocol": "airqr-scan",
            "version": 1,
            "clientId": "device-A",
        }

        result = await _handle_hello(mock_ws, data, "session-123", store, None)

        assert result is not None
        client_id, session = result
        assert client_id == "device-A"
        assert session.session_id == "session-123"

        # Should have sent welcome
        mock_ws.send.assert_called_once()
        sent = json.loads(mock_ws.send.call_args[0][0])
        assert sent["type"] == "welcome"
        assert sent["version"] == 1
        assert sent["packetAck"] is True
        assert "sessionState" in sent
        assert sent["sessionState"]["receivedCount"] == 0

    @pytest.mark.asyncio
    async def test_hello_logs_structured_accept_message(self, caplog) -> None:
        store = ScanSessionStore()
        mock_ws = AsyncMock()
        mock_ws.request.path = "/api/v1/ws/scan/session-123?connectionId=conn-7"
        mock_ws.request_headers = {
            "Origin": "https://192.168.1.36:5173",
            "User-Agent": "MobileSafari",
        }
        mock_ws.remote_address = ("192.168.1.50", 5173)

        data = {
            "type": "hello",
            "protocol": "airqr-scan",
            "version": 1,
            "clientId": "device-A",
        }

        with caplog.at_level("INFO", logger="sync_server.ws_scan_handler"):
            result = await _handle_hello(mock_ws, data, "session-123", store, None)

        assert result is not None
        assert "ws.scan.hello_accepted" in caplog.text
        assert "sessionId=session-123" in caplog.text
        assert "clientId=device-A" in caplog.text
        assert "connectionId=conn-7" in caplog.text
        assert "origin=https://192.168.1.36:5173" in caplog.text
        assert "remoteAddress=192.168.1.50" in caplog.text

    @pytest.mark.asyncio
    async def test_invalid_protocol_sends_error(self) -> None:
        """Should reject invalid protocol."""
        store = ScanSessionStore()
        mock_ws = AsyncMock()

        data = {
            "type": "hello",
            "protocol": "wrong-protocol",
            "version": 1,
        }

        result = await _handle_hello(mock_ws, data, "session-123", store, None)

        assert result is None  # Connection rejected

        sent = json.loads(mock_ws.send.call_args[0][0])
        assert sent["type"] == "error"
        assert sent["code"] == "invalid_protocol"

    @pytest.mark.asyncio
    async def test_hello_hydrates_persisted_ws_session_state(self) -> None:
        store = ScanSessionStore()
        mock_ws = AsyncMock()
        mock_storage = MagicMock()
        mock_storage.read_session.return_value = {
            "sessionId": "session-123",
            "encoding": "ws-binary-v1",
            "filename": "persisted.bin",
            "mimeType": "application/octet-stream",
            "size": 7,
            "expectedPackets": 5,
            "totalChunks": 2,
            "packetSize": 12,
        }
        mock_storage.get_packet_ranges.return_value = [(0, 1), (3, 4)]

        data = {
            "type": "hello",
            "protocol": "airqr-scan",
            "version": 1,
            "clientId": "device-A",
        }

        result = await _handle_hello(
            mock_ws,
            data,
            "session-123",
            store,
            None,
            mock_storage,
        )

        assert result is not None
        _client_id, session = result
        assert session.filename == "persisted.bin"
        assert session.total_packets == 5

        sent = json.loads(mock_ws.send.call_args[0][0])
        assert sent["type"] == "welcome"
        assert sent["sessionState"]["receivedCount"] == 4
        assert sent["sessionState"]["lastContiguous"] == 1
        assert sent["sessionState"]["missing"] == [[2, 2]]
        assert sent["sessionState"]["totalExpected"] == 5

    @pytest.mark.asyncio
    async def test_hello_hydrates_chunk_aware_state_from_stored_packets(self) -> None:
        store = ScanSessionStore()
        mock_ws = AsyncMock()
        mock_storage = MagicMock()
        mock_storage.read_session.return_value = {
            "sessionId": "session-123",
            "encoding": "ws-binary-v1",
            "filename": "persisted.bin",
            "mimeType": "application/octet-stream",
            "size": 7,
            "expectedPackets": 772,
            "totalPackets": 158,
            "totalChunks": 6,
            "packetSize": 250,
        }

        def build_stored_streaming_packet(chunk_id: int, packet_index: int) -> bytes:
            payload = bytearray()
            payload.append(2)
            payload.extend((1774822325).to_bytes(4, "big"))
            payload.extend(int(chunk_id).to_bytes(4, "big"))
            payload.extend((6).to_bytes(4, "big"))
            payload.extend((0).to_bytes(8, "big"))
            payload.extend((1024).to_bytes(4, "big"))
            payload.extend((250).to_bytes(2, "big"))
            payload.extend((158).to_bytes(4, "big"))
            payload.extend(int(packet_index).to_bytes(4, "big"))
            payload.extend(b"x")
            return bytes(payload)

        mock_storage.list_packet_entries.return_value = [
            (None, build_stored_streaming_packet(0, 0)),
            (None, build_stored_streaming_packet(1, 0)),
        ]

        data = {
            "type": "hello",
            "protocol": "airqr-scan",
            "version": 1,
            "clientId": "device-A",
        }

        result = await _handle_hello(
            mock_ws,
            data,
            "session-123",
            store,
            None,
            mock_storage,
        )

        assert result is not None
        sent = json.loads(mock_ws.send.call_args[0][0])
        assert sent["type"] == "welcome"
        assert sent["sessionState"]["receivedCount"] == 2
        assert sent["sessionState"]["chunkStates"] == [
            {
                "chunkId": 0,
                "receivedCount": 1,
                "lastContiguous": 0,
                "expectedPackets": 5,
                "totalPackets": 158,
                "totalPacketsExact": True,
                "missing": [],
                "targetFrameCount": 4,
                "targetFrameRanges": [[1, 4]],
                "unseenFrameCount": 157,
                "unseenFrameRanges": [[1, 157]],
            },
            {
                "chunkId": 1,
                "receivedCount": 1,
                "lastContiguous": 0,
                "expectedPackets": 5,
                "totalPackets": 158,
                "totalPacketsExact": True,
                "missing": [],
                "targetFrameCount": 4,
                "targetFrameRanges": [[1, 4]],
                "unseenFrameCount": 157,
                "unseenFrameRanges": [[1, 157]],
            },
        ]

    @pytest.mark.asyncio
    async def test_hello_accepts_session_cookie_auth(self, tmp_path) -> None:
        users_file = tmp_path / "users.json"
        save_user(users_file, "admin", "admin")
        auth = AuthManager(users_file)
        cookie = auth.build_session_cookie("admin", secure=False).split(";", 1)[0]

        store = ScanSessionStore()
        mock_ws = AsyncMock()
        mock_ws.request_headers = {"Cookie": cookie}

        data = {
            "type": "hello",
            "protocol": "airqr-scan",
            "version": 1,
            "clientId": "device-A",
        }

        result = await _handle_hello(mock_ws, data, "session-123", store, auth)

        assert result is not None
        client_id, session = result
        assert client_id == "device-A"
        assert session.session_id == "session-123"

        sent = json.loads(mock_ws.send.call_args[0][0])
        assert sent["type"] == "welcome"

    @pytest.mark.asyncio
    async def test_hello_with_valid_credentials_does_not_consume_rate_limit(self, tmp_path) -> None:
        users_file = tmp_path / "users.json"
        users_file.write_text('{"users": [], "apiKeys": ["scan-key"]}', encoding="utf-8")
        rate_limiter = MagicMock()
        auth = AuthManager(users_file, rate_limiter=rate_limiter)
        store = ScanSessionStore()
        mock_ws = AsyncMock()
        mock_ws.remote_address = ("192.168.1.50", 5173)

        data = {
            "type": "hello",
            "protocol": "airqr-scan",
            "version": 1,
            "clientId": "device-A",
            "apiKey": "scan-key",
        }

        result = await _handle_hello(mock_ws, data, "session-123", store, auth)

        assert result is not None
        rate_limiter.try_reserve.assert_not_called()
        rate_limiter.complete_failure.assert_not_called()
        rate_limiter.reset.assert_called_once_with("ws-scan:192.168.1.50")
        sent = json.loads(mock_ws.send.call_args[0][0])
        assert sent["type"] == "welcome"

    @pytest.mark.asyncio
    async def test_rate_limit_uses_forwarded_client_from_trusted_proxy(self, tmp_path) -> None:
        users_file = tmp_path / "users.json"
        save_user(users_file, "admin", "admin")
        rate_limiter = MagicMock()
        rate_limiter.try_reserve.return_value = True
        auth = AuthManager(
            users_file,
            rate_limiter=rate_limiter,
            trusted_proxies=["127.0.0.1/32"],
        )
        store = ScanSessionStore()
        mock_ws = AsyncMock()
        mock_ws.remote_address = ("127.0.0.1", 43123)
        mock_ws.request_headers = {"X-Forwarded-For": "203.0.113.25"}
        data = {
            "type": "hello",
            "protocol": "airqr-scan",
            "version": 1,
            "username": "admin",
            "password": "wrong",
        }

        assert await _handle_hello(
            mock_ws, data, "session-123", store, auth
        ) is None

        rate_limiter.try_reserve.assert_called_once_with("ws-scan:203.0.113.25")

    @pytest.mark.asyncio
    async def test_valid_api_key_reconnect_succeeds_at_failure_limit(self, tmp_path) -> None:
        users_file = tmp_path / "users.json"
        users_file.write_text(
            '{"users": [], "apiKeys": ["scan-key"]}', encoding="utf-8"
        )
        limiter = RateLimiter(max_attempts=1, window_seconds=60)
        limiter.record_failure("ws-scan:192.168.1.50")
        auth = AuthManager(users_file, rate_limiter=limiter)
        store = ScanSessionStore()
        mock_ws = AsyncMock()
        mock_ws.remote_address = ("192.168.1.50", 5173)
        data = {
            "type": "hello",
            "protocol": "airqr-scan",
            "version": 1,
            "apiKey": "scan-key",
        }

        result = await _handle_hello(mock_ws, data, "session-123", store, auth)

        assert result is not None
        sent = json.loads(mock_ws.send.call_args[0][0])
        assert sent["type"] == "welcome"
        assert limiter.is_allowed("ws-scan:192.168.1.50") is True

    @pytest.mark.asyncio
    async def test_basic_auth_exception_cancels_reservation(self, tmp_path) -> None:
        users_file = tmp_path / "users.json"
        save_user(users_file, "admin", "admin")
        limiter = RateLimiter(max_attempts=1, window_seconds=60)
        auth = AuthManager(users_file, rate_limiter=limiter)
        store = ScanSessionStore()
        mock_ws = AsyncMock()
        mock_ws.remote_address = ("192.168.1.50", 5173)
        data = {
            "type": "hello",
            "protocol": "airqr-scan",
            "version": 1,
            "username": "admin",
            "password": "admin",
        }

        with (
            patch.object(auth, "authorize_basic", side_effect=RuntimeError("boom")),
            pytest.raises(RuntimeError, match="boom"),
        ):
            await _handle_hello(mock_ws, data, "session-123", store, auth)

        assert limiter.try_reserve("ws-scan:192.168.1.50") is True

    @pytest.mark.asyncio
    @pytest.mark.parametrize("invalid_api_key", [123, ["bad"], {"bad": "key"}])
    async def test_non_string_body_api_key_is_counted_as_auth_failure(
        self, tmp_path, invalid_api_key
    ) -> None:
        users_file = tmp_path / "users.json"
        users_file.write_text(
            '{"users": [], "apiKeys": ["scan-key"]}', encoding="utf-8"
        )
        limiter = RateLimiter(max_attempts=1, window_seconds=60)
        auth = AuthManager(users_file, rate_limiter=limiter)
        store = ScanSessionStore()
        mock_ws = AsyncMock()
        mock_ws.remote_address = ("192.168.1.50", 5173)
        data = {
            "type": "hello",
            "protocol": "airqr-scan",
            "version": 1,
            "apiKey": invalid_api_key,
        }

        result = await _handle_hello(mock_ws, data, "session-123", store, auth)

        assert result is None
        sent = json.loads(mock_ws.send.call_args[0][0])
        assert sent["code"] == "auth_failed"
        assert limiter.is_allowed("ws-scan:192.168.1.50") is False

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("username", "password"),
        [("admin", ["bad"]), ({"bad": "user"}, "admin"), (123, True)],
    )
    async def test_non_string_body_basic_fields_are_counted_without_pbkdf(
        self, tmp_path, username, password
    ) -> None:
        users_file = tmp_path / "users.json"
        save_user(users_file, "admin", "admin")
        limiter = RateLimiter(max_attempts=1, window_seconds=60)
        auth = AuthManager(users_file, rate_limiter=limiter)
        store = ScanSessionStore()
        mock_ws = AsyncMock()
        mock_ws.remote_address = ("192.168.1.50", 5173)
        data = {
            "type": "hello",
            "protocol": "airqr-scan",
            "version": 1,
            "username": username,
            "password": password,
        }

        with patch.object(auth, "authorize_basic") as authorize_basic:
            result = await _handle_hello(
                mock_ws, data, "session-123", store, auth
            )

        assert result is None
        authorize_basic.assert_not_called()
        sent = json.loads(mock_ws.send.call_args[0][0])
        assert sent["code"] == "auth_failed"
        assert limiter.is_allowed("ws-scan:192.168.1.50") is False

    @pytest.mark.asyncio
    async def test_hello_with_invalid_credentials_consumes_rate_limit(self, tmp_path) -> None:
        users_file = tmp_path / "users.json"
        users_file.write_text('{"users": [], "apiKeys": ["scan-key"]}', encoding="utf-8")
        rate_limiter = MagicMock()
        rate_limiter.try_reserve.return_value = True
        auth = AuthManager(users_file, rate_limiter=rate_limiter)
        store = ScanSessionStore()
        mock_ws = AsyncMock()
        mock_ws.remote_address = ("192.168.1.50", 5173)

        data = {
            "type": "hello",
            "protocol": "airqr-scan",
            "version": 1,
            "clientId": "device-A",
            "apiKey": "wrong-key",
        }

        result = await _handle_hello(mock_ws, data, "session-123", store, auth)

        assert result is None
        rate_limiter.try_reserve.assert_called_once_with(
            "ws-scan:192.168.1.50"
        )
        rate_limiter.complete_failure.assert_called_once_with(
            "ws-scan:192.168.1.50"
        )
        rate_limiter.reset.assert_not_called()
        sent = json.loads(mock_ws.send.call_args[0][0])
        assert sent["type"] == "error"
        assert sent["code"] == "auth_failed"

    @pytest.mark.asyncio
    async def test_exhausted_invalid_hello_is_rate_limited_without_recording(
        self, tmp_path
    ) -> None:
        users_file = tmp_path / "users.json"
        users_file.write_text(
            '{"users": [], "apiKeys": ["scan-key"]}', encoding="utf-8"
        )
        rate_limiter = MagicMock()
        rate_limiter.try_reserve.return_value = False
        auth = AuthManager(users_file, rate_limiter=rate_limiter)
        store = ScanSessionStore()
        mock_ws = AsyncMock()
        mock_ws.remote_address = ("192.168.1.50", 5173)
        data = {
            "type": "hello",
            "protocol": "airqr-scan",
            "version": 1,
            "clientId": "device-A",
            "apiKey": "wrong-key",
        }

        result = await _handle_hello(mock_ws, data, "session-123", store, auth)

        assert result is None
        rate_limiter.try_reserve.assert_called_once_with("ws-scan:192.168.1.50")
        rate_limiter.complete_failure.assert_not_called()
        sent = json.loads(mock_ws.send.call_args[0][0])
        assert sent["code"] == "rate_limited"

    @pytest.mark.asyncio
    async def test_invalid_hello_is_rate_limited_when_reservation_is_unavailable(
        self, tmp_path
    ) -> None:
        users_file = tmp_path / "users.json"
        users_file.write_text(
            '{"users": [], "apiKeys": ["scan-key"]}', encoding="utf-8"
        )
        rate_limiter = MagicMock()
        rate_limiter.try_reserve.return_value = False
        auth = AuthManager(users_file, rate_limiter=rate_limiter)
        store = ScanSessionStore()
        mock_ws = AsyncMock()
        mock_ws.remote_address = ("192.168.1.50", 5173)
        data = {
            "type": "hello",
            "protocol": "airqr-scan",
            "version": 1,
            "apiKey": "wrong-key",
        }

        result = await _handle_hello(mock_ws, data, "session-123", store, auth)

        assert result is None
        sent = json.loads(mock_ws.send.call_args[0][0])
        assert sent["code"] == "rate_limited"

    @pytest.mark.asyncio
    async def test_exhausted_hello_short_circuits_before_auth(self, tmp_path) -> None:
        users_file = tmp_path / "users.json"
        users_file.write_text(
            '{"users": [], "apiKeys": ["scan-key"]}', encoding="utf-8"
        )
        rate_limiter = MagicMock()
        rate_limiter.try_reserve.return_value = False
        auth = AuthManager(users_file, rate_limiter=rate_limiter)
        store = ScanSessionStore()
        mock_ws = AsyncMock()
        mock_ws.remote_address = None
        data = {
            "type": "hello",
            "protocol": "airqr-scan",
            "version": 1,
            "username": "admin",
            "password": "admin",
        }

        with (
            patch.object(auth, "authorize_basic") as authorize_basic,
        ):
            result = await _handle_hello(
                mock_ws, data, "session-123", store, auth
            )

        assert result is None
        authorize_basic.assert_not_called()
        rate_limiter.try_reserve.assert_called_once_with(
            f"ws-scan:unknown:{id(mock_ws)}"
        )
        sent = json.loads(mock_ws.send.call_args[0][0])
        assert sent["code"] == "rate_limited"

    @pytest.mark.asyncio
    async def test_cross_origin_hello_ignores_session_cookie_auth(self, tmp_path) -> None:
        users_file = tmp_path / "users.json"
        save_user(users_file, "admin", "admin")
        auth = AuthManager(users_file)
        cookie = auth.build_session_cookie("admin", secure=False).split(";", 1)[0]

        store = ScanSessionStore()
        mock_ws = AsyncMock()
        mock_ws.request_headers = {
            "Cookie": cookie,
            "Host": "sync.example.test",
            "Origin": "https://app.example.test",
        }

        data = {
            "type": "hello",
            "protocol": "airqr-scan",
            "version": 1,
            "clientId": "device-A",
        }

        result = await _handle_hello(mock_ws, data, "session-123", store, auth)

        assert result is None
        sent = json.loads(mock_ws.send.call_args[0][0])
        assert sent["type"] == "error"
        assert sent["code"] == "auth_failed"

    @pytest.mark.asyncio
    async def test_resume_preserves_live_state_for_non_streaming_ws_raw_packets(self) -> None:
        session = ScanSessionState("session-123")
        session.claim_producer("device-A")
        session.set_metadata(
            filename="handoff.bin",
            mime_type="application/octet-stream",
            expected_packets=2,
            total_packets=2,
        )
        session.record_packet(0)

        mock_ws = AsyncMock()
        mock_storage = MagicMock()
        mock_storage.read_session.return_value = {
            "sessionId": "session-123",
            "encoding": "ws-binary-v1",
            "filename": "handoff.bin",
            "mimeType": "application/octet-stream",
            "expectedPackets": 2,
            "totalPackets": 2,
            "receivedCount": 1,
        }
        mock_storage.list_packets.return_value = [b"raw-file-payload-without-transport-metadata"]
        mock_storage.get_packet_ranges.return_value = None

        await _handle_resume(mock_ws, {"type": "resume", "fromPacketIndex": 0}, session, mock_storage)

        mock_ws.send.assert_called_once()
        sent = json.loads(mock_ws.send.call_args[0][0])
        assert sent["type"] == "resumeState"
        assert sent["receivedCount"] == 1
        assert sent["lastContiguous"] == 0

    @pytest.mark.asyncio
    async def test_resume_reconstructs_chunk_identity_from_persisted_ws_packet_filename(
        self,
        tmp_path: Path,
    ) -> None:
        storage = SqliteStorage(tmp_path / "storage")
        storage.ensure_dirs()
        storage.write_session(
            "session-123",
            {
                "sessionId": "session-123",
                "encoding": "ws-binary-v1",
                "filename": "multiview.bin",
                "mimeType": "application/octet-stream",
                "expectedPackets": 772,
                "totalPackets": 158,
                "totalChunks": 6,
            },
        )
        storage.save_session_packet(
            "session-123",
            b"ABCDEF\x00\x00\x00\x07",
            "0000-00000000-from-filename",
        )

        session = ScanSessionState("session-123")
        session.set_metadata(
            filename="multiview.bin",
            mime_type="application/octet-stream",
            expected_packets=772,
            total_packets=158,
            total_chunks=6,
        )
        assert session.record_packet(0, 0) is True

        mock_ws = AsyncMock()
        await _handle_resume(
            mock_ws,
            {"type": "resume", "fromPacketIndex": 0},
            session,
            storage,
        )

        sent = json.loads(mock_ws.send.call_args[0][0])
        assert sent["type"] == "resumeState"
        assert sent["receivedCount"] == 1
        assert sent["lastContiguous"] == 0
        assert sent["chunkStates"] == [
            {
                "chunkId": 0,
                "receivedCount": 1,
                "lastContiguous": 0,
                "missing": [],
            }
        ]

    def test_extract_request_context_reads_connection_query_and_forwarded_headers(self) -> None:
        mock_ws = MagicMock()
        mock_ws.request.path = (
            "/api/v1/ws/scan/session-123?connectionId=conn-7&deviceId=device-A"
        )
        mock_ws.request_headers = {
            "Origin": "https://192.168.1.36:5173",
            "X-Forwarded-Host": "192.168.1.36:5173",
            "User-Agent": "MobileSafari",
        }

        assert _extract_request_context(mock_ws) == {
            "connectionId": "conn-7",
            "deviceId": "device-A",
            "origin": "https://192.168.1.36:5173",
            "path": "/api/v1/ws/scan/session-123",
            "query": "connectionId=conn-7&deviceId=device-A",
            "userAgent": "MobileSafari",
            "xForwardedHost": "192.168.1.36:5173",
        }

    @pytest.mark.asyncio
    async def test_resume_reconciles_live_session_with_durable_packet_store(self) -> None:
        session = ScanSessionState("session-123")
        session.set_metadata(
            filename="persisted.bin",
            mime_type="application/octet-stream",
            expected_packets=1182,
            total_packets=472,
            total_chunks=3,
            packet_size=835,
        )
        for packet_index in range(20):
            assert session.record_packet(packet_index, 0) is True

        mock_ws = AsyncMock()
        mock_storage = MagicMock()
        mock_storage.read_session.return_value = {
            "sessionId": "session-123",
            "encoding": "ws-binary-v1",
            "filename": "persisted.bin",
            "mimeType": "application/octet-stream",
            "expectedPackets": 1182,
            "totalPackets": 472,
            "totalChunks": 3,
            "packetSize": 835,
        }
        mock_storage.list_packet_entries.return_value = [
            (
                None,
                _build_streaming_payload(
                    session_id=1775220640,
                    chunk_id=0,
                    total_chunks=3,
                    packet_index=27,
                    total_size=250500,
                    packet_size=835,
                    exact_chunk_packets=472,
                ),
            ),
            (
                None,
                _build_streaming_payload(
                    session_id=1775220640,
                    chunk_id=0,
                    total_chunks=3,
                    packet_index=28,
                    total_size=250500,
                    packet_size=835,
                    exact_chunk_packets=472,
                ),
            ),
            (
                None,
                _build_streaming_payload(
                    session_id=1775220640,
                    chunk_id=1,
                    total_chunks=3,
                    packet_index=408,
                    total_size=250500,
                    packet_size=835,
                    exact_chunk_packets=472,
                ),
            ),
        ]

        await _handle_resume(
            mock_ws,
            {"type": "resume", "fromPacketIndex": 0},
            session,
            mock_storage,
        )

        sent = json.loads(mock_ws.send.call_args[0][0])
        assert sent["type"] == "resumeState"
        assert sent["receivedCount"] == 3
        assert sent["lastContiguous"] == -1
        assert sent["chunkStates"] == [
            {
                "chunkId": 0,
                "receivedCount": 2,
                "lastContiguous": -1,
                "expectedPackets": 300,
                "totalPackets": 472,
                "totalPacketsExact": True,
                "missing": [[0, 26]],
                "targetFrameCount": 298,
                "targetFrameRanges": [[0, 26], [29, 299]],
                "unseenFrameCount": 470,
                "unseenFrameRanges": [[0, 26], [29, 471]],
            },
            {
                "chunkId": 1,
                "receivedCount": 1,
                "lastContiguous": -1,
                "expectedPackets": 300,
                "totalPackets": 472,
                "totalPacketsExact": True,
                "missing": [[0, 407]],
                "targetFrameCount": 299,
                "targetFrameRanges": [[0, 298]],
                "unseenFrameCount": 471,
                "unseenFrameRanges": [[0, 407], [409, 471]],
            },
        ]
        assert session.received_count == 3


class TestScanHandlerProducer:
    """Test producer claim/revoke."""

    @pytest.mark.asyncio
    async def test_claim_producer_succeeds(self) -> None:
        """Should allow claiming producer role."""
        session = ScanSessionState("session-123")
        mock_ws = AsyncMock()

        await _handle_claim_producer(mock_ws, session, "device-A")

        assert session.is_producer("device-A")

        sent = json.loads(mock_ws.send.call_args[0][0])
        assert sent["type"] == "producerClaimed"
        assert sent["deviceId"] == "device-A"

    @pytest.mark.asyncio
    async def test_claim_producer_keeps_previous_producer_active(self) -> None:
        """Should allow another producer to join without revoking the first one."""
        session = ScanSessionState("session-123")
        producer_a = AsyncMock()
        producer_b = AsyncMock()

        await _handle_claim_producer(producer_a, session, "device-A")
        producer_a.send.reset_mock()

        await _handle_claim_producer(producer_b, session, "device-B")

        producer_a.send.assert_not_called()
        assert session.is_producer("device-A")
        assert session.is_producer("device-B")

        claimed = json.loads(producer_b.send.call_args[0][0])
        assert claimed["type"] == "producerClaimed"
        assert claimed["deviceId"] == "device-B"


class TestScanHandlerMeta:
    """Test metadata handling."""

    @pytest.mark.asyncio
    async def test_meta_accepted(self) -> None:
        """Should accept metadata."""
        session = ScanSessionState("session-123")
        mock_ws = AsyncMock()

        data = {
            "type": "meta",
            "filename": "test.pdf",
            "mimeType": "application/pdf",
            "totalPackets": 100,
        }

        await _handle_meta(mock_ws, data, session)

        assert session.filename == "test.pdf"
        assert session.mime_type == "application/pdf"
        assert session.total_packets == 100

        sent = json.loads(mock_ws.send.call_args[0][0])
        assert sent["type"] == "metaAck"
        assert sent["accepted"] is True


class TestScanHandlerBinaryPacket:
    """Test binary packet handling."""

    @pytest.mark.asyncio
    async def test_valid_packet_is_recorded(self) -> None:
        """Should record valid binary packet."""
        from sync_server.ws_scan_protocol import build_binary_header, compute_crc32

        session = ScanSessionState("session-123")
        session.claim_producer("device-A")
        mock_ws = AsyncMock()

        payload = b"test packet data"
        crc = compute_crc32(payload)
        header = build_binary_header(1, 0, 0, 0, crc)
        packet = header + payload

        await _handle_binary_packet(mock_ws, packet, session)

        assert session.received_count == 1

    @pytest.mark.asyncio
    async def test_binary_packet_emits_scan_session_state_event(self) -> None:
        session = ScanSessionState("1774902900")
        session.set_metadata(expected_packets=2, total_chunks=1)
        mock_ws = AsyncMock()
        mock_ws.request = MagicMock()
        mock_ws.request.path = "/api/v1/ws/scan/1774902900"
        mock_ws.request_headers = {}
        mock_ws.remote_address = ("127.0.0.1", 1234)
        storage = MagicMock()
        storage.read_session.return_value = {
            "sessionId": "1774902900",
            "status": "active",
            "expectedPackets": 2,
            "totalChunks": 1,
        }
        storage.save_session_packet.return_value = (Path("packet.bin"), True)
        storage.write_session = MagicMock()

        events: list[tuple[str, dict[str, object]]] = []
        frame = _build_streaming_frame(
            session_id=1774902900,
            chunk_id=0,
            total_chunks=1,
            packet_index=0,
            total_size=12,
            packet_size=6,
            exact_chunk_packets=2,
        )

        await _handle_binary_packet(
            mock_ws,
            frame,
            session,
            storage,
            emit_event=lambda event_type, payload: events.append(
                (event_type, payload)
            ),
            emit_history_event=lambda payload: None,
        )

        event_types = [event_type for event_type, _payload in events]
        assert "scan-progress" in event_types
        assert "scan-session-state" in event_types
        state_event = next(
            payload
            for event_type, payload in events
            if event_type == "scan-session-state"
        )
        assert state_event["type"] == "scan-session-state"
        assert state_event["sessionId"] == "1774902900"
        assert state_event["receivedUnique"] == 1
        assert state_event["completionPercent"] == 50
        assert state_event["decodeThreshold"] == 2
        assert state_event["totalPackets"] == 2
        assert state_event["totalPacketsExact"] is True
        chunks = state_event["chunks"]
        assert isinstance(chunks, list)
        assert chunks[0]["receivedUnique"] == 1
        assert chunks[0]["decodeThreshold"] == 2
        assert chunks[0]["totalPackets"] == 2
        assert chunks[0]["totalPacketsExact"] is True

    @pytest.mark.asyncio
    async def test_auto_complete_does_not_start_concurrent_assembly(self) -> None:
        session = ScanSessionState("1774902900")
        session.set_metadata(expected_packets=1, total_chunks=1)
        assert session.record_packet(0, 0) is True
        assert session.begin_assembly_attempt() is True

        mock_ws = AsyncMock()
        storage = MagicMock()
        storage.read_session.return_value = {
            "sessionId": "1774902900",
            "status": "active",
            "expectedPackets": 1,
            "receivedCount": 1,
        }
        events: list[tuple[str, dict[str, object]]] = []

        with patch("sync_server.ws_scan_handler.assemble_scan_session_file") as assemble:
            completed = await _maybe_auto_complete_session(
                mock_ws,
                session,
                storage,
                emit_event=lambda event_type, payload: events.append(
                    (event_type, payload)
                ),
                emit_history_event=lambda payload: None,
            )

        assert completed is False
        assemble.assert_not_called()
        assert [event_type for event_type, _payload in events] == [
            "scan-session-state"
        ]
        assert events[0][1]["assembly"]["inProgress"] is True

    @pytest.mark.asyncio
    async def test_auto_complete_failure_emits_canonical_state_and_clears_gate(
        self,
    ) -> None:
        session = ScanSessionState("session-fail")
        session.set_metadata(expected_packets=1, total_chunks=1)
        assert session.record_packet(0, 0) is True

        mock_ws = AsyncMock()
        storage = MagicMock()
        storage.read_session.return_value = {
            "sessionId": "session-fail",
            "status": "active",
            "expectedPackets": 1,
            "receivedCount": 1,
            "totalChunks": 1,
        }
        events: list[tuple[str, dict[str, object]]] = []

        with patch(
            "sync_server.ws_scan_handler.assemble_scan_session_file",
            side_effect=ScanAssemblyError("Missing packet 0"),
        ):
            completed = await _maybe_auto_complete_session(
                mock_ws,
                session,
                storage,
                emit_event=lambda event_type, payload: events.append(
                    (event_type, payload)
                ),
                emit_history_event=lambda payload: None,
            )

        assert completed is False
        state_events = [
            payload
            for event_type, payload in events
            if event_type == "scan-session-state"
        ]
        assert len(state_events) == 2
        assert state_events[0]["assembly"]["inProgress"] is True
        assert state_events[0]["decodeState"] == "assembling"
        assert state_events[-1]["assembly"]["inProgress"] is False
        assert state_events[-1]["assembly"]["lastError"] == "Missing packet 0"
        assert state_events[-1]["decodeState"] == "decode_pending"
        assert session.get_assembly_snapshot()["inProgress"] is False

    @pytest.mark.asyncio
    async def test_resume_retries_failed_auto_complete_after_stale_retry_delay(
        self,
    ) -> None:
        session = ScanSessionState("session-resume-retry")
        session.set_metadata(
            filename="scan.zip",
            mime_type="application/zip",
            expected_packets=1,
            total_packets=1,
            total_packets_exact=True,
            total_chunks=1,
        )
        assert session.record_packet(0, 0) is True
        assert session.begin_assembly_attempt() is True
        session.finish_assembly_attempt(success=False, error="decoder was not ready")

        persisted_session: dict[str, object] = {
            "sessionId": "session-resume-retry",
            "status": "active",
            "expectedPackets": 1,
            "totalPackets": 1,
            "totalPacketsExact": True,
            "receivedCount": 1,
            "totalChunks": 1,
            "mimeType": "application/zip",
            "chunkStates": [
                {
                    "chunkId": 0,
                    "receivedCount": 1,
                    "lastContiguous": 0,
                    "receivedRanges": [[0, 0]],
                    "expectedPackets": 1,
                    "totalPackets": 1,
                    "totalPacketsExact": True,
                }
            ],
        }

        def read_session(_session_id: str) -> dict[str, object]:
            return dict(persisted_session)

        def write_session(_session_id: str, payload: dict[str, object]) -> None:
            persisted_session.clear()
            persisted_session.update(payload)

        mock_ws = AsyncMock()
        storage = MagicMock()
        storage.read_session.side_effect = read_session
        storage.write_session.side_effect = write_session
        storage.save_session_file.return_value = Path(
            "sessions/session-resume-retry/files/scan.zip"
        )
        events: list[tuple[str, dict[str, object]]] = []

        with patch(
            "sync_server.ws_scan_handler.assemble_scan_session_file",
            return_value=("scan.zip", b"decoded"),
        ) as assemble:
            await _handle_resume(
                mock_ws,
                {"fromPacketIndex": 0},
                session,
                storage,
                emit_event=lambda event_type, payload: events.append(
                    (event_type, payload)
                ),
                emit_history_event=lambda payload: None,
                stale_retry_after_seconds=0,
            )

        assemble.assert_called_once_with(storage, "session-resume-retry")
        assert persisted_session["status"] == "complete"
        assert persisted_session["completed"] is True
        assert persisted_session["filename"] == "scan.zip"
        assert ("scan-complete",) == tuple(
            event_type for event_type, _payload in events if event_type == "scan-complete"
        )
        sent_messages = [
            json.loads(call.args[0])
            for call in mock_ws.send.await_args_list
        ]
        assert sent_messages[0]["type"] == "resumeState"
        assert sent_messages[-1]["type"] == "completed"
        assert sent_messages[-1]["success"] is True
        assert sent_messages[-1]["autoCompleted"] is True

    @pytest.mark.asyncio
    async def test_auto_complete_keeps_legacy_scan_complete_on_success(self) -> None:
        session = ScanSessionState("session-success")
        session.set_metadata(
            filename="ws-success.bin",
            mime_type="application/octet-stream",
            expected_packets=1,
            total_packets=3,
            total_packets_exact=True,
            total_chunks=1,
        )
        assert session.record_packet(0, 0) is True

        mock_ws = AsyncMock()
        storage = MagicMock()
        persisted_session: dict[str, object] = {
            "sessionId": "session-success",
            "status": "active",
            "expectedPackets": 1,
            "receivedCount": 1,
            "totalChunks": 1,
        }

        def read_session(_session_id: str) -> dict[str, object]:
            return dict(persisted_session)

        def write_session(_session_id: str, payload: dict[str, object]) -> None:
            persisted_session.clear()
            persisted_session.update(payload)

        storage.read_session.side_effect = read_session
        storage.write_session.side_effect = write_session
        storage.save_session_file.return_value = Path(
            "sessions/session-success/files/ws-success.bin"
        )
        events: list[tuple[str, dict[str, object]]] = []

        with patch(
            "sync_server.ws_scan_handler.assemble_scan_session_file",
            return_value=("ws-success.bin", b"x"),
        ):
            completed = await _maybe_auto_complete_session(
                mock_ws,
                session,
                storage,
                emit_event=lambda event_type, payload: events.append(
                    (event_type, payload)
                ),
                emit_history_event=lambda payload: None,
            )

        assert completed is True
        event_types = [event_type for event_type, _payload in events]
        assert event_types[-1] == "scan-complete"
        assert "scan-complete" in event_types
        final_state = [
            payload
            for event_type, payload in events
            if event_type == "scan-session-state"
        ][-1]
        assert final_state["status"] == "complete"
        assert final_state["decodeState"] == "complete"
        assert final_state["completionPercent"] == 100
        assert final_state["fileAvailable"] is True
        assert final_state["chunksComplete"] == final_state["chunksTotal"]
        assert final_state["chunksMissing"] == 0
        assert all(chunk["state"] == "complete" for chunk in final_state["chunks"])
        legacy_complete = events[-1][1]
        assert legacy_complete["sessionId"] == "session-success"
        assert legacy_complete["completed"] is True
        assert legacy_complete["filename"] == "ws-success.bin"

    @pytest.mark.asyncio
    async def test_auto_complete_unavailable_emits_canonical_state_and_clears_gate(
        self,
    ) -> None:
        session = ScanSessionState("session-unavailable")
        session.set_metadata(expected_packets=1, total_chunks=1)
        assert session.record_packet(0, 0) is True

        mock_ws = AsyncMock()
        storage = MagicMock()
        storage.read_session.return_value = {
            "sessionId": "session-unavailable",
            "status": "active",
            "expectedPackets": 1,
            "receivedCount": 1,
            "totalChunks": 1,
        }
        events: list[tuple[str, dict[str, object]]] = []

        with patch(
            "sync_server.ws_scan_handler.assemble_scan_session_file",
            side_effect=ScanAssemblyUnavailableError("assembler missing"),
        ):
            completed = await _maybe_auto_complete_session(
                mock_ws,
                session,
                storage,
                emit_event=lambda event_type, payload: events.append(
                    (event_type, payload)
                ),
                emit_history_event=lambda payload: None,
            )

        assert completed is False
        state_events = [
            payload
            for event_type, payload in events
            if event_type == "scan-session-state"
        ]
        assert len(state_events) == 2
        assert state_events[0]["assembly"]["inProgress"] is True
        assert state_events[0]["decodeState"] == "assembling"
        assert state_events[-1]["assembly"]["inProgress"] is False
        assert state_events[-1]["assembly"]["lastError"] == "assembler missing"
        assert state_events[-1]["decodeState"] == "decode_pending"
        assert session.get_assembly_snapshot()["inProgress"] is False

    @pytest.mark.asyncio
    async def test_first_packet_logs_structured_progress_checkpoint(self, caplog) -> None:
        from sync_server.ws_scan_protocol import build_binary_header, compute_crc32

        session = ScanSessionState("session-123")
        session.claim_producer("device-A")
        mock_ws = AsyncMock()
        mock_ws.request.path = "/api/v1/ws/scan/session-123?connectionId=conn-9"
        mock_ws.request_headers = {
            "Origin": "https://192.168.1.36:5173",
        }
        mock_ws.remote_address = ("192.168.1.50", 5173)

        payload = b"test packet data"
        crc = compute_crc32(payload)
        header = build_binary_header(1, 0, 0, 0, crc)
        packet = header + payload

        with caplog.at_level("INFO", logger="sync_server.ws_scan_handler"):
            await _handle_binary_packet(mock_ws, packet, session)

        assert "ws.scan.progress_checkpoint" in caplog.text
        assert "sessionId=session-123" in caplog.text
        assert "connectionId=conn-9" in caplog.text
        assert "packetIndex=0" in caplog.text
        assert "progressReceivedCount=1" in caplog.text
        assert "chunkId=0" in caplog.text

    @pytest.mark.asyncio
    async def test_packets_with_same_index_on_different_chunks_are_both_recorded(self) -> None:
        """Should treat (chunkId, packetIndex) as the unique packet identity."""
        from sync_server.ws_scan_protocol import build_binary_header, compute_crc32

        session = ScanSessionState("session-123")
        session.claim_producer("device-A")
        mock_ws = AsyncMock()

        payload_a = b"chunk-zero-packet-zero"
        header_a = build_binary_header(1, 0, 0, 0, compute_crc32(payload_a))
        await _handle_binary_packet(mock_ws, header_a + payload_a, session)

        payload_b = b"chunk-one-packet-zero"
        header_b = build_binary_header(1, 0, 1, 0, compute_crc32(payload_b))
        await _handle_binary_packet(mock_ws, header_b + payload_b, session)

        assert session.received_count == 2

    @pytest.mark.asyncio
    async def test_valid_packet_is_persisted_with_storage(self) -> None:
        """Should persist binary packet and session metadata when storage is provided."""
        from sync_server.ws_scan_protocol import build_binary_header, compute_crc32

        session = ScanSessionState("session-123")
        session.claim_producer("device-A")
        session.set_metadata(
            filename="test.bin",
            total_packets=20,
            total_chunks=2,
        )

        mock_ws = AsyncMock()
        mock_storage = MagicMock()
        mock_storage.read_session.return_value = {}

        payload = b"test packet data"
        crc = compute_crc32(payload)
        header = build_binary_header(1, 0, 0, 0, crc)
        packet = header + payload

        await _handle_binary_packet(mock_ws, packet, session, mock_storage)

        mock_storage.save_session_packet.assert_called_once()
        save_args = mock_storage.save_session_packet.call_args[0]
        assert save_args[0] == "session-123"
        assert save_args[1] == payload

        mock_storage.write_session.assert_called_once()
        write_args = mock_storage.write_session.call_args[0]
        assert write_args[0] == "session-123"
        session_meta = write_args[1]
        assert session_meta["sessionId"] == "session-123"
        assert session_meta["receivedCount"] == 1
        assert session_meta["expectedPackets"] == 20
        assert session_meta["totalPackets"] == 20
        assert session_meta["filename"] == "test.bin"

    @pytest.mark.asyncio
    async def test_valid_packet_sends_packet_ack_after_persistence(self) -> None:
        """Should ACK a packet only after it has been durably stored."""
        session = ScanSessionState("session-ack")
        session.claim_producer("device-A")
        session.set_metadata(
            filename="test.bin",
            total_packets=10,
            total_chunks=1,
        )

        mock_ws = AsyncMock()
        mock_storage = MagicMock()
        mock_storage.read_session.return_value = {
            "sessionId": "session-ack",
            "status": "active",
        }
        mock_storage.save_session_packet.return_value = (Path("packet.bin"), True)
        mock_storage.write_session = MagicMock()

        frame = _build_streaming_frame(
            session_id=1774902900,
            chunk_id=0,
            total_chunks=1,
            packet_index=7,
            total_size=12,
            packet_size=6,
            exact_chunk_packets=10,
        )

        await _handle_binary_packet(mock_ws, frame, session, mock_storage)

        sent_messages = [
            json.loads(call.args[0])
            for call in mock_ws.send.call_args_list
            if call.args and isinstance(call.args[0], str)
        ]
        ack = next(message for message in sent_messages if message["type"] == "packetAck")
        assert ack["sessionId"] == "session-ack"
        assert ack["acked"] == {"chunkId": 0, "packetIndex": 7}
        assert ack["receivedCount"] == 1
        assert ack["stateVersion"] == session.state_version
        assert ack["windowSize"] >= 1

    @pytest.mark.asyncio
    async def test_identical_persisted_retry_is_idempotently_acknowledged(self) -> None:
        session_id = "session-idempotent-retry"
        frame = _build_streaming_frame(
            session_id=1774902900,
            chunk_id=0,
            total_chunks=1,
            packet_index=7,
            total_size=12,
            packet_size=6,
            exact_chunk_packets=10,
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            storage = SqliteStorage(Path(temp_dir))
            storage.ensure_dirs()
            first_session = ScanSessionState(session_id)
            retry_session = ScanSessionState(session_id)
            first_ws = AsyncMock()
            retry_ws = AsyncMock()

            await _handle_binary_packet(first_ws, frame, first_session, storage)
            await _handle_binary_packet(retry_ws, frame, retry_session, storage)

            assert storage.count_packets(session_id) == 1
            retry_messages = [
                json.loads(call.args[0]) for call in retry_ws.send.call_args_list
            ]
            assert [message["type"] for message in retry_messages] == ["packetAck"]
            assert retry_messages[0]["acked"] == {"chunkId": 0, "packetIndex": 7}

    @pytest.mark.asyncio
    async def test_conflicting_persisted_retry_is_rejected_without_overwrite(self) -> None:
        from sync_server.ws_scan_protocol import build_binary_header, compute_crc32

        session_id = "session-conflicting-retry"
        original = b"original packet"
        conflict = b"conflicting packet"
        original_frame = build_binary_header(
            1, 0, 0, 4, compute_crc32(original)
        ) + original
        conflict_frame = build_binary_header(
            1, 0, 0, 4, compute_crc32(conflict)
        ) + conflict

        with tempfile.TemporaryDirectory() as temp_dir:
            storage = SqliteStorage(Path(temp_dir))
            storage.ensure_dirs()
            await _handle_binary_packet(
                AsyncMock(), original_frame, ScanSessionState(session_id), storage
            )
            conflict_ws = AsyncMock()
            await _handle_binary_packet(
                conflict_ws, conflict_frame, ScanSessionState(session_id), storage
            )

            assert storage.count_packets(session_id) == 1
            assert storage.list_packets(session_id) == [original]
            error = json.loads(conflict_ws.send.call_args[0][0])
            assert error["type"] == "error"
            assert error["code"] == "packet_conflict"
            assert error["fatal"] is False

    @pytest.mark.asyncio
    async def test_same_session_packet_commits_are_serialized_across_threads(self) -> None:
        """Two event-loop threads must not overwrite one another's metadata merge."""

        class CoordinatedSqliteStorage(SqliteStorage):
            def __init__(self, base_dir: Path) -> None:
                super().__init__(base_dir)
                self._reads = threading.local()
                self._metadata_read_barrier = threading.Barrier(2)

            def read_session(self, session_id: str):  # type: ignore[no-untyped-def]
                read_count = getattr(self._reads, "count", 0) + 1
                self._reads.count = read_count
                snapshot = super().read_session(session_id)
                if read_count == 2:
                    try:
                        self._metadata_read_barrier.wait(timeout=0.5)
                    except threading.BrokenBarrierError:
                        # With correct serialization, the other commit cannot enter
                        # this critical section until this one has completed.
                        pass
                return snapshot

        session_id = "session-threaded-commit"
        frame_a = _build_streaming_frame(
            session_id=1774902900,
            chunk_id=0,
            total_chunks=2,
            packet_index=0,
            total_size=12,
            packet_size=6,
            exact_chunk_packets=10,
        )
        frame_b = _build_streaming_frame(
            session_id=1774902900,
            chunk_id=1,
            total_chunks=2,
            packet_index=0,
            total_size=12,
            packet_size=6,
            exact_chunk_packets=10,
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            storage = CoordinatedSqliteStorage(Path(temp_dir))
            storage.ensure_dirs()

            def commit(frame: bytes) -> None:
                asyncio.run(
                    _handle_binary_packet(
                        AsyncMock(), frame, ScanSessionState(session_id), storage
                    )
                )

            await asyncio.gather(
                asyncio.to_thread(commit, frame_a),
                asyncio.to_thread(commit, frame_b),
            )

            persisted = storage.read_session(session_id)
            assert persisted is not None
            assert persisted["receivedCount"] == 2
            assert storage.count_packets(session_id) == 2

    @pytest.mark.asyncio
    async def test_completed_session_acks_only_identical_durable_retry(self) -> None:
        from sync_server.ws_scan_protocol import build_binary_header, compute_crc32

        session_id = "session-completed-retry"
        payload = b"durable packet"
        frame = build_binary_header(1, 0, 0, 2, compute_crc32(payload)) + payload
        late_payload = b"new late packet"
        late_frame = (
            build_binary_header(1, 0, 0, 3, compute_crc32(late_payload))
            + late_payload
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            storage = SqliteStorage(Path(temp_dir))
            storage.ensure_dirs()
            await _handle_binary_packet(
                AsyncMock(), frame, ScanSessionState(session_id), storage
            )
            completed = storage.read_session(session_id) or {}
            completed.update(
                {
                    "status": "complete",
                    "completed": True,
                    "completedAt": "2026-07-15T10:00:00Z",
                }
            )
            storage.write_session(session_id, completed)

            retry_ws = AsyncMock()
            await _handle_binary_packet(
                retry_ws, frame, ScanSessionState(session_id), storage
            )
            retry = json.loads(retry_ws.send.call_args[0][0])
            assert retry["type"] == "packetAck"

            late_ws = AsyncMock()
            await _handle_binary_packet(
                late_ws, late_frame, ScanSessionState(session_id), storage
            )
            rejected = json.loads(late_ws.send.call_args[0][0])
            assert rejected["type"] == "error"
            assert rejected["code"] == "session_completed"
            assert storage.count_packets(session_id) == 1
            terminal = storage.read_session(session_id) or {}
            assert terminal["status"] == "complete"
            assert terminal["completed"] is True
            assert terminal["completedAt"] == "2026-07-15T10:00:00Z"

    @pytest.mark.asyncio
    async def test_packet_racing_completion_is_rejected_after_terminal_commit(self) -> None:
        from sync_server.ws_scan_protocol import build_binary_header, compute_crc32

        class BlockingCompletionStorage(SqliteStorage):
            def __init__(self, base_dir: Path) -> None:
                super().__init__(base_dir)
                self.completion_entered = threading.Event()
                self.release_completion = threading.Event()

            def save_session_file(
                self, session_id: str, filename: str, file_bytes: bytes
            ) -> Path:
                self.completion_entered.set()
                assert self.release_completion.wait(timeout=2.0)
                return super().save_session_file(session_id, filename, file_bytes)

        session_id = "session-completion-race"
        payload = b"late packet"
        frame = build_binary_header(1, 0, 0, 0, compute_crc32(payload)) + payload

        with tempfile.TemporaryDirectory() as temp_dir:
            storage = BlockingCompletionStorage(Path(temp_dir))
            storage.ensure_dirs()
            storage.write_session(session_id, {"sessionId": session_id, "status": "active"})
            completion_session = ScanSessionState(session_id)
            packet_session = ScanSessionState(session_id)
            completion_ws = AsyncMock()
            packet_ws = AsyncMock()
            packet_started = threading.Event()

            def complete() -> None:
                asyncio.run(
                    _handle_complete(
                        completion_ws,
                        {"type": "complete"},
                        completion_session,
                        storage,
                    )
                )

            def commit_late_packet() -> None:
                packet_started.set()
                asyncio.run(
                    _handle_binary_packet(packet_ws, frame, packet_session, storage)
                )

            with patch(
                "sync_server.ws_scan_handler.assemble_scan_session_file",
                return_value=("complete.bin", b"complete"),
            ):
                completion_task = asyncio.create_task(asyncio.to_thread(complete))
                assert await asyncio.to_thread(storage.completion_entered.wait, 1.0)
                packet_task = asyncio.create_task(asyncio.to_thread(commit_late_packet))
                assert await asyncio.to_thread(packet_started.wait, 1.0)
                storage.release_completion.set()
                await asyncio.gather(completion_task, packet_task)

            packet_response = json.loads(packet_ws.send.call_args[0][0])
            assert packet_response["type"] == "error"
            assert packet_response["code"] == "session_completed"
            assert storage.count_packets(session_id) == 0
            terminal = storage.read_session(session_id) or {}
            assert terminal["status"] == "complete"
            assert terminal["completed"] is True

    @pytest.mark.asyncio
    async def test_packet_invalidated_by_delete_is_rejected_without_publication(self) -> None:
        session_id = "session-deleted-while-waiting"
        frame = _build_streaming_frame(
            session_id=1774902900,
            chunk_id=0,
            total_chunks=1,
            packet_index=0,
            total_size=6,
            packet_size=6,
            exact_chunk_packets=1,
        )
        websocket = AsyncMock()
        emit_event = MagicMock()
        emit_history_event = MagicMock()

        with patch(
            "sync_server.ws_scan_handler._commit_binary_packet",
            return_value="deleted",
        ):
            await _handle_binary_packet(
                websocket,
                frame,
                ScanSessionState(session_id),
                MagicMock(),
                emit_event=emit_event,
                emit_history_event=emit_history_event,
            )

        response = json.loads(websocket.send.call_args[0][0])
        assert response["type"] == "error"
        assert response["code"] == "session_deleted"
        assert response["fatal"] is False
        emit_event.assert_not_called()
        emit_history_event.assert_not_called()

    @pytest.mark.parametrize(
        "storage_type",
        [Storage, SqliteStorage],
        ids=["filesystem", "sqlite"],
    )
    @pytest.mark.asyncio
    async def test_delete_waits_for_complete_packet_publication_and_ack(
        self,
        tmp_path: Path,
        storage_type: type[Storage] | type[SqliteStorage],
    ) -> None:
        """A packet engaged first must fully reply before DELETE can complete."""
        from sync_server.handler import SyncRequestHandler
        from sync_server.routes_history import handle_delete_session
        from sync_server import ws_scan_handler

        session_id = "session-deleted-after-commit"
        frame = _build_streaming_frame(
            session_id=1774902900,
            chunk_id=0,
            total_chunks=1,
            packet_index=0,
            total_size=12,
            packet_size=6,
            exact_chunk_packets=10,
        )
        storage = storage_type(tmp_path / storage_type.__name__)
        storage.ensure_dirs()
        storage.write_session(session_id, {"sessionId": session_id, "status": "active"})
        session_store = ScanSessionStore()
        session = session_store.get_or_create(session_id)
        websocket = AsyncMock()
        packet_emit_event = MagicMock()
        packet_emit_history_event = MagicMock()

        delete_handler = MagicMock(spec=SyncRequestHandler)
        delete_handler.context = MagicMock()
        delete_handler.context.storage = storage
        delete_handler.server = MagicMock()
        delete_handler.server.scan_session_store = session_store
        delete_started = threading.Event()

        def require_auth() -> bool:
            delete_started.set()
            return True

        delete_handler._require_auth = MagicMock(side_effect=require_auth)
        delete_handler._send_json = MagicMock()
        delete_handler._emit_event = MagicMock()
        delete_handler._emit_history_event = MagicMock()

        durable_commit_returned = threading.Event()
        release_packet_handler = threading.Event()
        original_commit = ws_scan_handler._commit_binary_packet

        def pause_after_commit(*args, **kwargs):  # type: ignore[no-untyped-def]
            result = original_commit(*args, **kwargs)
            durable_commit_returned.set()
            assert release_packet_handler.wait(timeout=2.0)
            return result

        def handle_packet() -> None:
            asyncio.run(
                _handle_binary_packet(
                    websocket,
                    frame,
                    session,
                    storage,
                    emit_event=packet_emit_event,
                    emit_history_event=packet_emit_history_event,
                )
            )

        with patch(
            "sync_server.ws_scan_handler._commit_binary_packet",
            side_effect=pause_after_commit,
        ):
            packet_task = asyncio.create_task(asyncio.to_thread(handle_packet))
            assert await asyncio.to_thread(durable_commit_returned.wait, 1.0)
            delete_task = asyncio.create_task(
                asyncio.to_thread(handle_delete_session, delete_handler, session_id)
            )
            assert await asyncio.to_thread(delete_started.wait, 1.0)
            await asyncio.sleep(0.05)
            assert not delete_task.done()
            release_packet_handler.set()
            await asyncio.gather(packet_task, delete_task)

        response = json.loads(websocket.send.call_args[0][0])
        assert response["type"] == "packetAck"
        packet_emit_event.assert_called()
        packet_emit_history_event.assert_called()
        assert storage.read_session(session_id) is None
        assert storage.count_packets(session_id) == 0
        assert session_store.get(session_id) is None
        assert session.received_count == 0

        replacement = session_store.get_or_create(session_id)
        assert replacement is not session
        assert replacement.received_count == 0


    @pytest.mark.asyncio
    async def test_completion_persists_and_emits_before_response_send_failure(self) -> None:
        session_id = "session-completion-send-failure"
        session = ScanSessionState(session_id)
        websocket = AsyncMock()
        websocket.send.side_effect = OSError("peer disconnected")
        emit_event = MagicMock()

        with tempfile.TemporaryDirectory() as temp_dir:
            storage = SqliteStorage(Path(temp_dir))
            storage.ensure_dirs()
            with patch(
                "sync_server.ws_scan_handler.assemble_scan_session_file",
                return_value=("complete.bin", b"complete"),
            ):
                with pytest.raises(OSError, match="peer disconnected"):
                    await _handle_complete(
                        websocket,
                        {"type": "complete"},
                        session,
                        storage,
                        emit_event=emit_event,
                    )

            terminal = storage.read_session(session_id) or {}
            assert terminal["status"] == "complete"
            assert terminal["completed"] is True
            emitted = _emitted_events(emit_event)
            assert any(event_type == "scan-complete" for event_type, _ in emitted)

    @pytest.mark.asyncio
    async def test_valid_packet_creates_session_before_packet_ranges_with_sqlite(self) -> None:
        """Should persist multi-chunk packet metadata without relying on flat packet_ranges."""
        from sync_server.ws_scan_protocol import build_binary_header, compute_crc32

        session = ScanSessionState("session-sqlite")
        session.claim_producer("device-A")
        session.set_metadata(
            filename="test.bin",
            mime_type="application/octet-stream",
            file_size=16,
            total_packets=20,
            total_chunks=2,
            packet_size=16,
        )

        mock_ws = AsyncMock()
        payload = b"test packet data"
        crc = compute_crc32(payload)
        header = build_binary_header(1, 0, 0, 0, crc)
        packet = header + payload

        with tempfile.TemporaryDirectory() as temp_dir:
            storage = SqliteStorage(Path(temp_dir))
            storage.ensure_dirs()

            await _handle_binary_packet(mock_ws, packet, session, storage)

            persisted = storage.read_session("session-sqlite")
            assert persisted is not None
            assert persisted["receivedCount"] == 1
            assert persisted["expectedPackets"] == 20
            assert persisted["lastContiguous"] == 0
            assert storage.count_packets("session-sqlite") == 1
            assert storage.get_packet_ranges("session-sqlite") == []

    @pytest.mark.asyncio
    async def test_streaming_packet_rejects_mismatched_ws_header_identity(self) -> None:
        """Should reject a streaming packet when the WS frame header disagrees with the payload identity."""
        from sync_server.ws_scan_protocol import build_binary_header, compute_crc32

        session = ScanSessionState("session-identity")
        session.claim_producer("device-A")
        mock_ws = AsyncMock()

        payload = _build_streaming_payload(
            session_id=1774906017,
            chunk_id=1,
            total_chunks=3,
            packet_index=7,
            total_size=20,
            packet_size=10,
            exact_chunk_packets=5,
        )
        frame = build_binary_header(1, 0, 1, 6, compute_crc32(payload)) + payload

        await _handle_binary_packet(mock_ws, frame, session)

        assert session.received_count == 0
        sent = json.loads(mock_ws.send.call_args[0][0])
        assert sent["type"] == "error"
        assert sent["code"] == "packet_identity_mismatch"
        assert sent["fatal"] is False

    @pytest.mark.asyncio
    async def test_persist_failure_does_not_advance_live_ws_scan_state(self) -> None:
        """Should not advance live counters when durable packet persistence fails."""
        from sync_server.ws_scan_protocol import build_binary_header, compute_crc32

        session = ScanSessionState("session-persist-fail")
        session.claim_producer("device-A")
        session.set_metadata(
            filename="test.bin",
            total_packets=20,
            total_chunks=2,
        )

        mock_ws = AsyncMock()
        mock_storage = MagicMock()
        mock_storage.read_session.return_value = {}
        mock_storage.save_session_packet.side_effect = OSError("disk full")

        payload = b"test packet data"
        crc = compute_crc32(payload)
        header = build_binary_header(1, 0, 0, 0, crc)
        packet = header + payload

        await _handle_binary_packet(mock_ws, packet, session, mock_storage)

        assert session.received_count == 0
        mock_storage.write_session.assert_not_called()
        sent = json.loads(mock_ws.send.call_args[0][0])
        assert sent["type"] == "error"
        assert sent["code"] == "persist_failed"
        assert sent["fatal"] is False
        sent_messages = [
            json.loads(call.args[0])
            for call in mock_ws.send.call_args_list
            if call.args and isinstance(call.args[0], str)
        ]
        assert not any(message.get("type") == "packetAck" for message in sent_messages)

    @pytest.mark.asyncio
    async def test_invalid_crc_sends_error(self) -> None:
        """Should reject packet with invalid CRC."""
        from sync_server.ws_scan_protocol import build_binary_header

        session = ScanSessionState("session-123")
        session.claim_producer("device-A")
        mock_ws = AsyncMock()

        payload = b"test packet data"
        bad_crc = 0xDEADBEEF  # Wrong CRC
        header = build_binary_header(1, 0, 0, 0, bad_crc)
        packet = header + payload

        await _handle_binary_packet(mock_ws, packet, session)

        # Packet should NOT be recorded
        assert session.received_count == 0

        sent = json.loads(mock_ws.send.call_args[0][0])
        assert sent["type"] == "error"
        assert sent["code"] == "invalid_checksum"
        assert sent["fatal"] is False

    @pytest.mark.asyncio
    async def test_short_packet_sends_error(self) -> None:
        """Should reject packet that is too short."""
        session = ScanSessionState("session-123")
        session.claim_producer("device-A")
        mock_ws = AsyncMock()

        packet = b"short"  # Less than 12 bytes

        await _handle_binary_packet(mock_ws, packet, session)

        sent = json.loads(mock_ws.send.call_args[0][0])
        assert sent["type"] == "error"
        assert sent["code"] == "invalid_header"

    @pytest.mark.asyncio
    async def test_binary_packet_auto_completes_once_expected_packets_threshold_is_reached(
        self,
    ) -> None:
        """Should auto-complete when the decode threshold is reached, without waiting for overhead frames."""
        from sync_server.ws_scan_protocol import build_binary_header, compute_crc32

        session = ScanSessionState("session-123")
        session.claim_producer("device-A")
        mock_ws = AsyncMock()
        mock_storage = MagicMock()
        persisted_session: dict[str, object] = {}

        def read_session(_session_id: str) -> dict[str, object]:
            return dict(persisted_session)

        def write_session(_session_id: str, payload: dict[str, object]) -> None:
            persisted_session.clear()
            persisted_session.update(payload)

        mock_storage.read_session.side_effect = read_session
        mock_storage.write_session.side_effect = write_session
        mock_storage.save_session_file.return_value = Path(
            "sessions/session-123/files/ws-auto.bin"
        )
        emit_event = MagicMock()
        emit_history_event = MagicMock()

        await _handle_meta(
            mock_ws,
            {
                "type": "meta",
                "filename": "ws-auto.bin",
                "mimeType": "application/octet-stream",
                "expectedPackets": 1,
                "totalPackets": 3,
                "totalPacketsExact": True,
            },
            session,
        )
        mock_ws.send.reset_mock()

        payload = b"test packet data"
        crc = compute_crc32(payload)
        header = build_binary_header(1, 0, 0, 0, crc)
        packet = header + payload

        with patch(
            "sync_server.ws_scan_handler.assemble_scan_session_file",
            return_value=("ws-auto.bin", payload),
        ):
            await _handle_binary_packet(
                mock_ws,
                packet,
                session,
                mock_storage,
                emit_event=emit_event,
                emit_history_event=emit_history_event,
            )

        mock_storage.save_session_file.assert_called_once_with(
            "session-123",
            "ws-auto.bin",
            payload,
        )
        written_session = dict(persisted_session)
        assert written_session["completed"] is True
        assert written_session["status"] == "complete"
        assert written_session["expectedPackets"] == 1
        assert written_session["totalPackets"] == 3
        assert written_session["totalPacketsExact"] is True

        sent = json.loads(mock_ws.send.call_args[0][0])
        assert sent["type"] == "completed"
        assert sent["success"] is True
        emitted_events = _emitted_events(emit_event)
        progress_event = emitted_events[0]
        assert progress_event[0] == "scan-progress"
        assert progress_event[1]["sessionId"] == "session-123"
        assert progress_event[1]["receivedCount"] == 1
        assert progress_event[1]["expectedPackets"] == 1
        assert progress_event[1]["totalPackets"] == 3
        assert progress_event[1]["totalPacketsExact"] is True
        assert progress_event[1]["filename"] == "ws-auto.bin"

        state_events = [
            payload
            for event_type, payload in emitted_events
            if event_type == "scan-session-state"
        ]
        assert state_events[-1]["decodeState"] == "complete"
        assert state_events[-1]["fileAvailable"] is True
        assert state_events[-1]["assembly"]["inProgress"] is False

        complete_event = emitted_events[-1]
        assert complete_event[0] == "scan-complete"
        assert complete_event[1]["sessionId"] == "session-123"
        assert complete_event[1]["completed"] is True
        assert complete_event[1]["filename"] == "ws-auto.bin"
        assert complete_event[1]["size"] == len(payload)

    @pytest.mark.asyncio
    async def test_final_packet_completion_survives_packet_ack_send_failure(self) -> None:
        session = ScanSessionState("session-final-ack-failure")
        session.set_metadata(filename="complete.bin", total_packets=1)
        websocket = AsyncMock()
        websocket.send.side_effect = OSError("ack transport failed")
        emit_event = MagicMock()
        payload = b"final packet"
        from sync_server.ws_scan_protocol import build_binary_header, compute_crc32

        frame = build_binary_header(1, 0, 0, 0, compute_crc32(payload)) + payload
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = SqliteStorage(Path(temp_dir))
            storage.ensure_dirs()
            with patch(
                "sync_server.ws_scan_handler.assemble_scan_session_file",
                return_value=("complete.bin", payload),
            ):
                with pytest.raises(OSError, match="ack transport failed"):
                    await _handle_binary_packet(
                        websocket,
                        frame,
                        session,
                        storage,
                        emit_event=emit_event,
                    )

            terminal = storage.read_session(session.session_id) or {}
            assert terminal["status"] == "complete"
            assert terminal["completed"] is True
            assert any(
                event_type == "scan-complete"
                for event_type, _ in _emitted_events(emit_event)
            )

    @pytest.mark.asyncio
    async def test_duplicate_retry_repairs_fail_once_packet_metadata_commit(self) -> None:
        class FailOnceMetadataStorage(SqliteStorage):
            def __init__(self, base_dir: Path) -> None:
                super().__init__(base_dir)
                self.fail_next_session_write = True

            def write_session(self, session_id: str, session: dict) -> None:
                if self.fail_next_session_write:
                    self.fail_next_session_write = False
                    raise OSError("metadata write failed once")
                super().write_session(session_id, session)

        session_id = "session-repair-retry"
        payload = b"retry repair packet"
        from sync_server.ws_scan_protocol import build_binary_header, compute_crc32

        frame = build_binary_header(1, 0, 0, 5, compute_crc32(payload)) + payload
        emitted_events: list[tuple[str, dict]] = []

        def emit_event(event_type: str, event_payload: dict) -> None:
            emitted_events.append((event_type, event_payload))

        with tempfile.TemporaryDirectory() as temp_dir:
            storage = FailOnceMetadataStorage(Path(temp_dir))
            storage.ensure_dirs()
            first_ws = AsyncMock()
            await _handle_binary_packet(
                first_ws,
                frame,
                ScanSessionState(session_id),
                storage,
                emit_event=emit_event,
            )
            first_error = json.loads(first_ws.send.call_args[0][0])
            assert first_error["code"] == "persist_failed"
            assert storage.count_packets(session_id) == 1
            assert storage.read_session(session_id) is None
            assert storage.get_packet_ranges(session_id) == []

            retry_ws = AsyncMock()
            await _handle_binary_packet(
                retry_ws,
                frame,
                ScanSessionState(session_id),
                storage,
                emit_event=emit_event,
            )

            repaired = storage.read_session(session_id) or {}
            assert repaired["receivedCount"] == 1
            assert repaired["lastContiguous"] == -1
            assert storage.get_packet_ranges(session_id) == [(5, 5)]
            retry = json.loads(retry_ws.send.call_args[0][0])
            assert retry["type"] == "packetAck"
            await _handle_binary_packet(
                AsyncMock(),
                frame,
                ScanSessionState(session_id),
                storage,
                emit_event=emit_event,
            )
            event_types = [event_type for event_type, _ in emitted_events]
            assert event_types.count("scan-progress") == 1
            assert event_types.count("scan-session-state") == 1

    @pytest.mark.asyncio
    async def test_repaired_final_packet_auto_completes_before_ack(self) -> None:
        class FailOnceMetadataStorage(SqliteStorage):
            def __init__(self, base_dir: Path) -> None:
                super().__init__(base_dir)
                self.fail_next_session_write = True

            def write_session(self, session_id: str, session: dict) -> None:
                if self.fail_next_session_write:
                    self.fail_next_session_write = False
                    raise OSError("metadata write failed once")
                super().write_session(session_id, session)

        from sync_server.ws_scan_protocol import build_binary_header, compute_crc32

        session_id = "session-repaired-final"
        payload = b"repaired final packet"
        frame = build_binary_header(1, 0, 0, 0, compute_crc32(payload)) + payload
        timeline: list[str] = []

        def emit_event(event_type: str, _payload: dict) -> None:
            timeline.append(event_type)

        async def record_send(raw: str) -> None:
            timeline.append(json.loads(raw)["type"])

        with tempfile.TemporaryDirectory() as temp_dir:
            storage = FailOnceMetadataStorage(Path(temp_dir))
            storage.ensure_dirs()
            session = ScanSessionState(session_id)
            session.set_metadata(filename="complete.bin", total_packets=1)
            first_ws = AsyncMock()
            await _handle_binary_packet(first_ws, frame, session, storage)
            assert json.loads(first_ws.send.call_args[0][0])["code"] == "persist_failed"
            assert storage.count_packets(session_id) == 1

            retry_ws = AsyncMock()
            retry_ws.send.side_effect = record_send
            with patch(
                "sync_server.ws_scan_handler.assemble_scan_session_file",
                return_value=("complete.bin", payload),
            ) as assembler:
                await _handle_binary_packet(
                    retry_ws,
                    frame,
                    session,
                    storage,
                    emit_event=emit_event,
                )

            terminal = storage.read_session(session_id) or {}
            assert terminal["status"] == "complete"
            assert terminal["completed"] is True
            assert assembler.call_count == 1
            assert timeline.count("scan-progress") == 1
            assert timeline.count("scan-complete") == 1
            assert timeline.index("scan-progress") < timeline.index("scan-complete")
            assert timeline.index("scan-complete") < timeline.index("packetAck")

    @pytest.mark.asyncio
    async def test_duplicate_retry_repairs_fail_once_packet_range_commit(self) -> None:
        class FailOnceRangeStorage(SqliteStorage):
            def __init__(self, base_dir: Path) -> None:
                super().__init__(base_dir)
                self.fail_next_range_write = True

            def add_packet_range(self, session_id: str, start: int, end: int) -> None:
                if self.fail_next_range_write:
                    self.fail_next_range_write = False
                    raise OSError("range write failed once")
                super().add_packet_range(session_id, start, end)

        session_id = "session-repair-range-retry"
        payload = b"retry range packet"
        from sync_server.ws_scan_protocol import build_binary_header, compute_crc32

        frame = build_binary_header(1, 0, 0, 3, compute_crc32(payload)) + payload
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = FailOnceRangeStorage(Path(temp_dir))
            storage.ensure_dirs()
            first_ws = AsyncMock()
            await _handle_binary_packet(
                first_ws, frame, ScanSessionState(session_id), storage
            )
            first_error = json.loads(first_ws.send.call_args[0][0])
            assert first_error["code"] == "persist_failed"
            assert (storage.read_session(session_id) or {})["receivedCount"] == 1
            assert storage.get_packet_ranges(session_id) == []

            retry_ws = AsyncMock()
            await _handle_binary_packet(
                retry_ws, frame, ScanSessionState(session_id), storage
            )

            assert storage.get_packet_ranges(session_id) == [(3, 3)]
            retry = json.loads(retry_ws.send.call_args[0][0])
            assert retry["type"] == "packetAck"

    @pytest.mark.asyncio
    async def test_canonical_packet_filename_depends_only_on_identity(self) -> None:
        session_id = "session-canonical-name"
        frame = _build_streaming_frame(
            session_id=1774902900,
            chunk_id=2,
            total_chunks=3,
            packet_index=7,
            total_size=12,
            packet_size=6,
            exact_chunk_packets=10,
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = SqliteStorage(Path(temp_dir))
            storage.ensure_dirs()
            await _handle_binary_packet(
                AsyncMock(), frame, ScanSessionState(session_id), storage
            )
            entries = storage.list_packet_entries(session_id) or []
            assert [name for name, _ in entries] == ["packet-0002-00000007.bin"]

    @pytest.mark.asyncio
    async def test_canonical_commits_do_not_rescan_all_packets(self) -> None:
        class CountingStorage(SqliteStorage):
            def __init__(self, base_dir: Path) -> None:
                super().__init__(base_dir)
                self.entry_list_calls = 0

            def list_packet_entries(self, session_id: str):  # type: ignore[no-untyped-def]
                self.entry_list_calls += 1
                return super().list_packet_entries(session_id)

        from sync_server.ws_scan_protocol import build_binary_header, compute_crc32

        session_id = "session-indexed-canonical"
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = CountingStorage(Path(temp_dir))
            storage.ensure_dirs()
            session = ScanSessionState(session_id)
            for packet_index in range(20):
                payload = f"canonical-{packet_index}".encode()
                frame = (
                    build_binary_header(
                        1, 0, 0, packet_index, compute_crc32(payload)
                    )
                    + payload
                )
                await _handle_binary_packet(AsyncMock(), frame, session, storage)

            assert storage.count_packets(session_id) == 20
            assert storage.entry_list_calls <= 2

    @pytest.mark.asyncio
    async def test_multichunk_live_state_hydrates_durable_packets_only_once(self) -> None:
        class CountingStorage(SqliteStorage):
            def __init__(self, base_dir: Path) -> None:
                super().__init__(base_dir)
                self.entry_list_calls = 0
                self.entries_read = 0

            def list_packet_entries(self, session_id: str):  # type: ignore[no-untyped-def]
                entries = super().list_packet_entries(session_id)
                self.entry_list_calls += 1
                self.entries_read += len(entries or [])
                return entries

        session_id = "session-hydrate-once"
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = CountingStorage(Path(temp_dir))
            storage.ensure_dirs()
            session = ScanSessionState(session_id)
            for packet_index in range(30):
                frame = _build_streaming_frame(
                    session_id=1774902900,
                    chunk_id=packet_index % 2,
                    total_chunks=2,
                    packet_index=packet_index,
                    total_size=600,
                    packet_size=10,
                    exact_chunk_packets=100,
                )
                await _handle_binary_packet(AsyncMock(), frame, session, storage)

            assert storage.count_packets(session_id) == 30
            assert storage.entry_list_calls == 1
            assert storage.entries_read == 0

    @pytest.mark.asyncio
    async def test_fresh_session_state_rehydrates_once_after_restart(self) -> None:
        class CountingStorage(SqliteStorage):
            def __init__(self, base_dir: Path) -> None:
                super().__init__(base_dir)
                self.entry_list_calls = 0

            def list_packet_entries(self, session_id: str):  # type: ignore[no-untyped-def]
                self.entry_list_calls += 1
                return super().list_packet_entries(session_id)

        session_id = "session-hydrate-restart"
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = CountingStorage(Path(temp_dir))
            storage.ensure_dirs()
            first_state = ScanSessionState(session_id)
            for packet_index in range(4):
                await _handle_binary_packet(
                    AsyncMock(),
                    _build_streaming_frame(
                        session_id=1774902900,
                        chunk_id=packet_index % 2,
                        total_chunks=2,
                        packet_index=packet_index,
                        total_size=100,
                        packet_size=10,
                        exact_chunk_packets=20,
                    ),
                    first_state,
                    storage,
                )

            restarted_state = ScanSessionState(session_id)
            await _handle_binary_packet(
                AsyncMock(),
                _build_streaming_frame(
                    session_id=1774902900,
                    chunk_id=0,
                    total_chunks=2,
                    packet_index=4,
                    total_size=100,
                    packet_size=10,
                    exact_chunk_packets=20,
                ),
                restarted_state,
                storage,
            )

            persisted = storage.read_session(session_id) or {}
            assert persisted["receivedCount"] == 5
            assert restarted_state.received_count == 5
            assert storage.entry_list_calls == 2

    @pytest.mark.asyncio
    @pytest.mark.parametrize("storage_type", [SqliteStorage, Storage])
    async def test_distinct_live_states_stay_synchronized_across_a_b_a_commits(
        self, tmp_path: Path, storage_type: type
    ) -> None:
        class CountingStorage(storage_type):  # type: ignore[misc,valid-type]
            def __init__(self, base_dir: Path) -> None:
                super().__init__(base_dir)
                self.entry_list_calls = 0

            def list_packet_entries(self, session_id: str):  # type: ignore[no-untyped-def]
                self.entry_list_calls += 1
                return super().list_packet_entries(session_id)

        storage = CountingStorage(tmp_path)
        storage.ensure_dirs()
        session_id = f"session-aba-{storage_type.__name__.lower()}"
        state_a = ScanSessionState(session_id)
        state_b = ScanSessionState(session_id)
        commits = [
            (state_a, 0, 0),
            (state_b, 1, 0),
            (state_a, 0, 1),
        ]
        for state, chunk_id, packet_index in commits:
            await _handle_binary_packet(
                AsyncMock(),
                _build_streaming_frame(
                    session_id=1774902900,
                    chunk_id=chunk_id,
                    total_chunks=2,
                    packet_index=packet_index,
                    total_size=100,
                    packet_size=10,
                    exact_chunk_packets=20,
                ),
                state,
                storage,
            )

        persisted = storage.read_session(session_id) or {}
        assert persisted["receivedCount"] == 3
        assert state_a.received_count == 3
        assert state_b.received_count == 3
        expected_chunks = {(0, 2), (1, 1)}
        assert {
            (chunk["chunkId"], chunk["receivedCount"])
            for chunk in state_a.get_chunk_states()
        } == expected_chunks
        assert {
            (chunk["chunkId"], chunk["receivedCount"])
            for chunk in state_b.get_chunk_states()
        } == expected_chunks

        restarted = ScanSessionState(session_id)
        _hydrate_session_from_storage(restarted, session_id, storage)
        assert restarted.received_count == 3
        assert storage.entry_list_calls <= 3

    @pytest.mark.asyncio
    @pytest.mark.parametrize("storage_type", [SqliteStorage, Storage])
    async def test_concurrent_distinct_states_then_reused_state_keep_all_packets(
        self, tmp_path: Path, storage_type: type
    ) -> None:
        storage = storage_type(tmp_path)
        storage.ensure_dirs()
        session_id = f"session-concurrent-aba-{storage_type.__name__.lower()}"
        state_a = ScanSessionState(session_id)
        state_b = ScanSessionState(session_id)

        def commit(state: ScanSessionState, chunk_id: int) -> None:
            asyncio.run(
                _handle_binary_packet(
                    AsyncMock(),
                    _build_streaming_frame(
                        session_id=1774902900,
                        chunk_id=chunk_id,
                        total_chunks=2,
                        packet_index=0,
                        total_size=100,
                        packet_size=10,
                        exact_chunk_packets=20,
                    ),
                    state,
                    storage,
                )
            )

        await asyncio.gather(
            asyncio.to_thread(commit, state_a, 0),
            asyncio.to_thread(commit, state_b, 1),
        )
        await _handle_binary_packet(
            AsyncMock(),
            _build_streaming_frame(
                session_id=1774902900,
                chunk_id=0,
                total_chunks=2,
                packet_index=1,
                total_size=100,
                packet_size=10,
                exact_chunk_packets=20,
            ),
            state_a,
            storage,
        )

        assert (storage.read_session(session_id) or {})["receivedCount"] == 3
        assert state_a.received_count == 3
        assert state_b.received_count == 3

    def test_live_state_registry_never_evicts_an_active_session(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from sync_server import ws_scan_handler

        monkeypatch.setattr(ws_scan_handler, "_MAX_LIVE_SESSION_STATE_SETS", 2)
        storage = Storage(tmp_path)
        state_a = ScanSessionState("active-session")
        state_b = ScanSessionState("active-session")
        other_state_1 = ScanSessionState("other-session-1")
        other_state_2 = ScanSessionState("other-session-2")
        ws_scan_handler._register_live_session_state(storage, state_a)
        ws_scan_handler._register_live_session_state(storage, state_b)
        ws_scan_handler._register_live_session_state(storage, other_state_1)
        ws_scan_handler._register_live_session_state(storage, other_state_2)

        live_states = ws_scan_handler._register_live_session_state(storage, state_a)
        assert set(live_states) == {state_a, state_b}

    @pytest.mark.asyncio
    async def test_legacy_packet_name_is_still_found_by_identity_index(self) -> None:
        from sync_server.ws_scan_protocol import build_binary_header, compute_crc32

        session_id = "session-legacy-index"
        payload = b"legacy persisted packet"
        frame = build_binary_header(1, 0, 0, 7, compute_crc32(payload)) + payload
        with tempfile.TemporaryDirectory() as temp_dir:
            storage = SqliteStorage(Path(temp_dir))
            storage.ensure_dirs()
            storage.save_session_packet(
                session_id, payload, "0000-00000007-legacyhash"
            )
            websocket = AsyncMock()
            await _handle_binary_packet(
                websocket, frame, ScanSessionState(session_id), storage
            )

            assert storage.count_packets(session_id) == 1
            response = json.loads(websocket.send.call_args[0][0])
            assert response["type"] == "packetAck"

    def test_legacy_packet_index_has_bounded_session_lifecycle(self, tmp_path: Path) -> None:
        from sync_server import ws_scan_handler

        storage = SqliteStorage(tmp_path)
        storage.ensure_dirs()
        for index in range(ws_scan_handler._MAX_LEGACY_SESSION_INDEXES + 8):
            ws_scan_handler._legacy_packet_index(storage, f"bounded-{index}")

        with ws_scan_handler._LEGACY_PACKET_INDEX_GUARD:
            cached = ws_scan_handler._LEGACY_PACKET_INDEXES[storage]
            assert len(cached) == ws_scan_handler._MAX_LEGACY_SESSION_INDEXES
            assert "bounded-0" not in cached

    @pytest.mark.asyncio
    async def test_binary_packet_auto_completes_multichunk_using_chunk_derived_threshold(
        self,
    ) -> None:
        session = ScanSessionState("session-hetero")
        session.claim_producer("device-A")
        mock_ws = AsyncMock()
        mock_storage = MagicMock()
        persisted_session: dict[str, object] = {}

        def read_session(_session_id: str) -> dict[str, object]:
            return dict(persisted_session)

        def write_session(_session_id: str, payload: dict[str, object]) -> None:
            persisted_session.clear()
            persisted_session.update(payload)

        mock_storage.read_session.side_effect = read_session
        mock_storage.write_session.side_effect = write_session
        mock_storage.save_session_file.return_value = Path(
            "sessions/session-hetero/files/ws-hetero.bin"
        )
        emit_event = MagicMock()
        emit_history_event = MagicMock()

        await _handle_meta(
            mock_ws,
            {
                "type": "meta",
                "filename": "ws-hetero.bin",
                "mimeType": "application/octet-stream",
                "expectedPackets": 6,
                "totalPackets": 5,
                "totalChunks": 3,
            },
            session,
        )
        mock_ws.send.reset_mock()

        frames = [
            _build_streaming_frame(
                session_id=1774906017,
                chunk_id=0,
                total_chunks=3,
                packet_index=0,
                total_size=20,
                packet_size=10,
                exact_chunk_packets=5,
            ),
            _build_streaming_frame(
                session_id=1774906017,
                chunk_id=0,
                total_chunks=3,
                packet_index=1,
                total_size=20,
                packet_size=10,
                exact_chunk_packets=5,
            ),
            _build_streaming_frame(
                session_id=1774906017,
                chunk_id=1,
                total_chunks=3,
                packet_index=0,
                total_size=20,
                packet_size=10,
                exact_chunk_packets=5,
            ),
            _build_streaming_frame(
                session_id=1774906017,
                chunk_id=1,
                total_chunks=3,
                packet_index=1,
                total_size=20,
                packet_size=10,
                exact_chunk_packets=5,
            ),
            _build_streaming_frame(
                session_id=1774906017,
                chunk_id=2,
                total_chunks=3,
                packet_index=0,
                total_size=10,
                packet_size=10,
                exact_chunk_packets=3,
            ),
        ]

        with patch(
            "sync_server.ws_scan_handler.assemble_scan_session_file",
            return_value=("ws-hetero.bin", b"ABCDE"),
        ):
            for frame in frames:
                await _handle_binary_packet(
                    mock_ws,
                    frame,
                    session,
                    mock_storage,
                    emit_event=emit_event,
                    emit_history_event=emit_history_event,
                )

        mock_storage.save_session_file.assert_called_once_with(
            "session-hetero",
            "ws-hetero.bin",
            b"ABCDE",
        )
        written_session = dict(persisted_session)
        assert written_session["completed"] is True
        assert written_session["expectedPackets"] == 5
        assert written_session["totalPackets"] == 13

        emitted_events = _emitted_events(emit_event)
        final_progress_event = [
            event for event in emitted_events if event[0] == "scan-progress"
        ][-1]
        assert final_progress_event[0] == "scan-progress"
        assert final_progress_event[1]["expectedPackets"] == 5
        assert final_progress_event[1]["totalPackets"] == 13

        complete_event = emitted_events[-1]
        assert complete_event[0] == "scan-complete"
        assert complete_event[1]["sessionId"] == "session-hetero"
        assert complete_event[1]["completed"] is True

    @pytest.mark.asyncio
    async def test_auto_complete_waits_for_each_chunk_threshold_when_global_total_is_reached(
        self,
    ) -> None:
        session = ScanSessionState("session-surplus")
        session.claim_producer("device-A")
        session.set_metadata(expected_packets=4, total_chunks=2)
        session.observe_chunk_transport_metadata(
            0,
            expected_packets=2,
            total_packets=4,
            total_chunks=2,
        )
        session.observe_chunk_transport_metadata(
            1,
            expected_packets=2,
            total_packets=4,
            total_chunks=2,
        )
        for packet_index in range(3):
            session.record_packet(packet_index, chunk_id=0)
        session.record_packet(0, chunk_id=1)

        mock_ws = AsyncMock()
        mock_storage = MagicMock()
        mock_storage.read_session.return_value = {}
        emit_event = MagicMock()
        emit_history_event = MagicMock()

        with patch("sync_server.ws_scan_handler.assemble_scan_session_file") as assemble:
            completed = await _maybe_auto_complete_session(
                mock_ws,
                session,
                mock_storage,
                emit_event=emit_event,
                emit_history_event=emit_history_event,
            )

        assert completed is False
        assemble.assert_not_called()
        state_events = [
            payload
            for event_type, payload in _emitted_events(emit_event)
            if event_type == "scan-session-state"
        ]
        assert state_events[-1]["decodeState"] == "scanning"
        assert state_events[-1]["completionPercent"] == 75


class TestScanHandlerComplete:
    """Test completion handling for WS scan sessions."""

    @pytest.mark.asyncio
    async def test_complete_persists_file_and_marks_session_complete(self) -> None:
        session = ScanSessionState("session-123")
        session.set_metadata(
            filename="ws-file.bin",
            mime_type="application/octet-stream",
            file_size=7,
            total_packets=2,
        )
        session.record_packet(0)
        session.record_packet(1)

        mock_ws = AsyncMock()
        mock_storage = MagicMock()
        persisted_session: dict[str, object] = {
            "sessionId": "session-123",
            "createdAt": "2026-03-29T10:00:00Z",
        }

        def read_session(_session_id: str) -> dict[str, object]:
            return dict(persisted_session)

        def write_session(_session_id: str, payload: dict[str, object]) -> None:
            persisted_session.clear()
            persisted_session.update(payload)

        mock_storage.read_session.side_effect = read_session
        mock_storage.write_session.side_effect = write_session
        mock_storage.save_session_file.return_value = Path("sessions/session-123/files/ws-file.bin")
        emit_event = MagicMock()

        with patch(
            "sync_server.ws_scan_handler.assemble_scan_session_file",
            return_value=("ws-file.bin", b"ABCDEFG"),
        ) as assemble_mock:
            await _handle_complete(
                mock_ws,
                {"type": "complete"},
                session,
                mock_storage,
                emit_event=emit_event,
                emit_history_event=MagicMock(),
            )

        assemble_mock.assert_called_once_with(mock_storage, "session-123")
        mock_storage.save_session_file.assert_called_once_with(
            "session-123",
            "ws-file.bin",
            b"ABCDEFG",
        )
        mock_storage.write_session.assert_called_once()
        written_session = mock_storage.write_session.call_args[0][1]
        assert written_session["status"] == "complete"
        assert written_session["completed"] is True
        assert written_session["filename"] == "ws-file.bin"
        assert written_session["size"] == 7

        sent = json.loads(mock_ws.send.call_args[0][0])
        assert sent["type"] == "completed"
        assert sent["success"] is True
        assert sent["filename"] == "ws-file.bin"
        assert sent["fileSize"] == 7
        emitted_events = _emitted_events(emit_event)
        assert [event_type for event_type, _payload in emitted_events] == [
            "scan-session-state",
            "scan-complete",
        ]
        state_event = emitted_events[0][1]
        assert state_event["status"] == "complete"
        assert state_event["decodeState"] == "complete"
        assert state_event["completionPercent"] == 100
        assert state_event["fileAvailable"] is True

    @pytest.mark.asyncio
    async def test_repeated_complete_is_idempotent_and_emits_once(self) -> None:
        session_id = "session-idempotent-complete"
        session = ScanSessionState(session_id)
        first_ws = AsyncMock()
        second_ws = AsyncMock()
        emit_event = MagicMock()

        with tempfile.TemporaryDirectory() as temp_dir:
            storage = SqliteStorage(Path(temp_dir))
            storage.ensure_dirs()
            with patch(
                "sync_server.ws_scan_handler.assemble_scan_session_file",
                return_value=("complete.bin", b"complete"),
            ) as assembler:
                await asyncio.gather(
                    _handle_complete(
                        first_ws,
                        {"type": "complete", "completedAt": "2026-07-15T10:00:00Z"},
                        session,
                        storage,
                        emit_event=emit_event,
                    ),
                    _handle_complete(
                        second_ws,
                        {"type": "complete", "completedAt": "2099-01-01T00:00:00Z"},
                        session,
                        storage,
                        emit_event=emit_event,
                    ),
                )

            assert assembler.call_count == 1
            terminal = storage.read_session(session_id) or {}
            assert terminal["completedAt"] == "2026-07-15T10:00:00Z"
            assert len(
                [event for event in _emitted_events(emit_event) if event[0] == "scan-complete"]
            ) == 1
            responses = [
                json.loads(ws.send.call_args[0][0]) for ws in (first_ws, second_ws)
            ]
            assert all(response["success"] is True for response in responses)
            assert all(
                response["completedAt"] == "2026-07-15T10:00:00Z"
                for response in responses
            )

    @pytest.mark.asyncio
    async def test_complete_logs_structured_success_message(self, caplog) -> None:
        session = ScanSessionState("session-123")
        session.set_metadata(
            filename="ws-file.bin",
            mime_type="application/octet-stream",
            file_size=7,
            total_packets=2,
        )
        session.record_packet(0)
        session.record_packet(1)

        mock_ws = AsyncMock()
        mock_ws.request.path = "/api/v1/ws/scan/session-123?connectionId=conn-4"
        mock_ws.request_headers = {"Origin": "https://airqr.example.com"}
        mock_ws.remote_address = ("192.168.1.50", 5173)

        mock_storage = MagicMock()
        mock_storage.read_session.return_value = {
            "sessionId": "session-123",
            "createdAt": "2026-03-29T10:00:00Z",
        }
        mock_storage.save_session_file.return_value = Path("sessions/session-123/files/ws-file.bin")

        with patch(
            "sync_server.ws_scan_handler.assemble_scan_session_file",
            return_value=("ws-file.bin", b"ABCDEFG"),
        ):
            with caplog.at_level("INFO", logger="sync_server.ws_scan_handler"):
                await _handle_complete(mock_ws, {"type": "complete"}, session, mock_storage)

        assert "ws.scan.complete_succeeded" in caplog.text
        assert "sessionId=session-123" in caplog.text
        assert "fileSize=7" in caplog.text
        assert "receivedCount=2" in caplog.text

    @pytest.mark.asyncio
    async def test_complete_logs_structured_assembly_failure(self, caplog) -> None:
        session = ScanSessionState("session-123")
        session.set_metadata(
            filename="ws-file.bin",
            mime_type="application/octet-stream",
            file_size=7,
            total_packets=2,
        )
        session.record_packet(0)
        session.record_packet(1)

        mock_ws = AsyncMock()
        mock_ws.request.path = "/api/v1/ws/scan/session-123"
        mock_storage = MagicMock()

        with patch(
            "sync_server.ws_scan_handler.assemble_scan_session_file",
            side_effect=ScanAssemblyError("Missing packet 7"),
        ):
            with caplog.at_level("INFO", logger="sync_server.ws_scan_handler"):
                await _handle_complete(mock_ws, {"type": "complete"}, session, mock_storage)

        assert "ws.scan.complete_failed" in caplog.text
        assert "sessionId=session-123" in caplog.text
        assert 'error="Missing packet 7"' in caplog.text
