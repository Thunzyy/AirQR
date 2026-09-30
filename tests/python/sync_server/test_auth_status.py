from __future__ import annotations

import base64
import json
from http import HTTPStatus
from unittest.mock import MagicMock

from sync_server.auth import AuthManager, RateLimiter, save_user
from sync_server.handler import SyncRequestHandler


def _basic_auth(username: str, password: str) -> str:
    token = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
    return f"Basic {token}"


def test_handle_auth_status_reports_disabled_when_auth_is_off(tmp_path) -> None:
    handler = MagicMock(spec=SyncRequestHandler)
    handler._send_json = MagicMock()
    handler.context = MagicMock()
    handler.context.auth = AuthManager(tmp_path / "users.json")
    handler.headers = {}

    SyncRequestHandler._handle_auth_status(handler)

    handler._send_json.assert_called_once_with(
        HTTPStatus.OK,
        {"enabled": False, "authorized": True, "username": None},
    )


def test_handle_auth_status_reports_missing_credentials_when_auth_is_enabled(tmp_path) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")

    handler = MagicMock(spec=SyncRequestHandler)
    handler._send_json = MagicMock()
    handler.context = MagicMock()
    handler.context.auth = AuthManager(users_file)
    handler.headers = {}

    SyncRequestHandler._handle_auth_status(handler)

    handler._send_json.assert_called_once_with(
        HTTPStatus.OK,
        {"enabled": True, "authorized": False, "username": None},
    )


def test_handle_auth_status_reports_authorized_when_basic_auth_is_valid(tmp_path) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")

    handler = MagicMock(spec=SyncRequestHandler)
    handler._send_json = MagicMock()
    handler.context = MagicMock()
    auth = AuthManager(users_file)
    auth.authorize_basic = MagicMock(wraps=auth.authorize_basic)
    handler.context.auth = auth
    limiter = RateLimiter(max_attempts=1, window_seconds=60)
    limiter.complete_success = MagicMock(wraps=limiter.complete_success)
    limiter.complete_failure = MagicMock(wraps=limiter.complete_failure)
    limiter.cancel_reservation = MagicMock(wraps=limiter.cancel_reservation)
    handler.context.rate_limiter = limiter
    handler.context.trusted_proxies = []
    handler.client_address = ("127.0.0.1", 43123)
    handler.headers = {"Authorization": _basic_auth("admin", "admin")}

    SyncRequestHandler._handle_auth_status(handler)

    handler._send_json.assert_called_once_with(
        HTTPStatus.OK,
        {"enabled": True, "authorized": True, "username": "admin"},
    )
    auth.authorize_basic.assert_called_once_with("admin", "admin")
    limiter.complete_success.assert_called_once_with("http-basic:127.0.0.1")
    limiter.complete_failure.assert_not_called()
    limiter.cancel_reservation.assert_not_called()


def test_handle_auth_status_rate_limits_basic_before_second_password_check(
    tmp_path,
) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")
    auth = AuthManager(users_file)
    auth.authorize_basic = MagicMock(wraps=auth.authorize_basic)

    handler = MagicMock(spec=SyncRequestHandler)
    handler._send_json = MagicMock()
    handler.context = MagicMock()
    handler.context.auth = auth
    limiter = RateLimiter(max_attempts=1, window_seconds=60)
    limiter.complete_success = MagicMock(wraps=limiter.complete_success)
    limiter.complete_failure = MagicMock(wraps=limiter.complete_failure)
    limiter.cancel_reservation = MagicMock(wraps=limiter.cancel_reservation)
    handler.context.rate_limiter = limiter
    handler.context.trusted_proxies = []
    handler.client_address = ("127.0.0.1", 43123)
    handler.headers = {"Authorization": _basic_auth("admin", "wrong")}

    SyncRequestHandler._handle_auth_status(handler)
    handler._send_json.assert_called_once_with(
        HTTPStatus.OK,
        {"enabled": True, "authorized": False, "username": None},
    )
    auth.authorize_basic.assert_called_once_with("admin", "wrong")
    limiter.complete_failure.assert_called_once_with("http-basic:127.0.0.1")
    limiter.complete_success.assert_not_called()
    limiter.cancel_reservation.assert_not_called()

    handler._send_json.reset_mock()
    SyncRequestHandler._handle_auth_status(handler)

    handler._send_json.assert_called_once_with(
        HTTPStatus.TOO_MANY_REQUESTS,
        {"error": "Too many authentication attempts. Try again later."},
    )
    auth.authorize_basic.assert_called_once_with("admin", "wrong")
    limiter.complete_failure.assert_called_once_with("http-basic:127.0.0.1")


def test_handle_auth_status_reports_authorized_when_remember_cookie_is_valid(tmp_path) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")
    auth = AuthManager(users_file)
    auth.authorize_basic = MagicMock(wraps=auth.authorize_basic)
    remember_cookie = auth.build_remember_cookie("admin", secure=False)

    handler = MagicMock(spec=SyncRequestHandler)
    handler._send_json = MagicMock()
    handler.context = MagicMock()
    handler.context.auth = auth
    handler.headers = {"Cookie": remember_cookie.split(";", 1)[0]}

    SyncRequestHandler._handle_auth_status(handler)

    handler._send_json.assert_called_once_with(
        HTTPStatus.OK,
        {"enabled": True, "authorized": True, "username": "admin"},
    )
    auth.authorize_basic.assert_not_called()


def test_handle_auth_status_uses_api_key_without_password_hashing(tmp_path) -> None:
    users_file = tmp_path / "users.json"
    users_file.write_text(
        json.dumps({"users": [], "apiKeys": ["status-key"]}),
        encoding="utf-8",
    )
    auth = AuthManager(users_file)
    auth.authorize_basic = MagicMock(wraps=auth.authorize_basic)

    handler = MagicMock(spec=SyncRequestHandler)
    handler._send_json = MagicMock()
    handler.context = MagicMock()
    handler.context.auth = auth
    handler.headers = {"X-API-Key": "status-key"}

    SyncRequestHandler._handle_auth_status(handler)

    handler._send_json.assert_called_once_with(
        HTTPStatus.OK,
        {"enabled": True, "authorized": True, "username": None},
    )
    auth.authorize_basic.assert_not_called()
