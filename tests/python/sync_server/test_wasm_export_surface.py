from __future__ import annotations

from pathlib import Path


def test_generated_wasm_bindings_omit_dead_legacy_exports() -> None:
    repo_root = Path(__file__).resolve().parents[3]
    web_js = (repo_root / "apps" / "web" / "src" / "pkg" / "airqr_core.js").read_text(encoding="utf-8")
    web_dts = (repo_root / "apps" / "web" / "src" / "pkg" / "airqr_core.d.ts").read_text(encoding="utf-8")
    runtime_js = (
        repo_root
        / "services"
        / "sync-server"
        / "sync_server"
        / "runtime"
        / "packet_assembler"
        / "airqr_core.js"
    ).read_text(encoding="utf-8")

    dead_exports = (
        "encode_to_gif_1bit",
        "generate_raptorq_packets",
        "assemble_gif_from_frames",
        "init_panic_hook",
    )

    for export_name in dead_exports:
        assert f"export function {export_name}(" not in web_js
        assert f"export function {export_name}(" not in runtime_js
        assert f"export function {export_name}(" not in web_dts


def test_generated_wasm_bindings_include_packed_raptorq_export() -> None:
    repo_root = Path(__file__).resolve().parents[3]
    web_js = (repo_root / "apps" / "web" / "src" / "pkg" / "airqr_core.js").read_text(encoding="utf-8")
    web_dts = (repo_root / "apps" / "web" / "src" / "pkg" / "airqr_core.d.ts").read_text(encoding="utf-8")
    runtime_js = (
        repo_root
        / "services"
        / "sync-server"
        / "sync_server"
        / "runtime"
        / "packet_assembler"
        / "airqr_core.js"
    ).read_text(encoding="utf-8")

    export_name = "generate_raptorq_packets_raw_packed"

    assert f"export function {export_name}(" in web_js
    assert f"export function {export_name}(" in runtime_js
    assert f"export function {export_name}(" in web_dts
