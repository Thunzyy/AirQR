import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useScannerFrameLoop } from "@web/hooks/useScannerFrameLoop";

function createVideoElement() {
  const video = document.createElement("video");

  Object.defineProperty(video, "readyState", {
    get: () => HTMLMediaElement.HAVE_ENOUGH_DATA,
    configurable: true,
  });
  Object.defineProperty(video, "videoWidth", {
    get: () => 2,
    configurable: true,
  });
  Object.defineProperty(video, "videoHeight", {
    get: () => 1,
    configurable: true,
  });

  return video;
}

function createCanvasContext() {
  return {
    drawImage: vi.fn(),
    getImageData: vi.fn(() => ({
      data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]),
    })),
  };
}

function createOverlayContext() {
  return {
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    closePath: vi.fn(),
    lineTo: vi.fn(),
    lineWidth: 0,
    moveTo: vi.fn(),
    stroke: vi.fn(),
    strokeStyle: "",
  };
}

function createArgs(
  overrides?: Partial<Parameters<typeof useScannerFrameLoop>[0]>
) {
  const handleDecodedData = vi.fn();
  const setFps = vi.fn();
  const video = createVideoElement();
  const canvasContext = createCanvasContext();
  const overlayContext = createOverlayContext();
  const canvas = document.createElement("canvas");
  const overlay = document.createElement("canvas");
  const scanWorker = {
    postMessage: vi.fn(),
  };

  Object.defineProperty(canvas, "getContext", {
    value: vi.fn(() => canvasContext),
    configurable: true,
  });
  Object.defineProperty(overlay, "getContext", {
    value: vi.fn(() => overlayContext),
    configurable: true,
  });

  return {
    canvasContext,
    handleDecodedData,
    overlayContext,
    scanWorker,
    setFps,
    args: {
      barcodeDetectorRef: { current: null as { detect: ReturnType<typeof vi.fn> } | null },
      canvasRef: { current: canvas },
      decoderInitialized: false,
      fpsFrameCountRef: { current: 0 },
      fpsLastTimeRef: { current: 0 },
      handleDecodedData,
      hasCamera: false,
      isProcessingFrameRef: { current: false },
      isScanning: true,
      lastScanAtRef: { current: 0 },
      overlayRef: { current: overlay },
      requestRef: { current: 0 },
      scanWorkerRef: { current: scanWorker as unknown as Worker },
      scannerConfig: {
        scanInterval: 0,
        tryHarder: true,
      },
      setFps,
      useNativeDetector: false,
      videoRef: { current: video },
      ...overrides,
    },
  };
}

describe("useScannerFrameLoop", () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(performance, "now").mockReturnValue(1200);
    globalThis.requestAnimationFrame = vi.fn(() => 77);
    globalThis.cancelAnimationFrame = vi.fn();
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  });

  it("posts grayscale frames to the scan worker in worker mode", async () => {
    const { args, canvasContext, scanWorker, setFps } = createArgs();

    const { result } = renderHook(() => useScannerFrameLoop(args));

    await act(async () => {
      await result.current.tick();
    });

    expect(canvasContext.drawImage).toHaveBeenCalled();
    expect(scanWorker.postMessage).toHaveBeenCalledWith(
      {
        type: "SCAN",
        grayscale: expect.any(Uint8Array),
        width: 2,
        height: 1,
        tryHarder: true,
      },
      [expect.any(ArrayBuffer)]
    );
    const posted = scanWorker.postMessage.mock.calls[0]?.[0]?.grayscale as Uint8Array;
    expect(Array.from(posted)).toEqual([76, 149]);
    expect(args.isProcessingFrameRef.current).toBe(true);
    expect(setFps).toHaveBeenCalledWith(1);
  });

  it("uses BarcodeDetector directly in native mode and decodes the detected payload", async () => {
    const detector = {
      detect: vi.fn().mockResolvedValue([
        {
          rawValue: "abc",
          cornerPoints: [
            { x: 1, y: 1 },
            { x: 5, y: 1 },
            { x: 5, y: 4 },
            { x: 1, y: 4 },
          ],
        },
      ]),
    };
    const { args, handleDecodedData, overlayContext } = createArgs({
      barcodeDetectorRef: { current: detector },
      useNativeDetector: true,
    });

    const { result } = renderHook(() => useScannerFrameLoop(args));

    await act(async () => {
      await result.current.tick();
    });

    expect(detector.detect).toHaveBeenCalled();
    expect(handleDecodedData).toHaveBeenCalledWith(new TextEncoder().encode("abc"));
    expect(overlayContext.clearRect).toHaveBeenCalled();
    expect(overlayContext.beginPath).toHaveBeenCalled();
    expect(args.isProcessingFrameRef.current).toBe(false);
  });

  it("starts the animation loop only when camera and decoder are ready", async () => {
    const { args } = createArgs();

    const { rerender } = renderHook((currentArgs) => useScannerFrameLoop(currentArgs), {
      initialProps: args,
    });

    expect(globalThis.requestAnimationFrame).not.toHaveBeenCalled();

    rerender({
      ...args,
      decoderInitialized: true,
      hasCamera: true,
    });

    await waitFor(() => {
      expect(globalThis.requestAnimationFrame).toHaveBeenCalled();
    });
    expect(args.requestRef.current).toBe(77);
  });
});
