#!/usr/bin/env python3
"""
AirQR Scan Sync Server (stdlib only).

Features:
- POST /api/scan/packet              store packets per session
- POST /api/scan/complete            finalize a session (JSON metadata-only
                                     assembly, or raw binary body)
- GET  /api/scan/history             list scan sessions (complete + in-progress)
- GET  /api/scan/session/<id>        get session metadata (completion status)
- GET  /api/scan/session/<id>/file   download scanned file
- GET  /api/scan/session/<id>/packets download scan packets for resume
- DELETE /api/scan/session/<id>      delete scan session

- POST /api/history/item             store generated history item (raw binary body)
- GET  /api/history                  list generated + scanned history
- GET  /api/history/item/<id>/file   download generated file
- DELETE /api/history/item/<id>      delete generated history item

Auth:
- Basic auth (users.json) or API key (X-API-Key)

Storage:
- Default: ./storage (relative to this script)
- Override with --storage-dir

Export:
- Optional: --export-dir to save files in organized folders
- Structure: export-dir/scanned/YYYY-MM-DD/filename
             export-dir/generated/YYYY-MM-DD/filename
"""

from __future__ import annotations

import argparse
import ipaddress
import os
from pathlib import Path

from sync_server.app import run_server
from sync_server.auth import (
    load_auth_database,
    save_bootstrap_user_if_auth_empty,
    save_user,
)
from sync_server.config import ServerConfig, is_loopback_bind
from sync_server.config_loader import load_config_file, merge_config


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="AirQR Scan Sync Server")
    parser.add_argument(
        "--config",
        default=None,
        help="Path to config file (JSON or YAML)",
    )
    parser.add_argument("--host", default=None, help="Bind host (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=None, help="Bind port (default: 8081)")
    parser.add_argument(
        "--storage-dir",
        default=None,
        help="Where to store sessions (default: ./storage next to this script)",
    )
    parser.add_argument(
        "--static-dir",
        default=None,
        help="Optional: serve a built web app from this folder",
    )
    parser.add_argument(
        "--users-file",
        default=None,
        help="Path to users.json (default: ./users.json next to this script)",
    )
    parser.add_argument(
        "--allow-origin",
        action="append",
        default=[],
        help=(
            "Allowed CORS origin (repeatable). Use exact origins for credentialed "
            "browser access; '*' is non-credentialed only."
        ),
    )
    parser.add_argument(
        "--allow-unauthenticated",
        action="store_true",
        default=None,
        help="Explicitly allow an unauthenticated non-loopback bind",
    )
    parser.add_argument("--tls-cert", default=None, help="TLS cert path (PEM)")
    parser.add_argument("--tls-key", default=None, help="TLS key path (PEM)")
    parser.add_argument(
        "--export-dir",
        default=None,
        help="Optional: export files to organized folders (scanned/YYYY-MM-DD/, generated/YYYY-MM-DD/)",
    )
    parser.add_argument(
        "--create-user",
        default=None,
        help="Create a user in users.json and exit",
    )
    parser.add_argument(
        "--password",
        default=None,
        help="Password for --create-user",
    )
    parser.add_argument("--verbose", action="store_true", help="Verbose logging")
    parser.add_argument(
        "--no-sqlite",
        action="store_true",
        help="DEPRECATED: Use JSON files for metadata storage (legacy mode). Will be removed in v2.0.",
    )
    parser.add_argument(
        "--ws-port",
        type=int,
        default=None,
        help="WebSocket server port (default: same as --port, use 0 to disable)",
    )
    parser.add_argument(
        "--retention-incomplete",
        type=int,
        default=None,
        help="Days to keep incomplete scan sessions (default: 7)",
    )
    parser.add_argument(
        "--retention-history",
        type=int,
        default=None,
        help="Days to keep history items (default: 30)",
    )
    parser.add_argument(
        "--trusted-proxy",
        action="append",
        default=[],
        help="Trusted proxy IP or CIDR whose Forwarded/X-Forwarded-* headers are honored",
    )
    return parser


def build_config(args: argparse.Namespace) -> ServerConfig:
    base_dir = Path(__file__).parent.resolve()

    # Load config file if specified
    file_config = {}
    if args.config:
        file_config = load_config_file(Path(args.config))
        if "allow_first_user_setup" in file_config:
            raise ValueError(
                "allow_first_user_setup is unsupported because first-user HTTP setup "
                "was removed; bootstrap with CLI or environment credentials"
            )

    # Convert args to dict for merging (only non-None values override)
    cli_args = {
        "host": args.host,
        "port": args.port,
        "storage_dir": args.storage_dir,
        "static_dir": args.static_dir,
        "users_file": args.users_file,
        "allow_origin": args.allow_origin if args.allow_origin else None,
        "allow_unauthenticated": args.allow_unauthenticated,
        "tls_cert": args.tls_cert,
        "tls_key": args.tls_key,
        "export_dir": args.export_dir,
        "verbose": args.verbose if args.verbose else None,
        "no_sqlite": args.no_sqlite if args.no_sqlite else None,
        "ws_port": args.ws_port,
        "retention_incomplete_days": args.retention_incomplete,
        "retention_history_days": args.retention_history,
        "trusted_proxy": args.trusted_proxy if args.trusted_proxy else None,
    }

    # Merge: CLI overrides file config
    merged = merge_config(file_config, cli_args)

    # Apply defaults
    host = merged.get("host", "0.0.0.0")
    port = merged.get("port", 8081)
    storage_dir = Path(merged["storage_dir"]) if merged.get("storage_dir") else base_dir / "storage"
    users_file = Path(merged["users_file"]) if merged.get("users_file") else base_dir / "users.json"
    static_dir = Path(merged["static_dir"]).resolve() if merged.get("static_dir") else None
    allowed_origins = merged.get("allow_origin") or merged.get("allowed_origins") or []
    export_dir = Path(merged["export_dir"]).resolve() if merged.get("export_dir") else None
    tls_cert = Path(merged["tls_cert"]).resolve() if merged.get("tls_cert") else None
    tls_key = Path(merged["tls_key"]).resolve() if merged.get("tls_key") else None
    use_sqlite = not merged.get("no_sqlite", False)
    ws_port_val = merged.get("ws_port")
    if ws_port_val is None:
        ws_port_val = port
    ws_port = ws_port_val if ws_port_val and ws_port_val > 0 else None
    retention_incomplete = merged.get("retention_incomplete_days", 7)
    retention_history = merged.get("retention_history_days", 30)
    trusted_proxies = merged.get("trusted_proxy") or merged.get("trusted_proxies") or []
    allow_unauthenticated = merged.get("allow_unauthenticated", False)
    if not isinstance(allow_unauthenticated, bool):
        raise ValueError("allow_unauthenticated must be a boolean")
    return ServerConfig(
        host=host,
        port=port,
        storage_dir=storage_dir,
        static_dir=static_dir,
        users_file=users_file,
        allowed_origins=allowed_origins,
        tls_cert=tls_cert,
        tls_key=tls_key,
        export_dir=export_dir,
        verbose=merged.get("verbose", False),
        use_sqlite=use_sqlite,
        ws_port=ws_port,
        retention_incomplete_days=retention_incomplete,
        retention_history_days=retention_history,
        trusted_proxies=list(trusted_proxies),
        allow_unauthenticated=allow_unauthenticated,
    )


def validate_config(config: ServerConfig) -> None:
    if bool(config.tls_cert) != bool(config.tls_key):
        raise ValueError("TLS requires both --tls-cert and --tls-key")

    if config.tls_cert and not config.tls_cert.is_file():
        raise ValueError(f"TLS certificate file not found: {config.tls_cert}")

    if config.tls_key and not config.tls_key.is_file():
        raise ValueError(f"TLS private key file not found: {config.tls_key}")

    for trusted_proxy in config.trusted_proxies:
        try:
            ipaddress.ip_network(trusted_proxy, strict=False)
        except ValueError as exc:
            raise ValueError(f"Invalid trusted proxy: {trusted_proxy}") from exc


def bootstrap_auth_from_env(config: ServerConfig) -> bool:
    username = os.getenv("AIRQR_BOOTSTRAP_USERNAME", "").strip()
    password = os.getenv("AIRQR_BOOTSTRAP_PASSWORD", "")

    if not username and not password:
        return False

    if not username or not password:
        raise ValueError(
            "AIRQR_BOOTSTRAP_USERNAME and AIRQR_BOOTSTRAP_PASSWORD must both be set"
        )

    if not save_bootstrap_user_if_auth_empty(config.users_file, username, password):
        return False

    print(f"Bootstrap user '{username}' saved to {config.users_file}")
    return True


def validate_public_auth(config: ServerConfig) -> None:
    if is_loopback_bind(config.host) or config.allow_unauthenticated:
        return

    users_db = load_auth_database(config.users_file)
    has_user = bool(users_db["users"])
    has_api_key = bool(users_db["apiKeys"])
    if not has_user and not has_api_key:
        raise ValueError(
            "Public sync-server binds require authentication. Configure a user or "
            "API key, set bootstrap environment credentials, or explicitly pass "
            "--allow-unauthenticated."
        )


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        config = build_config(args)
    except ValueError as exc:
        print(f"ERROR: {exc}")
        return 1

    if args.create_user:
        if not args.password:
            print("ERROR: --password is required with --create-user")
            return 1
        save_user(config.users_file, args.create_user, args.password)
        print(f"User '{args.create_user}' saved to {config.users_file}")
        return 0

    try:
        validate_config(config)
        bootstrap_auth_from_env(config)
        validate_public_auth(config)
    except ValueError as exc:
        print(f"ERROR: {exc}")
        return 1

    try:
        return run_server(config)
    except ValueError as exc:
        print(f"ERROR: {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
