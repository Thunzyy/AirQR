from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path


def load_flutter_bundle_module():
    module_path = Path(__file__).resolve().parents[3] / "build" / "flutter_bundle.py"
    spec = importlib.util.spec_from_file_location("flutter_bundle_test_module", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


flutter_bundle = load_flutter_bundle_module()


def test_targets_use_platform_folders_and_airqr_names():
    android_spec = flutter_bundle.TARGETS["android-apk"].outputs[0]
    windows_spec = flutter_bundle.TARGETS["windows"].outputs[0]
    linux_spec = flutter_bundle.TARGETS["linux"].outputs[0]
    mac_spec = flutter_bundle.TARGETS["macos"].outputs[0]
    ios_spec = flutter_bundle.TARGETS["ios"].outputs[0]

    assert android_spec.destination == "Android"
    assert android_spec.rename_to == "AirQR.apk"

    assert windows_spec.destination == "Windows/AirQR"
    assert ("airqr_desktop.exe", "AirQR.exe") in windows_spec.entry_renames

    assert linux_spec.destination == "Linux/AirQR"
    assert mac_spec.destination == "Mac/AirQR.app"
    assert ios_spec.destination == "iOS/AirQR.app"


def test_collect_target_renames_android_apk_and_windows_exe(tmp_path):
    project_root = tmp_path
    flutter_dir = project_root / "apps" / "flutter"
    output_root = project_root / "dist"
    log = flutter_bundle.Logger()

    apk_source = flutter_dir / "build" / "app" / "outputs" / "flutter-apk" / "app-release.apk"
    apk_source.parent.mkdir(parents=True, exist_ok=True)
    apk_source.write_text("apk", encoding="ascii")

    copied = flutter_bundle.collect_target(
        project_root=project_root,
        flutter_dir=flutter_dir,
        output_root=output_root,
        target=flutter_bundle.TARGETS["android-apk"],
        log=log,
        strict=True,
    )

    assert (output_root / "Android" / "AirQR.apk").read_text(encoding="ascii") == "apk"
    assert copied == [
        {
            "source": "apps\\flutter\\build\\app\\outputs\\flutter-apk\\app-release.apk",
            "destination": "dist\\Android\\AirQR.apk",
        }
    ]

    windows_source_dir = flutter_dir / "build" / "windows" / "x64" / "runner" / "Release"
    windows_source_dir.mkdir(parents=True, exist_ok=True)
    (windows_source_dir / "airqr_desktop.exe").write_text("exe", encoding="ascii")
    (windows_source_dir / "flutter_windows.dll").write_text("dll", encoding="ascii")
    (windows_source_dir / "data").mkdir(parents=True, exist_ok=True)

    copied = flutter_bundle.collect_target(
        project_root=project_root,
        flutter_dir=flutter_dir,
        output_root=output_root,
        target=flutter_bundle.TARGETS["windows"],
        log=log,
        strict=True,
    )

    assert (output_root / "Windows" / "AirQR" / "AirQR.exe").read_text(encoding="ascii") == "exe"
    assert not (output_root / "Windows" / "AirQR" / "airqr_desktop.exe").exists()
    assert (output_root / "Windows" / "AirQR" / "flutter_windows.dll").read_text(encoding="ascii") == "dll"
    assert copied == [
        {
            "source": "apps\\flutter\\build\\windows\\x64\\runner\\Release",
            "destination": "dist\\Windows\\AirQR",
        }
    ]


def test_package_release_archives_uses_airqr_names_for_windows(tmp_path, monkeypatch):
    project_root = tmp_path
    output_root = project_root / "dist"
    windows_bundle = output_root / "Windows" / "AirQR"
    windows_bundle.mkdir(parents=True, exist_ok=True)
    (windows_bundle / "AirQR.exe").write_text("exe", encoding="ascii")
    log = flutter_bundle.Logger()

    def fake_build_windows_installer(
        *,
        source_dir: Path,
        installer_path: Path,
        app_version: str,
        version_info_version: str,
        icon_path: Path,
    ) -> bool:
        assert app_version == "1.0.5"
        assert version_info_version == "1.0.5.7"
        assert icon_path.name == "app_icon.ico"
        installer_path.write_text(source_dir.name, encoding="ascii")
        return True

    monkeypatch.setattr(flutter_bundle, "build_windows_installer", fake_build_windows_installer)

    packaged = flutter_bundle.package_release_archives(
        project_root=project_root,
        output_root=output_root,
        target=flutter_bundle.TARGETS["windows"],
        log=log,
        app_version="1.0.5",
        version_info_version="1.0.5.7",
    )

    zip_path = output_root / "Windows" / "AirQR-windows-x64.zip"
    installer_path = output_root / "Windows" / "AirQR-windows-x64-setup.exe"

    assert zip_path.exists()
    assert installer_path.exists()
    assert installer_path.read_text(encoding="ascii") == "AirQR"
    assert packaged == [
        {
            "source": str(Path("dist") / "Windows" / "AirQR"),
            "destination": str(Path("dist") / "Windows" / "AirQR-windows-x64.zip"),
        },
        {
            "source": str(Path("dist") / "Windows" / "AirQR"),
            "destination": str(Path("dist") / "Windows" / "AirQR-windows-x64-setup.exe"),
        },
    ]


def test_windows_runner_metadata_uses_airqr_names():
    runner_rc = (
        Path(__file__).resolve().parents[3]
        / "apps"
        / "flutter"
        / "windows"
        / "runner"
        / "Runner.rc"
    ).read_text(encoding="utf-8")

    assert 'VALUE "InternalName", "AirQR" "\\0"' in runner_rc
    assert 'VALUE "OriginalFilename", "AirQR.exe" "\\0"' in runner_rc


def test_flutter_version_is_used_for_installer_metadata():
    project_root = Path(__file__).resolve().parents[3]
    version, build_number = flutter_bundle.read_flutter_version(
        project_root / "apps" / "flutter" / "pubspec.yaml"
    )

    assert re.fullmatch(r"\d+\.\d+\.\d+", version)
    assert build_number.isdigit()

    script = flutter_bundle.build_inno_setup_script(
        source_dir=Path("staging"),
        installer_path=Path("AirQR-windows-x64-setup.exe"),
        app_version=version,
        version_info_version=f"{version}.{build_number}",
        icon_path=Path("app_icon.ico"),
    )

    assert f"AppVersion={version}" in script
    assert f"VersionInfoVersion={version}.{build_number}" in script
    assert f"VersionInfoDescription=AirQR {version} Setup" in script
