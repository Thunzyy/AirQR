import { beforeEach, describe, expect, it, vi } from "vitest";

class FakeWorker {
  static instances: FakeWorker[] = [];

  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly messages: Array<{ message: unknown; transferCount: number }> = [];

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: unknown, transfer?: Transferable[]) {
    this.messages.push({
      message,
      transferCount: transfer?.length ?? 0,
    });
  }

  terminate() {
    // no-op
  }

  emit(message: unknown) {
    this.onmessage?.({ data: message } as MessageEvent<unknown>);
  }
}

describe("zipWorker incremental sessions", () => {
  beforeEach(() => {
    vi.resetModules();
    FakeWorker.instances = [];
    vi.stubGlobal("Worker", FakeWorker as unknown as typeof Worker);
  });

  it("streams chunk files to the zip worker and finalizes them into a zip payload", async () => {
    const {
      createZipStreamSession,
    } = await import("@web/utils/zipWorker");

    const readyPromise = createZipStreamSession();
    const worker = FakeWorker.instances[0];
    expect(worker).toBeDefined();
    expect(worker.messages).toHaveLength(1);
    const initMessage = worker.messages[0]?.message as {
      type: string;
      id: string;
      sessionId: string;
    };
    expect(initMessage.type).toBe("ZIP_STREAM_INIT");

    worker.emit({
      type: "ZIP_STREAM_READY",
      id: initMessage.id,
    });

    const session = await readyPromise;
    const chunkData = new Uint8Array([1, 2, 3, 4]);
    const addPromise = session.addFile("chunk-1.gif", chunkData);

    const appendMessage = worker.messages[1]?.message as {
      type: string;
      id: string;
      sessionId: string;
      name: string;
    };
    expect(appendMessage.type).toBe("ZIP_STREAM_APPEND");
    expect(appendMessage.sessionId).toBe(initMessage.sessionId);
    expect(appendMessage.name).toBe("chunk-1.gif");
    expect(worker.messages[1]?.transferCount).toBe(1);

    worker.emit({
      type: "ZIP_STREAM_APPENDED",
      id: appendMessage.id,
    });
    await addPromise;

    const finalizePromise = session.finalize();
    const finalizeMessage = worker.messages[2]?.message as {
      type: string;
      id: string;
      sessionId: string;
    };
    expect(finalizeMessage.type).toBe("ZIP_STREAM_FINALIZE");
    expect(finalizeMessage.sessionId).toBe(initMessage.sessionId);

    const zipData = new Uint8Array([9, 8, 7]);
    worker.emit({
      type: "ZIP_STREAM_RESULT",
      id: finalizeMessage.id,
      data: zipData,
    });

    await expect(finalizePromise).resolves.toEqual(zipData);
  });
});
