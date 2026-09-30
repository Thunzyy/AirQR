import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "fs/promises";
import path from "path";
import { GifReader } from "omggif";
import jsQR from "jsqr";
import { ImageData } from "canvas";
import init, {
  encode_to_gif,
  init_normal_decoder,
  decode_normal_packet,
  init_streaming_decoder,
} from "@web/wasm/airqrCoreTyped";

// Polyfill ImageData for jsQR if needed (though we usually extract from canvas)
global.ImageData = ImageData;

describe("Full Cycle: Encode (WASM) -> GIF -> Scan (jsQR) -> Decode (WASM)", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeAll(async () => {
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Load WASM
    const wasmPath = path.resolve(__dirname, "../../../apps/web/src/pkg/airqr_core_bg.wasm");
    const wasmBuffer = await fs.readFile(wasmPath);
    await init({ module_or_path: wasmBuffer });

    // Initialize decoders
    init_normal_decoder();
    init_streaming_decoder();
  });

  afterAll(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it("should verify WASM update", async () => {
    try {
      const _res = decode_normal_packet(new Uint8Array([1]));
    } catch {}
  });

  it("should encode data to GIF and successfully decode it back", async () => {
    // 1. Prepare Data
    // Create larger data to avoid single-packet edge cases (RaptorQ might panic if size < symbol size?)
    const textData = "This is a real-world test of the AirQR pipeline.".repeat(
      20
    );
    const encoder = new TextEncoder();
    const data = encoder.encode(textData);
    const filename = "test.txt";

    // 2. Encode to GIF using WASM
    // signature: filename, data, compression, delay, ecc, packet_size, target_size, scale, overhead, callback
    const gifBytes = encode_to_gif(
      filename,
      data,
      false, // compression off for simplicity/consistency with WASM decoder
      100,
      "MEDIUM",
      250, // Packet size
      500, // Target size (px)
      0, // Scale (auto)
      1.5, // Overhead
      (_phase: string, _current: number, _total: number) => {
        // console.log(`[Encoder] ${phase}: ${current}/${total}`);
      }
    );

    expect(gifBytes).toBeDefined();
    expect(gifBytes.length).toBeGreaterThan(0);
    // 3. Parse GIF
    const reader = new GifReader(new Uint8Array(gifBytes));
    const width = reader.width;
    const height = reader.height;
    const numFrames = reader.numFrames();

    expect(numFrames).toBeGreaterThan(0);

    // 4. Decode Frames
    const _decoded = false;
    let completed = false;

    // Create a buffer for RGBA data
    const pixelBuffer = new Uint8Array(width * height * 4);

    for (let i = 0; i < numFrames; i++) {
      // Extract frame to RGBA
      reader.decodeAndBlitFrameRGBA(i, pixelBuffer);

      // 5. Scan with jsQR
      // jsQR expects Uint8ClampedArray
      const clampedBuffer = new Uint8ClampedArray(pixelBuffer);
      const code = jsQR(clampedBuffer, width, height, {
        inversionAttempts: "attemptBoth",
      });

      if (code) {
        // 6. Decode with WASM Decoder
        // Try normal decoder
        try {
          const result = decode_normal_packet(code.binaryData);

          if (result.type === "completed") {
            // Verify content
            const decodedText = new TextDecoder().decode(result.data);
            expect(decodedText).toBe(textData);
            expect(result.filename).toBe(filename);

            completed = true;
            break; // We are done
          }
        } catch {
          // Don't fail immediately, some frames might be redundant or fail
        }
      }
    }

    expect(completed).toBe(true);
  });
});
