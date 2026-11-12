import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import QrGifViewer from "@web/components/media/QrGifViewer";

const {
  gifPlayerPropsMock,
  gifPlayerLoadState,
  blobUrlToUint8ArrayMock,
  generateSessionIdMock,
  saveMultiviewSessionMock,
} = vi.hoisted(() => ({
  gifPlayerPropsMock: vi.fn(),
  gifPlayerLoadState: { notified: false },
  blobUrlToUint8ArrayMock: vi.fn(),
  generateSessionIdMock: vi.fn(),
  saveMultiviewSessionMock: vi.fn(),
}));

vi.mock("@web/utils/multiviewStorage", () => ({
  blobUrlToUint8Array: blobUrlToUint8ArrayMock,
  generateSessionId: generateSessionIdMock,
  saveMultiviewSession: saveMultiviewSessionMock,
}));

vi.mock("@web/components/media/GifPlayer", () => ({
  default: (props: {
    scale?: number;
    isPlaying?: boolean;
    playbackFps?: number | null;
    seekFrame?: number | null;
    onFrameChange?: (frame: number) => void;
    onLoad?: (data: {
      totalFrames: number;
      width: number;
      height: number;
      duration: number;
    }) => void;
  }) => {
    if (!gifPlayerLoadState.notified) {
      gifPlayerLoadState.notified = true;
      queueMicrotask(() => {
        props.onLoad?.({
          totalFrames: 12,
          width: 320,
          height: 240,
          duration: 1200,
        });
      });
    }

    gifPlayerPropsMock(props);
    return <div data-testid="gif-player">scale:{props.scale}</div>;
  },
}));

const latestGifPlayerProps = () =>
  gifPlayerPropsMock.mock.calls.at(-1)?.[0] as
    | {
        isPlaying?: boolean;
        playbackFps?: number | null;
        seekFrame?: number | null;
      }
    | undefined;

const pressViewerKey = (key: string) => {
  act(() => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        code: key === " " ? "Space" : undefined,
      })
    );
  });
};

describe("QrGifViewer", () => {
  const originalRequestFullscreen = HTMLElement.prototype.requestFullscreen;
  const originalExitFullscreen = document.exitFullscreen;
  const originalFullscreenElement = Object.getOwnPropertyDescriptor(
    document,
    "fullscreenElement"
  );
  const originalWakeLock = Object.getOwnPropertyDescriptor(navigator, "wakeLock");
  const originalClientWidth = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientWidth"
  );
  const originalClientHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "clientHeight"
  );
  const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;

  beforeEach(() => {
    gifPlayerPropsMock.mockClear();
    gifPlayerLoadState.notified = false;
    blobUrlToUint8ArrayMock.mockResolvedValue(new Uint8Array([1, 2, 3]));
    generateSessionIdMock.mockReturnValue("session-1");
    saveMultiviewSessionMock.mockResolvedValue(undefined);

    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return 1280;
      },
    });

    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return 760;
      },
    });
  });

  afterEach(() => {
    HTMLElement.prototype.requestFullscreen = originalRequestFullscreen;
    document.exitFullscreen = originalExitFullscreen;
    if (originalFullscreenElement) {
      Object.defineProperty(document, "fullscreenElement", originalFullscreenElement);
    } else {
      Reflect.deleteProperty(document, "fullscreenElement");
    }
    if (originalClientWidth) {
      Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClientWidth);
    }
    if (originalClientHeight) {
      Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
    }
    if (originalWakeLock) {
      Object.defineProperty(navigator, "wakeLock", originalWakeLock);
    } else {
      Reflect.deleteProperty(navigator, "wakeLock");
    }
    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
    vi.restoreAllMocks();
  });

  it("renders compact QR playback, zoom, frame and action controls", async () => {
    const onDownload = vi.fn();

    render(
      <QrGifViewer
        gifUrls={["blob:gif-1"]}
        metadata={{ totalFrames: 12, minFrames: 8, fileSize: 256 }}
        actions={[
          {
            key: "download",
            label: "Download ZIP",
            icon: "download",
            onClick: onDownload,
          },
        ]}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("gif-player")).toHaveTextContent("scale:2.75");
    });

    expect(screen.getByTestId("qr-viewer-surface")).toHaveClass("bg-[var(--airqr-preview-surface)]");
    expect(screen.getByTestId("qr-preview-scroll")).toHaveClass("items-start", "sm:items-center");
    expect(screen.getByTestId("qr-controls-section")).not.toHaveClass("bg-[var(--airqr-preview-surface)]");
    expect(screen.getByTestId("qr-controls-section")).toHaveClass("p-1.5", "pt-2", "sm:p-3");
    expect(screen.getByRole("button", { name: "Pause playback" })).toBeInTheDocument();
    expect(screen.getByLabelText("Frame scrubber")).toBeInTheDocument();
    expect(screen.getByTestId("qr-controls-panel")).toHaveClass("mx-auto", "max-w-[760px]");
    expect(screen.getByTestId("qr-controls-panel")).not.toHaveClass("shadow-[0_18px_46px_rgba(0,0,0,0.28)]", "backdrop-blur-xl");
    expect(screen.getByTestId("qr-controls-panel")).toContainElement(screen.getByLabelText("Frame scrubber"));
    expect(screen.getByTestId("frame-stepper")).toHaveClass("flex-col");
    expect(screen.getByRole("button", { name: "Previous frame" }).querySelector('[data-icon="remove"]')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next frame" }).querySelector('[data-icon="add"]')).toBeInTheDocument();
    expect(screen.getByLabelText("Frame number")).toHaveClass("airqr-number-input");
    expect(screen.getByTestId("playback-fps-stepper")).toHaveClass("flex-col");
    expect(screen.getByTestId("qr-primary-controls")).toHaveClass(
      "grid",
      "grid-cols-2",
      "sm:grid-cols-[44px_minmax(0,1fr)_44px]"
    );
    expect(screen.getByTestId("qr-steppers")).toHaveClass(
      "col-span-2",
      "row-start-2",
      "grid-cols-1",
      "sm:col-span-1",
      "sm:row-start-1",
      "sm:grid-cols-2"
    );
    expect(screen.getByTestId("frame-stepper")).toHaveClass("w-full", "sm:max-w-[260px]");
    expect(screen.getByTestId("playback-fps-stepper")).toHaveClass("w-full", "sm:max-w-[260px]");
    expect(screen.getByRole("button", { name: "Playback FPS -" }).querySelector('[data-icon="remove"]')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Playback FPS +" }).querySelector('[data-icon="add"]')).toBeInTheDocument();
    expect(screen.getByLabelText("Playback FPS")).toHaveValue(10);
    expect(screen.getByLabelText("Playback FPS")).toHaveClass("airqr-number-input");
    expect(screen.getByRole("button", { name: "Reset zoom" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Download ZIP" }));

    expect(onDownload).toHaveBeenCalledTimes(1);
  });

  it("uses the browser fullscreen API for the QR surface", async () => {
    const requestFullscreenMock = vi.fn(function (this: HTMLElement) {
      Object.defineProperty(document, "fullscreenElement", {
        configurable: true,
        value: this,
      });
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    });
    HTMLElement.prototype.requestFullscreen = requestFullscreenMock;

    render(<QrGifViewer gifUrls={["blob:gif-1"]} />);

    await userEvent.click(screen.getByRole("button", { name: "Fullscreen" }));

    expect(requestFullscreenMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("qr-preview-scroll")).toHaveClass("min-h-0", "flex-1");
  });

  it("collapses the control bar so the QR preview can use the freed space", async () => {
    render(<QrGifViewer gifUrls={["blob:gif-1"]} />);

    await waitFor(() => {
      expect(screen.getByTestId("gif-player")).toHaveTextContent("scale:2.75");
    });

    expect(screen.getByTestId("qr-controls-panel")).toBeInTheDocument();
    expect(screen.getByTestId("qr-preview-scroll")).toHaveClass(
      "h-[clamp(320px,calc(100vw+24px),600px)]",
      "sm:h-[clamp(280px,48dvh,600px)]"
    );

    await userEvent.click(screen.getByRole("button", { name: "Collapse controls" }));

    expect(screen.queryByTestId("qr-controls-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("qr-preview-scroll")).toHaveClass(
      "h-[clamp(360px,calc(100vw+72px),760px)]",
      "sm:h-[clamp(360px,68dvh,760px)]"
    );
    expect(screen.getByRole("button", { name: "Show controls" })).toHaveClass("mx-auto");
    expect(screen.getByRole("button", { name: "Show controls" })).not.toHaveClass("absolute");

    await userEvent.click(screen.getByRole("button", { name: "Show controls" }));

    expect(screen.getByTestId("qr-controls-panel")).toBeInTheDocument();
    expect(screen.getByTestId("qr-preview-scroll")).toHaveClass(
      "h-[clamp(320px,calc(100vw+24px),600px)]",
      "sm:h-[clamp(280px,48dvh,600px)]"
    );
    expect(screen.getByTestId("qr-controls-panel")).toHaveClass("relative");
    expect(screen.getByRole("button", { name: "Collapse controls" })).toHaveClass("flex", "size-10");
    expect(screen.getByRole("button", { name: "Collapse controls" })).not.toHaveClass("absolute");
  });

  it("restores the automatic zoom when exiting fullscreen after zooming", async () => {
    let fullscreenElement: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });
    HTMLElement.prototype.requestFullscreen = vi.fn(function (this: HTMLElement) {
      fullscreenElement = this;
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    });
    document.exitFullscreen = vi.fn(() => {
      fullscreenElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    });

    render(<QrGifViewer gifUrls={["blob:gif-1"]} />);

    await waitFor(() => {
      expect(screen.getByTestId("gif-player")).toHaveTextContent("scale:2.75");
    });

    await userEvent.click(screen.getByRole("button", { name: "Fullscreen" }));
    await userEvent.click(screen.getByRole("button", { name: "Zoom In" }));

    await waitFor(() => {
      expect(screen.getByTestId("gif-player")).toHaveTextContent("scale:3.25");
      expect(screen.getByRole("button", { name: "Reset zoom" })).toHaveTextContent("118%");
    });

    await userEvent.click(screen.getByRole("button", { name: "Exit fullscreen" }));

    await waitFor(() => {
      expect(screen.getByTestId("gif-player")).toHaveTextContent("scale:2.75");
      expect(screen.getByRole("button", { name: "Reset zoom" })).toHaveTextContent("100%");
    });
  });

  it("resets fullscreen entry to automatic zoom and recenters after fullscreen changes", async () => {
    let fullscreenElement: Element | null = null;
    const scrollIntoViewMock = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => fullscreenElement,
    });
    HTMLElement.prototype.requestFullscreen = vi.fn(function (this: HTMLElement) {
      fullscreenElement = this;
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    });
    document.exitFullscreen = vi.fn(() => {
      fullscreenElement = null;
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    });

    render(<QrGifViewer gifUrls={["blob:gif-1"]} />);

    await waitFor(() => {
      expect(screen.getByTestId("gif-player")).toHaveTextContent("scale:2.75");
    });

    const previewScroll = screen.getByTestId("qr-preview-scroll");
    Object.defineProperties(previewScroll, {
      clientWidth: { configurable: true, value: 400 },
      clientHeight: { configurable: true, value: 300 },
      scrollWidth: { configurable: true, value: 1000 },
      scrollHeight: { configurable: true, value: 800 },
    });

    previewScroll.scrollTop = 0;
    previewScroll.scrollLeft = 0;

    await userEvent.click(screen.getByRole("button", { name: "Zoom In" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reset zoom" })).not.toHaveTextContent("100%");
    });

    await userEvent.click(screen.getByRole("button", { name: "Fullscreen" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reset zoom" })).toHaveTextContent("100%");
    });

    await userEvent.click(screen.getByRole("button", { name: "Exit fullscreen" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Reset zoom" })).toHaveTextContent("100%");
      expect(previewScroll.scrollLeft).toBe(300);
      expect(previewScroll.scrollTop).toBe(250);
      expect(scrollIntoViewMock).toHaveBeenCalledWith({
        block: "center",
        inline: "nearest",
      });
    });
  });

  it("holds a screen wake lock while a QR GIF is visible", async () => {
    const releaseMock = vi.fn().mockResolvedValue(undefined);
    const addEventListenerMock = vi.fn();
    const requestMock = vi.fn().mockResolvedValue({
      released: false,
      release: releaseMock,
      addEventListener: addEventListenerMock,
    });

    Object.defineProperty(navigator, "wakeLock", {
      configurable: true,
      value: { request: requestMock },
    });

    const { unmount } = render(<QrGifViewer gifUrls={["blob:gif-1"]} />);

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith("screen");
      expect(addEventListenerMock).toHaveBeenCalledWith("release", expect.any(Function));
    });

    unmount();

    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it("shows minimum scan time in the top-right overlay for a single GIF", async () => {
    render(
      <QrGifViewer
        gifUrls={["blob:gif-1"]}
        metadata={{ totalFrames: 20, minFrames: 12, fileSize: 256 }}
        encodedFps={4}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("gif-player")).toBeInTheDocument();
    });

    expect(screen.getByText("min scan 3.0s")).toBeInTheDocument();
    expect(screen.getByTestId("qr-min-scan-badge")).toHaveClass("top-4");
    expect(screen.getByTestId("qr-min-scan-badge")).not.toHaveClass("top-14");
    expect(screen.getByTestId("qr-preview-scroll")).toHaveClass("pt-14", "sm:pt-16");
  });

  it("updates the single GIF minimum scan time when playback FPS changes", async () => {
    const user = userEvent.setup();

    render(
      <QrGifViewer
        gifUrls={["blob:gif-1"]}
        metadata={{ totalFrames: 20, minFrames: 12, fileSize: 256 }}
        encodedFps={4}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("min scan 3.0s")).toBeInTheDocument();
    });

    const fpsInput = screen.getByLabelText("Playback FPS");
    await user.clear(fpsInput);
    await user.type(fpsInput, "8");

    expect(screen.getByText("min scan 1.5s")).toBeInTheDocument();
    expect(screen.queryByText("min scan 3.0s")).not.toBeInTheDocument();
  });

  it("shows current chunk and total minimum scan time next to the chunk badge", async () => {
    render(
      <QrGifViewer
        gifUrls={["blob:gif-1", "blob:gif-2", "blob:gif-3"]}
        chunkMinFrames={[12, 20, 28]}
        isStreamingMode
        encodedFps={4}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Chunk 1/3")).toBeInTheDocument();
    });

    expect(screen.getByText("min scan 3.0s / total 15.0s")).toBeInTheDocument();
  });

  it("updates current and total multi-chunk scan time when playback FPS changes", async () => {
    const user = userEvent.setup();

    render(
      <QrGifViewer
        gifUrls={["blob:gif-1", "blob:gif-2", "blob:gif-3"]}
        chunkMinFrames={[12, 20, 28]}
        isStreamingMode
        encodedFps={4}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("min scan 3.0s / total 15.0s")).toBeInTheDocument();
    });

    const fpsInput = screen.getByLabelText("Playback FPS");
    await user.clear(fpsInput);
    await user.type(fpsInput, "8");

    expect(screen.getByText("min scan 1.5s / total 7.5s")).toBeInTheDocument();
    expect(screen.queryByText("min scan 3.0s / total 15.0s")).not.toBeInTheDocument();
  });

  it("shows a single minimum scan badge for a one-GIF streaming result", async () => {
    render(
      <QrGifViewer
        gifUrls={["blob:gif-1"]}
        chunkMinFrames={[12]}
        isStreamingMode
        encodedFps={4}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("gif-player")).toBeInTheDocument();
    });

    expect(screen.queryByText("Chunk 1/1")).not.toBeInTheDocument();
    expect(screen.getByText("min scan 3.0s")).toBeInTheDocument();
    expect(screen.queryByText(/total/i)).not.toBeInTheDocument();
  });

  it("hides minimum scan time when FPS or minimum frames are not usable", async () => {
    render(
      <QrGifViewer
        gifUrls={["blob:gif-1"]}
        metadata={{ totalFrames: 20, minFrames: 12, fileSize: 256 }}
        encodedFps={0}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId("gif-player")).toBeInTheDocument();
    });

    expect(screen.queryByText(/min scan/i)).not.toBeInTheDocument();
  });

  it("toggles playback with the Space key", async () => {
    render(<QrGifViewer gifUrls={["blob:gif-1"]} />);

    await waitFor(() => {
      expect(latestGifPlayerProps()?.isPlaying).toBe(true);
    });

    pressViewerKey(" ");

    await waitFor(() => {
      expect(latestGifPlayerProps()?.isPlaying).toBe(false);
    });
  });

  it("seeks frames with left and right arrows for a single GIF", async () => {
    render(<QrGifViewer gifUrls={["blob:gif-1"]} />);

    await waitFor(() => {
      expect(screen.getByLabelText("Frame scrubber")).toHaveAttribute("max", "11");
    });

    pressViewerKey("ArrowRight");

    await waitFor(() => {
      expect(latestGifPlayerProps()?.seekFrame).toBe(1);
    });

    pressViewerKey("ArrowLeft");

    await waitFor(() => {
      expect(latestGifPlayerProps()?.seekFrame).toBe(0);
    });
  });

  it("keeps left and right arrows on chunk navigation for multi-chunk GIFs", async () => {
    render(
      <QrGifViewer
        gifUrls={["blob:gif-1", "blob:gif-2"]}
        chunkMinFrames={[12, 12]}
        isStreamingMode
        encodedFps={4}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Chunk 1/2")).toBeInTheDocument();
    });

    pressViewerKey("ArrowRight");

    await waitFor(() => {
      expect(screen.getByText("Chunk 2/2")).toBeInTheDocument();
    });

    pressViewerKey("ArrowLeft");

    await waitFor(() => {
      expect(screen.getByText("Chunk 1/2")).toBeInTheDocument();
    });
  });

  it("opens a chunk in a new tab with one click", async () => {
    const popup = {
      opener: window,
      location: {
        replace: vi.fn(),
      },
    } as unknown as Window;
    const openMock = vi.spyOn(window, "open").mockReturnValue(popup);

    render(
      <QrGifViewer
        gifUrls={["blob:gif-1", "blob:gif-2"]}
        chunkMinFrames={[12, 12]}
        isStreamingMode
        encodedFps={4}
      />
    );

    const [openChunkButton] = screen.getAllByRole("button", {
      name: /Open chunk \d+ in new tab/,
    });

    await userEvent.click(openChunkButton);

    expect(openMock).toHaveBeenCalledTimes(1);
    expect(openMock).toHaveBeenCalledWith("about:blank", "_blank");
    expect(blobUrlToUint8ArrayMock).toHaveBeenCalledWith("blob:gif-1");

    await waitFor(() => {
      expect(saveMultiviewSessionMock).toHaveBeenCalledWith(
        "session-1",
        [new Uint8Array([1, 2, 3])],
        "image/gif",
        { chunkMinFrames: [12] }
      );
      expect(popup.location.replace).toHaveBeenCalledWith(
        "/gif-viewer.html?session=session-1&chunk=0&filename=Chunk+1&minFrames=12"
      );
    });
  });

  it("keeps data chunk navigation inside the playback controls card", async () => {
    render(
      <QrGifViewer
        gifUrls={["blob:gif-1", "blob:gif-2", "blob:gif-3"]}
        isStreamingMode
      />
    );

    const controlsPanel = screen.getByTestId("qr-controls-panel");
    const chunkControls = await screen.findByTestId("qr-chunk-controls");

    expect(controlsPanel).toContainElement(chunkControls);
    expect(chunkControls).toHaveTextContent("Data Chunks");
  });

  it("opens a fullscreen chunk menu from the chunk badge and switches chunks", async () => {
    const user = userEvent.setup();
    const requestFullscreenMock = vi.fn(function (this: HTMLElement) {
      Object.defineProperty(document, "fullscreenElement", {
        configurable: true,
        value: this,
      });
      document.dispatchEvent(new Event("fullscreenchange"));
      return Promise.resolve();
    });
    HTMLElement.prototype.requestFullscreen = requestFullscreenMock;

    render(
      <QrGifViewer
        gifUrls={["blob:gif-1", "blob:gif-2", "blob:gif-3"]}
        chunkMinFrames={[12, 20, 28]}
        isStreamingMode
        encodedFps={4}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Chunk 1/3")).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Fullscreen" }));

    const chunkBadgeButton = await screen.findByRole("button", {
      name: "Chunk 1/3",
    });
    await user.click(chunkBadgeButton);

    expect(screen.getByRole("button", { name: "Chunk 2" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Chunk 2" }));

    expect(screen.getByText("Chunk 2/3")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Chunk 2" })).not.toBeInTheDocument();
  });

  it("adjusts playback FPS with up and down arrows", async () => {
    render(<QrGifViewer gifUrls={["blob:gif-1"]} />);

    await waitFor(() => {
      expect(screen.getByLabelText("Playback FPS")).toHaveValue(10);
    });

    pressViewerKey("ArrowUp");

    await waitFor(() => {
      expect(screen.getByLabelText("Playback FPS")).toHaveValue(11);
      expect(latestGifPlayerProps()?.playbackFps).toBe(11);
    });

    pressViewerKey("ArrowDown");

    await waitFor(() => {
      expect(screen.getByLabelText("Playback FPS")).toHaveValue(10);
      expect(latestGifPlayerProps()?.playbackFps).toBe(10);
    });
  });

  it("updates the minimum scan time label when FPS changes with arrow keys", async () => {
    render(
      <QrGifViewer
        gifUrls={["blob:gif-1"]}
        metadata={{ totalFrames: 20, minFrames: 12, fileSize: 256 }}
        encodedFps={4}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("min scan 3.0s")).toBeInTheDocument();
    });

    pressViewerKey("ArrowUp");

    await waitFor(() => {
      expect(screen.getByText("min scan 2.4s")).toBeInTheDocument();
    });
    expect(screen.queryByText("min scan 3.0s")).not.toBeInTheDocument();
  });

  it("ignores playback keyboard shortcuts while editing an input", async () => {
    const user = userEvent.setup();

    render(<QrGifViewer gifUrls={["blob:gif-1"]} />);

    await waitFor(() => {
      expect(latestGifPlayerProps()?.isPlaying).toBe(true);
    });

    const fpsInput = screen.getByLabelText("Playback FPS");
    await user.click(fpsInput);
    await user.keyboard(" ");

    expect(latestGifPlayerProps()?.isPlaying).toBe(true);
  });

  it("ignores playback keyboard shortcuts while a button has focus", async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();

    render(
      <QrGifViewer
        gifUrls={["blob:gif-1"]}
        actions={[
          {
            key: "download",
            label: "Download ZIP",
            icon: "download",
            onClick: onDownload,
          },
        ]}
      />
    );

    await waitFor(() => {
      expect(latestGifPlayerProps()?.isPlaying).toBe(true);
    });

    const downloadButton = screen.getByRole("button", { name: "Download ZIP" });
    await user.click(downloadButton);
    await user.keyboard(" ");

    expect(latestGifPlayerProps()?.isPlaying).toBe(true);
  });
});
