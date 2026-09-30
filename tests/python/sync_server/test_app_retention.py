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
    monkeypatch.setattr(app, "SettingsStore", lambda *args, **kwargs: object())
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
