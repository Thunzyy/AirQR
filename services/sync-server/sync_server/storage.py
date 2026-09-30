from __future__ import annotations

import logging
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

from .packet_storage import publish_packet_no_overwrite, serialized_packet_publication

from .utils import (
    confined_child_path,
    confined_id_path,
    load_json,
    safe_filename,
    safe_history_id,
    safe_session_id,
    write_json,
)

logger = logging.getLogger(__name__)

SESSION_META = "session.json"
HISTORY_META = "item.json"


class Storage:
    def __init__(self, base_dir: Path) -> None:
        self.base_dir = base_dir
        self.sessions_root = base_dir / "sessions"
        self.history_root = base_dir / "history"

    def ensure_dirs(self) -> None:
        self.base_dir.mkdir(parents=True, exist_ok=True)
        self.sessions_root.mkdir(parents=True, exist_ok=True)
        self.history_root.mkdir(parents=True, exist_ok=True)

    def session_dir(self, session_id: str) -> Path:
        return confined_id_path(
            self.sessions_root, session_id, safe_session_id, "session"
        )

    def history_dir(self, history_id: str) -> Path:
        return confined_id_path(
            self.history_root, history_id, safe_history_id, "history"
        )

    def session_meta_path(self, session_id: str) -> Path:
        self.session_dir(session_id)
        return confined_child_path(self.sessions_root, session_id, SESSION_META)

    def history_meta_path(self, history_id: str) -> Path:
        self.history_dir(history_id)
        return confined_child_path(self.history_root, history_id, HISTORY_META)

    def session_packets_dir(self, session_id: str) -> Path:
        self.session_dir(session_id)
        return confined_child_path(self.sessions_root, session_id, "packets")

    def session_files_dir(self, session_id: str) -> Path:
        self.session_dir(session_id)
        return confined_child_path(self.sessions_root, session_id, "files")

    def history_files_dir(self, history_id: str) -> Path:
        self.history_dir(history_id)
        return confined_child_path(self.history_root, history_id, "files")

    def session_file_path(self, session_id: str, filename: str) -> Path:
        self.session_dir(session_id)
        return confined_child_path(self.sessions_root, session_id, "files", filename)

    def history_file_path(self, history_id: str, filename: str) -> Path:
        self.history_dir(history_id)
        return confined_child_path(self.history_root, history_id, "files", filename)

    def session_packet_path(self, session_id: str, filename: str) -> Path:
        self.session_dir(session_id)
        return confined_child_path(self.sessions_root, session_id, "packets", filename)

    def read_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        meta_path = self.session_meta_path(session_id)
        if not meta_path.exists():
            return None
        return load_json(meta_path)

    def write_session(self, session_id: str, session: Dict[str, Any]) -> None:
        write_json(self.session_meta_path(session_id), session)

    def read_history_item(self, history_id: str) -> Optional[Dict[str, Any]]:
        meta_path = self.history_meta_path(history_id)
        if not meta_path.exists():
            return None
        return load_json(meta_path)

    def write_history_item(self, history_id: str, item: Dict[str, Any]) -> None:
        write_json(self.history_meta_path(history_id), item)

    def save_session_packet(
        self,
        session_id: str,
        packet_bytes: bytes,
        packet_hash: str,
    ) -> tuple[Path, bool]:
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
        files_dir = self.session_files_dir(session_id)
        files_dir.mkdir(parents=True, exist_ok=True)
        safe_name = safe_filename(filename)
        file_path = self.session_file_path(session_id, safe_name)
        file_path.write_bytes(file_bytes)
        return file_path

    def save_history_file(self, history_id: str, filename: str, file_bytes: bytes) -> Path:
        files_dir = self.history_files_dir(history_id)
        files_dir.mkdir(parents=True, exist_ok=True)
        safe_name = safe_filename(filename)
        file_path = self.history_file_path(history_id, safe_name)
        file_path.write_bytes(file_bytes)
        return file_path

    def list_sessions(self) -> list[Dict[str, Any]]:
        entries: list[Dict[str, Any]] = []
        if not self.sessions_root.exists():
            return entries
        for session_path in self.sessions_root.iterdir():
            if not session_path.is_dir():
                continue
            meta_path = confined_child_path(
                self.sessions_root, session_path.name, SESSION_META
            )
            if not meta_path.exists():
                continue
            entry = load_json(meta_path)
            entry["sessionId"] = entry.get("sessionId") or session_path.name
            entries.append(entry)
        return entries

    def list_history_items(self) -> list[Dict[str, Any]]:
        entries: list[Dict[str, Any]] = []
        if not self.history_root.exists():
            return entries
        for item_dir in self.history_root.iterdir():
            if not item_dir.is_dir():
                continue
            meta_path = confined_child_path(
                self.history_root, item_dir.name, HISTORY_META
            )
            if not meta_path.exists():
                continue
            entry = load_json(meta_path)
            entry["historyId"] = entry.get("historyId") or item_dir.name
            entries.append(entry)
        return entries

    def list_packets(self, session_id: str) -> Optional[list[bytes]]:
        packets_dir = self.session_packets_dir(session_id)
        if not packets_dir.exists():
            return None
        packets: list[bytes] = []
        for packet_path in sorted(packets_dir.glob("packet-*.bin")):
            packets.append(self.session_packet_path(session_id, packet_path.name).read_bytes())
        return packets

    def list_packet_entries(
        self,
        session_id: str,
    ) -> Optional[list[tuple[str, bytes]]]:
        packets_dir = self.session_packets_dir(session_id)
        if not packets_dir.exists():
            return None
        entries: list[tuple[str, bytes]] = []
        for packet_path in sorted(packets_dir.glob("packet-*.bin")):
            safe_path = self.session_packet_path(session_id, packet_path.name)
            entries.append((packet_path.name, safe_path.read_bytes()))
        return entries

    def list_session_packet_names(self, session_id: str) -> list[str]:
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
    ) -> Optional[list[bytes]]:
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

    def resolve_relative_path(self, relative_path: str) -> Path:
        return confined_child_path(self.base_dir, relative_path)

    def delete_session(self, session_id: str) -> bool:
        session_dir = self.session_dir(session_id)
        if not session_dir.exists():
            return False
        try:
            shutil.rmtree(session_dir)
        except OSError as exc:
            logger.warning("Could not fully delete session %s: %s", session_id, exc)
        return True

    def delete_history_item(self, history_id: str) -> bool:
        item_dir = self.history_dir(history_id)
        if not item_dir.exists():
            return False
        shutil.rmtree(item_dir)
        return True
