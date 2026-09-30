import { describe, expect, it } from 'vitest';

import {
  buildEncodedPayload,
  buildParallelEncodePayload,
  buildStreamingChunkPayload,
  resolveEffectivePacketSize,
} from '@web/utils/encoderPayload';

describe('encoderBenchmarkConfig', () => {
  it('forwards compressionEnabled for standard worker jobs', () => {
    const payload = buildParallelEncodePayload({
      filename: 'fixture.bin',
      data: new Uint8Array([1, 2, 3, 4]),
      sessionId: 1779460248,
      config: {
        fps: 12,
        ecc: 'MEDIUM',
        packetSize: 900,
        targetSize: 220,
        raptorqOverhead: 1.2,
        compressionEnabled: false,
      },
    });

    expect(payload).toMatchObject({
      filename: 'fixture.bin',
      frameDelay: 83,
      sessionId: 1779460248,
      ecc: 'MEDIUM',
      packetSize: 900,
      targetSize: 220,
      raptorqOverhead: 1.2,
      compressionEnabled: false,
    });
  });

  it('respects compressionEnabled when building the encoded payload', () => {
    const repeated = new Uint8Array(4096);
    repeated.fill(65);

    const compressed = buildEncodedPayload({
      filename: 'compressible.txt',
      data: repeated,
      compressionEnabled: true,
    });
    const raw = buildEncodedPayload({
      filename: 'compressible.txt',
      data: repeated,
      compressionEnabled: false,
    });

    expect(compressed[0]).toBe(2);
    expect(raw[0]).toBe(0);
    expect(compressed.length).toBeLessThan(raw.length);
  });

  it('computes the effective packet size that metadata should expose', () => {
    expect(
      resolveEffectivePacketSize({
        requestedPacketSize: 901,
        encodedPayloadBytes: 2048,
      })
    ).toBe(900);

    expect(
      resolveEffectivePacketSize({
        requestedPacketSize: 250,
        encodedPayloadBytes: 600_000,
      })
    ).toBe(300);
  });

  it('keeps streaming payloads benchmarkable with the same compression controls', () => {
    const chunk = new Uint8Array(4096);
    chunk.fill(90);

    const payload = buildStreamingChunkPayload({
      filename: 'stream.txt',
      chunkData: chunk,
      requestedPacketSize: 250,
      compressionEnabled: true,
    });

    expect(payload.encodedPayload[0]).toBe(2);
    expect(payload.effectivePacketSize).toBeGreaterThanOrEqual(250);
    expect(payload.effectivePacketSize % 4).toBe(0);
  });
});
