"""Migration from JSON file storage to SQLite."""

from __future__ import annotations

import json
import logging
import shutil
from pathlib import Path
from typing import Any, Dict

from .sqlite_storage import SqliteStorage

logger = logging.getLogger(__name__)

SESSION_META = "session.json"
HISTORY_META = "item.json"


def load_json(path: Path) -> Dict[str, Any]:
    """Load JSON file."""
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def _has_json_to_migrate(base_dir: Path) -> bool:
    """Check if there are any JSON files that need migration."""
    history_root = base_dir / "history"
    if history_root.exists():
        for item_dir in history_root.iterdir():
            if item_dir.is_dir() and (item_dir / HISTORY_META).exists():
                return True

    sessions_root = base_dir / "sessions"
    if sessions_root.exists():
        for session_dir in sessions_root.iterdir():
            if session_dir.is_dir() and (session_dir / SESSION_META).exists():
                return True

    return False


def migrate_json_to_sqlite(base_dir: Path) -> None:
    """Migrate JSON files to SQLite database.

    After successful migration, the JSON source directories are removed
    so that subsequent starts skip migration entirely.
    """
    if not _has_json_to_migrate(base_dir):
        return

    logger.info("Migrating JSON data to SQLite...")
    storage = SqliteStorage(base_dir)
    storage.ensure_dirs()

    migrated_dirs: list[Path] = []

    # Migrate history items
    history_root = base_dir / "history"
    if history_root.exists():
        for item_dir in history_root.iterdir():
            if not item_dir.is_dir():
                continue
            meta_path = item_dir / HISTORY_META
            if not meta_path.exists():
                continue

            history_id = item_dir.name
            if storage.read_history_item(history_id) is not None:
                migrated_dirs.append(item_dir)
                continue

            try:
                data = load_json(meta_path)
                data["historyId"] = data.get("historyId", history_id)
                storage.write_history_item(history_id, data)
                migrated_dirs.append(item_dir)
                logger.info("Migrated history item: %s", history_id)
            except Exception as e:
                logger.error("Failed to migrate history item %s: %s", history_id, e)

    # Migrate scan sessions
    sessions_root = base_dir / "sessions"
    if sessions_root.exists():
        for session_dir in sessions_root.iterdir():
            if not session_dir.is_dir():
                continue
            meta_path = session_dir / SESSION_META
            if not meta_path.exists():
                continue

            session_id = session_dir.name
            if storage.read_session(session_id) is not None:
                migrated_dirs.append(session_dir)
                continue

            try:
                data = load_json(meta_path)
                data["sessionId"] = data.get("sessionId", session_id)

                # Convert old 'completed' boolean to 'status' string
                if data.get("completed"):
                    data["status"] = "complete"
                else:
                    data["status"] = data.get("status", "active")

                storage.write_session(session_id, data)
                migrated_dirs.append(session_dir)
                logger.info("Migrated scan session: %s", session_id)
            except Exception as e:
                logger.error("Failed to migrate session %s: %s", session_id, e)

    # Remove migrated JSON source directories
    for d in migrated_dirs:
        try:
            shutil.rmtree(d)
        except Exception as e:
            logger.warning("Could not remove migrated dir %s: %s", d, e)

    # Clean up empty parent directories
    for root in (history_root, sessions_root):
        if root.exists() and not any(root.iterdir()):
            root.rmdir()

    logger.info("Migration complete")
