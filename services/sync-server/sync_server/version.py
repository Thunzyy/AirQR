from __future__ import annotations

import os
from typing import Dict


DEFAULT_VERSION = "1.0"
UNKNOWN_VALUE = "unknown"


def _read_env(name: str, fallback: str) -> str:
    value = os.environ.get(name)
    if value is None:
        return fallback
    stripped = value.strip()
    return stripped if stripped else fallback


def get_version_info() -> Dict[str, str]:
    supplied = any(
        os.environ.get(name)
        for name in ("AIRQR_VERSION", "AIRQR_COMMIT", "AIRQR_BUILD_TIME")
    )
    return {
        "name": "AirQR Sync Server",
        "version": _read_env("AIRQR_VERSION", DEFAULT_VERSION),
        "commit": _read_env("AIRQR_COMMIT", UNKNOWN_VALUE),
        "buildTime": _read_env("AIRQR_BUILD_TIME", UNKNOWN_VALUE),
        "source": "env" if supplied else "default",
    }
