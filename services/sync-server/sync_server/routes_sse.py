from __future__ import annotations

import queue
from http import HTTPStatus
from typing import TYPE_CHECKING

from .auth import client_ip_from_peer

if TYPE_CHECKING:
    from .handler import SyncRequestHandler


def require_sse_auth(
    handler: "SyncRequestHandler",
    params: dict[str, list[str]],
) -> bool:
    if not handler.context.auth.enabled:
        return True

    client_address = getattr(handler, "client_address", None)
    client_ip = client_ip_from_peer(
        client_address,
        handler,
        headers=handler.headers,
        trusted_proxies=handler.context.trusted_proxies,
    )
    rate_limit_key = f"sse:{client_ip}"
    rate_limiter = handler.context.rate_limiter
    if handler.context.auth.is_cookie_or_api_key_authorized(handler.headers):
        if rate_limiter:
            rate_limiter.reset(rate_limit_key)
        return True

    api_key = (params.get("apiKey") or [None])[0]
    if isinstance(api_key, str) and handler.context.auth.authorize_api_key(api_key):
        if rate_limiter:
            rate_limiter.reset(rate_limit_key)
        return True

    if rate_limiter and not rate_limiter.try_reserve(rate_limit_key):
        handler.send_response(HTTPStatus.TOO_MANY_REQUESTS)
        handler.send_header("Connection", "close")
        handler.end_headers()
        return False

    try:
        credentials = handler.context.auth.get_basic_credentials(handler.headers)
        is_basic_authorized = bool(
            credentials and handler.context.auth.authorize_basic(*credentials)
        )
    except BaseException:
        if rate_limiter:
            rate_limiter.cancel_reservation(rate_limit_key)
        raise

    if is_basic_authorized:
        if rate_limiter:
            rate_limiter.complete_success(rate_limit_key)
        return True

    if rate_limiter:
        rate_limiter.complete_failure(rate_limit_key)

    handler.send_response(HTTPStatus.UNAUTHORIZED)
    handler.send_header("Connection", "close")
    handler.end_headers()
    return False


def handle_sse_events(handler: "SyncRequestHandler") -> None:
    handler.send_response(HTTPStatus.OK)
    handler.send_header("Content-Type", "text/event-stream")
    handler.send_header("Cache-Control", "no-cache")
    handler.send_header("Connection", "keep-alive")
    handler.send_header("X-Accel-Buffering", "no")
    handler.end_headers()

    client_queue = handler.context.event_hub.subscribe()
    try:
        handler.wfile.write(b"event: hello\ndata: {}\n\n")
        handler.wfile.flush()
        while True:
            try:
                message = client_queue.get(timeout=15)
            except queue.Empty:
                try:
                    handler.wfile.write(b": ping\n\n")
                    handler.wfile.flush()
                except (
                    BrokenPipeError,
                    ConnectionResetError,
                    ConnectionAbortedError,
                    OSError,
                ):
                    break
                continue
            try:
                handler.wfile.write(message)
                handler.wfile.flush()
            except (
                BrokenPipeError,
                ConnectionResetError,
                ConnectionAbortedError,
                OSError,
            ):
                break
    except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
        pass
    finally:
        handler.context.event_hub.unsubscribe(client_queue)
