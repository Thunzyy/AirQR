// High-performance QR Scanner Worker using zxing-wasm
// zxing-wasm is ZXing C++ compiled to WebAssembly - near-native speed
import { readBarcodes, type ReaderOptions } from "zxing-wasm/reader";
import { asWireBoolean, asWireFiniteNumber } from "../parse/wire";
import type { ScanWorkerRequest, ScanWorkerScanResultMessage } from "./scanWorkerMessages";

// Reader options optimized for QR codes
const readerOptions: ReaderOptions = {
  formats: ["QRCode"],
  tryHarder: true,
  tryInvert: true,
  tryDownscale: true,
  maxNumberOfSymbols: 1,
};

let wasmLoaded = false;

self.onmessage = async (e: MessageEvent<ScanWorkerRequest>) => {
  const { type } = e.data;

  if (type === "TERMINATE") {
    self.close();
    return;
  }

  if (type === "WARMUP") {
    try {
      const warmupWidth = 4;
      const warmupHeight = 4;
      const rgba = new Uint8ClampedArray(warmupWidth * warmupHeight * 4);
      rgba.fill(255);
      const imageData = new ImageData(rgba, warmupWidth, warmupHeight);
      await readBarcodes(imageData, readerOptions);
      wasmLoaded = true;
      self.postMessage({ type: "WARMUP_COMPLETE" });
    } catch (err) {
      self.postMessage({ type: "WARMUP_ERROR", error: String(err) });
    }
    return;
  }

  if (type === "SCAN" || !type) {
    try {
      const { grayscale, data, width, height, tryHarder, requestId } = e.data;
      const parsedRequestId = asWireFiniteNumber(requestId);
      const parsedTryHarder = asWireBoolean(tryHarder);
      if (parsedTryHarder !== undefined && readerOptions.tryHarder !== parsedTryHarder) {
        readerOptions.tryHarder = parsedTryHarder;
      }
      let imageData: ImageData;

      // Handle grayscale input (from Scanner.tsx optimization)
      if (grayscale) {
        // Convert grayscale to RGBA for zxing-wasm
        const rgba = new Uint8ClampedArray(width * height * 4);
        for (let i = 0; i < grayscale.length; i++) {
          const idx = i * 4;
          const v = grayscale[i];
          rgba[idx] = v; // R
          rgba[idx + 1] = v; // G
          rgba[idx + 2] = v; // B
          rgba[idx + 3] = 255; // A
        }
        imageData = new ImageData(rgba, width, height);
      } else if (data) {
        // Direct RGBA data
        imageData = new ImageData(new Uint8ClampedArray(data), width, height);
      } else {
        const missingData: ScanWorkerScanResultMessage = {
          type: "SCAN_RESULT",
          found: false,
          error: "No image data provided",
        };
        if (parsedRequestId !== undefined) {
          missingData.requestId = parsedRequestId;
        }
        self.postMessage(missingData);
        return;
      }

      // Read barcodes using zxing-wasm
      const results = await readBarcodes(imageData, readerOptions);

      if (!wasmLoaded) {
        wasmLoaded = true;
        console.log("🔧 zxing-wasm loaded successfully");
      }

      if (results.length > 0) {
        const qr = results[0];

        // Get binary data from the QR code
        const binaryData = qr.bytes || new TextEncoder().encode(qr.text);

        // Convert position to corner points for overlay
        const pos = qr.position;
        const location = pos
          ? {
              topLeftCorner: { x: pos.topLeft.x, y: pos.topLeft.y },
              topRightCorner: { x: pos.topRight.x, y: pos.topRight.y },
              bottomRightCorner: { x: pos.bottomRight.x, y: pos.bottomRight.y },
              bottomLeftCorner: { x: pos.bottomLeft.x, y: pos.bottomLeft.y },
            }
          : null;

        const foundResult: ScanWorkerScanResultMessage = {
          type: "SCAN_RESULT",
          found: true,
          binaryData,
          location,
          data: qr.text,
          format: qr.format,
        };
        if (parsedRequestId !== undefined) {
          foundResult.requestId = parsedRequestId;
        }
        self.postMessage(foundResult);
      } else {
        const emptyResult: ScanWorkerScanResultMessage = {
          type: "SCAN_RESULT",
          found: false,
        };
        if (parsedRequestId !== undefined) {
          emptyResult.requestId = parsedRequestId;
        }
        self.postMessage(emptyResult);
      }
    } catch (err) {
      console.error("zxing-wasm scan error:", err);
      const requestId =
        e.data && "requestId" in e.data
          ? asWireFiniteNumber(e.data.requestId)
          : undefined;
      const errorResult: ScanWorkerScanResultMessage = {
        type: "SCAN_RESULT",
        found: false,
        error: String(err),
      };
      if (requestId !== undefined) {
        errorResult.requestId = requestId;
      }
      self.postMessage(errorResult);
    }
  }
};

// Signal that the worker is ready
self.postMessage({ type: "WORKER_READY" });
