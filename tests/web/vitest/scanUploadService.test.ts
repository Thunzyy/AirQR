import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@web/utils/deviceId", () => ({
  getDeviceInfo: () => ({
    deviceId: "device-1",
    deviceName: "Test Device",
  }),
}));

const queuePacketWsMock = vi.fn(() => true);
const queueCompleteWsMock = vi.fn(() => false);
const discardSessionWsMock = vi.fn();

vi.mock("@web/services/scanWebSocketSyncService", () => ({
  getScanWebSocketSyncService: () => ({
    queuePacket: queuePacketWsMock,
    queueComplete: queueCompleteWsMock,
    discardSession: discardSessionWsMock,
  }),
}));

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("scanUploadService", () => {
  const originalFetch = global.fetch;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    queuePacketWsMock.mockReset();
    queuePacketWsMock.mockReturnValue(true);
    queueCompleteWsMock.mockReset();
    queueCompleteWsMock.mockReturnValue(false);
    discardSessionWsMock.mockReset();
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it("calls the scan completion failure callback when retries are exhausted", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(() => Promise.reject(new Error("server down")));
    global.fetch = fetchMock as typeof fetch;

    const { queueScanComplete, getFailedUploads } = await import("@web/services/scanUploadService");

    const config = {
      enabled: true,
      url: "https://sync.example.com",
      apiKey: "test-key",
      username: "",
      password: "",
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };
    const onFailure = vi.fn();

    queueScanComplete(
      new Uint8Array([7, 8, 9]),
      {
        sessionId: "scan-1",
        filename: "archive.bin",
      },
      config,
      undefined,
      onFailure
    );

    await vi.runAllTimersAsync();
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure).toHaveBeenCalledWith(
      expect.stringContaining("Max retries (5) exceeded")
    );
    const failed = getFailedUploads().get("scan-1");
    expect(failed).toBeDefined();
    expect(new URL(String(failed?.endpoint)).pathname).toBe("/api/scan/complete");
  });

  it("routes scan packets to the dedicated WS scan service without using fetch", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as typeof fetch;

    const { queueScanPacket } = await import("@web/services/scanUploadService");

    const config = {
      enabled: true,
      url: "https://sync.example.com",
      apiKey: "test-key",
      username: "",
      password: "",
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    queueScanPacket(
      new Uint8Array([1, 2, 3]),
      {
        sessionId: "scan-packet",
        filename: "capture.bin",
        isStreaming: false,
        packetIndex: 4,
        totalPackets: 10,
      },
      config
    );

    expect(queuePacketWsMock).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.objectContaining({
        sessionId: "scan-packet",
        packetIndex: 4,
      }),
      expect.objectContaining({
        url: "https://sync.example.com",
      })
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("optimistically routes scan packets to the WS scan service when auth status is still unknown and no credentials are stored", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as typeof fetch;

    const { queueScanPacket } = await import("@web/services/scanUploadService");

    const config = {
      enabled: true,
      url: "https://sync.example.com",
      apiKey: "",
      username: "",
      password: "",
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    queueScanPacket(
      new Uint8Array([1, 2, 3]),
      {
        sessionId: "scan-cookie-session",
        filename: "capture.bin",
        isStreaming: true,
        packetIndex: 9,
        chunkId: 2,
        totalPackets: 10,
      },
      config
    );

    expect(queuePacketWsMock).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.objectContaining({
        sessionId: "scan-cookie-session",
        packetIndex: 9,
        chunkId: 2,
      }),
      expect.objectContaining({
        url: "https://sync.example.com",
      })
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows replayed scan packets to bypass the transient seen cache", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as typeof fetch;

    const { queueScanPacket } = await import("@web/services/scanUploadService");

    const config = {
      enabled: true,
      url: "https://sync.example.com",
      apiKey: "test-key",
      username: "",
      password: "",
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };
    const packet = new Uint8Array([1, 2, 3]);
    const meta = {
      sessionId: "scan-replay",
      filename: "capture.bin",
      isStreaming: true,
      packetIndex: 7,
      chunkId: 1,
      totalPackets: 10,
    };

    queueScanPacket(packet, meta, config);
    queueScanPacket(packet, meta, config, { replay: true });

    expect(queuePacketWsMock).toHaveBeenCalledTimes(2);
    expect(queuePacketWsMock).toHaveBeenNthCalledWith(
      2,
      expect.any(Uint8Array),
      expect.objectContaining({
        sessionId: "scan-replay",
        packetIndex: 7,
        chunkId: 1,
      }),
      expect.objectContaining({
        url: "https://sync.example.com",
      })
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not queue scan packets when auth status is known to be unauthorized and no credentials are stored", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ enabled: true, authorized: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    global.fetch = fetchMock as typeof fetch;

    const { fetchServerAuthStatus } = await import("@web/services/serverAuth");
    const { queueScanPacket } = await import("@web/services/scanUploadService");

    const config = {
      enabled: true,
      url: "https://sync.example.com",
      apiKey: "",
      username: "",
      password: "",
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    await fetchServerAuthStatus(config);

    queueScanPacket(
      new Uint8Array([1, 2, 3]),
      {
        sessionId: "scan-known-unauthorized",
        filename: "capture.bin",
        isStreaming: true,
        packetIndex: 2,
      },
      config
    );

    expect(queuePacketWsMock).not.toHaveBeenCalled();
  });

  it("queues scan completion on the existing WS session before falling back to file upload", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve(""),
      })
    );
    global.fetch = fetchMock as typeof fetch;
    queueCompleteWsMock.mockReturnValue(true);

    const { queueScanComplete } = await import("@web/services/scanUploadService");

    const config = {
      enabled: true,
      url: "https://sync.example.com",
      apiKey: "test-key",
      username: "",
      password: "",
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    queueScanComplete(
      new Uint8Array([7, 8, 9]),
      {
        sessionId: "scan-ws-complete",
        filename: "archive.bin",
      },
      config
    );

    await flushMicrotasks();
    await flushMicrotasks();

    expect(discardSessionWsMock).not.toHaveBeenCalled();
    expect(queueCompleteWsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "scan-ws-complete",
        filename: "archive.bin",
      }),
      expect.objectContaining({
        url: "https://sync.example.com",
      }),
      expect.any(Function),
      undefined
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps accepting replay packets while WS completion waits for the server ack", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as typeof fetch;
    queueCompleteWsMock.mockReturnValue(true);

    const { queueScanComplete, queueScanPacket } = await import("@web/services/scanUploadService");

    const config = {
      enabled: true,
      url: "https://sync.example.com",
      apiKey: "test-key",
      username: "",
      password: "",
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    queueScanComplete(
      new Uint8Array([7, 8, 9]),
      {
        sessionId: "scan-ws-pending-complete",
        filename: "archive.bin",
      },
      config
    );
    queueScanPacket(
      new Uint8Array([1, 2, 3]),
      {
        sessionId: "scan-ws-pending-complete",
        filename: "archive.bin",
        isStreaming: true,
        packetIndex: 99,
        chunkId: 0,
      },
      config,
      { replay: true }
    );

    expect(queueCompleteWsMock).toHaveBeenCalledTimes(1);
    expect(queuePacketWsMock).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.objectContaining({
        sessionId: "scan-ws-pending-complete",
        packetIndex: 99,
      }),
      expect.objectContaining({
        url: "https://sync.example.com",
      })
    );
    expect(discardSessionWsMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uploads scan completion optimistically when auth status is still unknown and the browser may already have a cookie session", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve(""),
      })
    );
    global.fetch = fetchMock as typeof fetch;

    const { queueScanComplete } = await import("@web/services/scanUploadService");

    const config = {
      enabled: true,
      url: "https://sync.example.com",
      apiKey: "",
      username: "",
      password: "",
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    queueScanComplete(
      new Uint8Array([7, 8, 9]),
      {
        sessionId: "scan-cookie-complete",
        filename: "archive.bin",
      },
      config
    );

    await flushMicrotasks();
    await flushMicrotasks();

    expect(discardSessionWsMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports browser-blocked HTTP scan completion uploads without fetching or throwing", async () => {
    const originalLocation = window.location;
    Object.defineProperty(window, "location", {
      value: {
        origin: "https://app.airqr.test",
        protocol: "https:",
        host: "app.airqr.test",
      },
      writable: true,
      configurable: true,
    });

    const fetchMock = vi.fn();
    global.fetch = fetchMock as typeof fetch;
    const onFailure = vi.fn();

    try {
      const { queueScanComplete } = await import("@web/services/scanUploadService");

      expect(() =>
        queueScanComplete(
          new Uint8Array([7, 8, 9]),
          {
            sessionId: "scan-mixed-content",
            filename: "archive.bin",
          },
          {
            enabled: true,
            url: "http://192.168.1.50:8081",
            apiKey: "test-key",
            username: "",
            password: "",
            syncScanned: true,
            syncGenerated: true,
            autoSyncHistory: true,
          },
          undefined,
          onFailure
        )
      ).not.toThrow();

      await flushMicrotasks();
      await flushMicrotasks();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(onFailure).toHaveBeenCalledTimes(1);
      expect(onFailure).toHaveBeenCalledWith(expect.stringContaining("Mixed content"));
    } finally {
      Object.defineProperty(window, "location", {
        value: originalLocation,
        writable: true,
        configurable: true,
      });
    }
  });

  it("accepts blob scan completion payloads and uploads the original file size", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve(""),
      })
    );
    global.fetch = fetchMock as typeof fetch;

    const { queueScanComplete } = await import("@web/services/scanUploadService");

    const config = {
      enabled: true,
      url: "https://sync.example.com",
      apiKey: "test-key",
      username: "",
      password: "",
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    queueScanComplete(
      new Blob([new Uint8Array([7, 8, 9])], {
        type: "application/octet-stream",
      }),
      {
        sessionId: "scan-blob",
        filename: "archive.bin",
      },
      config
    );

    await flushMicrotasks();
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [endpoint, request] = fetchMock.mock.calls[0] ?? [];
    expect(typeof endpoint).toBe("string");
    const url = new URL(String(endpoint));
    expect(`${url.origin}${url.pathname}`).toBe("https://sync.example.com/api/scan/complete");
    expect(url.searchParams.get("sessionId")).toBe("scan-blob");
    expect(url.searchParams.get("filename")).toBe("archive.bin");
    expect(request?.headers).toEqual(
      expect.objectContaining({
        "Content-Type": "application/octet-stream",
        "X-AirQR-CSRF": "1",
      })
    );
    expect(request?.body).toBeInstanceOf(Blob);
    const requestBody = request?.body as Blob;
    expect(new Uint8Array(await requestBody.arrayBuffer())).toEqual(new Uint8Array([7, 8, 9]));
  });

  it("uploads generated history items as raw binary with metadata in query params", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve(""),
      })
    );
    global.fetch = fetchMock as typeof fetch;

    const { queueHistoryItem } = await import("@web/services/scanUploadService");

    const config = {
      enabled: true,
      url: "https://sync.example.com",
      apiKey: "test-key",
      username: "",
      password: "",
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    queueHistoryItem(
      new Blob([new Uint8Array([1, 2, 3, 4])], {
        type: "application/zip",
      }),
      {
        historyId: "history-blob",
        title: "archive.zip",
        filename: "archive.zip",
        mimeType: "application/zip",
        size: 4,
        totalFrames: 12,
        minFrames: 10,
        chunkMinFrames: [4, 6],
        createdAt: "2026-03-29T12:00:00Z",
        updatedAt: "2026-03-29T12:00:05Z",
      },
      config
    );

    await flushMicrotasks();
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [endpoint, request] = fetchMock.mock.calls[0] ?? [];
    expect(typeof endpoint).toBe("string");
    const url = new URL(String(endpoint));
    expect(`${url.origin}${url.pathname}`).toBe("https://sync.example.com/api/history/item");
    expect(url.searchParams.get("historyId")).toBe("history-blob");
    expect(url.searchParams.get("title")).toBe("archive.zip");
    expect(url.searchParams.get("filename")).toBe("archive.zip");
    expect(url.searchParams.get("mimeType")).toBe("application/zip");
    expect(url.searchParams.get("size")).toBe("4");
    expect(url.searchParams.get("totalFrames")).toBe("12");
    expect(url.searchParams.get("minFrames")).toBe("10");
    expect(url.searchParams.get("chunkMinFrames")).toBe(JSON.stringify([4, 6]));
    expect(url.searchParams.get("createdAt")).toBe("2026-03-29T12:00:00Z");
    expect(url.searchParams.get("updatedAt")).toBe("2026-03-29T12:00:05Z");
    expect(request?.headers).toEqual(
      expect.objectContaining({
        "Content-Type": "application/zip",
        "X-AirQR-CSRF": "1",
      })
    );
    expect(request?.body).toBeInstanceOf(Blob);
    const requestBody = request?.body as Blob;
    expect(new Uint8Array(await requestBody.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("does not fall back to POST /api/scan/packet when the scan websocket transport rejects a packet", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve(""),
      })
    );
    global.fetch = fetchMock as typeof fetch;

    vi.doMock("@web/services/scanWebSocketSyncService", () => ({
      getScanWebSocketSyncService: () => ({
        queuePacket: vi.fn(() => false),
        queueComplete: vi.fn(() => false),
      }),
    }));

    const { queueScanPacket } = await import("@web/services/scanUploadService");

    const config = {
      enabled: true,
      url: "https://sync.example.com",
      apiKey: "test-key",
      username: "",
      password: "",
      syncScanned: true,
      syncGenerated: true,
      autoSyncHistory: true,
    };

    queueScanPacket(
      new Uint8Array([9, 8, 7]),
      {
        sessionId: "scan-ws-only",
        filename: "archive.bin",
        isStreaming: true,
        packetIndex: 0,
        totalPackets: 1,
        resultType: "progress",
      },
      config
    );

    await flushMicrotasks();
    await flushMicrotasks();

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
