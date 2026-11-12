import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import initWasm, {
  decode_normal_packet,
  decode_streaming_packet,
  init_normal_decoder,
  init_streaming_decoder,
  reset_normal_decoder,
  reset_streaming_decoder,
} from './airqr_core.js';

async function loadDecoder() {
  const wasmBytes = await readFile(new URL('./airqr_core_bg.wasm', import.meta.url));
  await initWasm({ module_or_path: wasmBytes });
}

function isStreamingPacket(packetBytes) {
  return packetBytes instanceof Uint8Array
    && packetBytes.length > 0
    && (packetBytes[0] === 1 || packetBytes[0] === 2);
}

async function readPacketFiles(packetsDir) {
  const entries = await readdir(packetsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.startsWith('packet-') && entry.name.endsWith('.bin'))
    .map((entry) => path.join(packetsDir, entry.name))
    .sort();
}

async function assemblePackets(packetsDir, outputPath) {
  const packetFiles = await readPacketFiles(packetsDir);
  if (packetFiles.length === 0) {
    throw new Error('No packet files found for session');
  }

  await loadDecoder();
  const firstPacketBytes = new Uint8Array(await readFile(packetFiles[0]));
  const useStreamingDecoder = isStreamingPacket(firstPacketBytes);
  if (useStreamingDecoder) {
    reset_streaming_decoder();
    init_streaming_decoder();
  } else {
    reset_normal_decoder();
    init_normal_decoder();
  }

  let lastError = null;
  for (const packetFile of packetFiles) {
    const packetBytes = new Uint8Array(await readFile(packetFile));
    try {
      const result = useStreamingDecoder
        ? decode_streaming_packet(packetBytes)
        : decode_normal_packet(packetBytes);
      if (result?.type === 'completed' && result?.data) {
        await writeFile(outputPath, Buffer.from(result.data));
        return {
          filename: typeof result.filename === 'string' && result.filename.length > 0
            ? result.filename
            : 'file.bin',
          size: result.data.length,
          packetCount: packetFiles.length,
        };
      }
      if (result?.type === 'error' && typeof result.error === 'string') {
        lastError = result.error;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  throw new Error(lastError || 'Stored packets are insufficient to reconstruct the file');
}

async function main() {
  const [packetsDir, outputPath] = process.argv.slice(2);
  if (!packetsDir || !outputPath) {
    throw new Error('Usage: node assemble_scan_packets.mjs <packets-dir> <output-path>');
  }

  const result = await assemblePackets(packetsDir, outputPath);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ message })}\n`);
  process.exit(1);
});
