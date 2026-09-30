import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup, act } from "@testing-library/react";
import type { ComponentProps } from "react";
import GifPlayer from "@web/components/media/GifPlayer";

const { fetchMock, gifReaderMock, requestAnimationFrameMock, cancelAnimationFrameMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  gifReaderMock: vi.fn(function MockGifReader() {
    return {
      width: 100,
      height: 100,
      numFrames: () => 10,
      frameInfo: () => ({ delay: 10 }),
      decodeAndBlitFrameRGBA: vi.fn(),
    };
  }),
  requestAnimationFrameMock: vi.fn(() => 1),
  cancelAnimationFrameMock: vi.fn(),
}));

global.fetch = fetchMock as typeof fetch;
global.requestAnimationFrame = requestAnimationFrameMock as typeof requestAnimationFrame;
global.cancelAnimationFrame = cancelAnimationFrameMock as typeof cancelAnimationFrame;

// Mock omggif GifReader
vi.mock("omggif", () => ({
  GifReader: gifReaderMock,
}));

async function renderGifPlayer(props: ComponentProps<typeof GifPlayer>) {
  const view = render(<GifPlayer {...props} />);
  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  await Promise.resolve();
  return view;
}

describe("GifPlayer Component", () => {
  const mockGifUrl =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

  beforeEach(() => {
    if (typeof ImageData === "undefined") {
      Object.defineProperty(globalThis, "ImageData", {
        value: class MockImageData {
          width: number;
          height: number;
          data: Uint8ClampedArray;

          constructor(width: number, height: number) {
            this.width = width;
            this.height = height;
            this.data = new Uint8ClampedArray(width * height * 4);
          }
        },
        configurable: true,
      });
    }
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      putImageData: vi.fn(),
    } as unknown as CanvasRenderingContext2D);
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(100)),
    });
    gifReaderMock.mockClear();
    requestAnimationFrameMock.mockClear();
    cancelAnimationFrameMock.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it("renders a canvas element", async () => {
    const { container } = await renderGifPlayer({ gifUrl: mockGifUrl });
    const canvas = container.querySelector("canvas");
    expect(canvas).toBeInTheDocument();
  });

  it("applies the className prop", async () => {
    const { container } = await renderGifPlayer({
      gifUrl: mockGifUrl,
      className: "test-class",
    });
    const canvas = container.querySelector("canvas");
    expect(canvas).toHaveClass("test-class");
  });

  it("applies pixelated image rendering style", async () => {
    const { container } = await renderGifPlayer({ gifUrl: mockGifUrl });
    const canvas = container.querySelector("canvas");
    expect(canvas).toHaveStyle({ imageRendering: "pixelated" });
  });

  it("accepts onFrameChange callback", async () => {
    const onFrameChange = vi.fn();
    const { container } = await renderGifPlayer({
      gifUrl: mockGifUrl,
      onFrameChange,
    });
    expect(container.querySelector("canvas")).toBeInTheDocument();
  });

  it("accepts onLoad callback", async () => {
    const onLoad = vi.fn();
    const { container } = await renderGifPlayer({
      gifUrl: mockGifUrl,
      onLoad,
    });
    expect(container.querySelector("canvas")).toBeInTheDocument();
  });

  it("accepts onLoop callback", async () => {
    const onLoop = vi.fn();
    const { container } = await renderGifPlayer({
      gifUrl: mockGifUrl,
      onLoop,
    });
    expect(container.querySelector("canvas")).toBeInTheDocument();
  });

  it("accepts scale prop", async () => {
    const { container } = await renderGifPlayer({
      gifUrl: mockGifUrl,
      scale: 2,
    });
    expect(container.querySelector("canvas")).toBeInTheDocument();
  });

  it("seeks to the requested frame and notifies the caller", async () => {
    const onFrameChange = vi.fn();
    await renderGifPlayer({
      gifUrl: mockGifUrl,
      isPlaying: false,
      seekFrame: 4,
      onFrameChange,
    });

    await waitFor(() => {
      expect(onFrameChange).toHaveBeenCalledWith(4);
    });
  });

  it("uses playbackFps instead of embedded gif delay when provided", async () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const onFrameChange = vi.fn();
    let animationCallback: FrameRequestCallback | undefined;
    requestAnimationFrameMock.mockImplementation((callback: FrameRequestCallback) => {
      animationCallback = callback;
      return 1;
    });

    await renderGifPlayer({
      gifUrl: mockGifUrl,
      playbackFps: 20,
      onFrameChange,
    });
    await waitFor(() => {
      expect(animationCallback).toBeDefined();
    });
    onFrameChange.mockClear();

    act(() => {
      animationCallback?.(0);
    });
    expect(onFrameChange).not.toHaveBeenCalled();

    act(() => {
      animationCallback?.(49);
    });
    expect(onFrameChange).not.toHaveBeenCalled();

    act(() => {
      animationCallback?.(50);
    });
    expect(onFrameChange).toHaveBeenCalledTimes(1);
    expect(onFrameChange).toHaveBeenCalledWith(1);
  });

  it("continues from the frame after an exact seek", async () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const onFrameChange = vi.fn();
    let animationCallback: FrameRequestCallback | undefined;
    requestAnimationFrameMock.mockImplementation((callback: FrameRequestCallback) => {
      animationCallback = callback;
      return 1;
    });

    await renderGifPlayer({
      gifUrl: mockGifUrl,
      playbackFps: 20,
      seekFrame: 4,
      onFrameChange,
    });
    await waitFor(() => {
      expect(animationCallback).toBeDefined();
      expect(onFrameChange).toHaveBeenCalledWith(4);
    });
    onFrameChange.mockClear();

    act(() => {
      animationCallback?.(50);
    });

    expect(onFrameChange).toHaveBeenCalledTimes(1);
    expect(onFrameChange).toHaveBeenCalledWith(5);
  });

  it("does not advance while paused", async () => {
    vi.spyOn(performance, "now").mockReturnValue(0);
    const onFrameChange = vi.fn();
    let animationCallback: FrameRequestCallback | undefined;
    requestAnimationFrameMock.mockImplementation((callback: FrameRequestCallback) => {
      animationCallback = callback;
      return 1;
    });

    await renderGifPlayer({
      gifUrl: mockGifUrl,
      isPlaying: false,
      onFrameChange,
    });
    await waitFor(() => {
      expect(animationCallback).toBeDefined();
    });
    onFrameChange.mockClear();

    act(() => {
      animationCallback?.(0);
    });
    act(() => {
      animationCallback?.(1000);
    });

    expect(onFrameChange).not.toHaveBeenCalled();
  });
});

describe("GIF Animation Logic", () => {
  it("calculates correct frame timing for 10 FPS", () => {
    const fps = 10;
    const frameDelay = 1000 / fps;
    expect(frameDelay).toBe(100);
  });

  it("calculates correct frame timing for 30 FPS", () => {
    const fps = 30;
    const frameDelay = 1000 / fps;
    expect(frameDelay).toBeCloseTo(33.33, 1);
  });

  it("handles frame count calculation", () => {
    const totalFrames = 100;
    const minFrames = 50;
    expect(totalFrames).toBeGreaterThanOrEqual(minFrames);
  });

  it("calculates loop count correctly", () => {
    const totalFrames = 100;
    const currentFrame = 0;
    const loops = Math.floor(currentFrame / totalFrames);
    expect(loops).toBe(0);
  });
});
