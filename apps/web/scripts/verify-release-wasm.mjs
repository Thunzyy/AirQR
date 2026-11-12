import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as core from '../src/pkg/airqr_core.js';

core.initSync({ module: await readFile(new URL('../src/pkg/airqr_core_bg.wasm', import.meta.url)) });
const name = Buffer.from('regression.csv');
const data = Buffer.from(Array.from({ length: 4000 }, (_, n) => `${n},row-${n},${n * 7919}\n`).join(''));
const raw = Buffer.alloc(5 + name.length + data.length);
raw.writeUInt32BE(name.length, 1);
name.copy(raw, 5);
data.copy(raw, 5 + name.length);
let cases = 0;
for (const requested of [100, 250, 500, 1500]) {
  for (const packed of [false, true]) {
    const [metadata, result] = packed
      ? core.generate_raptorq_packets_raw_packed(raw, requested, 1.3)
      : core.generate_raptorq_packets_raw(raw, requested, 1.3);
    const packets = packed
      ? Array.from({ length: metadata.totalPackets }, (_, i) => ({
          data: result.packetData.subarray(result.packetOffsets[i], result.packetOffsets[i + 1]),
          packetId: result.packetIds.subarray(result.packetIdOffsets[i], result.packetIdOffsets[i + 1]),
        }))
      : result;
    assert.equal(metadata.packetSize, packets[0].data.length);
    for (const legacy of [false, true]) {
      core.init_normal_decoder();
      let decoded;
      for (const packet of packets) {
        const frame = Buffer.alloc(10 + packet.data.length);
        frame.writeUInt32BE(metadata.totalSize);
        frame.writeUInt16BE(legacy ? requested : metadata.packetSize, 4);
        frame.set(packet.packetId, 6);
        frame.set(packet.data, 10);
        decoded = core.decode_normal_packet(frame);
        if (decoded.type === 'completed') break;
      }
      assert.equal(decoded.type, 'completed');
      assert.equal(decoded.filename, name.toString());
      assert.deepEqual(Buffer.from(decoded.data), data);
      cases++;
    }
  }
}
console.log(`WASM release verification: ${cases} CSV roundtrips passed (packed/unpacked, aligned/legacy headers).`);
