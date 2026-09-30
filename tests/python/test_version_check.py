from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path


def load_build_module(name: str):
    module_path = Path(__file__).resolve().parents[2] / "build" / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"{name}_test_module", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


version_check = load_build_module("version_check")
flutter_bundle = load_build_module("flutter_bundle")


def test_release_versions_match_canonical_version():
    project_root = Path(__file__).resolve().parents[2]

    assert version_check.read_release_version(project_root) == "1.0"
    assert version_check.platform_version("1.0") == "1.0.0"
    assert version_check.version_errors(project_root) == []


def test_flutter_artifact_metadata_uses_release_version():
    project_root = Path(__file__).resolve().parents[2]
    version, build_number = flutter_bundle.read_flutter_version(
        project_root / "apps" / "flutter" / "pubspec.yaml"
    )

    assert (version, build_number) == ("1.0.0", "10")
    pubspec = (
        project_root / "apps" / "flutter" / "pubspec.yaml"
    ).read_text(encoding="utf-8")
    assert "msix_version: 1.0.10.0" in pubspec

    script = flutter_bundle.build_inno_setup_script(
        source_dir=Path("staging"),
        installer_path=Path("AirQR-windows-x64-setup.exe"),
        app_version="1.0",
        version_info_version="1.0.0.6",
        icon_path=Path("app_icon.ico"),
    )
    assert "AppVerName=AirQR 1.0" in script
    assert "VersionInfoVersion=1.0.0.6" in script
    assert "AirQR-windows-x64-setup" in script
    assert "PowerShell" not in script
    assert ".cmd" not in script


def test_debian_package_keeps_release_version_and_desktop_integration(tmp_path):
    source_dir = tmp_path / "source"
    (source_dir / "data").mkdir(parents=True)
    (source_dir / "lib").mkdir()
    (source_dir / "share" / "applications").mkdir(parents=True)
    for size in (256, 512):
        icon_dir = (
            source_dir
            / "share"
            / "icons"
            / "hicolor"
            / f"{size}x{size}"
            / "apps"
        )
        icon_dir.mkdir(parents=True)
        (icon_dir / "airqr_desktop.png").write_bytes(b"png")

    (source_dir / "airqr_desktop").write_bytes(b"binary")
    (source_dir / "data" / "icudtl.dat").write_bytes(b"data")
    (source_dir / "lib" / "libapp.so").write_bytes(b"library")
    (source_dir / "share" / "applications" / "bundled.desktop").write_text(
        "bundled",
        encoding="utf-8",
    )
    license_path = tmp_path / "LICENSE"
    license_path.write_text("MIT License", encoding="utf-8")

    package_root = tmp_path / "package"
    flutter_bundle.stage_debian_package(
        source_dir=source_dir,
        package_root=package_root,
        app_version="1.0",
        license_path=license_path,
    )

    control = (package_root / "DEBIAN" / "control").read_text(encoding="utf-8")
    assert "Package: airqr" in control
    assert "Version: 1.0" in control
    assert "Architecture: amd64" in control
    assert "libegl1" in control
    assert "libgles2" in control
    assert "libgtk-3-0t64 | libgtk-3-0" in control
    assert "libsecret-1-0" in control

    launcher = (package_root / "usr" / "bin" / "airqr").read_text(
        encoding="utf-8"
    )
    assert "exec /opt/airqr/airqr_desktop" in launcher

    desktop = (
        package_root / "usr" / "share" / "applications" / "airqr.desktop"
    ).read_text(encoding="utf-8")
    assert "Name=AirQR" in desktop
    assert "Exec=airqr" in desktop
    assert "Icon=airqr" in desktop
    assert not (package_root / "opt" / "airqr" / "share").exists()
    assert (
        package_root
        / "usr"
        / "share"
        / "icons"
        / "hicolor"
        / "512x512"
        / "apps"
        / "airqr.png"
    ).exists()


def test_linux_build_scripts_use_unix_line_endings():
    project_root = Path(__file__).resolve().parents[2]
    scripts = [
        Path("start.sh"),
        Path("apps/flutter/rust_builder/cargokit/build_pod.sh"),
        Path("apps/flutter/rust_builder/cargokit/run_build_tool.sh"),
    ]

    for script in scripts:
        blob = subprocess.check_output(
            ["git", "show", f":{script.as_posix()}"],
            cwd=project_root,
        )
        assert b"\r\n" not in blob, f"{script} must use LF endings"


def test_linux_release_package_includes_build_number(tmp_path, monkeypatch):
    output = tmp_path / "dist"
    (output / "Linux" / "AirQR").mkdir(parents=True)
    captured = {}
    monkeypatch.setattr(flutter_bundle, "build_debian_package", lambda **kwargs: captured.update(kwargs))
    flutter_bundle.package_release_archives(
        project_root=tmp_path, output_root=output,
        target=flutter_bundle.TARGETS["linux"], log=flutter_bundle.Logger(),
        app_version="1.0", version_info_version="1.0.0.10",
    )
    assert captured["app_version"] == "1.0.0+10"
