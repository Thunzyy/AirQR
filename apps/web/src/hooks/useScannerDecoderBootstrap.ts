import { useEffect, type MutableRefObject, type RefObject } from "react";

import init, {
  decode_normal_packet,
  decode_streaming_packet,
  init_normal_decoder,
  init_streaming_decoder,
} from "../wasm/airqrCoreTyped";
import { getIncompleteScanById } from "../services/historyDB";
import { visitScanSessionPacketPages } from "../services/scanSessionDB";
import { initScanWorker } from "../services/scanWorkerManager";
import { getLegacyIncompleteScanPackets } from "../utils/incompleteSync";
import { createLogger } from "../utils/logger";
import { normalizeScanWorkerMessage } from "../workers/scanWorkerMessages";
import type { BarcodeDetectorLike } from "../features/scanner/barcodeDetector";
import type { ResumeAuthority } from "../types";

const logger = createLogger("hooks:useScannerDecoderBootstrap");

type UseScannerDecoderBootstrapArgs = {
  barcodeDetectorRef: MutableRefObject<BarcodeDetectorLike | null>;
  handleDecodedData: (binaryData: Uint8Array) => void;
  isProcessingFrameRef: MutableRefObject<boolean>;
  overlayRef: RefObject<HTMLCanvasElement | null>;
  packetIndexRef: MutableRefObject<number>;
  resumeAuthority?: ResumeAuthority | null;
  resumeMode: boolean;
  resumeSessionId?: string;
  scanRequestIdRef?: MutableRefObject<number>;
  scanWorkerRef: MutableRefObject<Worker | null>;
  setDecoderInitialized: (ready: boolean) => void;
  setStatus: (status: string) => void;
  setUseNativeDetector: (enabled: boolean) => void;
  storedPackets: Uint8Array[];
  t: (key: string) => string;
};

function toPacketBytes(payload: ArrayBuffer | Uint8Array): Uint8Array {
  if (ArrayBuffer.isView(payload)) {
    return new Uint8Array(
      payload.buffer,
      payload.byteOffset,
      payload.byteLength
    );
  }
  return new Uint8Array(payload);
}

export function useScannerDecoderBootstrap({
  barcodeDetectorRef,
  handleDecodedData,
  isProcessingFrameRef,
  overlayRef,
  packetIndexRef,
  resumeAuthority,
  resumeMode,
  resumeSessionId,
  scanRequestIdRef,
  scanWorkerRef,
  setDecoderInitialized,
  setStatus,
  setUseNativeDetector,
  storedPackets,
  t,
}: UseScannerDecoderBootstrapArgs) {
  useEffect(() => {
    let isMounted = true;

    const restoreDecoderPacket = (packet: Uint8Array) => {
      const isStreaming =
        packet.length >= 31 && (packet[0] === 1 || packet[0] === 2);
      if (isStreaming) {
        decode_streaming_packet(packet);
      } else {
        decode_normal_packet(packet);
      }
    };

    const setupDecoder = async () => {
      try {
        await init();
        if (!isMounted) return;

        init_streaming_decoder();
        init_normal_decoder();

        const shouldRestoreLocalPackets = resumeAuthority !== "server";
        let resumePackets = shouldRestoreLocalPackets ? storedPackets : [];
        let restoredPacketCount = 0;

        if (
          resumeMode &&
          shouldRestoreLocalPackets &&
          resumePackets.length === 0 &&
          resumeSessionId
        ) {
          const packetSummary = await visitScanSessionPacketPages(
            resumeSessionId,
            (page) => {
              for (const packet of page.packets) {
                try {
                  restoreDecoderPacket(packet);
                  restoredPacketCount += 1;
                } catch (err) {
                  logger.error("Error restoring packet page entry", {
                    error: err instanceof Error ? err.message : String(err),
                  });
                }
              }
            }
          );
          if (!isMounted) return;

          if (packetSummary.packetCount === 0) {
            const storedScan = await getIncompleteScanById(resumeSessionId);
            if (!isMounted) return;
            resumePackets = getLegacyIncompleteScanPackets(storedScan);
          } else {
            logger.info("Loaded resume packet pages from IndexedDB", {
              pageCount: packetSummary.pageCount,
              packetCount: packetSummary.packetCount,
              sessionId: resumeSessionId,
            });
          }

          if (resumePackets.length > 0) {
            logger.info("Loaded resume packets from IndexedDB", {
              packetCount: resumePackets.length,
              sessionId: resumeSessionId,
            });
          }
        }

        if (resumeMode && resumePackets.length > 0) {
          logger.info("Restoring session from previous scan", {
            packetCount: resumePackets.length,
            sessionId: resumeSessionId,
          });
          for (const packet of resumePackets) {
            try {
              restoreDecoderPacket(packet);
              restoredPacketCount += 1;
            } catch (err) {
              logger.error("Error restoring packet", { error: err instanceof Error ? err.message : String(err) });
            }
          }
        }

        if (resumeMode && restoredPacketCount > 0) {
          packetIndexRef.current = restoredPacketCount;
          logger.info("WASM state restored", {
            packetCount: restoredPacketCount,
            sessionId: resumeSessionId,
          });
        } else if (resumeMode && storedPackets.length === 0) {
          logger.warn(
            "Resume started without stored packets; decoder restored to empty state",
            {
              sessionId: resumeSessionId,
            }
          );
        }

        if (!isMounted) return;
        setDecoderInitialized(true);
        setStatus(
          resumeMode ? t("scanner.resumingScan") : t("scanner.readyToScan")
        );
      } catch (err) {
        if (!isMounted) return;
        logger.error("Failed to init decoder", { error: err instanceof Error ? err.message : String(err) });
        setStatus(t("scanner.decoderError"));
      }
    };

    const setupBarcodeDetector = () => {
      barcodeDetectorRef.current = null;
      setUseNativeDetector(false);

      if ("BarcodeDetector" in window) {
        logger.info(
          "BarcodeDetector available but disabled because AirQR QR payloads are binary; using zxing-wasm worker"
        );
      } else {
        logger.info("BarcodeDetector not available, using zxing-wasm worker");
      }
    };

    const setupScanWorker = async () => {
      try {
        const worker = await initScanWorker({ warmup: true });
        if (!isMounted) return;
        scanWorkerRef.current = worker;

        worker.onmessage = (event: MessageEvent) => {
          const message = normalizeScanWorkerMessage(event.data);
          if (!message) {
            isProcessingFrameRef.current = false;
            return;
          }

          if (message.type === "WORKER_READY") {
            logger.debug("zxing-wasm worker ready");
            return;
          }

          if (message.type === "WARMUP_ERROR") {
            logger.error("Scan worker error", { error: message.error });
            isProcessingFrameRef.current = false;
            return;
          }

          if (message.type !== "SCAN_RESULT") {
            isProcessingFrameRef.current = false;
            return;
          }

          const overlay = overlayRef.current;
          const ctx = overlay?.getContext("2d");

          if (
            scanRequestIdRef &&
            scanRequestIdRef.current > 0 &&
            message.requestId !== scanRequestIdRef.current
          ) {
            if (overlay && ctx) {
              ctx.clearRect(0, 0, overlay.width, overlay.height);
            }
            isProcessingFrameRef.current = false;
            return;
          }

          if (overlay && ctx) {
            ctx.clearRect(0, 0, overlay.width, overlay.height);

            if (message.found && message.location) {
              ctx.beginPath();
              ctx.lineWidth = 4;
              ctx.strokeStyle = "#00FF00";
              ctx.moveTo(message.location.topLeftCorner.x, message.location.topLeftCorner.y);
              ctx.lineTo(message.location.topRightCorner.x, message.location.topRightCorner.y);
              ctx.lineTo(
                message.location.bottomRightCorner.x,
                message.location.bottomRightCorner.y
              );
              ctx.lineTo(
                message.location.bottomLeftCorner.x,
                message.location.bottomLeftCorner.y
              );
              ctx.lineTo(message.location.topLeftCorner.x, message.location.topLeftCorner.y);
              ctx.stroke();
            }
          }

          if (message.found && message.binaryData) {
            handleDecodedData(toPacketBytes(message.binaryData));
          }

          isProcessingFrameRef.current = false;
        };

        worker.onerror = (err) => {
          logger.error("Scan worker fatal error", { error: err instanceof Error ? err.message : String(err) });
          isProcessingFrameRef.current = false;
        };
      } catch (err) {
        logger.error("Failed to initialize scan worker", { error: err instanceof Error ? err.message : String(err) });
      }
    };

    void setupDecoder();
    setupBarcodeDetector();
    void setupScanWorker();

    return () => {
      isMounted = false;
      if (scanWorkerRef.current) {
        scanWorkerRef.current.onmessage = null;
        scanWorkerRef.current.onerror = null;
      }
      scanWorkerRef.current = null;
    };
    // Bootstrap the decoder/worker only once per scanner mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
