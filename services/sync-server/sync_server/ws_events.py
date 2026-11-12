"""WebSocket-based event hub for real-time updates."""

from __future__ import annotations

import asyncio
import json
import logging
import threading
import uuid
from collections.abc import Mapping
from concurrent.futures import Future
from typing import Any, Dict, Optional

from .auth import client_ip_from_peer
from .ws_auth import strip_cross_origin_cookie_auth

logger = logging.getLogger(__name__)


def _extract_request_headers(websocket: Any) -> dict[str, str]:
    request = getattr(websocket, "request", None)
    if request is not None:
        headers = getattr(request, "headers", None)
        if isinstance(headers, Mapping):
            return dict(headers)

    headers = getattr(websocket, "request_headers", None)
    if isinstance(headers, Mapping):
        return dict(headers)

    return {}


class WebSocketEventHub:
    """Manages WebSocket connections and broadcasts events."""

    def __init__(self) -> None:
        self.clients: Dict[str, Any] = {}  # client_id -> websocket
        self._clients_lock = threading.Lock()
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """Bind broadcasts to the server event loop used by websocket connections."""
        self._loop = loop

    def register(self, websocket: Any) -> str:
        """Register a new WebSocket client. Returns client ID."""
        client_id = str(uuid.uuid4())
        with self._clients_lock:
            self.clients[client_id] = websocket
        logger.debug("WebSocket client registered: %s", client_id)
        return client_id

    def unregister(self, client_id: str) -> None:
        """Unregister a WebSocket client."""
        with self._clients_lock:
            if client_id in self.clients:
                del self.clients[client_id]
                logger.debug("WebSocket client unregistered: %s", client_id)

    @property
    def client_count(self) -> int:
        """Return number of connected clients."""
        with self._clients_lock:
            return len(self.clients)

    def broadcast_threadsafe(self, event_type: str, payload: Any) -> Optional[Future]:
        """Schedule a broadcast onto the websocket server event loop."""
        if self.client_count == 0:
            return None

        loop = self._loop
        if loop is None or loop.is_closed():
            try:
                running_loop = asyncio.get_running_loop()
            except RuntimeError:
                running_loop = None

            logger.debug(
                "WebSocket event loop is not ready for %s broadcast; using direct fallback",
                event_type,
            )
            if running_loop is not None and not running_loop.is_closed():
                running_loop.create_task(self.broadcast(event_type, payload))
            else:
                asyncio.run(self.broadcast(event_type, payload))
            return None

        future = asyncio.run_coroutine_threadsafe(self.broadcast(event_type, payload), loop)
        future.add_done_callback(self._log_broadcast_result)
        return future

    def _log_broadcast_result(self, future: Future) -> None:
        try:
            future.result()
        except Exception as exc:
            logger.warning("WebSocket broadcast failed: %s", exc)

    async def broadcast(self, event_type: str, payload: Any) -> None:
        """Broadcast an event to all connected clients."""
        client_items = self._get_client_items()
        logger.info("Broadcasting event: type=%s, clients=%d", event_type, len(client_items))
        if not client_items:
            return

        message = json.dumps({
            "type": event_type,
            "payload": payload,
        })

        failed_clients = []

        for client_id, ws in client_items:
            if getattr(ws, 'closed', False):
                failed_clients.append(client_id)
                continue

            try:
                await ws.send(message)
            except Exception as e:
                logger.warning("Failed to send to client %s: %s", client_id, e)
                failed_clients.append(client_id)

        # Clean up failed clients
        for client_id in failed_clients:
            self.unregister(client_id)

    def _get_client_items(self) -> list[tuple[str, Any]]:
        with self._clients_lock:
            return list(self.clients.items())

    async def send_to_client(self, client_id: str, event_type: str, payload: Any) -> bool:
        """Send an event to a specific client. Returns True if successful."""
        with self._clients_lock:
            ws = self.clients.get(client_id)
        if ws is None or getattr(ws, 'closed', False):
            return False

        try:
            message = json.dumps({
                "type": event_type,
                "payload": payload,
            })
            await ws.send(message)
            return True
        except Exception as e:
            logger.warning("Failed to send to client %s: %s", client_id, e)
            self.unregister(client_id)
            return False


async def handle_events_client(
    websocket: Any,
    hub: WebSocketEventHub,
    auth_manager: Optional[Any] = None,
) -> None:
    """Handle a WebSocket connection for the events channel."""
    client_id = None

    try:
        # Wait for messages
        async for message in websocket:
            try:
                data = json.loads(message)
            except json.JSONDecodeError:
                await websocket.send(json.dumps({
                    "type": "error",
                    "code": "invalid_json",
                    "message": "Invalid JSON",
                    "fatal": True,
                }))
                return

            msg_type = data.get("type")

            if msg_type == "hello":
                # Validate protocol
                if data.get("protocol") != "airqr-events":
                    await websocket.send(json.dumps({
                        "type": "error",
                        "code": "invalid_protocol",
                        "message": "Expected protocol: airqr-events",
                        "fatal": True,
                    }))
                    return

                # Authenticate if auth is enabled
                if auth_manager and auth_manager.enabled:
                    remote_address = getattr(websocket, "remote_address", None)
                    headers = strip_cross_origin_cookie_auth(
                        _extract_request_headers(websocket)
                    )
                    client_ip = client_ip_from_peer(
                        remote_address,
                        websocket,
                        headers=headers,
                        trusted_proxies=getattr(auth_manager, "trusted_proxies", ()),
                    )
                    rate_limit_key = f"ws-events:{client_ip}"
                    rate_limiter = getattr(auth_manager, "rate_limiter", None)
                    api_key = data.get("apiKey")
                    is_cheaply_authed = auth_manager.is_cookie_or_api_key_authorized(
                        headers
                    ) or bool(
                        isinstance(api_key, str)
                        and api_key
                        and auth_manager.authorize_api_key(api_key)
                    )
                    if is_cheaply_authed:
                        if rate_limiter:
                            rate_limiter.reset(rate_limit_key)
                    else:
                        if rate_limiter and not rate_limiter.try_reserve(rate_limit_key):
                            await websocket.send(json.dumps({
                                "type": "error",
                                "code": "rate_limited",
                                "message": "Too many attempts. Try again later.",
                                "fatal": True,
                            }))
                            return

                        try:
                            if "username" in data or "password" in data:
                                username = data.get("username")
                                password = data.get("password")
                                credentials = (
                                    (username, password)
                                    if isinstance(username, str)
                                    and username
                                    and isinstance(password, str)
                                    and password
                                    else None
                                )
                            else:
                                credentials = auth_manager.get_basic_credentials(
                                    headers
                                )
                            is_basic_authed = bool(
                                credentials
                                and credentials[0]
                                and credentials[1]
                                and auth_manager.authorize_basic(*credentials)
                            )
                        except BaseException:
                            if rate_limiter:
                                rate_limiter.cancel_reservation(rate_limit_key)
                            raise

                        if is_basic_authed:
                            if rate_limiter:
                                rate_limiter.complete_success(rate_limit_key)
                        else:
                            if rate_limiter:
                                rate_limiter.complete_failure(rate_limit_key)

                            await websocket.send(json.dumps({
                                "type": "error",
                                "code": "auth_failed",
                                "message": "Authentication required",
                                "fatal": True,
                            }))
                            return

                # Register client
                client_id = hub.register(websocket)

                # Send welcome
                await websocket.send(json.dumps({
                    "type": "welcome",
                    "version": 1,
                    "clientId": client_id,
                }))

            elif msg_type == "ping":
                await websocket.send(json.dumps({
                    "type": "pong",
                }))

            elif msg_type == "subscribe":
                # Optional: filter events by type
                # For now, all clients receive all events
                await websocket.send(json.dumps({
                    "type": "subscribed",
                    "topics": data.get("topics", ["*"]),
                }))

            elif msg_type == "packet":
                await websocket.send(json.dumps({
                    "type": "error",
                    "code": "unsupported_message",
                    "message": (
                        "Scan packets must use the dedicated airqr-scan "
                        "WebSocket endpoint"
                    ),
                    "fatal": False,
                }))

            else:
                logger.warning("Unknown message type: %s", msg_type)

    except Exception as e:
        logger.debug("WebSocket connection ended: %s", e)

    finally:
        if client_id:
            hub.unregister(client_id)


class HybridEventHub:
    """Broadcasts events to both SSE and WebSocket clients.

    This provides a unified interface for publishing events that will
    be sent to both legacy SSE clients and modern WebSocket clients.
    """

    def __init__(
        self,
        sse_hub: Any,  # EventHub - avoid circular import
        ws_hub: Optional[WebSocketEventHub] = None,
    ) -> None:
        self.sse_hub = sse_hub
        self.ws_hub = ws_hub
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    def publish(self, event_type: str, payload: Any) -> None:
        """Publish an event to both SSE and WebSocket clients."""
        # Publish to SSE (synchronous)
        self.sse_hub.publish(event_type, payload)

        # Publish to WebSocket (async in background)
        if self.ws_hub and self.ws_hub.client_count > 0:
            self._broadcast_ws(event_type, payload)

    def _broadcast_ws(self, event_type: str, payload: Any) -> None:
        """Broadcast to WebSocket clients in background."""
        self.ws_hub.broadcast_threadsafe(event_type, payload)
