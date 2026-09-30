from __future__ import annotations

import json
import logging
import ssl
import ipaddress
from dataclasses import dataclass
from enum import Enum
from http import HTTPStatus
from pathlib import Path
from typing import TYPE_CHECKING, Any, Optional
from urllib.parse import urlparse

from .constants import MAX_JSON_BODY_SIZE, MAX_UPLOAD_BODY_SIZE
from .auth import client_ip_from_peer
from .utils import safe_filename

if TYPE_CHECKING:
    from .handler import HeaderValue, SyncRequestHandler

logger = logging.getLogger(__name__)

STREAM_COPY_CHUNK_SIZE = 1024 * 1024
COOKIE_CSRF_HEADER = "X-AirQR-CSRF"
PUBLIC_INVALID_REQUEST_BODY_ERROR = "Invalid request body"
PUBLIC_INCOMPLETE_REQUEST_BODY_ERROR = "Incomplete request body"
PUBLIC_REQUEST_BODY_TOO_LARGE_ERROR = "Request body too large"
PUBLIC_SCAN_ASSEMBLY_ERROR = "Stored scan packets are not yet decodable"


class _AuthPrincipal(Enum):
    DISABLED = "disabled"
    COOKIE = "cookie"
    API_KEY = "api_key"
    BASIC = "basic"


@dataclass(frozen=True)
class _AuthenticationResult:
    principal: Optional[_AuthPrincipal]
    basic_rate_limited: bool = False


def _is_request_from_trusted_proxy(handler: "SyncRequestHandler") -> bool:
    trusted_proxy_ranges = getattr(getattr(handler, "context", None), "trusted_proxies", None) or []
    if not trusted_proxy_ranges:
        return False

    client_address = getattr(handler, "client_address", None)
    client_host = client_address[0] if client_address else None
    if not isinstance(client_host, str):
        return False

    try:
        client_ip = ipaddress.ip_address(client_host)
    except ValueError:
        return False

    for proxy_range in trusted_proxy_ranges:
        try:
            if client_ip in ipaddress.ip_network(proxy_range, strict=False):
                return True
        except ValueError:
            continue

    return False


def _get_effective_request_host(handler: "SyncRequestHandler") -> str:
    headers = handler.headers
    host = (headers.get("Host") or "").strip()
    if not _is_request_from_trusted_proxy(handler):
        return host

    forwarded_host = (headers.get("X-Forwarded-Host") or "").split(",", 1)[0].strip()
    if forwarded_host:
        return forwarded_host

    forwarded = headers.get("Forwarded") or ""
    for part in forwarded.split(","):
        for directive in part.split(";"):
            key, _, value = directive.strip().partition("=")
            if key.lower() != "host" or not value:
                continue
            normalized = value.strip().strip('"')
            if normalized:
                return normalized

    origin = (headers.get("Origin") or "").strip()
    if origin and _is_internal_proxy_upstream_host(host):
        parsed_origin = urlparse(origin)
        if parsed_origin.netloc:
            return parsed_origin.netloc.rstrip("/")

    return host


def _is_internal_proxy_upstream_host(host: str) -> bool:
    normalized = host.strip()
    if not normalized:
        return False

    parsed = urlparse(f"//{normalized}")
    hostname = parsed.hostname
    if not hostname:
        return False

    if hostname == "localhost":
        return True

    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        return False

    return (
        address.is_loopback
        or address.is_private
        or address.is_link_local
        or address.is_unspecified
    )


def send_json(
    handler: "SyncRequestHandler",
    status: int,
    payload: Any,
    extra_headers: Optional[dict[str, "HeaderValue"]] = None,
) -> None:
    data = json.dumps(payload).encode("utf-8")
    try:
        handler.send_response(status)
        handler.send_header("Content-Type", "application/json")
        handler.send_header("Content-Length", str(len(data)))
        if extra_headers:
            for header, value in extra_headers.items():
                if isinstance(value, list):
                    for item in value:
                        handler.send_header(header, item)
                elif value is not None:
                    handler.send_header(header, value)
        handler.end_headers()
        handler.wfile.write(data)
    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
        logger.info("Client disconnected before JSON response could be written")


def send_bytes(
    handler: "SyncRequestHandler",
    status: int,
    payload: bytes,
    content_type: str,
    extra_headers: Optional[dict[str, "HeaderValue"]] = None,
) -> None:
    try:
        handler.send_response(status)
        handler.send_header("Content-Type", content_type)
        handler.send_header("Content-Length", str(len(payload)))
        if extra_headers:
            for header, value in extra_headers.items():
                if isinstance(value, list):
                    for item in value:
                        handler.send_header(header, item)
                elif value is not None:
                    handler.send_header(header, value)
        handler.end_headers()
        handler.wfile.write(payload)
    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
        logger.info("Client disconnected before byte response could be written")


def read_json(handler: "SyncRequestHandler") -> Optional[dict[str, Any]]:
    length = int(handler.headers.get("Content-Length", "0") or "0")
    if length <= 0:
        return None
    if length > MAX_JSON_BODY_SIZE:
        handler._send_json(
            HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
            {"error": "Request body too large"},
        )
        return None
    body = handler.rfile.read(length)
    try:
        return json.loads(body.decode("utf-8"))
    except Exception:
        return None


def _drain_request_body(handler: "SyncRequestHandler") -> None:
    length = int(handler.headers.get("Content-Length", "0") or "0")
    if length > 0:
        try:
            handler.rfile.read(length)
        except Exception:
            pass


def sanitize_request_body_error_message(error: Exception | str) -> str:
    message = str(error).strip()
    if message == "Incomplete request body":
        return PUBLIC_INCOMPLETE_REQUEST_BODY_ERROR
    if message.startswith("Request body too large"):
        return PUBLIC_REQUEST_BODY_TOO_LARGE_ERROR
    return PUBLIC_INVALID_REQUEST_BODY_ERROR


def sanitize_scan_assembly_error_message(_: Exception | str) -> str:
    return PUBLIC_SCAN_ASSEMBLY_ERROR


def stream_request_body_to_file(
    handler: "SyncRequestHandler",
    file_path: Path,
) -> int:
    length_raw = handler.headers.get("Content-Length", "0") or "0"
    try:
        remaining = int(length_raw)
    except (TypeError, ValueError) as exc:
        raise ValueError("Invalid Content-Length") from exc
    if remaining < 0:
        raise ValueError("Invalid Content-Length")
    if remaining > MAX_UPLOAD_BODY_SIZE:
        raise ValueError(
            f"Request body too large ({remaining} bytes, max {MAX_UPLOAD_BODY_SIZE})"
        )

    tmp_path = file_path.with_name(f"{file_path.name}.part")
    file_path.parent.mkdir(parents=True, exist_ok=True)
    written = 0

    try:
        with tmp_path.open("wb") as handle:
            while remaining > 0:
                chunk = handler.rfile.read(min(STREAM_COPY_CHUNK_SIZE, remaining))
                if not chunk:
                    raise ValueError("Incomplete request body")
                handle.write(chunk)
                written += len(chunk)
                remaining -= len(chunk)
        tmp_path.replace(file_path)
        return written
    except Exception:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass
        raise


def build_session_file_path(
    handler: "SyncRequestHandler",
    session_id: str,
    filename: str,
) -> Path:
    storage = handler.context.storage
    safe_name = safe_filename(filename)
    file_path = storage.session_file_path(session_id, safe_name)
    file_path.parent.mkdir(parents=True, exist_ok=True)
    return file_path


def read_body_bytes(handler: "SyncRequestHandler") -> bytes:
    length = int(handler.headers.get("Content-Length", "0") or "0")
    if length <= 0:
        return b""
    if length > MAX_UPLOAD_BODY_SIZE:
        handler._send_json(
            HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
            {"error": "Request body too large"},
        )
        return b""
    return handler.rfile.read(length)


def request_is_secure(handler: "SyncRequestHandler") -> bool:
    connection = getattr(handler, "connection", None)
    if isinstance(connection, ssl.SSLSocket):
        return True

    if not _is_request_from_trusted_proxy(handler):
        return False

    forwarded_proto = (handler.headers.get("X-Forwarded-Proto") or "").strip().lower()
    if forwarded_proto == "https":
        return True

    forwarded = handler.headers.get("Forwarded") or ""
    return "proto=https" in forwarded.lower()


def _reject_cookie_csrf(handler: "SyncRequestHandler", reason: str) -> bool:
    headers = handler.headers
    origin = (headers.get("Origin") or "").strip()
    parsed_origin = urlparse(origin) if origin else None
    raw_host = (headers.get("Host") or "").strip()
    logger.warning(
        "Rejecting cookie-authenticated %s %s: %s (host=%r effective_host=%r origin=%r csrf=%r has_cookie=%s "
        "has_authorization=%s x_forwarded_host=%r x_forwarded_proto=%r forwarded=%r trusted_proxy=%s secure=%s "
        "internal_upstream=%s origin_scheme=%r)",
        (getattr(handler, "command", "") or "").upper(),
        getattr(handler, "path", ""),
        reason,
        raw_host,
        _get_effective_request_host(handler),
        origin,
        (headers.get(COOKIE_CSRF_HEADER) or "").strip(),
        bool(headers.get("Cookie")),
        bool(headers.get("Authorization")),
        (headers.get("X-Forwarded-Host") or "").strip(),
        (headers.get("X-Forwarded-Proto") or "").strip(),
        (headers.get("Forwarded") or "").strip(),
        _is_request_from_trusted_proxy(handler),
        request_is_secure(handler),
        _is_internal_proxy_upstream_host(raw_host),
        (parsed_origin.scheme if parsed_origin else ""),
    )
    _drain_request_body(handler)
    handler.send_response(HTTPStatus.FORBIDDEN)
    handler.send_header("Connection", "close")
    handler.end_headers()
    return False


def require_cookie_csrf(
    handler: "SyncRequestHandler",
    *,
    principal: Optional[_AuthPrincipal] = None,
) -> bool:
    method = (getattr(handler, "command", "") or "").upper()
    if method not in {"POST", "DELETE", "PUT", "PATCH"}:
        return True

    headers = handler.headers
    if principal is None:
        cookie_username = handler.context.auth.get_authorized_cookie_username(headers)
        cookie_authenticated = isinstance(cookie_username, str) and bool(cookie_username)
    else:
        cookie_authenticated = principal is _AuthPrincipal.COOKIE
    if not cookie_authenticated:
        return True

    if (headers.get(COOKIE_CSRF_HEADER) or "").strip() != "1":
        return _reject_cookie_csrf(handler, "missing_or_invalid_csrf_header")

    origin = (headers.get("Origin") or "").strip()
    host = _get_effective_request_host(handler)
    if origin:
        if not host:
            return _reject_cookie_csrf(handler, "missing_effective_host")
        parsed_origin = urlparse(origin)
        origin_host = parsed_origin.netloc.rstrip("/")
        if _is_request_from_trusted_proxy(handler) and origin_host == host.rstrip("/"):
            return True
        origin_scheme = (parsed_origin.scheme or "").lower()
        if (
            _is_request_from_trusted_proxy(handler)
            and origin_host
            and _is_internal_proxy_upstream_host((headers.get("Host") or "").strip())
            and origin_scheme in {"http", "https"}
            and origin_scheme == ("https" if request_is_secure(handler) else "http")
        ):
            return True
        expected_origin = f"{'https' if request_is_secure(handler) else 'http'}://{host}"
        if origin.rstrip("/") != expected_origin.rstrip("/"):
            return _reject_cookie_csrf(
                handler,
                f"origin_mismatch expected={expected_origin!r} actual={origin!r}",
            )

    return True


def _authenticate_request(handler: "SyncRequestHandler") -> _AuthenticationResult:
    auth = handler.context.auth
    if not auth.enabled:
        return _AuthenticationResult(_AuthPrincipal.DISABLED)

    cookie_username = auth.get_authorized_cookie_username(handler.headers)
    cookie_authenticated = isinstance(cookie_username, str) and bool(cookie_username)
    if auth.is_api_key_authorized(handler.headers) is True:
        return _AuthenticationResult(_AuthPrincipal.API_KEY)

    credentials = auth.get_basic_credentials(handler.headers)
    has_basic_credentials = (
        isinstance(credentials, tuple)
        and len(credentials) == 2
        and all(isinstance(value, str) for value in credentials)
    )
    if has_basic_credentials:
        client_ip = client_ip_from_peer(
            getattr(handler, "client_address", None),
            handler,
            headers=handler.headers,
            trusted_proxies=handler.context.trusted_proxies,
        )
        rate_limit_key = f"http-basic:{client_ip}"
        rate_limiter = handler.context.rate_limiter
        if rate_limiter and not rate_limiter.try_reserve(rate_limit_key):
            if cookie_authenticated:
                return _AuthenticationResult(_AuthPrincipal.COOKIE)
            return _AuthenticationResult(None, basic_rate_limited=True)
        try:
            authorized = auth.authorize_basic(*credentials)
        except BaseException:
            if rate_limiter:
                rate_limiter.cancel_reservation(rate_limit_key)
            raise
        if authorized:
            if rate_limiter:
                rate_limiter.complete_success(rate_limit_key)
            return _AuthenticationResult(_AuthPrincipal.BASIC)
        if rate_limiter:
            rate_limiter.complete_failure(rate_limit_key)

    if cookie_authenticated:
        return _AuthenticationResult(_AuthPrincipal.COOKIE)
    return _AuthenticationResult(None)


def require_auth(handler: "SyncRequestHandler") -> bool:
    result = _authenticate_request(handler)
    if result.principal is not None:
        return require_cookie_csrf(handler, principal=result.principal)

    _drain_request_body(handler)
    handler.send_response(
        HTTPStatus.TOO_MANY_REQUESTS
        if result.basic_rate_limited
        else HTTPStatus.UNAUTHORIZED
    )
    handler.send_header("Connection", "close")
    handler.end_headers()
    return False
