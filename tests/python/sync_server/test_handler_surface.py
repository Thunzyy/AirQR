from __future__ import annotations

from http import HTTPStatus
from pathlib import Path
from unittest.mock import MagicMock

from sync_server.constants import SECURITY_HEADERS
from sync_server.handler import SyncRequestHandler
from sync_server.handler_surface import (
    apply_surface_headers,
    handle_options,
    should_serve_spa_fallback,
)


def _surface_handler(
    *,
    path: str,
    origin: str | None,
    allowed_origins: list[str] | None = None,
    auth_enabled: bool = True,
) -> MagicMock:
    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.allowed_origins = allowed_origins or []
    handler.context.auth = MagicMock()
    handler.context.auth.enabled = auth_enabled
    handler.path = path
    handler.headers = {"Origin": origin} if origin else {}
    handler.send_header = MagicMock()
    return handler


def test_apply_surface_headers_reflects_allowed_origin_for_api_requests() -> None:
    handler = _surface_handler(
        path="/api/history",
        origin="https://app.local",
        allowed_origins=["https://app.local"],
        auth_enabled=True,
    )

    apply_surface_headers(handler)

    calls = [call.args for call in handler.send_header.call_args_list]
    assert ("Access-Control-Allow-Origin", "https://app.local") in calls
    assert ("Access-Control-Allow-Credentials", "true") in calls
    assert ("Vary", "Origin") in calls
    assert ("Cross-Origin-Resource-Policy", "cross-origin") in calls


def test_apply_surface_headers_does_not_allow_credentials_for_wildcard_cors() -> None:
    handler = _surface_handler(
        path="/api/history",
        origin="https://evil.example",
        allowed_origins=["*"],
        auth_enabled=True,
    )

    apply_surface_headers(handler)

    calls = [call.args for call in handler.send_header.call_args_list]
    assert ("Access-Control-Allow-Origin", "*") in calls
    assert ("Access-Control-Allow-Credentials", "true") not in calls
    assert ("Vary", "Origin") not in calls


def test_apply_surface_headers_allows_external_api_origin_without_credentials_when_auth_enabled() -> None:
    handler = _surface_handler(
        path="/api/history",
        origin="https://client.example",
        allowed_origins=[],
        auth_enabled=True,
    )

    apply_surface_headers(handler)

    calls = [call.args for call in handler.send_header.call_args_list]
    assert ("Access-Control-Allow-Origin", "https://client.example") in calls
    assert ("Access-Control-Allow-Credentials", "true") not in calls
    assert ("Vary", "Origin") in calls
    assert (
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, X-API-Key, X-AirQR-CSRF",
    ) in calls
    assert ("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS") in calls
    assert ("Cross-Origin-Resource-Policy", "cross-origin") in calls


def test_apply_surface_headers_rejects_external_api_origin_when_auth_disabled() -> None:
    handler = _surface_handler(
        path="/api/history",
        origin="https://client.example",
        allowed_origins=[],
        auth_enabled=False,
    )

    apply_surface_headers(handler)

    calls = [call.args for call in handler.send_header.call_args_list]
    assert ("Access-Control-Allow-Origin", "https://client.example") not in calls
    assert ("Access-Control-Allow-Credentials", "true") not in calls
    assert ("Access-Control-Allow-Headers", "Authorization, Content-Type, X-API-Key, X-AirQR-CSRF") not in calls
    assert ("Cross-Origin-Resource-Policy", "cross-origin") in calls


def test_apply_surface_headers_rejects_external_origin_for_non_api_route_even_when_auth_enabled() -> None:
    handler = _surface_handler(
        path="/settings",
        origin="https://client.example",
        allowed_origins=[],
        auth_enabled=True,
    )

    apply_surface_headers(handler)

    calls = [call.args for call in handler.send_header.call_args_list]
    assert ("Access-Control-Allow-Origin", "https://client.example") not in calls
    assert ("Access-Control-Allow-Credentials", "true") not in calls
    for header, value in SECURITY_HEADERS.items():
        assert (header, value) in calls


def test_apply_surface_headers_adds_security_headers_for_non_api_route() -> None:
    handler = _surface_handler(
        path="/",
        origin=None,
        allowed_origins=[],
        auth_enabled=True,
    )

    apply_surface_headers(handler)

    calls = [call.args for call in handler.send_header.call_args_list]
    for header, value in SECURITY_HEADERS.items():
        assert (header, value) in calls


def test_should_serve_spa_fallback_detects_client_route(tmp_path: Path) -> None:
    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.static_dir = tmp_path
    handler.headers = {"Accept": "text/html"}
    handler.translate_path = MagicMock(return_value=str(tmp_path / "settings"))

    assert should_serve_spa_fallback(handler, "/settings") is True


def test_handle_options_returns_no_content() -> None:
    handler = MagicMock(spec=SyncRequestHandler)
    handler.send_response = MagicMock()
    handler.end_headers = MagicMock()

    handle_options(handler)

    handler.send_response.assert_called_once_with(HTTPStatus.NO_CONTENT)
    handler.end_headers.assert_called_once_with()
