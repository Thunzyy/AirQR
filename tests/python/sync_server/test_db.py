"""Tests for database connection module."""

import sqlite3
import tempfile
from pathlib import Path

import pytest

from sync_server.db import Database


class TestDatabase:
    """Test Database class."""

    def test_create_database_initializes_schema(self, tmp_path: Path) -> None:
        """Database should create all tables on init."""
        db_path = tmp_path / "test.db"
        db = Database(db_path)

        # Check tables exist
        with db.connection() as conn:
            cursor = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            )
            tables = {row[0] for row in cursor.fetchall()}

        assert "users" in tables
        assert "history_items" in tables
        assert "scan_sessions" in tables
        assert "packet_ranges" in tables
        assert "jobs" in tables
        assert "config" in tables

    def test_connection_context_manager_commits(self, tmp_path: Path) -> None:
        """Connection context manager should auto-commit on success."""
        db_path = tmp_path / "test.db"
        db = Database(db_path)

        with db.connection() as conn:
            conn.execute(
                "INSERT INTO config (key, value) VALUES (?, ?)",
                ("test.key", '"test_value"'),
            )

        # Verify data persisted
        with db.connection() as conn:
            cursor = conn.execute("SELECT value FROM config WHERE key = ?", ("test.key",))
            row = cursor.fetchone()

        assert row is not None
        assert row[0] == '"test_value"'

    def test_connection_context_manager_rollbacks_on_error(self, tmp_path: Path) -> None:
        """Connection context manager should rollback on exception."""
        db_path = tmp_path / "test.db"
        db = Database(db_path)

        with pytest.raises(sqlite3.IntegrityError):
            with db.connection() as conn:
                conn.execute(
                    "INSERT INTO config (key, value) VALUES (?, ?)",
                    ("test.key", '"value1"'),
                )
                # This should fail - duplicate key
                conn.execute(
                    "INSERT INTO config (key, value) VALUES (?, ?)",
                    ("test.key", '"value2"'),
                )

        # Verify rollback happened
        with db.connection() as conn:
            cursor = conn.execute("SELECT COUNT(*) FROM config WHERE key = ?", ("test.key",))
            count = cursor.fetchone()[0]

        assert count == 0

    def test_wal_mode_enabled(self, tmp_path: Path) -> None:
        """Database should use WAL mode for better concurrency."""
        db_path = tmp_path / "test.db"
        db = Database(db_path)

        with db.connection() as conn:
            cursor = conn.execute("PRAGMA journal_mode")
            mode = cursor.fetchone()[0]

        assert mode.lower() == "wal"

    def test_foreign_keys_enabled(self, tmp_path: Path) -> None:
        """Database should have foreign keys enabled."""
        db_path = tmp_path / "test.db"
        db = Database(db_path)

        with db.connection() as conn:
            cursor = conn.execute("PRAGMA foreign_keys")
            enabled = cursor.fetchone()[0]

        assert enabled == 1
