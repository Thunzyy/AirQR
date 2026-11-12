from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from .utils import safe_filename


class ScanAssemblyError(ValueError):
    """Stored packets cannot be turned back into a decoded file."""


class ScanAssemblyUnavailableError(RuntimeError):
    """Required runtime dependency for packet assembly is unavailable."""


WS_BINARY_ENCODING = "ws-binary-v1"
PACKET_ASSEMBLER_RUNTIME_DIR = (
    Path(__file__).resolve().parent / "runtime" / "packet_assembler"
)
PACKET_ASSEMBLER_RUNTIME_FILES = (
    "assemble_scan_packets.mjs",
    "package.json",
    "airqr_core.js",
    "airqr_core_bg.wasm",
)


def _resolve_packet_assembler_script_path() -> Path:
    missing_files = [
        name
        for name in PACKET_ASSEMBLER_RUNTIME_FILES
        if not (PACKET_ASSEMBLER_RUNTIME_DIR / name).exists()
    ]
    if missing_files:
        missing = ", ".join(missing_files)
        raise ScanAssemblyUnavailableError(
            "Packaged scan packet assembler runtime is missing: "
            f"{missing}. Deploy the full services/sync-server directory."
        )
    return PACKET_ASSEMBLER_RUNTIME_DIR / "assemble_scan_packets.mjs"


def assemble_scan_session_file(storage: Any, session_id: str) -> tuple[str, bytes]:
    packets_dir = storage.session_packets_dir(session_id)
    if not packets_dir.exists():
        raise ScanAssemblyError("No stored packets found for session")

    node_path = shutil.which("node")
    if not node_path:
        raise ScanAssemblyUnavailableError(
            "Node.js is required to assemble stored scan packets"
        )

    script_path = _resolve_packet_assembler_script_path()

    with tempfile.TemporaryDirectory(prefix="airqr-assemble-") as temp_dir:
        output_path = Path(temp_dir) / "assembled.bin"
        try:
            result = subprocess.run(
                [node_path, str(script_path), str(packets_dir), str(output_path)],
                capture_output=True,
                check=False,
                text=True,
            )
        except OSError as exc:
            raise ScanAssemblyUnavailableError(
                f"Unable to execute the scan packet assembler: {exc}"
            ) from exc

        if result.returncode != 0:
            raise ScanAssemblyError(_extract_error_message(result))

        if not output_path.exists():
            raise ScanAssemblyError("Scan packet assembler did not produce an output file")

        metadata = _parse_json_output(result.stdout)
        assembled_name = metadata.get("filename") if isinstance(metadata, dict) else None
        filename = safe_filename(assembled_name or "file.bin")
        file_bytes = output_path.read_bytes()
        return filename, file_bytes


def _extract_error_message(result: subprocess.CompletedProcess[str]) -> str:
    for value in (result.stderr, result.stdout):
        if not value:
            continue
        parsed = _parse_json_output(value)
        message = parsed.get("message") if isinstance(parsed, dict) else None
        if isinstance(message, str) and message.strip():
            return message.strip()
        stripped = value.strip()
        if stripped:
            return stripped
    return "Stored packets are insufficient to reconstruct the file"


def _parse_json_output(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if not text:
        return {}
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}
