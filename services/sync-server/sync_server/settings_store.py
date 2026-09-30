from __future__ import annotations

from pathlib import Path
from typing import Any, Dict

from .utils import load_json, write_json


class SettingsStore:
    def __init__(self, path: Path) -> None:
        self.path = path

    def load(self) -> Dict[str, Any]:
        if not self.path.exists():
            return {}
        return load_json(self.path)

    def save(self, settings: Dict[str, Any]) -> None:
        write_json(self.path, settings)

    def merge(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        settings = self.load()
        if "encoder" in payload:
            settings["encoder"] = {**settings.get("encoder", {}), **payload["encoder"]}
        if "scanner" in payload:
            settings["scanner"] = {**settings.get("scanner", {}), **payload["scanner"]}
        if "theme" in payload:
            settings["theme"] = payload["theme"]
        for key in payload:
            if key not in ("encoder", "scanner", "theme"):
                settings[key] = payload[key]
        self.save(settings)
        return settings
