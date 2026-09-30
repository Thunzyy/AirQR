/**
 * EncoderTab component - Refactored with sub-components
 */

import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEncoderStore, useHistoryStore, useSettingsStore, useToastStore } from '../../store';
import { APP_INFO } from '../../constants';
import { globalHas } from '../../parse/wire';
import { createLogger } from '../../utils/logger';
import {
  createStandaloneEncoderWorker,
  initEncoderWorker,
  terminateOwnedEncoderWorkers,
} from '../../services/encoderWorkerManager';
import {
  buildEncoderLinksiteDataUrl,
  copyTextToClipboard,
  ENCODER_LINKSITE_PATH,
  ENCODER_LINKSITE_CONSOLE_SNIPPET,
  PORTABLE_SINGLEFILE_PATH,
} from '../../utils/linksite';

const logger = createLogger('ui:encoderTab');
import { Button, Icon } from '../ui';
import { FileDropzone, EncoderSettings, GifPreview, NoteEditor } from '../encoder';
import {
  createHistoryItem,
  getVersionedHistoryTitle,
  stripHistoryItemData,
  toZipFilename,
} from '../../utils/history';
import { createZipStreamSession, zipFilesInWorker } from '../../utils/zipWorker';
import { saveHistoryItemWithAutoSync } from '../../services/historyDB';
import { buildParallelEncodePayload } from '../../utils/encoderPayload';
import {
  buildChunkWorkerInput,
  calculateWeightedChunkProgress,
  createSharedChunkInputBuffer,
  describeStreamingChunkTasks,
  planStreamingChunkParallelism,
  resolveStreamingChunkSizeMB,
  runTasksWithConcurrency,
  shouldUseStreamingEncoding,
  shouldUseSharedChunkInput,
} from '../../services/streamingChunkOptimization';
import type {
  EncoderWorkerProgressPayload,
  EncoderWorkerRequest,
} from '../../workers/encoderWorkerMessages';
import {
  advanceOverallEncoderProgress,
  normalizeEncoderWorkerMessage,
} from '../../workers/encoderWorkerMessages';
import {
  buildNoteFilename,
} from '../../utils/noteDetection';

const IconQrCode = () => (
  <svg className="airqr-icon w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
  </svg>
);

function asGifBytes(payload: ArrayBufferLike | Uint8Array): Uint8Array<ArrayBuffer> {
  const source = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const copy = new Uint8Array(new ArrayBuffer(source.byteLength));
  copy.set(source);
  return copy;
}

interface GeneratedHistoryTarget {
  fileData: Uint8Array;
  filename: string;
  mimeType?: string;
}

function encodeStreamingChunkWithWorker(
  worker: Worker,
  request: Extract<EncoderWorkerRequest, { type: "ENCODE_STREAMING_CHUNK" }>,
  chunkId: number,
  onProgress: (percent: number) => void,
  onMinFrames: (minFrames: number) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    let resolvedProgress = 0;

    const advanceProgress = (payload: EncoderWorkerProgressPayload) => {
      resolvedProgress = advanceOverallEncoderProgress(resolvedProgress, payload);
      onProgress(resolvedProgress);
    };

    const messageHandler = (event: MessageEvent) => {
      const message = normalizeEncoderWorkerMessage(event.data);
      if (!message) {
        return;
      }

      if (message.type === "PROGRESS") {
        advanceProgress(message.payload);
        return;
      }

      if (message.type === "METADATA") {
        const payloadChunkId = message.payload.chunkId;
        if (
          Number.isFinite(message.payload.minFrames) &&
          message.payload.minFrames > 0 &&
          (!Number.isFinite(payloadChunkId) || payloadChunkId === chunkId)
        ) {
          onMinFrames(message.payload.minFrames);
        }
        return;
      }

      cleanup();
      if (message.type === "COMPLETE") {
        resolvedProgress = 100;
        onProgress(100);
        resolve(asGifBytes(message.payload));
      } else if (message.type === "ERROR") {
        reject(new Error(message.payload));
      }
    };

    const cleanup = () => {
      worker.removeEventListener("message", messageHandler);
    };

    worker.addEventListener("message", messageHandler);
    const transferables =
      request.payload.chunkData instanceof Uint8Array
        ? [request.payload.chunkData.buffer]
        : [];
    worker.postMessage(request, transferables);
  });
}

interface EncoderTabProps {
  workerRef: React.MutableRefObject<Worker | null>;
}

const EncoderTab: React.FC<EncoderTabProps> = ({
  workerRef
}) => {
  const { t } = useTranslation();
  const initPromiseRef = useRef<Promise<Worker> | null>(null);
  const [isEngineInitializing, setIsEngineInitializing] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [isCopyingEncoderLinksite, setIsCopyingEncoderLinksite] = useState(false);
  const [isLinksiteHelpOpen, setIsLinksiteHelpOpen] = useState(false);

  // Store hooks
  const {
    selectedFiles,
    selectedFolderName,
    encoderMode,
    config,
    gifUrls,
    gifMetadata,
    generatedFps,
    downloadUrl,
    isStreamingResult,
    isEncoding,
    progress,
    error,
    setFiles,
    setFolderName,
    setEncoderMode,
    noteText,
    noteFormat,
    setNoteText,
    setNoteFormat,
    setConfig,
    setEncoding,
    setProgress,
    setError,
    setGifMetadata,
    setGifResults,
    resetOutput,
  } = useEncoderStore();

  const { addItem, items: historyItems } = useHistoryStore();
  const {
    uploadConfig,
    showEncoderLinksiteNotice,
    setShowEncoderLinksiteNotice,
  } = useSettingsStore();
  const showToast = useToastStore((state) => state.show);

  // Local state
  const [encodingStats, setEncodingStats] = useState<{
    originalSize: number;
    outputSize: number;
    expansion: number;
    duration: number;
  } | null>(null);
  const [streamingMinFrames, setStreamingMinFrames] = useState<number[]>([]);

  // Handle file/folder selection
  const handleFileSelect = useCallback((files: File[], folderName: string | null) => {
    setFiles(files);
    setFolderName(folderName);
    resetOutput();
  }, [setFiles, setFolderName, resetOutput]);

  const handleEncoderModeChange = useCallback((mode: 'file' | 'note') => {
    setEncoderMode(mode);
    setError(null);
    resetOutput();
  }, [resetOutput, setEncoderMode, setError]);

  const handleNoteTextChange = useCallback((value: string) => {
    setNoteText(value);
    setError(null);
    resetOutput();
  }, [resetOutput, setError, setNoteText]);

  const handleNoteFormatChange = useCallback((value: typeof noteFormat) => {
    setNoteFormat(value);
    setError(null);
    resetOutput();
  }, [resetOutput, setError, setNoteFormat]);

  const handleClearNote = useCallback(() => {
    setNoteText('');
    setError(null);
    resetOutput();
  }, [resetOutput, setError, setNoteText]);

  const MAX_INLINE_BYTES = 50 * 1024 * 1024;

  const ensureEncoderWorker = useCallback(async (): Promise<Worker> => {
    if (workerRef.current) {
      return workerRef.current;
    }
    if (initPromiseRef.current) {
      return initPromiseRef.current;
    }

    setIsEngineInitializing(true);
    setEngineError(null);

    initPromiseRef.current = initEncoderWorker({ warmup: false });

    try {
      const worker = await initPromiseRef.current;
      workerRef.current = worker;
      return worker;
    } catch (err) {
      logger.error('Failed to initialize encoder engine', { error: err instanceof Error ? err.message : String(err) });
      const message = err instanceof Error ? err.message : 'Failed to initialize encoder engine';
      setEngineError(message);
      throw err;
    } finally {
      initPromiseRef.current = null;
      setIsEngineInitializing(false);
    }
  }, [workerRef]);

  // Handle encoding
  const handleEncode = async () => {
    if (encoderMode === 'file' && !selectedFiles) {
      setError(t('errors.missingResourcesEncoding'));
      return;
    }

    if (encoderMode === 'note' && noteText.trim().length === 0) {
      setError(t('errors.missingResourcesEncoding'));
      return;
    }

    setError(null);
    setProgress(0);
    setStreamingMinFrames([]);

    setEncoding(true);
    const startTime = Date.now();
    const encodeFps = config.fps;

    try {
      // Prepare file data
      let dataToEncode: Uint8Array;
      let filename: string;
      let historyTarget: GeneratedHistoryTarget | null = null;
      let isArchiveInput = false;
      let originalSize = 0;
      const currentSelectedFiles = selectedFiles;

      if (encoderMode === 'note') {
        const noteBytes = new TextEncoder().encode(noteText);
        dataToEncode = Uint8Array.from(noteBytes);
        filename = buildNoteFilename(noteFormat);
        originalSize = dataToEncode.length;
        historyTarget = {
          fileData: Uint8Array.from(noteBytes),
          filename,
          mimeType: 'text/plain',
        };
      } else if (currentSelectedFiles && (currentSelectedFiles.length > 1 || selectedFolderName)) {
        // Create ZIP archive for multiple files or folder
        setProgress(1); // Show small progress for ZIP creation
        const zipData: Record<string, Uint8Array> = {};
        for (const file of currentSelectedFiles) {
          const path = file.webkitRelativePath || file.name;
          const arrayBuffer = await file.arrayBuffer();
          zipData[path] = new Uint8Array(arrayBuffer);
        }
        dataToEncode = await zipFilesInWorker(zipData, { level: 0 });
        filename = selectedFolderName ? `${selectedFolderName}.zip` : "archive.zip";
        originalSize = currentSelectedFiles.reduce((acc, f) => acc + f.size, 0);
        isArchiveInput = true;
      } else if (currentSelectedFiles && currentSelectedFiles.length > 0) {
        // Single file
        const arrayBuffer = await currentSelectedFiles[0].arrayBuffer();
        dataToEncode = new Uint8Array(arrayBuffer);
        filename = currentSelectedFiles[0].name;
        originalSize = currentSelectedFiles.reduce((acc, f) => acc + f.size, 0);
      } else {
        throw new Error(t('errors.missingResourcesEncoding'));
      }

      const shouldStream = shouldUseStreamingEncoding({
        customChunkSize: config.customChunkSize,
        encodedBytes: dataToEncode.length,
        forceChunkMode: config.forceChunkMode,
        isArchiveInput,
        maxInlineBytes: MAX_INLINE_BYTES,
      });

      if (shouldStream) {
        await encodeStreaming(
          dataToEncode,
          filename,
          originalSize,
          startTime,
          isArchiveInput,
          historyTarget,
          encodeFps,
        );
      } else {
        try {
          await ensureEncoderWorker();
        } catch {
          setError(t('errors.encoderEngineInitFailed'));
          setEncoding(false);
          return;
        }
        await encodeFile(dataToEncode, filename, originalSize, startTime, historyTarget, encodeFps);
      }
    } catch (err) {
      logger.error('Encoding error', { error: err instanceof Error ? err.message : String(err) });
      setError(err instanceof Error ? err.message : t('errors.encodingFailed'));
      setEncoding(false);
    }
  };

  // Encoding logic
  const encodeFile = async (
    data: Uint8Array,
    filename: string,
    originalSize: number,
    startTime: number,
    historyTarget: GeneratedHistoryTarget | null,
    encodedFps: number,
  ) => {
    if (!workerRef.current) {
      throw new Error("Worker not initialized");
    }

    const worker = workerRef.current;

    return new Promise<void>((resolve, reject) => {
      let resolvedProgress = 0;

      const messageHandler = (e: MessageEvent) => {
        const message = normalizeEncoderWorkerMessage(e.data);
        if (!message) {
          return;
        }

        if (message.type === "PROGRESS") {
          resolvedProgress = advanceOverallEncoderProgress(
            resolvedProgress,
            message.payload,
          );
          setProgress(resolvedProgress);
        } else if (message.type === "METADATA") {
          // Update GIF metadata from worker
          // Payload: { minFrames, totalFrames }
          setGifMetadata({
            totalFrames: message.payload.totalFrames,
            minFrames: message.payload.minFrames,
          });
        } else if (message.type === "COMPLETE") {
          worker.removeEventListener("message", messageHandler);
          setProgress(100);

          // Create blob and URL
          const gifBytes = asGifBytes(message.payload);
          const gifBlob = new Blob([gifBytes], { type: "image/gif" });
          const url = URL.createObjectURL(gifBlob);

          // Calculate stats
          const duration = (Date.now() - startTime) / 1000;
          const outputSize = gifBlob.size;
          const expansion = originalSize > 0 ? ((outputSize - originalSize) / originalSize) * 100 : 0;

          setEncodingStats({
            originalSize,
            outputSize,
            expansion,
            duration,
          });

          const timestamp = Date.now();
          const historyItem = {
            ...createHistoryItem({
              id: timestamp.toString(),
              origin: "generated",
              filename: historyTarget?.filename ||
                (filename.endsWith(".gif") ? filename : `${filename}.gif`),
              fileData: historyTarget?.fileData || gifBytes,
              mimeType: historyTarget?.mimeType || "image/gif",
              timestamp,
              totalFrames: historyTarget ? undefined : gifMetadata?.totalFrames,
              minFrames: historyTarget ? undefined : gifMetadata?.minFrames,
            }),
            isLocalOnly: !uploadConfig.enabled,
          };
          if (historyTarget) {
            historyItem.title = getVersionedHistoryTitle(historyItems, historyItem.title);
          }

          saveHistoryItemWithAutoSync(historyItem, uploadConfig).catch((error) => {
            logger.error('Failed to save history item', { error: error instanceof Error ? error.message : String(error) });
          });
          addItem(stripHistoryItemData(historyItem));

          // Update store
          setGifResults([url], {
            fileSize: outputSize,
            originalSize,
            duration,
            // Keep existing totalFrames and minFrames from METADATA event
          }, {
            downloadUrl: url,
            isStreamingResult: false,
            generatedFps: encodedFps,
          });

          setEncoding(false);
          resolve();
        } else if (message.type === "ERROR") {
          worker.removeEventListener("message", messageHandler);
          setEncoding(false);
          reject(new Error(message.payload));
        }
      };

      worker.addEventListener("message", messageHandler);

      // Send encode message - worker-parallel.ts expects ENCODE_PARALLEL
      const request: EncoderWorkerRequest = {
        type: "ENCODE_PARALLEL",
        payload: buildParallelEncodePayload({
          filename,
          data,
          sessionId: Math.floor(Date.now() / 1000),
          config: {
            fps: config.fps,
            ecc: config.ecc,
            packetSize: config.packetSize,
            targetSize: config.targetSize,
            raptorqOverhead: config.raptorqOverhead,
            compressionEnabled: config.compressionEnabled,
          },
        }),
      };
      worker.postMessage(
        request,
        [data.buffer]
      );
    });
  };

  const encodeStreaming = async (
    data: Uint8Array,
    filename: string,
    originalSize: number,
    startTime: number,
    isArchiveInput: boolean,
    historyTarget: GeneratedHistoryTarget | null,
    encodedFps: number,
  ) => {
    const chunkSizeMB = resolveStreamingChunkSizeMB({
      forceChunkMode: config.forceChunkMode,
      customChunkSize: config.customChunkSize,
      dataBytes: data.length,
    });
    const chunkSizeBytes = Math.max(1, Math.floor(chunkSizeMB * 1024 * 1024));
    const totalChunks = Math.ceil(data.length / chunkSizeBytes);
    const sessionId = Math.floor(Date.now() / 1000);
    const chunkMinFrames: number[] = Array(totalChunks).fill(0);
    const filenameBytes = new TextEncoder().encode(filename);
    const chunkTasks = describeStreamingChunkTasks({
      data,
      chunkSizeBytes,
      filenameBytes,
      requestedPacketSize: config.packetSize,
    });
    chunkTasks.forEach((task) => {
      chunkMinFrames[task.chunkId] = task.fallbackMinFrames;
    });
    const chunkProgress = Array(totalChunks).fill(0);
    const chunkWeights = chunkTasks.map((task) => task.chunkBytes);
    const updateOverallProgress = (chunkId: number, percent: number) => {
      chunkProgress[chunkId] = Math.max(0, Math.min(100, percent));
      setProgress(calculateWeightedChunkProgress(chunkWeights, chunkProgress));
    };

    const parallelismPlan = planStreamingChunkParallelism(
      totalChunks,
      navigator.hardwareConcurrency || 4,
    );

    let workers: Worker[] = [];
    let ownsWorkers = false;

    try {
      if (parallelismPlan.coordinatorCount > 1) {
        setIsEngineInitializing(true);
        setEngineError(null);
        workers = await Promise.all(
          Array.from({ length: parallelismPlan.coordinatorCount }, () =>
            createStandaloneEncoderWorker({
              qrPoolSize: parallelismPlan.qrWorkersPerCoordinator,
              wasmThreadCount: parallelismPlan.wasmThreadsPerCoordinator,
            }),
          ),
        );
        ownsWorkers = true;
      } else {
        try {
          const worker = await ensureEncoderWorker();
          workers = [worker];
        } catch {
          throw new Error(t('errors.encoderEngineInitFailed'));
        }
      }
    } finally {
      setIsEngineInitializing(false);
    }

    const zipSession = await createZipStreamSession();
    const sharedChunkInputBuffer = shouldUseSharedChunkInput({
      totalChunks,
      dataBytes: data.byteLength,
      sharedArrayBufferAvailable: globalHas("SharedArrayBuffer"),
    })
      ? createSharedChunkInputBuffer(data)
      : null;
    const chunkResults = await (async () => {
      const chunkArtifactPromises: Promise<{
        chunkId: number;
        previewUrl: string;
      }>[] = [];
      try {
        await runTasksWithConcurrency({
          tasks: chunkTasks,
          concurrency: workers.length,
          runTask: async (task, slotIndex) => {
            const worker = workers[slotIndex];
            const chunkInput = buildChunkWorkerInput({
              data,
              task,
              sharedInputBuffer: sharedChunkInputBuffer,
            });
            const request: Extract<EncoderWorkerRequest, { type: "ENCODE_STREAMING_CHUNK" }> = {
              type: "ENCODE_STREAMING_CHUNK",
              payload: {
                filename,
                ...chunkInput,
                chunkId: task.chunkId,
                totalChunks,
                sessionId,
                chunkSizeMB,
                compressionEnabled: config.compressionEnabled,
                frameDelay: Math.round(1000 / config.fps),
                ecc: config.ecc,
                packetSize: config.packetSize,
                targetSize: config.targetSize,
                scale: 1,
                raptorqOverhead: config.raptorqOverhead,
              },
            };

            const gifBytes = await encodeStreamingChunkWithWorker(
              worker,
              request,
              task.chunkId,
              (percent) => updateOverallProgress(task.chunkId, percent),
              (minFrames) => {
                chunkMinFrames[task.chunkId] = minFrames;
              },
            );

            const chunkFilename = `${filename}.chunk${task.chunkId + 1}.gif`;
            const previewUrl = URL.createObjectURL(
              new Blob([gifBytes], { type: "image/gif" }),
            );
            chunkArtifactPromises.push(
              zipSession.addFile(chunkFilename, gifBytes).then(() => ({
                chunkId: task.chunkId,
                previewUrl,
              })),
            );

            return {
              chunkId: task.chunkId,
            };
          },
        });
        const chunkArtifacts = await Promise.all(chunkArtifactPromises);
        chunkArtifacts.sort((left, right) => left.chunkId - right.chunkId);
        return chunkArtifacts;
      } catch (error) {
        zipSession.abort();
        throw error;
      } finally {
        if (ownsWorkers) {
          terminateOwnedEncoderWorkers(workers);
        }
      }
    })();

    const chunkUrls: string[] = [];
    for (const result of chunkResults) {
      chunkUrls.push(result.previewUrl);
    }

    const zipData = await zipSession.finalize();
    const zipBlob = new Blob([new Uint8Array(zipData)], { type: "application/zip" });
    const zipUrl = URL.createObjectURL(zipBlob);

    const duration = (Date.now() - startTime) / 1000;
    setEncodingStats({
      originalSize,
      outputSize: zipBlob.size,
      expansion:
        originalSize > 0
          ? ((zipBlob.size - originalSize) / originalSize) * 100
          : 0,
      duration,
    });

    const historyTitle = isArchiveInput ? toZipFilename(filename) : filename;
    const timestamp = Date.now();
    const historyItem = {
      ...createHistoryItem({
        id: timestamp.toString(),
        origin: "generated",
        filename: historyTarget?.filename || historyTitle,
        fileData: historyTarget?.fileData || zipData,
        mimeType: historyTarget?.mimeType || "application/zip",
        timestamp,
        chunkMinFrames: historyTarget ? undefined : chunkMinFrames,
      }),
      chunkMinFrames: historyTarget ? undefined : chunkMinFrames,
      isLocalOnly: !uploadConfig.enabled,
    };
    if (historyTarget) {
      historyItem.title = getVersionedHistoryTitle(historyItems, historyItem.title);
    }

    saveHistoryItemWithAutoSync(historyItem, uploadConfig).catch((error) => {
      logger.error('Failed to save history item', { error: error instanceof Error ? error.message : String(error) });
    });
    addItem(stripHistoryItemData(historyItem));

    setStreamingMinFrames(chunkMinFrames);

    // Pass both the preview URL (first chunk) and the download URL (ZIP)
    // We use the first URL for preview and the second one could be kept or we handle it in state
    setGifResults(chunkUrls, {
      fileSize: zipBlob.size,
      originalSize,
      duration,
      totalFrames: 0,
      minFrames: 0,
    }, {
      downloadUrl: zipUrl,
      isStreamingResult: true,
      generatedFps: encodedFps,
    });

    setEncoding(false);
  };

  // Handle download
  const handleDownload = useCallback(() => {
    const downloadTarget = downloadUrl || gifUrls[0];
    if (downloadTarget) {
      const a = document.createElement("a");
      a.href = downloadTarget;
      a.download = isStreamingResult ? "qrcode-chunks.zip" : "qrcode.gif";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }, [downloadUrl, gifUrls, isStreamingResult]);

  const handleCopyEncoderLinksite = useCallback(async () => {
    if (isCopyingEncoderLinksite) {
      return;
    }

    setIsCopyingEncoderLinksite(true);

    try {
      const dataUrl = await buildEncoderLinksiteDataUrl();
      await copyTextToClipboard(dataUrl);
      showToast(t('encoder.encoderLinksiteCopied'), 'success');
    } catch (err) {
      logger.error('Failed to copy encoder linksite URL', { error: err instanceof Error ? err.message : String(err) });
      showToast(t('encoder.encoderLinksiteCopyFailed'), 'error');
    } finally {
      setIsCopyingEncoderLinksite(false);
    }
  }, [isCopyingEncoderLinksite, showToast, t]);

  const handleHideEncoderLinksiteNotice = useCallback(() => {
    setIsLinksiteHelpOpen(false);
    setShowEncoderLinksiteNotice(false);
  }, [setShowEncoderLinksiteNotice]);

  const encoderModeTabs = [
    ['file', t('encoder.fileMode')],
    ['note', t('encoder.noteMode')],
  ] as const;
  const activeEncoderModeIndex = Math.max(
    0,
    encoderModeTabs.findIndex(([value]) => value === encoderMode)
  );

  return (
    <div className="airqr-screen flex flex-col animate-fade-in">
      <div className="airqr-content flex flex-col gap-6 px-4 py-4 pb-28">
      {/* Loading State */}
      {(isEngineInitializing || engineError) && (
        <div className="airqr-card p-4 text-center text-[var(--airqr-text-secondary)]">
          {engineError ? (
            <span className="text-[var(--airqr-danger-text)]">{engineError}</span>
          ) : (
            t('encoder.loadingWasm')
          )}
        </div>
      )}

      {/* Input Section */}
      <>
          <div className="relative grid h-[52px] grid-cols-2 rounded-[22px] bg-[var(--airqr-nav-surface)] p-1 shadow-[0_16px_44px_rgba(0,0,0,0.18)] backdrop-blur-2xl">
            <div
              aria-hidden="true"
              className="absolute inset-y-1 left-1 z-0 transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"
              style={{
                width: `calc((100% - 8px) / ${encoderModeTabs.length})`,
                transform: `translateX(${activeEncoderModeIndex * 100}%)`,
              }}
            >
              <div className="h-full rounded-[18px] bg-[var(--airqr-nav-active)] shadow-[0_10px_28px_rgba(0,0,0,0.14)]" />
            </div>
            {encoderModeTabs.map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => handleEncoderModeChange(value)}
                className={`relative z-10 rounded-[18px] px-4 text-[15px] font-bold transition-colors duration-200 ${
                  encoderMode === value
                    ? 'text-[var(--airqr-text-primary)]'
                    : 'text-[var(--airqr-text-muted)] hover:text-[var(--airqr-text-secondary)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {showEncoderLinksiteNotice ? (
            <div
              data-testid="encoder-linksite-notice"
              className="airqr-liquid-card rounded-[24px] px-4 py-3 text-sm text-[var(--airqr-text-primary)]"
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-bold">{t('encoder.encoderLinksitePrompt')}</p>
                  <p className="mt-1 text-[var(--airqr-text-secondary)]">
                    {t('encoder.encoderLinksiteSuffix')}
                  </p>
                </div>
                <div
                  data-testid="encoder-linksite-notice-controls"
                  className="flex shrink-0 items-center gap-2"
                >
                  <button
                    type="button"
                    aria-label={t('encoder.encoderLinksiteHelpLabel')}
                    aria-expanded={isLinksiteHelpOpen}
                    aria-controls="encoder-linksite-help"
                    onClick={() => setIsLinksiteHelpOpen((current) => !current)}
                    className="airqr-action-button flex size-8 shrink-0 items-center justify-center rounded-full"
                  >
                    <Icon name="help" className="text-[18px]" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('encoder.hideEncoderLinksiteNotice')}
                    title={t('encoder.hideEncoderLinksiteNotice')}
                    onClick={handleHideEncoderLinksiteNotice}
                    className="airqr-action-button flex size-8 shrink-0 items-center justify-center rounded-full"
                  >
                    <Icon name="close" className="text-[18px]" />
                  </button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={APP_INFO.releasesUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="airqr-primary-button inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-bold"
                >
                  <Icon name="open_in_new" className="text-[16px]" />
                  <span>{t('encoder.openGithubReleases')}</span>
                </a>
                <button
                  type="button"
                  onClick={handleCopyEncoderLinksite}
                  disabled={isCopyingEncoderLinksite}
                  className="airqr-action-button inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-bold disabled:cursor-wait disabled:opacity-60"
                >
                  <Icon name="content_copy" className="text-[16px]" />
                  <span>
                    {isCopyingEncoderLinksite
                      ? t('encoder.copyingEncoderLinksite')
                      : t('encoder.copyEncoderLinksite')}
                  </span>
                </button>
              </div>

              {isLinksiteHelpOpen ? (
                <div
                  id="encoder-linksite-help"
                  className="mt-3 border-t border-[var(--airqr-divider)] pt-3"
                >
                  <p className="font-semibold text-[var(--airqr-text-primary)]">
                    {t('encoder.encoderLinksiteHelpTitle')}
                  </p>
                  <p className="mt-2 text-[var(--airqr-text-secondary)]">
                    {t('encoder.encoderLinksiteHelpBody')}
                  </p>
                  <p className="mt-2 text-[var(--airqr-text-secondary)]">
                    {t('encoder.encoderLinksiteHelpFallback')}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a
                      href={ENCODER_LINKSITE_PATH}
                      download="AirQR_Encoder.html"
                      className="airqr-primary-button inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-bold transition-colors"
                    >
                      <Icon name="download" className="text-[16px]" />
                      <span>{t('encoder.downloadEncoderHtml')}</span>
                    </a>
                    <a
                      href={PORTABLE_SINGLEFILE_PATH}
                      download="airqr-portable.html"
                      className="airqr-primary-button inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-bold transition-colors"
                    >
                      <Icon name="download" className="text-[16px]" />
                      <span>{t('encoder.downloadPortableHtml')}</span>
                    </a>
                  </div>
                  <p className="mt-3 text-xs text-[var(--airqr-text-secondary)]">
                    {t('encoder.encoderLinksiteConsoleHint')}
                  </p>
                  <pre className="mt-2 overflow-x-auto rounded-xl bg-[var(--airqr-control-panel-surface)] p-3 text-xs leading-5 text-[var(--airqr-text-secondary)]">
                    <code>{ENCODER_LINKSITE_CONSOLE_SNIPPET}</code>
                  </pre>
                </div>
              ) : null}
            </div>
          ) : null}

          {encoderMode === 'note' ? (
            <NoteEditor
              noteText={noteText}
              noteFormat={noteFormat}
              onNoteTextChange={handleNoteTextChange}
              onNoteFormatChange={handleNoteFormatChange}
              onClear={handleClearNote}
            />
          ) : (
            <FileDropzone
              selectedFiles={selectedFiles}
              selectedFolderName={selectedFolderName}
              onFileSelect={handleFileSelect}
            />
          )}

          {/* Configuration */}
          {(encoderMode === 'note' ? noteText.trim().length > 0 : Boolean(selectedFiles)) && (
            <EncoderSettings
              config={config}
              forceChunkMode={config.forceChunkMode}
              onConfigChange={(updates) => {
                setConfig(updates);
              }}
              onForceChunkModeChange={(enabled) => {
                setConfig({ forceChunkMode: enabled });
              }}
            />
          )}

          {/* Action Button */}
          <Button
            variant="primary"
            size="lg"
            onClick={handleEncode}
            disabled={
              isEncoding ||
              isEngineInitializing ||
              (encoderMode === 'note'
                ? noteText.trim().length === 0
                : !selectedFiles)
            }
            className="airqr-generate-button w-full shadow-none disabled:shadow-none"
          >
            <IconQrCode />
            <span>{isEncoding ? t('encoder.encoding') : t('encoder.generate')}</span>
          </Button>

          {/* Error Message */}
          {error && (
            <div className="airqr-liquid-alert p-4 text-sm font-semibold text-[var(--airqr-danger-text)]">
              {error}
            </div>
          )}

          {/* Progress Bar */}
          {isEncoding && (
            <div className="w-full" data-testid="encoder-progress">
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-[var(--airqr-control-surface)]">
                {progress > 0 ? (
                  <div
                    className="h-2.5 rounded-full bg-[var(--airqr-loading)] transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                ) : (
                  <div className="h-2.5 w-1/3 animate-pulse rounded-full bg-[var(--airqr-loading)]" />
                )}
              </div>
              <p className="mt-1 text-center text-xs text-[var(--airqr-text-muted)]">
                {progress > 0 ? t('encoder.encodingProgress', { percent: progress }) : t('encoder.encoding')}
              </p>
            </div>
          )}

          {/* Results */}
          {gifUrls.length > 0 && (
            <GifPreview
              key={gifUrls[0]}
              gifUrls={gifUrls}
              stats={encodingStats || undefined}
              metadata={gifMetadata || undefined}
              chunkMinFrames={streamingMinFrames}
              isStreamingMode={isStreamingResult}
              encodedFps={generatedFps ?? undefined}
              onDownload={handleDownload}
            />
          )}
      </>
      </div>
    </div>
  );
};

export default EncoderTab;
