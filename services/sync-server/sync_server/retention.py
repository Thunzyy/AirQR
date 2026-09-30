from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Optional, Protocol


class RetentionStorage(Protocol):
    def list_sessions(self) -> list[dict[str, Any]]: ...

    def delete_session(self, session_id: str) -> bool: ...

    def list_history_items(self) -> list[dict[str, Any]]: ...

    def delete_history_item(self, history_id: str) -> bool: ...


@dataclass(frozen=True)
class RetentionSweepResult:
    deleted_incomplete_sessions: int = 0
    deleted_history_items: int = 0


def apply_retention(
    storage: RetentionStorage,
    *,
    retention_incomplete_days: int,
    retention_history_days: int,
    now: Optional[datetime] = None,
) -> RetentionSweepResult:
    current_time = now or datetime.now(timezone.utc)
    incomplete_cutoff = current_time - timedelta(days=max(retention_incomplete_days, 0))
    history_cutoff = current_time - timedelta(days=max(retention_history_days, 0))

    deleted_incomplete_sessions = 0
    for session in storage.list_sessions():
        session_id = _session_id(session)
        if not session_id or _is_completed_session(session):
            continue

        timestamp = _entry_timestamp(session)
        if timestamp is None or timestamp >= incomplete_cutoff:
            continue

        if storage.delete_session(session_id):
            deleted_incomplete_sessions += 1

    deleted_history_items = 0
    for item in storage.list_history_items():
        history_id = _history_id(item)
        if not history_id:
            continue

        timestamp = _entry_timestamp(item)
        if timestamp is None or timestamp >= history_cutoff:
            continue

        if storage.delete_history_item(history_id):
            deleted_history_items += 1

    return RetentionSweepResult(
        deleted_incomplete_sessions=deleted_incomplete_sessions,
        deleted_history_items=deleted_history_items,
    )


def _session_id(session: dict[str, Any]) -> Optional[str]:
    value = session.get("sessionId") or session.get("id")
    if value is None:
        return None
    return str(value)


def _history_id(item: dict[str, Any]) -> Optional[str]:
    value = item.get("historyId") or item.get("id")
    if value is None:
        return None
    return str(value)


def _is_completed_session(session: dict[str, Any]) -> bool:
    if bool(session.get("completed")):
        return True
    return str(session.get("status") or "").lower() == "complete"


def _entry_timestamp(entry: dict[str, Any]) -> Optional[datetime]:
    raw = entry.get("updatedAt") or entry.get("createdAt")
    if not raw:
        return None
    return _parse_timestamp(str(raw))


def _parse_timestamp(value: str) -> Optional[datetime]:
    normalized = value.strip()
    if not normalized:
        return None

    if normalized.endswith("Z"):
        normalized = f"{normalized[:-1]}+00:00"

    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None

    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)
