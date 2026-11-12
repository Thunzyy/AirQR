#!/usr/bin/env python3
"""
AirQR Flutter distributable builder.

Builds selected Flutter targets and centralizes their distributable outputs into
dist/<Platform> so every final artifact lives under the same top-level folder.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


@dataclass(frozen=True)
class OutputSpec:
    kind: str  # "file_glob" or "dir"
    source: str
    destination: str
    rename_to: str | None = None
    entry_renames: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True)
class TargetSpec:
    name: str
    description: str
    build_args: tuple[str, ...]
    outputs: tuple[OutputSpec, ...]
    supported_hosts: tuple[str, ...]


class Logger:
    COLORS = {
        "green": "\033[92m",
        "yellow": "\033[93m",
        "red": "\033[91m",
        "blue": "\033[94m",
        "reset": "\033[0m",
    }

    def __init__(self, verbose: bool = False):
        self.verbose = verbose
        if sys.platform == "win32":
            try:
                import ctypes

                kernel32 = ctypes.windll.kernel32
                kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7)
            except Exception:
                self.COLORS = {k: "" for k in self.COLORS}

    def _color(self, color: str, text: str) -> str:
        return f"{self.COLORS.get(color, '')}{text}{self.COLORS['reset']}"

    def info(self, msg: str) -> None:
        print(f"  {self._color('blue', 'INFO')}  {msg}")

    def success(self, msg: str) -> None:
        print(f"  {self._color('green', '  OK')}  {msg}")

    def warn(self, msg: str) -> None:
        print(f"  {self._color('yellow', 'WARN')}  {msg}")

    def error(self, msg: str) -> None:
        print(f"  {self._color('red', ' ERR')}  {msg}")

    def step(self, num: int, total: int, msg: str) -> None:
        print(f"\n[{num}/{total}] {msg}")


APP_NAME = "AirQR"
DEFAULT_OUTPUT_DIR = "dist"
FLUTTER_MANIFEST_NAME = "flutter-manifest.json"


TARGETS: dict[str, TargetSpec] = {
    "android-apk": TargetSpec(
        name="android-apk",
        description="Android APK release (arm64 + x64)",
        build_args=(
            "build",
            "apk",
            "--release",
            "--target-platform",
            "android-arm64,android-x64",
        ),
        outputs=(
            OutputSpec(
                kind="file_glob",
                source="build/app/outputs/flutter-apk/app-release.apk",
                destination="Android",
                rename_to=f"{APP_NAME}.apk",
            ),
        ),
        supported_hosts=("win32", "linux", "darwin"),
    ),
    "android-apk-split": TargetSpec(
        name="android-apk-split",
        description="Android APK release (split per ABI: arm64 + x64)",
        build_args=(
            "build",
            "apk",
            "--split-per-abi",
            "--release",
            "--target-platform",
            "android-arm64,android-x64",
        ),
        outputs=(
            OutputSpec(
                kind="file_glob",
                source="build/app/outputs/flutter-apk/app-*-release.apk",
                destination="Android/APK-Split",
            ),
        ),
        supported_hosts=("win32", "linux", "darwin"),
    ),
    "android-aab": TargetSpec(
        name="android-aab",
        description="Android App Bundle release (arm64 + x64)",
        build_args=(
            "build",
            "appbundle",
            "--release",
            "--target-platform",
            "android-arm64,android-x64",
        ),
        outputs=(
            OutputSpec(
                kind="file_glob",
                source="build/app/outputs/bundle/release/*.aab",
                destination="Android/AAB",
                rename_to=f"{APP_NAME}.aab",
            ),
        ),
        supported_hosts=("win32", "linux", "darwin"),
    ),
    "windows": TargetSpec(
        name="windows",
        description="Windows desktop release bundle",
        build_args=("build", "windows", "--release"),
        outputs=(
            OutputSpec(
                kind="dir",
                source="build/windows/x64/runner/Release",
                destination=f"Windows/{APP_NAME}",
                entry_renames=(("airqr_desktop.exe", f"{APP_NAME}.exe"),),
            ),
        ),
        supported_hosts=("win32",),
    ),
    "linux": TargetSpec(
        name="linux",
        description="Linux desktop release bundle",
        build_args=("build", "linux", "--release"),
        outputs=(
            OutputSpec(
                kind="dir",
                source="build/linux/x64/release/bundle",
                destination=f"Linux/{APP_NAME}",
            ),
        ),
        supported_hosts=("linux",),
    ),
    "macos": TargetSpec(
        name="macos",
        description="macOS desktop release app",
        build_args=("build", "macos", "--release"),
        outputs=(
            OutputSpec(
                kind="dir",
                source="build/macos/Build/Products/Release/airqr_mobile.app",
                destination=f"Mac/{APP_NAME}.app",
            ),
        ),
        supported_hosts=("darwin",),
    ),
    "ios": TargetSpec(
        name="ios",
        description="iOS release app (no codesign)",
        build_args=("build", "ios", "--release", "--no-codesign"),
        outputs=(
            OutputSpec(
                kind="dir",
                source="build/ios/iphoneos/Runner.app",
                destination=f"iOS/{APP_NAME}.app",
            ),
        ),
        supported_hosts=("darwin",),
    ),
}


def detect_default_targets() -> list[str]:
    if sys.platform == "win32":
        return ["android-apk", "windows"]
    if sys.platform == "darwin":
        return ["android-apk", "macos", "ios"]
    if sys.platform.startswith("linux"):
        return ["android-apk", "linux"]
    return ["android-apk"]


def flutter_command() -> str:
    resolved = shutil.which("flutter")
    if not resolved:
        raise FileNotFoundError("Flutter executable not found in PATH.")
    return resolved


def read_flutter_version(pubspec_path: Path) -> tuple[str, str]:
    pubspec = pubspec_path.read_text(encoding="utf-8")
    match = re.search(
        r"^version:\s*(\d+\.\d+\.\d+)\+(\d+)\s*$",
        pubspec,
        flags=re.MULTILINE,
    )
    if not match:
        raise ValueError(f"Unable to read Flutter version from {pubspec_path}")
    return match.group(1), match.group(2)


def ensure_supported_targets(target_names: list[str], collect_only: bool) -> None:
    if collect_only:
        return

    host = sys.platform
    unsupported = [name for name in target_names if host not in TARGETS[name].supported_hosts]
    if unsupported:
        details = ", ".join(unsupported)
        raise RuntimeError(
            f"Targets not buildable on this host ({host}): {details}. "
            "Use --collect-only to sync already-built outputs."
        )


def clear_destination(path: Path) -> None:
    if path.is_dir():
        shutil.rmtree(path)
    elif path.exists():
        path.unlink()


def collect_target(
    project_root: Path,
    flutter_dir: Path,
    output_root: Path,
    target: TargetSpec,
    log: Logger,
    strict: bool,
) -> list[dict[str, str]]:
    copied: list[dict[str, str]] = []

    for spec in target.outputs:
        destination = output_root / spec.destination
        clear_destination(destination)

        if spec.kind == "file_glob":
            matches = sorted(flutter_dir.glob(spec.source))
            if not matches:
                msg = f"No artifact found for {target.name}: {spec.source}"
                if strict:
                    raise FileNotFoundError(msg)
                log.warn(msg)
                continue

            destination.mkdir(parents=True, exist_ok=True)
            if spec.rename_to and len(matches) != 1:
                raise ValueError(
                    f"{target.name} expected a single artifact for rename_to={spec.rename_to}, "
                    f"but found {len(matches)} match(es)."
                )
            for source in matches:
                copied_name = spec.rename_to or source.name
                copied_path = destination / copied_name
                shutil.copy2(source, copied_path)
                copied.append(
                    {
                        "source": str(source.relative_to(project_root)),
                        "destination": str(copied_path.relative_to(project_root)),
                    }
                )
        elif spec.kind == "dir":
            source = flutter_dir / spec.source
            if not source.exists():
                msg = f"No artifact found for {target.name}: {spec.source}"
                if strict:
                    raise FileNotFoundError(msg)
                log.warn(msg)
                continue

            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(source, destination)
            for source_name, renamed_name in spec.entry_renames:
                entry_path = destination / source_name
                if not entry_path.exists():
                    msg = f"Expected entry missing after copy for {target.name}: {entry_path}"
                    if strict:
                        raise FileNotFoundError(msg)
                    log.warn(msg)
                    continue
                entry_path.rename(destination / renamed_name)
            copied.append(
                {
                    "source": str(source.relative_to(project_root)),
                    "destination": str(destination.relative_to(project_root)),
                }
            )
        else:
            raise ValueError(f"Unsupported output spec kind: {spec.kind}")

    if copied:
        log.success(
            f"{target.name}: {len(copied)} artifact(s) synced to {relative_to_root(output_root, project_root)}"
        )

    return copied


def package_release_archives(
    project_root: Path,
    output_root: Path,
    target: TargetSpec,
    log: Logger,
    app_version: str,
    version_info_version: str,
) -> list[dict[str, str]]:
    packaged: list[dict[str, str]] = []

    if target.name == "windows":
        source_dir = output_root / "Windows" / APP_NAME
        if not source_dir.exists():
            return packaged

        archive_base = output_root / "Windows" / f"{APP_NAME}-windows-x64"
        archive_path = archive_base.with_suffix(".zip")
        clear_destination(archive_path)
        shutil.make_archive(
            str(archive_base),
            "zip",
            root_dir=source_dir.parent,
            base_dir=source_dir.name,
        )
        packaged.append(
            {
                "source": str(source_dir.relative_to(project_root)),
                "destination": str(archive_path.relative_to(project_root)),
            }
        )
        log.success("windows: portable ZIP ready for GitHub Releases")

        installer_path = output_root / "Windows" / f"{APP_NAME}-windows-x64-setup.exe"
        if build_windows_installer(
            source_dir=source_dir,
            installer_path=installer_path,
            app_version=app_version,
            version_info_version=version_info_version,
            icon_path=(
                project_root
                / "apps"
                / "flutter"
                / "windows"
                / "runner"
                / "resources"
                / "app_icon.ico"
            ),
        ):
            packaged.append(
                {
                    "source": str(source_dir.relative_to(project_root)),
                    "destination": str(installer_path.relative_to(project_root)),
                }
            )
            log.success("windows: Inno Setup installer ready for GitHub Releases")
        else:
            log.warn("windows: installer EXE skipped (Inno Setup unavailable)")

    if target.name == "linux":
        source_dir = output_root / "Linux" / APP_NAME
        if source_dir.exists():
            archive_base = output_root / "Linux" / f"{APP_NAME}-linux-x64"
            archive_path = archive_base.with_suffix(".tar.gz")
            clear_destination(archive_path)
            shutil.make_archive(
                str(archive_base),
                "gztar",
                root_dir=source_dir.parent,
                base_dir=source_dir.name,
            )
            packaged.append(
                {
                    "source": str(source_dir.relative_to(project_root)),
                    "destination": str(archive_path.relative_to(project_root)),
                }
            )
            log.success("linux: portable TAR.GZ ready for GitHub Releases")

            package_path = output_root / "Linux" / f"{APP_NAME}-linux-x64.deb"
            build_debian_package(
                project_root=project_root,
                source_dir=source_dir,
                package_path=package_path,
                app_version="+".join(version_info_version.rsplit(".", 1)),
            )
            packaged.append(
                {
                    "source": str(source_dir.relative_to(project_root)),
                    "destination": str(package_path.relative_to(project_root)),
                }
            )
            log.success("linux: Debian package ready for GitHub Releases")

    if target.name == "macos":
        source_dir = output_root / "Mac" / f"{APP_NAME}.app"
        if source_dir.exists():
            archive_base = output_root / "Mac" / f"{APP_NAME}-macos"
            archive_path = archive_base.with_suffix(".zip")
            clear_destination(archive_path)
            shutil.make_archive(
                str(archive_base),
                "zip",
                root_dir=source_dir.parent,
                base_dir=source_dir.name,
            )
            packaged.append(
                {
                    "source": str(source_dir.relative_to(project_root)),
                    "destination": str(archive_path.relative_to(project_root)),
                }
            )
            log.success("macos: portable ZIP ready for GitHub Releases")

    return packaged


def build_debian_control(*, app_version: str, installed_size_kib: int) -> str:
    return "\n".join(
        [
            "Package: airqr",
            f"Version: {app_version}",
            "Section: utils",
            "Priority: optional",
            "Architecture: amd64",
            "Maintainer: Lucas Poignard <poignard.lucas@gmail.com>",
            (
                "Depends: libblkid1, libc6, libegl1, libgles2, "
                "libgtk-3-0t64 | libgtk-3-0, liblzma5, libsecret-1-0, libstdc++6"
            ),
            f"Installed-Size: {installed_size_kib}",
            "Homepage: https://github.com/Thunzyy/AirQR",
            "Description: transfer files through animated QR codes",
            (
                " AirQR transfers files without cables, internet, or pairing by "
                "displaying and scanning animated QR codes."
            ),
            "",
        ]
    )


def build_linux_desktop_entry() -> str:
    return "\n".join(
        [
            "[Desktop Entry]",
            "Name=AirQR",
            "Comment=Transfer files through animated QR codes",
            "Exec=airqr",
            "Icon=airqr",
            "Terminal=false",
            "Type=Application",
            "Categories=Utility;",
            "StartupWMClass=airqr_desktop",
            "",
        ]
    )


def directory_size_kib(path: Path) -> int:
    total_bytes = sum(
        entry.stat().st_size for entry in path.rglob("*") if entry.is_file()
    )
    return max(1, (total_bytes + 1023) // 1024)


def stage_debian_package(
    *,
    source_dir: Path,
    package_root: Path,
    app_version: str,
    license_path: Path,
) -> None:
    payload_dir = package_root / "opt" / "airqr"
    shutil.copytree(source_dir, payload_dir)

    bundled_integration = payload_dir / "share"
    if bundled_integration.exists():
        shutil.rmtree(bundled_integration)

    executable = payload_dir / "airqr_desktop"
    if not executable.exists():
        raise FileNotFoundError(f"Linux executable missing from bundle: {executable}")
    executable.chmod(0o755)

    launcher = package_root / "usr" / "bin" / "airqr"
    launcher.parent.mkdir(parents=True, exist_ok=True)
    launcher.write_text(
        '#!/bin/sh\nexec /opt/airqr/airqr_desktop "$@"\n',
        encoding="utf-8",
        newline="\n",
    )
    launcher.chmod(0o755)

    applications_dir = package_root / "usr" / "share" / "applications"
    applications_dir.mkdir(parents=True, exist_ok=True)
    (applications_dir / "airqr.desktop").write_text(
        build_linux_desktop_entry(),
        encoding="utf-8",
        newline="\n",
    )

    for size in (256, 512):
        source_icon = (
            source_dir
            / "share"
            / "icons"
            / "hicolor"
            / f"{size}x{size}"
            / "apps"
            / "airqr_desktop.png"
        )
        if not source_icon.exists():
            raise FileNotFoundError(f"Linux icon missing from bundle: {source_icon}")
        icon_dir = (
            package_root
            / "usr"
            / "share"
            / "icons"
            / "hicolor"
            / f"{size}x{size}"
            / "apps"
        )
        icon_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_icon, icon_dir / "airqr.png")

    documentation_dir = package_root / "usr" / "share" / "doc" / "airqr"
    documentation_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(license_path, documentation_dir / "copyright")

    control_dir = package_root / "DEBIAN"
    control_dir.mkdir(parents=True, exist_ok=True)
    (control_dir / "control").write_text(
        build_debian_control(
            app_version=app_version,
            installed_size_kib=directory_size_kib(package_root),
        ),
        encoding="utf-8",
        newline="\n",
    )


def build_debian_package(
    *,
    project_root: Path,
    source_dir: Path,
    package_path: Path,
    app_version: str,
) -> None:
    dpkg_deb = shutil.which("dpkg-deb")
    if not dpkg_deb:
        raise FileNotFoundError(
            "dpkg-deb is required to produce the AirQR Debian package."
        )

    with tempfile.TemporaryDirectory(prefix="airqr-debian-") as temp_dir_name:
        package_root = Path(temp_dir_name) / "airqr"
        stage_debian_package(
            source_dir=source_dir,
            package_root=package_root,
            app_version=app_version,
            license_path=project_root / "LICENSE",
        )

        clear_destination(package_path)
        package_path.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            [
                dpkg_deb,
                "--root-owner-group",
                "--build",
                str(package_root),
                str(package_path),
            ],
            check=True,
        )

    if not package_path.exists():
        raise FileNotFoundError(f"Debian package was not created: {package_path}")


def inno_setup_command() -> str | None:
    candidates = [
        os.environ.get("AIRQR_INNO_SETUP_COMPILER"),
        shutil.which("ISCC"),
        str(
            Path(os.environ.get("LOCALAPPDATA", ""))
            / "Programs"
            / "Inno Setup 6"
            / "ISCC.exe"
        ),
        str(
            Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)"))
            / "Inno Setup 6"
            / "ISCC.exe"
        ),
        str(
            Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
            / "Inno Setup 6"
            / "ISCC.exe"
        ),
    ]
    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return candidate
    return None


def build_windows_installer(
    *,
    source_dir: Path,
    installer_path: Path,
    app_version: str,
    version_info_version: str,
    icon_path: Path,
) -> bool:
    iscc = inno_setup_command()
    if not iscc:
        return False

    with tempfile.TemporaryDirectory(prefix="airqr-installer-") as temp_dir_name:
        temp_dir = Path(temp_dir_name)
        script_path = temp_dir / "airqr_setup.iss"
        script_path.write_text(
            build_inno_setup_script(
                source_dir=source_dir,
                installer_path=installer_path,
                app_version=app_version,
                version_info_version=version_info_version,
                icon_path=icon_path,
            ),
            encoding="utf-8-sig",
        )

        clear_destination(installer_path)
        subprocess.run(
            [iscc, "/Qp", str(script_path)],
            cwd=temp_dir,
            check=True,
        )

    return installer_path.exists()


def build_inno_setup_script(
    *,
    source_dir: Path,
    installer_path: Path,
    app_version: str,
    version_info_version: str,
    icon_path: Path,
) -> str:
    def escaped(path: Path) -> str:
        return str(path.resolve()).replace('"', '""')

    return "\n".join(
        [
            "[Setup]",
            "AppId={{2A85735F-B43B-4E7C-9773-1AF3502030E5}",
            f"AppName={APP_NAME}",
            f"AppVersion={app_version}",
            f"AppVerName={APP_NAME} {app_version}",
            "AppPublisher=AirQR",
            "AppPublisherURL=https://github.com/Thunzyy/AirQR",
            "AppSupportURL=https://github.com/Thunzyy/AirQR/issues",
            "AppUpdatesURL=https://github.com/Thunzyy/AirQR/releases",
            r"DefaultDirName={localappdata}\Programs\AirQR",
            f"DefaultGroupName={APP_NAME}",
            "DisableProgramGroupPage=yes",
            r"UninstallDisplayIcon={app}\AirQR.exe",
            f"OutputDir={escaped(installer_path.parent)}",
            f"OutputBaseFilename={installer_path.stem}",
            f"SetupIconFile={escaped(icon_path)}",
            f"VersionInfoVersion={version_info_version}",
            f"VersionInfoProductName={APP_NAME}",
            f"VersionInfoDescription={APP_NAME} {app_version} Setup",
            "Compression=lzma2",
            "SolidCompression=yes",
            "WizardStyle=modern",
            "PrivilegesRequired=lowest",
            "ArchitecturesAllowed=x64compatible",
            "ArchitecturesInstallIn64BitMode=x64compatible",
            "CloseApplications=yes",
            "RestartApplications=no",
            "",
            "[Tasks]",
            (
                'Name: "desktopicon"; Description: "Create a desktop shortcut"; '
                'GroupDescription: "Additional shortcuts:"; Flags: unchecked'
            ),
            "",
            "[Files]",
            (
                f'Source: "{escaped(source_dir)}\\*"; DestDir: "{{app}}"; '
                "Flags: ignoreversion recursesubdirs createallsubdirs"
            ),
            "",
            "[Icons]",
            (
                r'Name: "{autoprograms}\AirQR"; Filename: "{app}\AirQR.exe"; '
                r'WorkingDir: "{app}"'
            ),
            (
                r'Name: "{autodesktop}\AirQR"; Filename: "{app}\AirQR.exe"; '
                r'WorkingDir: "{app}"; Tasks: desktopicon'
            ),
            "",
            "[Run]",
            (
                r'Filename: "{app}\AirQR.exe"; '
                'Description: "Launch AirQR"; '
                "Flags: nowait postinstall skipifsilent"
            ),
            "",
        ]
    )


def write_manifest(manifest_path: Path, manifest: dict[str, object]) -> None:
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")


def remove_legacy_output(output_root: Path, log: Logger) -> None:
    legacy_root = output_root / "flutter"
    if legacy_root.exists():
        shutil.rmtree(legacy_root)
        log.info(f"Removed legacy output folder: {legacy_root}")


def relative_to_root(path: Path, project_root: Path) -> str:
    try:
        return str(path.resolve().relative_to(project_root.resolve()))
    except ValueError:
        return str(path.resolve())


def main() -> int:
    parser = argparse.ArgumentParser(description="Build and collect Flutter distributables into dist/<Platform>")
    parser.add_argument(
        "--only",
        nargs="+",
        choices=tuple(TARGETS.keys()),
        help="Build only a subset of Flutter targets",
    )
    parser.add_argument(
        "--collect-only",
        action="store_true",
        help="Do not run flutter build; only sync already-generated artifacts into dist/<Platform>",
    )
    parser.add_argument(
        "--output",
        default=DEFAULT_OUTPUT_DIR,
        help="Output directory (default: dist)",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print extra context while running",
    )
    args = parser.parse_args()

    log = Logger(verbose=args.verbose)
    project_root = Path(__file__).resolve().parents[1]
    flutter_dir = project_root / "apps" / "flutter"
    release_version = (project_root / "VERSION").read_text(encoding="utf-8").strip()
    platform_version, build_number = read_flutter_version(
        flutter_dir / "pubspec.yaml"
    )
    output_root = (project_root / args.output).resolve()
    manifest_path = output_root / FLUTTER_MANIFEST_NAME
    target_names = args.only or detect_default_targets()

    ensure_supported_targets(target_names, collect_only=args.collect_only)
    if output_root == (project_root / DEFAULT_OUTPUT_DIR).resolve():
        remove_legacy_output(output_root, log)

    flutter = None
    if not args.collect_only:
        flutter = flutter_command()

    total_steps = len(target_names) + (0 if args.collect_only else 1)
    step_num = 1

    if not args.collect_only:
        log.step(step_num, total_steps, "Flutter pub get")
        step_num += 1
        subprocess.run([flutter, "pub", "get"], cwd=flutter_dir, check=True)
        log.success("Flutter dependencies resolved")
    else:
        log.info("Collect-only mode: skipping flutter build commands")

    manifest: dict[str, object] = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "version": release_version,
        "platformVersion": platform_version,
        "buildNumber": build_number,
        "outputRoot": relative_to_root(output_root, project_root),
        "targets": {},
        "failures": {},
    }
    failures: dict[str, str] = {}

    for target_name in target_names:
        target = TARGETS[target_name]
        log.step(step_num, total_steps, f"{target.description} ({target.name})")
        step_num += 1

        try:
            if not args.collect_only:
                command = [flutter, *target.build_args]
                log.info(f"$ {' '.join(command)}")
                subprocess.run(command, cwd=flutter_dir, check=True)

            copied = collect_target(
                project_root=project_root,
                flutter_dir=flutter_dir,
                output_root=output_root,
                target=target,
                log=log,
                strict=not args.collect_only,
            )
            packaged = package_release_archives(
                project_root=project_root,
                output_root=output_root,
                target=target,
                log=log,
                app_version=release_version,
                version_info_version=f"{platform_version}.{build_number}",
            )
            manifest["targets"][target_name] = copied + packaged
        except (subprocess.CalledProcessError, FileNotFoundError, RuntimeError) as exc:
            failures[target_name] = str(exc)
            manifest["targets"][target_name] = manifest["targets"].get(target_name, [])
            log.error(f"{target.name}: {exc}")

    manifest["failures"] = failures
    write_manifest(manifest_path, manifest)
    log.success(f"Flutter artifact manifest written to {manifest_path}")
    log.success(f"Centralized Flutter outputs are under {output_root}")
    if failures:
        log.error("Some Flutter targets failed:")
        for name, message in failures.items():
            log.error(f"- {name}: {message}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
