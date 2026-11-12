// Worker Pool Manager for Parallel QR Encoding
import {
  asWireObject,
  asWireString,
  isWireArray,
  isWireBoolean,
  isWireNumber,
  isWireObject,
  isWireString,
  type LogContext,
  type LogScalar,
  type WireValue,
} from "../parse/wire";
import { createLogger, handleWorkerLog, type WorkerLogMessage } from '../utils/logger';
import { getPackedQrWorkerTransferables } from "./raptorqPacketTransfer";
import {
  normalizeQrWorkerMessage,
  type QRPacketTask,
  type QRPacketResult,
  type QrWorkerRequest,
} from "./qrWorkerMessages";

function isLogScalar(value: WireValue | undefined): value is LogScalar {
  return value === null || isWireString(value) || isWireNumber(value) || isWireBoolean(value);
}

function parseLogContext(value: WireValue | undefined): LogContext | undefined {
  if (!isWireObject(value)) {
    return undefined;
  }
  const context: {
    [name: string]: LogScalar | Error | undefined | readonly LogScalar[];
  } = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined || isLogScalar(entry) || entry instanceof Error) {
      context[key] = entry;
      continue;
    }
    if (isWireArray(entry)) {
      const scalars: LogScalar[] = [];
      let allScalars = true;
      for (const item of entry) {
        if (!isLogScalar(item)) {
          allScalars = false;
          break;
        }
        scalars.push(item);
      }
      if (allScalars) {
        context[key] = scalars;
      }
    }
  }
  return context;
}

function parseWorkerLogMessage(value: WireValue): WorkerLogMessage | null {
  const record = asWireObject(value);
  if (asWireString(record.type) !== "LOG") {
    return null;
  }
  const level = asWireString(record.level);
  const module = asWireString(record.module);
  const message = asWireString(record.message);
  if (
    level !== "debug" &&
    level !== "info" &&
    level !== "warn" &&
    level !== "error"
  ) {
    return null;
  }
  if (module === undefined || message === undefined) {
    return null;
  }
  const logMessage: WorkerLogMessage = {
    type: "LOG",
    level,
    module,
    message,
  };
  const context = parseLogContext(record.context);
  if (context !== undefined) {
    logMessage.context = context;
  }
  return logMessage;
}

const logger = createLogger('workers:qr-pool');

interface PoolTask {
  task: QRPacketTask;
  resolve: (result: QRPacketResult) => void;
  reject: (error: Error) => void;
}

export class QRWorkerPool {
  private workers: Worker[] = [];
  private taskQueue: PoolTask[] = [];
  private activeWorkers = new Set<Worker>();
  private workerTasks = new Map<Worker, PoolTask>();
  private initialized = false;

  private poolSize: number;

  constructor(
    poolSize: number = Math.max(
      2,
      Math.min(8, navigator.hardwareConcurrency || 4)
    )
  ) {
    this.poolSize = poolSize;
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    logger.info(`Initializing QR Worker Pool with ${this.poolSize} workers`);

    // Create workers
    this.workers = Array(this.poolSize)
      .fill(null)
      .map(() => {
        const worker = new Worker(
          new URL("./qr-encoder.worker.ts", import.meta.url),
          { type: "module" }
        );

        worker.onmessage = (e) => this.handleWorkerMessage(worker, e.data);
        worker.onerror = (err) => this.handleWorkerError(worker, err);

        return worker;
      });

    // Initialize WASM in all workers
    await Promise.all(
      this.workers.map(
        (worker) =>
          new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Worker init timeout")), 10000);

            const handler = (e: MessageEvent) => {
              const message = normalizeQrWorkerMessage(e.data);
              if (message?.type === "INIT_SUCCESS") {
                clearTimeout(timeout);
                worker.removeEventListener("message", handler);
                resolve();
              } else if (message?.type === "ERROR") {
                clearTimeout(timeout);
                worker.removeEventListener("message", handler);
                reject(new Error(message.payload));
              }
            };

            worker.addEventListener("message", handler);
            const request: QrWorkerRequest = { type: "INIT" };
            worker.postMessage(request);
          })
      )
    );

    this.initialized = true;
    logger.info("Worker Pool initialized");
  }

  async encodeBatch(task: QRPacketTask): Promise<QRPacketResult> {
    if (!this.initialized) {
      throw new Error("Worker pool not initialized. Call init() first.");
    }

    return new Promise((resolve, reject) => {
      this.taskQueue.push({ task, resolve, reject });
      this.processQueue();
    });
  }

  private processQueue() {
    // Find available worker
    const availableWorker = this.workers.find(
      (w) => !this.activeWorkers.has(w)
    );

    if (!availableWorker || this.taskQueue.length === 0) {
      return;
    }

    const poolTask = this.taskQueue.shift()!;
    this.activeWorkers.add(availableWorker);
    this.workerTasks.set(availableWorker, poolTask);

    const transferList = (poolTask.task.packets ?? []).flatMap((packet) => [
      packet.data.buffer,
      packet.packetId.buffer,
    ]);
    if (poolTask.task.packedPackets) {
      transferList.push(...getPackedQrWorkerTransferables(poolTask.task.packedPackets));
    }
    const request: QrWorkerRequest = {
      type: "ENCODE_BATCH",
      data: poolTask.task,
    };
    availableWorker.postMessage(request, transferList);
  }

  private handleWorkerMessage(worker: Worker, data: WireValue) {
    const logMessage = parseWorkerLogMessage(data);
    if (logMessage) {
      handleWorkerLog(logMessage);
      return;
    }

    const message = normalizeQrWorkerMessage(data);
    if (!message) {
      return;
    }

    if (message.type === "BATCH_COMPLETE") {
      const poolTask = this.workerTasks.get(worker);
      if (poolTask) {
        poolTask.resolve(message.payload);
        this.workerTasks.delete(worker);
      }

      this.activeWorkers.delete(worker);
      this.processQueue();
    } else if (message.type === "ERROR") {
      const poolTask = this.workerTasks.get(worker);
      if (poolTask) {
        poolTask.reject(new Error(message.payload));
        this.workerTasks.delete(worker);
      }

      this.activeWorkers.delete(worker);
      this.processQueue();
    }
  }

  private handleWorkerError(worker: Worker, error: ErrorEvent) {
    logger.error("Worker error", { error: error instanceof Error ? error.message : String(error) });
    const poolTask = this.workerTasks.get(worker);
    if (poolTask) {
      poolTask.reject(new Error(error.message));
      this.workerTasks.delete(worker);
    }

    this.activeWorkers.delete(worker);
    this.processQueue();
  }

  async terminate() {
    this.workers.forEach((worker) => {
      const request: QrWorkerRequest = { type: "TERMINATE" };
      worker.postMessage(request);
      worker.terminate();
    });

    this.workers = [];
    this.taskQueue = [];
    this.activeWorkers.clear();
    this.workerTasks.clear();
    this.initialized = false;

    logger.info("Worker Pool terminated");
  }

  getPoolSize(): number {
    return this.poolSize;
  }

  getActiveWorkerCount(): number {
    return this.activeWorkers.size;
  }

  getQueueSize(): number {
    return this.taskQueue.length;
  }
}
