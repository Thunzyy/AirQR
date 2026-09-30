from __future__ import annotations

import threading
import os
import tempfile
from pathlib import Path

from sync_server.utils import load_json, write_json


def test_write_json_allows_overlapping_writes_without_reusing_locked_temp_file(
    monkeypatch, tmp_path: Path
) -> None:
    target = tmp_path / "app_settings.json"
    original_open = Path.open
    active_temp_paths: set[str] = set()
    first_temp_entered = threading.Event()
    release_first_temp = threading.Event()
    temp_path_by_thread: dict[int, Path] = {}

    class GuardedHandle:
        def __init__(self, path: Path, handle, block_on_exit: bool) -> None:
            self._path = path
            self._handle = handle
            self._block_on_exit = block_on_exit

        def __getattr__(self, name: str):
            return getattr(self._handle, name)

        def __enter__(self):
            entered = self._handle.__enter__()
            active_temp_paths.add(str(self._path))
            if self._block_on_exit:
                first_temp_entered.set()
            return entered

        def __exit__(self, exc_type, exc, tb):
            if self._block_on_exit:
                release_first_temp.wait(timeout=2)
            active_temp_paths.discard(str(self._path))
            return self._handle.__exit__(exc_type, exc, tb)

    def guarded_open(self: Path, mode: str = "r", *args, **kwargs):
        if "w" in mode and self.parent == target.parent and self != target:
            path_key = str(self)
            if path_key in active_temp_paths:
                raise PermissionError(f"locked temp file: {self}")
            handle = original_open(self, mode, *args, **kwargs)
            return GuardedHandle(
                self,
                handle,
                block_on_exit=not first_temp_entered.is_set(),
            )
        return original_open(self, mode, *args, **kwargs)

    original_mkstemp = tempfile.mkstemp

    def guarded_mkstemp(*args, **kwargs):
        fd, tmp_name = original_mkstemp(*args, **kwargs)
        temp_path_by_thread[threading.get_ident()] = Path(tmp_name)
        return fd, tmp_name

    original_fdopen = os.fdopen

    def guarded_fdopen(fd: int, *args, **kwargs):
        handle = original_fdopen(fd, *args, **kwargs)
        mode = args[0] if args else kwargs.get("mode", "r")
        path = temp_path_by_thread.pop(threading.get_ident(), None)
        if path and "w" in mode and path.parent == target.parent and path != target:
            path_key = str(path)
            if path_key in active_temp_paths:
                raise PermissionError(f"locked temp file: {path}")
            return GuardedHandle(
                path,
                handle,
                block_on_exit=not first_temp_entered.is_set(),
            )
        return handle

    monkeypatch.setattr(Path, "open", guarded_open)
    monkeypatch.setattr(tempfile, "mkstemp", guarded_mkstemp)
    monkeypatch.setattr(os, "fdopen", guarded_fdopen)

    errors: list[Exception] = []

    def writer(payload: dict[str, int]) -> None:
        try:
            write_json(target, payload)
        except Exception as exc:  # pragma: no cover - asserted via errors
            errors.append(exc)

    first = threading.Thread(target=writer, args=({"value": 1},))
    second = threading.Thread(target=writer, args=({"value": 2},))

    first.start()
    assert first_temp_entered.wait(timeout=2)
    second.start()
    second.join(timeout=2)
    release_first_temp.set()
    first.join(timeout=2)

    assert errors == []
    assert load_json(target) in ({"value": 1}, {"value": 2})
