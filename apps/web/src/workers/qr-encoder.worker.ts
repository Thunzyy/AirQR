// QR Encoder Worker - Handles parallel QR code generation
// Supports both Uint8Array and ImageBitmap (zero-copy) output modes
import init, {
  encode_qr_packet,
  encode_streaming_qr_packet,
} from "../pkg/airqr_core";
import { globalHas } from "../parse/wire";
import type {
  QRPacketResult,
  QRPacketTask,
  QrWorkerRequest,
} from "./qrWorkerMessages";

let wasmInitialized = false;

const hasOffscreenCanvas = globalHas("OffscreenCanvas");

// Convert 1-bit indexed data to ImageBitmap using OffscreenCanvas
async function indexedToBitmap(
  data: Uint8Array,
  width: number,
  height: number
): Promise<ImageBitmap> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  const imageData = ctx.createImageData(width, height);
  const pixels = imageData.data;

  // Convert 1-bit indexed (0=white, 1=black) to RGBA
  for (let i = 0; i < data.length; i++) {
    const idx = i * 4;
    const color = data[i] === 1 ? 0 : 255;
    pixels[idx] = color; // R
    pixels[idx + 1] = color; // G
    pixels[idx + 2] = color; // B
    pixels[idx + 3] = 255; // A
  }

  ctx.putImageData(imageData, 0, 0);
  return createImageBitmap(canvas);
}

self.onmessage = async (e: MessageEvent<QrWorkerRequest>) => {
  const message = e.data;
  const { type } = message;

  if (type === "INIT") {
    try {
      await init();
      wasmInitialized = true;
      self.postMessage({
        type: "INIT_SUCCESS",
        hasOffscreenCanvas,
      });
    } catch (err) {
      self.postMessage({
        type: "ERROR",
        payload: `WASM init failed: ${err}`,
      });
    }
    return;
  }

  if (type === "ENCODE_BATCH" && wasmInitialized) {
    try {
      const task: QRPacketTask = message.data;
      const useShared = task.sharedBuffer !== undefined;
      const useBitmap = task.useBitmap && hasOffscreenCanvas;
      const hasPackedPackets = task.packedPackets !== undefined;
      const frames: Array<{
        id: number;
        buffer: Uint8Array;
        bitmap?: ImageBitmap;
      }> = [];
      const bitmaps: ImageBitmap[] = [];

      let frameWidth = 0;
      let frameHeight = 0;

      let sharedView: Uint8Array | null = null;
      if (useShared && task.sharedBuffer) {
        sharedView = new Uint8Array(task.sharedBuffer.buffer);
      }

      const packetCount = hasPackedPackets
        ? task.packedPackets!.endIndex - task.packedPackets!.startIndex
        : task.packets?.length ?? 0;
      const packedDataView = hasPackedPackets
        ? task.packedPackets!.packetData
        : null;
      const packedOffsetsView = hasPackedPackets
        ? task.packedPackets!.packetOffsets
        : null;
      const packedIdsView = hasPackedPackets
        ? task.packedPackets!.packetIds
        : null;
      const packedIdOffsetsView = hasPackedPackets
        ? task.packedPackets!.packetIdOffsets
        : null;

      for (let i = 0; i < packetCount; i++) {
        const packet = hasPackedPackets
          ? null
          : task.packets?.[i];
        const packetIndex = hasPackedPackets
          ? task.packedPackets!.startIndex + i
          : packet!.id;
        const packetData =
          hasPackedPackets && packedDataView && packedOffsetsView
            ? packedDataView.subarray(
                packedOffsetsView[packetIndex],
                packedOffsetsView[packetIndex + 1]
              )
            : packet!.data;
        const packetId =
          hasPackedPackets && packedIdsView && packedIdOffsetsView
            ? packedIdsView.subarray(
                packedIdOffsetsView[packetIndex],
                packedIdOffsetsView[packetIndex + 1]
              )
            : packet!.packetId;
        let buffer: Uint8Array;

        if (task.streamingMetadata) {
          buffer = encode_streaming_qr_packet(
            packetData,
            packetId,
            task.streamingMetadata.sessionId,
            task.streamingMetadata.chunkId,
            task.streamingMetadata.totalChunks,
            task.streamingMetadata.chunkOffset,
            task.totalSize,
            task.packetSize,
            task.streamingMetadata.exactChunkPackets,
            task.eccLevel,
            task.targetSize,
            task.scale
          );
        } else {
          buffer = encode_qr_packet(
            packetData,
            task.totalSize,
            task.packetSize,
            packetId,
            task.eccLevel,
            task.targetSize,
            task.scale
          );
        }

        // Calculate frame dimensions from buffer size (square image)
        if (frameWidth === 0) {
          frameWidth = Math.sqrt(buffer.length);
          frameHeight = frameWidth;
        }

        if (useShared && sharedView && task.sharedBuffer) {
          const offset =
            task.sharedBuffer.startOffset + i * task.sharedBuffer.frameSize;
          sharedView.set(buffer, offset);
          frames.push({ id: packetIndex, buffer: new Uint8Array(0) });
        } else if (useBitmap) {
          // Convert to ImageBitmap for zero-copy transfer
          const bitmap = await indexedToBitmap(buffer, frameWidth, frameHeight);
          bitmaps.push(bitmap);
          frames.push({ id: packetIndex, buffer: new Uint8Array(0), bitmap });
        } else {
          frames.push({ id: packetIndex, buffer });
        }
      }

      const result: QRPacketResult = {
        batchId: task.batchId,
        frames: useShared ? [] : frames,
        frameWidth,
        frameHeight,
      };
      if (useShared) {
        result.frameCount = packetCount;
      }

      if (useShared) {
        self.postMessage({ type: "BATCH_COMPLETE", payload: result });
      } else if (useBitmap && bitmaps.length > 0) {
        self.postMessage(
          { type: "BATCH_COMPLETE", payload: result },
          { transfer: bitmaps },
        );
      } else {
        const transferList = frames
          .map((frame) => frame.buffer.buffer)
          .filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer);
        self.postMessage(
          { type: "BATCH_COMPLETE", payload: result },
          { transfer: transferList },
        );
      }
    } catch (err) {
      self.postMessage({
        type: "ERROR",
        payload: `Encoding failed: ${err}`,
      });
    }
  }

  if (type === "TERMINATE") {
    self.close();
  }
};
