"""Integration tests for server-side packet assembly."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest

from sync_server.packet_assembler import assemble_scan_session_file
from sync_server.storage import Storage


def test_assemble_scan_session_file_uses_packaged_runtime_assets(tmp_path: Path) -> None:
    storage = Storage(tmp_path / "storage")
    storage.ensure_dirs()
    session_id = "packaged-runtime-session"
    packets_dir = storage.session_dir(session_id) / "packets"
    packets_dir.mkdir(parents=True, exist_ok=True)
    (packets_dir / "packet-0.bin").write_bytes(b"packet")

    def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        script_path = Path(command[1])
        runtime_dir = script_path.parent

        assert runtime_dir.name == "packet_assembler"
        assert (runtime_dir / "package.json").exists()
        assert (runtime_dir / "airqr_core.js").exists()
        assert (runtime_dir / "airqr_core_bg.wasm").exists()

        Path(command[3]).write_bytes(b"data")
        return subprocess.CompletedProcess(
            command,
            0,
            stdout='{"filename":"decoded.bin"}\n',
            stderr="",
        )

    with (
        patch("sync_server.packet_assembler.shutil.which", return_value="/usr/bin/node"),
        patch("sync_server.packet_assembler.subprocess.run", side_effect=fake_run),
    ):
        filename, file_bytes = assemble_scan_session_file(storage, session_id)

    assert filename == "decoded.bin"
    assert file_bytes == b"data"


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js is required for packet assembly tests")
def test_assemble_scan_session_file_reconstructs_normal_packets(tmp_path: Path) -> None:
    storage = Storage(tmp_path / "storage")
    storage.ensure_dirs()
    session_id = "packet-session"
    packets_dir = storage.session_dir(session_id) / "packets"
    packets_dir.mkdir(parents=True, exist_ok=True)

    generator = """
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import initWasm, { generate_raptorq_packets_raw } from './apps/web/src/pkg/airqr_core.js';

const [packetsDir] = process.argv.slice(2);
const wasmBytes = await import('node:fs/promises').then((fs) =>
  fs.readFile(new URL('./apps/web/src/pkg/airqr_core_bg.wasm', import.meta.url))
);
await initWasm({ module_or_path: wasmBytes });

const fileName = 'decoded.txt';
const fileBytes = new Uint8Array([65, 66, 67, 68]);
const fileNameBytes = new TextEncoder().encode(fileName);
const payload = new Uint8Array(1 + 4 + fileNameBytes.length + fileBytes.length);
payload[0] = 0;
payload.set(new Uint8Array(new Uint32Array([fileNameBytes.length]).buffer).reverse(), 1);
payload.set(fileNameBytes, 5);
payload.set(fileBytes, 5 + fileNameBytes.length);

const [metadata, packets] = generate_raptorq_packets_raw(payload, 12, 2.0);
const totalSize = Number(metadata.totalSize);

for (let index = 0; index < packets.length; index += 1) {
  const packet = packets[index];
  const packetData = new Uint8Array(packet.data);
  const packetId = new Uint8Array(packet.packetId);
  const fullPacket = new Uint8Array(10 + packetData.length);
  fullPacket.set([
    (totalSize >>> 24) & 0xff,
    (totalSize >>> 16) & 0xff,
    (totalSize >>> 8) & 0xff,
    totalSize & 0xff,
  ], 0);
  fullPacket.set([
    (packetData.length >>> 8) & 0xff,
    packetData.length & 0xff,
  ], 4);
  fullPacket.set(packetId, 6);
  fullPacket.set(packetData, 10);
  await writeFile(path.join(packetsDir, `packet-${index}.bin`), fullPacket);
}
"""

    subprocess.run(
        ["node", "--input-type=module", "-", str(packets_dir)],
        input=generator,
        text=True,
        check=True,
        cwd=Path(__file__).resolve().parents[3],
    )

    filename, file_bytes = assemble_scan_session_file(storage, session_id)

    assert filename == "decoded.txt"
    assert file_bytes == b"ABCD"


def test_assemble_scan_session_file_reconstructs_ws_binary_packets(tmp_path: Path) -> None:
    storage = Storage(tmp_path / "storage")
    storage.ensure_dirs()
    session_id = "ws-binary-session"
    packets_dir = storage.session_dir(session_id) / "packets"
    packets_dir.mkdir(parents=True, exist_ok=True)

    storage.write_session(
        session_id,
        {
            "sessionId": session_id,
            "encoding": "ws-binary-v1",
            "filename": "ws-file.bin",
            "size": 7,
            "expectedPackets": 2,
        },
    )

    generator = """
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import initWasm, { generate_raptorq_packets_raw } from './apps/web/src/pkg/airqr_core.js';

const [packetsDir] = process.argv.slice(2);
const wasmBytes = await import('node:fs/promises').then((fs) =>
  fs.readFile(new URL('./apps/web/src/pkg/airqr_core_bg.wasm', import.meta.url))
);
await initWasm({ module_or_path: wasmBytes });

const fileName = 'ws-file.bin';
const fileBytes = new Uint8Array([65, 66, 67, 68]);
const fileNameBytes = new TextEncoder().encode(fileName);
const payload = new Uint8Array(1 + 4 + fileNameBytes.length + fileBytes.length);
payload[0] = 0;
payload.set(new Uint8Array(new Uint32Array([fileNameBytes.length]).buffer).reverse(), 1);
payload.set(fileNameBytes, 5);
payload.set(fileBytes, 5 + fileNameBytes.length);

const [metadata, packets] = generate_raptorq_packets_raw(payload, 12, 2.0);
const totalSize = Number(metadata.totalSize);

for (let index = 0; index < packets.length; index += 1) {
  const packet = packets[index];
  const packetData = new Uint8Array(packet.data);
  const packetId = new Uint8Array(packet.packetId);
  const fullPacket = new Uint8Array(10 + packetData.length);
  fullPacket.set([
    (totalSize >>> 24) & 0xff,
    (totalSize >>> 16) & 0xff,
    (totalSize >>> 8) & 0xff,
    totalSize & 0xff,
  ], 0);
  fullPacket.set([
    (packetData.length >>> 8) & 0xff,
    packetData.length & 0xff,
  ], 4);
  fullPacket.set(packetId, 6);
  fullPacket.set(packetData, 10);
  await writeFile(path.join(packetsDir, `packet-${index.toString(16).padStart(8, '0')}-ws-${fullPacket.length}.bin`), fullPacket);
}
"""

    subprocess.run(
        ["node", "--input-type=module", "-", str(packets_dir)],
        input=generator,
        text=True,
        check=True,
        cwd=Path(__file__).resolve().parents[3],
    )

    filename, file_bytes = assemble_scan_session_file(storage, session_id)

    assert filename == "ws-file.bin"
    assert file_bytes == b"ABCD"


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js is required for packet assembly tests")
def test_assemble_scan_session_file_rejects_incomplete_ws_binary_packets(tmp_path: Path) -> None:
    storage = Storage(tmp_path / "storage")
    storage.ensure_dirs()
    session_id = "ws-incomplete-session"
    packets_dir = storage.session_dir(session_id) / "packets"
    packets_dir.mkdir(parents=True, exist_ok=True)

    storage.write_session(
        session_id,
        {
            "sessionId": session_id,
            "encoding": "ws-binary-v1",
            "filename": "ws-file.bin",
            "size": 32,
            "expectedPackets": 8,
        },
    )

    generator = """
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import initWasm, { generate_raptorq_packets_raw } from './apps/web/src/pkg/airqr_core.js';

const [packetsDir] = process.argv.slice(2);
const wasmBytes = await import('node:fs/promises').then((fs) =>
  fs.readFile(new URL('./apps/web/src/pkg/airqr_core_bg.wasm', import.meta.url))
);
await initWasm({ module_or_path: wasmBytes });

const fileName = 'ws-file.bin';
const fileBytes = new Uint8Array(Array.from({ length: 32 }, (_, index) => 65 + (index % 26)));
const fileNameBytes = new TextEncoder().encode(fileName);
const payload = new Uint8Array(1 + 4 + fileNameBytes.length + fileBytes.length);
payload[0] = 0;
payload.set(new Uint8Array(new Uint32Array([fileNameBytes.length]).buffer).reverse(), 1);
payload.set(fileNameBytes, 5);
payload.set(fileBytes, 5 + fileNameBytes.length);

const [metadata, packets] = generate_raptorq_packets_raw(payload, 12, 1.0);
const totalSize = Number(metadata.totalSize);

const packet = packets[0];
const packetData = new Uint8Array(packet.data);
const packetId = new Uint8Array(packet.packetId);
const fullPacket = new Uint8Array(10 + packetData.length);
fullPacket.set([
  (totalSize >>> 24) & 0xff,
  (totalSize >>> 16) & 0xff,
  (totalSize >>> 8) & 0xff,
  totalSize & 0xff,
], 0);
fullPacket.set([
  (packetData.length >>> 8) & 0xff,
  packetData.length & 0xff,
], 4);
fullPacket.set(packetId, 6);
fullPacket.set(packetData, 10);
await writeFile(path.join(packetsDir, `packet-00000000-ws-${fullPacket.length}.bin`), fullPacket);
"""

    subprocess.run(
        ["node", "--input-type=module", "-", str(packets_dir)],
        input=generator,
        text=True,
        check=True,
        cwd=Path(__file__).resolve().parents[3],
    )

    with pytest.raises(ValueError):
        assemble_scan_session_file(storage, session_id)


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js is required for packet assembly tests")
def test_assemble_scan_session_file_reconstructs_streaming_packets(tmp_path: Path) -> None:
    storage = Storage(tmp_path / "storage")
    storage.ensure_dirs()
    session_id = "streaming-session"
    packets_dir = storage.session_dir(session_id) / "packets"
    packets_dir.mkdir(parents=True, exist_ok=True)

    storage.write_session(
        session_id,
        {
            "sessionId": session_id,
            "encoding": "ws-binary-v1",
            "filename": "streaming.bin",
            "mimeType": "application/octet-stream",
            "size": 4,
            "expectedPackets": 1,
            "totalPackets": 2,
            "totalPacketsExact": True,
            "totalChunks": 1,
            "isStreaming": True,
        },
    )

    generator = """
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import initWasm, { generate_raptorq_packets_raw } from './apps/web/src/pkg/airqr_core.js';

const [packetsDir] = process.argv.slice(2);
const wasmBytes = await import('node:fs/promises').then((fs) =>
  fs.readFile(new URL('./apps/web/src/pkg/airqr_core_bg.wasm', import.meta.url))
);
await initWasm({ module_or_path: wasmBytes });

const sessionId = 1774822325 >>> 0;
const chunkId = 0;
const totalChunks = 1;
const chunkOffset = 0n;
const fileName = 'streaming.bin';
const fileBytes = new Uint8Array([65, 66, 67, 68]);
const fileNameBytes = new TextEncoder().encode(fileName);
const payload = new Uint8Array(1 + 4 + fileNameBytes.length + fileBytes.length);
payload[0] = 0;
payload.set(new Uint8Array(new Uint32Array([fileNameBytes.length]).buffer).reverse(), 1);
payload.set(fileNameBytes, 5);
payload.set(fileBytes, 5 + fileNameBytes.length);

const [metadata, packets] = generate_raptorq_packets_raw(payload, 12, 2.0);
const totalSize = Number(metadata.totalSize);
const exactChunkPackets = packets.length >>> 0;

for (let index = 0; index < packets.length; index += 1) {
  const packet = packets[index];
  const packetData = new Uint8Array(packet.data);
  const packetId = new Uint8Array(packet.packetId);
  const fullPacket = new Uint8Array(35 + packetData.length);
  fullPacket[0] = 2;
  fullPacket.set([
    (sessionId >>> 24) & 0xff,
    (sessionId >>> 16) & 0xff,
    (sessionId >>> 8) & 0xff,
    sessionId & 0xff,
  ], 1);
  fullPacket.set([
    (chunkId >>> 24) & 0xff,
    (chunkId >>> 16) & 0xff,
    (chunkId >>> 8) & 0xff,
    chunkId & 0xff,
  ], 5);
  fullPacket.set([
    (totalChunks >>> 24) & 0xff,
    (totalChunks >>> 16) & 0xff,
    (totalChunks >>> 8) & 0xff,
    totalChunks & 0xff,
  ], 9);
  fullPacket.set([
    Number((chunkOffset >> 56n) & 0xffn),
    Number((chunkOffset >> 48n) & 0xffn),
    Number((chunkOffset >> 40n) & 0xffn),
    Number((chunkOffset >> 32n) & 0xffn),
    Number((chunkOffset >> 24n) & 0xffn),
    Number((chunkOffset >> 16n) & 0xffn),
    Number((chunkOffset >> 8n) & 0xffn),
    Number(chunkOffset & 0xffn),
  ], 13);
  fullPacket.set([
    (totalSize >>> 24) & 0xff,
    (totalSize >>> 16) & 0xff,
    (totalSize >>> 8) & 0xff,
    totalSize & 0xff,
  ], 21);
  fullPacket.set([
    (packetData.length >>> 8) & 0xff,
    packetData.length & 0xff,
  ], 25);
  fullPacket.set([
    (exactChunkPackets >>> 24) & 0xff,
    (exactChunkPackets >>> 16) & 0xff,
    (exactChunkPackets >>> 8) & 0xff,
    exactChunkPackets & 0xff,
  ], 27);
  fullPacket.set(packetId, 31);
  fullPacket.set(packetData, 35);
  await writeFile(
    path.join(packetsDir, `packet-${index.toString(16).padStart(8, '0')}-stream-${fullPacket.length}.bin`),
    fullPacket,
  );
}
"""

    subprocess.run(
        ["node", "--input-type=module", "-", str(packets_dir)],
        input=generator,
        text=True,
        check=True,
        cwd=Path(__file__).resolve().parents[3],
    )

    filename, file_bytes = assemble_scan_session_file(storage, session_id)

    assert filename == "streaming.bin"
    assert file_bytes == b"ABCD"
