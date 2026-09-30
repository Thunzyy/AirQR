import baseInit, * as basePkg from "@web/pkg/airqr_core";

import { globalHas } from "../parse/wire";
import {
  normalizeGeneratedPacketSet,
  normalizeGeneratedPacketSetPacked,
  type GeneratedPacketSet,
  type GeneratedPacketSetPacked,
} from "./airqrCoreTyped";

type BasePkgModule = typeof import("@web/pkg/airqr_core");
type ThreadCapablePkgModule = BasePkgModule & {
  initThreadPool?: (threadCount: number) => Promise<void> | void;
};

interface ActiveWasmModule {
  init: typeof baseInit;
  kind: "non-threaded" | "threaded";
  pkg: ThreadCapablePkgModule;
}

let activeModule: ActiveWasmModule | null = null;
let initPromise: Promise<void> | null = null;
let threadPoolPromise: Promise<boolean> | null = null;
let threadPoolReady = false;

function shouldAttemptThreadedModule(): boolean {
  return (
    globalHas("SharedArrayBuffer")
    && globalThis.crossOriginIsolated === true
  );
}

function getActiveModule(): ActiveWasmModule {
  if (!activeModule) {
    return {
      init: baseInit,
      kind: "non-threaded",
      pkg: basePkg,
    };
  }

  return activeModule;
}

async function loadThreadedModule(): Promise<ActiveWasmModule> {
  const threadedModule = await import("@web/pkg-threaded/airqr_core");
  return {
    init: threadedModule.default,
    kind: "threaded",
    // SAFETY: the threaded WASM package is the non-threaded API plus optional initThreadPool.
    pkg: threadedModule as ThreadCapablePkgModule,
  };
}

export async function initThreadPoolIfAvailable(
  threadCount: number,
): Promise<boolean> {
  if (threadPoolReady) {
    return true;
  }

  const { pkg } = getActiveModule();
  if (!(pkg.initThreadPool instanceof Function)) {
    return false;
  }

  const normalizedThreadCount = Math.max(1, Math.floor(threadCount || 0));
  if (normalizedThreadCount <= 1) {
    return false;
  }

  if (!threadPoolPromise) {
    threadPoolPromise = Promise.resolve(pkg.initThreadPool(normalizedThreadCount))
      .then(() => {
        threadPoolReady = true;
        return true;
      })
      .catch(() => {
        threadPoolPromise = null;
        return false;
      });
  }

  return threadPoolPromise;
}

export default async function init(
  moduleOrPath?: Parameters<typeof baseInit>[0],
): Promise<void> {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    const initCandidates: ActiveWasmModule[] = [];
    if (shouldAttemptThreadedModule()) {
      try {
        initCandidates.push(await loadThreadedModule());
      } catch {
        // Ignore import failures and fall back to the non-threaded build.
      }
    }
    initCandidates.push({
      init: baseInit,
      kind: "non-threaded",
      pkg: basePkg,
    });

    let lastError: Error | undefined;
    for (const candidate of initCandidates) {
      try {
        await candidate.init(moduleOrPath);
        activeModule = candidate;
        threadPoolPromise = null;
        threadPoolReady = false;
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    throw lastError ?? new Error("Failed to initialize WASM module");
  })().catch((error) => {
    activeModule = null;
    initPromise = null;
    threadPoolPromise = null;
    threadPoolReady = false;
    throw error;
  });

  return initPromise;
}

export function generate_raptorq_packets_raw(
  rawData: Uint8Array,
  packetSize: number,
  raptorqOverhead: number,
): GeneratedPacketSet {
  return normalizeGeneratedPacketSet(
    getActiveModule().pkg.generate_raptorq_packets_raw(
      rawData,
      packetSize,
      raptorqOverhead,
    ),
  );
}

export function generate_raptorq_packets_raw_packed(
  rawData: Uint8Array,
  packetSize: number,
  raptorqOverhead: number,
): GeneratedPacketSetPacked {
  return normalizeGeneratedPacketSetPacked(
    getActiveModule().pkg.generate_raptorq_packets_raw_packed(
      rawData,
      packetSize,
      raptorqOverhead,
    ),
  );
}

export function measureQrPacketFrameSize(
  packetData: Uint8Array,
  totalSize: number,
  packetSize: number,
  packetId: Uint8Array,
  eccLevel: string,
  targetSize: number,
  scale: number,
): number {
  return getActiveModule().pkg.measure_qr_packet_frame_size(
    packetData,
    totalSize,
    packetSize,
    packetId,
    eccLevel,
    targetSize,
    scale,
  );
}

export function measureStreamingQrPacketFrameSize(
  packetData: Uint8Array,
  packetId: Uint8Array,
  sessionId: number,
  chunkId: number,
  totalChunks: number,
  chunkOffset: number,
  totalSize: number,
  packetSize: number,
  exactChunkPackets: number,
  eccLevel: string,
  targetSize: number,
  scale: number,
): number {
  return getActiveModule().pkg.measure_streaming_qr_packet_frame_size(
    packetData,
    packetId,
    sessionId,
    chunkId,
    totalChunks,
    chunkOffset,
    totalSize,
    packetSize,
    exactChunkPackets,
    eccLevel,
    targetSize,
    scale,
  );
}
