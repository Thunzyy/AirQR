/**
 * Server Sync Service Tests
 *
 * Tests for validating the sync functionality between client and server,
 * including handling of incomplete scans.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchServerHistory,
  fetchServerPackets,
  fetchServerSession,
  type ServerHistoryEntry,
  type ServerHistoryOptions,
} from "@web/services/scanSyncService";

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

function buildBinaryPacketPage(
  offset: number,
  totalCount: number,
  packets: number[][]
): ArrayBuffer {
  const packetBytes = packets.map((packet) => new Uint8Array(packet));
  const totalLength =
    17 +
    packetBytes.reduce((count, packet) => count + 4 + packet.length, 0);
  const bytes = new Uint8Array(totalLength);
  bytes.set([0x41, 0x51, 0x50, 0x4b], 0);
  bytes[4] = 1;
  const view = new DataView(bytes.buffer);
  view.setUint32(5, offset, false);
  view.setUint32(9, packetBytes.length, false);
  view.setUint32(13, totalCount, false);
  let cursor = 17;
  for (const packet of packetBytes) {
    view.setUint32(cursor, packet.length, false);
    cursor += 4;
    bytes.set(packet, cursor);
    cursor += packet.length;
  }
  return bytes.buffer;
}

describe("Server Sync Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    mockFetch.mockReset();
  });

  describe("fetchServerHistory", () => {
    const mockConfig = {
      enabled: true,
      url: "http://localhost:8765",
      apiKey: "test-api-key",
      syncScanned: true,
      syncGenerated: true,
    };

    it("returns empty entries when config is disabled", async () => {
      const result = await fetchServerHistory({ ...mockConfig, enabled: false });
      expect(result.entries).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns empty entries when URL is missing", async () => {
      const result = await fetchServerHistory({ ...mockConfig, url: "" });
      expect(result.entries).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("fetches history from server with correct endpoint", async () => {
      const mockEntries: ServerHistoryEntry[] = [
        {
          id: "session-1",
          origin: "scanned",
          sessionId: "session-1",
          filename: "test.bin",
          completed: true,
          size: 1024,
          createdAt: new Date().toISOString(),
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockEntries),
        headers: new Headers({
          ETag: '"abc123"',
          "Last-Modified": "Mon, 20 Jan 2025 10:00:00 GMT",
        }),
      });

      const result = await fetchServerHistory(mockConfig);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/history"),
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-API-Key": "test-api-key",
          }),
          credentials: "omit",
          cache: "no-store",
        })
      );

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].id).toBe("session-1");
      expect(result.etag).toBe('"abc123"');
    });

    it("handles incomplete scan entries correctly", async () => {
      const mockEntries: ServerHistoryEntry[] = [
        {
          id: "incomplete-1",
          origin: "scanned",
          sessionId: "incomplete-1",
          filename: "partial.bin",
          completed: false,
          receivedPackets: 50,
          expectedPackets: 100,
          size: 1024,
          createdAt: new Date().toISOString(),
        },
        {
          id: "complete-1",
          origin: "scanned",
          sessionId: "complete-1",
          filename: "complete.bin",
          completed: true,
          size: 2048,
          createdAt: new Date().toISOString(),
        },
      ];

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockEntries),
        headers: new Headers(),
      });

      const result = await fetchServerHistory(mockConfig);

      expect(result.entries).toHaveLength(2);

      const incomplete = result.entries.find((e) => e.id === "incomplete-1");
      expect(incomplete?.completed).toBe(false);
      expect(incomplete?.receivedPackets).toBe(50);
      expect(incomplete?.expectedPackets).toBe(100);

      const complete = result.entries.find((e) => e.id === "complete-1");
      expect(complete?.completed).toBe(true);
    });

    it("handles 304 Not Modified response correctly", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 304,
        headers: new Headers(),
      });

      const options: ServerHistoryOptions = {
        etag: '"cached-etag"',
      };

      const result = await fetchServerHistory(mockConfig, options);

      expect(result.notModified).toBe(true);
      expect(result.entries).toEqual([]);
    });

    it("throws error on fetch failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        headers: new Headers(),
      });

      await expect(fetchServerHistory(mockConfig)).rejects.toThrow(
        "History fetch failed: 500"
      );
    });

    it("passes limit parameter in query string", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
        headers: new Headers(),
      });

      await fetchServerHistory(mockConfig, { limit: 50 });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("limit=50"),
        expect.any(Object)
      );
    });

    it("passes origin filter in query string", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
        headers: new Headers(),
      });

      await fetchServerHistory(mockConfig, { origin: "scanned" });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("origin=scanned"),
        expect.any(Object)
      );
    });

    it("uses Basic auth when username and password are provided", async () => {
      const configWithAuth = {
        ...mockConfig,
        username: "user",
        password: "pass",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
        headers: new Headers(),
      });

      await fetchServerHistory(configWithAuth);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringMatching(/^Basic /),
          }),
        })
      );
    });

    it("extracts X-Total-Count header", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([]),
        headers: new Headers({
          "X-Total-Count": "150",
        }),
      });

      const result = await fetchServerHistory(mockConfig);

      expect(result.totalCount).toBe(150);
    });
  });

  describe("fetchServerSession", () => {
    const mockConfig = {
      enabled: true,
      url: "http://localhost:8765",
      apiKey: "test-api-key",
      syncScanned: true,
      syncGenerated: true,
    };

    it("returns null on 404", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: new Headers(),
      });

      const result = await fetchServerSession(mockConfig as any, "missing-session");
      expect(result).toBeNull();
    });

    it("returns parsed session payload on 200", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            sessionId: "session-1",
            completed: false,
            receivedCount: 12,
            expectedPackets: 230,
          }),
        headers: new Headers(),
      });

      const result = await fetchServerSession(mockConfig as any, "session-1");
      expect(result?.sessionId).toBe("session-1");
      expect(result?.receivedCount).toBe(12);
      expect(result?.expectedPackets).toBe(230);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/scan/session/session-1"),
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-API-Key": "test-api-key",
          }),
          credentials: "omit",
          cache: "no-store",
        })
      );
    });

    it("uses same-origin credentials for same-origin session fetches", async () => {
      const originalLocation = window.location;
      Object.defineProperty(window, "location", {
        value: {
          origin: "https://sync.example.com",
        },
        configurable: true,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            sessionId: "session-2",
            completed: true,
          }),
        headers: new Headers(),
      });

      try {
        await fetchServerSession(
          { ...mockConfig, url: "https://sync.example.com" } as any,
          "session-2"
        );

        expect(mockFetch).toHaveBeenCalledWith(
          "https://sync.example.com/api/scan/session/session-2",
          expect.objectContaining({
            credentials: "same-origin",
          })
        );
      } finally {
        Object.defineProperty(window, "location", {
          value: originalLocation,
          configurable: true,
        });
      }
    });
  });

  describe("fetchServerPackets", () => {
    const mockConfig = {
      enabled: true,
      url: "http://localhost:8765",
      apiKey: "test-api-key",
      syncScanned: true,
      syncGenerated: true,
    };

    it("requests paged packets and exposes page metadata", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        arrayBuffer: () =>
          Promise.resolve(buildBinaryPacketPage(64, 130, [[1], [2]])),
        headers: new Headers({
          "Content-Type": "application/vnd.airqr.packet-page",
        }),
      });

      const result = await fetchServerPackets(mockConfig as any, "session-1", {
        offset: 64,
        limit: 2,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(
          "/api/scan/session/session-1/packets?offset=64&limit=2&format=binary"
        ),
        expect.objectContaining({
          headers: expect.objectContaining({
            "X-API-Key": "test-api-key",
            Accept: "application/vnd.airqr.packet-page, application/json",
          }),
          credentials: "omit",
          cache: "no-store",
        })
      );
      expect(result.sessionId).toBe("session-1");
      expect(result.offset).toBe(64);
      expect(result.packetCount).toBe(2);
      expect(result.totalCount).toBe(130);
      expect(result.hasMore).toBe(true);
      expect(result.packets).toEqual([
        new Uint8Array([1]),
        new Uint8Array([2]),
      ]);
    });

    it("falls back to legacy JSON packet pages when binary payloads are unavailable", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            sessionId: "session-1",
            offset: 0,
            packetCount: 1,
            totalCount: 1,
            packets: ["AQ=="],
          }),
        headers: new Headers({
          "Content-Type": "application/json",
        }),
      });

      const result = await fetchServerPackets(mockConfig as any, "session-1", {
        limit: 1,
      });

      expect(result.packetCount).toBe(1);
      expect(result.totalCount).toBe(1);
      expect(result.packets).toEqual([new Uint8Array([1])]);
    });
  });
});

describe("Server History Entry Transformation", () => {
  it("correctly identifies incomplete scans by completed flag", () => {
    const entries: ServerHistoryEntry[] = [
      {
        id: "1",
        origin: "scanned",
        completed: false,
        receivedPackets: 10,
        expectedPackets: 100,
      },
      {
        id: "2",
        origin: "scanned",
        completed: true,
      },
      {
        id: "3",
        origin: "generated",
        completed: true,
      },
    ];

    const incompleteScanned = entries.filter(
      (e) => e.origin === "scanned" && e.completed === false
    );
    const completeScanned = entries.filter(
      (e) => e.origin === "scanned" && e.completed === true
    );
    const generated = entries.filter((e) => e.origin === "generated");

    expect(incompleteScanned).toHaveLength(1);
    expect(incompleteScanned[0].id).toBe("1");
    expect(completeScanned).toHaveLength(1);
    expect(generated).toHaveLength(1);
  });

  it("correctly calculates progress from packet counts", () => {
    const entry: ServerHistoryEntry = {
      id: "1",
      origin: "scanned",
      completed: false,
      receivedPackets: 45,
      expectedPackets: 100,
    };

    const progress =
      entry.expectedPackets && entry.receivedPackets
        ? Math.round((entry.receivedPackets / entry.expectedPackets) * 100)
        : 0;

    expect(progress).toBe(45);
  });
});
