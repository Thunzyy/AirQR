from __future__ import annotations

from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from .handler import SyncRequestHandler


def emit_history_event(
    handler: "SyncRequestHandler",
    payload: dict[str, Any],
) -> None:
    handler.context.event_hub.publish("history", payload)


def emit_event(
    handler: "SyncRequestHandler",
    event_type: str,
    payload: dict[str, Any],
) -> None:
    handler.context.event_hub.publish(event_type, payload)
    if handler.context.ws_hub and handler.context.ws_hub.client_count > 0:
        handler.context.ws_hub.broadcast_threadsafe(event_type, payload)
