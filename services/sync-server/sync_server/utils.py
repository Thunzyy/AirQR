from __future__ import annotations

import hashlib
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from .constants import HISTORY_ID_RE, SESSION_ID_RE


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_json(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, data: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        dir=path.parent,
        prefix=f"{path.stem}.",
        suffix=".tmp",
        text=True,
    )
    tmp_path = Path(tmp_name)

    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2, sort_keys=True)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_path, path)
    except Exception:
        try:
            tmp_path.unlink(missing_ok=True)
        except Exception:
            pass
        raise


def safe_session_id(value: str) -> Optional[str]:
    if SESSION_ID_RE.match(value):
        return value
    return None


def safe_history_id(value: str) -> Optional[str]:
    if HISTORY_ID_RE.match(value):
        return value
    return None


def confined_id_path(
    root: Path,
    value: str,
    validator: Callable[[str], Optional[str]],
    label: str,
) -> Path:
    if validator(value) is None:
        raise ValueError(f"Invalid {label} ID")

    resolved_root = root.resolve()
    resolved = (resolved_root / value).resolve()
    if resolved_root not in resolved.parents:
        raise ValueError(f"Invalid {label} ID")
    return resolved


def confined_child_path(root: Path, *parts: str) -> Path:
    """Resolve a child path and reject links that leave its trusted root.

    Resolution is repeated immediately before each filesystem sink. Python's
    cross-platform path APIs cannot make the subsequent open atomic with this
    check, so the storage root must not be writable by untrusted local users.
    """
    resolved_root = root.resolve()
    resolved = root.joinpath(*parts).resolve()
    if resolved != resolved_root and resolved_root not in resolved.parents:
        raise ValueError("Invalid file path")
    return resolved


def safe_filename(value: str) -> str:
    name = os.path.basename(value.strip()) or "file.bin"
    name = name.replace("\\", "_").replace("/", "_")
    # Ensure latin-1 compatibility for HTTP headers (replace unencodable chars)
    name = name.encode("latin-1", "replace").decode("latin-1")
    return name


def compute_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]


def parse_iso_datetime(value: str) -> Optional[datetime]:
    try:
        if value.endswith("Z"):
            value = value.replace("Z", "+00:00")
        return datetime.fromisoformat(value)
    except Exception:
        return None


def get_entry_datetime(entry: Dict[str, Any]) -> Optional[datetime]:
    raw = entry.get("updatedAt") or entry.get("createdAt")
    if isinstance(raw, str):
        return parse_iso_datetime(raw)
    return None


def parse_bool(value: Optional[str], default: bool) -> bool:
    if value is None:
        return default
    lowered = value.strip().lower()
    if lowered in ("1", "true", "yes", "on"):
        return True
    if lowered in ("0", "false", "no", "off"):
        return False
    return default


def parse_limit(value: Optional[str], default: int = 500, maximum: int = 2000) -> int:
    if value is None:
        return default
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    if parsed <= 0:
        return default
    return min(parsed, maximum)


def build_history_etag(entries: list[Dict[str, Any]]) -> tuple[str, Optional[datetime]]:
    latest_dt: Optional[datetime] = None
    # Include receivedCount in ETag so incomplete scans trigger updates
    received_counts = []
    for entry in entries:
        dt = get_entry_datetime(entry)
        if dt and (latest_dt is None or dt > latest_dt):
            latest_dt = dt
        # Track received counts for incomplete sessions
        received = entry.get("receivedCount") or entry.get("received_count") or 0
        received_counts.append(received)
    latest_value = latest_dt.isoformat() if latest_dt else "none"
    received_sum = sum(received_counts)
    etag_source = f"{len(entries)}:{latest_value}:{received_sum}"
    return compute_hash(etag_source.encode("utf-8")), latest_dt
