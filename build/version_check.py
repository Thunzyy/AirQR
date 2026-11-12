#!/usr/bin/env python3
"""Validate that every AirQR release surface derives from VERSION."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path


def read_release_version(project_root: Path) -> str:
    version = (project_root / "VERSION").read_text(encoding="utf-8").strip()
    if not re.fullmatch(r"\d+\.\d+", version):
        raise ValueError(f"Invalid release version in VERSION: {version!r}")
    return version


def platform_version(release_version: str) -> str:
    return f"{release_version}.0"


def version_errors(project_root: Path) -> list[str]:
    release_version = read_release_version(project_root)
    technical_version = platform_version(release_version)
    errors: list[str] = []

    web_package = json.loads(
        (project_root / "apps" / "web" / "package.json").read_text(encoding="utf-8")
    )
    web_lock = json.loads(
        (project_root / "apps" / "web" / "package-lock.json").read_text(
            encoding="utf-8"
        )
    )
    if web_package.get("version") != technical_version:
        errors.append(f"apps/web/package.json: expected {technical_version}")
    if web_lock.get("version") != technical_version:
        errors.append(f"apps/web/package-lock.json root: expected {technical_version}")
    if web_lock.get("packages", {}).get("", {}).get("version") != technical_version:
        errors.append(
            f"apps/web/package-lock.json package: expected {technical_version}"
        )

    expected_fragments = {
        "apps/web/src/constants/index.ts": f"version: 'v{release_version}'",
        "apps/web/test-runners/SettingsTab.test.tsx": (
            f"getAllByText('v{release_version}')"
        ),
        "apps/flutter/lib/settings_page.dart": (
            f"_aboutVersion = 'v{release_version}'"
        ),
        "services/sync-server/sync_server/version.py": (
            f'DEFAULT_VERSION = "{release_version}"'
        ),
        "services/sync-server/Dockerfile": (
            f"ARG AIRQR_VERSION={release_version}"
        ),
        "README.md": (
            f"/releases/download/v{release_version}/airqr-portable.html"
        ),
    }
    for relative_path, expected in expected_fragments.items():
        content = (project_root / relative_path).read_text(encoding="utf-8")
        if expected not in content:
            errors.append(f"{relative_path}: missing {expected!r}")

    pubspec = (project_root / "apps" / "flutter" / "pubspec.yaml").read_text(
        encoding="utf-8"
    )
    flutter_match = re.search(
        r"^version:\s*(\d+\.\d+\.\d+)\+(\d+)\s*$", pubspec, flags=re.MULTILINE
    )
    if not flutter_match or flutter_match.group(1) != technical_version:
        errors.append(
            "apps/flutter/pubspec.yaml: "
            f"expected version {technical_version}+<build>"
        )
    else:
        major, minor, _patch = technical_version.split(".")
        expected_msix_version = (
            f"{major}.{minor}.{flutter_match.group(2)}.0"
        )
        if f"msix_version: {expected_msix_version}" not in pubspec:
            errors.append(
                "apps/flutter/pubspec.yaml: "
                f"expected MSIX version {expected_msix_version}"
            )

    store_identity_fragments = (
        "identity_name: SenTent.AirQR",
        "publisher_display_name: SenTent",
        "publisher: CN=5C0FDEB8-F6D7-4FBA-907B-578E36D8A3D6",
        "store: true",
    )
    for expected in store_identity_fragments:
        if expected not in pubspec:
            errors.append(
                "apps/flutter/pubspec.yaml: "
                f"missing Microsoft Store identity {expected!r}"
            )

    version_parts = ",".join(technical_version.split("."))
    runner_rc = (
        project_root / "apps" / "flutter" / "windows" / "runner" / "Runner.rc"
    ).read_text(encoding="utf-8")
    if f'#define VERSION_AS_STRING "{technical_version}"' not in runner_rc:
        errors.append(
            "apps/flutter/windows/runner/Runner.rc: "
            f"expected {technical_version}"
        )
    if not re.search(
        rf"#define VERSION_AS_NUMBER {re.escape(version_parts)},\d+", runner_rc
    ):
        errors.append(
            "apps/flutter/windows/runner/Runner.rc: numeric fallback is inconsistent"
        )

    return errors


def main() -> int:
    project_root = Path(__file__).resolve().parents[1]
    errors = version_errors(project_root)
    if errors:
        print("[ERR] AirQR release versions are inconsistent:")
        for error in errors:
            print(f"  - {error}")
        return 1

    print(f"[OK] AirQR release version is consistent: {read_release_version(project_root)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
