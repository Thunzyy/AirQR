"""Crash-safe publication helpers for canonical scan packets."""

from __future__ import annotations

import os
import errno
import tempfile
import threading
import weakref
from contextlib import contextmanager
from pathlib import Path
from typing import Literal

PacketPublishStatus = Literal["new", "duplicate", "conflict"]
_UNSUPPORTED_LINK_ERRORS = {
    errno.EOPNOTSUPP,
    errno.ENOTSUP,
    errno.EXDEV,
    errno.EPERM,
}


class _PathPublicationLock:
    def __init__(self) -> None:
        self.lock = threading.RLock()


_PATH_LOCKS_GUARD = threading.Lock()
_PATH_LOCKS: weakref.WeakValueDictionary[str, _PathPublicationLock] = (
    weakref.WeakValueDictionary()
)


@contextmanager
def serialized_packet_publication(packet_path: Path):  # type: ignore[no-untyped-def]
    key = os.path.normcase(os.path.abspath(os.fspath(packet_path)))
    with _PATH_LOCKS_GUARD:
        holder = _PATH_LOCKS.get(key)
        if holder is None:
            holder = _PathPublicationLock()
            _PATH_LOCKS[key] = holder
    with holder.lock:
        yield


def _write_all(fd: int, payload: bytes) -> None:
    view = memoryview(payload)
    written = 0
    while written < len(view):
        count = os.write(fd, view[written:])
        if count <= 0:
            raise OSError("short packet write")
        written += count


def _sync_directory(directory: Path) -> None:
    if os.name == "nt":
        return
    directory_fd = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def _existing_status(packet_path: Path, packet_bytes: bytes) -> PacketPublishStatus:
    existing = packet_path.read_bytes()
    return "duplicate" if existing == packet_bytes else "conflict"


def _rename_noreplace(temp_path: Path, packet_path: Path) -> bool:
    """Use the platform no-replace rename when it is available."""
    if os.name == "nt":
        try:
            os.rename(temp_path, packet_path)
        except FileExistsError:
            raise
        return True

    try:
        import ctypes

        libc = ctypes.CDLL(None, use_errno=True)
        renameat2 = libc.renameat2
    except (AttributeError, OSError):
        return False

    at_fdcwd = -100
    rename_noreplace = 1
    result = renameat2(
        at_fdcwd,
        os.fsencode(temp_path),
        at_fdcwd,
        os.fsencode(packet_path),
        rename_noreplace,
    )
    if result == 0:
        return True
    error = ctypes.get_errno()
    if error == errno.EEXIST:
        raise FileExistsError(error, os.strerror(error), packet_path)
    if error in _UNSUPPORTED_LINK_ERRORS or error in {errno.ENOSYS, errno.EINVAL}:
        return False
    raise OSError(error, os.strerror(error), packet_path)


def _fallback_publish(
    temp_path: Path,
    packet_path: Path,
    packet_bytes: bytes,
) -> PacketPublishStatus:
    if packet_path.exists():
        return _existing_status(packet_path, packet_bytes)
    try:
        if _rename_noreplace(temp_path, packet_path):
            _sync_directory(packet_path.parent)
            return "new"
    except FileExistsError:
        return _existing_status(packet_path, packet_bytes)

    # Last resort for filesystems without hard links or no-replace rename.
    # The keyed process lock makes the check+replace safe for all local callers.
    if packet_path.exists():
        return _existing_status(packet_path, packet_bytes)
    os.replace(temp_path, packet_path)
    _sync_directory(packet_path.parent)
    return "new"


def publish_packet_no_overwrite(
    packet_path: Path,
    packet_bytes: bytes,
) -> PacketPublishStatus:
    """Publish a fully synced packet without ever replacing its identity path."""
    packet_path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp_name = tempfile.mkstemp(
        dir=packet_path.parent,
        prefix=f".{packet_path.name}.",
        suffix=".tmp",
    )
    temp_path = Path(temp_name)
    try:
        try:
            _write_all(fd, packet_bytes)
            os.fsync(fd)
        finally:
            os.close(fd)

        with serialized_packet_publication(packet_path):
            if packet_path.exists():
                return _existing_status(packet_path, packet_bytes)
            try:
                os.link(temp_path, packet_path)
            except FileExistsError:
                return _existing_status(packet_path, packet_bytes)
            except OSError as exc:
                if exc.errno not in _UNSUPPORTED_LINK_ERRORS:
                    raise
                return _fallback_publish(temp_path, packet_path, packet_bytes)

            _sync_directory(packet_path.parent)
            return "new"
    finally:
        try:
            temp_path.unlink()
        except FileNotFoundError:
            pass
