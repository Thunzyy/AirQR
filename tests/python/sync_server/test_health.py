"""Tests for health endpoints."""

import json
import tempfile
from pathlib import Path
from http import HTTPStatus
from unittest.mock import MagicMock, PropertyMock

import pytest

from sync_server.handler import SyncRequestHandler, ServerContext


class MockStorage:
    """Mock storage for testing."""
    def __init__(self, base_dir: Path):
        self.base_dir = base_dir


class MockSqliteStorage:
    """Mock SQLite storage for testing."""
    def __init__(self, base_dir: Path):
        self.base_dir = base_dir
        self.db = MagicMock()


class TestHealthEndpoints:
    """Test health check endpoints."""

    def test_handle_health_returns_ok(self) -> None:
        """_handle_health should return status ok."""
        handler = MagicMock(spec=SyncRequestHandler)
        handler._send_json = MagicMock()

        # Call the method directly
        SyncRequestHandler._handle_health(handler)

        handler._send_json.assert_called_once()
        args = handler._send_json.call_args[0]
        assert args[0] == HTTPStatus.OK
        assert args[1]["status"] == "ok"
        assert "version" in args[1]

    def test_handle_health_includes_build_identity(self, monkeypatch) -> None:
        """_handle_health should expose the running build identity."""
        monkeypatch.setenv("AIRQR_VERSION", "1.2.3")
        monkeypatch.setenv("AIRQR_COMMIT", "abc123")
        monkeypatch.setenv("AIRQR_BUILD_TIME", "2026-06-24T15:00:00Z")
        handler = MagicMock(spec=SyncRequestHandler)
        handler._send_json = MagicMock()

        SyncRequestHandler._handle_health(handler)

        payload = handler._send_json.call_args[0][1]
        assert payload["status"] == "ok"
        assert payload["name"] == "AirQR Sync Server"
        assert payload["version"] == "1.2.3"
        assert payload["commit"] == "abc123"
        assert payload["buildTime"] == "2026-06-24T15:00:00Z"
        assert payload["source"] == "env"

    def test_handle_version_returns_default_build_identity(self, monkeypatch) -> None:
        """_handle_version should expose explicit defaults without build env vars."""
        monkeypatch.delenv("AIRQR_VERSION", raising=False)
        monkeypatch.delenv("AIRQR_COMMIT", raising=False)
        monkeypatch.delenv("AIRQR_BUILD_TIME", raising=False)
        handler = MagicMock(spec=SyncRequestHandler)
        handler._send_json = MagicMock()

        SyncRequestHandler._handle_version(handler)

        payload = handler._send_json.call_args[0][1]
        assert payload == {
            "name": "AirQR Sync Server",
            "version": "1.0",
            "commit": "unknown",
            "buildTime": "unknown",
            "source": "default",
        }

    def test_handle_ready_with_valid_storage(self, tmp_path) -> None:
        """_handle_ready should return ready when storage is accessible."""
        handler = MagicMock(spec=SyncRequestHandler)
        handler._send_json = MagicMock()
        handler.context = MagicMock()
        handler.context.storage = MockStorage(tmp_path)

        SyncRequestHandler._handle_ready(handler)

        handler._send_json.assert_called_once()
        args = handler._send_json.call_args[0]
        assert args[0] == HTTPStatus.OK
        assert args[1]["status"] == "ready"
        assert args[1]["checks"]["storage"] == "ok"

    def test_handle_ready_with_sqlite_storage(self, tmp_path) -> None:
        """_handle_ready should check database when using SQLite."""
        handler = MagicMock(spec=SyncRequestHandler)
        handler._send_json = MagicMock()
        handler.context = MagicMock()

        # Mock SQLite storage with db attribute
        mock_storage = MockSqliteStorage(tmp_path)
        mock_conn = MagicMock()
        mock_storage.db.connection.return_value.__enter__ = lambda s: mock_conn
        mock_storage.db.connection.return_value.__exit__ = lambda s, *args: None
        handler.context.storage = mock_storage

        SyncRequestHandler._handle_ready(handler)

        handler._send_json.assert_called_once()
        args = handler._send_json.call_args[0]
        assert args[1]["checks"]["database"] == "ok"

    def test_handle_ready_with_missing_storage(self) -> None:
        """_handle_ready should return not_ready when storage is missing."""
        handler = MagicMock(spec=SyncRequestHandler)
        handler._send_json = MagicMock()
        handler.context = MagicMock()
        handler.context.storage = MockStorage(Path("/nonexistent/path"))

        SyncRequestHandler._handle_ready(handler)

        handler._send_json.assert_called_once()
        args = handler._send_json.call_args[0]
        assert args[0] == HTTPStatus.SERVICE_UNAVAILABLE
        assert args[1]["status"] == "not_ready"
        assert args[1]["checks"]["storage"] == "error"
