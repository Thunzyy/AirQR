from __future__ import annotations

from pathlib import Path

from sync_server import app
from sync_server.config import ServerConfig
from sync_server.retention import RetentionSweepResult


class _DummyStorage:
    def __init__(self, base_dir: Path) -> None:
        self.base_dir = base_dir
        self.ensure_dirs_called = False

    def ensure_dirs(self) -> None:
        self.ensure_dirs_called = True


class _DummyServer:
    def __init__(self) -> None:
        self.closed = False

    def serve_forever(self) -> None:
        raise KeyboardInterrupt()

    def server_close(self) -> None:
        self.closed = True


def test_run_server_executes_retention_sweep(monkeypatch, tmp_path: Path) -> None:
    storage = _DummyStorage(tmp_path / "storage")
    server = _DummyServer()
    retention_calls: list[tuple[object, int, int]] = []

    monkeypatch.setattr(app, "configure_logging", lambda verbose: None)
    monkeypatch.setattr(app, "migrate_json_to_sqlite", lambda storage_dir: None)
    monkeypatch.setattr(app, "SqliteStorage", lambda base_dir: storage)
    monkeypatch.setattr(app, "AuthManager", lambda *args, **kwargs: object())
    monkeypatch.setattr(app, "ExportManager", lambda *args, **kwargs: object())
    monkeypatch.setattr(app, "SettingsStore", lambda *args, **kwargs: _SettingsStoreStub({}))
    monkeypatch.setattr(app, "start_retention_scheduler", lambda sweep, interval_seconds: __import__("threading").Event())
    monkeypatch.setattr(app, "EventHub", lambda: object())
    monkeypatch.setattr(app, "create_server", lambda config, context: server)
    monkeypatch.setattr(
        app,
        "apply_retention",
        lambda storage_obj, *, retention_incomplete_days, retention_history_days: (
            retention_calls.append(
                (
                    storage_obj,
                    retention_incomplete_days,
                    retention_history_days,
                )
            )
            or RetentionSweepResult(
                deleted_incomplete_sessions=2,
                deleted_history_items=3,
            )
        ),
    )

    config = ServerConfig(
        host="127.0.0.1",
        port=8081,
        storage_dir=tmp_path / "storage",
        static_dir=None,
        users_file=tmp_path / "users.json",
        allowed_origins=[],
        tls_cert=None,
        tls_key=None,
        export_dir=None,
        verbose=False,
        use_sqlite=True,
        ws_port=None,
        retention_incomplete_days=7,
        retention_history_days=30,
    )

    result = app.run_server(config)

    assert result == 0
    assert storage.ensure_dirs_called is True
    assert retention_calls == [(storage, 7, 30)]
    assert server.closed is True


class _SettingsStoreStub:
    def __init__(self, settings: dict) -> None:
        self._settings = settings

    def load(self) -> dict:
        return dict(self._settings)


def test_run_server_uses_saved_retention_and_schedules_daily_sweeps(
    monkeypatch, tmp_path: Path
) -> None:
    storage = _DummyStorage(tmp_path / "storage")
    server = _DummyServer()
    retention_calls: list[tuple[int, object]] = []
    scheduled: list[tuple[object, float]] = []
    contexts: list[object] = []

    def fake_create_server(config, context):
        contexts.append(context)
        return server

    monkeypatch.setattr(app, "configure_logging", lambda verbose: None)
    monkeypatch.setattr(app, "migrate_json_to_sqlite", lambda storage_dir: None)
    monkeypatch.setattr(app, "SqliteStorage", lambda base_dir: storage)
    monkeypatch.setattr(app, "AuthManager", lambda *args, **kwargs: object())
    monkeypatch.setattr(app, "ExportManager", lambda *args, **kwargs: object())
    monkeypatch.setattr(
        app,
        "SettingsStore",
        lambda *args, **kwargs: _SettingsStoreStub({"retention": {"historyDays": None}}),
    )
    monkeypatch.setattr(app, "EventHub", lambda: object())
    monkeypatch.setattr(app, "create_server", fake_create_server)
    monkeypatch.setattr(
        app,
        "apply_retention",
        lambda storage_obj, *, retention_incomplete_days, retention_history_days: (
            retention_calls.append((retention_incomplete_days, retention_history_days))
            or RetentionSweepResult()
        ),
    )

    def fake_scheduler(sweep, interval_seconds):
        scheduled.append((sweep, interval_seconds))
        import threading

        return threading.Event()

    monkeypatch.setattr(app, "start_retention_scheduler", fake_scheduler)

    config = ServerConfig(
        host="127.0.0.1",
        port=8081,
        storage_dir=tmp_path / "storage",
        static_dir=None,
        users_file=tmp_path / "users.json",
        allowed_origins=[],
        tls_cert=None,
        tls_key=None,
        export_dir=None,
        verbose=False,
        use_sqlite=True,
        ws_port=None,
        retention_incomplete_days=14,
        retention_history_days=90,
    )

    assert app.run_server(config) == 0

    # The saved "never delete" setting wins over --retention-history 90.
    assert retention_calls == [(14, None)]
    assert len(scheduled) == 1
    sweep, interval = scheduled[0]
    assert interval == 24 * 60 * 60
    sweep()
    assert retention_calls == [(14, None), (14, None)]
    assert contexts[0].retention_history_default_days == 90


def test_retention_scheduler_runs_sweeps_until_stopped() -> None:
    import threading

    calls: list[int] = []
    ran_twice = threading.Event()

    def sweep() -> None:
        calls.append(1)
        if len(calls) >= 2:
            ran_twice.set()

    stop = app.start_retention_scheduler(sweep, interval_seconds=0.01)
    try:
        assert ran_twice.wait(timeout=2)
    finally:
        stop.set()
