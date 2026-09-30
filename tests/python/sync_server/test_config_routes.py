from __future__ import annotations

import json
from http import HTTPStatus
from pathlib import Path
from unittest.mock import MagicMock, patch

from sync_server.auth import AuthManager, save_user
from sync_server.exporter import ExportManager
from sync_server.handler import SyncRequestHandler
from sync_server.settings_store import SettingsStore


def _make_handler(tmp_path: Path) -> MagicMock:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")

    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.auth = AuthManager(users_file)
    handler.context.export_manager = ExportManager(tmp_path / "export_config.json", None)
    handler.context.settings_store = SettingsStore(tmp_path / "settings.json")
    handler._send_json = MagicMock()
    handler._read_json = MagicMock()
    handler._require_auth = MagicMock(return_value=True)
    handler.headers = {"Authorization": "Basic YWRtaW46YWRtaW4="}
    return handler


def test_handle_export_config_get_returns_effective_dir(tmp_path: Path) -> None:
    handler = _make_handler(tmp_path)
    export_dir = tmp_path / "exports"
    handler.context.export_manager.save_config(
        {
            "enabled": True,
            "exportDir": str(export_dir),
            "exportScanned": True,
            "exportGenerated": False,
        }
    )

    SyncRequestHandler._handle_export_config_get(handler)

    handler._send_json.assert_called_once()
    status, payload = handler._send_json.call_args.args
    assert status == HTTPStatus.OK
    assert payload["exportDir"] == str(export_dir)
    assert payload["effectiveDir"] == str(export_dir)
    assert payload["exportGenerated"] is False


def test_handle_export_config_post_updates_export_config(tmp_path: Path) -> None:
    handler = _make_handler(tmp_path)
    export_dir = tmp_path / "exports"
    handler._read_json.return_value = {
        "enabled": True,
        "exportDir": str(export_dir),
        "exportScanned": False,
        "exportGenerated": True,
    }

    SyncRequestHandler._handle_export_config_post(handler)

    handler._send_json.assert_called_once()
    status, payload = handler._send_json.call_args.args
    assert status == HTTPStatus.OK
    assert payload["ok"] is True
    assert payload["config"]["exportDir"] == str(export_dir)
    assert payload["config"]["exportScanned"] is False


def test_handle_export_config_post_sanitizes_export_dir_validation_errors(
    tmp_path: Path,
) -> None:
    handler = _make_handler(tmp_path)
    export_dir = tmp_path / "exports"
    handler._read_json.return_value = {
        "enabled": True,
        "exportDir": str(export_dir),
    }

    with (
        patch("pathlib.Path.mkdir", side_effect=PermissionError("Permission denied")),
        patch.object(handler.context.export_manager, "save_config", return_value=None),
    ):
        SyncRequestHandler._handle_export_config_post(handler)

    handler._send_json.assert_called_once()
    status, payload = handler._send_json.call_args.args
    assert status == HTTPStatus.OK
    assert payload["config"]["exportDirValid"] is False
    assert payload["config"]["exportDirError"] == "Export directory is not accessible"


def test_handle_settings_get_returns_current_settings(tmp_path: Path) -> None:
    handler = _make_handler(tmp_path)
    handler.context.settings_store.save(
        {
            "theme": "dark",
            "encoder": {"fps": 24},
        }
    )

    SyncRequestHandler._handle_settings_get(handler)

    handler._send_json.assert_called_once_with(
        HTTPStatus.OK,
        {
            "theme": "dark",
            "encoder": {"fps": 24},
        },
    )


def test_handle_settings_post_merges_settings(tmp_path: Path) -> None:
    handler = _make_handler(tmp_path)
    handler.context.settings_store.save(
        {
            "theme": "dark",
            "encoder": {"fps": 24, "packetSize": 256},
        }
    )
    handler._read_json.return_value = {
        "theme": "light",
        "encoder": {"fps": 30},
        "scanner": {"tryHarder": True},
    }

    SyncRequestHandler._handle_settings_post(handler)

    handler._send_json.assert_called_once()
    status, payload = handler._send_json.call_args.args
    assert status == HTTPStatus.OK
    assert payload == {
        "ok": True,
        "settings": {
            "theme": "light",
            "encoder": {"fps": 30, "packetSize": 256},
            "scanner": {"tryHarder": True},
        },
    }


def test_handle_auth_credentials_post_rejects_first_user_over_http(tmp_path: Path) -> None:
    users_file = tmp_path / "users.json"
    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.auth = AuthManager(users_file)
    handler.client_address = ("127.0.0.1", 43123)
    handler.headers = {}
    handler._send_json = MagicMock()
    handler._read_json = MagicMock(
        return_value={"username": "admin", "password": "new-password"}
    )
    handler._request_is_secure = MagicMock(return_value=False)
    handler._require_auth = MagicMock(return_value=True)

    SyncRequestHandler._handle_auth_credentials_post(handler)

    handler._read_json.assert_not_called()
    handler._require_auth.assert_not_called()
    handler._send_json.assert_called_once_with(
        HTTPStatus.FORBIDDEN,
        {
            "error": (
                "First-user HTTP setup is unavailable; bootstrap with CLI or "
                "environment credentials"
            )
        },
    )
    assert handler.context.auth.enabled is False


def test_handle_auth_credentials_post_forbids_public_first_user_setup(
    tmp_path: Path,
) -> None:
    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.auth = AuthManager(tmp_path / "users.json")
    handler._send_json = MagicMock()
    handler._read_json = MagicMock(
        return_value={"username": "attacker", "password": "seized"}
    )
    handler._require_auth = MagicMock(return_value=True)

    SyncRequestHandler._handle_auth_credentials_post(handler)

    handler._read_json.assert_not_called()
    handler._require_auth.assert_not_called()
    handler._send_json.assert_called_once_with(
        HTTPStatus.FORBIDDEN,
        {
            "error": (
                "First-user HTTP setup is unavailable; bootstrap with CLI or "
                "environment credentials"
            )
        },
    )
    assert handler.context.auth.enabled is False


def test_handle_auth_credentials_post_replaces_existing_user_after_auth(
    tmp_path: Path,
) -> None:
    handler = _make_handler(tmp_path)
    handler._read_json.return_value = {
        "username": "lucas",
        "password": "changed-password",
    }

    SyncRequestHandler._handle_auth_credentials_post(handler)

    handler._require_auth.assert_called_once()
    status, payload, _headers = handler._send_json.call_args.args
    assert status == HTTPStatus.OK
    assert payload["username"] == "lucas"
    assert handler.context.auth.authorize_basic("lucas", "changed-password") is True
    assert handler.context.auth.authorize_basic("admin", "admin") is False


def test_credentials_route_revalidates_authorization_inside_rotation_transaction(
    tmp_path: Path,
) -> None:
    handler = _make_handler(tmp_path)
    auth = handler.context.auth
    auth_b = AuthManager(auth.users_file)
    old_cookie = auth.build_session_cookie("admin", secure=False).split(";", 1)[0]
    handler.headers = {"Cookie": old_cookie}
    handler._read_json.return_value = {
        "username": "admin",
        "password": "password-a",
    }

    def authorize_then_rotate() -> bool:
        auth_b.replace_single_user("admin", "password-b")
        return True

    handler._require_auth.side_effect = authorize_then_rotate

    SyncRequestHandler._handle_auth_credentials_post(handler)

    handler._send_json.assert_called_once_with(
        HTTPStatus.UNAUTHORIZED,
        {"error": "Authorization expired; retry with current credentials"},
    )
    assert auth.authorize_basic("admin", "password-b") is True
    assert auth.authorize_basic("admin", "password-a") is False


def test_password_replacement_revokes_old_browser_tokens_but_not_basic_or_api_key(
    tmp_path: Path,
) -> None:
    handler = _make_handler(tmp_path)
    auth = handler.context.auth
    data = json.loads(auth.users_file.read_text(encoding="utf-8"))
    data["apiKeys"] = ["stable-api-key"]
    auth.users_file.write_text(json.dumps(data), encoding="utf-8")
    auth.reload()
    old_session = auth.create_session_token("admin")
    old_remember = auth.create_remember_token("admin")
    handler._read_json.return_value = {
        "username": "admin",
        "password": "changed-password",
    }

    SyncRequestHandler._handle_auth_credentials_post(handler)

    assert auth.authorize_session_token(old_session) is None
    assert auth.authorize_remember_token(old_remember) is None
    assert auth.authorize_basic("admin", "changed-password") is True
    assert auth.authorize_api_key("stable-api-key") is True
    _status, _payload, headers = handler._send_json.call_args.args
    new_tokens = [
        cookie.split(";", 1)[0].split("=", 1)[1]
        for cookie in headers["Set-Cookie"]
    ]
    assert auth.authorize_session_token(new_tokens[0]) == "admin"
    assert auth.authorize_remember_token(new_tokens[1]) == "admin"


def test_username_replacement_removes_old_username_browser_tokens(
    tmp_path: Path,
) -> None:
    handler = _make_handler(tmp_path)
    auth = handler.context.auth
    old_session = auth.create_session_token("admin")
    handler._read_json.return_value = {
        "username": "lucas",
        "password": "changed-password",
    }

    SyncRequestHandler._handle_auth_credentials_post(handler)

    assert auth.authorize_session_token(old_session) is None


def test_username_reuse_does_not_restore_old_session_or_remember_tokens(
    tmp_path: Path,
) -> None:
    handler = _make_handler(tmp_path)
    auth = handler.context.auth
    old_session = auth.create_session_token("admin")
    old_remember = auth.create_remember_token("admin")

    handler._read_json.return_value = {
        "username": "lucas",
        "password": "lucas-password",
    }
    SyncRequestHandler._handle_auth_credentials_post(handler)
    _status, _payload, first_headers = handler._send_json.call_args.args
    handler.headers = {"Cookie": first_headers["Set-Cookie"][0].split(";", 1)[0]}
    handler._send_json.reset_mock()
    handler._read_json.return_value = {
        "username": "admin",
        "password": "new-admin-password",
    }
    SyncRequestHandler._handle_auth_credentials_post(handler)

    assert auth.authorize_session_token(old_session) is None
    assert auth.authorize_remember_token(old_remember) is None
    _status, _payload, headers = handler._send_json.call_args.args
    new_tokens = [
        cookie.split(";", 1)[0].split("=", 1)[1]
        for cookie in headers["Set-Cookie"]
    ]
    assert auth.authorize_session_token(new_tokens[0]) == "admin"
    assert auth.authorize_remember_token(new_tokens[1]) == "admin"


def test_handle_auth_credentials_post_requires_auth_when_auth_is_enabled(
    tmp_path: Path,
) -> None:
    handler = _make_handler(tmp_path)
    handler._require_auth.return_value = False
    handler._read_json.return_value = {
        "username": "lucas",
        "password": "changed-password",
    }

    SyncRequestHandler._handle_auth_credentials_post(handler)

    handler._read_json.assert_not_called()
    handler._send_json.assert_not_called()
    assert handler.context.auth.authorize_basic("admin", "admin") is True
