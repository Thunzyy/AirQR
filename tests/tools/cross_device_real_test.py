#!/usr/bin/env python3
"""Real cross-device scan reliability matrix against a running sync server.

This validates real server behavior (HTTP + SSE realtime path), including:
1) init on web then resume on flutter
2) init on flutter then resume on web
3) web -> flutter -> web roundtrip
4) flutter -> web -> flutter roundtrip
5) completion finalized by web
6) completion finalized by flutter

Exit code:
- 0: all checks passed
- non-zero: at least one check failed
"""

from __future__ import annotations

import argparse
import base64
import json
import queue
import ssl
import threading
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional, Sequence, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin, urlparse
from urllib.request import Request, urlopen


SCENARIO_NAMES: tuple[str, ...] = (
    "web_to_flutter",
    "flutter_to_web",
    "web_flutter_web",
    "flutter_web_flutter",
    "web_complete",
    "flutter_complete",
)


def _packet_bytes(index: int, size: int = 810) -> bytes:
    seed = f"pkt-{index}-cross-device-real".encode("utf-8")
    payload = bytearray()
    while len(payload) < size:
        payload.extend(seed)
    return bytes(payload[:size])


def _basic_auth_header(username: str, password: str) -> str:
    token = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
    return f"Basic {token}"


def _as_int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _as_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in ("1", "true", "yes", "y", "on", "complete", "completed")
    if isinstance(value, (int, float)):
        return bool(value)
    return False


def _is_completed(session: Dict[str, Any]) -> bool:
    status = str(session.get("status", "")).strip().lower()
    return _as_bool(session.get("completed")) or status == "complete" or bool(session.get("completedAt"))


def _get_int(d: Dict[str, Any], *keys: str) -> int:
    for key in keys:
        if key in d and d[key] is not None:
            return _as_int(d.get(key), 0)
    return 0


@dataclass(frozen=True)
class Actor:
    key: str
    name: str
    device_id: str


@dataclass(frozen=True)
class Scenario:
    name: str
    description: str
    steps: tuple[tuple[str, int], ...]  # (actor_key, packet_count)
    duplicates: int = 2
    complete_actor: Optional[str] = None


@dataclass
class ServerClient:
    base_url: str
    username: Optional[str]
    password: Optional[str]
    api_key: Optional[str]
    ssl_context: Optional[ssl.SSLContext]
    timeout: float

    def _headers(self, json_body: bool = True) -> Dict[str, str]:
        headers: Dict[str, str] = {}
        if self.api_key:
            headers["X-API-Key"] = self.api_key
        elif self.username is not None and self.password is not None:
            headers["Authorization"] = _basic_auth_header(self.username, self.password)
        if json_body:
            headers["Content-Type"] = "application/json"
        return headers

    def _request_json(
        self,
        method: str,
        path: str,
        payload: Optional[Dict[str, Any]] = None,
    ) -> Tuple[int, Dict[str, Any]]:
        url = urljoin(self.base_url, path)
        body = None
        if payload is not None:
            body = json.dumps(payload).encode("utf-8")
        req = Request(url, data=body, method=method, headers=self._headers(json_body=True))
        try:
            with urlopen(req, timeout=self.timeout, context=self.ssl_context) as resp:
                raw = resp.read().decode("utf-8")
                parsed = json.loads(raw) if raw else {}
                if isinstance(parsed, dict):
                    return int(resp.status), parsed
                return int(resp.status), {"_list": parsed}
        except HTTPError as exc:
            raw = exc.read().decode("utf-8")
            parsed: Dict[str, Any]
            try:
                tmp = json.loads(raw) if raw else {}
                parsed = tmp if isinstance(tmp, dict) else {"_list": tmp}
            except json.JSONDecodeError:
                parsed = {"error": raw}
            return int(exc.code), parsed

    def get_session(self, session_id: str) -> Dict[str, Any]:
        status, payload = self._request_json("GET", f"/api/scan/session/{session_id}")
        if status != 200:
            raise AssertionError(f"GET /api/scan/session/{session_id} failed: {status} {payload}")
        return payload

    def get_history(self) -> list[Dict[str, Any]]:
        status, payload = self._request_json("GET", "/api/history?origin=scanned")
        if status != 200:
            raise AssertionError(f"GET /api/history failed: {status} {payload}")
        entries = payload.get("_list")
        if not isinstance(entries, list):
            raise AssertionError("GET /api/history did not return a list")
        out: list[Dict[str, Any]] = []
        for item in entries:
            if isinstance(item, dict):
                out.append(item)
        return out

    def upload_packet_raw(
        self,
        session_id: str,
        packet: bytes,
        expected_packets: int,
        actor: Actor,
    ) -> Tuple[int, Dict[str, Any]]:
        payload = {
            "sessionId": session_id,
            "packetBase64": base64.b64encode(packet).decode("ascii"),
            "expectedPackets": expected_packets,
            "totalPackets": expected_packets,
            # Intentionally stale; server must remain authoritative.
            "receivedPackets": 0,
            "filename": "cross-device-real.bin",
            "deviceName": actor.name,
            "deviceId": actor.device_id,
            "isStreaming": False,
            "capturedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        }
        return self._request_json("POST", "/api/scan/packet", payload)

    def upload_packet(
        self,
        session_id: str,
        packet: bytes,
        expected_packets: int,
        actor: Actor,
    ) -> None:
        status, body = self.upload_packet_raw(
            session_id=session_id,
            packet=packet,
            expected_packets=expected_packets,
            actor=actor,
        )
        if status != 200 or body.get("ok") is not True:
            raise AssertionError(f"POST /api/scan/packet failed: {status} {body}")

    def complete_session(self, session_id: str, actor: Actor) -> None:
        file_bytes = f"complete-{session_id}-{actor.key}".encode("utf-8")
        query = urlencode(
            {
                "sessionId": session_id,
                "filename": "cross-device-real-complete.bin",
                "fileSize": len(file_bytes),
                "mimeType": "application/octet-stream",
                "duration": 1.0,
                "completedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "deviceName": actor.name,
                "deviceId": actor.device_id,
            }
        )
        req = Request(
            urljoin(self.base_url, f"/api/scan/complete?{query}"),
            data=file_bytes,
            method="POST",
            headers=self._headers(json_body=False) | {"Content-Type": "application/octet-stream"},
        )
        try:
            with urlopen(req, timeout=self.timeout, context=self.ssl_context) as resp:
                raw = resp.read().decode("utf-8")
                body = json.loads(raw) if raw else {}
                status = int(resp.status)
        except HTTPError as exc:
            raw = exc.read().decode("utf-8")
            try:
                parsed = json.loads(raw) if raw else {}
                body = parsed if isinstance(parsed, dict) else {"_list": parsed}
            except json.JSONDecodeError:
                body = {"error": raw}
            status = int(exc.code)
        if status != 200 or body.get("ok") is not True:
            raise AssertionError(f"POST /api/scan/complete failed: {status} {body}")


def _events_url(base_url: str, username: Optional[str], password: Optional[str], api_key: Optional[str]) -> str:
    params: Dict[str, str] = {}
    if api_key:
        params["apiKey"] = api_key
    elif username is not None and password is not None:
        params["username"] = username
        params["password"] = password
    query = urlencode(params)
    return urljoin(base_url, f"/api/events?{query}") if query else urljoin(base_url, "/api/events")


def _sse_listener(
    events_url: str,
    ssl_context: Optional[ssl.SSLContext],
    timeout: float,
    out_queue: "queue.Queue[Tuple[str, Dict[str, Any]]]",
    stop_event: threading.Event,
) -> None:
    req = Request(events_url, method="GET", headers={"Accept": "text/event-stream"})
    try:
        with urlopen(req, timeout=timeout, context=ssl_context) as resp:
            event_type: Optional[str] = None
            data_lines: list[str] = []
            while not stop_event.is_set():
                raw_line = resp.readline()
                if not raw_line:
                    return
                line = raw_line.decode("utf-8", errors="replace").strip()
                if line.startswith("event:"):
                    event_type = line[6:].strip()
                elif line.startswith("data:"):
                    data_lines.append(line[5:].strip())
                elif line == "":
                    if event_type:
                        data_raw = "".join(data_lines) if data_lines else "{}"
                        try:
                            payload = json.loads(data_raw)
                        except json.JSONDecodeError:
                            payload = {}
                        if isinstance(payload, dict):
                            out_queue.put((event_type, payload))
                    event_type = None
                    data_lines = []
    except Exception:
        return


def _wait_sse_progress(
    q: "queue.Queue[Tuple[str, Dict[str, Any]]]",
    session_id: str,
    min_received: int,
    expected_device_name: Optional[str],
    timeout_s: float,
) -> bool:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        remaining = max(0.05, deadline - time.time())
        try:
            event_type, payload = q.get(timeout=remaining)
        except queue.Empty:
            continue
        if event_type != "scan-progress":
            continue
        if str(payload.get("sessionId")) != session_id:
            continue
        received = payload.get("receivedCount", payload.get("receivedPackets", 0))
        device_name = str(payload.get("deviceName") or "")
        if _as_int(received, 0) >= min_received and (
            expected_device_name is None or device_name == expected_device_name
        ):
            return True
    return False


def _wait_sse_complete(
    q: "queue.Queue[Tuple[str, Dict[str, Any]]]",
    session_id: str,
    timeout_s: float,
) -> bool:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        remaining = max(0.05, deadline - time.time())
        try:
            event_type, payload = q.get(timeout=remaining)
        except queue.Empty:
            continue
        if event_type != "scan-complete":
            continue
        if str(payload.get("sessionId")) != session_id:
            continue
        if _as_bool(payload.get("completed", True)):
            return True
    return False


def _actors(args: argparse.Namespace) -> Dict[str, Actor]:
    return {
        "web": Actor(key="web", name=args.web_device_name, device_id=args.web_device_id),
        "flutter": Actor(
            key="flutter",
            name=args.flutter_device_name,
            device_id=args.flutter_device_id,
        ),
    }


def _scenarios(expected_packets: int) -> Dict[str, Scenario]:
    # Keep non-complete scenarios moderate for fast runs.
    mid = max(8, min(24, expected_packets // 3))
    small = max(6, min(16, expected_packets // 4))

    return {
        "web_to_flutter": Scenario(
            name="web_to_flutter",
            description="init web, resume flutter",
            steps=(("web", mid), ("flutter", mid)),
            duplicates=2,
        ),
        "flutter_to_web": Scenario(
            name="flutter_to_web",
            description="init flutter, resume web",
            steps=(("flutter", mid), ("web", mid)),
            duplicates=2,
        ),
        "web_flutter_web": Scenario(
            name="web_flutter_web",
            description="init web, resume flutter, resume web",
            steps=(("web", small), ("flutter", small), ("web", small)),
            duplicates=2,
        ),
        "flutter_web_flutter": Scenario(
            name="flutter_web_flutter",
            description="init flutter, resume web, resume flutter",
            steps=(("flutter", small), ("web", small), ("flutter", small)),
            duplicates=2,
        ),
        "web_complete": Scenario(
            name="web_complete",
            description="web runs scan to completion",
            steps=(("web", expected_packets),),
            duplicates=1,
            complete_actor="web",
        ),
        "flutter_complete": Scenario(
            name="flutter_complete",
            description="flutter runs scan to completion",
            steps=(("flutter", expected_packets),),
            duplicates=1,
            complete_actor="flutter",
        ),
    }


def _find_history_entry(entries: Sequence[Dict[str, Any]], session_id: str) -> Optional[Dict[str, Any]]:
    for item in entries:
        if str(item.get("sessionId") or item.get("id")) == session_id:
            return item
    return None


def _assert_session_history_state(
    client: ServerClient,
    session_id: str,
    expected_received: int,
    expected_packets: int,
    expected_completed: bool,
    timeout_s: float,
) -> Dict[str, Any]:
    deadline = time.time() + timeout_s
    last_error = "state did not converge"
    while time.time() < deadline:
        session = client.get_session(session_id)
        session_received = _get_int(session, "receivedCount", "receivedPackets", "packetCount")
        session_expected = _get_int(session, "expectedPackets", "totalPackets")
        session_completed = _is_completed(session)

        entries = client.get_history()
        history_entry = _find_history_entry(entries, session_id)
        if history_entry is None:
            last_error = f"session {session_id} not found in /api/history"
            time.sleep(0.15)
            continue
        history_received = _get_int(history_entry, "receivedCount", "receivedPackets", "packetCount")
        history_expected = _get_int(history_entry, "expectedPackets", "totalPackets")
        history_completed = _is_completed(history_entry)

        checks = [
            (session_received == expected_received, f"session received={session_received}, expected={expected_received}"),
            (session_expected >= expected_packets, f"session expectedPackets={session_expected}, required>={expected_packets}"),
            (history_received == session_received, f"history/session received mismatch: {history_received} vs {session_received}"),
            (history_expected == session_expected, f"history/session expected mismatch: {history_expected} vs {session_expected}"),
            (session_completed == expected_completed, f"session completed={session_completed}, expected={expected_completed}"),
            (history_completed == expected_completed, f"history completed={history_completed}, expected={expected_completed}"),
        ]
        failed = [msg for ok, msg in checks if not ok]
        if not failed:
            return session

        last_error = "; ".join(failed)
        time.sleep(0.15)

    raise AssertionError(last_error)


def _make_session_id(base: Optional[str], scenario_index: int) -> str:
    if not base:
        return str(int(time.time() * 1000) + scenario_index)
    try:
        return str(int(base) + scenario_index)
    except Exception:
        return f"{base}_{scenario_index + 1}"


def _run_single_scenario(
    client: ServerClient,
    scenario: Scenario,
    session_id: str,
    expected_packets: int,
    actors: Dict[str, Actor],
    check_sse: bool,
    sse_queue: "queue.Queue[Tuple[str, Dict[str, Any]]]",
    sse_timeout: float,
    consistency_timeout: float,
) -> None:
    print(f"[scenario] {scenario.name}: {scenario.description}")
    packet_index = 0
    received_expected = 0
    step_count = len(scenario.steps)

    for step_no, (actor_key, packet_count) in enumerate(scenario.steps, start=1):
        actor = actors[actor_key]
        print(f"[scenario:{scenario.name}] step {step_no}/{step_count}: actor={actor.key} packets={packet_count}")
        for _ in range(packet_count):
            client.upload_packet(
                session_id=session_id,
                packet=_packet_bytes(packet_index),
                expected_packets=expected_packets,
                actor=actor,
            )
            packet_index += 1
            received_expected += 1

        if check_sse:
            ok = _wait_sse_progress(
                sse_queue,
                session_id=session_id,
                min_received=received_expected,
                expected_device_name=actor.name,
                timeout_s=sse_timeout,
            )
            if not ok:
                raise AssertionError(
                    f"[{scenario.name}] missing SSE scan-progress for received>={received_expected} from device={actor.name}"
                )

        _assert_session_history_state(
            client=client,
            session_id=session_id,
            expected_received=received_expected,
            expected_packets=expected_packets,
            expected_completed=False,
            timeout_s=consistency_timeout,
        )

    if scenario.duplicates > 0 and received_expected > 0:
        actor_key = scenario.steps[-1][0]
        actor = actors[actor_key]
        last_packet = _packet_bytes(packet_index - 1)
        for _ in range(scenario.duplicates):
            client.upload_packet(
                session_id=session_id,
                packet=last_packet,
                expected_packets=expected_packets,
                actor=actor,
            )
        _assert_session_history_state(
            client=client,
            session_id=session_id,
            expected_received=received_expected,
            expected_packets=expected_packets,
            expected_completed=False,
            timeout_s=consistency_timeout,
        )

    if scenario.complete_actor:
        actor = actors[scenario.complete_actor]
        print(f"[scenario:{scenario.name}] completing session with actor={actor.key}")
        client.complete_session(session_id=session_id, actor=actor)
        if check_sse:
            ok = _wait_sse_complete(
                sse_queue,
                session_id=session_id,
                timeout_s=sse_timeout,
            )
            if not ok:
                raise AssertionError(f"[{scenario.name}] missing SSE scan-complete event")

        _assert_session_history_state(
            client=client,
            session_id=session_id,
            expected_received=received_expected,
            expected_packets=expected_packets,
            expected_completed=True,
            timeout_s=consistency_timeout,
        )

        # Late packets after completion must be ignored and counters must stay stable.
        status, body = client.upload_packet_raw(
            session_id=session_id,
            packet=_packet_bytes(packet_index),
            expected_packets=expected_packets,
            actor=actor,
        )
        if status != 200 or body.get("ok") is not True:
            raise AssertionError(f"[{scenario.name}] late packet failed: {status} {body}")
        if body.get("ignored") != "completed":
            raise AssertionError(f"[{scenario.name}] late packet should be ignored=completed, got: {body}")

        _assert_session_history_state(
            client=client,
            session_id=session_id,
            expected_received=received_expected,
            expected_packets=expected_packets,
            expected_completed=True,
            timeout_s=consistency_timeout,
        )

    print(
        f"[ok] {scenario.name}: session={session_id} "
        f"received={received_expected} expected={expected_packets} complete={bool(scenario.complete_actor)}"
    )


def run(args: argparse.Namespace) -> int:
    ssl_context: Optional[ssl.SSLContext] = None
    if args.insecure:
        ssl_context = ssl._create_unverified_context()

    parsed = urlparse(args.server_url)
    if parsed.scheme not in ("http", "https"):
        raise SystemExit("server-url must start with http:// or https://")
    base_url = args.server_url.rstrip("/")

    client = ServerClient(
        base_url=base_url,
        username=args.username,
        password=args.password,
        api_key=args.api_key,
        ssl_context=ssl_context,
        timeout=args.timeout,
    )

    actors = _actors(args)
    scenarios = _scenarios(expected_packets=args.expected_packets)

    if args.list_scenarios:
        print("Available scenarios:")
        for name in SCENARIO_NAMES:
            sc = scenarios[name]
            print(f"- {name}: {sc.description}")
        return 0

    if args.scenario == "all":
        scenario_names = list(SCENARIO_NAMES)
    else:
        scenario_names = [args.scenario]

    sse_queue: "queue.Queue[Tuple[str, Dict[str, Any]]]" = queue.Queue()
    sse_stop = threading.Event()
    sse_thread: Optional[threading.Thread] = None
    if args.check_sse:
        events_url = _events_url(base_url, args.username, args.password, args.api_key)
        print(f"[info] SSE listening on {events_url}")
        sse_thread = threading.Thread(
            target=_sse_listener,
            args=(events_url, ssl_context, args.timeout, sse_queue, sse_stop),
            daemon=True,
        )
        sse_thread.start()
        time.sleep(0.3)

    print(f"[info] running {len(scenario_names)} scenario(s): {', '.join(scenario_names)}")
    failures: list[str] = []
    try:
        for idx, scenario_name in enumerate(scenario_names):
            scenario = scenarios[scenario_name]
            session_id = _make_session_id(args.session_id, idx)
            print(f"[info] session_id={session_id}")
            try:
                _run_single_scenario(
                    client=client,
                    scenario=scenario,
                    session_id=session_id,
                    expected_packets=args.expected_packets,
                    actors=actors,
                    check_sse=args.check_sse,
                    sse_queue=sse_queue,
                    sse_timeout=args.sse_timeout,
                    consistency_timeout=args.consistency_timeout,
                )
            except Exception as exc:
                failures.append(f"{scenario_name}: {exc}")
                if not args.keep_going:
                    break
    finally:
        if args.check_sse:
            sse_stop.set()
            if sse_thread is not None:
                sse_thread.join(timeout=1.0)

    if failures:
        for failure in failures:
            print(f"[fail] {failure}")
        return 2

    print("[ok] cross-device real matrix passed")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run real cross-device sync scenario matrix against sync server")
    parser.add_argument("--server-url", required=True, help="Example: https://192.168.1.100:8081")
    parser.add_argument("--username", help="Basic auth username")
    parser.add_argument("--password", help="Basic auth password")
    parser.add_argument("--api-key", help="API key auth (alternative to username/password)")
    parser.add_argument("--session-id", help="Optional fixed session ID seed")
    parser.add_argument("--scenario", choices=("all",) + SCENARIO_NAMES, default="all")
    parser.add_argument("--list-scenarios", action="store_true", default=False)
    parser.add_argument("--keep-going", action="store_true", default=False, help="Continue running next scenarios after a failure")
    parser.add_argument("--expected-packets", type=int, default=86)
    parser.add_argument("--check-sse", action="store_true", default=False)
    parser.add_argument("--sse-timeout", type=float, default=8.0)
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument("--consistency-timeout", type=float, default=8.0)
    parser.add_argument("--insecure", action="store_true", default=False, help="Disable TLS cert verification")
    parser.add_argument("--web-device-name", default="iOS Browser")
    parser.add_argument("--web-device-id", default="web-device-e2e")
    parser.add_argument("--flutter-device-name", default="Android Flutter")
    parser.add_argument("--flutter-device-id", default="flutter-device-e2e")
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    if not args.api_key and (not args.username or not args.password):
        parser.error("provide either --api-key OR both --username and --password")
    try:
        return run(args)
    except (AssertionError, URLError, HTTPError) as exc:
        print(f"[fail] {exc}")
        return 2
    except Exception as exc:
        print(f"[error] unexpected failure: {exc}")
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
