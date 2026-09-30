from __future__ import annotations

import asyncio
import ipaddress
import logging
import socket
import ssl
import threading
from http import HTTPStatus
from http.server import HTTPServer
from pathlib import Path
from socketserver import ThreadingMixIn
from typing import Any, Callable, Optional, Union

from .auth import AuthManager
from .config import ServerConfig
from .events import EventHub
from .exporter import ExportManager
from .handler import ServerContext, create_handler
from .migration import migrate_json_to_sqlite
from .observability import build_startup_summary, format_kv_log
from .retention import apply_retention
from .settings_store import SettingsStore
from .sqlite_storage import SqliteStorage
from .storage import Storage
from .ws_events import WebSocketEventHub, handle_events_client
from .ws_scan_handler import handle_scan_client
from .ws_scan_session import ScanSessionStore

logger = logging.getLogger(__name__)

_INVALID_SESSION_RESPONSE_BODY = b"Invalid session ID\n"


def _process_ws_request(connection: Any, request: Any) -> Any:
    path = request.path
    if not any(path.startswith(prefix) for prefix in SCAN_PATH_PREFIXES):
        return None
    if scan_session_id_from_path(path) is not None:
        return None

    return connection.respond(
        HTTPStatus.BAD_REQUEST,
        _INVALID_SESSION_RESPONSE_BODY.decode("ascii"),
    )


class _MaxLevelFilter(logging.Filter):
    def __init__(self, max_level: int) -> None:
        super().__init__()
        self.max_level = max_level

    def filter(self, record: logging.LogRecord) -> bool:
        return record.levelno <= self.max_level

# Check if websockets is available
try:
    import websockets
    from .ws_same_port import (
        SCAN_PATH_PREFIXES,
        detect_same_port_websocket_target,
        handle_same_port_websocket,
        scan_session_id_from_path,
    )
    HAS_WEBSOCKETS = True
except ImportError:
    HAS_WEBSOCKETS = False
    detect_same_port_websocket_target = None
    handle_same_port_websocket = None
    scan_session_id_from_path = None
    SCAN_PATH_PREFIXES = ()
    logger.warning("websockets not installed, WebSocket support disabled")


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def __init__(
        self,
        *args,
        verbose: bool = False,
        same_port_ws: bool = False,
        event_hub: Optional[EventHub] = None,
        ws_hub: Optional[WebSocketEventHub] = None,
        scan_session_store: Optional[ScanSessionStore] = None,
        auth_manager: Optional[AuthManager] = None,
        storage: Optional[Union[Storage, SqliteStorage]] = None,
        **kwargs,
    ):
        self.verbose = verbose
        self.same_port_ws = same_port_ws
        self.event_hub = event_hub
        self.ws_hub = ws_hub
        self.scan_session_store = scan_session_store
        self.auth_manager = auth_manager
        self.storage = storage
        super().__init__(*args, **kwargs)

    def process_request_thread(self, request: Any, client_address: Any) -> None:
        try:
            if self.same_port_ws and self.ws_hub is not None:
                target, request = detect_same_port_websocket_target(request)
                if target is not None:
                    if target.session_id is None or self.scan_session_store is not None:
                        handle_same_port_websocket(
                            request,
                            target,
                            event_hub=self.event_hub,
                            ws_hub=self.ws_hub,
                            scan_session_store=self.scan_session_store,
                            auth_manager=self.auth_manager,
                            storage=self.storage,
                        )
                        return

            self.finish_request(request, client_address)
        except Exception:
            self.handle_error(request, client_address)
        finally:
            self.shutdown_request(request)


def _default_log_dir() -> Path:
    app_path = Path(__file__).resolve()
    if len(app_path.parents) >= 4:
        return app_path.parents[3] / "tmp"
    return Path.cwd() / "tmp"


def configure_logging(verbose: bool, log_dir: Optional[Path] = None) -> None:
    level = logging.DEBUG if verbose else logging.INFO
    formatter = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )

    handlers: list[logging.Handler] = []

    console_handler = logging.StreamHandler()
    console_handler.setLevel(level)
    console_handler.setFormatter(formatter)
    handlers.append(console_handler)

    target_log_dir = log_dir or _default_log_dir()
    try:
        target_log_dir.mkdir(parents=True, exist_ok=True)

        info_handler = logging.FileHandler(
            target_log_dir / "airqr-sync-live.out.log",
            mode="w",
            encoding="utf-8",
        )
        info_handler.setLevel(level)
        info_handler.addFilter(_MaxLevelFilter(logging.WARNING))
        info_handler.setFormatter(formatter)
        handlers.append(info_handler)

        error_handler = logging.FileHandler(
            target_log_dir / "airqr-sync-live.err.log",
            mode="w",
            encoding="utf-8",
        )
        error_handler.setLevel(logging.ERROR)
        error_handler.setFormatter(formatter)
        handlers.append(error_handler)
    except OSError as exc:
        console_handler.handle(
            logging.makeLogRecord(
                {
                    "levelno": logging.WARNING,
                    "levelname": "WARNING",
                    "msg": "Failed to initialize persistent sync logs: %s",
                    "args": (exc,),
                    "name": __name__,
                }
            )
        )

    logging.basicConfig(
        level=level,
        handlers=handlers,
        force=True,
    )


def _discover_lan_hosts() -> list[str]:
    hosts: set[str] = set()

    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            candidate = sock.getsockname()[0]
            ip = ipaddress.ip_address(candidate)
            if not ip.is_loopback and not ip.is_link_local:
                hosts.add(candidate)
    except OSError:
        pass

    try:
        for family, _type, _proto, _canonname, sockaddr in socket.getaddrinfo(
            socket.gethostname(),
            None,
            family=socket.AF_INET,
            type=socket.SOCK_STREAM,
        ):
            if family != socket.AF_INET:
                continue
            candidate = sockaddr[0]
            ip = ipaddress.ip_address(candidate)
            if ip.is_loopback or ip.is_link_local:
                continue
            hosts.add(candidate)
    except OSError:
        pass

    return sorted(hosts)


def _build_access_urls(
    host: str,
    port: int,
    scheme: str,
    *,
    lan_hosts: Optional[list[str]] = None,
) -> list[str]:
    if host not in {"0.0.0.0", "::", ""}:
        return [f"{scheme}://{host}:{port}"]

    urls = [f"{scheme}://localhost:{port}"]
    candidates = lan_hosts if lan_hosts is not None else _discover_lan_hosts()
    for candidate in candidates:
        try:
            ip = ipaddress.ip_address(candidate)
        except ValueError:
            continue
        if ip.is_loopback or ip.is_link_local:
            continue
        urls.append(f"{scheme}://{candidate}:{port}")
    return urls


def create_server(config: ServerConfig, context: ServerContext) -> ThreadedHTTPServer:
    handler = create_handler(context)
    same_port_ws = HAS_WEBSOCKETS and config.ws_port == config.port and context.ws_hub is not None
    server = ThreadedHTTPServer(
        (config.host, config.port),
        handler,
        verbose=config.verbose,
        same_port_ws=same_port_ws,
        event_hub=context.event_hub,
        ws_hub=context.ws_hub,
        scan_session_store=ScanSessionStore() if same_port_ws else None,
        auth_manager=context.auth,
        storage=context.storage,
    )

    if config.tls_cert and config.tls_key:
        context_ssl = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context_ssl.load_cert_chain(certfile=str(config.tls_cert), keyfile=str(config.tls_key))
        server.socket = context_ssl.wrap_socket(server.socket, server_side=True)

    return server


def run_ws_server(
    ws_hub: WebSocketEventHub,
    scan_session_store: ScanSessionStore,
    storage: Union[Storage, SqliteStorage],
    host: str,
    port: int,
    auth_manager: AuthManager,
    ssl_context: Optional[ssl.SSLContext] = None,
    event_hub: Optional[EventHub] = None,
    ready_callback: Optional[Callable[[int], None]] = None,
    stop_event: Optional[threading.Event] = None,
) -> None:
    """Run WebSocket server in a separate thread."""

    async def handler(websocket: Any) -> None:
        path = websocket.request.path

        if (
            path.startswith("/api/v1/ws/events")
            or path.startswith("/api/ws/events")
            or path.startswith("/ws/events")
        ):
            await handle_events_client(websocket, ws_hub, auth_manager)
        elif (
            path.startswith("/api/v1/ws/scan/")
            or path.startswith("/api/ws/scan/")
            or path.startswith("/ws/scan/")
        ):
            session_id = scan_session_id_from_path(path)
            if session_id:
                await handle_scan_client(
                    websocket,
                    session_id,
                    scan_session_store,
                    auth_manager,
                    storage=storage,
                    emit_event=lambda event_type, payload: ws_hub.broadcast_threadsafe(
                        event_type, payload
                    ),
                    emit_history_event=(
                        (lambda payload: event_hub.publish("history", payload))
                        if event_hub is not None
                        else None
                    ),
                )
            else:
                await websocket.close(4003, "Missing session ID")
        else:
            await websocket.close(4003, "Unknown endpoint")

    async def serve() -> None:
        ws_hub.bind_loop(asyncio.get_running_loop())
        async with websockets.serve(
            handler,
            host,
            port,
            ssl=ssl_context,
            process_request=_process_ws_request,
        ) as server:
            if ready_callback is not None:
                bound_port = int(server.sockets[0].getsockname()[1])
                ready_callback(bound_port)
            if stop_event is None:
                await asyncio.Future()  # Run forever
            else:
                await asyncio.to_thread(stop_event.wait)

    asyncio.run(serve())


def run_server(config: ServerConfig) -> int:
    configure_logging(config.verbose)

    # Choose storage backend
    storage: Union[Storage, SqliteStorage]
    if config.use_sqlite:
        logger.info("Using SQLite storage")
        migrate_json_to_sqlite(config.storage_dir)
        storage = SqliteStorage(config.storage_dir)
    else:
        logger.warning(
            "JSON storage mode is deprecated and will be removed in v2.0. "
            "Please migrate to SQLite (default). Run without --no-sqlite to use SQLite."
        )
        storage = Storage(config.storage_dir)

    storage.ensure_dirs()
    retention_result = apply_retention(
        storage,
        retention_incomplete_days=config.retention_incomplete_days,
        retention_history_days=config.retention_history_days,
    )
    logger.info(
        format_kv_log(
            "server.retention",
            deleted_incomplete_sessions=retention_result.deleted_incomplete_sessions,
            deleted_history_items=retention_result.deleted_history_items,
            retention_incomplete_days=config.retention_incomplete_days,
            retention_history_days=config.retention_history_days,
        )
    )

    from .auth import RateLimiter
    rate_limiter = RateLimiter(max_attempts=5, window_seconds=60)
    auth = AuthManager(
        config.users_file,
        rate_limiter=rate_limiter,
        trusted_proxies=config.trusted_proxies,
    )
    export_manager = ExportManager(config.storage_dir / "export_config.json", config.export_dir)
    settings_store = SettingsStore(config.storage_dir / "app_settings.json")
    event_hub = EventHub()
    ws_hub: Optional[WebSocketEventHub] = None
    scan_session_store: Optional[ScanSessionStore] = None

    # Start WebSocket server if enabled
    if HAS_WEBSOCKETS and config.ws_port:
        ws_hub = WebSocketEventHub()
        scan_session_store = ScanSessionStore()

        # Create SSL context for WS if TLS is enabled
        ws_ssl_context: Optional[ssl.SSLContext] = None
        if config.tls_cert and config.tls_key:
            ws_ssl_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ws_ssl_context.load_cert_chain(certfile=str(config.tls_cert), keyfile=str(config.tls_key))

        if config.ws_port != config.port:
            ws_thread = threading.Thread(
                target=run_ws_server,
                args=(
                    ws_hub,
                    scan_session_store,
                    storage,
                    config.host,
                    config.ws_port,
                    auth,
                    ws_ssl_context,
                    event_hub,
                ),
                daemon=True,
            )
            ws_thread.start()
            logger.info("WebSocket server: %s://%s:%s", config.ws_scheme, config.host, config.ws_port)

    context = ServerContext(
        storage=storage,
        auth=auth,
        export_manager=export_manager,
        settings_store=settings_store,
        event_hub=event_hub,
        ws_hub=ws_hub,
        allowed_origins=config.allowed_origins,
        static_dir=config.static_dir,
        verbose=config.verbose,
        rate_limiter=rate_limiter,
        trusted_proxies=config.trusted_proxies,
    )

    server = create_server(config, context)
    if scan_session_store is not None:
        server.scan_session_store = scan_session_store

    access_urls = _build_access_urls(config.host, config.port, config.scheme)
    startup_summary = build_startup_summary(
        config=config,
        access_urls=access_urls,
        has_users_file=config.users_file.exists(),
        has_websockets=HAS_WEBSOCKETS,
        retention_result=retention_result,
    )
    logger.info(format_kv_log("server.start", **startup_summary))

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0
