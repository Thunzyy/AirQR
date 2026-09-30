import { createLogger } from "../utils/logger";
import { globalHas } from "../parse/wire";
import {
  normalizeEncoderWorkerMessage,
  type EncoderWorkerInitPayload,
  type EncoderWarmupConfig,
  type EncoderWorkerRequest,
  type EncoderWorkerResponse,
} from "../workers/encoderWorkerMessages";

const logger = createLogger("services:encoderManager");

export type EncoderWorkerInitOptions = {
  warmup?: boolean;
  warmupConfig?: EncoderWarmupConfig;
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 15000;
const isTestEnv = import.meta.env.MODE === "test";

let workerInstance: Worker | null = null;
let initPromise: Promise<Worker> | null = null;
let warmupPromise: Promise<void> | null = null;
let warmupDone = false;

const createWorker = (): Worker =>
  new Worker(new URL("../workers/worker-parallel.ts", import.meta.url), {
    type: "module",
  });

type InitStandaloneEncoderWorkerOptions = {
  qrPoolSize?: number;
  wasmThreadCount?: number;
  timeoutMs?: number;
};

const normalizePositiveInteger = (value: number | undefined): number | undefined =>
  Number.isFinite(value) && value !== undefined && value > 0
    ? Math.floor(value)
    : undefined;

const waitForWorkerMessage = (
  worker: Worker,
  types: readonly EncoderWorkerResponse["type"][],
  timeoutMs: number,
): Promise<EncoderWorkerResponse | null> =>
  new Promise((resolve, reject) => {
    if (timeoutMs <= 0) {
      resolve(null);
      return;
    }

    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error("Worker init timed out"));
    }, timeoutMs);

    const handleMessage = (event: MessageEvent) => {
      const payload = normalizeEncoderWorkerMessage(event.data);
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

export const getEncoderWorker = (): Worker | null => workerInstance;

export const warmupEncoderWorker = async (
  config?: EncoderWarmupConfig,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<void> => {
  if (warmupDone) return;
  if (!workerInstance) {
    throw new Error("Encoder worker not initialized");
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
    const request: EncoderWorkerRequest = { type: "WARMUP", payload: config };
    worker.postMessage(request);
    const response = await waitForWorkerMessage(
      worker,
      ["WARMUP_COMPLETE", "WARMUP_ERROR"],
      timeoutMs,
    );
    if (response?.type === "WARMUP_ERROR") {
      throw new Error(response.payload || "Warmup failed");
    }
    warmupDone = true;
  })();

  try {
    await warmupPromise;
  } finally {
    warmupPromise = null;
  }
};

export const initEncoderWorker = async (
  options: EncoderWorkerInitOptions = {},
): Promise<Worker> => {
  if (workerInstance) return workerInstance;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const worker = createWorker();
    try {
      const defaultWasmThreadCount = normalizePositiveInteger(
        globalHas("navigator") ? navigator.hardwareConcurrency : undefined,
      );
      const initPayload: EncoderWorkerInitPayload | undefined = defaultWasmThreadCount
        ? { wasmThreadCount: defaultWasmThreadCount }
        : undefined;

      const request: EncoderWorkerRequest = { type: "INIT", payload: initPayload };
      worker.postMessage(request);

      if (isTestEnv) {
        workerInstance = worker;
        return worker;
      }

      const response = await waitForWorkerMessage(
        worker,
        ["INIT_SUCCESS", "ERROR"],
        options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      );

      if (response?.type === "ERROR") {
        throw new Error(response.payload || "Worker init failed");
      }

      workerInstance = worker;

      if (options.warmup !== false) {
        try {
          await warmupEncoderWorker(
            options.warmupConfig,
            options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          );
        } catch (error) {
          logger.warn("Encoder worker warmup failed", {
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

export const createStandaloneEncoderWorker = async (
  options: InitStandaloneEncoderWorkerOptions = {},
): Promise<Worker> => {
  const worker = createWorker();
  const qrPoolSize = normalizePositiveInteger(options.qrPoolSize);
  const wasmThreadCount = normalizePositiveInteger(options.wasmThreadCount);
  const initPayload: EncoderWorkerInitPayload = {};
  if (qrPoolSize) {
    initPayload.qrPoolSize = qrPoolSize;
  }
  if (wasmThreadCount) {
    initPayload.wasmThreadCount = wasmThreadCount;
  }
  const payload =
    qrPoolSize || wasmThreadCount ? initPayload : undefined;

  const request: EncoderWorkerRequest = { type: "INIT", payload };
  worker.postMessage(request);

  if (isTestEnv) {
    return worker;
  }

  try {
    const response = await waitForWorkerMessage(
      worker,
      ["INIT_SUCCESS", "ERROR"],
      options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    if (response?.type === "ERROR") {
      throw new Error(response.payload || "Worker init failed");
    }
    return worker;
  } catch (error) {
    worker.terminate();
    throw error;
  }
};

export const terminateOwnedEncoderWorkers = (workers: readonly Worker[]): void => {
  for (const worker of workers) {
    try {
      const request: EncoderWorkerRequest = { type: "TERMINATE" };
      worker.postMessage(request);
    } catch {
      // Ignore teardown errors.
    }
    worker.terminate();
  }
};

export const terminateEncoderWorker = (): void => {
  if (!workerInstance) return;
  try {
    const request: EncoderWorkerRequest = { type: "TERMINATE" };
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
