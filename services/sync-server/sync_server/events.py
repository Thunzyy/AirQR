from __future__ import annotations

import json
import queue
import threading
from typing import Any, Iterable, List


class EventHub:
    def __init__(self, max_queue_size: int = 100) -> None:
        self._max_queue_size = max_queue_size
        self._lock = threading.Lock()
        self._clients: List[queue.Queue[bytes]] = []

    def subscribe(self) -> queue.Queue[bytes]:
        client_queue: queue.Queue[bytes] = queue.Queue(maxsize=self._max_queue_size)
        with self._lock:
            self._clients.append(client_queue)
        return client_queue

    def unsubscribe(self, client_queue: queue.Queue[bytes]) -> None:
        with self._lock:
            if client_queue in self._clients:
                self._clients.remove(client_queue)

    def publish(self, event: str, payload: Any) -> None:
        data = json.dumps(payload, separators=(",", ":"))
        message = f"event: {event}\ndata: {data}\n\n".encode("utf-8")
        for client in self._snapshot_clients():
            self._enqueue(client, message)

    def publish_ping(self) -> None:
        message = b": ping\n\n"
        for client in self._snapshot_clients():
            self._enqueue(client, message)

    def _snapshot_clients(self) -> Iterable[queue.Queue[bytes]]:
        with self._lock:
            return list(self._clients)

    @staticmethod
    def _enqueue(client_queue: queue.Queue[bytes], message: bytes) -> None:
        try:
            client_queue.put_nowait(message)
        except queue.Full:
            try:
                client_queue.get_nowait()
            except queue.Empty:
                return
            try:
                client_queue.put_nowait(message)
            except queue.Full:
                return
