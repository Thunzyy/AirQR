from __future__ import annotations

import argparse
import json

import pytest

import server
from server import (
    bootstrap_auth_from_env,
    build_config,
    validate_config,
)
from sync_server.auth import AuthManager, hash_password, save_user


def _args(tmp_path, **overrides) -> argparse.Namespace:
    values = {
        "config": None,
        "host": None,
        "port": None,
        "storage_dir": str(tmp_path / "storage"),
        "static_dir": None,
        "users_file": str(tmp_path / "users.json"),
        "allow_origin": [],
        "allow_unauthenticated": None,
        "tls_cert": None,
        "tls_key": None,
        "export_dir": None,
        "create_user": None,
        "password": None,
        "verbose": False,
        "no_sqlite": False,
        "ws_port": None,
        "retention_incomplete": None,
        "retention_history": None,
        "trusted_proxy": [],
    }
    values.update(overrides)
    return argparse.Namespace(**values)


def test_build_config_keeps_same_port_websocket_listener(tmp_path) -> None:
    args = _args(
        tmp_path,
        host="127.0.0.1",
        port=9090,
        users_file=None,
        ws_port=9090,
    )

    config = build_config(args)

    assert config.port == 9090
    assert config.ws_port == 9090
    assert config.allowed_origins == []
    assert config.trusted_proxies == []


def test_build_config_defaults_to_same_port_websocket_listener(tmp_path) -> None:
    args = _args(
        tmp_path,
        users_file=None,
    )

    config = build_config(args)

    assert config.allowed_origins == []
    assert config.port == 8081
    assert config.ws_port == 8081
    assert config.trusted_proxies == []


def test_build_config_keeps_trusted_proxy_ranges(tmp_path) -> None:
    args = _args(
        tmp_path,
        host="127.0.0.1",
        port=9090,
        users_file=None,
        ws_port=9090,
        trusted_proxy=["127.0.0.1/32", "10.0.0.0/8"],
    )

    config = build_config(args)

    assert config.trusted_proxies == ["127.0.0.1/32", "10.0.0.0/8"]


def test_build_config_rejects_retired_first_user_http_setup_option(tmp_path) -> None:
    config_path = tmp_path / "server.json"
    config_path.write_text(
        json.dumps({"allow_first_user_setup": True}),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="first-user HTTP setup was removed"):
        build_config(_args(tmp_path, config=str(config_path)))


def test_validate_config_rejects_missing_tls_certificate(tmp_path) -> None:
    args = _args(
        tmp_path,
        storage_dir=None,
        users_file=None,
        tls_cert=str(tmp_path / "missing-cert.pem"),
        tls_key=str(tmp_path / "existing-key.pem"),
    )
    (tmp_path / "existing-key.pem").write_text("dummy key", encoding="utf-8")

    config = build_config(args)

    with pytest.raises(ValueError, match="TLS certificate file not found"):
        validate_config(config)


def test_validate_config_rejects_invalid_trusted_proxy_range(tmp_path) -> None:
    args = _args(
        tmp_path,
        storage_dir=None,
        users_file=None,
        trusted_proxy=["definitely-not-a-network"],
    )

    config = build_config(args)

    with pytest.raises(ValueError, match="Invalid trusted proxy"):
        validate_config(config)


def test_bootstrap_auth_from_env_creates_missing_user(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    users_file = tmp_path / "users.json"
    args = _args(
        tmp_path,
        users_file=str(users_file),
    )
    config = build_config(args)
    monkeypatch.setenv("AIRQR_BOOTSTRAP_USERNAME", "admin")
    monkeypatch.setenv("AIRQR_BOOTSTRAP_PASSWORD", "secret123")

    changed = bootstrap_auth_from_env(config)

    assert changed is True
    auth = AuthManager(users_file)
    assert auth.authorize_basic("admin", "secret123") is True


def test_bootstrap_auth_from_env_does_not_overwrite_existing_user(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    users_file = tmp_path / "users.json"
    args = _args(
        tmp_path,
        users_file=str(users_file),
    )
    config = build_config(args)
    monkeypatch.setenv("AIRQR_BOOTSTRAP_USERNAME", "admin")
    monkeypatch.setenv("AIRQR_BOOTSTRAP_PASSWORD", "secret123")
    assert bootstrap_auth_from_env(config) is True

    monkeypatch.setenv("AIRQR_BOOTSTRAP_PASSWORD", "new-password")

    changed = bootstrap_auth_from_env(config)

    assert changed is False
    auth = AuthManager(users_file)
    assert auth.authorize_basic("admin", "secret123") is True
    assert auth.authorize_basic("admin", "new-password") is False


def test_bootstrap_auth_from_env_does_not_recreate_rotated_username(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    users_file = tmp_path / "users.json"
    config = build_config(_args(tmp_path, users_file=str(users_file)))
    monkeypatch.setenv("AIRQR_BOOTSTRAP_USERNAME", "admin")
    monkeypatch.setenv("AIRQR_BOOTSTRAP_PASSWORD", "secret123")
    assert bootstrap_auth_from_env(config) is True

    AuthManager(users_file).replace_single_user("lucas", "rotated-password")

    assert bootstrap_auth_from_env(config) is False
    restarted_auth = AuthManager(users_file)
    assert restarted_auth.authorize_basic("lucas", "rotated-password") is True
    assert restarted_auth.authorize_basic("admin", "secret123") is False


def test_bootstrap_auth_from_env_requires_username_and_password(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    args = _args(
        tmp_path,
        users_file=str(tmp_path / "users.json"),
    )
    config = build_config(args)
    monkeypatch.setenv("AIRQR_BOOTSTRAP_USERNAME", "admin")
    monkeypatch.delenv("AIRQR_BOOTSTRAP_PASSWORD", raising=False)

    with pytest.raises(ValueError, match="AIRQR_BOOTSTRAP_USERNAME and AIRQR_BOOTSTRAP_PASSWORD"):
        bootstrap_auth_from_env(config)


def test_bootstrap_auth_from_env_does_nothing_when_any_valid_principal_exists(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    users_file = tmp_path / "users.json"
    users_file.write_text(
        json.dumps(
            {
                "users": [
                    "bad",
                    {
                        "username": "existing",
                        "passwordHash": hash_password("existing-password"),
                    },
                ],
                "apiKeys": ["existing-key"],
            }
        ),
        encoding="utf-8",
    )
    config = build_config(_args(tmp_path, users_file=str(users_file)))
    monkeypatch.setenv("AIRQR_BOOTSTRAP_USERNAME", "admin")
    monkeypatch.setenv("AIRQR_BOOTSTRAP_PASSWORD", "secret")

    assert bootstrap_auth_from_env(config) is False

    auth = AuthManager(users_file)
    assert auth.authorize_basic("existing", "existing-password") is True
    assert auth.authorize_basic("admin", "secret") is False
    assert auth.authorize_api_key("existing-key") is True


@pytest.mark.parametrize(
    "host",
    ["localhost", "LOCALHOST.", "127.0.0.1", "127.42.0.7", "::1", "[::1]"],
)
def test_is_loopback_bind_accepts_only_loopback_addresses(host: str) -> None:
    assert server.is_loopback_bind(host) is True


@pytest.mark.parametrize(
    "host",
    ["0.0.0.0", "::", "192.168.1.25", "airqr.local", ""],
)
def test_is_loopback_bind_rejects_public_or_wildcard_addresses(host: str) -> None:
    assert server.is_loopback_bind(host) is False


@pytest.mark.parametrize("host", ["0.0.0.0", "::", "192.168.1.25", "airqr.local"])
def test_public_bind_without_credentials_is_rejected(tmp_path, host: str) -> None:
    config = build_config(_args(tmp_path, host=host))

    with pytest.raises(ValueError, match="Public sync-server binds require authentication"):
        server.validate_public_auth(config)


def test_explicit_public_open_mode_is_loaded_from_cli_or_config(tmp_path) -> None:
    cli_config = build_config(_args(tmp_path, host="0.0.0.0", allow_unauthenticated=True))
    config_file = tmp_path / "server.json"
    config_file.write_text(
        json.dumps({"host": "0.0.0.0", "allow_unauthenticated": True}),
        encoding="utf-8",
    )
    file_config = build_config(_args(tmp_path, config=str(config_file)))

    assert cli_config.allow_unauthenticated is True
    assert file_config.allow_unauthenticated is True
    server.validate_public_auth(cli_config)
    server.validate_public_auth(file_config)


def test_config_requires_boolean_for_allow_unauthenticated(tmp_path) -> None:
    config_file = tmp_path / "server.json"
    config_file.write_text(
        json.dumps({"host": "0.0.0.0", "allow_unauthenticated": "false"}),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="allow_unauthenticated must be a boolean"):
        build_config(_args(tmp_path, config=str(config_file)))


def test_main_reports_invalid_allow_unauthenticated_without_traceback(
    tmp_path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    config_file = tmp_path / "server.json"
    config_file.write_text(
        json.dumps({"allow_unauthenticated": "false"}), encoding="utf-8"
    )
    monkeypatch.setattr("sys.argv", ["server.py", "--config", str(config_file)])
    monkeypatch.setattr(
        server,
        "run_server",
        lambda _config: pytest.fail("server must not start for invalid config"),
    )

    assert server.main() == 1
    assert capsys.readouterr().out == "ERROR: allow_unauthenticated must be a boolean\n"


def test_main_reports_malformed_session_secret_without_traceback(
    tmp_path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(
        "sys.argv",
        [
            "server.py",
            "--storage-dir",
            str(tmp_path / "storage"),
            "--allow-unauthenticated",
        ],
    )

    def reject_secret(_config) -> int:
        raise ValueError("Invalid session secret file")

    monkeypatch.setattr(server, "run_server", reject_secret)

    assert server.main() == 1
    assert capsys.readouterr().out == "ERROR: Invalid session secret file\n"


@pytest.mark.parametrize("host", ["localhost", "127.255.0.1", "::1"])
def test_loopback_bind_may_start_without_credentials(tmp_path, host: str) -> None:
    config = build_config(_args(tmp_path, host=host))

    server.validate_public_auth(config)


def test_existing_user_or_api_key_satisfies_public_startup(tmp_path) -> None:
    user_config = build_config(
        _args(tmp_path, host="0.0.0.0", users_file=str(tmp_path / "users.json"))
    )
    save_user(user_config.users_file, "admin", "secret")
    server.validate_public_auth(user_config)

    api_key_config = build_config(
        _args(tmp_path, host="::", users_file=str(tmp_path / "api-users.json"))
    )
    api_key_config.users_file.write_text(
        json.dumps({"users": [], "apiKeys": ["secret-key"]}), encoding="utf-8"
    )
    server.validate_public_auth(api_key_config)


def test_public_bind_rejects_user_with_malformed_password_hash(tmp_path) -> None:
    config = build_config(_args(tmp_path, host="0.0.0.0"))
    config.users_file.write_text(
        json.dumps(
            {
                "users": [
                    {"username": "admin", "passwordHash": "not-a-real-hash"}
                ],
                "apiKeys": [],
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="Public sync-server binds require authentication"):
        server.validate_public_auth(config)


def test_public_bind_with_non_object_users_database_fails_closed(tmp_path) -> None:
    config = build_config(_args(tmp_path, host="0.0.0.0"))
    config.users_file.write_text("[]", encoding="utf-8")

    with pytest.raises(ValueError, match="Public sync-server binds require authentication"):
        server.validate_public_auth(config)


@pytest.mark.parametrize("api_keys", [[""], ["   "], [None], [{"token": "key"}]])
def test_public_bind_rejects_malformed_or_empty_api_keys(
    tmp_path, api_keys: list[object]
) -> None:
    config = build_config(_args(tmp_path, host="0.0.0.0"))
    config.users_file.write_text(
        json.dumps({"users": [], "apiKeys": api_keys}), encoding="utf-8"
    )

    with pytest.raises(ValueError, match="Public sync-server binds require authentication"):
        server.validate_public_auth(config)


def test_main_validates_public_auth_after_environment_bootstrap(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    users_file = tmp_path / "users.json"
    monkeypatch.setattr(
        "sys.argv",
        [
            "server.py",
            "--host",
            "0.0.0.0",
            "--users-file",
            str(users_file),
            "--storage-dir",
            str(tmp_path / "storage"),
        ],
    )
    monkeypatch.setenv("AIRQR_BOOTSTRAP_USERNAME", "admin")
    monkeypatch.setenv("AIRQR_BOOTSTRAP_PASSWORD", "secret")
    monkeypatch.setattr(server, "run_server", lambda _config: 0)

    assert server.main() == 0
    assert AuthManager(users_file).authorize_basic("admin", "secret") is True
