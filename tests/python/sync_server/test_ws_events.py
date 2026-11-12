"""Tests for WebSocket events hub."""

import asyncio
import base64
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from sync_server.auth import AuthManager, RateLimiter, save_user
from sync_server.ws_events import WebSocketEventHub, HybridEventHub
from sync_server.events import EventHub


class TestWebSocketEventHub:
    """Test WebSocket event hub."""

    @pytest.mark.asyncio
    async def test_register_and_unregister_client(self) -> None:
        """Should register and unregister WebSocket clients."""
        hub = WebSocketEventHub()
        mock_ws = AsyncMock()
        mock_ws.closed = False

        client_id = hub.register(mock_ws)
        assert client_id in hub.clients

        hub.unregister(client_id)
        assert client_id not in hub.clients

    @pytest.mark.asyncio
    async def test_broadcast_sends_to_all_clients(self) -> None:
        """Should broadcast message to all connected clients."""
        hub = WebSocketEventHub()

        ws1 = AsyncMock()
        ws1.closed = False
        ws2 = AsyncMock()
        ws2.closed = False

        hub.register(ws1)
        hub.register(ws2)

        await hub.broadcast("history-update", {"historyId": "test-123"})

        ws1.send.assert_called_once()
        ws2.send.assert_called_once()

        # Verify message format
        sent_data = json.loads(ws1.send.call_args[0][0])
        assert sent_data["type"] == "history-update"
        assert sent_data["payload"]["historyId"] == "test-123"

    @pytest.mark.asyncio
    async def test_broadcast_threadsafe_uses_bound_loop(self) -> None:
        """Should schedule broadcasts onto the bound websocket event loop."""
        hub = WebSocketEventHub()
        ws = AsyncMock()
        ws.closed = False
        hub.register(ws)
        hub.bind_loop(asyncio.get_running_loop())

        future = hub.broadcast_threadsafe("scan-progress", {"sessionId": "test-123"})

        assert future is not None
        await asyncio.wrap_future(future)

        ws.send.assert_called_once()
        sent_data = json.loads(ws.send.call_args[0][0])
        assert sent_data["type"] == "scan-progress"
        assert sent_data["payload"]["sessionId"] == "test-123"

    @pytest.mark.asyncio
    async def test_broadcast_skips_closed_clients(self) -> None:
        """Should skip clients that are closed."""
        hub = WebSocketEventHub()

        ws1 = AsyncMock()
        ws1.closed = False
        ws2 = AsyncMock()
        ws2.closed = True  # Closed

        hub.register(ws1)
        hub.register(ws2)

        await hub.broadcast("test", {"data": "value"})

        ws1.send.assert_called_once()
        ws2.send.assert_not_called()

    @pytest.mark.asyncio
    async def test_broadcast_removes_failed_clients(self) -> None:
        """Should remove clients that fail to receive."""
        hub = WebSocketEventHub()

        ws1 = AsyncMock()
        ws1.closed = False
        ws1.send.side_effect = Exception("Connection lost")

        client_id = hub.register(ws1)

        await hub.broadcast("test", {"data": "value"})

        # Client should be removed after failed send
        assert client_id not in hub.clients

    def test_client_count(self) -> None:
        """Should return correct client count."""
        hub = WebSocketEventHub()

        ws1 = AsyncMock()
        ws1.closed = False
        ws2 = AsyncMock()
        ws2.closed = False

        assert hub.client_count == 0

        hub.register(ws1)
        assert hub.client_count == 1

        hub.register(ws2)
        assert hub.client_count == 2

        hub.unregister(list(hub.clients.keys())[0])
        assert hub.client_count == 1


class TestWebSocketHandler:
    """Test WebSocket connection handler."""

    @pytest.mark.asyncio
    async def test_handle_hello_sends_welcome(self) -> None:
        """Should respond to hello with welcome message."""
        from sync_server.ws_events import WebSocketEventHub, handle_events_client

        hub = WebSocketEventHub()
        mock_ws = AsyncMock()
        mock_ws.closed = False

        # Simulate hello message then close
        hello_msg = json.dumps({
            "type": "hello",
            "protocol": "airqr-events",
            "version": 1,
            "clientId": "test-device",
        })

        async def msg_generator():
            yield hello_msg

        mock_ws.__aiter__ = lambda self: msg_generator()

        await handle_events_client(mock_ws, hub, None)

        # Should have sent welcome
        assert mock_ws.send.called
        sent = json.loads(mock_ws.send.call_args_list[0][0][0])
        assert sent["type"] == "welcome"
        assert sent["version"] == 1

    @pytest.mark.asyncio
    async def test_handle_ping_sends_pong(self) -> None:
        """Should respond to ping with pong."""
        from sync_server.ws_events import WebSocketEventHub, handle_events_client

        hub = WebSocketEventHub()
        mock_ws = AsyncMock()
        mock_ws.closed = False

        async def msg_generator():
            yield json.dumps({"type": "hello", "protocol": "airqr-events", "version": 1})
            yield json.dumps({"type": "ping"})

        mock_ws.__aiter__ = lambda self: msg_generator()

        await handle_events_client(mock_ws, hub, None)

        # Find pong response
        pong_sent = False
        for call in mock_ws.send.call_args_list:
            msg = json.loads(call[0][0])
            if msg.get("type") == "pong":
                pong_sent = True
                break

        assert pong_sent

    @pytest.mark.asyncio
    async def test_handle_hello_accepts_session_cookie_auth(self, tmp_path) -> None:
        """Should authorize websocket hello via the signed session cookie."""
        from sync_server.ws_events import WebSocketEventHub, handle_events_client

        users_file = tmp_path / "users.json"
        save_user(users_file, "admin", "admin")
        auth = AuthManager(users_file)
        cookie = auth.build_session_cookie("admin", secure=False).split(";", 1)[0]

        hub = WebSocketEventHub()
        mock_ws = AsyncMock()
        mock_ws.closed = False
        mock_ws.request_headers = {"Cookie": cookie}

        async def msg_generator():
            yield json.dumps({"type": "hello", "protocol": "airqr-events", "version": 1})

        mock_ws.__aiter__ = lambda self: msg_generator()

        await handle_events_client(mock_ws, hub, auth)

        sent = json.loads(mock_ws.send.call_args_list[0][0][0])
        assert sent["type"] == "welcome"
        assert sent["version"] == 1

    @pytest.mark.asyncio
    async def test_cross_origin_hello_ignores_session_cookie_auth(self, tmp_path) -> None:
        """Cross-origin websocket auth must not use browser cookies."""
        from sync_server.ws_events import WebSocketEventHub, handle_events_client

        users_file = tmp_path / "users.json"
        save_user(users_file, "admin", "admin")
        auth = AuthManager(users_file)
        cookie = auth.build_session_cookie("admin", secure=False).split(";", 1)[0]

        hub = WebSocketEventHub()
        mock_ws = AsyncMock()
        mock_ws.closed = False
        mock_ws.request_headers = {
            "Cookie": cookie,
            "Host": "sync.example.test",
            "Origin": "https://app.example.test",
        }

        async def msg_generator():
            yield json.dumps({"type": "hello", "protocol": "airqr-events", "version": 1})

        mock_ws.__aiter__ = lambda self: msg_generator()

        await handle_events_client(mock_ws, hub, auth)

        sent = json.loads(mock_ws.send.call_args_list[0][0][0])
        assert sent["type"] == "error"
        assert sent["code"] == "auth_failed"

    @pytest.mark.asyncio
    async def test_invalid_protocol_sends_error(self) -> None:
        """Should send error for invalid protocol."""
        from sync_server.ws_events import WebSocketEventHub, handle_events_client

        hub = WebSocketEventHub()
        mock_ws = AsyncMock()
        mock_ws.closed = False

        async def msg_generator():
            yield json.dumps({"type": "hello", "protocol": "wrong-protocol", "version": 1})

        mock_ws.__aiter__ = lambda self: msg_generator()

        await handle_events_client(mock_ws, hub, None)

        # Should have sent error
        sent = json.loads(mock_ws.send.call_args_list[0][0][0])
        assert sent["type"] == "error"
        assert sent["code"] == "invalid_protocol"

    @pytest.mark.asyncio
    async def test_packet_messages_are_rejected_on_events_channel(self) -> None:
        """Should reject legacy scan-packet uploads on the shared events channel."""
        from sync_server.ws_events import WebSocketEventHub, handle_events_client

        hub = WebSocketEventHub()
        mock_ws = AsyncMock()
        mock_ws.closed = False

        async def msg_generator():
            yield json.dumps({"type": "hello", "protocol": "airqr-events", "version": 1})
            yield json.dumps(
                {
                    "type": "packet",
                    "sessionId": "scan-123",
                    "packetBase64": "YWJj",
                }
            )

        mock_ws.__aiter__ = lambda self: msg_generator()

        await handle_events_client(mock_ws, hub, None)

        messages = [json.loads(call[0][0]) for call in mock_ws.send.call_args_list]
        error = next((message for message in messages if message.get("type") == "error"), None)

        assert error is not None
        assert error["code"] == "unsupported_message"
        assert "airqr-scan" in error["message"]


class TestHybridEventHub:
    """Test hybrid SSE + WebSocket event hub."""

    def test_publish_to_sse_only(self) -> None:
        """Should publish to SSE hub when no WebSocket hub configured."""
        sse_hub = EventHub()
        hybrid = HybridEventHub(sse_hub=sse_hub, ws_hub=None)

        client_queue = sse_hub.subscribe()
        hybrid.publish("test-event", {"key": "value"})

        # SSE should receive the event
        message = client_queue.get_nowait()
        assert b"event: test-event" in message
        assert b'"key":"value"' in message

    @pytest.mark.asyncio
    async def test_publish_to_both_hubs(self) -> None:
        """Should publish to both SSE and WebSocket hubs."""
        sse_hub = EventHub()
        ws_hub = WebSocketEventHub()

        # Add a WebSocket client
        mock_ws = AsyncMock()
        mock_ws.closed = False
        ws_hub.register(mock_ws)

        hybrid = HybridEventHub(sse_hub=sse_hub, ws_hub=ws_hub)

        # Subscribe SSE client
        client_queue = sse_hub.subscribe()

        # Publish event
        hybrid.publish("history-update", {"historyId": "test-123"})

        # SSE should receive the event
        message = client_queue.get_nowait()
        assert b"event: history-update" in message
        assert b'"historyId":"test-123"' in message

        # Give async broadcast time to complete
        await asyncio.sleep(0.1)

        # WebSocket should receive the event
        mock_ws.send.assert_called_once()
        ws_message = json.loads(mock_ws.send.call_args[0][0])
        assert ws_message["type"] == "history-update"
        assert ws_message["payload"]["historyId"] == "test-123"

    def test_publish_without_ws_clients_does_not_error(self) -> None:
        """Should not error when WebSocket hub has no clients."""
        sse_hub = EventHub()
        ws_hub = WebSocketEventHub()  # No clients
        hybrid = HybridEventHub(sse_hub=sse_hub, ws_hub=ws_hub)

        # Should not raise
        hybrid.publish("test", {"data": "value"})


class TestWebSocketAuthentication:
    """Test WebSocket authentication handling."""

    @pytest.mark.asyncio
    async def test_hello_with_valid_api_key_succeeds(self) -> None:
        """Should accept connection with valid API key."""
        from sync_server.ws_events import handle_events_client
        from sync_server.auth import AuthManager
        from pathlib import Path
        import tempfile

        hub = WebSocketEventHub()
        mock_ws = AsyncMock()
        mock_ws.closed = False

        # Create a mock auth manager with an API key
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            f.write('{"users": [], "apiKeys": ["test-api-key-123"]}')
            f.flush()
            auth = AuthManager(Path(f.name))

        async def msg_generator():
            yield json.dumps({
                "type": "hello",
                "protocol": "airqr-events",
                "version": 1,
                "apiKey": "test-api-key-123",
            })

        mock_ws.__aiter__ = lambda self: msg_generator()

        await handle_events_client(mock_ws, hub, auth)

        # Should have sent welcome (not error)
        sent = json.loads(mock_ws.send.call_args_list[0][0][0])
        assert sent["type"] == "welcome"

    @pytest.mark.asyncio
    async def test_hello_with_valid_api_key_does_not_consume_rate_limit(self, tmp_path) -> None:
        from sync_server.ws_events import handle_events_client

        users_file = tmp_path / "users.json"
        users_file.write_text('{"users": [], "apiKeys": ["events-key"]}', encoding="utf-8")
        rate_limiter = MagicMock()
        auth = AuthManager(users_file, rate_limiter=rate_limiter)
        hub = WebSocketEventHub()
        mock_ws = AsyncMock()
        mock_ws.closed = False
        mock_ws.remote_address = ("192.168.1.50", 5173)

        async def msg_generator():
            yield json.dumps({
                "type": "hello",
                "protocol": "airqr-events",
                "version": 1,
                "apiKey": "events-key",
            })

        mock_ws.__aiter__ = lambda self: msg_generator()

        await handle_events_client(mock_ws, hub, auth)

        rate_limiter.try_reserve.assert_not_called()
        rate_limiter.complete_failure.assert_not_called()
        rate_limiter.reset.assert_called_once_with("ws-events:192.168.1.50")
        sent = json.loads(mock_ws.send.call_args_list[0][0][0])
        assert sent["type"] == "welcome"

    @pytest.mark.asyncio
    async def test_rate_limit_uses_forwarded_client_from_trusted_proxy(self, tmp_path) -> None:
        from sync_server.ws_events import handle_events_client

        users_file = tmp_path / "users.json"
        save_user(users_file, "admin", "admin")
        rate_limiter = MagicMock()
        rate_limiter.try_reserve.return_value = True
        auth = AuthManager(
            users_file,
            rate_limiter=rate_limiter,
            trusted_proxies=["127.0.0.1/32"],
        )
        hub = WebSocketEventHub()
        mock_ws = AsyncMock()
        mock_ws.remote_address = ("127.0.0.1", 43123)
        mock_ws.request_headers = {"X-Forwarded-For": "203.0.113.25"}

        async def msg_generator():
            yield json.dumps(
                {
                    "type": "hello",
                    "protocol": "airqr-events",
                    "username": "admin",
                    "password": "wrong",
                }
            )

        mock_ws.__aiter__ = lambda self: msg_generator()

        await handle_events_client(mock_ws, hub, auth)

        rate_limiter.try_reserve.assert_called_once_with("ws-events:203.0.113.25")

    @pytest.mark.asyncio
    async def test_valid_cookie_reconnect_succeeds_at_failure_limit(self, tmp_path) -> None:
        from sync_server.ws_events import handle_events_client

        users_file = tmp_path / "users.json"
        save_user(users_file, "admin", "admin")
        limiter = RateLimiter(max_attempts=1, window_seconds=60)
        limiter.record_failure("ws-events:192.168.1.50")
        auth = AuthManager(users_file, rate_limiter=limiter)
        cookie = auth.build_session_cookie("admin", secure=False).split(";", 1)[0]
        hub = WebSocketEventHub()
        mock_ws = AsyncMock()
        mock_ws.remote_address = ("192.168.1.50", 5173)
        mock_ws.request_headers = {"Cookie": cookie}

        async def msg_generator():
            yield json.dumps({"type": "hello", "protocol": "airqr-events"})

        mock_ws.__aiter__ = lambda self: msg_generator()

        await handle_events_client(mock_ws, hub, auth)

        sent = json.loads(mock_ws.send.call_args_list[0][0][0])
        assert sent["type"] == "welcome"
        assert limiter.is_allowed("ws-events:192.168.1.50") is True

    @pytest.mark.asyncio
    async def test_body_basic_credentials_override_header_without_double_pbkdf(
        self, tmp_path
    ) -> None:
        from sync_server.ws_events import handle_events_client

        users_file = tmp_path / "users.json"
        save_user(users_file, "admin", "body-password")
        auth = AuthManager(users_file)
        hub = WebSocketEventHub()
        mock_ws = AsyncMock()
        header_token = base64.b64encode(b"admin:header-password").decode("ascii")
        mock_ws.request_headers = {"Authorization": f"Basic {header_token}"}

        async def msg_generator():
            yield json.dumps({
                "type": "hello",
                "protocol": "airqr-events",
                "username": "admin",
                "password": "body-password",
            })

        mock_ws.__aiter__ = lambda self: msg_generator()

        with patch.object(
            auth, "authorize_basic", wraps=auth.authorize_basic
        ) as authorize_basic:
            await handle_events_client(mock_ws, hub, auth)

        authorize_basic.assert_called_once_with("admin", "body-password")
        sent = json.loads(mock_ws.send.call_args_list[0][0][0])
        assert sent["type"] == "welcome"

    @pytest.mark.asyncio
    async def test_basic_auth_exception_cancels_reservation(self, tmp_path) -> None:
        from sync_server.ws_events import handle_events_client

        users_file = tmp_path / "users.json"
        save_user(users_file, "admin", "admin")
        limiter = RateLimiter(max_attempts=1, window_seconds=60)
        auth = AuthManager(users_file, rate_limiter=limiter)
        hub = WebSocketEventHub()
        mock_ws = AsyncMock()
        mock_ws.remote_address = ("192.168.1.50", 5173)

        async def msg_generator():
            yield json.dumps({
                "type": "hello",
                "protocol": "airqr-events",
                "username": "admin",
                "password": "admin",
            })

        mock_ws.__aiter__ = lambda self: msg_generator()

        with patch.object(
            auth, "authorize_basic", side_effect=RuntimeError("boom")
        ):
            await handle_events_client(mock_ws, hub, auth)

        mock_ws.send.assert_not_called()
        assert limiter.try_reserve("ws-events:192.168.1.50") is True

    @pytest.mark.asyncio
    @pytest.mark.parametrize("invalid_api_key", [123, ["bad"], {"bad": "key"}])
    async def test_non_string_body_api_key_is_counted_as_auth_failure(
        self, tmp_path, invalid_api_key
    ) -> None:
        from sync_server.ws_events import handle_events_client

        users_file = tmp_path / "users.json"
        users_file.write_text(
            '{"users": [], "apiKeys": ["events-key"]}', encoding="utf-8"
        )
        limiter = RateLimiter(max_attempts=1, window_seconds=60)
        auth = AuthManager(users_file, rate_limiter=limiter)
        hub = WebSocketEventHub()
        mock_ws = AsyncMock()
        mock_ws.remote_address = ("192.168.1.50", 5173)

        async def msg_generator():
            yield json.dumps({
                "type": "hello",
                "protocol": "airqr-events",
                "apiKey": invalid_api_key,
            })

        mock_ws.__aiter__ = lambda self: msg_generator()

        await handle_events_client(mock_ws, hub, auth)

        sent = json.loads(mock_ws.send.call_args_list[0][0][0])
        assert sent["code"] == "auth_failed"
        assert limiter.is_allowed("ws-events:192.168.1.50") is False

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        ("username", "password"),
        [("admin", ["bad"]), ({"bad": "user"}, "admin"), (123, True)],
    )
    async def test_non_string_body_basic_fields_are_counted_without_pbkdf(
        self, tmp_path, username, password
    ) -> None:
        from sync_server.ws_events import handle_events_client

        users_file = tmp_path / "users.json"
        save_user(users_file, "admin", "admin")
        limiter = RateLimiter(max_attempts=1, window_seconds=60)
        auth = AuthManager(users_file, rate_limiter=limiter)
        hub = WebSocketEventHub()
        mock_ws = AsyncMock()
        mock_ws.remote_address = ("192.168.1.50", 5173)

        async def msg_generator():
            yield json.dumps({
                "type": "hello",
                "protocol": "airqr-events",
                "username": username,
                "password": password,
            })

        mock_ws.__aiter__ = lambda self: msg_generator()

        with patch.object(auth, "authorize_basic") as authorize_basic:
            await handle_events_client(mock_ws, hub, auth)

        authorize_basic.assert_not_called()
        sent = json.loads(mock_ws.send.call_args_list[0][0][0])
        assert sent["code"] == "auth_failed"
        assert limiter.is_allowed("ws-events:192.168.1.50") is False

    @pytest.mark.asyncio
    async def test_hello_with_invalid_api_key_consumes_rate_limit(self, tmp_path) -> None:
        from sync_server.ws_events import handle_events_client

        users_file = tmp_path / "users.json"
        users_file.write_text('{"users": [], "apiKeys": ["events-key"]}', encoding="utf-8")
        rate_limiter = MagicMock()
        rate_limiter.try_reserve.return_value = True
        auth = AuthManager(users_file, rate_limiter=rate_limiter)
        hub = WebSocketEventHub()
        mock_ws = AsyncMock()
        mock_ws.closed = False
        mock_ws.remote_address = ("192.168.1.50", 5173)

        async def msg_generator():
            yield json.dumps({
                "type": "hello",
                "protocol": "airqr-events",
                "version": 1,
                "apiKey": "wrong-key",
            })

        mock_ws.__aiter__ = lambda self: msg_generator()

        await handle_events_client(mock_ws, hub, auth)

        rate_limiter.try_reserve.assert_called_once_with(
            "ws-events:192.168.1.50"
        )
        rate_limiter.complete_failure.assert_called_once_with(
            "ws-events:192.168.1.50"
        )
        rate_limiter.reset.assert_not_called()
        sent = json.loads(mock_ws.send.call_args_list[0][0][0])
        assert sent["type"] == "error"
        assert sent["code"] == "auth_failed"

    @pytest.mark.asyncio
    async def test_exhausted_invalid_hello_is_rate_limited_without_recording(
        self, tmp_path
    ) -> None:
        from sync_server.ws_events import handle_events_client

        users_file = tmp_path / "users.json"
        users_file.write_text(
            '{"users": [], "apiKeys": ["events-key"]}', encoding="utf-8"
        )
        rate_limiter = MagicMock()
        rate_limiter.try_reserve.return_value = False
        auth = AuthManager(users_file, rate_limiter=rate_limiter)
        hub = WebSocketEventHub()
        mock_ws = AsyncMock()
        mock_ws.remote_address = ("192.168.1.50", 5173)

        async def msg_generator():
            yield json.dumps({
                "type": "hello",
                "protocol": "airqr-events",
                "apiKey": "wrong-key",
            })

        mock_ws.__aiter__ = lambda self: msg_generator()

        await handle_events_client(mock_ws, hub, auth)

        rate_limiter.try_reserve.assert_called_once_with(
            "ws-events:192.168.1.50"
        )
        rate_limiter.complete_failure.assert_not_called()
        sent = json.loads(mock_ws.send.call_args_list[0][0][0])
        assert sent["code"] == "rate_limited"

    @pytest.mark.asyncio
    async def test_invalid_hello_is_rate_limited_when_reservation_is_unavailable(
        self, tmp_path
    ) -> None:
        from sync_server.ws_events import handle_events_client

        users_file = tmp_path / "users.json"
        users_file.write_text(
            '{"users": [], "apiKeys": ["events-key"]}', encoding="utf-8"
        )
        rate_limiter = MagicMock()
        rate_limiter.try_reserve.return_value = False
        auth = AuthManager(users_file, rate_limiter=rate_limiter)
        hub = WebSocketEventHub()
        mock_ws = AsyncMock()
        mock_ws.remote_address = ("192.168.1.50", 5173)

        async def msg_generator():
            yield json.dumps({
                "type": "hello",
                "protocol": "airqr-events",
                "apiKey": "wrong-key",
            })

        mock_ws.__aiter__ = lambda self: msg_generator()

        await handle_events_client(mock_ws, hub, auth)

        sent = json.loads(mock_ws.send.call_args_list[0][0][0])
        assert sent["code"] == "rate_limited"

    @pytest.mark.asyncio
    async def test_exhausted_hello_short_circuits_before_auth(self, tmp_path) -> None:
        from sync_server.ws_events import handle_events_client

        users_file = tmp_path / "users.json"
        users_file.write_text(
            '{"users": [], "apiKeys": ["events-key"]}', encoding="utf-8"
        )
        rate_limiter = MagicMock()
        rate_limiter.try_reserve.return_value = False
        auth = AuthManager(users_file, rate_limiter=rate_limiter)
        hub = WebSocketEventHub()
        mock_ws = AsyncMock()
        mock_ws.remote_address = None

        async def msg_generator():
            yield json.dumps({
                "type": "hello",
                "protocol": "airqr-events",
                "username": "admin",
                "password": "admin",
            })

        mock_ws.__aiter__ = lambda self: msg_generator()

        with (
            patch.object(auth, "authorize_basic") as authorize_basic,
        ):
            await handle_events_client(mock_ws, hub, auth)

        authorize_basic.assert_not_called()
        rate_limiter.try_reserve.assert_called_once_with(
            f"ws-events:unknown:{id(mock_ws)}"
        )
        sent = json.loads(mock_ws.send.call_args_list[0][0][0])
        assert sent["code"] == "rate_limited"

    @pytest.mark.asyncio
    async def test_hello_with_invalid_api_key_fails(self) -> None:
        """Should reject connection with invalid API key when auth is enabled."""
        from sync_server.ws_events import handle_events_client
        from sync_server.auth import AuthManager
        from pathlib import Path
        import tempfile

        hub = WebSocketEventHub()
        mock_ws = AsyncMock()
        mock_ws.closed = False

        # Create auth manager with different API key
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            f.write('{"users": [], "apiKeys": ["real-api-key"]}')
            f.flush()
            auth = AuthManager(Path(f.name))

        async def msg_generator():
            yield json.dumps({
                "type": "hello",
                "protocol": "airqr-events",
                "version": 1,
                "apiKey": "wrong-api-key",
            })

        mock_ws.__aiter__ = lambda self: msg_generator()

        await handle_events_client(mock_ws, hub, auth)

        # Should have sent auth error
        sent = json.loads(mock_ws.send.call_args_list[0][0][0])
        assert sent["type"] == "error"
        assert sent["code"] == "auth_failed"

    @pytest.mark.asyncio
    async def test_hello_without_credentials_when_auth_disabled_succeeds(self) -> None:
        """Should accept connection without credentials when auth is disabled."""
        from sync_server.ws_events import handle_events_client
        from sync_server.auth import AuthManager
        from pathlib import Path

        hub = WebSocketEventHub()
        mock_ws = AsyncMock()
        mock_ws.closed = False

        # No users file = auth disabled
        auth = AuthManager(Path("/nonexistent/users.json"))

        async def msg_generator():
            yield json.dumps({
                "type": "hello",
                "protocol": "airqr-events",
                "version": 1,
            })

        mock_ws.__aiter__ = lambda self: msg_generator()

        await handle_events_client(mock_ws, hub, auth)

        # Should have sent welcome
        sent = json.loads(mock_ws.send.call_args_list[0][0][0])
        assert sent["type"] == "welcome"

