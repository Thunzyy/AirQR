import { useCallback, useEffect, type MutableRefObject } from "react";

import { init_normal_decoder, init_streaming_decoder } from "../wasm/airqrCoreTyped";
import type { BinaryData } from "../utils/binaryData";

type ResumeStats = {
  received: number;
  total: number;
  filename?: string;
};

type ResultData = {
  kind: 'file' | 'note';
  filename: string;
  data: BinaryData;
  duration: number;
  noteContent?: string;
  internalFilename?: string;
  sessionId?: string;
} | null;

type ScanStats = {
  received: number;
  min: number;
  total?: number;
  chunkTotal?: number;
  chunkReceived?: number;
};

type UseScannerSessionStateArgs = {
  autoContinue: boolean;
  clearChunkExactTotals?: () => void;
  chunksSavedRef: MutableRefObject<number>;
  filenameRef: MutableRefObject<string | null>;
  fpsFrameCountRef: MutableRefObject<number>;
  fpsLastTimeRef: MutableRefObject<number>;
  ignoredSessionAfterResetRef: MutableRefObject<string | null>;
  isProcessingFrameRef: MutableRefObject<boolean>;
  lastScanAtRef: MutableRefObject<number>;
  localDeviceName: string;
  onScanProgress?: (stats: {
    sessionId: string;
    filename: string;
    received: number;
    total: number;
    deviceName?: string;
    source?: "local" | "server";
  }) => void;
  packetIndexRef: MutableRefObject<number>;
  remoteCompleteHandledRef: MutableRefObject<string | null>;
  resumeMode: boolean;
  resumeSessionId?: string;
  resumeStats?: ResumeStats;
  resetGenerationRef?: MutableRefObject<number>;
  scanRequestIdRef?: MutableRefObject<number>;
  resultData: ResultData;
  serverProgressSeenRef: MutableRefObject<boolean>;
  sessionIdRef: MutableRefObject<string | null>;
  setActiveSessionId: (value: string | null) => void;
  setActiveChunk: (value: null) => void;
  setFps: (value: number) => void;
  setIsScanning: (value: boolean) => void;
  setProgress: (value: number) => void;
  setResultData: (value: ResultData) => void;
  setScanStats: (value: ScanStats) => void;
  setSessionProgress: (value: null) => void;
  setStatus: (value: string) => void;
  setSyncSourceName: (value: string | null) => void;
  startTimeRef: MutableRefObject<number>;
  suppressResetSessionRealtimeRef: MutableRefObject<boolean>;
  t: (key: string) => string;
};

export function useScannerSessionState({
  autoContinue,
  clearChunkExactTotals,
  chunksSavedRef,
  filenameRef,
  fpsFrameCountRef,
  fpsLastTimeRef,
  ignoredSessionAfterResetRef,
  isProcessingFrameRef,
  lastScanAtRef,
  localDeviceName,
  onScanProgress,
  packetIndexRef,
  remoteCompleteHandledRef,
  resumeMode,
  resumeSessionId,
  resumeStats,
  resetGenerationRef,
  scanRequestIdRef,
  resultData,
  serverProgressSeenRef,
  sessionIdRef,
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
  startTimeRef,
  suppressResetSessionRealtimeRef,
  t,
}: UseScannerSessionStateArgs) {
  const getOrCreateSessionId = useCallback(
    (explicit?: string): string => {
      if (resumeMode && resumeSessionId) {
        if (sessionIdRef.current !== resumeSessionId) {
          serverProgressSeenRef.current = false;
          clearChunkExactTotals?.();
        }
        sessionIdRef.current = resumeSessionId;
        setActiveSessionId(resumeSessionId);
        return resumeSessionId;
      }

      if (explicit) {
        if (sessionIdRef.current !== explicit) {
          serverProgressSeenRef.current = false;
          clearChunkExactTotals?.();
        }
        sessionIdRef.current = explicit;
        setActiveSessionId(explicit);
        return explicit;
      }

      if (!sessionIdRef.current) {
        serverProgressSeenRef.current = false;
        clearChunkExactTotals?.();
        sessionIdRef.current = String(Date.now());
      }

      setActiveSessionId(sessionIdRef.current);
      return sessionIdRef.current;
    },
    [
      clearChunkExactTotals,
      resumeMode,
      resumeSessionId,
      serverProgressSeenRef,
      sessionIdRef,
      setActiveSessionId,
    ]
  );

  const resetScanSessionState = useCallback(
    (options?: { preserveResumeSession?: boolean }) => {
      if (resetGenerationRef) {
        resetGenerationRef.current += 1;
      }
      if (scanRequestIdRef) {
        scanRequestIdRef.current += 1;
      }

      const preserveResumeSession = options?.preserveResumeSession ?? true;
      const nextResumeStats =
        preserveResumeSession && resumeStats
          ? {
              received: resumeStats.received,
              min: resumeStats.total,
            }
          : { received: 0, min: 0 };

      init_streaming_decoder();
      init_normal_decoder();
      packetIndexRef.current = 0;
      sessionIdRef.current =
        preserveResumeSession && resumeMode && resumeSessionId
          ? resumeSessionId
          : null;
      setActiveSessionId(sessionIdRef.current);
      filenameRef.current = null;
      serverProgressSeenRef.current = false;
      remoteCompleteHandledRef.current = null;
      setSyncSourceName(localDeviceName);
      setIsScanning(true);
      setProgress(0);
      setScanStats(nextResumeStats);
      setFps(0);
      setResultData(null);
      setStatus(t("scanner.scanning"));
      setActiveChunk(null);
      setSessionProgress(null);
      startTimeRef.current = 0;
      chunksSavedRef.current = 0;
      lastScanAtRef.current = 0;
      fpsFrameCountRef.current = 0;
      fpsLastTimeRef.current = performance.now();
      isProcessingFrameRef.current = false;
      clearChunkExactTotals?.();
    },
    [
      chunksSavedRef,
      clearChunkExactTotals,
      filenameRef,
      fpsFrameCountRef,
      fpsLastTimeRef,
      isProcessingFrameRef,
      lastScanAtRef,
      localDeviceName,
      packetIndexRef,
      remoteCompleteHandledRef,
      resumeMode,
      resumeSessionId,
      resumeStats,
      resetGenerationRef,
      scanRequestIdRef,
      serverProgressSeenRef,
      sessionIdRef,
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
      startTimeRef,
      t,
    ]
  );

  useEffect(() => {
    if (!autoContinue || !resultData) return;
    const timer = setTimeout(() => {
      resetScanSessionState({ preserveResumeSession: false });
    }, 1000);
    return () => clearTimeout(timer);
  }, [autoContinue, resetScanSessionState, resultData]);

  const resetScanner = useCallback(() => {
    ignoredSessionAfterResetRef.current =
      sessionIdRef.current || resumeSessionId || null;
    suppressResetSessionRealtimeRef.current = Boolean(
      ignoredSessionAfterResetRef.current
    );
    resetScanSessionState({ preserveResumeSession: false });

    if (onScanProgress) {
      onScanProgress({
        sessionId: "",
        filename: "",
        received: 0,
        total: 0,
        deviceName: localDeviceName,
        source: "local",
      });
    }
  }, [
    ignoredSessionAfterResetRef,
    localDeviceName,
    onScanProgress,
    resetScanSessionState,
    resumeSessionId,
    sessionIdRef,
    suppressResetSessionRealtimeRef,
  ]);

  return {
    getOrCreateSessionId,
    resetScanSessionState,
    resetScanner,
  };
}
