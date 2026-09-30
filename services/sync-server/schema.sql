-- AirQR Sync Server - SQLite Schema
-- Version: 1.0
-- Date: 2026-01-19
--
-- Usage:
--   sqlite3 storage/airqr.db < schema.sql
--
-- Notes:
--   - Use WAL mode for better concurrency
--   - All timestamps are ISO 8601 UTC strings
--   - Soft delete via deleted_at where applicable

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

--------------------------------------------------------------------------------
-- USERS
--------------------------------------------------------------------------------
-- Single admin model (no multi-user support for now)

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,  -- bcrypt or argon2
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);

--------------------------------------------------------------------------------
-- DEVICES (optional - for tracking connected devices)
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    device_id TEXT NOT NULL UNIQUE,  -- client-generated UUID
    label TEXT,                       -- user-friendly name
    user_agent TEXT,
    last_seen_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_devices_device_id ON devices(device_id);
CREATE INDEX IF NOT EXISTS idx_devices_last_seen ON devices(last_seen_at);

--------------------------------------------------------------------------------
-- HISTORY ITEMS (generated files uploaded to server)
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS history_items (
    id TEXT PRIMARY KEY,  -- client-generated UUID (historyId)
    origin TEXT NOT NULL DEFAULT 'generated' CHECK (origin IN ('generated', 'scanned')),
    title TEXT,
    filename TEXT NOT NULL,
    mime_type TEXT DEFAULT 'application/octet-stream',
    size INTEGER NOT NULL DEFAULT 0,
    file_path TEXT,  -- relative path from storage root

    -- Encoding metadata (for generated items)
    total_frames INTEGER,
    min_frames INTEGER,
    chunk_min_frames INTEGER,

    -- Timestamps
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    deleted_at TEXT  -- soft delete
);

CREATE INDEX IF NOT EXISTS idx_history_created ON history_items(created_at);
CREATE INDEX IF NOT EXISTS idx_history_updated ON history_items(updated_at);
CREATE INDEX IF NOT EXISTS idx_history_origin ON history_items(origin);
CREATE INDEX IF NOT EXISTS idx_history_deleted ON history_items(deleted_at);

--------------------------------------------------------------------------------
-- SCAN SESSIONS (active or completed QR scans)
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS scan_sessions (
    id TEXT PRIMARY KEY,  -- client-generated UUID (sessionId)
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'complete', 'failed', 'expired')),

    -- Packet tracking
    expected_packets INTEGER,  -- total packets expected (from meta)
    received_count INTEGER NOT NULL DEFAULT 0,
    last_contiguous INTEGER NOT NULL DEFAULT -1,  -- last packet index with no gaps before it

    -- File info (populated on complete)
    filename TEXT,
    mime_type TEXT DEFAULT 'application/octet-stream',
    size INTEGER,
    file_path TEXT,  -- relative path from storage root

    -- Encoding info
    encoding TEXT DEFAULT 'raptorq',
    packet_size INTEGER,
    total_chunks INTEGER,
    chunks_complete INTEGER DEFAULT 0,

    -- Checksums
    client_checksum TEXT,  -- checksum provided by client
    server_checksum TEXT,  -- checksum computed by server
    checksum_match INTEGER,  -- 1 = match, 0 = mismatch, NULL = not computed

    -- Producer tracking
    producer_device_id TEXT,
    producer_lease_expires TEXT,

    -- Timestamps
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    completed_at TEXT,

    -- Duration (seconds)
    duration REAL
);

CREATE INDEX IF NOT EXISTS idx_sessions_status ON scan_sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON scan_sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON scan_sessions(updated_at);
CREATE INDEX IF NOT EXISTS idx_sessions_producer ON scan_sessions(producer_device_id);

--------------------------------------------------------------------------------
-- PACKET RANGES (required - tracks received packet index ranges)
--------------------------------------------------------------------------------
-- Instead of storing each packet individually, we store contiguous ranges.
-- Example: packets 0-100, 150-200 = 2 rows: (0,100), (150,200)

CREATE TABLE IF NOT EXISTS packet_ranges (
    session_id TEXT NOT NULL,
    start_index INTEGER NOT NULL,
    end_index INTEGER NOT NULL,

    PRIMARY KEY (session_id, start_index),
    FOREIGN KEY (session_id) REFERENCES scan_sessions(id) ON DELETE CASCADE,

    CHECK (end_index >= start_index)
);

CREATE INDEX IF NOT EXISTS idx_ranges_session ON packet_ranges(session_id);

--------------------------------------------------------------------------------
-- JOBS (background worker queue)
--------------------------------------------------------------------------------
-- Simple job queue for async tasks (assembly, cleanup, export)

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    type TEXT NOT NULL,  -- 'assemble', 'cleanup', 'export', 'checksum'
    payload TEXT,        -- JSON with job-specific data

    -- Status
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    priority INTEGER NOT NULL DEFAULT 0,  -- higher = more urgent

    -- Retry handling
    retries INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    retry_after TEXT,  -- don't retry before this timestamp

    -- Timestamps
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    started_at TEXT,
    completed_at TEXT,

    -- Error info
    error TEXT,
    error_details TEXT  -- JSON with stack trace, etc.
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, priority DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_type ON jobs(type);
CREATE INDEX IF NOT EXISTS idx_jobs_retry ON jobs(status, retry_after);

--------------------------------------------------------------------------------
-- AUTH TOKENS (for JWT blacklist / refresh tracking - optional)
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS auth_tokens (
    id TEXT PRIMARY KEY,  -- JWT jti claim
    user_id TEXT NOT NULL,
    device_id TEXT,

    issued_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,  -- NULL = valid, set = revoked

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tokens_user ON auth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_tokens_expires ON auth_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_tokens_revoked ON auth_tokens(revoked_at);

--------------------------------------------------------------------------------
-- EXPORT CONFIG (server-side export settings)
--------------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,  -- JSON value
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Default config values
INSERT OR IGNORE INTO config (key, value) VALUES
    ('export.enabled', 'true'),
    ('export.dir', 'null'),
    ('export.scanned', 'true'),
    ('export.generated', 'true'),
    ('retention.sessions_days', '7'),
    ('retention.history_days', '30');

--------------------------------------------------------------------------------
-- VIEWS (convenience)
--------------------------------------------------------------------------------

-- Active sessions (not expired, not complete)
CREATE VIEW IF NOT EXISTS v_active_sessions AS
SELECT * FROM scan_sessions
WHERE status = 'active'
  AND (producer_lease_expires IS NULL OR producer_lease_expires > strftime('%Y-%m-%dT%H:%M:%SZ', 'now'));

-- History items (non-deleted)
CREATE VIEW IF NOT EXISTS v_history AS
SELECT * FROM history_items
WHERE deleted_at IS NULL
ORDER BY updated_at DESC;

-- Pending jobs
CREATE VIEW IF NOT EXISTS v_pending_jobs AS
SELECT * FROM jobs
WHERE status = 'pending'
  AND (retry_after IS NULL OR retry_after <= strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
ORDER BY priority DESC, created_at ASC;

-- Missing packet ranges for a session (computed via app logic, not SQL)
-- Use: SELECT * FROM packet_ranges WHERE session_id = ? ORDER BY start_index

--------------------------------------------------------------------------------
-- TRIGGERS
--------------------------------------------------------------------------------

-- Auto-update updated_at on history_items
CREATE TRIGGER IF NOT EXISTS trg_history_updated
AFTER UPDATE ON history_items
BEGIN
    UPDATE history_items SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE id = NEW.id;
END;

-- Auto-update updated_at on scan_sessions
CREATE TRIGGER IF NOT EXISTS trg_sessions_updated
AFTER UPDATE ON scan_sessions
BEGIN
    UPDATE scan_sessions SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE id = NEW.id;
END;

-- Auto-update updated_at on users
CREATE TRIGGER IF NOT EXISTS trg_users_updated
AFTER UPDATE ON users
BEGIN
    UPDATE users SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
    WHERE id = NEW.id;
END;

--------------------------------------------------------------------------------
-- CLEANUP QUERIES (for reference - run via job worker)
--------------------------------------------------------------------------------

-- Delete expired sessions (older than 7 days, not complete)
-- DELETE FROM scan_sessions
-- WHERE status != 'complete'
--   AND created_at < datetime('now', '-7 days');

-- Delete old history items (soft-deleted older than 30 days)
-- DELETE FROM history_items
-- WHERE deleted_at IS NOT NULL
--   AND deleted_at < datetime('now', '-30 days');

-- Delete expired auth tokens
-- DELETE FROM auth_tokens
-- WHERE expires_at < datetime('now');
