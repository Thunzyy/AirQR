import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScanUploadConfig } from "@web/types";

const baseConfig: ScanUploadConfig = {
  enabled: true,
  url: "https://sync.example.com",
  apiKey: "",
  username: "admin",
  password: "secret",
  syncScanned: true,
  syncGenerated: true,
  autoSyncHistory: true,
};

describe("scanDebugTelemetry", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState(null, "", "/scanner");
  });

  it("enables upload with the Debug shortcut or full debug flags", async () => {
    const { isScanDebugUploadEnabled } = await import(
      "@web/services/scanDebugTelemetry"
    );

    window.history.replaceState(null, "", "/scanner?scanDebug=1");
    expect(isScanDebugUploadEnabled()).toBe(false);

    window.history.replaceState(null, "", "/scanner?debugUpload=1");
    expect(isScanDebugUploadEnabled()).toBe(false);

    window.history.replaceState(null, "", "/scanner?scanDebug=1&debugUpload=1");
    expect(isScanDebugUploadEnabled()).toBe(true);

    window.history.replaceState(null, "", "/scanner?Debug");
    expect(isScanDebugUploadEnabled()).toBe(true);
  });

  it("strips secrets and posts a compact snapshot to the session debug endpoint", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const { uploadScanDebugSnapshot } = await import(
      "@web/services/scanDebugTelemetry"
    );

    await uploadScanDebugSnapshot(
      {
        sessionId: "scan-live",
        scanner: {
          scanStats: { received: 10, total: 30 },
          password: "remove",
        },
        transport: {
          state: "ready",
          queuedPackets: 2,
          recentEvents: [{ type: "packets-sent" }],
          Authorization: "Basic remove",
        },
        progressDiagnostics: {
          transitions: [
            {
              source: "scanner-session",
              changed: ["min", "missingToThreshold"],
              previous: { min: 52, missingToThreshold: 40 },
              current: { min: 60, missingToThreshold: 46 },
            },
          ],
        },
        server: { receivedCount: 8 },
        apiKey: "remove",
      },
      baseConfig
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [endpoint, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(endpoint).toBe(
      "https://sync.example.com/api/debug/scan-sessions/scan-live/snapshots"
    );
    expect(options.method).toBe("POST");
    expect(options.credentials).toBe("omit");
    expect((options.headers as Record<string, string>).Authorization).toBe(
      "Basic YWRtaW46c2VjcmV0"
    );
    const body = JSON.parse(String(options.body));
    expect(body.sessionId).toBe("scan-live");
    expect(body.scanner.scanStats.received).toBe(10);
    expect(body.progressDiagnostics.transitions[0].changed).toEqual([
      "min",
      "missingToThreshold",
    ]);
    expect(body.scanner.password).toBeUndefined();
    expect(body.transport.Authorization).toBeUndefined();
    expect(body.apiKey).toBeUndefined();
  });

  it("does not throw when debug upload fails", async () => {
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    const { uploadScanDebugSnapshot } = await import(
      "@web/services/scanDebugTelemetry"
    );

    await expect(
      uploadScanDebugSnapshot({ sessionId: "scan-live" }, baseConfig)
    ).resolves.toBe(false);
  });
});
