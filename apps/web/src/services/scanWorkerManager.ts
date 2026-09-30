import { createLogger } from "../utils/logger";
import {
  normalizeScanWorkerMessage,
  type ScanWorkerRequest,
  type ScanWorkerResponse,
} from "../workers/scanWorkerMessages";

const logger = createLogger("services:scanManager");

export type ScanWorkerInitOptions = {
  warmup?: boolean;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 12000;
const isTestEnv = import.meta.env.MODE === "test";

let workerInstance: Worker | null = null;
let initPromise: Promise<Worker> | null = null;
let warmupPromise: Promise<void> | null = null;
let warmupDone = false;

const createWorker = (): Worker =>
  new Worker(new URL("../workers/scan.worker.ts", import.meta.url), {
    type: "module",
  });

const waitForWorkerMessage = (
  worker: Worker,
  types: readonly ScanWorkerResponse["type"][],
  timeoutMs: number,
): Promise<ScanWorkerResponse | null> =>
  new Promise((resolve, reject) => {
    if (timeoutMs <= 0) {
      resolve(null);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("Scan worker warmup timed out"));
    }, timeoutMs);

    const handleMessage = (event: MessageEvent) => {
      const payload = normalizeScanWorkerMessage(event.data);
      if (!payload || !types.includes(payload.type)) {
        return;
      }
      cleanup();
      resolve(payload);
    };

    const handleError = (event: ErrorEvent) => {
      cleanup();
      reject(
        event.error instanceof Error ? event.error : new Error(event.message),
      );
    };

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      worker.removeEventListener("message", handleMessage);
      worker.removeEventListener("error", handleError);
    };

    worker.addEventListener("message", handleMessage);
    worker.addEventListener("error", handleError);
  });

export const getScanWorker = (): Worker | null => workerInstance;

export const warmupScanWorker = async (
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<void> => {
  if (warmupDone) return;
  if (!workerInstance) {
    throw new Error("Scan worker not initialized");
  }
  const worker = workerInstance;
  if (warmupPromise) {
    return warmupPromise;
  }
  if (isTestEnv) {
    warmupDone = true;
    return;
  }

  warmupPromise = (async () => {
    const request: ScanWorkerRequest = { type: "WARMUP" };
    worker.postMessage(request);
    const response = await waitForWorkerMessage(
      worker,
      ["WARMUP_COMPLETE", "WARMUP_ERROR"],
      timeoutMs,
    );
    if (response?.type === "WARMUP_ERROR") {
      throw new Error(response.error || "Warmup failed");
    }
    warmupDone = true;
  })();

  try {
    await warmupPromise;
  } finally {
    warmupPromise = null;
  }
};

export const initScanWorker = async (
  options: ScanWorkerInitOptions = {},
): Promise<Worker> => {
  if (workerInstance) return workerInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const worker = createWorker();
    try {
      workerInstance = worker;

      if (!isTestEnv && options.warmup !== false) {
        try {
          await warmupScanWorker(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        } catch (error) {
          logger.warn("Scan worker warmup failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return worker;
    } catch (error) {
      worker.terminate();
      throw error;
    }
  })();

  try {
    return await initPromise;
  } catch (error) {
    workerInstance = null;
    initPromise = null;
    throw error;
  }
};

export const terminateScanWorker = (): void => {
  if (!workerInstance) return;
  try {
    const request: ScanWorkerRequest = { type: "TERMINATE" };
    workerInstance.postMessage(request);
  } catch {
    // Ignore errors during teardown.
  }
  workerInstance.terminate();
  workerInstance = null;
  initPromise = null;
  warmupPromise = null;
  warmupDone = false;
};
