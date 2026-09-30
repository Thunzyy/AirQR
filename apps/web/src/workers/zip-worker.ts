import { Zip, ZipPassThrough, zip, unzip } from "fflate";
import { errorMessage, type WireValue } from "../parse/wire";

type ZipRequest = {
  type: "ZIP";
  id: string;
  files: Record<string, Uint8Array>;
  options?: { level?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 };
};

type ZipStreamInitRequest = {
  type: "ZIP_STREAM_INIT";
  id: string;
  sessionId: string;
};

type ZipStreamAppendRequest = {
  type: "ZIP_STREAM_APPEND";
  id: string;
  sessionId: string;
  name: string;
  data: Uint8Array;
};

type ZipStreamFinalizeRequest = {
  type: "ZIP_STREAM_FINALIZE";
  id: string;
  sessionId: string;
};

type ZipStreamAbortRequest = {
  type: "ZIP_STREAM_ABORT";
  id: string;
  sessionId: string;
};

type UnzipRequest = {
  type: "UNZIP";
  id: string;
  data: Uint8Array;
  filterExt?: string;
};

type WorkerRequest =
  | ZipRequest
  | UnzipRequest
  | ZipStreamInitRequest
  | ZipStreamAppendRequest
  | ZipStreamFinalizeRequest
  | ZipStreamAbortRequest;

type ZipStreamSession = {
  zip: Zip;
  chunks: Uint8Array[];
  finalizeRequestId?: string;
  failedError?: string;
};

const toErrorMessage = (error: WireValue | Error): string => errorMessage(error);

const concatChunks = (chunks: Uint8Array[]): Uint8Array => {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
};

const streamSessions = new Map<string, ZipStreamSession>();

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;

  if (message.type === "ZIP_STREAM_INIT") {
    const session: ZipStreamSession = {
      chunks: [],
      zip: new Zip((err, data, final) => {
        if (err) {
          session.failedError = toErrorMessage(err);
          if (session.finalizeRequestId) {
            self.postMessage({
              type: "ZIP_STREAM_RESULT",
              id: session.finalizeRequestId,
              error: session.failedError,
            });
            streamSessions.delete(message.sessionId);
          }
          return;
        }

        if (data?.length) {
          session.chunks.push(data);
        }

        if (final && session.finalizeRequestId) {
          const zipData = concatChunks(session.chunks);
          streamSessions.delete(message.sessionId);
          const zipBuffer = zipData.buffer;
          if (zipBuffer instanceof ArrayBuffer) {
            self.postMessage(
              { type: "ZIP_STREAM_RESULT", id: session.finalizeRequestId, data: zipData },
              { transfer: [zipBuffer] },
            );
          } else {
            self.postMessage({
              type: "ZIP_STREAM_RESULT",
              id: session.finalizeRequestId,
              data: zipData,
            });
          }
        }
      }),
    };
    streamSessions.set(message.sessionId, session);
    self.postMessage({
      type: "ZIP_STREAM_READY",
      id: message.id,
    });
    return;
  }

  if (message.type === "ZIP_STREAM_APPEND") {
    const session = streamSessions.get(message.sessionId);
    if (!session) {
      self.postMessage({
        type: "ZIP_STREAM_APPENDED",
        id: message.id,
        error: "Zip stream session not found",
      });
      return;
    }

    try {
      const entry = new ZipPassThrough(message.name);
      session.zip.add(entry);
      entry.push(message.data, true);
      self.postMessage({
        type: "ZIP_STREAM_APPENDED",
        id: message.id,
      });
    } catch (error) {
      self.postMessage({
        type: "ZIP_STREAM_APPENDED",
        id: message.id,
        error: toErrorMessage(error instanceof Error ? error : String(error)),
      });
    }
    return;
  }

  if (message.type === "ZIP_STREAM_FINALIZE") {
    const session = streamSessions.get(message.sessionId);
    if (!session) {
      self.postMessage({
        type: "ZIP_STREAM_RESULT",
        id: message.id,
        error: "Zip stream session not found",
      });
      return;
    }

    if (session.failedError) {
      streamSessions.delete(message.sessionId);
      self.postMessage({
        type: "ZIP_STREAM_RESULT",
        id: message.id,
        error: session.failedError,
      });
      return;
    }

    session.finalizeRequestId = message.id;
    try {
      session.zip.end();
    } catch (error) {
      streamSessions.delete(message.sessionId);
      self.postMessage({
        type: "ZIP_STREAM_RESULT",
        id: message.id,
        error: toErrorMessage(error instanceof Error ? error : String(error)),
      });
    }
    return;
  }

  if (message.type === "ZIP_STREAM_ABORT") {
    streamSessions.delete(message.sessionId);
    self.postMessage({
      type: "ZIP_STREAM_ABORTED",
      id: message.id,
    });
    return;
  }

  if (message.type === "ZIP") {
    zip(message.files, message.options ?? { level: 0 }, (err, data) => {
      if (err || !data) {
        self.postMessage({
          type: "ZIP_RESULT",
          id: message.id,
          error: toErrorMessage(err ?? "Failed to zip files"),
        });
        return;
      }

      const zipBuffer = data.buffer;
      if (zipBuffer instanceof ArrayBuffer) {
        self.postMessage(
          { type: "ZIP_RESULT", id: message.id, data },
          { transfer: [zipBuffer] },
        );
      } else {
        self.postMessage({ type: "ZIP_RESULT", id: message.id, data });
      }
    });
    return;
  }

  if (message.type === "UNZIP") {
    unzip(message.data, (err, unzipped) => {
      if (err || !unzipped) {
        self.postMessage({
          type: "UNZIP_RESULT",
          id: message.id,
          error: toErrorMessage(err ?? "Failed to unzip data"),
        });
        return;
      }

      const filterExt = message.filterExt?.toLowerCase();
      const entries: Array<{ name: string; data: Uint8Array }> = [];

      for (const [name, data] of Object.entries(unzipped)) {
        if (!filterExt || name.toLowerCase().endsWith(filterExt)) {
          entries.push({ name, data });
        }
      }

      const transfers = entries
        .map((entry) => entry.data.buffer)
        .filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer);
      self.postMessage(
        { type: "UNZIP_RESULT", id: message.id, files: entries },
        { transfer: transfers },
      );
    });
  }
};
