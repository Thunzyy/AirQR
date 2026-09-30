"""WebSocket authentication helpers."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Optional
from urllib.parse import urlsplit


def _get_header(headers: Mapping[str, Any], name: str) -> Optional[str]:
    target = name.lower()
    for key, value in headers.items():
        if str(key).lower() != target:
            continue
        if isinstance(value, str):
            return value
        if isinstance(value, (list, tuple)):
            for item in value:
                if isinstance(item, str) and item:
                    return item
        elif value is not None:
            return str(value)
    return None


def _get_forwarded_host(headers: Mapping[str, Any]) -> Optional[str]:
    forwarded_host = _get_header(headers, "X-Forwarded-Host")
    if forwarded_host:
        return forwarded_host.split(",", 1)[0].strip()

    forwarded = _get_header(headers, "Forwarded") or ""
    for part in forwarded.split(","):
        for directive in part.split(";"):
            key, _, value = directive.strip().partition("=")
            if key.lower() != "host" or not value:
                continue
            normalized = value.strip().strip('"')
            if normalized:
                return normalized

    return None


def _default_port(scheme: str) -> Optional[int]:
    if scheme == "https":
        return 443
    if scheme == "http":
        return 80
    return None


def _host_matches_origin(host: str, origin: str) -> bool:
    parsed_origin = urlsplit(origin)
    if not parsed_origin.scheme or not parsed_origin.hostname:
        return False

    parsed_host = urlsplit(f"//{host.strip()}")
    if not parsed_host.hostname:
        return False

    if parsed_origin.hostname.lower() != parsed_host.hostname.lower():
        return False

    origin_port = parsed_origin.port or _default_port(parsed_origin.scheme)
    host_port = parsed_host.port
    if host_port is None:
        return origin_port in (None, _default_port(parsed_origin.scheme))

    return origin_port == host_port


def strip_cross_origin_cookie_auth(headers: Mapping[str, Any]) -> dict[str, str]:
    """Drop Cookie auth from cross-origin browser WebSocket handshakes.

    Browsers do not expose a WebSocket equivalent of fetch(credentials="omit").
    External direct mode must therefore ignore cookies whenever the WebSocket
    Origin does not match the sync-server host.
    """

    normalized = {str(key): str(value) for key, value in headers.items()}
    origin = (_get_header(normalized, "Origin") or "").strip()
    if not origin:
        return normalized

    host = (_get_forwarded_host(normalized) or _get_header(normalized, "Host") or "").strip()
    if not host or _host_matches_origin(host, origin):
        return normalized

    return {
        key: value
        for key, value in normalized.items()
        if key.lower() != "cookie"
    }
