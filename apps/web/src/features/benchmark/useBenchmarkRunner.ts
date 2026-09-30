import { useCallback, useEffect, useRef, useState } from 'react';
import { initEncoderWorker } from '../../services/encoderWorkerManager';
import {
  normalizeEncoderWorkerMessage,
  type EncoderWorkerRequest,
} from '../../workers/encoderWorkerMessages';
import { buildParallelEncodePayload } from '../../utils/encoderPayload';
import { getWebSocketSyncService } from '../../services/websocketSyncService';
import type {
  BenchmarkProfile,
  BenchmarkResult,
  BenchmarkRunDefinition,
  BenchmarkRunState,
  BenchmarkSession,
  GifFrameInfo,
  BenchmarkMode,
} from './types';
import {
  BENCHMARK_TIMEOUT_MS,
  buildPhase1Matrix,
  buildExhaustiveMatrix,
  buildPhase3Matrix,
  buildQuickMatrix,
  createBenchmarkProfile,
  fingerprintConfig,
  labelForConfig,
  selectTopConfigs,
} from './matrix';
import { updateBenchmarkSession } from './storage';

type BenchmarkTestPayload = {
  data: Uint8Array;
  filename: string;
};

function generateTestPayload(size: number): BenchmarkTestPayload {
  const data = new Uint8Array(size);
  crypto.getRandomValues(data);
  return { data, filename: `bench-${Date.now()}.bin` };
}

function asGifBytes(payload: ArrayBufferLike | Uint8Array): Uint8Array<ArrayBuffer> {
  const source = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const copy = new Uint8Array(new ArrayBuffer(source.byteLength));
  copy.set(source);
  return copy;
}

function buildAllRuns(mode: BenchmarkMode, profile: BenchmarkProfile): BenchmarkRunDefinition[] {
  if (mode === 'quick') return buildQuickMatrix(profile);
  if (mode === 'exhaustive') return buildExhaustiveMatrix(profile);
  // Smart mode: phase1 only for initial runs; phase3 is added dynamically after phase1
  return buildPhase1Matrix(profile);
}

export function useBenchmarkRunner() {
  const [state, setState] = useState<BenchmarkRunState>({
    phase: 'idle',
    currentIndex: 0,
    totalRuns: 0,
    results: [],
    currentRun: null,
    gifUrl: null,
    gifFrameInfo: null,
    encodeProgress: 0,
    displayStartTime: 0,
  });

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const pendingRejectRef = useRef<((reason: Error) => void) | null>(null);
  const runningRef = useRef(false);
  const sessionRef = useRef<BenchmarkSession | null>(null);

  const cleanup = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const encodeConfig = useCallback(async (
    config: BenchmarkRunDefinition['config'],
    payload: Uint8Array,
    filename: string,
  ): Promise<{ gifUrl: string; frameInfo: GifFrameInfo; gifSizeBytes: number }> => {
    const worker = await initEncoderWorker({ warmup: true });

    return new Promise((resolve, reject) => {
      let frameInfo: GifFrameInfo = { totalFrames: 0, minFrames: 0 };

      const handler = (event: MessageEvent) => {
        const message = normalizeEncoderWorkerMessage(event.data);
        if (!message) {
          return;
        }

        if (message.type === 'PROGRESS') {
          setState((prev) => ({ ...prev, encodeProgress: message.payload.percent }));
        } else if (message.type === 'METADATA') {
          frameInfo = {
            totalFrames: message.payload.totalFrames ?? 0,
            minFrames: message.payload.minFrames ?? 0,
          };
          setState((prev) => ({ ...prev, gifFrameInfo: frameInfo }));
        } else if (message.type === 'COMPLETE') {
          worker.removeEventListener('message', handler);
          const gifBytes = asGifBytes(message.payload);
          const blob = new Blob([gifBytes], { type: 'image/gif' });
          resolve({ gifUrl: URL.createObjectURL(blob), frameInfo, gifSizeBytes: gifBytes.length });
        } else if (message.type === 'ERROR') {
          worker.removeEventListener('message', handler);
          reject(new Error(message.payload));
        }
      };

      worker.addEventListener('message', handler);
      const payloadCopy = new Uint8Array(payload);
      const request: EncoderWorkerRequest = {
        type: 'ENCODE_PARALLEL',
        payload: buildParallelEncodePayload({
          filename,
          data: payloadCopy,
          sessionId: Math.floor(Date.now() / 1000),
          config,
        }),
      };
      worker.postMessage(
        request,
        [payloadCopy.buffer],
      );
    });
  }, []);

  const waitForScanComplete = useCallback((): Promise<number> => {
    return new Promise<number>((resolve, reject) => {
      const startTime = Date.now();

      pendingRejectRef.current = (reason) => {
        cleanup();
        pendingRejectRef.current = null;
        reject(reason);
      };

      timeoutRef.current = setTimeout(() => {
        cleanup();
        pendingRejectRef.current = null;
        reject(new Error('timeout'));
      }, BENCHMARK_TIMEOUT_MS);

      const wsService = getWebSocketSyncService();
      unsubRef.current = wsService.subscribe((event) => {
        if (event.type === 'scan-complete') {
          cleanup();
          pendingRejectRef.current = null;
          resolve(Date.now() - startTime);
        }
      });
    });
  }, [cleanup]);

  const runSingle = useCallback(async (
    index: number,
    run: BenchmarkRunDefinition,
    testPayload: Uint8Array,
    filename: string,
    payloadSizeBytes: number,
  ): Promise<BenchmarkResult> => {
    setState((prev) => ({
      ...prev,
      phase: 'encoding',
      currentIndex: index,
      currentRun: run,
      encodeProgress: 0,
      gifUrl: null,
      gifFrameInfo: null,
    }));

    let pendingGifUrl: string | null = null;
    try {
      const { gifUrl, frameInfo, gifSizeBytes } = await encodeConfig(run.config, testPayload, filename);
      pendingGifUrl = gifUrl;

      setState((prev) => ({
        ...prev,
        phase: 'displaying',
        currentRun: run,
        gifUrl,
        gifFrameInfo: frameInfo,
        displayStartTime: Date.now(),
      }));

      const transferTimeMs = await waitForScanComplete();

      const throughputKBps = (payloadSizeBytes / 1024) / (transferTimeMs / 1000);
      return {
        phase: run.phase,
        config: run.config,
        transferTimeMs,
        throughputKBps,
        success: true,
        totalFrames: frameInfo.totalFrames,
        minFrames: frameInfo.minFrames,
        gifSizeBytes,
      };
    } catch (error) {
      return {
        phase: run.phase,
        config: run.config,
        transferTimeMs: 0,
        throughputKBps: 0,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      // Always revoke the blob URL, even on timeout/pause/error. Otherwise
      // the encoded GIF stays in memory for every failed run and the tab
      // balloons into hundreds of MB after a long session.
      if (pendingGifUrl) {
        URL.revokeObjectURL(pendingGifUrl);
      }
    }
  }, [encodeConfig, waitForScanComplete]);

  const runBatch = useCallback(async (
    startIndex: number,
    runs: BenchmarkRunDefinition[],
    testPayload: Uint8Array,
    filename: string,
    payloadSizeBytes: number,
    results: BenchmarkResult[],
  ): Promise<number> => {
    let nextIndex = startIndex;

    for (const run of runs) {
      if (!runningRef.current) {
        break;
      }

      const result = await runSingle(nextIndex, run, testPayload, filename, payloadSizeBytes);
      if (!runningRef.current && !result.success && result.error === 'paused') {
        break;
      }
      results.push(result);
      nextIndex += 1;

      setState((prev) => ({
        ...prev,
        currentIndex: nextIndex,
        results: [...results],
      }));

      // Persist progress every 10 runs instead of every run. With very
      // long sessions (thousands of results) serializing the full session
      // to localStorage on every iteration dominates main-thread time.
      // executeRuns() still forces a final save at the end of the batch.
      if (sessionRef.current && nextIndex % 10 === 0) {
        sessionRef.current.results = [...results];
        updateBenchmarkSession(sessionRef.current);
      }
    }

    return nextIndex;
  }, [runSingle]);

  /** Core run logic shared by start/resume/retry */
  const executeRuns = useCallback(async (
    mode: BenchmarkMode,
    profile: BenchmarkProfile,
    runs: BenchmarkRunDefinition[],
    existingResults: BenchmarkResult[],
    sessionId: string,
  ) => {
    runningRef.current = true;
    const { data, filename } = generateTestPayload(profile.payloadSizeBytes);
    const results: BenchmarkResult[] = [...existingResults];

    // Create/update session as in-progress
    const session: BenchmarkSession = {
      id: sessionId,
      date: new Date().toISOString(),
      mode,
      profile,
      results: [...results],
      payloadSize: profile.payloadSizeBytes,
      completed: false,
    };
    sessionRef.current = session;
    updateBenchmarkSession(session);

    setState({
      phase: 'encoding',
      currentIndex: existingResults.length,
      totalRuns: existingResults.length + runs.length,
      results: [...results],
      currentRun: runs[0] ?? null,
      gifUrl: null,
      gifFrameInfo: null,
      encodeProgress: 0,
      displayStartTime: 0,
    });

    let nextIndex = await runBatch(
      existingResults.length,
      runs,
      data,
      filename,
      profile.payloadSizeBytes,
      results,
    );

    // Smart mode follow-up: phase3 after phase1
    if (runningRef.current && mode === 'full') {
      const phase1Results = results.filter((r) => r.phase === 'phase1');
      const topConfigs = selectTopConfigs(phase1Results, profile.topCandidateCount);
      const followupRuns = buildPhase3Matrix(profile, topConfigs);

      setState((prev) => ({
        ...prev,
        totalRuns: existingResults.length + runs.length + followupRuns.length,
      }));

      nextIndex = await runBatch(
        nextIndex,
        followupRuns,
        data,
        filename,
        profile.payloadSizeBytes,
        results,
      );
    }

    const completed = runningRef.current; // true if we finished, false if paused
    session.results = [...results];
    session.completed = completed;
    updateBenchmarkSession(session);

    setState((prev) => ({
      ...prev,
      phase: 'done',
      currentIndex: nextIndex,
      currentRun: null,
      gifUrl: null,
      gifFrameInfo: null,
      results: [...results],
    }));
    runningRef.current = false;
    sessionRef.current = null;
  }, [runBatch]);

  /** Start a fresh benchmark */
  const start = useCallback(async (
    mode: BenchmarkMode,
    profileOverrides?: Partial<BenchmarkProfile>,
  ) => {
    if (runningRef.current) return;
    const profile = createBenchmarkProfile(profileOverrides);
    const runs = buildAllRuns(mode, profile);
    await executeRuns(mode, profile, runs, [], Date.now().toString());
  }, [executeRuns]);

  /** Pause the current run (saves progress) */
  const pause = useCallback(() => {
    runningRef.current = false;
    if (pendingRejectRef.current) {
      pendingRejectRef.current(new Error('paused'));
    } else {
      cleanup();
    }
    // State transitions to 'done' via executeRuns when the loop breaks
  }, [cleanup]);

  /** Resume an incomplete session */
  const resume = useCallback(async (session: BenchmarkSession) => {
    if (runningRef.current) return;
    const profile = createBenchmarkProfile(session.profile);

    // Rebuild full run list and remove already-completed ones
    let allRuns: BenchmarkRunDefinition[];
    if (session.mode === 'full') {
      // For smart mode, check if we already have phase3 results
      const hasPhase3 = session.results.some((r) => r.phase === 'phase3');
      if (hasPhase3) {
        // Phase1 is done, rebuild phase3 remaining
        const topConfigs = selectTopConfigs(
          session.results.filter((r) => r.phase === 'phase1'),
          profile.topCandidateCount,
        );
        allRuns = [
          ...buildPhase1Matrix(profile).map((r) => ({ ...r })),
          ...buildPhase3Matrix(profile, topConfigs),
        ];
      } else {
        // Still in phase1; phase3 will be added dynamically by executeRuns
        allRuns = buildPhase1Matrix(profile);
      }
    } else {
      allRuns = buildAllRuns(session.mode, profile);
    }

    // Filter out configs already completed successfully
    const doneKeys = new Set(
      session.results
        .filter((r) => r.success)
        .map((r) => fingerprintConfig(r.config)),
    );
    const remaining = allRuns.filter((run) => !doneKeys.has(fingerprintConfig(run.config)));

    // Keep only successful results from the previous run
    const keptResults = session.results.filter((r) => r.success);

    await executeRuns(session.mode, profile, remaining, keptResults, session.id);
  }, [executeRuns]);

  /** Retry only the failed/errored runs from a session */
  const retryErrors = useCallback(async (session: BenchmarkSession) => {
    if (runningRef.current) return;
    const profile = createBenchmarkProfile(session.profile);

    const failedRuns: BenchmarkRunDefinition[] = session.results
      .filter((r) => !r.success)
      .map((r) => ({ phase: r.phase, config: r.config }));

    if (failedRuns.length === 0) return;

    // Keep successful results
    const keptResults = session.results.filter((r) => r.success);

    await executeRuns(session.mode, profile, failedRuns, keptResults, session.id);
  }, [executeRuns]);

  return {
    state,
    start,
    pause,
    resume,
    retryErrors,
    labelForConfig,
  };
}
