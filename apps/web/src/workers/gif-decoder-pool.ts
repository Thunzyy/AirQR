// GIF Decoder Worker Pool Manager
import {
  normalizeGifDecoderWorkerMessage,
  type GifDecoderFrameResult,
  type GifDecoderFrameTask,
  type GifDecoderWorkerRequest,
} from "./gifDecoderWorkerMessages";

export class GifDecoderPool {
  private workers: Worker[] = [];
  private pendingTasks: GifDecoderFrameTask[] = [];
  private pendingResolvers: Map<number, (result: GifDecoderFrameResult) => void> =
    new Map();
  private inFlightTasks: Map<number, GifDecoderFrameTask> = new Map();
  private availableWorkers: Set<number> = new Set();
  private workerCount: number;

  constructor(workerCount: number = navigator.hardwareConcurrency || 4) {
    this.workerCount = workerCount;
    this.initializeWorkers();
  }

  private initializeWorkers() {
    for (let i = 0; i < this.workerCount; i++) {
      const worker = new Worker(
        new URL("./gif-decoder.worker.ts", import.meta.url),
        { type: "module" }
      );

      worker.onmessage = (e: MessageEvent) => {
        const message = normalizeGifDecoderWorkerMessage(e.data);
        if (!message) {
          console.error(`GIF decoder worker ${i} returned an invalid message`);
          this.handleWorkerFailure(i, "Invalid GIF decoder worker message");
          return;
        }

        this.handleWorkerResult(i, message.payload);
      };

      worker.onerror = (err) => {
        console.error(`GIF decoder worker ${i} error:`, err);
        this.handleWorkerFailure(i, err.message || "GIF decoder worker error");
      };

      this.workers.push(worker);
      this.availableWorkers.add(i);
    }
  }

  private handleWorkerResult(workerId: number, result: GifDecoderFrameResult) {
    this.inFlightTasks.delete(workerId);
    const resolve = this.pendingResolvers.get(result.frameId);
    if (resolve) {
      this.pendingResolvers.delete(result.frameId);
      resolve(result);
    }

    // Mark worker as available and process next task
    this.availableWorkers.add(workerId);
    this.processQueue();
  }

  private handleWorkerFailure(workerId: number, error: string) {
    const task = this.inFlightTasks.get(workerId);
    this.inFlightTasks.delete(workerId);

    if (task) {
      const resolve = this.pendingResolvers.get(task.frameId);
      if (resolve) {
        this.pendingResolvers.delete(task.frameId);
        resolve({
          frameId: task.frameId,
          found: false,
          error,
          decodeTimeMs: 0,
        });
      }
    }

    this.availableWorkers.add(workerId);
    this.processQueue();
  }

  private processQueue() {
    while (this.pendingTasks.length > 0 && this.availableWorkers.size > 0) {
      const workerId = Array.from(this.availableWorkers)[0];
      this.availableWorkers.delete(workerId);

      const task = this.pendingTasks.shift();
      if (!task) {
        this.availableWorkers.add(workerId);
        break;
      }

      // Clone the ImageData to avoid detaching the original buffer
      const clonedImageData = new ImageData(
        new Uint8ClampedArray(task.imageData.data),
        task.imageData.width,
        task.imageData.height
      );
      this.inFlightTasks.set(workerId, task);
      const message: GifDecoderWorkerRequest = {
        type: "DECODE_FRAME",
        payload: {
          ...task,
          imageData: clonedImageData,
        },
      };
      this.workers[workerId].postMessage(message);
    }
  }

  public async decodeFrame(
    frameId: number,
    imageData: ImageData
  ): Promise<GifDecoderFrameResult> {
    return new Promise((resolve) => {
      const task: GifDecoderFrameTask = { frameId, imageData };
      this.pendingTasks.push(task);
      this.pendingResolvers.set(frameId, resolve);
      this.processQueue();
    });
  }

  public async decodeFrames(frames: ImageData[]): Promise<GifDecoderFrameResult[]> {
    const promises = frames.map((imageData, index) =>
      this.decodeFrame(index, imageData)
    );
    return Promise.all(promises);
  }

  public terminate() {
    this.workers.forEach((worker) => worker.terminate());
    this.workers = [];
    this.availableWorkers.clear();
    this.pendingTasks = [];
    this.pendingResolvers.clear();
    this.inFlightTasks.clear();
  }
}
