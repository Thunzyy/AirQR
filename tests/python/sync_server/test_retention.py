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


def test_apply_retention_keeps_all_history_when_history_retention_is_disabled() -> None:
    now = datetime(2026, 11, 9, tzinfo=timezone.utc)
    storage = _FakeStorage(
        sessions=[],
        history_items=[{"historyId": "history-ancient", "updatedAt": _iso_at(now, days_ago=400)}],
    )

    result = apply_retention(
        storage,
        retention_incomplete_days=14,
        retention_history_days=None,
        now=now,
    )

    assert storage.deleted_history_items == []
    assert result == RetentionSweepResult(deleted_incomplete_sessions=0, deleted_history_items=0)


def test_resolve_history_retention_prefers_the_saved_setting() -> None:
    from sync_server.retention import resolve_history_retention

    assert resolve_history_retention({"retention": {"historyDays": 45}}, default_days=90) == (45, "settings")
    assert resolve_history_retention({"retention": {"historyDays": None}}, default_days=90) == (None, "settings")


def test_resolve_history_retention_falls_back_to_the_server_default() -> None:
    from sync_server.retention import resolve_history_retention

    assert resolve_history_retention({}, default_days=90) == (90, "server-default")
    assert resolve_history_retention({"retention": {}}, default_days=90) == (90, "server-default")
    # 0 used to wipe every entry; it now means "never delete".
    assert resolve_history_retention({}, default_days=0) == (None, "server-default")
    # A corrupt saved value must not delete anything unexpected.
    assert resolve_history_retention({"retention": {"historyDays": "7"}}, default_days=90) == (90, "server-default")


def test_validate_retention_settings_accepts_days_or_never() -> None:
    from sync_server.retention import validate_retention_settings

    assert validate_retention_settings({"historyDays": 1}) is None
    assert validate_retention_settings({"historyDays": 3650}) is None
    assert validate_retention_settings({"historyDays": None}) is None


def test_validate_retention_settings_rejects_out_of_range_values() -> None:
    from sync_server.retention import validate_retention_settings

    for invalid in ({"historyDays": 0}, {"historyDays": 3651}, {"historyDays": -5},
                    {"historyDays": 1.5}, {"historyDays": True}, {"historyDays": "30"},
                    {}, {"historyDays": 30, "other": 1}, "30", None):
        assert validate_retention_settings(invalid) is not None, invalid
