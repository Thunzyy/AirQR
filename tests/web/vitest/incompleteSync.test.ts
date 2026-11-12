import { describe, expect, it } from "vitest";
import type {
  IncompleteScanItem,
  PersistedIncompleteScanItem,
} from "@web/types";
import {
  getLegacyIncompleteScanPackets,
  mergeIncompleteScanItems,
  stripIncompleteScanBuffers,
  shouldBackfillIncompleteSession,
} from "@web/utils/incompleteSync";

function makeLocal(partial: Partial<IncompleteScanItem>): IncompleteScanItem {
  return {
    sessionId: partial.sessionId || "session-local",
    filename: partial.filename || "local.bin",
    received: partial.received ?? 1,
    total: partial.total ?? 10,
    date: partial.date || "10:00",
    chunksCompleted: partial.chunksCompleted,
    totalChunks: partial.totalChunks,
    chunksSaved: partial.chunksSaved,
    source: partial.source,
    remoteSessionId: partial.remoteSessionId,
    deviceId: partial.deviceId,
    deviceName: partial.deviceName,
  };
}

function makeRemote(partial: Partial<IncompleteScanItem>): IncompleteScanItem {
  return {
    sessionId: partial.sessionId || "session-remote",
    filename: partial.filename || "remote.bin",
    received: partial.received ?? 1,
    total: partial.total ?? 10,
    date: partial.date || "10:01",
    source: "server",
    remoteSessionId: partial.remoteSessionId,
    deviceId: partial.deviceId,
    deviceName: partial.deviceName,
    chunksCompleted: partial.chunksCompleted,
    totalChunks: partial.totalChunks,
    chunksSaved: partial.chunksSaved,
  };
}

describe("mergeIncompleteScanItems", () => {
  it("keeps local scan counters visible while preserving server sync counters for the same session", () => {
    const merged = mergeIncompleteScanItems(
      [
        makeLocal({
          sessionId: "s1",
          received: 214,
          total: 230,
          chunksSaved: 9,
          source: "local",
        }),
      ],
      [
        makeRemote({
          sessionId: "s1",
          received: 198,
          total: 230,
          remoteSessionId: "s1",
          chunksSaved: 7,
        }),
      ]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0].source).toBe("server");
    expect(merged[0].received).toBe(214);
    expect(merged[0].total).toBe(230);
    expect(merged[0].serverReceived).toBe(198);
    expect(merged[0].serverTotal).toBe(230);
    expect(merged[0].chunksSaved).toBe(9);
  });

  it("merges a local alias with the matching remote shared session id", () => {
    const merged = mergeIncompleteScanItems(
      [
        makeLocal({
          sessionId: "local-scan-1",
          remoteSessionId: "shared-session-1",
          received: 136,
          total: 1182,
          chunksSaved: 1,
          source: "local",
        }),
      ],
      [
        makeRemote({
          sessionId: "shared-session-1",
          received: 520,
          total: 1182,
          remoteSessionId: "shared-session-1",
          chunksSaved: 2,
        }),
      ]
    );

    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(
      expect.objectContaining({
        sessionId: "local-scan-1",
        remoteSessionId: "shared-session-1",
        source: "server",
        received: 520,
        total: 1182,
        serverReceived: 520,
        serverTotal: 1182,
        chunksSaved: 1,
      })
    );
  });

  it("keeps local items when server does not know the session yet", () => {
    const local = makeLocal({
      sessionId: "local-only",
      source: "local",
      received: 12,
      total: 230,
    });

    const merged = mergeIncompleteScanItems([local], []);
    expect(merged).toEqual([local]);
  });

  it("adds server-only items", () => {
    const remote = makeRemote({
      sessionId: "server-only",
      received: 3,
      total: 40,
    });
    const merged = mergeIncompleteScanItems([], [remote]);

    expect(merged).toHaveLength(1);
    expect(merged[0].sessionId).toBe("server-only");
    expect(merged[0].source).toBe("server");
  });
});

describe("shouldBackfillIncompleteSession", () => {
  it("returns true when server item is missing", () => {
    expect(shouldBackfillIncompleteSession(20, undefined)).toBe(true);
  });

  it("returns false when local is at most one packet ahead", () => {
    expect(shouldBackfillIncompleteSession(20, 19)).toBe(false);
    expect(shouldBackfillIncompleteSession(20, 20)).toBe(false);
  });

  it("returns true when local is materially ahead", () => {
    expect(shouldBackfillIncompleteSession(30, 20)).toBe(true);
  });

  it("returns false for empty or invalid local counters", () => {
    expect(shouldBackfillIncompleteSession(0, 0)).toBe(false);
    expect(shouldBackfillIncompleteSession(-1, 0)).toBe(false);
    expect(shouldBackfillIncompleteSession(Number.NaN, 0)).toBe(false);
  });
});

describe("stripIncompleteScanBuffers", () => {
  it("removes raw packet and chunk buffers while preserving resume metadata", () => {
    const item: PersistedIncompleteScanItem = {
      ...makeLocal({
        sessionId: "session-1",
        chunksCompleted: 1,
        totalChunks: 3,
        chunksSaved: 1,
      }),
      packets: [new Uint8Array([1, 2, 3])],
      chunks: [{ id: 0, data: new Uint8Array([4, 5, 6]) }],
    };

    expect(stripIncompleteScanBuffers(item)).toEqual({
      sessionId: "session-1",
      filename: "local.bin",
      received: 1,
      total: 10,
      date: "10:00",
      chunksCompleted: 1,
      totalChunks: 3,
      chunksSaved: 1,
      source: undefined,
      remoteSessionId: undefined,
      deviceId: undefined,
      deviceName: undefined,
    });
  });
});

describe("getLegacyIncompleteScanPackets", () => {
  it("normalizes packet buffers from persisted legacy rows", () => {
    const packet = new Uint8Array([1, 2, 3]);
    const legacy: PersistedIncompleteScanItem = {
      ...makeLocal({
        sessionId: "legacy-session",
      }),
      packets: [packet.buffer],
    };

    expect(getLegacyIncompleteScanPackets(legacy)).toEqual([packet]);
  });
});
