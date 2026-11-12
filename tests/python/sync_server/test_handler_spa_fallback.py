from __future__ import annotations

from http.server import SimpleHTTPRequestHandler
from pathlib import Path
from unittest.mock import MagicMock, patch

from sync_server.handler import SyncRequestHandler


def _make_handler(static_dir: Path, path: str, accept: str) -> SyncRequestHandler:
    handler = object.__new__(SyncRequestHandler)
    handler.context = MagicMock()
    handler.context.static_dir = static_dir
    handler.path = path
    handler.headers = {"Accept": accept}
    handler.directory = str(static_dir)
    return handler


def test_should_serve_spa_fallback_for_client_route(tmp_path: Path) -> None:
    handler = _make_handler(tmp_path, "/settings", "text/html")

    assert SyncRequestHandler._should_serve_spa_fallback(handler, "/settings") is True


def test_should_not_serve_spa_fallback_for_asset_request(tmp_path: Path) -> None:
    handler = _make_handler(tmp_path, "/assets/app.js", "*/*")

    assert SyncRequestHandler._should_serve_spa_fallback(handler, "/assets/app.js") is False


def test_do_get_rewrites_client_route_to_index_html(tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text("<html>ok</html>", encoding="utf-8")
    handler = _make_handler(tmp_path, "/settings", "text/html")

    observed_paths: list[str] = []

    def fake_super(self: SyncRequestHandler) -> None:
        observed_paths.append(self.path)

    with patch.object(SimpleHTTPRequestHandler, "do_GET", autospec=True, side_effect=fake_super):
        SyncRequestHandler.do_GET(handler)

    assert observed_paths == ["/index.html"]
    assert handler.path == "/settings"


def test_do_get_keeps_missing_asset_as_plain_static_request(tmp_path: Path) -> None:
    handler = _make_handler(tmp_path, "/assets/missing.js", "*/*")

    observed_paths: list[str] = []

    def fake_super(self: SyncRequestHandler) -> None:
        observed_paths.append(self.path)

    with patch.object(SimpleHTTPRequestHandler, "do_GET", autospec=True, side_effect=fake_super):
        SyncRequestHandler.do_GET(handler)

    assert observed_paths == ["/assets/missing.js"]
