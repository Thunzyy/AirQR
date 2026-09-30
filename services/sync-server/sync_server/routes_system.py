from __future__ import annotations

import logging
from http import HTTPStatus
from typing import TYPE_CHECKING, Any

from .auth import client_ip_from_peer
from .version import get_version_info

if TYPE_CHECKING:
    from .handler import SyncRequestHandler

logger = logging.getLogger(__name__)


def handle_auth_login(handler: "SyncRequestHandler") -> None:
    if not handler.context.auth.enabled:
        handler._send_json(
            HTTPStatus.OK,
            {
                "ok": True,
                "enabled": False,
                "authorized": True,
                "username": None,
            },
        )
        return

    payload = handler._read_json()
    if not isinstance(payload, dict):
        handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON"})
        return

    username = payload.get("username")
    password = payload.get("password")
    if not isinstance(username, str) or not isinstance(password, str):
        handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Missing credentials"})
        return
    remember = payload.get("remember")
    remember_enabled = True if remember is None else bool(remember)

    client_address = getattr(handler, "client_address", None)
    client_ip = client_ip_from_peer(
        client_address,
        handler,
        headers=handler.headers,
        trusted_proxies=handler.context.trusted_proxies,
    )
    rate_limit_key = f"login:{client_ip}"
    rate_limiter = handler.context.rate_limiter
    if rate_limiter and not rate_limiter.try_reserve(rate_limit_key):
        handler._send_json(
            HTTPStatus.TOO_MANY_REQUESTS,
            {"error": "Too many login attempts. Try again later."},
        )
        return

    try:
        secure = handler._request_is_secure()
        cookies = handler.context.auth.authenticate_and_build_cookies(
            username,
            password,
            secure=secure,
            remember=remember_enabled,
        )
    except BaseException:
        if rate_limiter:
            rate_limiter.cancel_reservation(rate_limit_key)
        raise
    if cookies is None:
        if rate_limiter:
            rate_limiter.complete_failure(rate_limit_key)
        handler._send_json(HTTPStatus.UNAUTHORIZED, {"error": "Invalid credentials"})
        return

    if rate_limiter:
        rate_limiter.complete_success(rate_limit_key)

    handler._send_json(
        HTTPStatus.OK,
        {
            "ok": True,
            "enabled": True,
            "authorized": True,
            "username": username,
        },
        {"Set-Cookie": cookies},
    )


def handle_auth_logout(handler: "SyncRequestHandler") -> None:
    if not handler._require_cookie_csrf():
        return
    username = handler.context.auth.get_authorized_cookie_username(handler.headers)
    if username:
        handler.context.auth.increment_token_version(username)
    handler._send_json(
        HTTPStatus.OK,
        {"ok": True},
        {
            "Set-Cookie": handler.context.auth.build_logout_cookies(
                secure=handler._request_is_secure()
            )
        },
    )


def handle_auth_credentials_post(handler: "SyncRequestHandler") -> None:
    if not handler.context.auth.enabled:
        handler._send_json(
            HTTPStatus.FORBIDDEN,
            {
                "error": (
                    "First-user HTTP setup is unavailable; bootstrap with CLI or "
                    "environment credentials"
                )
            },
        )
        return
    if not handler._require_auth():
        return

    payload = handler._read_json()
    if not isinstance(payload, dict):
        handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON object"})
        return

    username = payload.get("username")
    password = payload.get("password")
    if not isinstance(username, str) or not isinstance(password, str):
        handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Missing credentials"})
        return

    username = username.strip()
    if not username or not password:
        handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Missing credentials"})
        return

    try:
        secure = handler._request_is_secure()
        cookies = handler.context.auth.replace_authorized_user_and_build_cookies(
            handler.headers,
            username,
            password,
            secure=secure,
        )
    except Exception:
        logger.exception("Auth credentials update failed")
        handler._send_json(
            HTTPStatus.INTERNAL_SERVER_ERROR,
            {"error": "Internal server error"},
        )
        return

    if cookies is None:
        handler._send_json(
            HTTPStatus.UNAUTHORIZED,
            {"error": "Authorization expired; retry with current credentials"},
        )
        return

    handler._send_json(
        HTTPStatus.OK,
        {
            "ok": True,
            "enabled": True,
            "authorized": True,
            "username": username,
        },
        {"Set-Cookie": cookies},
    )


def handle_export_config_get(handler: "SyncRequestHandler") -> None:
    if not handler._require_auth():
        return
    config = handler.context.export_manager.load_config()
    effective_dir = handler.context.export_manager.effective_dir(config)
    config["effectiveDir"] = str(effective_dir) if effective_dir else None
    handler._send_json(HTTPStatus.OK, config)


def handle_export_config_post(handler: "SyncRequestHandler") -> None:
    if not handler._require_auth():
        return
    payload = handler._read_json()
    if not payload:
        handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON"})
        return
    if not isinstance(payload, dict):
        handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON object"})
        return

    try:
        ok, config, error = handler.context.export_manager.update_config(payload)
        if not ok:
            handler._send_json(HTTPStatus.BAD_REQUEST, {"error": error})
            return
        handler._send_json(HTTPStatus.OK, {"ok": True, "config": config})
    except Exception:
        logger.exception("Export config update failed")
        handler._send_json(
            HTTPStatus.INTERNAL_SERVER_ERROR,
            {"error": "Internal server error"},
        )


def handle_settings_get(handler: "SyncRequestHandler") -> None:
    if not handler._require_auth():
        return
    settings = handler.context.settings_store.load()
    handler._send_json(HTTPStatus.OK, settings)


def handle_settings_post(handler: "SyncRequestHandler") -> None:
    if not handler._require_auth():
        return
    payload = handler._read_json()
    if payload is None:
        handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON"})
        return
    if not isinstance(payload, dict):
        handler._send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid JSON object"})
        return
    settings = handler.context.settings_store.merge(payload)
    handler._send_json(HTTPStatus.OK, {"ok": True, "settings": settings})


def handle_auth_status(handler: "SyncRequestHandler") -> None:
    auth = handler.context.auth
    enabled = auth.enabled
    if not enabled:
        handler._send_json(
            HTTPStatus.OK,
            {"enabled": False, "authorized": True, "username": None},
        )
        return

    username = auth.get_authorized_cookie_username(handler.headers)
    authorized = username is not None
    if not authorized:
        authorized = auth.is_api_key_authorized(handler.headers)

    credentials = auth.get_basic_credentials(handler.headers)
    if not authorized and credentials is not None:
        client_ip = client_ip_from_peer(
            getattr(handler, "client_address", None),
            handler,
            headers=handler.headers,
            trusted_proxies=handler.context.trusted_proxies,
        )
        rate_limit_key = f"http-basic:{client_ip}"
        rate_limiter = handler.context.rate_limiter
        if rate_limiter and not rate_limiter.try_reserve(rate_limit_key):
            handler._send_json(
                HTTPStatus.TOO_MANY_REQUESTS,
                {"error": "Too many authentication attempts. Try again later."},
            )
            return
        try:
            authorized = auth.authorize_basic(*credentials)
        except BaseException:
            if rate_limiter:
                rate_limiter.cancel_reservation(rate_limit_key)
            raise
        if rate_limiter:
            if authorized:
                rate_limiter.complete_success(rate_limit_key)
            else:
                rate_limiter.complete_failure(rate_limit_key)
        if authorized:
            username = credentials[0]

    handler._send_json(
        HTTPStatus.OK,
        {
            "enabled": enabled,
            "authorized": authorized,
            "username": username,
        },
    )


def handle_health(handler: "SyncRequestHandler") -> None:
    handler._send_json(
        HTTPStatus.OK,
        {
            "status": "ok",
            **get_version_info(),
        },
    )


def handle_version(handler: "SyncRequestHandler") -> None:
    handler._send_json(HTTPStatus.OK, get_version_info())


def handle_ready(handler: "SyncRequestHandler") -> None:
    checks: dict[str, Any] = {}

    try:
        storage_ok = handler.context.storage.base_dir.exists()
        checks["storage"] = "ok" if storage_ok else "error"
    except Exception:
        checks["storage"] = "error"

    if hasattr(handler.context.storage, "db"):
        try:
            with handler.context.storage.db.connection() as conn:
                conn.execute("SELECT 1")
            checks["database"] = "ok"
        except Exception:
            checks["database"] = "error"

    all_ok = all(value == "ok" for value in checks.values())
    status = "ready" if all_ok else "not_ready"
    http_status = HTTPStatus.OK if all_ok else HTTPStatus.SERVICE_UNAVAILABLE

    handler._send_json(
        http_status,
        {
            "status": status,
            "checks": checks,
        },
    )
