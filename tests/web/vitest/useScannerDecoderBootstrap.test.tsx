import { renderHook, waitFor, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useScannerDecoderBootstrap } from "@web/hooks/useScannerDecoderBootstrap";

const {
  decodeNormalPacketMock,
  decodeStreamingPacketMock,
  getIncompleteScanByIdMock,
  initMock,
  initNormalDecoderMock,
  initScanWorkerMock,
  initStreamingDecoderMock,
  visitScanSessionPacketPagesMock,
  workerRef,
} = vi.hoisted(() => ({
  decodeNormalPacketMock: vi.fn(),
  decodeStreamingPacketMock: vi.fn(),
  getIncompleteScanByIdMock: vi.fn(),
  initMock: vi.fn().mockResolvedValue(undefined),
  initNormalDecoderMock: vi.fn(),
  initScanWorkerMock: vi.fn(),
  initStreamingDecoderMock: vi.fn(),
  visitScanSessionPacketPagesMock: vi.fn(),
  workerRef: {
    current: null as {
      onerror: ((error: unknown) => void) | null;
      onmessage: ((event: { data: Record<string, unknown> }) => void) | null;
      terminate: ReturnType<typeof vi.fn>;
    } | null,
  },
}));

vi.mock("@web/wasm/airqrCoreTyped", () => ({
  default: initMock,
  init_streaming_decoder: initStreamingDecoderMock,
  decode_streaming_packet: decodeStreamingPacketMock,
  init_normal_decoder: initNormalDecoderMock,
  decode_normal_packet: decodeNormalPacketMock,
}));

vi.mock("@web/services/historyDB", () => ({
  getIncompleteScanById: getIncompleteScanByIdMock,
}));

vi.mock("@web/services/scanSessionDB", () => ({
  visitScanSessionPacketPages: visitScanSessionPacketPagesMock,
}));

vi.mock("@web/services/scanWorkerManager", () => ({
  initScanWorker: initScanWorkerMock,
}));

function createArgs(overrides?: Partial<Parameters<typeof useScannerDecoderBootstrap>[0]>) {
  const handleDecodedData = vi.fn();
  const overlayContext = {
    beginPath: vi.fn(),
    clearRect: vi.fn(),
    lineTo: vi.fn(),
    lineWidth: 0,
    moveTo: vi.fn(),
    stroke: vi.fn(),
    strokeStyle: "",
  };
  const overlay = {
    width: 320,
    height: 180,
    getContext: vi.fn(() => overlayContext),
  } as unknown as HTMLCanvasElement;
  const setDecoderInitialized = vi.fn();
  const setStatus = vi.fn();
  const setUseNativeDetector = vi.fn();

  return {
    handleDecodedData,
    overlayContext,
    args: {
      barcodeDetectorRef: { current: null },
      handleDecodedData,
      isProcessingFrameRef: { current: false },
      overlayRef: { current: overlay },
      packetIndexRef: { current: 0 },
      resumeMode: false,
      resumeSessionId: undefined,
      scanWorkerRef: { current: null },
      setDecoderInitialized,
      setStatus,
      setUseNativeDetector,
      storedPackets: [] as Uint8Array[],
      t: (key: string) => key,
      ...overrides,
    },
    mocks: {
      setDecoderInitialized,
      setStatus,
      setUseNativeDetector,
    },
  };
}

describe("useScannerDecoderBootstrap", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    decodeNormalPacketMock.mockReset();
    decodeStreamingPacketMock.mockReset();
    getIncompleteScanByIdMock.mockReset();
    initMock.mockClear();
    initNormalDecoderMock.mockClear();
    initStreamingDecoderMock.mockClear();
    visitScanSessionPacketPagesMock.mockReset();
    workerRef.current = {
      onerror: null,
      onmessage: null,
      terminate: vi.fn(),
    };
    initScanWorkerMock.mockReset();
    initScanWorkerMock.mockResolvedValue(workerRef.current);
  });

  it("restores stored resume packets into the decoders and marks the decoder ready", async () => {
    const streamingPacket = new Uint8Array(31);
    streamingPacket[0] = 1;
    const normalPacket = new Uint8Array([9, 8, 7]);
    const { args, mocks } = createArgs({
      resumeMode: true,
      resumeSessionId: "scan-1",
      storedPackets: [streamingPacket, normalPacket],
      t: (key: string) =>
        key === "scanner.resumingScan" ? "Resuming scan" : key,
    });

    renderHook(() => useScannerDecoderBootstrap(args));

    await waitFor(() => {
      expect(initMock).toHaveBeenCalled();
    });

    expect(initStreamingDecoderMock).toHaveBeenCalled();
    expect(initNormalDecoderMock).toHaveBeenCalled();
    expect(decodeStreamingPacketMock).toHaveBeenCalledWith(streamingPacket);
    expect(decodeNormalPacketMock).toHaveBeenCalledWith(normalPacket);
    expect(args.packetIndexRef.current).toBe(2);
    expect(mocks.setDecoderInitialized).toHaveBeenCalledWith(true);
    expect(mocks.setStatus).toHaveBeenLastCalledWith("Resuming scan");
  });

  it("restores resume packet pages and routes worker scan results back into handleDecodedData", async () => {
    const streamingPacket = new Uint8Array(31);
    streamingPacket[0] = 1;
    visitScanSessionPacketPagesMock.mockImplementation(
      async (_sessionId: string, visit: (page: { packets: Uint8Array[] }) => void) => {
        visit({ packets: [streamingPacket] });
        return { pageCount: 1, packetCount: 1 };
      }
    );

    const { args, handleDecodedData } = createArgs({
      resumeAuthority: "local-cache",
      resumeMode: true,
      resumeSessionId: "scan-2",
    });

    renderHook(() => useScannerDecoderBootstrap(args));

    await waitFor(() => {
      expect(visitScanSessionPacketPagesMock).toHaveBeenCalledWith(
        "scan-2",
        expect.any(Function)
      );
    });

    expect(decodeStreamingPacketMock).toHaveBeenCalledWith(streamingPacket);
    expect(args.packetIndexRef.current).toBe(1);
    expect(getIncompleteScanByIdMock).not.toHaveBeenCalled();

    const binaryData = new Uint8Array([7, 8, 9]);
    args.isProcessingFrameRef.current = true;

    act(() => {
      workerRef.current?.onmessage?.({
        data: {
          binaryData: binaryData.buffer,
          found: true,
          location: null,
          type: "SCAN_RESULT",
        },
      });
    });

    expect(handleDecodedData).toHaveBeenCalledWith(binaryData);
    expect(args.isProcessingFrameRef.current).toBe(false);
  });

  it("skips local packet restore for server-authoritative resume", async () => {
    const { args, mocks } = createArgs({
      resumeAuthority: "server",
      resumeMode: true,
      resumeSessionId: "remote-scan-1",
      storedPackets: [],
      t: (key: string) =>
        key === "scanner.resumingScan" ? "Resuming scan" : key,
    });

    renderHook(() => useScannerDecoderBootstrap(args));

    await waitFor(() => {
      expect(mocks.setDecoderInitialized).toHaveBeenCalledWith(true);
    });

    expect(initStreamingDecoderMock).toHaveBeenCalled();
    expect(initNormalDecoderMock).toHaveBeenCalled();
    expect(visitScanSessionPacketPagesMock).not.toHaveBeenCalled();
    expect(getIncompleteScanByIdMock).not.toHaveBeenCalled();
    expect(decodeStreamingPacketMock).not.toHaveBeenCalled();
    expect(decodeNormalPacketMock).not.toHaveBeenCalled();
    expect(args.packetIndexRef.current).toBe(0);
    expect(mocks.setStatus).toHaveBeenLastCalledWith("Resuming scan");
  });

  it("ignores scan worker results that do not match the latest request id", async () => {
    const scanRequestIdRef = { current: 3 };
    const { args, handleDecodedData, overlayContext } = createArgs({
      scanRequestIdRef,
    } as Partial<Parameters<typeof useScannerDecoderBootstrap>[0]>);

    renderHook(() => useScannerDecoderBootstrap(args));

    await waitFor(() => {
      expect(workerRef.current?.onmessage).toBeTypeOf("function");
    });

    args.isProcessingFrameRef.current = true;
    act(() => {
      workerRef.current?.onmessage?.({
        data: {
          binaryData: new Uint8Array([7, 8, 9]).buffer,
          found: true,
          requestId: 2,
          type: "SCAN_RESULT",
        },
      });
    });

    expect(handleDecodedData).not.toHaveBeenCalled();
    expect(overlayContext.clearRect).toHaveBeenCalledWith(0, 0, 320, 180);
    expect(args.isProcessingFrameRef.current).toBe(false);
  });
});
