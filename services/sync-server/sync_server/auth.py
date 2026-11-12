from __future__ import annotations

import base64
import hashlib
import heapq
import hmac
import ipaddress
import json
import os
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterable, Iterator, Mapping, Optional
from http import cookies
from datetime import datetime, timedelta, timezone

from .utils import load_json, write_json


class RateLimiter:
    """Thread-safe in-memory failure limiter keyed by authentication surface."""

    _CLEANUP_BUDGET = 16

    def __init__(self, max_attempts: int = 5, window_seconds: int = 60) -> None:
        self._max_attempts = max_attempts
        self._window = window_seconds
        self._attempts: dict[str, list[tuple[float, int]]] = {}
        self._expiry_heap: list[tuple[float, int, str]] = []
        self._in_flight: dict[str, int] = {}
        self._event_id = 0
        self._lock = threading.Lock()

    def _cleanup_expired(self, now: float) -> None:
        cutoff = now - self._window
        cleaned = 0
        while (
            self._expiry_heap
            and self._expiry_heap[0][0] <= cutoff
            and cleaned < self._CLEANUP_BUDGET
        ):
            _, event_id, key = heapq.heappop(self._expiry_heap)
            entries = self._attempts.get(key, [])
            remaining = [entry for entry in entries if entry[1] != event_id]
            if remaining:
                self._attempts[key] = remaining
            else:
                self._attempts.pop(key, None)
            cleaned += 1

    def _prune(self, key: str, now: float) -> list[tuple[float, int]]:
        cutoff = now - self._window
        entries = [
            entry
            for entry in self._attempts.get(key, [])
            if entry[0] > cutoff
        ]
        if entries:
            self._attempts[key] = entries
        else:
            self._attempts.pop(key, None)
        return entries

    def _record_failure(self, key: str, now: float) -> int:
        entries = self._prune(key, now)
        self._event_id += 1
        entry = (now, self._event_id)
        entries.append(entry)
        self._attempts[key] = entries
        heapq.heappush(self._expiry_heap, (now, self._event_id, key))
        return len(entries)

    def _release_reservation(self, key: str) -> bool:
        in_flight = self._in_flight.get(key, 0)
        if in_flight <= 0:
            return False
        if in_flight == 1:
            self._in_flight.pop(key, None)
        else:
            self._in_flight[key] = in_flight - 1
        return True

    def is_allowed(self, key: str) -> bool:
        """Check admission without consuming a failure slot."""
        now = time.monotonic()
        with self._lock:
            self._cleanup_expired(now)
            failures = len(self._prune(key, now))
            return failures + self._in_flight.get(key, 0) < self._max_attempts

    def record_failure(self, key: str) -> int:
        """Record exactly one failure and return the current failure count."""
        now = time.monotonic()
        with self._lock:
            self._cleanup_expired(now)
            return self._record_failure(key, now)

    def record_failure_if_allowed(self, key: str) -> bool:
        """Atomically record one failure only when capacity remains."""
        now = time.monotonic()
        with self._lock:
            self._cleanup_expired(now)
            failures = len(self._prune(key, now))
            if failures + self._in_flight.get(key, 0) >= self._max_attempts:
                return False
            self._record_failure(key, now)
            return True

    def try_reserve(self, key: str) -> bool:
        """Reserve capacity before starting an expensive auth attempt."""
        now = time.monotonic()
        with self._lock:
            self._cleanup_expired(now)
            failures = len(self._prune(key, now))
            in_flight = self._in_flight.get(key, 0)
            if failures + in_flight >= self._max_attempts:
                return False
            self._in_flight[key] = in_flight + 1
            return True

    def complete_success(self, key: str) -> bool:
        """Release one reservation and clear prior failures for this key."""
        now = time.monotonic()
        with self._lock:
            self._cleanup_expired(now)
            if not self._release_reservation(key):
                return False
            self._attempts.pop(key, None)
            return True

    def complete_failure(self, key: str) -> bool:
        """Release one reservation and atomically record its failure."""
        now = time.monotonic()
        with self._lock:
            self._cleanup_expired(now)
            if not self._release_reservation(key):
                return False
            self._record_failure(key, now)
            return True

    def cancel_reservation(self, key: str) -> bool:
        """Release a reservation when authentication cannot complete."""
        with self._lock:
            return self._release_reservation(key)

    def reset(self, key: str) -> None:
        """Clear failures for one authentication surface key."""
        now = time.monotonic()
        with self._lock:
            self._cleanup_expired(now)
            self._attempts.pop(key, None)


def _ip_from_peer(peer: object) -> Optional[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    candidate = peer
    if isinstance(peer, (tuple, list)):
        if not peer:
            candidate = None
        else:
            candidate = peer[0]
    if not isinstance(candidate, str) or not candidate.strip():
        return None
    try:
        return ipaddress.ip_address(candidate.strip().split("%", 1)[0])
    except ValueError:
        return None


def peer_is_trusted_proxy(peer: object, trusted_proxies: Iterable[str]) -> bool:
    peer_ip = _ip_from_peer(peer)
    if peer_ip is None:
        return False
    for proxy_range in trusted_proxies:
        try:
            if peer_ip in ipaddress.ip_network(proxy_range, strict=False):
                return True
        except ValueError:
            continue
    return False


def _forwarded_ip(value: str) -> Optional[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    normalized = value.strip().strip('"')
    if not normalized or normalized.lower() == "unknown" or normalized.startswith("_"):
        return None
    if normalized.startswith("["):
        closing = normalized.find("]")
        if closing < 0:
            return None
        normalized = normalized[1:closing]
    else:
        try:
            return ipaddress.ip_address(normalized.split("%", 1)[0])
        except ValueError:
            host, separator, port = normalized.rpartition(":")
            if not separator or not port.isdigit():
                return None
            normalized = host
    try:
        return ipaddress.ip_address(normalized.split("%", 1)[0])
    except ValueError:
        return None


def _forwarded_chain(
    headers: Mapping[str, object],
) -> Optional[list[ipaddress.IPv4Address | ipaddress.IPv6Address]]:
    x_forwarded_for = _get_header(headers, "X-Forwarded-For")
    raw_values: list[str] = []
    if x_forwarded_for:
        raw_values = [part.strip() for part in x_forwarded_for.split(",")]
    else:
        forwarded = _get_header(headers, "Forwarded")
        if forwarded:
            for element in forwarded.split(","):
                value = next(
                    (
                        directive.partition("=")[2].strip()
                        for directive in element.split(";")
                        if directive.partition("=")[0].strip().lower() == "for"
                    ),
                    "",
                )
                if not value:
                    return None
                raw_values.append(value)
    if not raw_values:
        return []
    parsed = [_forwarded_ip(value) for value in raw_values]
    if any(value is None for value in parsed):
        return None
    return [value for value in parsed if value is not None]


def client_ip_from_peer(
    peer: object,
    fallback_identity: object = None,
    *,
    headers: Optional[Mapping[str, object]] = None,
    trusted_proxies: Iterable[str] = (),
) -> str:
    """Resolve a stable client IP without trusting spoofable forwarding headers."""
    peer_ip = _ip_from_peer(peer)
    if peer_ip is not None:
        peer_value = str(peer_ip)
        trusted_ranges = tuple(trusted_proxies)
        if headers and peer_is_trusted_proxy(peer, trusted_ranges):
            forwarded = _forwarded_chain(headers)
            if forwarded:
                chain = [*forwarded, peer_ip]
                for candidate in reversed(chain):
                    if not peer_is_trusted_proxy(str(candidate), trusted_ranges):
                        return str(candidate)
                return str(forwarded[0])
        return peer_value
    if fallback_identity is not None:
        return f"unknown:{id(fallback_identity)}"
    return "unknown"


SESSION_COOKIE_NAME = "airqr_session"
REMEMBER_COOKIE_NAME = "airqr_remember"
SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60
REMEMBER_MAX_AGE_SECONDS = 180 * 24 * 60 * 60

_AUTH_PATH_LOCKS: dict[Path, threading.RLock] = {}
_AUTH_PATH_LOCKS_GUARD = threading.Lock()


def _auth_path_lock(users_file: Path) -> threading.RLock:
    resolved = users_file.resolve()
    with _AUTH_PATH_LOCKS_GUARD:
        return _AUTH_PATH_LOCKS.setdefault(resolved, threading.RLock())


@contextmanager
def _locked_auth_database(users_file: Path) -> Iterator[None]:
    """Lock order: resolved-path lock, OS lock-file, then manager cache lock."""
    path_lock = _auth_path_lock(users_file)
    with path_lock:
        lock_file = users_file.with_name(f"{users_file.name}.lock")
        lock_file.parent.mkdir(parents=True, exist_ok=True)
        with lock_file.open("a+b") as handle:
            handle.seek(0, os.SEEK_END)
            if handle.tell() == 0:
                handle.write(b"\0")
                handle.flush()
            handle.seek(0)
            if os.name == "nt":
                import msvcrt

                msvcrt.locking(handle.fileno(), msvcrt.LK_LOCK, 1)
            else:
                import fcntl

                fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                handle.seek(0)
                if os.name == "nt":
                    msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def hash_password(password: str, salt: Optional[str] = None) -> str:
    if salt is None:
        salt = os.urandom(16).hex()
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt.encode("utf-8"), 120000
    )
    return f"pbkdf2_sha256${salt}${base64.b64encode(digest).decode('ascii')}"


def is_valid_password_hash(stored: object) -> bool:
    if not isinstance(stored, str):
        return False
    try:
        algo, salt, digest_b64 = stored.split("$", 2)
        digest = base64.b64decode(digest_b64, validate=True)
    except (ValueError, TypeError):
        return False
    return (
        algo == "pbkdf2_sha256"
        and bool(salt)
        and len(digest) == hashlib.sha256().digest_size
        and base64.b64encode(digest).decode("ascii") == digest_b64
    )


def is_valid_user_record(record: object) -> bool:
    return (
        isinstance(record, Mapping)
        and isinstance(record.get("username"), str)
        and bool(record["username"].strip())
        and is_valid_password_hash(record.get("passwordHash"))
    )


def is_valid_api_key(api_key: object) -> bool:
    return isinstance(api_key, str) and bool(api_key.strip())


def _is_valid_token_version(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def normalize_auth_database(data: object) -> dict[str, object]:
    normalized = dict(data) if isinstance(data, Mapping) else {}

    # Restoring an older users.json can roll generations back and revive old
    # tokens if the session secret is retained; rotate auth state after restores.
    stored_token_versions = normalized.get("tokenVersions", {})
    if not isinstance(stored_token_versions, Mapping):
        stored_token_versions = {}
    token_versions = {
        username: version
        for username, version in stored_token_versions.items()
        if isinstance(username, str)
        and bool(username.strip())
        and _is_valid_token_version(version)
    }

    users = normalized.get("users", [])
    if not isinstance(users, list):
        users = []
    canonical_users: dict[str, dict[str, object]] = {}
    for user in users:
        if not is_valid_user_record(user):
            continue
        normalized_user = dict(user)
        token_version = normalized_user.get("tokenVersion", 0)
        if not _is_valid_token_version(token_version):
            token_version = 0
        username = normalized_user["username"]
        token_versions[username] = max(token_versions.get(username, 0), token_version)
        normalized_user["tokenVersion"] = token_version
        canonical_users[username] = normalized_user
    normalized_users = list(canonical_users.values())
    for normalized_user in normalized_users:
        normalized_user["tokenVersion"] = token_versions[normalized_user["username"]]
    normalized["users"] = normalized_users
    normalized["tokenVersions"] = token_versions

    api_keys = normalized.get("apiKeys", [])
    if not isinstance(api_keys, list):
        api_keys = []
    normalized["apiKeys"] = [
        api_key for api_key in api_keys if is_valid_api_key(api_key)
    ]
    return normalized


def load_auth_database(users_file: Path) -> dict[str, object]:
    with _locked_auth_database(users_file):
        return _load_auth_database_unlocked(users_file)


def _load_auth_database_unlocked(users_file: Path) -> dict[str, object]:
    data = load_json(users_file) if users_file.exists() else {}
    return normalize_auth_database(data)


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, salt, digest_b64 = stored.split("$", 2)
    except ValueError:
        return False
    if algo != "pbkdf2_sha256":
        return False
    expected = hash_password(password, salt)
    return hmac.compare_digest(expected, stored)


def parse_basic_auth(header: str) -> Optional[tuple[str, str]]:
    if not header.lower().startswith("basic "):
        return None
    token = header.split(" ", 1)[1].strip()
    try:
        decoded = base64.b64decode(token).decode("utf-8")
    except Exception:
        return None
    if ":" not in decoded:
        return None
    username, password = decoded.split(":", 1)
    return username, password


def _base64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _base64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(f"{value}{padding}".encode("ascii"))


def _parse_cookie_value(header: str, name: str) -> Optional[str]:
    if not header:
        return None
    jar = cookies.SimpleCookie()
    try:
        jar.load(header)
    except cookies.CookieError:
        return None
    morsel = jar.get(name)
    return morsel.value if morsel is not None else None


def _get_header(headers: Mapping[str, str], name: str) -> str:
    value = headers.get(name)
    if isinstance(value, str):
        return value

    lower_name = name.lower()
    value = headers.get(lower_name)
    if isinstance(value, str):
        return value

    for key, candidate in headers.items():
        if isinstance(key, str) and key.lower() == lower_name and isinstance(candidate, str):
            return candidate

    return ""


class AuthManager:
    def __init__(
        self,
        users_file: Path,
        rate_limiter: Optional[RateLimiter] = None,
        trusted_proxies: Iterable[str] = (),
    ) -> None:
        self.users_file = users_file
        self.session_secret_file = users_file.with_name(f"{users_file.name}.session-secret")
        self.users: dict[str, str] = {}
        self.token_versions: dict[str, int] = {}
        self.api_keys: set[str] = set()
        self._users_lock = threading.RLock()
        self.rate_limiter = rate_limiter
        self.trusted_proxies = tuple(trusted_proxies)
        self._session_secret = self._load_session_secret()
        self.reload()

    def _load_session_secret(self) -> bytes:
        with _locked_auth_database(self.users_file):
            if self.session_secret_file.exists():
                secret = self.session_secret_file.read_text(encoding="utf-8")
            else:
                secret = os.urandom(32).hex()
                self.session_secret_file.parent.mkdir(parents=True, exist_ok=True)
                flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
                if hasattr(os, "O_BINARY"):
                    flags |= os.O_BINARY
                fd = os.open(self.session_secret_file, flags, 0o600)
                with os.fdopen(fd, "w", encoding="utf-8") as handle:
                    handle.write(secret)
                    handle.flush()
                    os.fsync(handle.fileno())

            if len(secret) != 64 or any(
                character not in "0123456789abcdef" for character in secret
            ):
                raise ValueError(
                    "Invalid session secret file; expected 64 lowercase hexadecimal characters"
                )
            return secret.encode("ascii")

    def reload(self) -> None:
        with _locked_auth_database(self.users_file):
            data = _load_auth_database_unlocked(self.users_file)
            with self._users_lock:
                if not self.users_file.exists():
                    self.users = {}
                    self.token_versions = {}
                    self.api_keys = set()
                    return
                self._apply_auth_database(data)

    def _apply_auth_database(self, data: dict[str, object]) -> None:
        user_records = data["users"]
        self.users = {
            user.get("username"): user.get("passwordHash")
            for user in user_records
        }
        self.token_versions = {
            user.get("username"): user.get("tokenVersion", 0)
            for user in user_records
        }
        self.api_keys = set(data["apiKeys"])

    def _auth_snapshot(self) -> dict[str, object]:
        with _locked_auth_database(self.users_file):
            users_db = _load_auth_database_unlocked(self.users_file)
            with self._users_lock:
                self._apply_auth_database(users_db)
            return users_db

    def replace_single_user(self, username: str, password: str) -> None:
        with _locked_auth_database(self.users_file):
            users_db = _load_auth_database_unlocked(self.users_file)
            self._replace_single_user_in_database(users_db, username, password)
            write_json(self.users_file, users_db)
            with self._users_lock:
                self._apply_auth_database(users_db)

    @staticmethod
    def _replace_single_user_in_database(
        users_db: dict[str, object], username: str, password: str
    ) -> int:
        token_versions = users_db["tokenVersions"]
        token_version = token_versions.get(username, -1) + 1
        token_versions[username] = token_version
        users_db["users"] = [
            {
                "username": username,
                "passwordHash": hash_password(password),
                "tokenVersion": token_version,
            }
        ]
        users_db.setdefault("apiKeys", [])
        return token_version

    def _build_rotation_cookies(
        self, username: str, *, secure: bool, token_version: int
    ) -> list[str]:
        return [
            self.build_session_cookie(
                username, secure=secure, _token_version=token_version
            ),
            self.build_remember_cookie(
                username, secure=secure, _token_version=token_version
            ),
        ]

    def replace_authorized_user_and_build_cookies(
        self,
        headers: Mapping[str, str],
        username: str,
        password: str,
        *,
        secure: bool,
    ) -> Optional[list[str]]:
        with _locked_auth_database(self.users_file):
            users_db = _load_auth_database_unlocked(self.users_file)
            if not self._is_authorized_in_database(headers, users_db):
                return None
            token_version = self._replace_single_user_in_database(
                users_db, username, password
            )
            write_json(self.users_file, users_db)
            with self._users_lock:
                self._apply_auth_database(users_db)
            return self._build_rotation_cookies(
                username, secure=secure, token_version=token_version
            )

    def increment_token_version(self, username: str) -> bool:
        with _locked_auth_database(self.users_file):
            users_db = _load_auth_database_unlocked(self.users_file)
            user = next(
                (user for user in users_db["users"] if user.get("username") == username),
                None,
            )
            if user is None:
                return False
            user["tokenVersion"] = user.get("tokenVersion", 0) + 1
            users_db["tokenVersions"][username] = user["tokenVersion"]
            write_json(self.users_file, users_db)
            with self._users_lock:
                self._apply_auth_database(users_db)
            return True

    def authenticate_and_build_cookies(
        self,
        username: str,
        password: str,
        *,
        secure: bool,
        remember: bool,
    ) -> Optional[list[str]]:
        with _locked_auth_database(self.users_file):
            users_db = _load_auth_database_unlocked(self.users_file)
            user = next(
                (user for user in users_db["users"] if user.get("username") == username),
                None,
            )
            if user is None or not verify_password(password, user["passwordHash"]):
                return None
            token_version = user["tokenVersion"]
            with self._users_lock:
                self._apply_auth_database(users_db)
            cookies = [
                self.build_session_cookie(
                    username, secure=secure, _token_version=token_version
                )
            ]
            if remember:
                cookies.append(
                    self.build_remember_cookie(
                        username, secure=secure, _token_version=token_version
                    )
                )
            return cookies

    @property
    def enabled(self) -> bool:
        users_db = self._auth_snapshot()
        return bool(users_db["users"] or users_db["apiKeys"])

    def is_authorized(self, headers: Mapping[str, str]) -> bool:
        if self.get_authorized_username(headers):
            return True
        if not self.enabled:
            return True
        api_key = _get_header(headers, "X-API-Key")
        if self.authorize_api_key(api_key):
            return True
        auth_header = _get_header(headers, "Authorization")
        creds = parse_basic_auth(auth_header)
        if not creds:
            return False
        username, password = creds
        return self.authorize_basic(username, password)

    def is_cookie_or_api_key_authorized(
        self, headers: Mapping[str, str]
    ) -> bool:
        """Authorize only cheap signed-cookie or API-key credentials."""
        if self.get_authorized_cookie_username(headers):
            return True
        return self.is_api_key_authorized(headers)

    def is_api_key_authorized(self, headers: Mapping[str, str]) -> bool:
        """Authorize an API key supplied in request headers."""
        return self.authorize_api_key(_get_header(headers, "X-API-Key"))

    @staticmethod
    def get_basic_credentials(
        headers: Mapping[str, str],
    ) -> Optional[tuple[str, str]]:
        return parse_basic_auth(_get_header(headers, "Authorization"))

    def get_authorized_username(self, headers: Mapping[str, str]) -> Optional[str]:
        if not self.enabled:
            return None
        cookie_header = _get_header(headers, "Cookie")
        session_username = self.authorize_session_cookie(cookie_header)
        if session_username:
            return session_username
        remember_username = self.authorize_remember_cookie(cookie_header)
        if remember_username:
            return remember_username
        auth_header = _get_header(headers, "Authorization")
        creds = parse_basic_auth(auth_header)
        if not creds:
            return None
        username, password = creds
        if self.authorize_basic(username, password):
            return username
        return None

    def get_authorized_cookie_username(
        self, headers: Mapping[str, str]
    ) -> Optional[str]:
        cookie_header = _get_header(headers, "Cookie")
        return self.authorize_session_cookie(cookie_header) or self.authorize_remember_cookie(
            cookie_header
        )

    def authorize_api_key(self, api_key: str) -> bool:
        if not api_key:
            return False

        api_keys = self._auth_snapshot()["apiKeys"]
        matched = False
        for candidate in api_keys:
            if hmac.compare_digest(candidate, api_key):
                matched = True
        return matched

    def authorize_basic(self, username: str, password: str) -> bool:
        users_db = self._auth_snapshot()
        stored_hash = next(
            (
                user.get("passwordHash")
                for user in users_db["users"]
                if user.get("username") == username
            ),
            None,
        )
        if not stored_hash:
            return False
        return verify_password(password, stored_hash)

    def _is_authorized_in_database(
        self, headers: Mapping[str, str], users_db: dict[str, object]
    ) -> bool:
        cookie_header = _get_header(headers, "Cookie")
        session_token = _parse_cookie_value(cookie_header, SESSION_COOKIE_NAME)
        remember_token = _parse_cookie_value(cookie_header, REMEMBER_COOKIE_NAME)
        if self._authorize_signed_token_in_database(
            session_token or "", expected_type="session", users_db=users_db
        ) or self._authorize_signed_token_in_database(
            remember_token or "", expected_type="remember", users_db=users_db
        ):
            return True

        api_key = _get_header(headers, "X-API-Key")
        api_key_matched = False
        if api_key:
            for candidate in users_db["apiKeys"]:
                if hmac.compare_digest(candidate, api_key):
                    api_key_matched = True
        if api_key_matched:
            return True

        credentials = parse_basic_auth(_get_header(headers, "Authorization"))
        if credentials is None:
            return False
        username, password = credentials
        stored_hash = next(
            (
                user.get("passwordHash")
                for user in users_db["users"]
                if user.get("username") == username
            ),
            None,
        )
        return bool(stored_hash and verify_password(password, stored_hash))

    def _create_signed_token(
        self,
        username: str,
        *,
        issued_at: Optional[datetime] = None,
        max_age: int,
        token_type: str,
        token_version: Optional[int] = None,
    ) -> str:
        issued_at_value = issued_at or datetime.now(timezone.utc)
        expires_at = issued_at_value + timedelta(seconds=max_age)
        if token_version is None:
            with _locked_auth_database(self.users_file):
                users_db = _load_auth_database_unlocked(self.users_file)
                token_version = users_db["tokenVersions"].get(username, 0)
        payload = {
            "t": token_type,
            "u": username,
            "v": token_version,
            "iat": int(issued_at_value.timestamp()),
            "exp": int(expires_at.timestamp()),
        }
        payload_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
        signature = hmac.new(self._session_secret, payload_bytes, hashlib.sha256).digest()
        return f"{_base64url_encode(payload_bytes)}.{_base64url_encode(signature)}"

    def _authorize_signed_token_in_database(
        self,
        token: str,
        *,
        expected_type: str,
        users_db: dict[str, object],
    ) -> Optional[str]:
        if not token or "." not in token:
            return None

        payload_b64, signature_b64 = token.split(".", 1)
        try:
            payload_bytes = _base64url_decode(payload_b64)
            signature = _base64url_decode(signature_b64)
        except Exception:
            return None

        expected_signature = hmac.new(self._session_secret, payload_bytes, hashlib.sha256).digest()
        if not hmac.compare_digest(signature, expected_signature):
            return None

        try:
            payload = json.loads(payload_bytes.decode("utf-8"))
        except Exception:
            return None

        username = payload.get("u")
        expires_at = payload.get("exp")
        token_type = payload.get("t")
        token_version = payload.get("v")
        if (
            not isinstance(username, str)
            or not isinstance(expires_at, int)
            or token_type != expected_type
            or not isinstance(token_version, int)
            or isinstance(token_version, bool)
        ):
            return None
        if expires_at < int(datetime.now(timezone.utc).timestamp()):
            return None
        current_version = users_db["tokenVersions"].get(username)
        active_usernames = {user.get("username") for user in users_db["users"]}
        if username not in active_usernames or token_version != current_version:
            return None
        return username

    def _authorize_signed_token(self, token: str, *, expected_type: str) -> Optional[str]:
        with _locked_auth_database(self.users_file):
            users_db = _load_auth_database_unlocked(self.users_file)
            username = self._authorize_signed_token_in_database(
                token, expected_type=expected_type, users_db=users_db
            )
            if username is None:
                return None
            with self._users_lock:
                self._apply_auth_database(users_db)
        return username

    def create_session_token(
        self,
        username: str,
        *,
        issued_at: Optional[datetime] = None,
        max_age: int = SESSION_MAX_AGE_SECONDS,
        _token_version: Optional[int] = None,
    ) -> str:
        return self._create_signed_token(
            username,
            issued_at=issued_at,
            max_age=max_age,
            token_type="session",
            token_version=_token_version,
        )

    def create_remember_token(
        self,
        username: str,
        *,
        issued_at: Optional[datetime] = None,
        max_age: int = REMEMBER_MAX_AGE_SECONDS,
        _token_version: Optional[int] = None,
    ) -> str:
        return self._create_signed_token(
            username,
            issued_at=issued_at,
            max_age=max_age,
            token_type="remember",
            token_version=_token_version,
        )

    def authorize_session_token(self, token: str) -> Optional[str]:
        return self._authorize_signed_token(token, expected_type="session")

    def authorize_remember_token(self, token: str) -> Optional[str]:
        return self._authorize_signed_token(token, expected_type="remember")

    def authorize_session_cookie(self, cookie_header: str) -> Optional[str]:
        token = _parse_cookie_value(cookie_header, SESSION_COOKIE_NAME)
        if not token:
            return None
        return self.authorize_session_token(token)

    def authorize_remember_cookie(self, cookie_header: str) -> Optional[str]:
        token = _parse_cookie_value(cookie_header, REMEMBER_COOKIE_NAME)
        if not token:
            return None
        return self.authorize_remember_token(token)

    def build_session_cookie(
        self,
        username: str,
        *,
        secure: bool,
        max_age: int = SESSION_MAX_AGE_SECONDS,
        _token_version: Optional[int] = None,
    ) -> str:
        token = self.create_session_token(
            username, max_age=max_age, _token_version=_token_version
        )
        parts = [
            f"{SESSION_COOKIE_NAME}={token}",
            "Path=/",
            f"Max-Age={max_age}",
            "HttpOnly",
            "SameSite=Lax",
        ]
        if secure:
            parts.append("Secure")
        return "; ".join(parts)

    def build_remember_cookie(
        self,
        username: str,
        *,
        secure: bool,
        max_age: int = REMEMBER_MAX_AGE_SECONDS,
        _token_version: Optional[int] = None,
    ) -> str:
        token = self.create_remember_token(
            username, max_age=max_age, _token_version=_token_version
        )
        parts = [
            f"{REMEMBER_COOKIE_NAME}={token}",
            "Path=/",
            f"Max-Age={max_age}",
            "HttpOnly",
            "SameSite=Lax",
        ]
        if secure:
            parts.append("Secure")
        return "; ".join(parts)

    def build_logout_cookie(self, *, secure: bool) -> str:
        parts = [
            f"{SESSION_COOKIE_NAME}=",
            "Path=/",
            "Max-Age=0",
            "HttpOnly",
            "SameSite=Lax",
        ]
        if secure:
            parts.append("Secure")
        return "; ".join(parts)

    def build_remember_logout_cookie(self, *, secure: bool) -> str:
        parts = [
            f"{REMEMBER_COOKIE_NAME}=",
            "Path=/",
            "Max-Age=0",
            "HttpOnly",
            "SameSite=Lax",
        ]
        if secure:
            parts.append("Secure")
        return "; ".join(parts)

    def build_logout_cookies(self, *, secure: bool) -> list[str]:
        return [
            self.build_logout_cookie(secure=secure),
            self.build_remember_logout_cookie(secure=secure),
        ]


def save_user(users_file: Path, username: str, password: str) -> None:
    with _locked_auth_database(users_file):
        users_db = _load_auth_database_unlocked(users_file)
        users_list = users_db["users"]
        users_list = [user for user in users_list if user.get("username") != username]
        token_versions = users_db["tokenVersions"]
        token_version = token_versions.get(username, -1) + 1
        token_versions[username] = token_version
        users_list.append(
            {
                "username": username,
                "passwordHash": hash_password(password),
                "tokenVersion": token_version,
            }
        )
        users_db["users"] = users_list
        users_db.setdefault("apiKeys", [])
        write_json(users_file, users_db)


def save_single_user(users_file: Path, username: str, password: str) -> None:
    with _locked_auth_database(users_file):
        users_db = _load_auth_database_unlocked(users_file)
        token_versions = users_db["tokenVersions"]
        token_version = token_versions.get(username, -1) + 1
        token_versions[username] = token_version
        users_db["users"] = [
            {
                "username": username,
                "passwordHash": hash_password(password),
                "tokenVersion": token_version,
            }
        ]
        users_db.setdefault("apiKeys", [])
        write_json(users_file, users_db)


def save_bootstrap_user_if_auth_empty(
    users_file: Path,
    username: str,
    password: str,
) -> bool:
    """Atomically create the bootstrap user only when no principal exists."""
    with _locked_auth_database(users_file):
        users_db = _load_auth_database_unlocked(users_file)
        if users_db["users"] or users_db["apiKeys"]:
            return False
        AuthManager._replace_single_user_in_database(users_db, username, password)
        write_json(users_file, users_db)
        return True
