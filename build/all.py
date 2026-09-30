#!/usr/bin/env python3
"""
Rebuild all distributable AirQR artifacts from one entrypoint.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path

def npm_command() -> str:
    return "npm.cmd" if os.name == "nt" else "npm"


def build_targets(project_root: Path) -> dict[str, tuple[list[str], Path]]:
    build_dir = project_root / "build"
    return {
        "version-check": ([sys.executable, str(build_dir / "version_check.py")], project_root),
        "web-build": ([npm_command(), "run", "build"], project_root / "apps" / "web"),
        "encoder-linksite": ([sys.executable, str(build_dir / "encoder_linksite.py")], project_root),
        "portable-html": ([sys.executable, str(build_dir / "web_singlefile.py")], project_root),
        "python-bundle": ([sys.executable, str(build_dir / "python_bundle.py")], project_root),
        "flutter-bundle": ([sys.executable, str(build_dir / "flutter_bundle.py")], project_root),
        "sync-public": (
            ["node", str(project_root / "apps" / "web" / "scripts" / "sync-linksite-assets.mjs")],
            project_root,
        ),
    }


def run_step(name: str, command: list[str], cwd: Path) -> None:
    print(f"\n== {name} ==", flush=True)
    print(f"$ {' '.join(command)}", flush=True)
    subprocess.run(command, cwd=cwd, check=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Rebuild AirQR distributable artifacts")
    parser.add_argument(
        "--only",
        nargs="+",
        choices=("version-check", "web-build", "encoder-linksite", "portable-html", "python-bundle", "flutter-bundle", "sync-public"),
        help="Run only a subset of targets",
    )
    parser.add_argument(
        "--with-flutter",
        action="store_true",
        help="Also build and centralize Flutter distributables into dist/<Platform>",
    )
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parents[1]
    targets = build_targets(project_root)
    order = args.only or [
        "version-check",
        "web-build",
        "encoder-linksite",
        "portable-html",
        "python-bundle",
        "sync-public",
    ]
    if args.with_flutter and "flutter-bundle" not in order:
        order.append("flutter-bundle")

    for name in order:
        command, cwd = targets[name]
        run_step(name, command, cwd)

    print("\n[OK] All requested build targets completed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
