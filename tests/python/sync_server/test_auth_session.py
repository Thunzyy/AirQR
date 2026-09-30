from __future__ import annotations

import base64
import hashlib
import hmac
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from http import HTTPStatus
from unittest.mock import MagicMock
from unittest.mock import patch

import pytest

from sync_server.auth import (
    AuthManager,
    RateLimiter,
    REMEMBER_COOKIE_NAME,
    SESSION_COOKIE_NAME,
    client_ip_from_peer,
    hash_password,
    load_auth_database,
    save_single_user,
    save_user,
)
from sync_server.handler import SyncRequestHandler
from sync_server.utils import write_json


def test_client_ip_ignores_forwarded_headers_from_untrusted_peer() -> None:
    assert client_ip_from_peer(
        ("198.51.100.10", 443),
        headers={"X-Forwarded-For": "203.0.113.25"},
        trusted_proxies=["127.0.0.1/32"],
    ) == "198.51.100.10"


def test_client_ip_uses_validated_chain_from_trusted_proxy() -> None:
    assert client_ip_from_peer(
        ("127.0.0.1", 443),
        headers={"X-Forwarded-For": "203.0.113.25, 10.0.0.8"},
        trusted_proxies=["127.0.0.1/32", "10.0.0.0/8"],
    ) == "203.0.113.25"


def test_client_ip_falls_back_to_peer_for_malformed_forwarded_chain() -> None:
    assert client_ip_from_peer(
        ("127.0.0.1", 443),
        headers={"X-Forwarded-For": "attacker-controlled"},
        trusted_proxies=["127.0.0.1/32"],
    ) == "127.0.0.1"


def _make_handler(
    auth: AuthManager,
    *,
    headers: dict[str, str] | None = None,
    payload: dict[str, object] | None = None,
) -> MagicMock:
    handler = MagicMock(spec=SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.auth = auth
    handler.headers = headers or {}
    handler._send_json = MagicMock()
    handler._read_json = MagicMock(return_value=payload)
    handler._request_is_secure = MagicMock(return_value=False)
    handler._require_cookie_csrf = MagicMock(return_value=True)
    return handler


def _token_payload(token: str) -> dict[str, object]:
    payload = token.split(".", 1)[0]
    payload += "=" * (-len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(payload).decode("utf-8"))


def test_rate_limiter_admission_does_not_consume_failure_slots() -> None:
    limiter = RateLimiter(max_attempts=2, window_seconds=60)

    assert limiter.is_allowed("login:192.0.2.10") is True
    assert limiter.is_allowed("login:192.0.2.10") is True
    limiter.record_failure("login:192.0.2.10")
    assert limiter.is_allowed("login:192.0.2.10") is True
    limiter.record_failure("login:192.0.2.10")

    assert limiter.is_allowed("login:192.0.2.10") is False


def test_rate_limiter_expires_failures_and_reset_clears_them() -> None:
    limiter = RateLimiter(max_attempts=1, window_seconds=10)

    with patch("sync_server.auth.time.monotonic", return_value=100.0):
        limiter.record_failure("login:192.0.2.10")
        assert limiter.is_allowed("login:192.0.2.10") is False

    with patch("sync_server.auth.time.monotonic", return_value=111.0):
        assert limiter.is_allowed("login:192.0.2.10") is True
        limiter.record_failure("login:192.0.2.10")
        limiter.reset("login:192.0.2.10")
        assert limiter.is_allowed("login:192.0.2.10") is True


def test_rate_limiter_atomically_admits_only_one_concurrent_failure() -> None:
    limiter = RateLimiter(max_attempts=1, window_seconds=60)
    barrier = threading.Barrier(3)

    def record_failure() -> bool:
        barrier.wait()
        return limiter.record_failure_if_allowed("login:192.0.2.10")

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [executor.submit(record_failure) for _ in range(2)]
        barrier.wait()
        results = [future.result() for future in futures]

    assert sorted(results) == [False, True]
    assert len(limiter._attempts["login:192.0.2.10"]) == 1


def test_rate_limiter_reservation_bounds_concurrent_password_work() -> None:
    limiter = RateLimiter(max_attempts=1, window_seconds=60)

    assert limiter.try_reserve("login:192.0.2.10") is True
    assert limiter.try_reserve("login:192.0.2.10") is False
    limiter.complete_failure("login:192.0.2.10")
    assert limiter.try_reserve("login:192.0.2.10") is False

    limiter.reset("login:192.0.2.10")
    assert limiter.try_reserve("login:192.0.2.10") is True
    limiter.complete_success("login:192.0.2.10")
    assert limiter.is_allowed("login:192.0.2.10") is True


def test_rate_limiter_incrementally_sweeps_many_expired_keys() -> None:
    with patch("sync_server.auth.time.monotonic", return_value=100.0):
        limiter = RateLimiter(max_attempts=2, window_seconds=10)
        for index in range(40):
            limiter.record_failure(f"login:192.0.2.{index}")

    with patch("sync_server.auth.time.monotonic", return_value=111.0):
        assert limiter.is_allowed("login:fresh-1") is True
        assert limiter._attempts
        assert limiter.is_allowed("login:fresh-2") is True
        assert limiter.is_allowed("login:fresh-3") is True

    assert limiter._attempts == {}


def test_auth_manager_loads_legacy_user_token_version_as_zero(tmp_path) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")
    data = json.loads(users_file.read_text(encoding="utf-8"))
    data["users"][0].pop("tokenVersion", None)
    users_file.write_text(json.dumps(data), encoding="utf-8")

    auth = AuthManager(users_file)

    assert auth.token_versions == {"admin": 0}


def test_auth_database_normalization_preserves_monotonic_username_tombstones(
    tmp_path,
) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")
    data = json.loads(users_file.read_text(encoding="utf-8"))
    data["users"][0]["tokenVersion"] = 2
    data["tokenVersions"] = {
        "admin": 4,
        "removed": 7,
        "negative": -1,
        "boolean": True,
    }
    data["metadata"] = {"preserve": True}
    users_file.write_text(json.dumps(data), encoding="utf-8")

    normalized = load_auth_database(users_file)

    assert normalized["users"][0]["tokenVersion"] == 4
    assert normalized["tokenVersions"] == {"admin": 4, "removed": 7}
    assert normalized["metadata"] == {"preserve": True}


def test_save_helpers_never_reset_existing_or_reintroduced_username_version(
    tmp_path,
) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "first")
    auth = AuthManager(users_file)
    oldest_admin = auth.create_session_token("admin")

    save_user(users_file, "admin", "second")
    auth.reload()
    assert auth.authorize_session_token(oldest_admin) is None
    assert _token_payload(auth.create_session_token("admin"))["v"] == 1

    save_single_user(users_file, "lucas", "lucas-password")
    save_single_user(users_file, "admin", "third")
    auth.reload()

    assert auth.authorize_session_token(oldest_admin) is None
    assert _token_payload(auth.create_session_token("admin"))["v"] == 2


def test_signed_browser_tokens_include_and_enforce_current_version(tmp_path) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")
    auth = AuthManager(users_file)

    session = auth.create_session_token("admin")
    remember = auth.create_remember_token("admin")

    assert _token_payload(session)["v"] == 0
    assert _token_payload(remember)["v"] == 0

    payload = _token_payload(session)
    payload.pop("v")
    payload_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode()
    signature = hmac.new(auth._session_secret, payload_bytes, hashlib.sha256).digest()
    legacy_token = (
        base64.urlsafe_b64encode(payload_bytes).rstrip(b"=").decode()
        + "."
        + base64.urlsafe_b64encode(signature).rstrip(b"=").decode()
    )

    assert auth.authorize_session_token(legacy_token) is None


def test_token_version_increments_are_serialized_and_persisted(tmp_path) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")
    auth = AuthManager(users_file)

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(
            executor.map(lambda _: auth.increment_token_version("admin"), range(2))
        )

    assert results == [True, True]
    assert auth.token_versions == {"admin": 2}
    persisted = json.loads(users_file.read_text(encoding="utf-8"))
    assert persisted["users"][0]["tokenVersion"] == 2


def test_token_revocation_is_immediately_visible_to_other_manager_instances(
    tmp_path,
) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")
    auth_a = AuthManager(users_file)
    auth_b = AuthManager(users_file)
    token = auth_a.create_session_token("admin")

    assert auth_b.increment_token_version("admin") is True

    assert auth_a.authorize_session_token(token) is None


def test_stale_manager_observes_first_user_and_does_not_allow_anonymous_auth(
    tmp_path,
) -> None:
    users_file = tmp_path / "users.json"
    auth_a = AuthManager(users_file)
    auth_b = AuthManager(users_file)

    auth_b.replace_single_user("admin", "password")

    assert auth_a.enabled is True
    assert auth_a.is_authorized({}) is False
    assert auth_a.authorize_basic("admin", "password") is True


def test_stale_manager_observes_password_and_api_key_changes(tmp_path) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "old-password")
    data = load_auth_database(users_file)
    data["apiKeys"] = ["removed-api-key"]
    write_json(users_file, data)
    auth_a = AuthManager(users_file)
    auth_b = AuthManager(users_file)

    auth_b.replace_single_user("admin", "new-password")
    data = load_auth_database(users_file)
    data["apiKeys"] = ["new-api-key"]
    write_json(users_file, data)

    assert auth_a.authorize_basic("admin", "old-password") is False
    assert auth_a.authorize_basic("admin", "new-password") is True
    assert auth_a.authorize_api_key("new-api-key") is True
    assert auth_a.authorize_api_key("removed-api-key") is False


def test_simultaneous_managers_share_one_canonical_session_secret(tmp_path) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")
    secret_file = users_file.with_name(f"{users_file.name}.session-secret")
    rendezvous = threading.Barrier(2)
    original_exists = type(secret_file).exists

    def synchronized_exists(path):
        if path == secret_file:
            try:
                rendezvous.wait(timeout=0.2)
            except threading.BrokenBarrierError:
                pass
        return original_exists(path)

    with patch("pathlib.Path.exists", new=synchronized_exists):
        with ThreadPoolExecutor(max_workers=2) as executor:
            managers = list(executor.map(AuthManager, [users_file, users_file]))

    persisted_secret = secret_file.read_text(encoding="utf-8")
    assert len(persisted_secret) == 64
    assert persisted_secret == persisted_secret.lower()
    assert all(character in "0123456789abcdef" for character in persisted_secret)
    assert managers[0]._session_secret == managers[1]._session_secret
    token = managers[0].create_session_token("admin")
    assert managers[1].authorize_session_token(token) == "admin"


@pytest.mark.parametrize("invalid_secret", ["", "not-hex", "a" * 63, "g" * 64])
def test_auth_manager_rejects_malformed_session_secret(
    tmp_path, invalid_secret: str
) -> None:
    users_file = tmp_path / "users.json"
    secret_file = users_file.with_name(f"{users_file.name}.session-secret")
    secret_file.write_text(invalid_secret, encoding="utf-8")

    with pytest.raises(ValueError, match="session secret"):
        AuthManager(users_file)


def test_concurrent_manager_increments_do_not_lose_updates(tmp_path) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")
    managers = [AuthManager(users_file), AuthManager(users_file)]
    rendezvous = threading.Barrier(2)
    from sync_server.auth import _load_auth_database_unlocked as real_load_auth_database

    def synchronized_load(path):
        data = real_load_auth_database(path)
        try:
            rendezvous.wait(timeout=0.2)
        except threading.BrokenBarrierError:
            pass
        return data

    with patch(
        "sync_server.auth._load_auth_database_unlocked", side_effect=synchronized_load
    ):
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(
                executor.map(
                    lambda manager: manager.increment_token_version("admin"),
                    managers,
                )
            )

    assert results == [True, True]
    persisted = load_auth_database(users_file)
    assert persisted["tokenVersions"]["admin"] == 2


def test_normalization_deduplicates_usernames_and_increment_updates_canonical_record(
    tmp_path,
) -> None:
    users_file = tmp_path / "users.json"
    users_file.write_text(
        json.dumps(
            {
                "users": [
                    {
                        "username": "admin",
                        "passwordHash": hash_password("old-password"),
                        "tokenVersion": 2,
                    },
                    {
                        "username": "admin",
                        "passwordHash": hash_password("effective-password"),
                        "tokenVersion": 4,
                    },
                ],
                "tokenVersions": {"admin": 3},
                "apiKeys": [],
            }
        ),
        encoding="utf-8",
    )
    normalized = load_auth_database(users_file)
    auth = AuthManager(users_file)
    old_token = auth.create_session_token("admin")

    assert len(normalized["users"]) == 1
    assert auth.authorize_basic("admin", "effective-password") is True
    assert auth.increment_token_version("admin") is True

    persisted = load_auth_database(users_file)
    assert len(persisted["users"]) == 1
    assert persisted["users"][0]["tokenVersion"] == 5
    assert auth.authorize_session_token(old_token) is None


def test_atomic_login_tokens_cannot_survive_concurrent_password_rotation(
    tmp_path,
) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "old-password")
    login_auth = AuthManager(users_file)
    rotation_auth = AuthManager(users_file)
    signing_started = threading.Event()
    rotation_started = threading.Event()
    original_create = login_auth._create_signed_token

    def pause_during_signing(*args, **kwargs):
        signing_started.set()
        assert rotation_started.wait(timeout=2)
        return original_create(*args, **kwargs)

    def rotate_password() -> None:
        assert signing_started.wait(timeout=2)
        rotation_started.set()
        rotation_auth.replace_single_user("admin", "new-password")

    with patch.object(login_auth, "_create_signed_token", side_effect=pause_during_signing):
        with ThreadPoolExecutor(max_workers=2) as executor:
            rotation = executor.submit(rotate_password)
            cookies = login_auth.authenticate_and_build_cookies(
                "admin", "old-password", secure=False, remember=True
            )
            rotation.result(timeout=2)

    assert cookies is not None
    fresh_auth = AuthManager(users_file)
    tokens = [cookie.split(";", 1)[0].split("=", 1)[1] for cookie in cookies]
    assert fresh_auth.authorize_session_token(tokens[0]) is None
    assert fresh_auth.authorize_remember_token(tokens[1]) is None


def test_transactional_credential_rotations_revoke_earlier_rotation_cookies(
    tmp_path,
) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "old-password")
    auth_a = AuthManager(users_file)
    auth_b = AuthManager(users_file)
    old_token = auth_a.create_session_token("admin")

    cookies_a = auth_a.replace_authorized_user_and_build_cookies(
        {"Cookie": f"{SESSION_COOKIE_NAME}={old_token}"},
        "admin",
        "password-a",
        secure=False,
    )
    basic_b = base64.b64encode(b"admin:password-a").decode("ascii")
    cookies_b = auth_b.replace_authorized_user_and_build_cookies(
        {"Authorization": f"Basic {basic_b}"},
        "admin",
        "password-b",
        secure=False,
    )

    assert cookies_a is not None
    assert cookies_b is not None
    verifier = AuthManager(users_file)
    tokens_a = [cookie.split(";", 1)[0].split("=", 1)[1] for cookie in cookies_a]
    tokens_b = [cookie.split(";", 1)[0].split("=", 1)[1] for cookie in cookies_b]
    assert verifier.authorize_session_token(tokens_a[0]) is None
    assert verifier.authorize_remember_token(tokens_a[1]) is None
    assert verifier.authorize_session_token(tokens_b[0]) == "admin"
    assert verifier.authorize_remember_token(tokens_b[1]) == "admin"


def test_revoked_credential_transaction_cannot_overwrite_later_rotation(
    tmp_path,
) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "old-password")
    auth_a = AuthManager(users_file)
    auth_b = AuthManager(users_file)
    old_token = auth_a.create_session_token("admin")
    old_headers = {"Cookie": f"{SESSION_COOKIE_NAME}={old_token}"}

    auth_b.replace_single_user("admin", "password-b")
    result = auth_a.replace_authorized_user_and_build_cookies(
        old_headers,
        "admin",
        "password-a",
        secure=False,
    )

    assert result is None
    assert auth_a.authorize_basic("admin", "password-b") is True
    assert auth_a.authorize_basic("admin", "password-a") is False


def test_logout_revokes_all_browser_tokens_and_new_tokens_authorize(tmp_path) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")
    auth = AuthManager(users_file)
    old_session = auth.create_session_token("admin")
    old_remember = auth.create_remember_token("admin")
    handler = _make_handler(
        auth,
        headers={"Cookie": f"{SESSION_COOKIE_NAME}={old_session}"},
    )

    SyncRequestHandler._handle_auth_logout(handler)

    assert auth.authorize_session_token(old_session) is None
    assert auth.authorize_remember_token(old_remember) is None
    assert auth.authorize_session_token(auth.create_session_token("admin")) == "admin"
    persisted = json.loads(users_file.read_text(encoding="utf-8"))
    assert persisted["users"][0]["tokenVersion"] == 1


def test_auth_manager_authorizes_signed_session_cookie(tmp_path) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")
    auth = AuthManager(users_file)

    cookie = auth.build_session_cookie("admin", secure=False)
    request_headers = {"Cookie": cookie.split(";", 1)[0]}

    assert auth.is_authorized(request_headers) is True
    assert auth.get_authorized_username(request_headers) == "admin"


def test_auth_manager_treats_auth_headers_case_insensitively(tmp_path) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")
    auth = AuthManager(users_file)

    cookie = auth.build_session_cookie("admin", secure=False)
    request_headers = {
        "cookie": cookie.split(";", 1)[0],
        "authorization": "Basic YWRtaW46YWRtaW4=",
    }

    assert auth.is_authorized(request_headers) is True
    assert auth.get_authorized_username(request_headers) == "admin"


def test_auth_manager_reports_basic_auth_username(tmp_path) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")
    auth = AuthManager(users_file)

    request_headers = {"Authorization": "Basic YWRtaW46YWRtaW4="}

    assert auth.is_authorized(request_headers) is True
    assert auth.get_authorized_username(request_headers) == "admin"


def test_auth_manager_authorizes_signed_remember_cookie(tmp_path) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")
    auth = AuthManager(users_file)

    cookie = auth.build_remember_cookie("admin", secure=False)
    request_headers = {"Cookie": cookie.split(";", 1)[0]}

    assert auth.is_authorized(request_headers) is True
    assert auth.get_authorized_username(request_headers) == "admin"


def test_auth_manager_uses_compare_digest_for_api_keys(tmp_path) -> None:
    users_file = tmp_path / "users.json"
    users_file.write_text(
        json.dumps(
            {
                "users": [],
                "apiKeys": ["api-key-1", "api-key-2"],
            }
        ),
        encoding="utf-8",
    )
    auth = AuthManager(users_file)

    with patch(
        "sync_server.auth.hmac.compare_digest",
        side_effect=lambda left, right: left == right,
    ) as compare_digest:
        assert auth.authorize_api_key("api-key-2") is True

    assert compare_digest.call_count == 2


def test_auth_manager_treats_non_object_users_database_as_empty(tmp_path) -> None:
    users_file = tmp_path / "users.json"
    users_file.write_text("[]", encoding="utf-8")

    auth = AuthManager(users_file)

    assert auth.enabled is False
    assert auth.users == {}
    assert auth.api_keys == set()


def test_handle_auth_login_sets_session_and_remember_cookies_by_default(tmp_path) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")
    auth = AuthManager(users_file)
    handler = _make_handler(
        auth,
        payload={"username": "admin", "password": "admin"},
    )

    SyncRequestHandler._handle_auth_login(handler)

    handler._send_json.assert_called_once()
    status, payload, extra_headers = handler._send_json.call_args.args
    assert status == HTTPStatus.OK
    assert payload == {
        "ok": True,
        "enabled": True,
        "authorized": True,
        "username": "admin",
    }
    assert "Set-Cookie" in extra_headers
    cookies = extra_headers["Set-Cookie"]
    assert isinstance(cookies, list)
    assert any(SESSION_COOKIE_NAME in cookie for cookie in cookies)
    assert any(REMEMBER_COOKIE_NAME in cookie for cookie in cookies)
    assert all("HttpOnly" in cookie for cookie in cookies)


def test_handle_auth_login_does_not_use_stale_disabled_state(tmp_path) -> None:
    users_file = tmp_path / "users.json"
    stale_auth = AuthManager(users_file)
    writer_auth = AuthManager(users_file)
    writer_auth.replace_single_user("admin", "admin")
    handler = _make_handler(
        stale_auth,
        payload={"username": "admin", "password": "admin"},
    )

    SyncRequestHandler._handle_auth_login(handler)

    status, payload, headers = handler._send_json.call_args.args
    assert status == HTTPStatus.OK
    assert payload["enabled"] is True
    assert payload["username"] == "admin"
    assert len(headers["Set-Cookie"]) == 2


def test_handle_auth_login_can_skip_remember_cookie(tmp_path) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")
    auth = AuthManager(users_file)
    handler = _make_handler(
        auth,
        payload={"username": "admin", "password": "admin", "remember": False},
    )

    SyncRequestHandler._handle_auth_login(handler)

    handler._send_json.assert_called_once()
    _, _, extra_headers = handler._send_json.call_args.args
    cookies = extra_headers["Set-Cookie"]
    assert isinstance(cookies, list)
    assert any(SESSION_COOKIE_NAME in cookie for cookie in cookies)
    assert all(REMEMBER_COOKIE_NAME not in cookie for cookie in cookies)


def test_handle_auth_login_rejects_invalid_credentials(tmp_path) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")
    auth = AuthManager(users_file)
    handler = _make_handler(
        auth,
        payload={"username": "admin", "password": "wrong"},
    )
    handler.client_address = ("192.0.2.10", 12345)
    limiter = MagicMock()
    limiter.try_reserve.return_value = True
    handler.context.rate_limiter = limiter

    SyncRequestHandler._handle_auth_login(handler)

    handler._send_json.assert_called_once_with(
        HTTPStatus.UNAUTHORIZED,
        {"error": "Invalid credentials"},
    )
    limiter.try_reserve.assert_called_once_with("login:192.0.2.10")
    limiter.complete_failure.assert_called_once_with("login:192.0.2.10")
    limiter.complete_success.assert_not_called()


def test_handle_auth_login_rejects_exhausted_invalid_attempt_without_recording(
    tmp_path,
) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")
    auth = AuthManager(users_file)
    handler = _make_handler(
        auth,
        payload={"username": "admin", "password": "wrong"},
    )
    handler.client_address = ("192.0.2.10", 12345)
    limiter = MagicMock()
    limiter.try_reserve.return_value = False
    handler.context.rate_limiter = limiter

    SyncRequestHandler._handle_auth_login(handler)

    handler._send_json.assert_called_once_with(
        HTTPStatus.TOO_MANY_REQUESTS,
        {"error": "Too many login attempts. Try again later."},
    )
    limiter.try_reserve.assert_called_once_with("login:192.0.2.10")
    limiter.complete_failure.assert_not_called()
    limiter.complete_success.assert_not_called()


def test_handle_auth_login_short_circuits_exhausted_request_before_auth(tmp_path) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")
    auth = AuthManager(users_file)
    handler = _make_handler(
        auth,
        payload={"username": "admin", "password": "admin"},
    )
    handler.client_address = None
    limiter = MagicMock()
    limiter.try_reserve.return_value = False
    handler.context.rate_limiter = limiter

    with patch.object(auth, "authenticate_and_build_cookies") as authenticate:
        SyncRequestHandler._handle_auth_login(handler)

    authenticate.assert_not_called()
    limiter.try_reserve.assert_called_once_with(f"login:unknown:{id(handler)}")
    limiter.complete_failure.assert_not_called()
    handler._send_json.assert_called_once_with(
        HTTPStatus.TOO_MANY_REQUESTS,
        {"error": "Too many login attempts. Try again later."},
    )


def test_handle_auth_login_success_resets_only_login_namespace(tmp_path) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")
    auth = AuthManager(users_file)
    handler = _make_handler(
        auth,
        payload={"username": "admin", "password": "admin"},
    )
    handler.client_address = ("192.0.2.10", 12345)
    limiter = MagicMock()
    limiter.try_reserve.return_value = True
    handler.context.rate_limiter = limiter

    SyncRequestHandler._handle_auth_login(handler)

    assert handler._send_json.call_args.args[0] == HTTPStatus.OK
    limiter.try_reserve.assert_called_once_with("login:192.0.2.10")
    limiter.complete_failure.assert_not_called()
    limiter.complete_success.assert_called_once_with("login:192.0.2.10")


def test_concurrent_logins_reserve_before_password_verification() -> None:
    limiter = RateLimiter(max_attempts=1, window_seconds=60)
    auth = MagicMock()
    auth.enabled = True
    seven_rejections = threading.Barrier(8)
    release_auth = threading.Event()

    def authenticate(*args, **kwargs):
        release_auth.wait(timeout=5)
        return None

    auth.authenticate_and_build_cookies.side_effect = authenticate

    def attempt_login() -> HTTPStatus:
        handler = _make_handler(
            auth,
            payload={"username": "admin", "password": "wrong"},
        )
        handler.client_address = ("192.0.2.10", 12345)
        handler.context.rate_limiter = limiter
        status: list[HTTPStatus] = []

        def capture_status(code, *args):
            status.append(code)
            if code == HTTPStatus.TOO_MANY_REQUESTS:
                seven_rejections.wait(timeout=5)

        handler._send_json.side_effect = capture_status
        SyncRequestHandler._handle_auth_login(handler)
        return status[0]

    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(attempt_login) for _ in range(8)]
        seven_rejections.wait(timeout=5)
        release_auth.set()
        statuses = [future.result(timeout=5) for future in futures]

    assert auth.authenticate_and_build_cookies.call_count == 1
    assert statuses.count(HTTPStatus.TOO_MANY_REQUESTS) == 7
    assert statuses.count(HTTPStatus.UNAUTHORIZED) == 1


def test_handle_auth_login_cancels_reservation_when_secure_detection_raises(
    tmp_path,
) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")
    auth = AuthManager(users_file)
    limiter = RateLimiter(max_attempts=1, window_seconds=60)
    handler = _make_handler(
        auth,
        payload={"username": "admin", "password": "admin"},
    )
    handler.client_address = ("192.0.2.10", 12345)
    handler.context.rate_limiter = limiter
    handler._request_is_secure.side_effect = RuntimeError("secure detection failed")

    with pytest.raises(RuntimeError, match="secure detection failed"):
        SyncRequestHandler._handle_auth_login(handler)

    assert limiter.try_reserve("login:192.0.2.10") is True


def test_handle_auth_login_uses_atomic_authentication_and_cookie_issuance(
    tmp_path,
) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")
    auth = AuthManager(users_file)
    handler = _make_handler(
        auth,
        payload={"username": "admin", "password": "admin", "remember": True},
    )
    handler.context.rate_limiter = None

    with (
        patch.object(
            auth,
            "authenticate_and_build_cookies",
            wraps=auth.authenticate_and_build_cookies,
        ) as authenticate_and_build,
        patch.object(auth, "authorize_basic") as authorize_basic,
    ):
        SyncRequestHandler._handle_auth_login(handler)

    authenticate_and_build.assert_called_once_with(
        "admin", "admin", secure=False, remember=True
    )
    authorize_basic.assert_not_called()


def test_handle_auth_logout_clears_session_cookie(tmp_path) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")
    auth = AuthManager(users_file)
    cookie = auth.build_session_cookie("admin", secure=False)
    handler = _make_handler(
        auth,
        headers={"Cookie": cookie.split(";", 1)[0]},
    )

    SyncRequestHandler._handle_auth_logout(handler)

    handler._send_json.assert_called_once()
    status, payload, extra_headers = handler._send_json.call_args.args
    assert status == HTTPStatus.OK
    assert payload == {"ok": True}
    assert "Set-Cookie" in extra_headers
    cookies = extra_headers["Set-Cookie"]
    assert isinstance(cookies, list)
    assert any(f"{SESSION_COOKIE_NAME}=" in cookie for cookie in cookies)
    assert any(f"{REMEMBER_COOKIE_NAME}=" in cookie for cookie in cookies)
    assert all("Max-Age=0" in cookie for cookie in cookies)


def test_handle_auth_logout_rejects_missing_cookie_csrf(tmp_path) -> None:
    users_file = tmp_path / "users.json"
    save_user(users_file, "admin", "admin")
    auth = AuthManager(users_file)
    handler = _make_handler(auth)
    handler._require_cookie_csrf.return_value = False

    SyncRequestHandler._handle_auth_logout(handler)

    handler._require_cookie_csrf.assert_called_once_with()
    handler._send_json.assert_not_called()
