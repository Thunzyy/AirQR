from __future__ import annotations

from pathlib import Path
from typing import Any

from .config import ServerConfig
from .retention import RetentionSweepResult


def format_kv_log(message: str, /, **fields: Any) -> str:
    if not fields:
        return message

    parts = [message]
    for key in sorted(fields):
        parts.append(f"{key}={_stringify(fields[key])}")
    return " ".join(parts)


def build_startup_summary(
    *,
    config: ServerConfig,
    access_urls: list[str],
    has_users_file: bool,
    has_websockets: bool,
    retention_result: RetentionSweepResult,
) -> dict[str, Any]:
    local_url = access_urls[0] if access_urls else None
    lan_urls = ",".join(access_urls[1:]) if len(access_urls) > 1 else None

    return {
        "scheme": config.scheme,
        "bind": f"{config.host}:{config.port}",
        "ws_mode": _ws_mode(config, has_websockets),
        "storage_backend": "sqlite" if config.use_sqlite else "json",
        "storage_dir": config.storage_dir.as_posix(),
        "static_dir": _string_or_none(config.static_dir),
        "export_dir": _string_or_none(config.export_dir),
        "auth_mode": "users-file" if has_users_file else "disabled",
        "allowed_origins": _count_label(config.allowed_origins),
        "trusted_proxies": _count_label(config.trusted_proxies),
        "retention_incomplete_days": config.retention_incomplete_days,
        "retention_history_days": config.retention_history_days,
        "retention_deleted_incomplete_sessions": (
            retention_result.deleted_incomplete_sessions
        ),
        "retention_deleted_history_items": retention_result.deleted_history_items,
        "local_url": local_url,
        "lan_urls": lan_urls,
        "verbose": config.verbose,
    }


def _ws_mode(config: ServerConfig, has_websockets: bool) -> str:
    if not has_websockets or not config.ws_port:
        return "disabled"
    if config.ws_port == config.port:
        return "shared"
    return "split"


def _count_label(values: list[str]) -> str:
    if not values:
        return "none"
    return f"{len(values)} configured"


def _string_or_none(value: Path | None) -> str | None:
    if value is None:
        return None
    return value.as_posix()


def _stringify(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, Path):
        value = value.as_posix()
    if isinstance(value, str):
        if not value:
            return '""'
        if any(char.isspace() for char in value):
            escaped = value.replace('"', '\\"')
            return f'"{escaped}"'
        return value
    return str(value)
