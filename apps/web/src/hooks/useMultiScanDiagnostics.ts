import { useEffect, useMemo, useState } from 'react';

import { globalHas } from '../parse/wire';
import type { ScanStats, ScanUploadConfig } from '../types';
import {
  captureMultiScanDiagnosticsSnapshot,
  publishScannerLiveDiagnostics,
  type MultiScanDiagnosticsSnapshot,
} from '../services/multiScanDiagnostics';
import {
  hasScanDebugShortcut,
  isScanDebugUploadEnabled,
  uploadScanDebugSnapshot,
} from '../services/scanDebugTelemetry';
import type { SessionProgressInfo } from './useScannerSyncProgress';

interface UseMultiScanDiagnosticsArgs {
  activeChunk: { current: number; total: number } | null;
  activeSessionId: string | null;
  localDeviceName: string;
  progress: number;
  scanStats: ScanStats;
  scannerDebugEnabled: boolean;
  sessionProgress: SessionProgressInfo | null;
  status: string;
  syncSourceName: string | null;
  uploadConfig: ScanUploadConfig;
}

interface UseMultiScanDiagnosticsResult {
  diagnosticsEnabled: boolean;
  diagnosticsSnapshot: MultiScanDiagnosticsSnapshot | null;
}

const DIAGNOSTICS_POLL_INTERVAL_MS = 2000;

function isQueryDebugEnabled(): boolean {
  if (!globalHas('window')) {
    return false;
  }
  const params = new URLSearchParams(window.location.search);
  return (
    hasScanDebugShortcut(params) ||
    params.get('scanDebug') === '1' ||
    params.get('multiscanDebug') === '1'
  );
}

export function useMultiScanDiagnostics({
  activeChunk,
  activeSessionId,
  localDeviceName,
  progress,
  scanStats,
  scannerDebugEnabled,
  sessionProgress,
  status,
  syncSourceName,
  uploadConfig,
}: UseMultiScanDiagnosticsArgs): UseMultiScanDiagnosticsResult {
  const [diagnosticsSnapshot, setDiagnosticsSnapshot] =
    useState<MultiScanDiagnosticsSnapshot | null>(null);

  const diagnosticsEnabled = useMemo(
    () => scannerDebugEnabled || isQueryDebugEnabled(),
    [scannerDebugEnabled]
  );
  const debugUploadEnabled = useMemo(
    () => diagnosticsEnabled && isScanDebugUploadEnabled(),
    [diagnosticsEnabled]
  );

  useEffect(() => {
    publishScannerLiveDiagnostics({
      activeChunk,
      localDeviceName,
      progress,
      scanStats,
      sessionId: activeSessionId,
      sessionProgress: sessionProgress
        ? {
            received: sessionProgress.received,
            total: sessionProgress.total,
            totalLabel: sessionProgress.totalLabel,
            totalIsEstimate: sessionProgress.totalIsEstimate,
            min: sessionProgress.min,
            minLabel: sessionProgress.minLabel,
            max: sessionProgress.max,
            maxLabel: sessionProgress.maxLabel,
            percent: sessionProgress.percent,
            decodeState: sessionProgress.decodeState,
            fileAvailable: sessionProgress.fileAvailable,
            chunksTotal: sessionProgress.chunksTotal,
            chunksComplete: sessionProgress.chunksComplete,
            chunksMissing: sessionProgress.chunksMissing,
            chunks: sessionProgress.chunks,
          }
        : null,
      status,
      syncSourceName,
    });
  }, [
    activeChunk,
    activeSessionId,
    localDeviceName,
    progress,
    scanStats,
    sessionProgress,
    status,
    syncSourceName,
  ]);

  useEffect(() => () => publishScannerLiveDiagnostics(null), []);

  useEffect(() => {
    if (!diagnosticsEnabled) {
      let cancelled = false;
      window.queueMicrotask(() => {
        if (!cancelled) {
          setDiagnosticsSnapshot(null);
        }
      });
      return () => {
        cancelled = true;
      };
    }

    let cancelled = false;

    const refresh = async () => {
      const nextSnapshot = await captureMultiScanDiagnosticsSnapshot({
        config: uploadConfig,
        sessionId: activeSessionId,
      });
      if (!cancelled) {
        setDiagnosticsSnapshot(nextSnapshot);
        if (debugUploadEnabled) {
          void uploadScanDebugSnapshot(nextSnapshot, uploadConfig);
        }
      }
    };

    void refresh();
    const intervalId = window.setInterval(() => {
      void refresh();
    }, DIAGNOSTICS_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [activeSessionId, debugUploadEnabled, diagnosticsEnabled, uploadConfig]);

  return {
    diagnosticsEnabled,
    diagnosticsSnapshot,
  };
}
