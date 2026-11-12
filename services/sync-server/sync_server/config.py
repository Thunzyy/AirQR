from __future__ import annotations

import ipaddress
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


@dataclass(frozen=True)
class ServerConfig:
    host: str
    port: int
    storage_dir: Path
    static_dir: Optional[Path]
    users_file: Path
    allowed_origins: list[str]
    tls_cert: Optional[Path]
    tls_key: Optional[Path]
    export_dir: Optional[Path]
    verbose: bool
    use_sqlite: bool = True  # Enable SQLite storage (default)
    ws_port: Optional[int] = 8081  # WebSocket server port (same as HTTP by default)
    retention_incomplete_days: int = 7  # Days to keep incomplete sessions
    retention_history_days: int = 30  # Days to keep history items
    trusted_proxies: list[str] = field(default_factory=list)
    allow_unauthenticated: bool = False

    @property
    def scheme(self) -> str:
        return "https" if self.tls_cert and self.tls_key else "http"

    @property
    def ws_scheme(self) -> str:
        return "wss" if self.tls_cert and self.tls_key else "ws"


def is_loopback_bind(host: str) -> bool:
    """Return whether a bind host is restricted to the local machine."""
    normalized = host.strip()
    if normalized.startswith("[") and normalized.endswith("]"):
        normalized = normalized[1:-1]
    if normalized.rstrip(".").lower() == "localhost":
        return True

    address = normalized.split("%", 1)[0]
    try:
        return ipaddress.ip_address(address).is_loopback
    except ValueError:
        return False
