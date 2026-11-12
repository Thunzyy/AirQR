import { useCallback, useEffect, type MutableRefObject, type RefObject } from "react";

import { createLogger } from "../utils/logger";
import type { ScanWorkerRequest } from "../workers/scanWorkerMessages";
import type { BarcodeDetectionResult, BarcodeDetectorLike } from "../features/scanner/barcodeDetector";

const logger = createLogger("hooks:useScannerFrameLoop");

type UseScannerFrameLoopArgs = {
  barcodeDetectorRef: MutableRefObject<BarcodeDetectorLike | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  decoderInitialized: boolean;
  fpsFrameCountRef: MutableRefObject<number>;
  fpsLastTimeRef: MutableRefObject<number>;
  handleDecodedData: (binaryData: Uint8Array) => void;
  hasCamera: boolean;
  isProcessingFrameRef: MutableRefObject<boolean>;
  isScanning: boolean;
  lastScanAtRef: MutableRefObject<number>;
  overlayRef: RefObject<HTMLCanvasElement | null>;
  requestRef: MutableRefObject<number>;
  resetGenerationRef?: MutableRefObject<number>;
  scanRequestIdRef?: MutableRefObject<number>;
  scanWorkerRef: MutableRefObject<Worker | null>;
  scannerConfig: {
    scanInterval: number;
    tryHarder: boolean;
  };
  setFps: (value: number) => void;
  useNativeDetector: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
};

export function useScannerFrameLoop({
  barcodeDetectorRef,
  canvasRef,
  decoderInitialized,
  fpsFrameCountRef,
  fpsLastTimeRef,
  handleDecodedData,
  hasCamera,
  isProcessingFrameRef,
  isScanning,
  lastScanAtRef,
  overlayRef,
  requestRef,
  resetGenerationRef,
  scanRequestIdRef,
  scanWorkerRef,
  scannerConfig,
  setFps,
  useNativeDetector,
  videoRef,
}: UseScannerFrameLoopArgs) {
  const tick = useCallback(async () => {
    if (!isScanning || !videoRef.current || !canvasRef.current) {
      return;
    }

    if (isProcessingFrameRef.current) {
      return;
    }

    const now = performance.now();
    if (
      scannerConfig.scanInterval > 0 &&
      now - lastScanAtRef.current < scannerConfig.scanInterval
    ) {
      return;
    }
    lastScanAtRef.current = now;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const overlay = overlayRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    if (video.readyState !== video.HAVE_ENOUGH_DATA || !ctx) {
      return;
    }
    if (!useNativeDetector && !scanWorkerRef.current) return;

    // Count actual analysis submissions, just like the native iOS pipeline.
    fpsFrameCountRef.current += 1;
    const fpsDelta = now - fpsLastTimeRef.current;
    if (fpsDelta >= 1000) {
      setFps(Math.round((fpsFrameCountRef.current * 1000) / fpsDelta));
      fpsFrameCountRef.current = 0;
      fpsLastTimeRef.current = now;
    }

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      if (overlay) {
        overlay.width = video.videoWidth;
        overlay.height = video.videoHeight;
      }
    }

    isProcessingFrameRef.current = true;
    const frameGeneration = resetGenerationRef?.current ?? 0;

    const clearOverlay = () => {
      const overlayCtx = overlay?.getContext("2d");
      overlayCtx?.clearRect(0, 0, overlay?.width ?? 0, overlay?.height ?? 0);
    };

    if (useNativeDetector && barcodeDetectorRef.current) {
      try {
        const barcodes = await barcodeDetectorRef.current.detect(video);
        if ((resetGenerationRef?.current ?? frameGeneration) !== frameGeneration) {
          return;
        }

        if (barcodes.length > 0) {
          const qr: BarcodeDetectionResult = barcodes[0];
          const encoder = new TextEncoder();
          const binaryData = encoder.encode(qr.rawValue);

          if (overlay && qr.cornerPoints) {
            const overlayCtx = overlay.getContext("2d");
            if (overlayCtx) {
              overlayCtx.clearRect(0, 0, overlay.width, overlay.height);
              overlayCtx.beginPath();
              overlayCtx.lineWidth = 4;
              overlayCtx.strokeStyle = "#00FF00";
              overlayCtx.moveTo(qr.cornerPoints[0].x, qr.cornerPoints[0].y);
              for (let index = 1; index < qr.cornerPoints.length; index += 1) {
                overlayCtx.lineTo(
                  qr.cornerPoints[index].x,
                  qr.cornerPoints[index].y
                );
              }
              overlayCtx.closePath();
              overlayCtx.stroke();
            }
          }

          handleDecodedData(binaryData);
        } else if (overlay) {
          clearOverlay();
        }
      } catch (error) {
        logger.error("BarcodeDetector error", { error: error instanceof Error ? error.message : String(error) });
      } finally {
        if ((resetGenerationRef?.current ?? frameGeneration) === frameGeneration) {
          isProcessingFrameRef.current = false;
        }
      }
      return;
    }

    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const worker = scanWorkerRef.current;
      if (!worker) throw new Error("Scan worker unavailable");
      const requestId = scanRequestIdRef ? ++scanRequestIdRef.current : undefined;
      const data = imageData.data.buffer;
      if (!(data instanceof ArrayBuffer)) throw new Error('Camera buffer is not transferable');
      const request: ScanWorkerRequest = {
        type: "SCAN", data,
        width: canvas.width, height: canvas.height,
        tryHarder: scannerConfig.tryHarder,
      };
      if (requestId !== undefined) request.requestId = requestId;
      // ImageData already owns RGBA bytes. Transfer them; ZXing handles luminance
      // in the worker, avoiding RGBA -> gray -> RGBA copies on every frame.
      worker.postMessage(request, [data]);
    } catch (error) {
      if ((resetGenerationRef?.current ?? frameGeneration) === frameGeneration) {
        isProcessingFrameRef.current = false;
      }
      logger.warn("Camera frame could not be submitted", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

  }, [
    barcodeDetectorRef,
    canvasRef,
    fpsFrameCountRef,
    fpsLastTimeRef,
    handleDecodedData,
    isProcessingFrameRef,
    isScanning,
    lastScanAtRef,
    overlayRef,
    resetGenerationRef,
    scanRequestIdRef,
    scanWorkerRef,
    scannerConfig.scanInterval,
    scannerConfig.tryHarder,
    setFps,
    useNativeDetector,
    videoRef,
  ]);

  useEffect(() => {
    const loop = () => {
      void tick();
      requestRef.current = requestAnimationFrame(loop);
    };

    if (hasCamera && isScanning && decoderInitialized) {
      loop();
    }

    return () => cancelAnimationFrame(requestRef.current);
  }, [decoderInitialized, hasCamera, isScanning, requestRef, tick]);

  return { tick };
}
