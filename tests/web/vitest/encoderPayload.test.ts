import { describe, expect, it, vi } from "vitest";

vi.mock("fflate", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fflate")>();
  return {
    ...actual,
    deflateSync: vi.fn(actual.deflateSync),
  };
});

import { deflateSync } from "fflate";

import {
  buildParallelEncodePayload,
  buildSingleChunkStreamingMetadata,
  buildEncodedPayload,
  shouldAttemptDeflateCompression,
} from "@web/utils/encoderPayload";

function buildDeterministicRandomBytes(length: number): Uint8Array {
  let state = 0x12345678;
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[index] = state & 0xff;
  }
  return bytes;
}

describe("encoderPayload compression probe", () => {
  it("builds parallel encode payloads with a scan session id for server-visible single GIF metadata", () => {
    const data = new Uint8Array([1, 2, 3]);

    const payload = buildParallelEncodePayload({
      filename: "single.bin",
      data,
      sessionId: 1779460248,
      config: {
        fps: 10,
        ecc: "MEDIUM",
        packetSize: 250,
        targetSize: 200,
        raptorqOverhead: 1.2,
        compressionEnabled: false,
      },
    });

    expect(payload.sessionId).toBe(1779460248);
  });

  it("describes normal single GIFs as one exact streaming chunk for QR transport", () => {
    expect(
      buildSingleChunkStreamingMetadata({
        sessionId: 1779460248,
        totalFrames: 64,
      }),
    ).toEqual({
      sessionId: 1779460248,
      chunkId: 0,
      totalChunks: 1,
      chunkOffset: 0,
      exactChunkPackets: 64,
    });
  });

  it("skips compression attempts for obviously incompressible large payloads", () => {
    const incompressible = buildDeterministicRandomBytes(256 * 1024);

    expect(shouldAttemptDeflateCompression(incompressible)).toBe(false);
  });

  it("keeps compression enabled for clearly compressible large payloads", () => {
    const compressible = new TextEncoder().encode(
      "airqr-speed-check|".repeat(24_000),
    );

    expect(shouldAttemptDeflateCompression(compressible)).toBe(true);
  });

  it("avoids full-payload deflate for large incompressible payloads", () => {
    const filename = "random.bin";
    const randomFile = buildDeterministicRandomBytes(256 * 1024);

    const payload = buildEncodedPayload({
      filename,
      data: randomFile,
      compressionEnabled: true,
    });

    const deflateMock = vi.mocked(deflateSync);

    expect(payload[0]).toBe(0);
    expect(
      deflateMock.mock.calls.some(
        ([input]) => input instanceof Uint8Array && input.byteLength > 64 * 1024,
      ),
    ).toBe(false);
  });
});
