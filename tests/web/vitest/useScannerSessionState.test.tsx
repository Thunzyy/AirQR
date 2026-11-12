import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useScannerSessionState } from "@web/hooks/useScannerSessionState";

const { initNormalDecoderMock, initStreamingDecoderMock } = vi.hoisted(() => ({
  initNormalDecoderMock: vi.fn(),
  initStreamingDecoderMock: vi.fn(),
}));

vi.mock("@web/wasm/airqrCoreTyped", () => ({
  init_normal_decoder: initNormalDecoderMock,
  init_streaming_decoder: initStreamingDecoderMock,
}));

type ScanStats = { received: number; min: number; total?: number; chunkTotal?: number };

function createArgs(
  overrides?: Partial<Parameters<typeof useScannerSessionState>[0]>
) {
  let currentStats: ScanStats = { received: 7, min: 9, total: 9 };
  const setActiveChunk = vi.fn();
  const setActiveSessionId = vi.fn();
  const setFps = vi.fn();
  const setIsScanning = vi.fn();
  const setProgress = vi.fn();
  const setResultData = vi.fn();
  const setScanStats = vi.fn(
    (next: ScanStats | ((previous: ScanStats) => ScanStats)) => {
      currentStats =
        typeof next === "function"
          ? (next as (previous: ScanStats) => ScanStats)(currentStats)
          : next;
    }
  );
  const setSessionProgress = vi.fn();
  const setStatus = vi.fn();
  const setSyncSourceName = vi.fn();
  const onScanProgress = vi.fn();

  return {
    currentStats: () => currentStats,
    args: {
      autoContinue: false,
      chunksSavedRef: { current: 3 },
      filenameRef: { current: "stream.bin" as string | null },
      fpsFrameCountRef: { current: 12 },
      fpsLastTimeRef: { current: 50 },
      ignoredSessionAfterResetRef: { current: null as string | null },
      isProcessingFrameRef: { current: true },
      lastScanAtRef: { current: 99 },
      localDeviceName: "This phone",
      onScanProgress,
      packetIndexRef: { current: 4 },
      remoteCompleteHandledRef: { current: "done" as string | null },
      resumeMode: false,
      resumeSessionId: undefined as string | undefined,
      resumeStats: undefined as
        | { received: number; total: number; filename?: string }
        | undefined,
      resultData: null as
        | { filename: string; data: Uint8Array; duration: number }
        | null,
      serverProgressSeenRef: { current: true },
      sessionIdRef: { current: "local-1" as string | null },
      setActiveSessionId,
      setActiveChunk,
      setFps,
      setIsScanning,
      setProgress,
      setResultData,
      setScanStats,
      setSessionProgress,
      setStatus,
      setSyncSourceName,
      startTimeRef: { current: 123 },
      suppressResetSessionRealtimeRef: { current: false },
      t: (key: string) => key,
      ...overrides,
    },
    mocks: {
      onScanProgress,
      setActiveSessionId,
      setActiveChunk,
      setFps,
      setIsScanning,
      setProgress,
      setResultData,
      setScanStats,
      setSessionProgress,
      setStatus,
      setSyncSourceName,
    },
  };
}

describe("useScannerSessionState", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T12:00:00.000Z"));
    vi.spyOn(performance, "now").mockReturnValue(321);
    initNormalDecoderMock.mockReset();
    initStreamingDecoderMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("forces the resume session id and clears server progress when switching sessions", () => {
    const { args } = createArgs({
      resumeMode: true,
      resumeSessionId: "resume-42",
      sessionIdRef: { current: "stale-session" },
      serverProgressSeenRef: { current: true },
    });

    const { result } = renderHook(() => useScannerSessionState(args));

    let resolvedSessionId = "";
    act(() => {
      resolvedSessionId = result.current.getOrCreateSessionId("other-session");
    });

    expect(resolvedSessionId).toBe("resume-42");
    expect(args.sessionIdRef.current).toBe("resume-42");
    expect(args.serverProgressSeenRef.current).toBe(false);
  });

  it("resets local session state in one call and publishes an empty local progress payload", () => {
    const { args, currentStats, mocks } = createArgs({
      resumeMode: true,
      resumeSessionId: "resume-42",
      resumeStats: { received: 10, total: 394, filename: "resume.bin" },
      sessionIdRef: { current: "active-77" },
    });

    const { result } = renderHook(() => useScannerSessionState(args));

    act(() => {
      result.current.resetScanner();
    });

    expect(initStreamingDecoderMock).toHaveBeenCalled();
    expect(initNormalDecoderMock).toHaveBeenCalled();
    expect(args.ignoredSessionAfterResetRef.current).toBe("active-77");
    expect(args.suppressResetSessionRealtimeRef.current).toBe(true);
    expect(args.packetIndexRef.current).toBe(0);
    expect(args.sessionIdRef.current).toBeNull();
    expect(args.filenameRef.current).toBeNull();
    expect(args.remoteCompleteHandledRef.current).toBeNull();
    expect(args.serverProgressSeenRef.current).toBe(false);
    expect(args.chunksSavedRef.current).toBe(0);
    expect(args.lastScanAtRef.current).toBe(0);
    expect(args.fpsFrameCountRef.current).toBe(0);
    expect(args.fpsLastTimeRef.current).toBe(321);
    expect(args.startTimeRef.current).toBe(0);
    expect(args.isProcessingFrameRef.current).toBe(false);
    expect(currentStats()).toEqual({ received: 0, min: 0 });
    expect(mocks.setSyncSourceName).toHaveBeenCalledWith("This phone");
    expect(mocks.setIsScanning).toHaveBeenCalledWith(true);
    expect(mocks.setProgress).toHaveBeenCalledWith(0);
    expect(mocks.setFps).toHaveBeenCalledWith(0);
    expect(mocks.setResultData).toHaveBeenCalledWith(null);
    expect(mocks.setStatus).toHaveBeenCalledWith("scanner.scanning");
    expect(mocks.setActiveChunk).toHaveBeenCalledWith(null);
    expect(mocks.setSessionProgress).toHaveBeenCalledWith(null);
    expect(mocks.onScanProgress).toHaveBeenCalledWith({
      sessionId: "",
      filename: "",
      received: 0,
      total: 0,
      deviceName: "This phone",
      source: "local",
    });
  });

  it("preserves a resume minimum without inventing an exact maximum", () => {
    const { args, currentStats } = createArgs({
      resumeMode: true,
      resumeSessionId: "resume-42",
      resumeStats: { received: 10, total: 394, filename: "resume.bin" },
    });

    const { result } = renderHook(() => useScannerSessionState(args));

    act(() => {
      result.current.resetScanSessionState();
    });

    expect(currentStats()).toEqual({ received: 10, min: 394 });
  });

  it("auto-continues by resetting the local session after a completed result appears", () => {
    const { args, currentStats, mocks } = createArgs({
      autoContinue: true,
      resultData: {
        filename: "done.bin",
        data: new Uint8Array([1, 2, 3]),
        duration: 1.2,
      },
      sessionIdRef: { current: "active-99" },
    });

    renderHook(() => useScannerSessionState(args));

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(initStreamingDecoderMock).toHaveBeenCalled();
    expect(initNormalDecoderMock).toHaveBeenCalled();
    expect(args.sessionIdRef.current).toBeNull();
    expect(args.ignoredSessionAfterResetRef.current).toBeNull();
    expect(args.suppressResetSessionRealtimeRef.current).toBe(false);
    expect(currentStats()).toEqual({ received: 0, min: 0 });
    expect(mocks.setResultData).toHaveBeenCalledWith(null);
    expect(mocks.onScanProgress).not.toHaveBeenCalled();
  });
});
