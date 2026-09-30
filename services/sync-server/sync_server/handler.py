from __future__ import annotations

from dataclasses import dataclass, field
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler
from pathlib import Path
from typing import Any, Dict, Optional, Union
from urllib.parse import urlparse

from .auth import AuthManager, RateLimiter
from .debug_scan_store import DebugScanSnapshotStore
from .events import EventHub
from .exporter import ExportManager
from .handler_events import (
    emit_event as helper_emit_event,
    emit_history_event as helper_emit_history_event,
)
from .handler_http import (
    build_session_file_path as helper_build_session_file_path,
    read_body_bytes as helper_read_body_bytes,
    read_json as helper_read_json,
    require_cookie_csrf as helper_require_cookie_csrf,
    request_is_secure as helper_request_is_secure,
    require_auth as helper_require_auth,
    send_bytes as helper_send_bytes,
    send_json as helper_send_json,
    stream_request_body_to_file as helper_stream_request_body_to_file,
)
from .handler_surface import (
    apply_surface_headers as helper_apply_surface_headers,
    handle_options as helper_handle_options,
    should_serve_spa_fallback as helper_should_serve_spa_fallback,
)
from .settings_store import SettingsStore
from .sqlite_storage import SqliteStorage
from .storage import Storage
from .routes_system import (
    handle_auth_credentials_post,
    handle_auth_login,
    handle_auth_logout,
    handle_auth_status,
    handle_export_config_get,
    handle_export_config_post,
    handle_health,
    handle_ready,
    handle_settings_get,
    handle_settings_post,
    handle_version,
)
from .routes_history import (
    handle_delete_history_item,
    handle_delete_session,
    handle_file_download,
    handle_history_all,
    handle_history_item,
    handle_history_item_download,
    handle_packets,
    handle_scan_history,
    handle_session_info,
)
from .routes_dispatch import dispatch_delete, dispatch_get, dispatch_post
from .routes_debug import (
    handle_debug_scan_live,
    handle_debug_scan_snapshot,
)
from .routes_scan_write import (
    _finalize_scan_completion as route_finalize_scan_completion,
    _maybe_finalize_scan_packet_session as route_maybe_finalize_scan_packet_session,
    handle_complete as route_handle_complete,
    handle_packet as route_handle_packet,
)
from .routes_sse import (
    handle_sse_events as route_handle_sse_events,
    require_sse_auth as route_require_sse_auth,
)
from .ws_events import WebSocketEventHub
 
HeaderValue = str | list[str]


@dataclass
class ServerContext:
    storage: Union[Storage, SqliteStorage]
    auth: AuthManager
    export_manager: ExportManager
    settings_store: SettingsStore
    event_hub: EventHub
    ws_hub: Optional[WebSocketEventHub]
    allowed_origins: list[str]
    static_dir: Optional[Path]
    verbose: bool
    rate_limiter: Optional["RateLimiter"] = None
    trusted_proxies: list[str] = field(default_factory=list)
    debug_scan_store: DebugScanSnapshotStore = field(
        default_factory=DebugScanSnapshotStore
    )


class SyncRequestHandler(SimpleHTTPRequestHandler):
    context: ServerContext

    def __init__(self, *args, **kwargs):
        directory = str(self.context.static_dir) if self.context.static_dir else None
        super().__init__(*args, directory=directory, **kwargs)

    def log_message(self, format, *args):
        if self.context.verbose:
            super().log_message(format, *args)

    def end_headers(self):
        helper_apply_surface_headers(self)
        super().end_headers()

    def do_OPTIONS(self):
        return helper_handle_options(self)

    def _send_json(
        self,
        status: int,
        payload: Any,
        extra_headers: Optional[Dict[str, HeaderValue]] = None,
    ) -> None:
        return helper_send_json(self, status, payload, extra_headers)

    def _send_bytes(
        self,
        status: int,
        payload: bytes,
        content_type: str,
        extra_headers: Optional[Dict[str, HeaderValue]] = None,
    ) -> None:
        return helper_send_bytes(self, status, payload, content_type, extra_headers)

    def _read_json(self) -> Optional[Dict[str, Any]]:
        return helper_read_json(self)

    def _stream_request_body_to_file(self, file_path: Path) -> int:
        return helper_stream_request_body_to_file(self, file_path)

    def _build_session_file_path(self, session_id: str, filename: str) -> Path:
        return helper_build_session_file_path(self, session_id, filename)

    def _finalize_scan_completion(
        self,
        *,
        session_id: str,
        file_path: Path,
        mime_type: Optional[str],
        file_size: int,
        duration: Any,
        total_chunks: Any,
        chunks_completed: Any,
        completed_at: Optional[str],
        device_id: Optional[str],
        device_name: Optional[str],
    ) -> None:
        return route_finalize_scan_completion(
            self,
            session_id=session_id,
            file_path=file_path,
            mime_type=mime_type,
            file_size=file_size,
            duration=duration,
            total_chunks=total_chunks,
            chunks_completed=chunks_completed,
            completed_at=completed_at,
            device_id=device_id,
            device_name=device_name,
        )

    def _maybe_finalize_scan_packet_session(
        self,
        session_id: str,
        session: dict[str, Any],
    ) -> bool:
        return route_maybe_finalize_scan_packet_session(self, session_id, session)

    def _read_body_bytes(self) -> bytes:
        return helper_read_body_bytes(self)

    def _request_is_secure(self) -> bool:
        return helper_request_is_secure(self)

    def _require_cookie_csrf(self) -> bool:
        return helper_require_cookie_csrf(self)

    def _require_auth(self) -> bool:
        return helper_require_auth(self)

    def _handle_auth_login(self) -> None:
        return handle_auth_login(self)

    def _handle_auth_logout(self) -> None:
        return handle_auth_logout(self)

    def _handle_auth_credentials_post(self) -> None:
        return handle_auth_credentials_post(self)

    def _require_sse_auth(self, params: Dict[str, list[str]]) -> bool:
        return route_require_sse_auth(self, params)

    def _handle_sse_events(self) -> None:
        return route_handle_sse_events(self)

    def _emit_history_event(self, payload: Dict[str, Any]) -> None:
        return helper_emit_history_event(self, payload)

    def _emit_event(self, event_type: str, payload: Dict[str, Any]) -> None:
        return helper_emit_event(self, event_type, payload)

    def _handle_packet(self):
        return route_handle_packet(self)

    def _handle_complete(self):
        return route_handle_complete(self)

    def _handle_scan_history(self):
        return handle_scan_history(self)

    def _handle_history_all(self):
        return handle_history_all(self)

    def _handle_packets(self, session_id: str):
        return handle_packets(self, session_id)

    def _handle_history_item(self):
        return handle_history_item(self)

    def _handle_export_config_get(self):
        return handle_export_config_get(self)

    def _handle_export_config_post(self):
        return handle_export_config_post(self)

    def _handle_settings_get(self):
        return handle_settings_get(self)

    def _handle_settings_post(self):
        return handle_settings_post(self)

    def _handle_auth_status(self):
        return handle_auth_status(self)

    def _handle_health(self):
        """Basic health check - always returns OK if server is running."""
        return handle_health(self)

    def _handle_version(self):
        """Build identity endpoint for deployment verification."""
        return handle_version(self)

    def _handle_ready(self):
        """Readiness check - verifies storage is accessible."""
        return handle_ready(self)

    def _handle_history_item_download(self, history_id: str):
        return handle_history_item_download(self, history_id)

    def _handle_delete_history_item(self, history_id: str):
        return handle_delete_history_item(self, history_id)

    def _handle_file_download(self, session_id: str):
        return handle_file_download(self, session_id)

    def _handle_delete_session(self, session_id: str):
        return handle_delete_session(self, session_id)

    def _handle_session_info(self, session_id: str):
        return handle_session_info(self, session_id)

    def _handle_debug_scan_snapshot(self, session_id: str):
        return handle_debug_scan_snapshot(self, session_id)

    def _handle_debug_scan_live(self, session_id: str):
        return handle_debug_scan_live(self, session_id)

    def do_POST(self):
        path = urlparse(self.path).path
        if dispatch_post(self, path):
            return
        if self.context.static_dir:
            return super().do_POST()
        self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})

    def _should_serve_spa_fallback(self, path: str) -> bool:
        return helper_should_serve_spa_fallback(self, path)

    def do_GET(self):
        path = urlparse(self.path).path
        if dispatch_get(self, path):
            return
        if self.context.static_dir:
            if self._should_serve_spa_fallback(path):
                original_path = self.path
                self.path = "/index.html"
                try:
                    return super().do_GET()
                finally:
                    self.path = original_path
            return super().do_GET()
        self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})

    def do_DELETE(self):
        path = urlparse(self.path).path
        if dispatch_delete(self, path):
            return
        self._send_json(HTTPStatus.NOT_FOUND, {"error": "Not found"})


def create_handler(context: ServerContext) -> type[SyncRequestHandler]:
    class Handler(SyncRequestHandler):
        pass

    Handler.context = context
    return Handler
