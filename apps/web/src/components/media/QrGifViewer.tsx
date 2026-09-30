import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatDuration } from "../../utils/format";
import { useScreenWakeLock } from "../../hooks/useScreenWakeLock";
import {
  blobUrlToUint8Array,
  generateSessionId,
  saveMultiviewSession,
} from "../../utils/multiviewStorage";
import GifPlayer from "./GifPlayer";
import * as Icons from "../ui/Icons";
import Icon from "../ui/Icon";

type RangeProgressStyle = React.CSSProperties & {
  "--airqr-range-value": string;
};

const getRangeProgressStyle = (
  value: number,
  min: number,
  max: number,
): RangeProgressStyle => {
  const range = max - min;
  const percentage =
    range <= 0 ? 0 : Math.min(100, Math.max(0, ((value - min) / range) * 100));

  return { "--airqr-range-value": `${percentage}%` };
};

export type QrGifViewerAction = {
  key: string;
  label: string;
  icon?: string;
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  title?: string;
  variant?: "primary" | "secondary";
};

type QrGifViewerProps = {
  gifUrls: string[];
  metadata?: {
    totalFrames: number;
    minFrames: number;
    fileSize?: number;
  };
  encodedFps?: number;
  chunkMinFrames?: number[];
  isStreamingMode?: boolean;
  onOpenMultiView?: () => void | Promise<void>;
  isOpeningMultiView?: boolean;
  actions?: QrGifViewerAction[];
  className?: string;
  previewAreaClassName?: string;
};

const DEFAULT_PREVIEW_AREA_CLASS_NAME =
  "h-[clamp(320px,calc(100vw+24px),600px)] sm:h-[clamp(280px,48dvh,600px)]";
const COLLAPSED_CONTROLS_PREVIEW_AREA_CLASS_NAME =
  "h-[clamp(360px,calc(100vw+72px),760px)] sm:h-[clamp(360px,68dvh,760px)]";

function isInteractiveShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.closest(
      [
        "input",
        "textarea",
        "select",
        "button",
        "a[href]",
        "summary",
        "[contenteditable='true']",
        "[role='button']",
        "[role='link']",
        "[role='menuitem']",
        "[role='checkbox']",
        "[role='radio']",
        "[role='switch']",
      ].join(",")
    ) || target.isContentEditable
  );
}

const QrGifViewer: React.FC<QrGifViewerProps> = ({
  gifUrls,
  metadata,
  encodedFps,
  chunkMinFrames,
  isStreamingMode = false,
  onOpenMultiView,
  isOpeningMultiView = false,
  actions = [],
  className = "",
  previewAreaClassName = DEFAULT_PREVIEW_AREA_CLASS_NAME,
}) => {
  const { t } = useTranslation();
  const [scale, setScale] = useState(1);
  const [baseScale, setBaseScale] = useState(1);
  const [frame, setFrame] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  const [autoAdvanceChunks, setAutoAdvanceChunks] = useState(true);
  const [isChunkMenuOpen, setIsChunkMenuOpen] = useState(false);
  const [areControlsCollapsed, setAreControlsCollapsed] = useState(false);
  const [hasManualScale, setHasManualScale] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const [playbackFps, setPlaybackFps] = useState(0);
  const [seekFrame, setSeekFrame] = useState<number | null>(null);
  const [frameInputValue, setFrameInputValue] = useState("1");
  const [fpsInputValue, setFpsInputValue] = useState("");
  const [gifInfo, setGifInfo] = useState<{ totalFrames: number; duration: number } | null>(
    null
  );
  const [gifDimensions, setGifDimensions] = useState<{ width: number; height: number } | null>(
    null
  );
  const viewerSurfaceRef = useRef<HTMLDivElement>(null);
  const previewScrollRef = useRef<HTMLDivElement>(null);
  const wasFullscreenRef = useRef(false);

  const activeChunkIndex = Math.min(currentChunkIndex, Math.max(0, gifUrls.length - 1));
  const activeUrl = gifUrls[activeChunkIndex] || gifUrls[0];
  useScreenWakeLock(Boolean(activeUrl));
  const hasChunkNavigation = isStreamingMode && gifUrls.length > 1;
  const frameTotal = gifInfo?.totalFrames ?? metadata?.totalFrames ?? 0;
  const minFrames = isStreamingMode
    ? chunkMinFrames?.[activeChunkIndex] ?? (!hasChunkNavigation ? metadata?.minFrames ?? 0 : 0)
    : metadata?.minFrames ?? 0;
  const hasValidEncodedFps =
    encodedFps !== undefined && Number.isFinite(encodedFps) && encodedFps > 0;
  const initialPlaybackFps = hasValidEncodedFps
    ? Math.min(Math.max(Math.round(encodedFps), 1), 60)
    : null;
  const scanTimeFps =
    playbackFps > 0 && Number.isFinite(playbackFps) ? playbackFps : encodedFps;
  const hasValidScanTimeFps =
    scanTimeFps !== undefined && Number.isFinite(scanTimeFps) && scanTimeFps > 0;
  const currentMinScanSeconds =
    hasValidScanTimeFps && minFrames > 0 ? minFrames / scanTimeFps : null;
  const totalMinFrames = (chunkMinFrames ?? []).reduce(
    (total, value) =>
      Number.isFinite(value) && value > 0 ? total + value : total,
    0
  );
  const totalMinScanSeconds =
    hasChunkNavigation && hasValidScanTimeFps && totalMinFrames > 0
      ? totalMinFrames / scanTimeFps
      : null;
  const minScanTimeLabel =
    currentMinScanSeconds === null
      ? null
      : totalMinScanSeconds !== null
        ? t("encoder.minScanTimeWithTotal", {
            current: formatDuration(currentMinScanSeconds),
            total: formatDuration(totalMinScanSeconds),
          })
        : t("encoder.minScanTime", {
            time: formatDuration(currentMinScanSeconds),
          });
  const chunkBadgeLabel = hasChunkNavigation
    ? t("encoder.chunk", {
        current: activeChunkIndex + 1,
        total: gifUrls.length,
      })
    : "";

  const clampFrameIndex = useCallback(
    (nextFrame: number) => {
      const maxFrame = Math.max(0, frameTotal - 1);
      return Math.min(Math.max(Math.trunc(nextFrame), 0), maxFrame);
    },
    [frameTotal]
  );

  const selectChunk = useCallback((index: number) => {
    setCurrentChunkIndex(index);
    setIsChunkMenuOpen(false);
    setGifInfo(null);
    setGifDimensions(null);
    setFrame(0);
    setFrameInputValue("1");
    setSeekFrame(null);
    setIsPlaying(true);
    setHasManualScale(false);
  }, []);

  const clampScale = useCallback((nextScale: number) => {
    return Math.min(Math.max(nextScale, 0.5), 12);
  }, []);

  const normalizeScale = useCallback(
    (nextScale: number) => Math.max(0.5, Math.floor(clampScale(nextScale) * 4) / 4),
    [clampScale]
  );

  const computeAutoScale = useCallback(
    (dimensions: { width: number; height: number }) => {
      const container = previewScrollRef.current;
      const availableWidth = Math.max(
        (container?.clientWidth ?? window.innerWidth * 0.92) - 32,
        1
      );
      // Keep a dedicated status rail above the QR so frame/min-scan badges and
      // overlay actions never cover scannable modules on narrow viewports.
      const availableHeight = Math.max(
        (container?.clientHeight ??
          (isFullscreen
            ? window.innerHeight - (areControlsCollapsed ? 56 : 178)
            : Math.min(
                window.innerHeight * (areControlsCollapsed ? 0.72 : 0.6),
                areControlsCollapsed ? 760 : 600
              ))) - (hasChunkNavigation ? 112 : 80),
        1
      );

      const widthScale = availableWidth / dimensions.width;
      const heightScale = availableHeight / dimensions.height;

      return normalizeScale(Math.min(widthScale, heightScale));
    },
    [areControlsCollapsed, hasChunkNavigation, isFullscreen, normalizeScale]
  );

  const syncAutoScale = useCallback(
    (dimensions: { width: number; height: number }, force = false) => {
      const nextBaseScale = computeAutoScale(dimensions);
      setBaseScale(nextBaseScale);
      setScale((currentScale) =>
        force || !hasManualScale ? nextBaseScale : currentScale
      );
    },
    [computeAutoScale, hasManualScale]
  );

  const centerPreviewScroll = useCallback(() => {
    const container = previewScrollRef.current;
    if (!container) return;

    container.scrollLeft = Math.max(
      Math.round((container.scrollWidth - container.clientWidth) / 2),
      0
    );
    container.scrollTop = Math.max(
      Math.round((container.scrollHeight - container.clientHeight) / 2),
      0
    );
  }, []);

  const centerViewerInPage = useCallback(() => {
    const viewerSurface = viewerSurfaceRef.current;
    if (!(viewerSurface instanceof HTMLElement) || !(viewerSurface.scrollIntoView instanceof Function)) return;

    viewerSurface.scrollIntoView({
      block: "center",
      inline: "nearest",
    });
  }, []);

  const handleZoomIn = () => {
    setHasManualScale(true);
    setScale((prev) => clampScale(prev + 0.5));
  };

  const handleZoomOut = () => {
    setHasManualScale(true);
    setScale((prev) => clampScale(prev - 0.5));
  };

  const handleResetZoom = () => {
    setHasManualScale(false);
    setScale(baseScale);
  };

  const seekToFrame = useCallback(
    (nextFrame: number) => {
      const clampedFrame = clampFrameIndex(nextFrame);
      setIsPlaying(false);
      setFrame(clampedFrame);
      setFrameInputValue(String(clampedFrame + 1));
      setSeekFrame(clampedFrame);
    },
    [clampFrameIndex]
  );

  const handleFrameInputChange = (value: string) => {
    setFrameInputValue(value);
    if (value.trim() === "") {
      return;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return;
    }
    seekToFrame(parsed - 1);
  };

  const handlePlaybackFpsChange = (value: string) => {
    setFpsInputValue(value);
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setPlaybackFps(0);
      return;
    }
    const clampedFps = Math.min(Math.max(Math.round(parsed), 1), 60);
    setPlaybackFps(clampedFps);
    setFpsInputValue(String(clampedFps));
  };

  const stepPlaybackFps = useCallback((delta: number) => {
    setPlaybackFps((current) => {
      const baseFps = current > 0 && Number.isFinite(current) ? current : 1;
      const nextFps = Math.min(Math.max(baseFps + delta, 1), 60);
      setFpsInputValue(String(nextFps));
      return nextFps;
    });
  }, []);

  const handleWheel = (event: React.WheelEvent) => {
    if (event.ctrlKey || isFullscreen) {
      event.preventDefault();
      const delta = event.deltaY * -0.001;
      setHasManualScale(true);
      setScale((prev) => clampScale(prev + delta));
    }
  };

  const toggleFullscreen = () => {
    const surface = viewerSurfaceRef.current;
    if (!surface) return;

    if (document.fullscreenElement === surface) {
      document.exitFullscreen();
      return;
    }

    surface.requestFullscreen().catch((error) => {
      console.error(`Error attempting to enable fullscreen mode: ${error.message}`);
    });
  };

  const handleChunkLoop = () => {
    if (isStreamingMode && gifUrls.length > 1 && autoAdvanceChunks) {
      selectChunk((activeChunkIndex + 1) % gifUrls.length);
    }
  };

  const openChunkInNewTab = async (index: number) => {
    const url = gifUrls[index];
    if (!url) return;

    const popup = window.open("about:blank", "_blank");
    if (!popup) return;

    popup.opener = null;

    try {
      const chunkData = await blobUrlToUint8Array(url);
      const sessionId = generateSessionId();
      await saveMultiviewSession(sessionId, [chunkData], "image/gif", {
        chunkMinFrames: [
          chunkMinFrames?.[index] ?? metadata?.minFrames ?? 0,
        ],
      });

      const params = new URLSearchParams({
        session: sessionId,
        chunk: "0",
        filename: `Chunk ${index + 1}`,
      });
      const minFrameCount = chunkMinFrames?.[index] ?? metadata?.minFrames;
      if (minFrameCount && minFrameCount > 0) {
        params.set("minFrames", minFrameCount.toString());
      }

      popup.location.replace(`/gif-viewer.html?${params.toString()}`);
    } catch (error) {
      console.error("Failed to open chunk in GIF viewer:", error);
      popup.location.replace(url);
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      const nextFullscreen = document.fullscreenElement === viewerSurfaceRef.current;
      setIsFullscreen(nextFullscreen);
      if (!nextFullscreen) {
        setIsChunkMenuOpen(false);
        setHasManualScale(false);
      }
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (!gifDimensions) return;

    const shouldCenterPageAfterExit = wasFullscreenRef.current && !isFullscreen;
    wasFullscreenRef.current = isFullscreen;

    requestAnimationFrame(() => {
      setHasManualScale(false);
      const nextBaseScale = computeAutoScale(gifDimensions);
      setBaseScale(nextBaseScale);
      setScale(nextBaseScale);
      requestAnimationFrame(() => {
        centerPreviewScroll();
        if (shouldCenterPageAfterExit) {
          centerViewerInPage();
        }
      });
    });
  }, [
    areControlsCollapsed,
    centerPreviewScroll,
    centerViewerInPage,
    computeAutoScale,
    gifDimensions,
    isFullscreen,
  ]);

  useEffect(() => {
    if (!gifDimensions) return;

    const scheduleSync = () => {
      requestAnimationFrame(() => {
        syncAutoScale(gifDimensions);
        requestAnimationFrame(centerPreviewScroll);
      });
    };

    scheduleSync();
    window.addEventListener("resize", scheduleSync);

    return () => {
      window.removeEventListener("resize", scheduleSync);
    };
  }, [centerPreviewScroll, gifDimensions, syncAutoScale]);

  useEffect(() => {
    const handleKeyPress = (event: KeyboardEvent) => {
      if (isInteractiveShortcutTarget(event.target)) {
        return;
      }

      const isPreviousChunkKey =
        hasChunkNavigation && (event.key === "ArrowLeft" || event.key === "a");
      const isNextChunkKey =
        hasChunkNavigation && (event.key === "ArrowRight" || event.key === "d");

      if (event.key === " " || event.code === "Space") {
        event.preventDefault();
        setIsPlaying((current) => !current);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        stepPlaybackFps(1);
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        stepPlaybackFps(-1);
      } else if (isPreviousChunkKey) {
        event.preventDefault();
        selectChunk(Math.max(0, currentChunkIndex - 1));
      } else if (isNextChunkKey) {
        event.preventDefault();
        selectChunk(Math.min(gifUrls.length - 1, currentChunkIndex + 1));
      } else if (!hasChunkNavigation && event.key === "ArrowLeft") {
        event.preventDefault();
        seekToFrame(frame - 1);
      } else if (!hasChunkNavigation && event.key === "ArrowRight") {
        event.preventDefault();
        seekToFrame(frame + 1);
      }
    };

    window.addEventListener("keydown", handleKeyPress);
    return () => window.removeEventListener("keydown", handleKeyPress);
  }, [
    currentChunkIndex,
    frame,
    gifUrls.length,
    hasChunkNavigation,
    seekToFrame,
    selectChunk,
    stepPlaybackFps,
  ]);

  if (!activeUrl) {
    return null;
  }

  const zoomPercent = Math.round((scale / (baseScale || 1)) * 100);
  const canOpenMultiView = Boolean(onOpenMultiView) && gifUrls.length > 1;
  const hasOverlayActions = actions.length > 0;
  const previewHeightClassName = isFullscreen
    ? "min-h-0 flex-1"
    : areControlsCollapsed
      ? COLLAPSED_CONTROLS_PREVIEW_AREA_CLASS_NAME
      : previewAreaClassName;

  return (
    <div data-testid="qr-gif-viewer" className={className}>
      <div
        ref={viewerSurfaceRef}
        onWheel={handleWheel}
        data-testid="qr-viewer-surface"
        className={`relative overflow-hidden rounded-[24px] bg-[var(--airqr-preview-surface)] shadow-[0_20px_70px_rgba(0,0,0,0.20)] backdrop-blur-2xl ${
          isFullscreen ? "fixed inset-0 z-50 flex flex-col rounded-none" : ""
        }`}
      >
        <div
          ref={previewScrollRef}
          data-testid="qr-preview-scroll"
          className={`flex items-start justify-center overflow-auto px-4 pb-0 sm:items-center sm:pb-4 ${hasChunkNavigation ? "pt-24" : "pt-14 sm:pt-16"} ${previewHeightClassName}`}
        >
          <GifPlayer
            key={activeChunkIndex}
            gifUrl={activeUrl}
            scale={scale}
            isPlaying={isPlaying}
            playbackFps={playbackFps > 0 ? playbackFps : null}
            seekFrame={seekFrame}
            onFrameChange={(nextFrame) => {
              setFrame(nextFrame);
              setFrameInputValue(String(nextFrame + 1));
              setSeekFrame(null);
            }}
            onLoop={handleChunkLoop}
            onLoad={(data) => {
              setGifInfo({
                totalFrames: data.totalFrames,
                duration: data.duration,
              });
              const detectedFps =
                data.duration > 0 && data.totalFrames > 0
                  ? Math.round((data.totalFrames * 1000) / data.duration)
                  : 0;
              const nextPlaybackFps =
                initialPlaybackFps ?? (encodedFps === undefined ? detectedFps : 0);
              if (nextPlaybackFps > 0 && playbackFps <= 0) {
                setPlaybackFps(nextPlaybackFps);
                setFpsInputValue(String(nextPlaybackFps));
              }
              const dimensions = { width: data.width, height: data.height };
              setGifDimensions(dimensions);
              setHasManualScale(false);
              syncAutoScale(dimensions, true);
            }}
            className="shadow-2xl"
          />
        </div>

        {hasChunkNavigation && (
          <div className={`absolute top-14 flex max-w-[calc(100%-2rem)] items-center gap-2 sm:top-4 sm:max-w-[calc(100%-5rem)] ${hasOverlayActions ? "right-4 sm:right-16" : "right-4"}`}>
            <div className="relative">
              {isFullscreen ? (
                <button
                  type="button"
                  aria-label={chunkBadgeLabel}
                  aria-expanded={isChunkMenuOpen}
                  onClick={() => setIsChunkMenuOpen((current) => !current)}
                  className="flex items-center gap-2 rounded-full border border-[var(--airqr-control-border)] bg-[var(--airqr-action-surface)] px-3 py-1 text-xs font-bold text-[var(--airqr-text-primary)] shadow-xl backdrop-blur-md transition-colors hover:bg-[var(--airqr-action-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--airqr-accent)] active:scale-95"
                >
                  <span>{chunkBadgeLabel}</span>
                  {minScanTimeLabel ? (
                    <span className="border-l border-[var(--airqr-divider)] pl-2 text-[10px] font-semibold text-[var(--airqr-text-secondary)]">
                      {minScanTimeLabel}
                    </span>
                  ) : null}
                </button>
              ) : (
                <div className="flex items-center gap-2 rounded-full border border-[var(--airqr-control-border)] bg-[var(--airqr-action-surface)] px-3 py-1 text-xs font-bold text-[var(--airqr-text-primary)] shadow-xl backdrop-blur-md">
                  <span>{chunkBadgeLabel}</span>
                  {minScanTimeLabel ? (
                    <span className="border-l border-[var(--airqr-divider)] pl-2 text-[10px] font-semibold text-[var(--airqr-text-secondary)]">
                      {minScanTimeLabel}
                    </span>
                  ) : null}
                </div>
              )}
              {isFullscreen && isChunkMenuOpen ? (
                <div
                  data-testid="fullscreen-chunk-menu"
                  className="absolute right-0 top-10 z-10 max-h-[min(60dvh,320px)] w-56 overflow-y-auto rounded-[20px] border border-[var(--airqr-control-border)] bg-[var(--airqr-control-panel-surface)] p-2 shadow-2xl backdrop-blur-md"
                >
                  <div className="grid grid-cols-5 gap-1">
                    {gifUrls.map((_, index) => (
                      <button
                        key={index}
                        type="button"
                        aria-label={t("encoder.chunkOption", { index: index + 1 })}
                        onClick={() => selectChunk(index)}
                        className={`flex h-8 w-8 items-center justify-center rounded-lg border text-xs font-bold transition-all active:scale-95 ${
                          activeChunkIndex === index
                            ? "border-transparent bg-[var(--airqr-nav-active)] text-[var(--airqr-text-primary)] shadow-lg"
                            : "border-[var(--airqr-control-border)] bg-[var(--airqr-action-surface)] text-[var(--airqr-text-secondary)] hover:bg-[var(--airqr-action-hover)] hover:text-[var(--airqr-text-primary)]"
                        }`}
                      >
                        {index + 1}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => setAutoAdvanceChunks((current) => !current)}
              className={`flex h-8 items-center gap-1 rounded-full px-2 text-xs font-bold backdrop-blur-md transition-all active:scale-95 ${
                autoAdvanceChunks
                  ? "bg-[var(--airqr-nav-active)] text-[var(--airqr-text-primary)]"
                  : "bg-[var(--airqr-action-surface)] text-[var(--airqr-text-secondary)] hover:bg-[var(--airqr-action-hover)] hover:text-[var(--airqr-text-primary)]"
              }`}
              title={
                autoAdvanceChunks
                  ? t("encoder.autoAdvanceOn")
                  : t("encoder.autoAdvanceOff")
              }
            >
              <Icon
                name={autoAdvanceChunks ? "play_circle" : "pause_circle"}
                className="text-[14px]"
              />
              {autoAdvanceChunks ? t("encoder.auto") : t("encoder.manual")}
            </button>
          </div>
        )}

        {!hasChunkNavigation && minScanTimeLabel ? (
          <div
            data-testid="qr-min-scan-badge"
            className={`absolute top-4 max-w-[48%] whitespace-nowrap rounded-full border border-[var(--airqr-control-border)] bg-[var(--airqr-action-surface)] px-3 py-1 text-xs font-bold text-[var(--airqr-text-primary)] shadow-xl backdrop-blur-md sm:max-w-[calc(100%-5rem)] ${hasOverlayActions ? "right-16" : "right-4"}`}
          >
            {minScanTimeLabel}
          </div>
        ) : null}

        {hasOverlayActions && (
          <div
            data-testid="qr-viewer-actions"
            className="absolute right-4 top-4 z-20 flex items-center gap-2"
          >
            {actions.map((action) => (
              <button
                key={action.key}
                type="button"
                onClick={action.onClick}
                disabled={action.disabled}
                aria-label={action.label}
                title={action.title ?? action.label}
                className={`flex size-9 items-center justify-center rounded-full shadow-xl backdrop-blur-md transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                  action.variant === "secondary"
                    ? "bg-[var(--airqr-action-surface)] text-[var(--airqr-text-primary)] hover:bg-[var(--airqr-action-hover)]"
                    : "bg-[var(--airqr-nav-active)] text-[var(--airqr-text-primary)] hover:bg-[var(--airqr-action-hover)]"
                }`}
              >
                {action.icon ? <Icon name={action.icon} className="text-[18px]" /> : null}
              </button>
            ))}
          </div>
        )}

        {frameTotal > 0 && (
          <div className={`absolute left-4 top-4 truncate rounded-full border border-[var(--airqr-control-border)] bg-[var(--airqr-action-surface)] px-3 py-1.5 font-mono text-xs text-[var(--airqr-text-primary)] shadow-lg backdrop-blur-md ${minScanTimeLabel && !hasChunkNavigation ? "max-w-[40%] sm:max-w-[calc(100%-5rem)]" : "max-w-[calc(100%-5rem)]"}`}>
            {frame + 1} / {frameTotal}
            {minFrames > 0 && (
              <span className="ml-2 text-[10px] text-[var(--airqr-text-secondary)]">
                ({t("encoder.minRequired")}: {minFrames})
              </span>
            )}
          </div>
        )}

        {areControlsCollapsed ? (
          <div className="p-3">
            <button
              type="button"
              onClick={() => setAreControlsCollapsed(false)}
              aria-label="Show controls"
              title="Show controls"
              className="mx-auto flex size-10 items-center justify-center rounded-full bg-[var(--airqr-action-surface)] text-[var(--airqr-text-primary)] shadow-[0_12px_34px_rgba(0,0,0,0.18)] transition-colors hover:bg-[var(--airqr-action-hover)] active:scale-95"
            >
              <Icon name="expand_less" className="text-[20px]" />
            </button>
          </div>
        ) : (
          <div
            data-testid="qr-controls-section"
            className={`p-1.5 pt-2 sm:p-3 ${
              isFullscreen
                ? "max-h-[45dvh] min-h-0 shrink-0 overflow-y-auto overscroll-contain pb-[max(0.375rem,env(safe-area-inset-bottom))]"
                : "-mt-8 sm:mt-0"
            }`}
          >
            <div
              data-testid="qr-controls-panel"
              className={`relative mx-auto flex w-full max-w-[760px] flex-col rounded-[24px] bg-[var(--airqr-control-panel-surface)] sm:rounded-[30px] ${
                isFullscreen ? "gap-1.5 p-2" : "gap-2 p-2.5 sm:gap-3 sm:p-3"
              }`}
            >
              <div
                data-testid="qr-primary-controls"
                className={`grid items-start gap-2 ${
                  isFullscreen
                    ? "grid-cols-[40px_minmax(0,1fr)_40px]"
                    : "grid-cols-2 sm:grid-cols-[44px_minmax(0,1fr)_44px]"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setAreControlsCollapsed(true)}
                  aria-label="Collapse controls"
                  className="airqr-action-button col-start-1 row-start-1 flex size-10 items-center justify-center justify-self-start rounded-full"
                  title="Collapse controls"
                >
                  <Icon name="expand_more" className="text-[20px]" />
                </button>
                <div
                  data-testid="qr-steppers"
                  className={`grid w-full min-w-0 gap-2 ${
                    isFullscreen
                      ? "col-start-2 row-start-1 grid-cols-2"
                      : "col-span-2 row-start-2 grid-cols-1 sm:col-span-1 sm:col-start-2 sm:row-start-1 sm:grid-cols-2"
                  }`}
                >
                  <div
                    data-testid="frame-stepper"
                    className="flex w-full min-w-0 justify-self-center flex-col gap-1.5 rounded-[20px] bg-[var(--airqr-nav-active)] p-1.5 text-sm font-semibold text-[var(--airqr-text-primary)] shadow-[0_12px_30px_rgba(0,0,0,0.16)] sm:max-w-[260px] sm:rounded-[22px]"
                  >
                  <span className="px-2 text-center text-[11px] font-bold leading-none text-[var(--airqr-text-secondary)]">
                    {t("encoder.frame")}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => seekToFrame(frame - 1)}
                      aria-label={t("encoder.previousFrame")}
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--airqr-action-surface)] text-lg font-bold leading-none text-[var(--airqr-text-primary)] transition-colors hover:bg-[var(--airqr-action-hover)] sm:size-9"
                      title={t("encoder.previousFrame")}
                    >
                      <Icon name="remove" className="text-[18px]" />
                    </button>
                    <label
                      data-testid="frame-count-group"
                      className="flex min-w-0 flex-1 items-center justify-center gap-1 px-1 text-[var(--airqr-text-primary)]"
                    >
                      <input
                        aria-label={t("encoder.frameNumberInput")}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={Math.max(1, frameTotal)}
                        value={frameInputValue}
                        onChange={(event) => handleFrameInputChange(event.target.value)}
                        className="airqr-number-input min-w-0 flex-none bg-transparent text-center font-bold text-[var(--airqr-text-primary)] outline-none"
                        style={{
                          width: `calc(${Math.max(
                            2,
                            String(Math.max(1, frameTotal)).length,
                            frameInputValue.length,
                          )}ch + 0.25rem)`,
                        }}
                      />
                      <span className="shrink-0 font-mono text-xs text-[var(--airqr-text-muted)]">
                        / {Math.max(1, frameTotal)}
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={() => seekToFrame(frame + 1)}
                      aria-label={t("encoder.nextFrame")}
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--airqr-action-surface)] text-lg font-bold leading-none text-[var(--airqr-text-primary)] transition-colors hover:bg-[var(--airqr-action-hover)] sm:size-9"
                      title={t("encoder.nextFrame")}
                    >
                      <Icon name="add" className="text-[18px]" />
                    </button>
                  </div>
                  </div>
                  <div
                    data-testid="playback-fps-stepper"
                    className="flex w-full min-w-0 justify-self-center flex-col gap-1.5 rounded-[20px] bg-[var(--airqr-nav-active)] p-1.5 text-sm font-semibold text-[var(--airqr-text-primary)] shadow-[0_12px_30px_rgba(0,0,0,0.16)] sm:max-w-[260px] sm:rounded-[22px]"
                  >
                  <span className="px-2 text-center text-[11px] font-bold leading-none text-[var(--airqr-text-secondary)]">
                    {t("encoder.playbackFps")}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => stepPlaybackFps(-1)}
                      aria-label={`${t("encoder.playbackFps")} -`}
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--airqr-action-surface)] text-lg font-bold leading-none text-[var(--airqr-text-primary)] transition-colors hover:bg-[var(--airqr-action-hover)] sm:size-9"
                      title={`${t("encoder.playbackFps")} -`}
                    >
                      <Icon name="remove" className="text-[18px]" />
                    </button>
                    <label className="flex min-w-0 flex-1 items-center justify-center px-1 text-[var(--airqr-text-primary)]">
                      <input
                        aria-label={t("encoder.playbackFps")}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={60}
                        value={fpsInputValue}
                        onChange={(event) => handlePlaybackFpsChange(event.target.value)}
                      className="airqr-number-input min-w-0 w-full bg-transparent text-center font-bold text-[var(--airqr-text-primary)] outline-none"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => stepPlaybackFps(1)}
                      aria-label={`${t("encoder.playbackFps")} +`}
                      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--airqr-action-surface)] text-lg font-bold leading-none text-[var(--airqr-text-primary)] transition-colors hover:bg-[var(--airqr-action-hover)] sm:size-9"
                      title={`${t("encoder.playbackFps")} +`}
                    >
                      <Icon name="add" className="text-[18px]" />
                    </button>
                  </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsPlaying((current) => !current)}
                  aria-label={isPlaying ? t("encoder.pausePlayback") : t("encoder.playPlayback")}
                  className={`row-start-1 flex size-10 items-center justify-center justify-self-end rounded-full bg-[var(--airqr-action-surface)] text-[var(--airqr-text-primary)] shadow-[0_10px_28px_rgba(0,0,0,0.18)] transition-colors hover:bg-[var(--airqr-action-hover)] ${
                    isFullscreen ? "col-start-3" : "col-start-2 sm:col-start-3"
                  }`}
                  title={isPlaying ? t("encoder.pausePlayback") : t("encoder.playPlayback")}
                >
                  <Icon name={isPlaying ? "pause" : "play_arrow"} className="text-[20px]" />
                </button>
              </div>

              <input
                aria-label={t("encoder.frameControl")}
                type="range"
                min={0}
                max={Math.max(0, frameTotal - 1)}
                value={frame}
                onChange={(event) => seekToFrame(Number(event.target.value))}
                className="airqr-range"
                style={getRangeProgressStyle(frame, 0, Math.max(0, frameTotal - 1))}
              />

              <div className="flex items-center justify-center gap-4">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleZoomOut}
                    aria-label={t("encoder.zoomOut")}
                    className="airqr-action-button rounded-full p-2"
                    title={t("encoder.zoomOut")}
                  >
                    <Icons.ZoomOut />
                  </button>
                  <button
                    type="button"
                    onClick={handleResetZoom}
                    aria-label={t("encoder.resetZoom")}
                    className="w-16 text-center text-sm font-bold text-[var(--airqr-text-secondary)] transition-colors hover:text-[var(--airqr-text-primary)]"
                    title={t("encoder.resetZoom")}
                  >
                    {zoomPercent}%
                  </button>
                  <button
                    type="button"
                    onClick={handleZoomIn}
                    aria-label={t("encoder.zoomIn")}
                    className="airqr-action-button rounded-full p-2"
                    title={t("encoder.zoomIn")}
                  >
                    <Icons.ZoomIn />
                  </button>
                </div>

                <div className="h-6 w-px bg-[var(--airqr-divider)]" />

                <button
                  type="button"
                  onClick={toggleFullscreen}
                  data-testid="qr-fullscreen-toggle"
                  aria-label={isFullscreen ? t("history.exitFullscreen") : t("history.fullscreen")}
                  className="airqr-action-button rounded-full p-2"
                  title={isFullscreen ? t("history.exitFullscreen") : t("history.fullscreen")}
                >
                  {isFullscreen ? <Icons.FullscreenExit /> : <Icons.Fullscreen />}
                </button>

              </div>

              {isStreamingMode && gifUrls.length > 1 && (
                <div
                  data-testid="qr-chunk-controls"
                  className="flex flex-col gap-2 border-t border-[var(--airqr-divider)] pt-2 animate-fade-in"
                >
                  <div className="flex items-center justify-between px-1">
                    <label className="airqr-section-title">
                      {t("encoder.dataChunks")}
                    </label>
                    {canOpenMultiView && (
                      <button
                        type="button"
                        onClick={onOpenMultiView}
                        disabled={isOpeningMultiView}
                        className="airqr-action-button flex items-center gap-1 rounded-full px-3 py-1 text-xs font-bold backdrop-blur-xl active:scale-95 disabled:cursor-wait disabled:opacity-50"
                        title={t("encoder.openMultiView")}
                      >
                        <Icon
                          name={isOpeningMultiView ? "hourglass_empty" : "grid_view"}
                          className="text-sm"
                        />
                        {isOpeningMultiView ? t("common.loading") : t("encoder.multiView")}
                      </button>
                    )}
                  </div>
                  <div className="scrollbar-hide flex gap-2 overflow-x-auto px-1 pb-1 pt-1">
                    {gifUrls.map((_, index) => (
                      <div key={index} className="group relative shrink-0">
                        <button
                          type="button"
                          onClick={() => selectChunk(index)}
                          className={`flex h-12 w-12 items-center justify-center rounded-[16px] text-sm font-bold transition-all duration-200 ${
                            activeChunkIndex === index
                              ? "scale-105 bg-[var(--airqr-nav-active)] text-[var(--airqr-text-primary)]"
                              : "bg-[var(--airqr-control-surface)] text-[var(--airqr-text-secondary)] hover:bg-[var(--airqr-action-hover)] hover:text-[var(--airqr-text-primary)]"
                          }`}
                        >
                          {index + 1}
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void openChunkInNewTab(index);
                          }}
                          className="airqr-action-button absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full opacity-0 backdrop-blur-xl transition-all active:scale-95 group-hover:opacity-100"
                          title={t("encoder.openChunkInNewTab", { index: index + 1 })}
                        >
                          <Icon name="open_in_new" className="text-[14px]" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

    </div>
  );
};

export default QrGifViewer;
