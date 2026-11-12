from __future__ import annotations

import hashlib
import logging
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from .utils import load_json, safe_filename, write_json

logger = logging.getLogger(__name__)

HASH_CHUNK_SIZE = 1024 * 1024
EXPORT_DIR_NOT_ACCESSIBLE_ERROR = "Export directory is not accessible"


def _hash_file(path: Path) -> str:
    digest = hashlib.md5()
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(HASH_CHUNK_SIZE)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def validate_export_dir(path: Path) -> Tuple[bool, Optional[str]]:
    try:
        path.mkdir(parents=True, exist_ok=True)
        if not path.is_dir():
            return False, "Path is not a directory"
        return True, None
    except Exception as exc:
        logger.warning("Failed to validate export dir %s: %s", path, exc)
        return False, EXPORT_DIR_NOT_ACCESSIBLE_ERROR


def export_file(
    export_dir: Optional[Path],
    category: str,
    filename: str,
    file_bytes: bytes,
    timestamp: Optional[str] = None,
) -> Optional[Path]:
    if not export_dir:
        return None

    if timestamp:
        try:
            dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        except Exception:
            dt = datetime.now(timezone.utc)
    else:
        dt = datetime.now(timezone.utc)

    date_folder = dt.strftime("%Y-%m-%d")
    target_dir = export_dir / category / date_folder
    target_dir.mkdir(parents=True, exist_ok=True)

    new_hash = hashlib.md5(file_bytes).hexdigest()
    safe_name = safe_filename(filename)
    target_path = target_dir / safe_name

    if target_path.exists():
        existing_hash = hashlib.md5(target_path.read_bytes()).hexdigest()
        if existing_hash == new_hash:
            return target_path

    name, ext = target_path.stem, target_path.suffix
    for existing_file in target_dir.glob(f"{name}*{ext}"):
        existing_hash = hashlib.md5(existing_file.read_bytes()).hexdigest()
        if existing_hash == new_hash:
            return existing_file

    counter = 1
    while target_path.exists():
        target_path = target_dir / f"{name}_{counter}{ext}"
        counter += 1

    target_path.write_bytes(file_bytes)
    logger.info("Exported to %s", target_path)
    return target_path


def export_file_path(
    export_dir: Optional[Path],
    category: str,
    source_path: Path,
    filename: Optional[str] = None,
    timestamp: Optional[str] = None,
) -> Optional[Path]:
    if not export_dir:
        return None

    if timestamp:
        try:
            dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        except Exception:
            dt = datetime.now(timezone.utc)
    else:
        dt = datetime.now(timezone.utc)

    date_folder = dt.strftime("%Y-%m-%d")
    target_dir = export_dir / category / date_folder
    target_dir.mkdir(parents=True, exist_ok=True)

    safe_name = safe_filename(filename or source_path.name)
    target_path = target_dir / safe_name
    source_hash = _hash_file(source_path)

    if target_path.exists():
        if _hash_file(target_path) == source_hash:
            return target_path

    name, ext = target_path.stem, target_path.suffix
    for existing_file in target_dir.glob(f"{name}*{ext}"):
        if _hash_file(existing_file) == source_hash:
            return existing_file

    counter = 1
    while target_path.exists():
        target_path = target_dir / f"{name}_{counter}{ext}"
        counter += 1

    shutil.copy2(source_path, target_path)
    logger.info("Exported to %s", target_path)
    return target_path


class ExportManager:
    def __init__(self, config_path: Path, cli_export_dir: Optional[Path]) -> None:
        self.config_path = config_path
        self.cli_export_dir = cli_export_dir

    def _load_config_raw(self) -> Dict[str, Any]:
        if not self.config_path.exists():
            return {}
        try:
            return load_json(self.config_path)
        except Exception as exc:
            logger.warning("export_config.json unreadable, resetting: %s", exc)
            return {}

    def load_config(self) -> Dict[str, Any]:
        config = self._load_config_raw()
        if self.cli_export_dir:
            config["exportDir"] = str(self.cli_export_dir)
        return config

    def save_config(self, config: Dict[str, Any]) -> None:
        write_json(self.config_path, config)

    def effective_dir(self, config: Optional[Dict[str, Any]] = None) -> Optional[Path]:
        config = config or self.load_config()
        if not config.get("enabled", True):
            return None
        export_dir = config.get("exportDir")
        if export_dir:
            return Path(export_dir)
        return self.cli_export_dir

    def should_export(self, category: str, config: Optional[Dict[str, Any]] = None) -> bool:
        config = config or self.load_config()
        if not config.get("enabled", True):
            return False
        if category == "scanned":
            return bool(config.get("exportScanned", True))
        if category == "generated":
            return bool(config.get("exportGenerated", True))
        return True

    def export(self, category: str, filename: str, file_bytes: bytes, timestamp: Optional[str] = None) -> Optional[Path]:
        if not self.should_export(category):
            return None
        return export_file(self.effective_dir(), category, filename, file_bytes, timestamp)

    def export_path(
        self,
        category: str,
        source_path: Path,
        filename: Optional[str] = None,
        timestamp: Optional[str] = None,
    ) -> Optional[Path]:
        if not self.should_export(category):
            return None
        return export_file_path(
            self.effective_dir(),
            category,
            source_path,
            filename=filename,
            timestamp=timestamp,
        )

    def update_config(self, payload: Dict[str, Any]) -> Tuple[bool, Dict[str, Any], Optional[str]]:
        config = self._load_config_raw()

        if "enabled" in payload:
            value = payload["enabled"]
            if isinstance(value, bool):
                config["enabled"] = value
            elif isinstance(value, str) and value.lower() in ("true", "false"):
                config["enabled"] = value.lower() == "true"
            else:
                return False, config, "enabled must be a boolean"

        if "exportDir" in payload:
            export_path = payload["exportDir"]
            if export_path is None or export_path == "":
                config["exportDir"] = None
                config.pop("exportDirValid", None)
                config.pop("exportDirError", None)
            elif not isinstance(export_path, str):
                return False, config, "exportDir must be a string"
            else:
                export_path = export_path.strip()
                if not export_path:
                    config["exportDir"] = None
                    config.pop("exportDirValid", None)
                    config.pop("exportDirError", None)
                else:
                    config["exportDir"] = export_path
                    valid, error = validate_export_dir(Path(export_path))
                    config["exportDirValid"] = valid
                    if valid:
                        config.pop("exportDirError", None)
                        logger.info("Export dir validated: %s", export_path)
                    else:
                        config["exportDirError"] = error or "Invalid exportDir"
                        logger.warning("Export dir invalid: %s", config["exportDirError"])

        if "exportScanned" in payload:
            value = payload["exportScanned"]
            if isinstance(value, bool):
                config["exportScanned"] = value
            else:
                return False, config, "exportScanned must be a boolean"

        if "exportGenerated" in payload:
            value = payload["exportGenerated"]
            if isinstance(value, bool):
                config["exportGenerated"] = value
            else:
                return False, config, "exportGenerated must be a boolean"

        self.save_config(config)
        return True, config, None
