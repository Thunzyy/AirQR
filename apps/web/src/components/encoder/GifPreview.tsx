/**
 * GifPreview - Display encoded GIFs with stats, chunk navigation, and download.
 */

import React, { useState } from "react";
import { useTranslation } from "react-i18next";

import QrGifViewer from "../media/QrGifViewer";
import { Card } from "../ui";
import Icon from "../ui/Icon";
import { formatSize } from "../../utils/format";
import {
  blobUrlToUint8Array,
  generateSessionId,
  saveMultiviewSession,
} from "../../utils/multiviewStorage";

interface GifPreviewProps {
  gifUrls: string[];
  stats?: {
    originalSize: number;
    outputSize: number;
    expansion: number;
    duration: number;
  };
  metadata?: {
    totalFrames: number;
    minFrames: number;
    fileSize: number;
  };
  chunkMinFrames?: number[];
  isStreamingMode?: boolean;
  encodedFps?: number;
  onDownload: () => void;
}

const GifPreview: React.FC<GifPreviewProps> = ({
  gifUrls,
  stats,
  metadata,
  chunkMinFrames,
  isStreamingMode = false,
  encodedFps,
  onDownload,
}) => {
  const { t } = useTranslation();
  const [isOpeningMultiView, setIsOpeningMultiView] = useState(false);

  const openMultiChunkView = async () => {
    if (gifUrls.length === 0 || isOpeningMultiView) return;

    setIsOpeningMultiView(true);
    try {
      const chunkData = await Promise.all(
        gifUrls.map((url) => blobUrlToUint8Array(url))
      );

      const sessionId = generateSessionId();

      await saveMultiviewSession(sessionId, chunkData, "image/gif", {
        chunkMinFrames: chunkMinFrames ?? (metadata?.minFrames ? [metadata.minFrames] : undefined),
      });

      window.open(
        `/multi-chunk.html?session=${sessionId}`,
        "_blank",
        "noopener,noreferrer"
      );
    } catch (error) {
      console.error("Failed to open multi-chunk view:", error);
    } finally {
      setIsOpeningMultiView(false);
    }
  };

  if (gifUrls.length === 0) {
    return null;
  }

  return (
    <Card className="animate-slide-up">
      <div
        data-testid="gif-preview-result-header"
        className="mb-4 flex items-start justify-between gap-3"
      >
        <div className="min-w-0">
          <h2 className="airqr-section-title">
            {t("encoder.result")}
          </h2>
          {stats && (
            <div className="mt-1 text-sm text-[var(--airqr-text-muted)]">
              {formatSize(stats.outputSize)} - {stats.duration.toFixed(1)}s
              {stats.expansion > 0 && (
                <span className="ml-2 font-medium text-[var(--airqr-danger-text)]">
                  ({stats.expansion > 0 ? "+" : ""}
                  {stats.expansion.toFixed(1)}% {t("encoder.expansion")})
                </span>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onDownload}
          aria-label={isStreamingMode ? t("encoder.downloadZip") : t("encoder.downloadGif")}
          title={isStreamingMode ? t("encoder.downloadZip") : t("encoder.downloadGif")}
          className="airqr-action-button airqr-action-button-accent flex size-10 shrink-0 items-center justify-center rounded-full shadow-[0_12px_34px_rgba(0,0,0,0.18)] transition-colors active:scale-95"
        >
          <Icon
            name="download"
            className="airqr-result-download-icon text-[18px]"
          />
        </button>
      </div>

      <QrGifViewer
        gifUrls={gifUrls}
        metadata={metadata}
        chunkMinFrames={chunkMinFrames}
        isStreamingMode={isStreamingMode}
        encodedFps={encodedFps}
        onOpenMultiView={gifUrls.length > 1 ? openMultiChunkView : undefined}
        isOpeningMultiView={isOpeningMultiView}
      />
    </Card>
  );
};

export default GifPreview;
