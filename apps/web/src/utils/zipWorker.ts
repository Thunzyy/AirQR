import { zip, unzip } from "fflate";
import { errorMessage, globalHas, type WireValue } from "../parse/wire";

type ZipWorkerResponse =
  | { type: "ZIP_RESULT"; id: string; data?: Uint8Array; error?: string }
  | { type: "ZIP_STREAM_READY"; id: string; error?: string }
  | { type: "ZIP_STREAM_APPENDED"; id: string; error?: string }
  | { type: "ZIP_STREAM_RESULT"; id: string; data?: Uint8Array; error?: string }
  | { type: "ZIP_STREAM_ABORTED"; id: string; error?: string }
  | {
      type: "UNZIP_RESULT";
      id: string;
      files?: Array<{ name: string; data: Uint8Array }>;
      error?: string;
    };

type UnzippedFile = { name: string; data: Uint8Array };

type PendingRequest =
  | {
      type: "ZIP";
      resolve: (value: Uint8Array) => void;
      reject: (error: Error) => void;
    }
  | {
      type: "UNZIP";
      resolve: (value: UnzippedFile[]) => void;
      reject: (error: Error) => void;
    }
  | {
      type: "ZIP_STREAM_INIT" | "ZIP_STREAM_APPEND" | "ZIP_STREAM_ABORT";
      resolve: () => void;
      reject: (error: Error) => void;
    }
  | {
      type: "ZIP_STREAM_FINALIZE";
      resolve: (value: Uint8Array) => void;
      reject: (error: Error) => void;
    };

let worker: Worker | null = null;
let requestCounter = 0;
const pending = new Map<string, PendingRequest>();

const toError = (error: WireValue | Error): Error =>
  error instanceof Error ? error : new Error(errorMessage(error));

const nextId = (): string => {
  requestCounter = (requestCounter + 1) % Number.MAX_SAFE_INTEGER;
  return `${Date.now()}-${requestCounter}`;
};

const handleWorkerMessage = (event: MessageEvent<ZipWorkerResponse>) => {
  const message = event.data;
  const entry = pending.get(message.id);
  if (!entry) return;

  pending.delete(message.id);

  if (message.error) {
    entry.reject(new Error(message.error));
    return;
  }

  if (message.type === "ZIP_STREAM_READY") {
    if (entry.type !== "ZIP_STREAM_INIT") {
      entry.reject(new Error("Zip worker response type mismatch"));
      return;
    }
    entry.resolve();
    return;
  }

  if (message.type === "ZIP_STREAM_APPENDED") {
    if (entry.type !== "ZIP_STREAM_APPEND") {
      entry.reject(new Error("Zip worker response type mismatch"));
      return;
    }
    entry.resolve();
    return;
  }

  if (message.type === "ZIP_STREAM_ABORTED") {
    if (entry.type !== "ZIP_STREAM_ABORT") {
      entry.reject(new Error("Zip worker response type mismatch"));
      return;
    }
    entry.resolve();
    return;
  }

  if (message.type === "ZIP_STREAM_RESULT") {
    if (entry.type !== "ZIP_STREAM_FINALIZE") {
      entry.reject(new Error("Zip worker response type mismatch"));
      return;
    }
    entry.resolve(message.data ?? new Uint8Array());
    return;
  }

  if (message.type === "ZIP_RESULT") {
    if (entry.type !== "ZIP") {
      entry.reject(new Error("Zip worker response type mismatch"));
      return;
    }
    entry.resolve(message.data ?? new Uint8Array());
    return;
  }

  if (entry.type !== "UNZIP") {
    entry.reject(new Error("Zip worker response type mismatch"));
    return;
  }
  entry.resolve(message.files ?? []);
};

const handleWorkerError = (error: ErrorEvent) => {
  pending.forEach((entry) => entry.reject(toError(error.error || error.message)));
  pending.clear();
  worker?.terminate();
  worker = null;
};

const getWorker = (): Worker | null => {
  if (worker || !globalHas("Worker")) {
    return worker;
  }

  try {
    worker = new Worker(new URL("../workers/zip-worker.ts", import.meta.url), {
      type: "module",
    });
    worker.onmessage = handleWorkerMessage;
    worker.onerror = handleWorkerError;
    return worker;
  } catch (error) {
    console.warn("Zip worker unavailable, using main thread.", error);
    worker = null;
    return null;
  }
};

const zipInMainThread = (
  files: Record<string, Uint8Array>,
  options?: { level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 }
): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    zip(files, options ?? { level: 0 }, (err, data) => {
      if (err || !data) {
        reject(toError(err ?? "Failed to zip files"));
        return;
      }
      resolve(data);
    });
  });

export interface ZipStreamSession {
  addFile: (name: string, data: Uint8Array, transfer?: boolean) => Promise<void>;
  finalize: () => Promise<Uint8Array>;
  abort: () => void;
}

const unzipInMainThread = (
  data: Uint8Array,
  filterExt?: string
): Promise<Array<{ name: string; data: Uint8Array }>> =>
  new Promise((resolve, reject) => {
    unzip(data, (err, unzipped) => {
      if (err || !unzipped) {
        reject(toError(err ?? "Failed to unzip data"));
        return;
      }

      const lowerFilter = filterExt?.toLowerCase();
      const entries: Array<{ name: string; data: Uint8Array }> = [];

      for (const [name, fileData] of Object.entries(unzipped)) {
        if (!lowerFilter || name.toLowerCase().endsWith(lowerFilter)) {
          entries.push({ name, data: fileData });
        }
      }

      resolve(entries);
    });
  });

export const zipFilesInWorker = async (
  files: Record<string, Uint8Array>,
  options?: { level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 },
  transfer = true
): Promise<Uint8Array> => {
  const instance = getWorker();
  if (!instance) {
    return zipInMainThread(files, options);
  }

  const id = nextId();
  return new Promise<Uint8Array>((resolve, reject) => {
    pending.set(id, { type: "ZIP", resolve, reject });
    const transferables = transfer
      ? Object.values(files).map((file) => file.buffer)
      : [];
    instance.postMessage(
      { type: "ZIP", id, files, options },
      transferables
    );
  });
};

export const createZipStreamSession = async (): Promise<ZipStreamSession> => {
  const instance = getWorker();
  if (!instance) {
    const files: Record<string, Uint8Array> = {};
    return {
      async addFile(name, data) {
        files[name] = data;
      },
      finalize() {
        return zipInMainThread(files, { level: 0 });
      },
      abort() {
        // No-op fallback.
      },
    };
  }

  const sessionId = nextId();
  const initId = nextId();
  await new Promise<void>((resolve, reject) => {
    pending.set(initId, { type: "ZIP_STREAM_INIT", resolve, reject });
    instance.postMessage({
      type: "ZIP_STREAM_INIT",
      id: initId,
      sessionId,
    });
  });

  return {
    addFile(name, data, transfer = true) {
      const requestId = nextId();
      return new Promise<void>((resolve, reject) => {
        pending.set(requestId, { type: "ZIP_STREAM_APPEND", resolve, reject });
        const transferables = transfer ? [data.buffer] : [];
        instance.postMessage(
          {
            type: "ZIP_STREAM_APPEND",
            id: requestId,
            sessionId,
            name,
            data,
          },
          transferables,
        );
      });
    },
    finalize() {
      const requestId = nextId();
      return new Promise<Uint8Array>((resolve, reject) => {
        pending.set(requestId, { type: "ZIP_STREAM_FINALIZE", resolve, reject });
        instance.postMessage({
          type: "ZIP_STREAM_FINALIZE",
          id: requestId,
          sessionId,
        });
      });
    },
    abort() {
      const requestId = nextId();
      pending.set(requestId, {
        type: "ZIP_STREAM_ABORT",
        resolve: () => {},
        reject: () => {},
      });
      instance.postMessage({
        type: "ZIP_STREAM_ABORT",
        id: requestId,
        sessionId,
      });
    },
  };
};

export const unzipFilesInWorker = async (
  data: Uint8Array,
  options?: { filterExt?: string; transfer?: boolean }
): Promise<Array<{ name: string; data: Uint8Array }>> => {
  const instance = getWorker();
  if (!instance) {
    return unzipInMainThread(data, options?.filterExt);
  }

  const id = nextId();
  return new Promise<Array<{ name: string; data: Uint8Array }>>(
    (resolve, reject) => {
      pending.set(id, { type: "UNZIP", resolve, reject });
      const shouldTransfer = options?.transfer !== false;
      const transferables = shouldTransfer ? [data.buffer] : [];
      instance.postMessage(
        { type: "UNZIP", id, data, filterExt: options?.filterExt },
        transferables
      );
    }
  );
};
