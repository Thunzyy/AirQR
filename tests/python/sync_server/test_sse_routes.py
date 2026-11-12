from __future__ import annotations

import queue
from http import HTTPStatus
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from sync_server.auth import AuthManager, RateLimiter, load_auth_database, save_user
from sync_server.events import EventHub
from sync_server.handler import SyncRequestHandler
from sync_server.routes_sse import handle_sse_events, require_sse_auth
from sync_server.utils import write_json


class _FailOnSecondWrite:
    def __init__(self) -> None:
        self.calls: list[bytes] = []

    def write(self, data: bytes) -> int:
        self.calls.append(data)
        if len(self.calls) >= 2:
            raise BrokenPipeError()
        return len(data)

    def flush(self) -> None:
        return None


def test_require_sse_auth_accepts_api_key_when_authorization_header_is_missing(
    tmp_path: Path,
) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")
    api_key = "local-device-key"
    users_db = load_auth_database(users_file)
    users_db["apiKeys"] = [api_key]
    write_json(users_file, users_db)
    auth = AuthManager(users_file)

    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.auth = auth
    rate_limiter = MagicMock()
    handler.context.rate_limiter = rate_limiter
    handler.client_address = ("192.0.2.10", 12345)
    handler.headers = {}
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()

    assert require_sse_auth(handler, {"apiKey": [api_key]}) is True
    handler.send_response.assert_not_called()
    rate_limiter.try_reserve.assert_not_called()
    rate_limiter.complete_failure.assert_not_called()
    rate_limiter.reset.assert_called_once_with("sse:192.0.2.10")


def test_require_sse_auth_accepts_cheap_api_key_at_failure_limit(
    tmp_path: Path,
) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")
    users_db = load_auth_database(users_file)
    users_db["apiKeys"] = ["local-device-key"]
    write_json(users_file, users_db)
    auth = AuthManager(users_file)
    limiter = RateLimiter(max_attempts=1, window_seconds=60)
    limiter.record_failure("sse:192.0.2.10")
    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.auth = auth
    handler.context.rate_limiter = limiter
    handler.client_address = ("192.0.2.10", 12345)
    handler.headers = {}

    assert require_sse_auth(handler, {"apiKey": ["local-device-key"]}) is True
    assert limiter.is_allowed("sse:192.0.2.10") is True
    handler.send_response.assert_not_called()


def test_require_sse_auth_records_one_namespaced_failure(tmp_path: Path) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")
    auth = AuthManager(users_file)
    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.auth = auth
    rate_limiter = MagicMock()
    rate_limiter.try_reserve.return_value = True
    handler.context.rate_limiter = rate_limiter
    handler.client_address = ("192.0.2.10", 12345)
    handler.headers = {}

    assert require_sse_auth(handler, {"apiKey": ["wrong"]}) is False

    handler.send_response.assert_called_once_with(HTTPStatus.UNAUTHORIZED)
    rate_limiter.try_reserve.assert_called_once_with("sse:192.0.2.10")
    rate_limiter.complete_failure.assert_called_once_with("sse:192.0.2.10")
    rate_limiter.reset.assert_not_called()


def test_require_sse_auth_uses_forwarded_client_from_trusted_proxy(tmp_path: Path) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")
    auth = AuthManager(users_file)
    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.auth = auth
    handler.context.trusted_proxies = ["127.0.0.1/32"]
    rate_limiter = MagicMock()
    rate_limiter.try_reserve.return_value = True
    handler.context.rate_limiter = rate_limiter
    handler.client_address = ("127.0.0.1", 43123)
    handler.headers = {"X-Forwarded-For": "203.0.113.25"}

    assert require_sse_auth(handler, {}) is False

    rate_limiter.try_reserve.assert_called_once_with("sse:203.0.113.25")


def test_require_sse_auth_rejects_exhausted_invalid_attempt(tmp_path: Path) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")
    auth = AuthManager(users_file)
    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.auth = auth
    rate_limiter = MagicMock()
    rate_limiter.try_reserve.return_value = False
    handler.context.rate_limiter = rate_limiter
    handler.client_address = ("192.0.2.10", 12345)
    handler.headers = {}

    assert require_sse_auth(handler, {}) is False

    handler.send_response.assert_called_once_with(HTTPStatus.TOO_MANY_REQUESTS)
    rate_limiter.try_reserve.assert_called_once_with("sse:192.0.2.10")
    rate_limiter.complete_failure.assert_not_called()


def test_require_sse_auth_short_circuits_exhausted_request_before_auth(
    tmp_path: Path,
) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")
    auth = AuthManager(users_file)
    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.auth = auth
    rate_limiter = MagicMock()
    rate_limiter.try_reserve.return_value = False
    handler.context.rate_limiter = rate_limiter
    handler.client_address = []
    handler.headers = {"Authorization": "Basic YWRtaW46YWRtaW4="}

    with (
        patch.object(auth, "authorize_basic") as authorize_basic,
    ):
        assert require_sse_auth(handler, {}) is False

    authorize_basic.assert_not_called()
    rate_limiter.try_reserve.assert_called_once_with(
        f"sse:unknown:{id(handler)}"
    )
    handler.send_response.assert_called_once_with(HTTPStatus.TOO_MANY_REQUESTS)


def test_require_sse_auth_cancels_reservation_when_basic_auth_raises(
    tmp_path: Path,
) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")
    auth = AuthManager(users_file)
    limiter = RateLimiter(max_attempts=1, window_seconds=60)
    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.auth = auth
    handler.context.rate_limiter = limiter
    handler.client_address = ("192.0.2.10", 12345)
    handler.headers = {"Authorization": "Basic YWRtaW46YWRtaW4="}

    with (
        patch.object(auth, "authorize_basic", side_effect=RuntimeError("boom")),
        pytest.raises(RuntimeError, match="boom"),
    ):
        require_sse_auth(handler, {})

    assert limiter.try_reserve("sse:192.0.2.10") is True


def test_handle_sse_events_streams_hello_then_unsubscribes_on_disconnect(tmp_path: Path) -> None:
    event_hub = EventHub()
    client_queue = MagicMock()
    client_queue.get.side_effect = queue.Empty
    event_hub.subscribe = MagicMock(return_value=client_queue)
    event_hub.unsubscribe = MagicMock()

    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.event_hub = event_hub
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()
    handler.wfile = _FailOnSecondWrite()

    handle_sse_events(handler)

    handler.send_response.assert_called_once_with(HTTPStatus.OK)
    assert handler.wfile.calls[0] == b"event: hello\ndata: {}\n\n"
    event_hub.unsubscribe.assert_called_once_with(client_queue)
