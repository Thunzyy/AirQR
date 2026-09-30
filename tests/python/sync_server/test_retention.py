from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sync_server.retention import RetentionSweepResult, apply_retention


class _FakeStorage:
    def __init__(self, *, sessions: list[dict], history_items: list[dict]) -> None:
        self._sessions = sessions
        self._history_items = history_items
        self.deleted_sessions: list[str] = []
        self.deleted_history_items: list[str] = []

    def list_sessions(self) -> list[dict]:
        return list(self._sessions)

    def delete_session(self, session_id: str) -> bool:
        self.deleted_sessions.append(session_id)
        return True

    def list_history_items(self) -> list[dict]:
        return list(self._history_items)

    def delete_history_item(self, history_id: str) -> bool:
        self.deleted_history_items.append(history_id)
        return True


def _iso_at(now: datetime, *, days_ago: int) -> str:
    return (now - timedelta(days=days_ago)).strftime("%Y-%m-%dT%H:%M:%SZ")


def test_apply_retention_deletes_old_incomplete_sessions_and_expired_history() -> None:
    now = datetime(2026, 4, 5, tzinfo=timezone.utc)
    storage = _FakeStorage(
        sessions=[
            {
                "sessionId": "scan-old-incomplete",
                "status": "active",
                "completed": False,
                "updatedAt": _iso_at(now, days_ago=10),
            },
            {
                "sessionId": "scan-old-complete",
                "status": "complete",
                "completed": True,
                "updatedAt": _iso_at(now, days_ago=10),
            },
            {
                "sessionId": "scan-fresh",
                "status": "active",
                "completed": False,
                "updatedAt": _iso_at(now, days_ago=2),
            },
        ],
        history_items=[
            {
                "historyId": "history-old",
                "updatedAt": _iso_at(now, days_ago=31),
            },
            {
                "historyId": "history-fresh",
                "updatedAt": _iso_at(now, days_ago=5),
            },
        ],
    )

    result = apply_retention(
        storage,
        retention_incomplete_days=7,
        retention_history_days=30,
        now=now,
    )

    assert result == RetentionSweepResult(
        deleted_incomplete_sessions=1,
        deleted_history_items=1,
    )
    assert storage.deleted_sessions == ["scan-old-incomplete"]
    assert storage.deleted_history_items == ["history-old"]


def test_apply_retention_prefers_updated_at_over_created_at() -> None:
    now = datetime(2026, 4, 5, tzinfo=timezone.utc)
    storage = _FakeStorage(
        sessions=[
            {
                "sessionId": "scan-updated-recently",
                "status": "active",
                "completed": False,
                "createdAt": _iso_at(now, days_ago=20),
                "updatedAt": _iso_at(now, days_ago=1),
            },
        ],
        history_items=[
            {
                "historyId": "history-updated-recently",
                "createdAt": _iso_at(now, days_ago=40),
                "updatedAt": _iso_at(now, days_ago=2),
            },
        ],
    )

    result = apply_retention(
        storage,
        retention_incomplete_days=7,
        retention_history_days=30,
        now=now,
    )

    assert result == RetentionSweepResult(
        deleted_incomplete_sessions=0,
        deleted_history_items=0,
    )
    assert storage.deleted_sessions == []
    assert storage.deleted_history_items == []
