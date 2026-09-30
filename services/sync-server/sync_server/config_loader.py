"""Configuration file loader."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict

logger = logging.getLogger(__name__)

# Try to import PyYAML, fall back to JSON-only
try:
    import yaml
    HAS_YAML = True
except ImportError:
    HAS_YAML = False


def load_config_file(path: Path) -> Dict[str, Any]:
    """Load configuration from JSON or YAML file.

    Args:
        path: Path to config file

    Returns:
        Configuration dict (empty if file doesn't exist)
    """
    if not path.exists():
        return {}

    content = path.read_text(encoding="utf-8")

    if path.suffix in (".yaml", ".yml"):
        if not HAS_YAML:
            logger.warning("PyYAML not installed, cannot load %s", path)
            return {}
        return yaml.safe_load(content) or {}

    # Default to JSON
    try:
        return json.loads(content) or {}
    except json.JSONDecodeError as e:
        logger.error("Invalid JSON in %s: %s", path, e)
        return {}


def merge_config(
    file_config: Dict[str, Any],
    cli_args: Dict[str, Any],
) -> Dict[str, Any]:
    """Merge file config with CLI args. CLI takes precedence.

    Args:
        file_config: Values from config file
        cli_args: Values from command line (None means not specified)

    Returns:
        Merged configuration
    """
    merged = dict(file_config)

    for key, value in cli_args.items():
        if value is not None:
            merged[key] = value

    return merged
