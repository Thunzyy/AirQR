import React, { useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import init, {
  init_streaming_decoder,
  init_normal_decoder,
  decode_streaming_packet,
  decode_normal_packet,
} from "../../wasm/airqrCoreTyped";
import { GifDecoderPool } from "../../workers/gif-decoder-pool";
import { errorMessage } from "../../parse/wire";
import { createLogger } from "../../utils/logger";
import Icon from "../../components/ui/Icon";
import { copyTextToClipboard } from "../../utils/linksite";
import {
  decodeNoteContent,
  getDisplayNoteFilename,
  isNoteFilename,
} from "../../utils/noteDetection";

const logger = createLogger('ui:gifDecoder');
import {
  extractGifFrames,
  extractGifsFromZip,
  isZipFile,
  isGifFile,
} from "./gif-decoder-utils";
import { formatSize as formatBytes } from "../../utils/format";
import {
  isCompletedDecodeResult,
  normalizeDecodeResult,
} from "../scanner/scanDecoderResult";
import {
  buildGifDecodeMetrics,
  type GifDecodeMetrics,
} from "./gifDecoderPerf";

interface DecoderStats {
  totalFrames: number;
  processedFrames: number;
  qrDetected: number;
  startTime: number;
  fileSize: number;
  filename: string;
}

interface GifProcessResult {
  completed: boolean;
  streamingDetected: boolean;
}

const GifDecoder: React.FC = () => {
  const { t } = useTranslation();
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [_stats, setStats] = useState<DecoderStats | null>(null);
  const [_progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string>(
    t('decoder.tapToSelect')
  );
  const [result, setResult] = useState<{
    filename: string;
    data: Uint8Array;
    metrics: GifDecodeMetrics;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [_previewUrl, setPreviewUrl] = useState<string | null>(null);

  const poolRef = useRef<GifDecoderPool | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelected(files[0]);
    }
  }, []);

  const handleFileInputChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        handleFileSelected(files[0]);
      }
    },
    []
  );

  const openFilePicker = useCallback(() => {
    if (isProcessing) {
      return;
    }

    fileInputRef.current?.click();
  }, [isProcessing]);

  const handlePickerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      openFilePicker();
    },
    [openFilePicker]
  );

  const handleFileSelected = (file: File) => {
    setSelectedFile(file);
    setError(null);
    setResult(null);
    setProgress(0);

    if (file.type === "image/gif" || file.name.endsWith(".gif")) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
    } else {
      setPreviewUrl(null);
    }

    setStats({
      totalFrames: 0,
      processedFrames: 0,
      qrDetected: 0,
      startTime: 0,
      fileSize: file.size,
      filename: file.name,
    });
  };

  const startDecoding = async () => {
    if (!selectedFile) return;

    setIsProcessing(true);
    setError(null);
    setProgress(0);

    const startTime = performance.now();

    try {
      setStatus(t('decoder.readingFile'));
      const arrayBuffer = await selectedFile.arrayBuffer();
      const fileData = new Uint8Array(arrayBuffer);

      setStatus(t('decoder.initDecoder'));
      await init();
      init_streaming_decoder();
      init_normal_decoder();

      poolRef.current = new GifDecoderPool();

      setStats((prev) => ({
        ...prev!,
        startTime,
      }));

      if (isZipFile(fileData)) {
        await processZipFile(fileData, startTime);
      } else if (isGifFile(fileData)) {
        await processGifFile(fileData, startTime);
      } else {
        throw new Error(t('decoder.unsupportedFileType'));
      }
    } catch (err) {
      logger.error('Decoding error', { error: err instanceof Error ? err.message : String(err) });
      setError(String(err));
      setStatus(t('decoder.errorOccurred'));
    } finally {
      poolRef.current?.terminate();
      poolRef.current = null;
      setIsProcessing(false);
    }
  };

  const processGifFile = async (
    gifData: Uint8Array,
    startTime: number
  ): Promise<GifProcessResult> => {
    setStatus(t('decoder.extractingFrames'));
    const frames = await extractGifFrames(gifData);

    setStats((prev) => ({
      ...prev!,
      totalFrames: frames.length,
    }));

    setStatus(t('decoder.processingFrames', { count: frames.length }));

    let qrDetected = 0;
    let decodingComplete = false;
    let streamingDetected = false;
    let workerDecodeTimeMs = 0;

    const batchSize = Math.min(
      64,
      Math.max(16, (navigator.hardwareConcurrency || 4) * 4)
    );
    for (
      let batchStart = 0;
      batchStart < frames.length && !decodingComplete;
      batchStart += batchSize
    ) {
      const batchEnd = Math.min(batchStart + batchSize, frames.length);
      const batch = frames.slice(batchStart, batchEnd);

      const batchPromises = batch.map((frame: ImageData, batchIndex: number) =>
        poolRef.current!.decodeFrame(batchStart + batchIndex, frame)
      );
      const results = await Promise.all(batchPromises);
      workerDecodeTimeMs += results.reduce(
        (total, frameResult) => total + frameResult.decodeTimeMs,
        0
      );

      let batchQrDetected = 0;
      for (let i = 0; i < results.length && !decodingComplete; i++) {
        const frameResult = results[i];
        const frameIndex = batchStart + i;

        if (frameResult.found && frameResult.binaryData) {
          batchQrDetected++;

          try {
            let decodeResult;
            try {
              decodeResult = normalizeDecodeResult(
                decode_streaming_packet(frameResult.binaryData)
              );
              streamingDetected = true;
            } catch (streamErr) {
              if (String(streamErr).includes("Not a streaming mode packet")) {
                decodeResult = normalizeDecodeResult(
                  decode_normal_packet(frameResult.binaryData)
                );
              } else {
                throw streamErr;
              }
            }

            if (isCompletedDecodeResult(decodeResult)) {
              const duration = performance.now() - startTime;
              const processedFrames = Math.min(frameIndex + 1, frames.length);
              const detectedQrCount = qrDetected + batchQrDetected;
              setResult({
                filename: decodeResult.filename,
                data: decodeResult.data,
                metrics: buildGifDecodeMetrics({
                  processedFrames,
                  qrDetected: detectedQrCount,
                  wallTimeMs: duration,
                  workerDecodeTimeMs,
                }),
              });
              setStatus(t('decoder.decodingComplete'));
              decodingComplete = true;
            } else if (decodeResult.type === "chunk_completed") {
              const percent = decodeResult.overallPercent || 0;
              if (percent > 0) {
                setProgress((prev) => Math.max(prev, percent));
              }
              if (
                decodeResult.chunkId !== undefined &&
                decodeResult.totalChunks
              ) {
                setStatus(
                  t('decoder.chunkComplete', { current: decodeResult.chunkId + 1, total: decodeResult.totalChunks })
                );
              }
            } else if (decodeResult.type === "progress") {
              const percent =
                decodeResult.overallPercent || decodeResult.percent || 0;
              if (percent > 0) {
                setProgress((prev) => Math.max(prev, percent));
              }
              setStatus(
                t('decoder.decodingProgress', { percent: percent.toFixed(1), count: qrDetected + batchQrDetected })
              );
            }
          } catch (err) {
            logger.error('Frame decode error', { frameIndex, error: err instanceof Error ? err.message : String(err) });
          }
        }
      }

      qrDetected += batchQrDetected;
      setStats((prev) => ({
        ...prev!,
        processedFrames: Math.min(batchEnd, frames.length),
        qrDetected,
      }));
      const framePercent =
        (Math.min(batchEnd, frames.length) / frames.length) * 100;
      setProgress((prev) => Math.max(prev, framePercent));
    }

    if (!decodingComplete) {
      if (streamingDetected) {
        setStatus(t('decoder.chunkWaiting'));
        return { completed: false, streamingDetected };
      }

      throw new Error(t('decoder.notEnoughQr'));
    }

    return { completed: decodingComplete, streamingDetected };
  };

  const processZipFile = async (zipData: Uint8Array, startTime: number) => {
    setStatus(t('decoder.extractingFrames'));
    const gifFiles = await extractGifsFromZip(zipData);

    if (gifFiles.size === 0) {
      throw new Error(t('decoder.noGifInZip'));
    }

    setStatus(t('decoder.foundGifInArchive', { count: gifFiles.size }));

    const entries: Array<[string, Uint8Array]> = Array.from(
      gifFiles.entries()
    );
    entries.sort((a, b) =>
      a[0].localeCompare(b[0], undefined, {
        numeric: true,
        sensitivity: "base",
      })
    );

    let lastError: Error | null = null;
    let successfulDecode = false;
    let streamingDetected = false;

    for (let i = 0; i < entries.length; i++) {
      const [filename, gifData] = entries[i];
      setStatus(
        t('decoder.processingFile', {
          filename,
          current: i + 1,
          total: entries.length,
        })
      );
      try {
        const result = await processGifFile(gifData, startTime);
        streamingDetected = streamingDetected || result.streamingDetected;

        if (result.completed) {
          successfulDecode = true;
          break;
        }
      } catch (err) {
        logger.warn('Could not decode file', { filename, error: err instanceof Error ? err.message : String(err) });
        lastError = err instanceof Error ? err : new Error(errorMessage(String(err)));
      }
    }

    if (!successfulDecode && streamingDetected) {
      throw new Error(t('decoder.incompleteStreaming'));
    }

    if (!successfulDecode && lastError) {
      throw new Error(
        t('decoder.failedToDecodeAny', { error: lastError.message })
      );
    }
  };

  const downloadResult = () => {
    if (!result) return;

    const noteResult = isNoteFilename(result.filename);
    const bytes =
      result.data instanceof Uint8Array
        ? Uint8Array.from(result.data)
        : new Uint8Array(result.data);
    const blob = new Blob([bytes], {
      type: noteResult ? "text/plain" : "application/octet-stream",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = noteResult ? getDisplayNoteFilename(result.filename) : result.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const copyDecodedNote = async () => {
    if (!result || !isNoteFilename(result.filename)) {
      return;
    }

    try {
      await copyTextToClipboard(decodeNoteContent(result.data));
    } catch (error) {
      logger.error('Failed to copy decoded note', { error: error instanceof Error ? error.message : String(error) });
    }
  };

  const displayFilename = result ? (
    isNoteFilename(result.filename) ? getDisplayNoteFilename(result.filename) : result.filename
  ) : null;
  const decodedNoteContent = result && isNoteFilename(result.filename)
    ? decodeNoteContent(result.data)
    : null;

  return (
    <div
      className="airqr-screen flex h-full flex-col overflow-auto font-display"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept=".gif,.zip"
        onChange={handleFileInputChange}
        className="hidden"
      />

      {/* Main Content - matches mobile SingleChildScrollView */}
      <div className="airqr-content flex-1 space-y-4 p-4 pb-28">
        {/* File Picker - matches mobile GestureDetector Container */}
        <div
          className={`airqr-liquid-card cursor-pointer rounded-[34px] p-5 transition-all active:scale-[0.99] ${
            selectedFile || isDragging
              ? "bg-[var(--airqr-card-hover)] shadow-[var(--airqr-shadow-strong)]"
              : ""
          }`}
          role="button"
          aria-disabled={isProcessing}
          aria-label={selectedFile ? selectedFile.name : t('decoder.tapToSelect')}
          tabIndex={isProcessing ? -1 : 0}
          onClick={openFilePicker}
          onKeyDown={handlePickerKeyDown}
        >
          <div className="flex items-start gap-4">
            <div
              className={`airqr-file-icon size-16 ${
                selectedFile ? "bg-[var(--airqr-accent-soft)] text-[var(--airqr-accent-text)]" : ""
              }`}
            >
              <Icon
                name={selectedFile ? "gif_box" : "upload_file"}
                className="text-[34px]"
              />
            </div>
            <div className="min-w-0 flex-1 pt-1">
              <p className="break-words text-[22px] font-bold leading-tight text-[var(--airqr-text-primary)]">
                {selectedFile ? selectedFile.name : t('decoder.selectFileCardTitle')}
              </p>
              {selectedFile ? (
                <p className="mt-1 text-[15px] font-medium leading-snug text-[var(--airqr-text-secondary)]">
                  {formatBytes(selectedFile.size)}
                </p>
              ) : null}
            </div>
          </div>
          <div className="airqr-primary-button mt-6 flex h-12 items-center justify-center rounded-full px-5 text-[16px] font-bold">
            {t('decoder.tapToSelect')}
          </div>
        </div>

        {/* Status - matches mobile status Container */}
        <div className="airqr-liquid-alert flex items-center gap-3 p-4">
          {isProcessing ? (
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-[var(--airqr-text-muted)] border-t-transparent" />
          ) : (
            <Icon
              name={error ? "error" : "info"}
              className={`text-xl ${
                error ? "text-[var(--airqr-danger-text)]" : "text-[var(--airqr-text-muted)]"
              }`}
            />
          )}
          <p
            className={`flex-1 text-sm ${
              error ? "text-[var(--airqr-danger-text)]" : "text-[var(--airqr-text-muted)]"
            }`}
          >
            {status}
          </p>
        </div>

        {/* Decode Button - matches mobile ElevatedButton */}
        <button
          onClick={selectedFile && !isProcessing ? startDecoding : undefined}
          disabled={!selectedFile || isProcessing}
          className="airqr-primary-button flex w-full items-center justify-center rounded-full py-4 text-base font-bold transition-colors disabled:cursor-not-allowed disabled:bg-[var(--airqr-disabled-surface)] disabled:text-[var(--airqr-disabled-text)]"
        >
          {isProcessing ? (
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-current border-t-transparent" />
          ) : (
            t('decoder.decodeGif')
          )}
        </button>

        {/* Error - matches mobile error Container */}
        {error && (
          <div className="airqr-liquid-alert p-4">
            <p className="text-sm text-[var(--airqr-danger-text)]">{error}</p>
          </div>
        )}

        {/* Result - matches mobile result Container */}
        {result && (
          <div className="airqr-liquid-card rounded-[34px] p-5">
            <div className="flex flex-col items-center gap-4">
              <Icon name="check_circle" className="text-5xl text-[var(--airqr-success-text)]" />
              <p className="text-lg font-bold text-[var(--airqr-text-primary)]">{t('decoder.decodingComplete')}</p>
              <p className="text-[var(--airqr-text-secondary)]">{displayFilename}</p>
              <p className="text-[var(--airqr-text-muted)]">{formatBytes(result.data.length)}</p>
              {decodedNoteContent ? (
                <div className="airqr-liquid-subcard w-full rounded-[24px] p-4 text-left">
                  <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-6 text-[var(--airqr-text-primary)]">
                    {decodedNoteContent}
                  </pre>
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-2 w-full text-center">
                <div className="airqr-liquid-subcard rounded-[20px] px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-[var(--airqr-text-muted)]">
                    {t('decoder.measuredWallTimeLabel')}
                  </p>
                  <p className="text-sm font-semibold text-[var(--airqr-text-primary)]">
                    {t('decoder.measuredWallTimeValue', {
                      seconds: (result.metrics.wallTimeMs / 1000).toFixed(2),
                    })}
                  </p>
                </div>
                <div className="airqr-liquid-subcard rounded-[20px] px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-[var(--airqr-text-muted)]">
                    {t('decoder.measuredWorkerTimeLabel')}
                  </p>
                  <p className="text-sm font-semibold text-[var(--airqr-text-primary)]">
                    {t('decoder.measuredWorkerTimeValue', {
                      seconds: (result.metrics.workerDecodeTimeMs / 1000).toFixed(2),
                    })}
                  </p>
                </div>
                <div className="airqr-liquid-subcard rounded-[20px] px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-[var(--airqr-text-muted)]">
                    {t('decoder.measuredFramesPerSecondLabel')}
                  </p>
                  <p className="text-sm font-semibold text-[var(--airqr-text-primary)]">
                    {t('decoder.measuredFramesPerSecondValue', {
                      fps: result.metrics.framesPerSecond.toFixed(1),
                    })}
                  </p>
                </div>
                <div className="airqr-liquid-subcard rounded-[20px] px-3 py-2">
                  <p className="text-[11px] uppercase tracking-wide text-[var(--airqr-text-muted)]">
                    {t('decoder.measuredQrDetectionsLabel')}
                  </p>
                  <p className="text-sm font-semibold text-[var(--airqr-text-primary)]">
                    {t('decoder.measuredQrDetectionsValue', {
                      count: result.metrics.qrDetected,
                    })}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3">
                {decodedNoteContent ? (
                  <button
                    onClick={copyDecodedNote}
                    className="airqr-action-button airqr-action-button-accent flex items-center gap-2 rounded-full px-6 py-3 font-bold transition-colors"
                  >
                    <Icon name="content_copy" />
                    {t('scanner.copyToClipboard')}
                  </button>
                ) : null}
                <button
                  onClick={downloadResult}
                  className="airqr-primary-button flex items-center gap-2 rounded-full px-8 py-3 font-bold transition-colors"
                >
                  <Icon name="save" />
                  {t('decoder.saveFile')}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default GifDecoder;
