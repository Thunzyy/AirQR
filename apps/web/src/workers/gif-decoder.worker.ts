// GIF Frame Decoder Worker - Parallel QR Detection
import { readBarcodes, type ReaderOptions } from "zxing-wasm/reader";
import type {
  GifDecoderWorkerRequest,
  GifDecoderWorkerResponse,
} from "./gifDecoderWorkerMessages";

const readerOptions: ReaderOptions = {
  formats: ["QRCode"],
  tryHarder: true,
  tryInvert: true,
  maxNumberOfSymbols: 1,
};

self.onmessage = async (e: MessageEvent<GifDecoderWorkerRequest>) => {
  const message = e.data;
  if (message.type !== "DECODE_FRAME") {
    return;
  }

  const { frameId, imageData } = message.payload;
  const startedAt = performance.now();

  try {
    const results = await readBarcodes(imageData, readerOptions);
    const decodeTimeMs = performance.now() - startedAt;

    if (results.length > 0) {
      const qr = results[0];
      const binaryData = qr.bytes || new TextEncoder().encode(qr.text);

      self.postMessage({
        type: "DECODE_FRAME_RESULT",
        payload: {
          frameId,
          found: true,
          binaryData,
          decodeTimeMs,
        },
      } satisfies GifDecoderWorkerResponse);
    } else {
      self.postMessage({
        type: "DECODE_FRAME_RESULT",
        payload: {
          frameId,
          found: false,
          decodeTimeMs,
        },
      } satisfies GifDecoderWorkerResponse);
    }
  } catch (err) {
    self.postMessage({
      type: "DECODE_FRAME_RESULT",
      payload: {
        frameId,
        found: false,
        error: String(err),
        decodeTimeMs: performance.now() - startedAt,
      },
    } satisfies GifDecoderWorkerResponse);
  }
};
