from __future__ import annotations

from unittest.mock import MagicMock

from sync_server.handler import SyncRequestHandler
from sync_server.handler_events import emit_event, emit_history_event


def test_emit_history_event_publishes_only_to_history_channel() -> None:
    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.event_hub = MagicMock()
    handler.context.ws_hub = MagicMock()

    emit_history_event(handler, {"type": "scan-progress", "sessionId": "scan-1"})

    handler.context.event_hub.publish.assert_called_once_with(
        "history",
        {"type": "scan-progress", "sessionId": "scan-1"},
    )
    handler.context.ws_hub.broadcast_threadsafe.assert_not_called()


def test_emit_event_publishes_to_sse_and_websocket_when_clients_exist() -> None:
    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.event_hub = MagicMock()
    handler.context.ws_hub = MagicMock()
    handler.context.ws_hub.client_count = 2

    emit_event(handler, "scan-complete", {"sessionId": "scan-1"})

    handler.context.event_hub.publish.assert_called_once_with(
        "scan-complete",
        {"sessionId": "scan-1"},
    )
    handler.context.ws_hub.broadcast_threadsafe.assert_called_once_with(
        "scan-complete",
        {"sessionId": "scan-1"},
    )
