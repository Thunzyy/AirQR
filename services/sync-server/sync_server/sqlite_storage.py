"""SQLite-based storage for metadata."""

from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from .db import Database
from .packet_storage import publish_packet_no_overwrite, serialized_packet_publication
from .utils import (
    confined_child_path,
    confined_id_path,
    safe_filename,
    safe_history_id,
    safe_session_id,
)


def utc_now() -> str:
    """Return current UTC time as ISO string."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class SqliteStorage:
    """SQLite-backed storage for sessions and history items."""

    def __init__(self, base_dir: Path) -> None:
        self.base_dir = base_dir
        self.db = Database(base_dir / "airqr.db")
        self.sessions_root = base_dir / "sessions"
        self.history_root = base_dir / "history"

    def ensure_dirs(self) -> None:
        """Create storage directories if they don't exist."""
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.sessions_root.mkdir(parents=True, exist_ok=True)
        self.history_root.mkdir(parents=True, exist_ok=True)

    # -------------------------------------------------------------------------
    # History Items
    # -------------------------------------------------------------------------

    def read_history_item(self, history_id: str) -> Optional[Dict[str, Any]]:
        """Read history item by ID. Returns None if not found or deleted."""
        with self.db.connection() as conn:
            cursor = conn.execute(
                """
                SELECT id, origin, title, filename, mime_type, size, file_path,
                       total_frames, min_frames, chunk_min_frames,
                       created_at, updated_at
                FROM history_items
                WHERE id = ? AND deleted_at IS NULL
                """,
                (history_id,),
            )
            row = cursor.fetchone()

        if row is None:
            return None

        return self._row_to_history_item(row)

    def write_history_item(self, history_id: str, item: Dict[str, Any]) -> None:
        """Create or update history item."""
        now = utc_now()
        # Serialize chunkMinFrames list to JSON string for SQLite storage
        chunk_min_frames = item.get("chunkMinFrames")
        chunk_min_frames_json = json.dumps(chunk_min_frames) if chunk_min_frames is not None else None

        with self.db.connection() as conn:
            conn.execute(
                """
                INSERT INTO history_items (
                    id, origin, title, filename, mime_type, size, file_path,
                    total_frames, min_frames, chunk_min_frames,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    origin = excluded.origin,
                    title = excluded.title,
                    filename = excluded.filename,
                    mime_type = excluded.mime_type,
                    size = excluded.size,
                    file_path = excluded.file_path,
                    total_frames = excluded.total_frames,
                    min_frames = excluded.min_frames,
                    chunk_min_frames = excluded.chunk_min_frames,
                    updated_at = excluded.updated_at
                """,
                (
                    history_id,
                    item.get("origin", "generated"),
                    item.get("title"),
                    item.get("filename", "file.bin"),
                    item.get("mimeType", "application/octet-stream"),
                    item.get("size", 0),
                    item.get("filePath"),
                    item.get("totalFrames"),
                    item.get("minFrames"),
                    chunk_min_frames_json,
                    item.get("createdAt", now),
                    now,
                ),
            )

    def list_history_items(self) -> List[Dict[str, Any]]:
        """List all non-deleted history items."""
        with self.db.connection() as conn:
            cursor = conn.execute(
                """
                SELECT id, origin, title, filename, mime_type, size, file_path,
                       total_frames, min_frames, chunk_min_frames,
                       created_at, updated_at
                FROM history_items
                WHERE deleted_at IS NULL
                ORDER BY updated_at DESC
                """
            )
            rows = cursor.fetchall()

        return [self._row_to_history_item(row) for row in rows]

    def delete_history_item(self, history_id: str) -> bool:
        """Soft-delete history item. Returns True if item existed."""
        now = utc_now()
        with self.db.connection() as conn:
            cursor = conn.execute(
                """
                UPDATE history_items
                SET deleted_at = ?
                WHERE id = ? AND deleted_at IS NULL
                """,
                (now, history_id),
            )
            return cursor.rowcount > 0

    def _row_to_history_item(self, row) -> Dict[str, Any]:
        """Convert database row to history item dict."""
        # Deserialize chunkMinFrames from JSON string
        chunk_min_frames_raw = row["chunk_min_frames"]
        chunk_min_frames = None
        if chunk_min_frames_raw:
            try:
                chunk_min_frames = json.loads(chunk_min_frames_raw)
            except (json.JSONDecodeError, TypeError):
                chunk_min_frames = None

        return {
            "historyId": row["id"],
            "id": row["id"],
            "origin": row["origin"],
            "title": row["title"],
            "filename": row["filename"],
            "mimeType": row["mime_type"],
            "size": row["size"],
            "filePath": row["file_path"],
            "totalFrames": row["total_frames"],
            "minFrames": row["min_frames"],
            "chunkMinFrames": chunk_min_frames,
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    # -------------------------------------------------------------------------
    # File Operations (same as before - files stay on disk)
    # -------------------------------------------------------------------------

    def history_dir(self, history_id: str) -> Path:
        """Get history item directory path."""
        return confined_id_path(
            self.history_root, history_id, safe_history_id, "history"
        )

    def history_files_dir(self, history_id: str) -> Path:
        self.history_dir(history_id)
        return confined_child_path(self.history_root, history_id, "files")

    def history_file_path(self, history_id: str, filename: str) -> Path:
        self.history_dir(history_id)
        return confined_child_path(self.history_root, history_id, "files", filename)

    def save_history_file(self, history_id: str, filename: str, file_bytes: bytes) -> Path:
        """Save file to history directory."""
        files_dir = self.history_files_dir(history_id)
        files_dir.mkdir(parents=True, exist_ok=True)
        safe_name = safe_filename(filename)
        file_path = self.history_file_path(history_id, safe_name)
        file_path.write_bytes(file_bytes)
        return file_path

    def resolve_relative_path(self, relative_path: str) -> Path:
        """Resolve relative path and validate it's within base_dir."""
        return confined_child_path(self.base_dir, relative_path)

    # -------------------------------------------------------------------------
    # Scan Sessions
    # -------------------------------------------------------------------------

    def read_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Read scan session by ID."""
        with self.db.connection() as conn:
            cursor = conn.execute(
                """
                SELECT id, status, expected_packets, received_count, last_contiguous,
                       filename, mime_type, size, file_path, encoding, packet_size,
                       total_chunks, chunks_complete, client_checksum, server_checksum,
                       checksum_match, producer_device_id, producer_lease_expires,
                       created_at, updated_at, completed_at, duration
                FROM scan_sessions
                WHERE id = ?
                """,
                (session_id,),
            )
            row = cursor.fetchone()

        if row is None:
            return None

        return self._row_to_session(row)

    def write_session(self, session_id: str, session: Dict[str, Any]) -> None:
        """Create or update scan session."""
        now = utc_now()
        with self.db.connection() as conn:
            conn.execute(
                """
                INSERT INTO scan_sessions (
                    id, status, expected_packets, received_count, last_contiguous,
                    filename, mime_type, size, file_path, encoding, packet_size,
                    total_chunks, chunks_complete, client_checksum, server_checksum,
                    checksum_match, producer_device_id, producer_lease_expires,
                    created_at, updated_at, completed_at, duration
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    status = excluded.status,
                    expected_packets = excluded.expected_packets,
                    received_count = excluded.received_count,
                    last_contiguous = excluded.last_contiguous,
                    filename = excluded.filename,
                    mime_type = excluded.mime_type,
                    size = excluded.size,
                    file_path = excluded.file_path,
                    encoding = excluded.encoding,
                    packet_size = excluded.packet_size,
                    total_chunks = excluded.total_chunks,
                    chunks_complete = excluded.chunks_complete,
                    client_checksum = excluded.client_checksum,
                    server_checksum = excluded.server_checksum,
                    checksum_match = excluded.checksum_match,
                    producer_device_id = excluded.producer_device_id,
                    producer_lease_expires = excluded.producer_lease_expires,
                    updated_at = excluded.updated_at,
                    completed_at = excluded.completed_at,
                    duration = excluded.duration
                """,
                (
                    session_id,
                    session.get("status", "active"),
                    session.get("expectedPackets"),
                    session.get("receivedCount", 0),
                    session.get("lastContiguous", -1),
                    session.get("filename"),
                    session.get("mimeType", "application/octet-stream"),
                    session.get("size"),
                    session.get("filePath"),
                    session.get("encoding", "raptorq"),
                    session.get("packetSize"),
                    session.get("totalChunks"),
                    session.get("chunksCompleted", session.get("chunksComplete", 0)),
                    session.get("clientChecksum"),
                    session.get("serverChecksum"),
                    session.get("checksumMatch"),
                    session.get("producerDeviceId"),
                    session.get("producerLeaseExpires"),
                    session.get("createdAt", now),
                    now,
                    session.get("completedAt"),
                    session.get("duration"),
                ),
            )

    def list_sessions(self) -> List[Dict[str, Any]]:
        """List all scan sessions."""
        with self.db.connection() as conn:
            cursor = conn.execute(
                """
                SELECT id, status, expected_packets, received_count, last_contiguous,
                       filename, mime_type, size, file_path, encoding, packet_size,
                       total_chunks, chunks_complete, client_checksum, server_checksum,
                       checksum_match, producer_device_id, producer_lease_expires,
                       created_at, updated_at, completed_at, duration
                FROM scan_sessions
                ORDER BY updated_at DESC
                """
            )
            rows = cursor.fetchall()

        return [self._row_to_session(row) for row in rows]

    def delete_session(self, session_id: str) -> bool:
        """Delete scan session. Returns True if session existed."""
        with self.db.connection() as conn:
            cursor = conn.execute(
                "DELETE FROM scan_sessions WHERE id = ?",
                (session_id,),
            )
            deleted = cursor.rowcount > 0

        if deleted:
            # Also delete files from disk
            session_dir = self.session_dir(session_id)
            if session_dir.exists():
                shutil.rmtree(session_dir, ignore_errors=True)

        return deleted

    def _row_to_session(self, row) -> Dict[str, Any]:
        """Convert database row to session dict."""
        status = row["status"]
        completed_at = row["completed_at"]
        # Derive 'completed' from status or completedAt
        is_completed = status == "complete" or (completed_at is not None and completed_at != "")
        return {
            "sessionId": row["id"],
            "id": row["id"],
            "status": row["status"],
            "completed": is_completed,
            "expectedPackets": row["expected_packets"],
            "receivedCount": row["received_count"],
            "lastContiguous": row["last_contiguous"],
            "filename": row["filename"],
            "mimeType": row["mime_type"],
            "size": row["size"],
            "filePath": row["file_path"],
            "encoding": row["encoding"],
            "packetSize": row["packet_size"],
            "totalChunks": row["total_chunks"],
            "chunksComplete": row["chunks_complete"],
            "chunksCompleted": row["chunks_complete"],
            "clientChecksum": row["client_checksum"],
            "serverChecksum": row["server_checksum"],
            "checksumMatch": row["checksum_match"],
            "producerDeviceId": row["producer_device_id"],
            "producerLeaseExpires": row["producer_lease_expires"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "completedAt": row["completed_at"],
            "duration": row["duration"],
        }

    # -------------------------------------------------------------------------
    # Session File Operations
    # -------------------------------------------------------------------------

    def session_dir(self, session_id: str) -> Path:
        """Get session directory path."""
        return confined_id_path(
            self.sessions_root, session_id, safe_session_id, "session"
        )

    def session_packets_dir(self, session_id: str) -> Path:
        self.session_dir(session_id)
        return confined_child_path(self.sessions_root, session_id, "packets")

    def session_files_dir(self, session_id: str) -> Path:
        self.session_dir(session_id)
        return confined_child_path(self.sessions_root, session_id, "files")

    def session_file_path(self, session_id: str, filename: str) -> Path:
        self.session_dir(session_id)
        return confined_child_path(self.sessions_root, session_id, "files", filename)

    def session_packet_path(self, session_id: str, filename: str) -> Path:
        self.session_dir(session_id)
        return confined_child_path(self.sessions_root, session_id, "packets", filename)

    def save_session_packet(
        self,
        session_id: str,
        packet_bytes: bytes,
        packet_hash: str,
    ) -> tuple[Path, bool]:
        """Save packet to session directory."""
        packets_dir = self.session_packets_dir(session_id)
        packets_dir.mkdir(parents=True, exist_ok=True)
        filename = f"packet-{packet_hash}-{len(packet_bytes)}.bin"
        packet_path = self.session_packet_path(session_id, filename)
        try:
            with packet_path.open("xb") as handle:
                handle.write(packet_bytes)
            return packet_path, True
        except FileExistsError:
            return packet_path, False

    def save_session_packet_identity(
        self,
        session_id: str,
        packet_bytes: bytes,
        chunk_id: int,
        packet_index: int,
    ) -> tuple[Path, str]:
        """Persist the canonical packet identity without overwriting conflicts."""
        filename = f"packet-{int(chunk_id):04x}-{int(packet_index):08x}.bin"
        if safe_session_id(session_id) is None:
            raise ValueError("Invalid session ID")
        lock_path = self.sessions_root / session_id / "packets" / filename
        with serialized_packet_publication(lock_path):
            packets_dir = self.session_packets_dir(session_id)
            packets_dir.mkdir(parents=True, exist_ok=True)
            packet_path = self.session_packet_path(session_id, filename)
            return packet_path, publish_packet_no_overwrite(packet_path, packet_bytes)

    def save_session_file(self, session_id: str, filename: str, file_bytes: bytes) -> Path:
        """Save file to session directory."""
        files_dir = self.session_files_dir(session_id)
        files_dir.mkdir(parents=True, exist_ok=True)
        safe_name = safe_filename(filename)
        file_path = self.session_file_path(session_id, safe_name)
        file_path.write_bytes(file_bytes)
        return file_path

    def list_packets(self, session_id: str) -> Optional[List[bytes]]:
        """List all packets for a session."""
        packets_dir = self.session_packets_dir(session_id)
        if not packets_dir.exists():
            return None
        packets: List[bytes] = []
        for packet_path in sorted(packets_dir.glob("packet-*.bin")):
            packets.append(self.session_packet_path(session_id, packet_path.name).read_bytes())
        return packets

    def list_packet_entries(
        self,
        session_id: str,
    ) -> Optional[List[tuple[str, bytes]]]:
        """List stored packets together with their persisted filenames."""
        packets_dir = self.session_packets_dir(session_id)
        if not packets_dir.exists():
            return None
        entries: List[tuple[str, bytes]] = []
        for packet_path in sorted(packets_dir.glob("packet-*.bin")):
            safe_path = self.session_packet_path(session_id, packet_path.name)
            entries.append((packet_path.name, safe_path.read_bytes()))
        return entries

    def list_session_packet_names(self, session_id: str) -> List[str]:
        packets_dir = self.session_packets_dir(session_id)
        if not packets_dir.exists():
            return []
        return sorted(path.name for path in packets_dir.glob("packet-*.bin"))

    def count_packets(self, session_id: str) -> int:
        packets_dir = self.session_packets_dir(session_id)
        if not packets_dir.exists():
            return 0
        return sum(1 for _ in packets_dir.glob("packet-*.bin"))

    def list_packets_page(
        self,
        session_id: str,
        offset: int = 0,
        limit: Optional[int] = None,
    ) -> Optional[List[bytes]]:
        packets_dir = self.session_packets_dir(session_id)
        if not packets_dir.exists():
            return None

        safe_offset = max(int(offset), 0)
        packet_paths = sorted(packets_dir.glob("packet-*.bin"))
        if limit is None:
            selected_paths = packet_paths[safe_offset:]
        else:
            safe_limit = max(int(limit), 0)
            selected_paths = packet_paths[safe_offset : safe_offset + safe_limit]
        return [
            self.session_packet_path(session_id, packet_path.name).read_bytes()
            for packet_path in selected_paths
        ]

    # -------------------------------------------------------------------------
    # Packet Ranges
    # -------------------------------------------------------------------------

    def add_packet_range(self, session_id: str, start: int, end: int) -> None:
        """Add a packet range and merge with adjacent/overlapping ranges."""
        with self.db.connection() as conn:
            # Get existing ranges that might overlap or be adjacent
            cursor = conn.execute(
                """
                SELECT start_index, end_index FROM packet_ranges
                WHERE session_id = ?
                ORDER BY start_index
                """,
                (session_id,),
            )
            existing = [(row["start_index"], row["end_index"]) for row in cursor.fetchall()]

            # Add new range
            all_ranges = existing + [(start, end)]

            # Merge ranges
            merged = self._merge_ranges(all_ranges)

            # Delete old ranges and insert merged
            conn.execute("DELETE FROM packet_ranges WHERE session_id = ?", (session_id,))
            for s, e in merged:
                conn.execute(
                    "INSERT INTO packet_ranges (session_id, start_index, end_index) VALUES (?, ?, ?)",
                    (session_id, s, e),
                )

    def get_packet_ranges(self, session_id: str) -> List[tuple[int, int]]:
        """Get all packet ranges for a session."""
        with self.db.connection() as conn:
            cursor = conn.execute(
                """
                SELECT start_index, end_index FROM packet_ranges
                WHERE session_id = ?
                ORDER BY start_index
                """,
                (session_id,),
            )
            return [(row["start_index"], row["end_index"]) for row in cursor.fetchall()]

    def get_missing_ranges(self, session_id: str, expected: int) -> List[tuple[int, int]]:
        """Compute missing packet ranges given expected total."""
        ranges = self.get_packet_ranges(session_id)
        if not ranges:
            return [(0, expected - 1)] if expected > 0 else []

        missing: List[tuple[int, int]] = []

        # Check gap before first range
        if ranges[0][0] > 0:
            missing.append((0, ranges[0][0] - 1))

        # Check gaps between ranges
        for i in range(len(ranges) - 1):
            gap_start = ranges[i][1] + 1
            gap_end = ranges[i + 1][0] - 1
            if gap_start <= gap_end:
                missing.append((gap_start, gap_end))

        # Check gap after last range
        if ranges[-1][1] < expected - 1:
            missing.append((ranges[-1][1] + 1, expected - 1))

        return missing

    def get_last_contiguous(self, session_id: str) -> int:
        """Get the last packet index with no gaps before it."""
        ranges = self.get_packet_ranges(session_id)
        if not ranges:
            return -1
        if ranges[0][0] != 0:
            return -1
        return ranges[0][1]

    def _merge_ranges(self, ranges: List[tuple[int, int]]) -> List[tuple[int, int]]:
        """Merge overlapping and adjacent ranges."""
        if not ranges:
            return []

        sorted_ranges = sorted(ranges, key=lambda r: r[0])
        merged: List[tuple[int, int]] = [sorted_ranges[0]]

        for start, end in sorted_ranges[1:]:
            last_start, last_end = merged[-1]
            # Merge if overlapping or adjacent
            if start <= last_end + 1:
                merged[-1] = (last_start, max(last_end, end))
            else:
                merged.append((start, end))

        return merged
