from __future__ import annotations

import io
import json
from http import HTTPStatus
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from sync_server.handler import SyncRequestHandler
from sync_server.handler_http import (
    read_json,
    request_is_secure,
    require_auth,
    send_json,
    stream_request_body_to_file,
)


def test_send_json_writes_status_headers_and_body() -> None:
    handler = MagicMock(spec=SyncRequestHandler)
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()
    handler.wfile = io.BytesIO()

    send_json(handler, HTTPStatus.CREATED, {"ok": True}, {"X-Test": "1"})

    handler.send_response.assert_called_once_with(HTTPStatus.CREATED)
    header_calls = [call.args for call in handler.send_header.call_args_list]
    assert ("Content-Type", "application/json") in header_calls
    assert ("X-Test", "1") in header_calls
    assert json.loads(handler.wfile.getvalue().decode("utf-8")) == {"ok": True}


def test_read_json_parses_body_payload() -> None:
    body = b'{"hello":"world"}'
    handler = MagicMock(spec=SyncRequestHandler)
    handler.headers = {"Content-Length": str(len(body))}
    handler.rfile = io.BytesIO(body)
    handler._send_json = MagicMock()

    payload = read_json(handler)

    assert payload == {"hello": "world"}
    handler._send_json.assert_not_called()


def test_stream_request_body_to_file_writes_uploaded_bytes(tmp_path: Path) -> None:
    body = b"payload"
    handler = MagicMock(spec=SyncRequestHandler)
    handler.headers = {"Content-Length": str(len(body))}
    handler.rfile = io.BytesIO(body)
    target = tmp_path / "uploads" / "sample.bin"

    written = stream_request_body_to_file(handler, target)

    assert written == len(body)
    assert target.read_bytes() == body


def test_request_is_secure_ignores_forwarded_proto_without_trusted_proxy() -> None:
    handler = MagicMock(spec=SyncRequestHandler)
    handler.connection = object()
    handler.headers = {"X-Forwarded-Proto": "https"}
    handler.client_address = ("203.0.113.10", 443)
    handler.context = MagicMock()
    handler.context.trusted_proxies = []

    assert request_is_secure(handler) is False


def test_request_is_secure_honors_forwarded_proto_for_trusted_proxy() -> None:
    handler = MagicMock(spec=SyncRequestHandler)
    handler.connection = object()
    handler.headers = {"X-Forwarded-Proto": "https"}
    handler.client_address = ("127.0.0.1", 443)
    handler.context = MagicMock()
    handler.context.trusted_proxies = ["127.0.0.1/32"]

    assert request_is_secure(handler) is True


def test_require_auth_drains_request_body_and_returns_unauthorized() -> None:
    body = b"ignored"
    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.auth.enabled = True
    handler.context.auth.is_cookie_or_api_key_authorized.return_value = False
    handler.context.auth.get_basic_credentials.return_value = None
    handler.headers = {"Content-Length": str(len(body))}
    handler.rfile = io.BytesIO(body)
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()

    allowed = require_auth(handler)

    assert allowed is False
    assert handler.rfile.read() == b""
    handler.send_response.assert_called_once_with(HTTPStatus.UNAUTHORIZED)
    handler.send_header.assert_called_once_with("Connection", "close")


def test_require_auth_rejects_cookie_authenticated_post_without_csrf_header() -> None:
    body = b'{"theme":"dark"}'
    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.auth.is_authorized.return_value = True
    handler.context.auth.get_authorized_cookie_username.return_value = "admin"
    handler.context.auth.is_api_key_authorized.return_value = False
    handler.context.trusted_proxies = []
    handler.connection = object()
    handler.command = "POST"
    handler.headers = {
        "Content-Length": str(len(body)),
        "Cookie": "airqr_session=signed-token",
        "Host": "app.local",
    }
    handler.rfile = io.BytesIO(body)
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()

    allowed = require_auth(handler)

    assert allowed is False
    assert handler.rfile.read() == b""
    handler.send_response.assert_called_once_with(HTTPStatus.FORBIDDEN)


def test_require_auth_allows_cookie_authenticated_post_with_csrf_header() -> None:
    body = b'{"theme":"dark"}'
    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.auth.is_authorized.return_value = True
    handler.context.auth.get_authorized_cookie_username.return_value = "admin"
    handler.context.auth.is_api_key_authorized.return_value = False
    handler.context.trusted_proxies = []
    handler.connection = object()
    handler.command = "POST"
    handler.headers = {
        "Content-Length": str(len(body)),
        "Cookie": "airqr_session=signed-token",
        "Host": "app.local",
        "Origin": "http://app.local",
        "X-AirQR-CSRF": "1",
    }
    handler.rfile = io.BytesIO(body)
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()

    allowed = require_auth(handler)

    assert allowed is True
    assert handler.send_response.call_count == 0


def test_require_auth_allows_cookie_authenticated_post_with_forwarded_proxy_origin() -> None:
    body = b'{"theme":"dark"}'
    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.auth.is_authorized.return_value = True
    handler.context.auth.get_authorized_cookie_username.return_value = "admin"
    handler.context.auth.is_api_key_authorized.return_value = False
    handler.context.trusted_proxies = ["127.0.0.1/32"]
    handler.client_address = ("127.0.0.1", 443)
    handler.connection = object()
    handler.command = "POST"
    handler.headers = {
        "Content-Length": str(len(body)),
        "Cookie": "airqr_session=signed-token",
        "Host": "127.0.0.1:8081",
        "Origin": "https://app.local",
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Host": "app.local",
        "X-AirQR-CSRF": "1",
    }
    handler.rfile = io.BytesIO(body)
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()

    allowed = require_auth(handler)

    assert allowed is True
    assert handler.send_response.call_count == 0


def test_require_auth_allows_cookie_authenticated_post_with_trusted_proxy_internal_upstream_host() -> None:
    body = b'{"theme":"dark"}'
    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.auth.is_authorized.return_value = True
    handler.context.auth.get_authorized_cookie_username.return_value = "admin"
    handler.context.auth.is_api_key_authorized.return_value = False
    handler.context.trusted_proxies = ["127.0.0.1/32"]
    handler.client_address = ("127.0.0.1", 443)
    handler.connection = object()
    handler.command = "POST"
    handler.headers = {
        "Content-Length": str(len(body)),
        "Cookie": "airqr_session=signed-token",
        "Host": "127.0.0.1:8081",
        "Origin": "https://192.168.1.36:5173",
        "X-Forwarded-Proto": "https",
        "X-AirQR-CSRF": "1",
    }
    handler.rfile = io.BytesIO(body)
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()

    allowed = require_auth(handler)

    assert allowed is True
    assert handler.send_response.call_count == 0


def test_require_auth_allows_basic_auth_post_without_csrf_header() -> None:
    body = b'{"theme":"dark"}'
    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.auth.enabled = True
    handler.context.auth.is_cookie_or_api_key_authorized.return_value = False
    handler.context.auth.get_basic_credentials.return_value = ("user", "pass")
    handler.context.auth.authorize_basic.return_value = True
    handler.context.rate_limiter.try_reserve.return_value = True
    handler.context.auth.get_authorized_username.return_value = None
    handler.context.trusted_proxies = []
    handler.client_address = ("198.51.100.20", 43123)
    handler.connection = object()
    handler.command = "POST"
    handler.headers = {
        "Content-Length": str(len(body)),
        "Authorization": "Basic dXNlcjpwYXNz",
        "Host": "app.local",
    }
    handler.rfile = io.BytesIO(body)
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()

    allowed = require_auth(handler)

    assert allowed is True
    assert handler.send_response.call_count == 0


@pytest.mark.parametrize(
    "extra_headers",
    [
        {"Authorization": "Bearer irrelevant"},
        {"X-API-Key": "invalid-key"},
    ],
    ids=["irrelevant-authorization", "invalid-api-key"],
)
def test_cookie_write_with_invalid_auth_header_still_requires_csrf(
    extra_headers: dict[str, str],
) -> None:
    body = b'{}'
    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.auth.enabled = True
    handler.context.auth.is_cookie_or_api_key_authorized.return_value = True
    handler.context.auth.get_authorized_cookie_username.return_value = "admin"
    handler.context.auth.is_api_key_authorized.return_value = False
    handler.context.auth.get_basic_credentials.return_value = None
    handler.context.trusted_proxies = []
    handler.command = "POST"
    handler.headers = {
        "Content-Length": str(len(body)),
        "Cookie": "airqr_session=signed-token",
        "Host": "app.local",
        **extra_headers,
    }
    handler.rfile = io.BytesIO(body)
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()

    assert require_auth(handler) is False

    handler.send_response.assert_called_once_with(HTTPStatus.FORBIDDEN)
    handler.context.auth.authorize_basic.assert_not_called()


def test_cookie_write_with_invalid_basic_still_requires_csrf_and_counts_once() -> None:
    body = b'{}'
    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.auth.enabled = True
    handler.context.auth.is_cookie_or_api_key_authorized.return_value = True
    handler.context.auth.get_authorized_cookie_username.return_value = "admin"
    handler.context.auth.is_api_key_authorized.return_value = False
    handler.context.auth.get_basic_credentials.return_value = ("admin", "wrong")
    handler.context.auth.authorize_basic.return_value = False
    handler.context.rate_limiter.try_reserve.return_value = True
    handler.context.trusted_proxies = []
    handler.client_address = ("198.51.100.20", 43123)
    handler.command = "POST"
    handler.headers = {
        "Content-Length": str(len(body)),
        "Cookie": "airqr_session=signed-token",
        "Authorization": "Basic YWRtaW46d3Jvbmc=",
        "Host": "app.local",
    }
    handler.rfile = io.BytesIO(body)
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()

    assert require_auth(handler) is False

    handler.send_response.assert_called_once_with(HTTPStatus.FORBIDDEN)
    handler.context.auth.authorize_basic.assert_called_once_with("admin", "wrong")
    handler.context.rate_limiter.complete_failure.assert_called_once_with(
        "http-basic:198.51.100.20"
    )


@pytest.mark.parametrize("principal", ["api-key", "basic"])
def test_cookie_write_with_valid_non_cookie_principal_is_csrf_exempt(
    principal: str,
) -> None:
    body = b'{}'
    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.auth.enabled = True
    handler.context.auth.is_cookie_or_api_key_authorized.return_value = True
    handler.context.auth.get_authorized_cookie_username.return_value = "admin"
    handler.context.auth.is_api_key_authorized.return_value = principal == "api-key"
    handler.context.auth.get_basic_credentials.return_value = (
        ("admin", "password") if principal == "basic" else None
    )
    handler.context.auth.authorize_basic.return_value = True
    handler.context.rate_limiter.try_reserve.return_value = True
    handler.context.trusted_proxies = []
    handler.client_address = ("198.51.100.20", 43123)
    handler.command = "POST"
    handler.headers = {
        "Content-Length": str(len(body)),
        "Cookie": "airqr_session=signed-token",
        "Host": "app.local",
        **(
            {"X-API-Key": "valid-key"}
            if principal == "api-key"
            else {"Authorization": "Basic YWRtaW46cGFzc3dvcmQ="}
        ),
    }
    handler.rfile = io.BytesIO(body)
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()

    assert require_auth(handler) is True

    handler.send_response.assert_not_called()
    if principal == "basic":
        handler.context.auth.authorize_basic.assert_called_once_with(
            "admin", "password"
        )
        handler.context.rate_limiter.complete_success.assert_called_once_with(
            "http-basic:198.51.100.20"
        )
    else:
        handler.context.auth.authorize_basic.assert_not_called()


def test_require_auth_rate_limits_basic_before_password_verification() -> None:
    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.auth.enabled = True
    handler.context.auth.is_cookie_or_api_key_authorized.return_value = False
    handler.context.auth.get_basic_credentials.return_value = ("admin", "wrong")
    handler.context.trusted_proxies = []
    handler.context.rate_limiter.try_reserve.return_value = False
    handler.client_address = ("198.51.100.20", 43123)
    handler.command = "GET"
    handler.headers = {"Authorization": "Basic YWRtaW46d3Jvbmc="}
    handler.rfile = io.BytesIO()
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()

    assert require_auth(handler) is False

    handler.context.rate_limiter.try_reserve.assert_called_once_with(
        "http-basic:198.51.100.20"
    )
    handler.context.auth.authorize_basic.assert_not_called()
    handler.send_response.assert_called_once_with(HTTPStatus.TOO_MANY_REQUESTS)


def test_require_auth_records_failed_basic_attempt_once() -> None:
    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.auth.enabled = True
    handler.context.auth.is_cookie_or_api_key_authorized.return_value = False
    handler.context.auth.get_basic_credentials.return_value = ("admin", "wrong")
    handler.context.auth.authorize_basic.return_value = False
    handler.context.trusted_proxies = []
    handler.context.rate_limiter.try_reserve.return_value = True
    handler.client_address = ("198.51.100.20", 43123)
    handler.command = "GET"
    handler.headers = {"Authorization": "Basic YWRtaW46d3Jvbmc="}
    handler.rfile = io.BytesIO()
    handler.send_response = MagicMock()
    handler.send_header = MagicMock()
    handler.end_headers = MagicMock()

    assert require_auth(handler) is False

    handler.context.rate_limiter.complete_failure.assert_called_once_with(
        "http-basic:198.51.100.20"
    )
    handler.context.rate_limiter.complete_success.assert_not_called()


def test_require_auth_cookie_path_does_not_consume_basic_rate_limit() -> None:
    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.auth.enabled = True
    handler.context.auth.is_cookie_or_api_key_authorized.return_value = True
    handler.context.auth.get_authorized_cookie_username.return_value = "admin"
    handler.context.auth.is_api_key_authorized.return_value = False
    handler.context.trusted_proxies = []
    handler.connection = object()
    handler.client_address = ("198.51.100.20", 43123)
    handler.command = "GET"
    handler.headers = {"Cookie": "airqr_session=signed"}

    assert require_auth(handler) is True

    handler.context.rate_limiter.try_reserve.assert_not_called()
    handler.context.auth.authorize_basic.assert_not_called()
