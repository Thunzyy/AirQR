"""SQLite database connection and initialization."""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Generator

# Schema SQL - embedded for single-file deployment
SCHEMA_SQL = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    device_id TEXT NOT NULL UNIQUE,
    label TEXT,
    user_agent TEXT,
    last_seen_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS history_items (
    id TEXT PRIMARY KEY,
    origin TEXT NOT NULL DEFAULT 'generated' CHECK (origin IN ('generated', 'scanned')),
    title TEXT,
    filename TEXT NOT NULL,
    mime_type TEXT DEFAULT 'application/octet-stream',
    size INTEGER NOT NULL DEFAULT 0,
    file_path TEXT,
    total_frames INTEGER,
    min_frames INTEGER,
    chunk_min_frames INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_history_created ON history_items(created_at);
CREATE INDEX IF NOT EXISTS idx_history_updated ON history_items(updated_at);
CREATE INDEX IF NOT EXISTS idx_history_origin ON history_items(origin);
CREATE INDEX IF NOT EXISTS idx_history_deleted ON history_items(deleted_at);

CREATE TABLE IF NOT EXISTS scan_sessions (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'complete', 'failed', 'expired')),
    expected_packets INTEGER,
    received_count INTEGER NOT NULL DEFAULT 0,
    last_contiguous INTEGER NOT NULL DEFAULT -1,
    filename TEXT,
    mime_type TEXT DEFAULT 'application/octet-stream',
    size INTEGER,
    file_path TEXT,
    encoding TEXT DEFAULT 'raptorq',
    packet_size INTEGER,
    total_chunks INTEGER,
    chunks_complete INTEGER DEFAULT 0,
    client_checksum TEXT,
    server_checksum TEXT,
    checksum_match INTEGER,
    producer_device_id TEXT,
    producer_lease_expires TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    completed_at TEXT,
    duration REAL
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON scan_sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON scan_sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON scan_sessions(updated_at);

CREATE TABLE IF NOT EXISTS packet_ranges (
    session_id TEXT NOT NULL,
    start_index INTEGER NOT NULL,
    end_index INTEGER NOT NULL,
    PRIMARY KEY (session_id, start_index),
    FOREIGN KEY (session_id) REFERENCES scan_sessions(id) ON DELETE CASCADE,
    CHECK (end_index >= start_index)
);

CREATE INDEX IF NOT EXISTS idx_ranges_session ON packet_ranges(session_id);

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    type TEXT NOT NULL,
    payload TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    priority INTEGER NOT NULL DEFAULT 0,
    retries INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    retry_after TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    started_at TEXT,
    completed_at TEXT,
    error TEXT,
    error_details TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);

CREATE TABLE IF NOT EXISTS auth_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    device_id TEXT,
    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tokens_user ON auth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_tokens_expires ON auth_tokens(expires_at);

CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

INSERT OR IGNORE INTO config (key, value) VALUES
    ('export.enabled', 'true'),
    ('export.dir', 'null'),
    ('export.scanned', 'true'),
    ('export.generated', 'true'),
    ('retention.sessions_days', '7'),
    ('retention.history_days', '30');
"""


class Database:
    """SQLite database wrapper with connection pooling."""

    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self._ensure_initialized()

    def _ensure_initialized(self) -> None:
        """Create database and schema if not exists."""
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self.db_path))
        try:
            conn.executescript(SCHEMA_SQL)
            conn.commit()
        finally:
            conn.close()

    @contextmanager
    def connection(self) -> Generator[sqlite3.Connection, None, None]:
        """Get a database connection with auto-commit/rollback."""
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
