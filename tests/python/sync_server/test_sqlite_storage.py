"""Tests for SQLite storage module."""

from pathlib import Path
import errno
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict

import pytest

from sync_server.sqlite_storage import SqliteStorage
from sync_server.storage import Storage


@pytest.mark.parametrize("storage_type", [SqliteStorage, Storage])
def test_atomic_packet_publish_cleans_partial_temp_and_allows_retry(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, storage_type: type
) -> None:
    from sync_server import packet_storage

    storage = storage_type(tmp_path)
    storage.ensure_dirs()
    original_write_all = packet_storage._write_all

    def fail_after_partial_write(fd: int, payload: bytes) -> None:
        import os

        os.write(fd, payload[:3])
        raise OSError("injected short write")

    monkeypatch.setattr(packet_storage, "_write_all", fail_after_partial_write)
    with pytest.raises(OSError, match="injected short write"):
        storage.save_session_packet_identity("atomic", b"complete-payload", 0, 1)

    canonical = storage.session_packet_path("atomic", "packet-0000-00000001.bin")
    assert not canonical.exists()
    assert list(canonical.parent.glob("*.tmp")) == []

    monkeypatch.setattr(packet_storage, "_write_all", original_write_all)
    path, status = storage.save_session_packet_identity(
        "atomic", b"complete-payload", 0, 1
    )
    assert path == canonical
    assert status == "new"
    assert canonical.read_bytes() == b"complete-payload"


@pytest.mark.parametrize("storage_type", [SqliteStorage, Storage])
def test_packet_publish_falls_back_when_hard_links_are_unsupported(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, storage_type: type
) -> None:
    import os

    storage = storage_type(tmp_path)
    storage.ensure_dirs()

    def unsupported_link(*_args: object, **_kwargs: object) -> None:
        raise OSError(errno.EOPNOTSUPP, "hard links unsupported")

    monkeypatch.setattr(os, "link", unsupported_link)
    path, status = storage.save_session_packet_identity("fallback", b"first", 0, 2)
    assert status == "new"
    assert path.read_bytes() == b"first"
    assert storage.save_session_packet_identity("fallback", b"first", 0, 2)[1] == "duplicate"
    assert storage.save_session_packet_identity("fallback", b"second", 0, 2)[1] == "conflict"
    assert path.read_bytes() == b"first"
    assert list(path.parent.glob("*.tmp")) == []


def test_packet_publish_fallback_serializes_concurrent_contenders(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import os

    storage = SqliteStorage(tmp_path)
    storage.ensure_dirs()

    def unsupported_link(*_args: object, **_kwargs: object) -> None:
        raise OSError(errno.EOPNOTSUPP, "hard links unsupported")

    monkeypatch.setattr(os, "link", unsupported_link)
    payloads = [b"alpha", b"beta"]
    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(
            executor.map(
                lambda payload: storage.save_session_packet_identity(
                    "fallback-race", payload, 0, 3
                ),
                payloads,
            )
        )

    statuses = {status for _path, status in results}
    assert statuses == {"new", "conflict"}
    target = storage.session_packet_path(
        "fallback-race", "packet-0000-00000003.bin"
    )
    assert target.read_bytes() in payloads
    assert list(target.parent.glob("*.tmp")) == []


class TestHistoryItems:
    """Test history item CRUD operations."""

    def test_write_and_read_history_item(self, tmp_path: Path) -> None:
        """Should persist and retrieve history item."""
        storage = SqliteStorage(tmp_path)
        item: Dict[str, Any] = {
            "historyId": "test-123",
            "origin": "generated",
            "title": "Test File",
            "filename": "test.gif",
            "mimeType": "image/gif",
            "size": 1024,
            "filePath": "history/test-123/files/test.gif",
        }

        storage.write_history_item("test-123", item)
        result = storage.read_history_item("test-123")

        assert result is not None
        assert result["historyId"] == "test-123"
        assert result["title"] == "Test File"
        assert result["filename"] == "test.gif"
        assert result["size"] == 1024

    def test_read_nonexistent_history_item_returns_none(self, tmp_path: Path) -> None:
        """Should return None for missing history item."""
        storage = SqliteStorage(tmp_path)
        result = storage.read_history_item("nonexistent")
        assert result is None

    def test_list_history_items(self, tmp_path: Path) -> None:
        """Should list all history items."""
        storage = SqliteStorage(tmp_path)

        storage.write_history_item("item-1", {"historyId": "item-1", "filename": "a.gif", "origin": "generated"})
        storage.write_history_item("item-2", {"historyId": "item-2", "filename": "b.gif", "origin": "scanned"})

        items = storage.list_history_items()

        assert len(items) == 2
        ids = {item["historyId"] for item in items}
        assert ids == {"item-1", "item-2"}

    def test_list_history_items_excludes_deleted(self, tmp_path: Path) -> None:
        """Should not list soft-deleted items."""
        storage = SqliteStorage(tmp_path)

        storage.write_history_item("item-1", {"historyId": "item-1", "filename": "a.gif"})
        storage.write_history_item("item-2", {"historyId": "item-2", "filename": "b.gif"})
        storage.delete_history_item("item-1")

        items = storage.list_history_items()

        assert len(items) == 1
        assert items[0]["historyId"] == "item-2"

    def test_delete_history_item(self, tmp_path: Path) -> None:
        """Should soft-delete history item."""
        storage = SqliteStorage(tmp_path)
        storage.write_history_item("item-1", {"historyId": "item-1", "filename": "a.gif"})

        result = storage.delete_history_item("item-1")

        assert result is True
        assert storage.read_history_item("item-1") is None

    def test_delete_nonexistent_returns_false(self, tmp_path: Path) -> None:
        """Should return False when deleting nonexistent item."""
        storage = SqliteStorage(tmp_path)
        result = storage.delete_history_item("nonexistent")
        assert result is False

    def test_update_history_item(self, tmp_path: Path) -> None:
        """Should update existing history item."""
        storage = SqliteStorage(tmp_path)
        storage.write_history_item("item-1", {"historyId": "item-1", "filename": "old.gif", "size": 100})

        storage.write_history_item("item-1", {"historyId": "item-1", "filename": "new.gif", "size": 200})
        result = storage.read_history_item("item-1")

        assert result is not None
        assert result["filename"] == "new.gif"
        assert result["size"] == 200


class TestScanSessions:
    """Test scan session CRUD operations."""

    def test_write_and_read_session(self, tmp_path: Path) -> None:
        """Should persist and retrieve scan session."""
        storage = SqliteStorage(tmp_path)
        session: Dict[str, Any] = {
            "sessionId": "scan-123",
            "status": "active",
            "filename": "document.pdf",
            "mimeType": "application/pdf",
            "receivedCount": 50,
            "lastContiguous": 49,
        }

        storage.write_session("scan-123", session)
        result = storage.read_session("scan-123")

        assert result is not None
        assert result["sessionId"] == "scan-123"
        assert result["status"] == "active"
        assert result["receivedCount"] == 50

    def test_read_nonexistent_session_returns_none(self, tmp_path: Path) -> None:
        """Should return None for missing session."""
        storage = SqliteStorage(tmp_path)
        result = storage.read_session("nonexistent")
        assert result is None

    def test_list_sessions(self, tmp_path: Path) -> None:
        """Should list all sessions."""
        storage = SqliteStorage(tmp_path)

        storage.write_session("scan-1", {"sessionId": "scan-1", "status": "active"})
        storage.write_session("scan-2", {"sessionId": "scan-2", "status": "complete"})

        sessions = storage.list_sessions()

        assert len(sessions) == 2
        ids = {s["sessionId"] for s in sessions}
        assert ids == {"scan-1", "scan-2"}

    def test_delete_session(self, tmp_path: Path) -> None:
        """Should delete session."""
        storage = SqliteStorage(tmp_path)
        storage.write_session("scan-1", {"sessionId": "scan-1", "status": "active"})

        result = storage.delete_session("scan-1")

        assert result is True
        assert storage.read_session("scan-1") is None

    def test_delete_nonexistent_session_returns_false(self, tmp_path: Path) -> None:
        """Should return False when deleting nonexistent session."""
        storage = SqliteStorage(tmp_path)
        result = storage.delete_session("nonexistent")
        assert result is False

    def test_update_session(self, tmp_path: Path) -> None:
        """Should update existing session."""
        storage = SqliteStorage(tmp_path)
        storage.write_session("scan-1", {"sessionId": "scan-1", "status": "active", "receivedCount": 10})

        storage.write_session("scan-1", {"sessionId": "scan-1", "status": "complete", "receivedCount": 100})
        result = storage.read_session("scan-1")

        assert result is not None
        assert result["status"] == "complete"
        assert result["receivedCount"] == 100


class TestPacketRanges:
    """Test packet range operations for resume."""

    def test_add_packet_range(self, tmp_path: Path) -> None:
        """Should add packet range to session."""
        storage = SqliteStorage(tmp_path)
        storage.write_session("scan-1", {"sessionId": "scan-1"})

        storage.add_packet_range("scan-1", 0, 10)
        ranges = storage.get_packet_ranges("scan-1")

        assert len(ranges) == 1
        assert ranges[0] == (0, 10)

    def test_get_missing_ranges(self, tmp_path: Path) -> None:
        """Should compute missing ranges."""
        storage = SqliteStorage(tmp_path)
        storage.write_session("scan-1", {"sessionId": "scan-1", "expectedPackets": 100})

        storage.add_packet_range("scan-1", 0, 10)
        storage.add_packet_range("scan-1", 20, 30)
        storage.add_packet_range("scan-1", 50, 60)

        missing = storage.get_missing_ranges("scan-1", expected=100)

        assert missing == [(11, 19), (31, 49), (61, 99)]

    def test_merge_adjacent_ranges(self, tmp_path: Path) -> None:
        """Should merge adjacent ranges."""
        storage = SqliteStorage(tmp_path)
        storage.write_session("scan-1", {"sessionId": "scan-1"})

        storage.add_packet_range("scan-1", 0, 10)
        storage.add_packet_range("scan-1", 11, 20)  # Adjacent

        ranges = storage.get_packet_ranges("scan-1")

        # Should be merged into one range
        assert len(ranges) == 1
        assert ranges[0] == (0, 20)

    def test_merge_overlapping_ranges(self, tmp_path: Path) -> None:
        """Should merge overlapping ranges."""
        storage = SqliteStorage(tmp_path)
        storage.write_session("scan-1", {"sessionId": "scan-1"})

        storage.add_packet_range("scan-1", 0, 10)
        storage.add_packet_range("scan-1", 5, 20)  # Overlapping

        ranges = storage.get_packet_ranges("scan-1")

        assert len(ranges) == 1
        assert ranges[0] == (0, 20)

    def test_get_last_contiguous(self, tmp_path: Path) -> None:
        """Should return last contiguous packet index."""
        storage = SqliteStorage(tmp_path)
        storage.write_session("scan-1", {"sessionId": "scan-1"})

        storage.add_packet_range("scan-1", 0, 50)
        storage.add_packet_range("scan-1", 100, 150)  # Gap at 51-99

        last = storage.get_last_contiguous("scan-1")

        assert last == 50

    def test_get_last_contiguous_no_ranges(self, tmp_path: Path) -> None:
        """Should return -1 when no ranges exist."""
        storage = SqliteStorage(tmp_path)
        storage.write_session("scan-1", {"sessionId": "scan-1"})

        last = storage.get_last_contiguous("scan-1")

        assert last == -1
