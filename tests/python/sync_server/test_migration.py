"""Tests for JSON to SQLite migration."""

import json
from pathlib import Path

import pytest

from sync_server.migration import migrate_json_to_sqlite
from sync_server.sqlite_storage import SqliteStorage


class TestMigration:
    """Test migration from JSON files to SQLite."""

    def test_migrate_history_items(self, tmp_path: Path) -> None:
        """Should migrate history items from JSON files."""
        # Create old-style JSON structure
        history_dir = tmp_path / "history" / "item-123"
        history_dir.mkdir(parents=True)
        (history_dir / "item.json").write_text(
            json.dumps({
                "historyId": "item-123",
                "origin": "generated",
                "title": "Test File",
                "filename": "test.gif",
                "mimeType": "image/gif",
                "size": 1024,
                "filePath": "history/item-123/files/test.gif",
                "createdAt": "2024-01-01T00:00:00Z",
                "updatedAt": "2024-01-01T00:00:00Z",
            })
        )

        # Run migration
        migrate_json_to_sqlite(tmp_path)

        # Verify data in SQLite
        storage = SqliteStorage(tmp_path)
        item = storage.read_history_item("item-123")

        assert item is not None
        assert item["title"] == "Test File"
        assert item["filename"] == "test.gif"

    def test_migrate_scan_sessions(self, tmp_path: Path) -> None:
        """Should migrate scan sessions from JSON files."""
        # Create old-style JSON structure
        session_dir = tmp_path / "sessions" / "scan-456"
        session_dir.mkdir(parents=True)
        (session_dir / "session.json").write_text(
            json.dumps({
                "sessionId": "scan-456",
                "completed": True,
                "filename": "document.pdf",
                "mimeType": "application/pdf",
                "size": 2048,
                "filePath": "sessions/scan-456/files/document.pdf",
                "createdAt": "2024-01-01T00:00:00Z",
                "updatedAt": "2024-01-01T00:00:00Z",
            })
        )

        # Run migration
        migrate_json_to_sqlite(tmp_path)

        # Verify data in SQLite
        storage = SqliteStorage(tmp_path)
        session = storage.read_session("scan-456")

        assert session is not None
        assert session["filename"] == "document.pdf"
        assert session["status"] == "complete"

    def test_migration_is_idempotent(self, tmp_path: Path) -> None:
        """Should be safe to run migration multiple times."""
        # Create old-style JSON structure
        history_dir = tmp_path / "history" / "item-123"
        history_dir.mkdir(parents=True)
        (history_dir / "item.json").write_text(
            json.dumps({"historyId": "item-123", "filename": "test.gif"})
        )

        # Run migration twice
        migrate_json_to_sqlite(tmp_path)
        migrate_json_to_sqlite(tmp_path)

        # Should still have exactly one item
        storage = SqliteStorage(tmp_path)
        items = storage.list_history_items()

        assert len(items) == 1

    def test_skip_already_migrated(self, tmp_path: Path) -> None:
        """Should skip items already in SQLite."""
        # Create SQLite entry first
        storage = SqliteStorage(tmp_path)
        storage.write_history_item("item-123", {"historyId": "item-123", "filename": "original.gif"})

        # Create JSON file with different data
        history_dir = tmp_path / "history" / "item-123"
        history_dir.mkdir(parents=True, exist_ok=True)
        (history_dir / "item.json").write_text(
            json.dumps({"historyId": "item-123", "filename": "new.gif"})
        )

        # Run migration
        migrate_json_to_sqlite(tmp_path)

        # Should keep original SQLite data
        item = storage.read_history_item("item-123")
        assert item["filename"] == "original.gif"
