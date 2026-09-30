import { globalHas } from "../parse/wire";

export interface StreamingChunkParallelismPlan {
  coordinatorCount: number;
  qrWorkersPerCoordinator: number;
  wasmThreadsPerCoordinator: number;
}

export interface StreamingChunkTaskDescriptor {
  chunkId: number;
  start: number;
  end: number;
  chunkBytes: number;
  payloadLength: number;
  finalPacketSize: number;
  fallbackMinFrames: number;
}

export interface SharedStreamingChunkInputRange {
  buffer: SharedArrayBuffer;
  start: number;
  end: number;
}

interface ResolveStreamingChunkSizeMBOptions {
  forceChunkMode: boolean;
  customChunkSize: number;
  dataBytes: number;
}

interface DescribeStreamingChunkTasksOptions {
  data: Uint8Array;
  chunkSizeBytes: number;
  filenameBytes: Uint8Array;
  requestedPacketSize: number;
}

interface RunTasksWithConcurrencyOptions<TTask, TResult> {
  tasks: readonly TTask[];
  concurrency: number;
  runTask: (task: TTask, slotIndex: number) => Promise<TResult>;
}

interface ShouldUseSharedChunkInputOptions {
  totalChunks: number;
  dataBytes: number;
  sharedArrayBufferAvailable: boolean;
}

interface ShouldUseStreamingEncodingOptions {
  customChunkSize?: number;
  encodedBytes: number;
  forceChunkMode: boolean;
  isArchiveInput: boolean;
  maxInlineBytes: number;
}

interface BuildChunkWorkerInputOptions {
  data: Uint8Array;
  task: Pick<StreamingChunkTaskDescriptor, "start" | "end">;
  sharedInputBuffer?: SharedArrayBuffer | null;
}

export function calculateWeightedChunkProgress(
  chunkWeights: readonly number[],
  chunkPercents: readonly number[],
): number {
  if (chunkWeights.length === 0 || chunkPercents.length === 0) {
    return 0;
  }

  const totalWeight = chunkWeights.reduce(
    (sum, weight) => sum + Math.max(0, weight),
    0,
  );
  if (totalWeight <= 0) {
    return 0;
  }

  const weightedProgress = chunkWeights.reduce((sum, weight, index) => {
    const percent = Math.max(
      0,
      Math.min(100, Number(chunkPercents[index] ?? 0) || 0),
    );
    return sum + percent * Math.max(0, weight);
  }, 0);

  return Math.floor(weightedProgress / totalWeight);
}

export function resolveStreamingChunkSizeMB({
  forceChunkMode,
  customChunkSize,
  dataBytes,
}: ResolveStreamingChunkSizeMBOptions): number {
  if (forceChunkMode) {
    return Number.isFinite(customChunkSize) && customChunkSize > 0
      ? customChunkSize
      : 10;
  }

  const sizeMB = dataBytes / (1024 * 1024);
  if (sizeMB > 500) return 50;
  if (sizeMB > 100) return 20;
  return 10;
}

export function shouldUseStreamingEncoding({
  customChunkSize = 10,
  encodedBytes,
  forceChunkMode,
  isArchiveInput,
  maxInlineBytes,
}: ShouldUseStreamingEncodingOptions): boolean {
  if (forceChunkMode) {
    return true;
  }

  if (encodedBytes > maxInlineBytes) {
    return true;
  }

  if (!isArchiveInput) {
    return false;
  }

  const chunkSizeMB = resolveStreamingChunkSizeMB({
    forceChunkMode: false,
    customChunkSize,
    dataBytes: encodedBytes,
  });
  const chunkSizeBytes = Math.max(1, Math.floor(chunkSizeMB * 1024 * 1024));

  return encodedBytes > chunkSizeBytes;
}

export function planStreamingChunkParallelism(
  totalChunks: number,
  hardwareConcurrency: number,
): StreamingChunkParallelismPlan {
  const cores = Math.max(1, Math.floor(hardwareConcurrency) || 4);
  const maxCoordinatorCount = cores >= 12 ? 3 : cores >= 6 ? 2 : 1;
  const coordinatorCount = Math.max(
    1,
    Math.min(totalChunks, maxCoordinatorCount),
  );

  return {
    coordinatorCount,
    qrWorkersPerCoordinator: Math.max(
      1,
      Math.min(4, Math.floor(cores / coordinatorCount) || 1),
    ),
    wasmThreadsPerCoordinator: Math.max(
      1,
      Math.floor(cores / coordinatorCount) || 1,
    ),
  };
}

export function shouldUseSharedChunkInput({
  totalChunks,
  dataBytes,
  sharedArrayBufferAvailable,
}: ShouldUseSharedChunkInputOptions): boolean {
  if (!sharedArrayBufferAvailable) {
    return false;
  }

  return totalChunks > 1 && dataBytes >= 8 * 1024 * 1024;
}

export function createSharedChunkInputBuffer(
  data: Uint8Array,
): SharedArrayBuffer | null {
  if (!globalHas("SharedArrayBuffer") || data.byteLength === 0) {
    return null;
  }

  const buffer = new SharedArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return buffer;
}

export function buildChunkWorkerInput({
  data,
  task,
  sharedInputBuffer,
}: BuildChunkWorkerInputOptions):
  | { chunkData: Uint8Array; sharedChunkData?: undefined }
  | { chunkData?: undefined; sharedChunkData: SharedStreamingChunkInputRange } {
  if (sharedInputBuffer) {
    return {
      sharedChunkData: {
        buffer: sharedInputBuffer,
        start: task.start,
        end: task.end,
      },
    };
  }

  return {
    chunkData: data.slice(task.start, task.end),
  };
}

export function describeStreamingChunkTasks({
  data,
  chunkSizeBytes,
  filenameBytes,
  requestedPacketSize,
}: DescribeStreamingChunkTasksOptions): StreamingChunkTaskDescriptor[] {
  const totalChunks = Math.ceil(data.length / Math.max(1, chunkSizeBytes));

  return Array.from({ length: totalChunks }, (_, chunkId) => {
    const start = chunkId * chunkSizeBytes;
    const end = Math.min(start + chunkSizeBytes, data.length);
    const chunkBytes = end - start;
    const payloadLength = 1 + 4 + filenameBytes.length + chunkBytes;
    let finalPacketSize = requestedPacketSize;

    if (payloadLength > 500_000 && finalPacketSize === 250) {
      let target = Math.floor(payloadLength / 2000);
      target = Math.max(250, Math.min(1500, target));
      finalPacketSize = target;
    }

    finalPacketSize = Math.floor(finalPacketSize / 4) * 4;
    if (finalPacketSize <= 0) {
      finalPacketSize = 4;
    }

    return {
      chunkId,
      start,
      end,
      chunkBytes,
      payloadLength,
      finalPacketSize,
      fallbackMinFrames: Math.ceil(payloadLength / finalPacketSize),
    };
  });
}

export async function runTasksWithConcurrency<TTask, TResult>({
  tasks,
  concurrency,
  runTask,
}: RunTasksWithConcurrencyOptions<TTask, TResult>): Promise<TResult[]> {
  if (tasks.length === 0) {
    return [];
  }

  const boundedConcurrency = Math.max(1, Math.min(concurrency, tasks.length));
  const results: TResult[] = [];
  let nextTaskIndex = 0;

  await Promise.all(
    Array.from({ length: boundedConcurrency }, (_, slotIndex) =>
      (async () => {
        while (true) {
          const taskIndex = nextTaskIndex;
          nextTaskIndex += 1;
          if (taskIndex >= tasks.length) {
            return;
          }

          results[taskIndex] = await runTask(tasks[taskIndex], slotIndex);
        }
      })(),
    ),
  );

  return results;
}
