"""Tests for config file loading."""

import json
import tempfile
from pathlib import Path

import pytest

from sync_server.config_loader import load_config_file, merge_config


class TestConfigLoader:
    """Test configuration file loading."""

    def test_load_json_config(self, tmp_path) -> None:
        """Should load JSON config file."""
        config_file = tmp_path / "config.json"
        config_file.write_text(json.dumps({
            "host": "127.0.0.1",
            "port": 9000,
            "storage_dir": "/data/storage",
        }))

        config = load_config_file(config_file)
        assert config["host"] == "127.0.0.1"
        assert config["port"] == 9000

    def test_load_missing_config_returns_empty(self) -> None:
        """Should return empty dict for missing file."""
        config = load_config_file(Path("/nonexistent/config.json"))
        assert config == {}

    def test_load_invalid_json_returns_empty(self, tmp_path) -> None:
        """Should return empty dict for invalid JSON."""
        config_file = tmp_path / "config.json"
        config_file.write_text("{ invalid json }")

        config = load_config_file(config_file)
        assert config == {}

    def test_cli_overrides_config_file(self) -> None:
        """CLI args should override config file values."""
        file_config = {"host": "0.0.0.0", "port": 8080}
        cli_args = {"host": "127.0.0.1", "port": None}

        merged = merge_config(file_config, cli_args)
        assert merged["host"] == "127.0.0.1"  # CLI override
        assert merged["port"] == 8080  # File value (CLI is None)

    def test_merge_preserves_file_only_keys(self) -> None:
        """Merge should preserve keys only in file config."""
        file_config = {"host": "0.0.0.0", "extra_key": "value"}
        cli_args = {"host": "127.0.0.1"}

        merged = merge_config(file_config, cli_args)
        assert merged["extra_key"] == "value"

    def test_load_empty_json_returns_empty(self, tmp_path) -> None:
        """Should return empty dict for empty JSON file."""
        config_file = tmp_path / "config.json"
        config_file.write_text("{}")

        config = load_config_file(config_file)
        assert config == {}
