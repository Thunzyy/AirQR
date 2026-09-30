from __future__ import annotations

import threading
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any


class DebugScanSnapshotStore:
    """Small in-memory ring buffer for opt-in scan diagnostics."""

    def __init__(
        self,
        *,
        max_snapshots_per_session: int = 120,
        retention_seconds: int = 600,
    ) -> None:
        self.max_snapshots_per_session = max(1, int(max_snapshots_per_session))
        self.retention_seconds = max(1, int(retention_seconds))
        self._snapshots: dict[str, deque[dict[str, Any]]] = {}
        self._lock = threading.Lock()

    def add_snapshot(self, session_id: str, snapshot: dict[str, Any]) -> None:
        now = datetime.now(timezone.utc)
        stored = dict(snapshot)
        stored.setdefault("sessionId", session_id)
        stored.setdefault("receivedAt", now.isoformat().replace("+00:00", "Z"))

        with self._lock:
            self._prune_locked(now)
            session_snapshots = self._snapshots.setdefault(
                session_id,
                deque(maxlen=self.max_snapshots_per_session),
            )
            session_snapshots.append(stored)

    def get_live(self, session_id: str) -> dict[str, Any]:
        now = datetime.now(timezone.utc)
        with self._lock:
            self._prune_locked(now)
            snapshots = list(self._snapshots.get(session_id, ()))

        return {
            "sessionId": session_id,
            "snapshots": snapshots,
            "count": len(snapshots),
            "maxSnapshots": self.max_snapshots_per_session,
            "retentionSeconds": self.retention_seconds,
        }

    def _prune_locked(self, now: datetime) -> None:
        cutoff = now - timedelta(seconds=self.retention_seconds)
        empty_sessions: list[str] = []
        for session_id, snapshots in self._snapshots.items():
            while snapshots:
                raw_received_at = snapshots[0].get("receivedAt")
                if not isinstance(raw_received_at, str):
                    break
                try:
                    received_at = datetime.fromisoformat(
                        raw_received_at.replace("Z", "+00:00")
                    )
                except ValueError:
                    break
                if received_at >= cutoff:
                    break
                snapshots.popleft()
            if not snapshots:
                empty_sessions.append(session_id)

        for session_id in empty_sessions:
            self._snapshots.pop(session_id, None)
