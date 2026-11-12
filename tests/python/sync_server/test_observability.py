from __future__ import annotations

from pathlib import Path

from sync_server.config import ServerConfig
from sync_server.retention import RetentionSweepResult
from sync_server.observability import format_kv_log, build_startup_summary


def test_format_kv_log_sorts_and_quotes_fields() -> None:
    message = format_kv_log(
        "server.start",
        port=8081,
        host="0.0.0.0",
        static_dir=Path("C:/airqr static"),
        ws_enabled=True,
        ws_port=8081,
        export_dir=None,
    )

    assert (
        message
        == 'server.start export_dir=null host=0.0.0.0 port=8081 static_dir="C:/airqr static" ws_enabled=true ws_port=8081'
    )


def test_build_startup_summary_includes_runtime_shape() -> None:
    config = ServerConfig(
        host="0.0.0.0",
        port=8081,
        storage_dir=Path("/data/airqr"),
        static_dir=Path("/srv/airqr/web"),
        users_file=Path("/data/airqr/users.json"),
        allowed_origins=["https://app.example.com"],
        tls_cert=Path("/certs/cert.pem"),
        tls_key=Path("/certs/key.pem"),
        export_dir=Path("/exports"),
        verbose=True,
        use_sqlite=True,
        ws_port=8081,
        retention_incomplete_days=14,
        retention_history_days=90,
        trusted_proxies=["127.0.0.1/32"],
    )

    summary = build_startup_summary(
        config=config,
        access_urls=[
            "https://localhost:8081",
            "https://192.168.1.50:8081",
        ],
        has_users_file=True,
        has_websockets=True,
        retention_result=RetentionSweepResult(
            deleted_incomplete_sessions=2,
            deleted_history_items=3,
        ),
    )

    assert summary == {
        "scheme": "https",
        "bind": "0.0.0.0:8081",
        "ws_mode": "shared",
        "storage_backend": "sqlite",
        "storage_dir": "/data/airqr",
        "static_dir": "/srv/airqr/web",
        "export_dir": "/exports",
        "auth_mode": "users-file",
        "allowed_origins": "1 configured",
        "trusted_proxies": "1 configured",
        "retention_incomplete_days": 14,
        "retention_history_days": 90,
        "retention_deleted_incomplete_sessions": 2,
        "retention_deleted_history_items": 3,
        "local_url": "https://localhost:8081",
        "lan_urls": "https://192.168.1.50:8081",
        "verbose": True,
    }
