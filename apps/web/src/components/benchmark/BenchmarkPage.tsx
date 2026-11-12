import React, { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { useBenchmarkRunner } from '../../features/benchmark/useBenchmarkRunner';
import {
  buildSteppedRange,
  computeRemainingRunCount,
  createBenchmarkProfile,
  DEFAULT_BENCHMARK_PROFILE,
  estimateBenchmarkRunCount,
  formatNumberList,
  labelForConfig,
} from '../../features/benchmark/matrix';
import type { BenchmarkConfig, BenchmarkMode, BenchmarkProfile, BenchmarkResult, BenchmarkSession } from '../../features/benchmark/types';
import { computeRecommendations } from '../../features/benchmark/recommend';
import {
  loadBenchmarkSessions,
  deleteBenchmarkSession,
  clearBenchmarkSessions,
} from '../../features/benchmark/storage';
import { getWebSocketSyncService } from '../../services/websocketSyncService';
import { useEncoderStore, useSettingsStore } from '../../store';
import GifPlayer from '../media/GifPlayer';
import { Icon } from '../ui';

// --- Hooks ---

function useWsConnectionStatus(intervalMs = 1000) {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const check = () => setConnected(getWebSocketSyncService().getState() === 'connected');
    check();
    const id = setInterval(check, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return connected;
}

function parseNumberList(raw: string): number[] {
  return raw
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((value) => Number.isFinite(value));
}

function toggleValue<T extends string | boolean>(values: T[], value: T): T[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value];
}

function formatDurationEstimate(runCount: number): string {
  const totalMinutes = Math.max(1, Math.round((runCount * 18) / 60));
  if (totalMinutes < 60) {
    return `~${totalMinutes} min`;
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `~${hours}h` : `~${hours}h${minutes}`;
}

function downloadTextFile(filename: string, mimeType: string, content: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function buildSessionCsv(session: BenchmarkSession): string {
  const header = [
    'phase',
    'fps',
    'packetSize',
    'ecc',
    'targetSize',
    'raptorqOverhead',
    'compressionEnabled',
    'totalFrames',
    'minFrames',
    'gifSizeBytes',
    'transferTimeMs',
    'throughputKBps',
    'success',
    'error',
  ];

  const rows = session.results.map((result) => [
    result.phase,
    result.config.fps,
    result.config.packetSize,
    result.config.ecc,
    result.config.targetSize,
    result.config.raptorqOverhead.toFixed(2),
    result.config.compressionEnabled ? 'true' : 'false',
    result.totalFrames ?? '',
    result.minFrames ?? '',
    result.gifSizeBytes ?? '',
    result.transferTimeMs,
    result.throughputKBps.toFixed(2),
    result.success ? 'true' : 'false',
    JSON.stringify(result.error ?? ''),
  ]);

  return [header, ...rows].map((row) => row.join(',')).join('\n');
}

// --- Shared sub-components ---

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

const ResultRow = React.memo(function ResultRow({ result, index, payloadSize }: { result: BenchmarkResult; index: number; payloadSize: number }) {
  const expansion = result.gifSizeBytes && payloadSize > 0
    ? ((result.gifSizeBytes / payloadSize) * 100).toFixed(0)
    : null;

  return (
    <tr className={index % 2 === 0 ? 'bg-white/5' : ''}>
      <td className="px-3 py-2 text-sm font-mono">{labelForConfig(result.config)}</td>
      <td className="px-3 py-2 text-sm text-right tabular-nums">
        {result.totalFrames != null ? (
          <span>
            {result.totalFrames}
            {result.minFrames != null && <span className="text-[10px] text-white/35 ml-1">({result.minFrames} min)</span>}
          </span>
        ) : '--'}
      </td>
      <td className="px-3 py-2 text-sm text-right tabular-nums">
        {result.gifSizeBytes != null ? (
          <span>
            {formatSize(result.gifSizeBytes)}
            {expansion && <span className="text-[10px] text-white/35 ml-1">({expansion}%)</span>}
          </span>
        ) : '--'}
      </td>
      <td className="px-3 py-2 text-sm text-right tabular-nums">
        {result.success ? `${(result.transferTimeMs / 1000).toFixed(2)}s` : '--'}
      </td>
      <td className="px-3 py-2 text-sm text-right font-semibold tabular-nums">
        {result.success ? `${result.throughputKBps.toFixed(1)} KB/s` : (
          <span className="text-red-500 text-xs">{result.error || 'fail'}</span>
        )}
      </td>
    </tr>
  );
});

const DEFAULT_MAX_VISIBLE_ROWS = 100;

function ResultsTable({
  results,
  payloadSize,
  maxVisibleRows = DEFAULT_MAX_VISIBLE_ROWS,
}: {
  results: BenchmarkResult[];
  payloadSize: number;
  maxVisibleRows?: number;
}) {
  if (results.length === 0) return null;
  const totalCount = results.length;
  const hidden = totalCount - maxVisibleRows;
  const visible = hidden > 0 ? results.slice(-maxVisibleRows) : results;
  const startIndex = hidden > 0 ? hidden : 0;

  return (
    <div className="overflow-x-auto">
      {hidden > 0 && (
        <div className="px-3 py-1.5 text-[11px] text-white/40 bg-white/5 rounded-t border-b border-white/10">
          Showing last {maxVisibleRows} of {totalCount} runs &middot;{' '}
          <span className="text-white/35">{hidden} earlier hidden (still counted / exported)</span>
        </div>
      )}
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-white/10">
            <th className="px-3 py-2 text-xs font-semibold text-white/40 uppercase">Config</th>
            <th className="px-3 py-2 text-xs font-semibold text-white/40 uppercase text-right">Frames</th>
            <th className="px-3 py-2 text-xs font-semibold text-white/40 uppercase text-right">GIF size</th>
            <th className="px-3 py-2 text-xs font-semibold text-white/40 uppercase text-right">Time</th>
            <th className="px-3 py-2 text-xs font-semibold text-white/40 uppercase text-right">Throughput</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r, i) => (
            <ResultRow key={startIndex + i} result={r} index={startIndex + i} payloadSize={payloadSize} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- GIF viewer ---

function BenchmarkGifViewer({ gifUrl, totalFrames, minFrames }: {
  gifUrl: string; totalFrames: number; minFrames: number;
}) {
  const [frame, setFrame] = useState(0);
  const [loadedInfo, setLoadedInfo] = useState<{ totalFrames: number; width: number; height: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const displayTotal = loadedInfo?.totalFrames ?? totalFrames;

  // Compute scale so the GIF fits within the container
  const [fitScale, setFitScale] = useState(1);
  useEffect(() => {
    if (!loadedInfo || !containerRef.current) return;
    const containerWidth = containerRef.current.clientWidth - 32; // padding
    const containerHeight = containerRef.current.clientHeight - 32;
    const scaleX = containerWidth / loadedInfo.width;
    const scaleY = containerHeight / loadedInfo.height;
    setFitScale(Math.min(scaleX, scaleY, 10));
  }, [loadedInfo, gifUrl]);

  return (
    <div className="relative rounded-full overflow-hidden bg-black/40">
      <div ref={containerRef} className="flex items-center justify-center p-4 h-[60vh] min-h-[350px] max-h-[600px]">
        <GifPlayer gifUrl={gifUrl} scale={fitScale} onFrameChange={setFrame}
          onLoad={(d) => setLoadedInfo({ totalFrames: d.totalFrames, width: d.width, height: d.height })} className="shadow-2xl image-pixelated" />
      </div>
      {displayTotal > 0 && (
        <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md text-white text-xs px-3 py-1.5 rounded-full border border-white/10 shadow-lg font-mono">
          {frame + 1} / {displayTotal}
          {minFrames > 0 && <span className="ml-2 text-white/60 text-[10px]">(Min Required: {minFrames})</span>}
        </div>
      )}
    </div>
  );
}

// --- Recommendation panel ---

function RecommendationPanel({ sessions, onApply }: {
  sessions: BenchmarkSession[];
  onApply: (config: BenchmarkConfig) => void;
}) {
  const recs = useMemo(() => computeRecommendations(sessions), [sessions]);
  const top3 = recs.slice(0, 3);

  if (top3.length === 0) return null;

  const best = top3[0];

  return (
    <div className="bg-gradient-to-br from-emerald-400/10 to-[#334CFF]/10 rounded-[24px] border border-emerald-300/20 p-4">
      <div className="flex items-center gap-2 mb-3">
        <Icon name="star" className="text-lg text-amber-500" />
        <h3 className="text-sm font-bold text-white">Recommended settings</h3>
        <span className="text-[10px] text-white/40 ml-auto">
          Based on {sessions.length} session{sessions.length > 1 ? 's' : ''}
        </span>
      </div>

      <div className="space-y-2">
        {top3.map((rec, i) => (
          <div key={i} className={`flex items-center gap-3 p-2.5 rounded-full ${
            i === 0
              ? 'bg-white/10 border border-emerald-300/30'
              : 'bg-white/5'
          }`}>
            <span className={`text-sm font-bold w-5 text-center ${
              i === 0 ? 'text-amber-500' : 'text-white/35'
            }`}>
              {i + 1}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-mono font-semibold text-white truncate">
                {rec.label}
              </div>
              <div className="text-[11px] text-white/40">
                Median: {rec.medianKBps.toFixed(1)} KB/s &middot; Best: {rec.bestKBps.toFixed(1)} KB/s
                &middot; {rec.sampleCount} run{rec.sampleCount > 1 ? 's' : ''}
              </div>
            </div>
            {i === 0 && (
              <button
                onClick={() => onApply(rec.config)}
                className="px-3 py-1.5 rounded-full bg-green-600 text-white text-xs font-bold whitespace-nowrap hover:bg-green-700 transition-colors"
              >
                Apply
              </button>
            )}
          </div>
        ))}
      </div>

      {best && (
        <p className="text-[11px] text-emerald-200 mt-3">
          Best median currently: <strong>{best.label}</strong>
        </p>
      )}
    </div>
  );
}

// --- History section ---

function ResumeBanner({
  resumableSession,
  resumableRemainingCount,
  errorSession,
  onResume,
  onRetryErrors,
}: {
  resumableSession: BenchmarkSession | null;
  resumableRemainingCount: number;
  errorSession: BenchmarkSession | null;
  onResume: (session: BenchmarkSession) => void;
  onRetryErrors: (session: BenchmarkSession) => void;
}) {
  if (resumableSession) {
    const successful = resumableSession.results.filter((r) => r.success).length;
    const total = successful + resumableRemainingCount;
    const date = new Date(resumableSession.date);
    const isPaused = !resumableSession.completed;
    return (
      <div className="p-4 bg-amber-400/10 rounded-[24px] border border-amber-300/20 flex items-center gap-3">
        <Icon name={isPaused ? 'pause_circle' : 'pending'} className="text-2xl text-amber-300" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-amber-100">
            {isPaused ? 'Benchmark en pause' : 'Benchmark partiel'} — {resumableRemainingCount} run{resumableRemainingCount > 1 ? 's' : ''} restant{resumableRemainingCount > 1 ? 's' : ''}
          </div>
          <div className="text-[11px] text-amber-200/70 truncate">
            {resumableSession.mode.toUpperCase()} &middot; {successful}/{total} done &middot;{' '}
            {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
        <button
          onClick={() => onResume(resumableSession)}
          className="px-3 py-2 rounded-full bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold flex items-center gap-1.5"
        >
          <Icon name="play_arrow" className="text-base" />
          Continue
        </button>
      </div>
    );
  }

  if (errorSession) {
    const failed = errorSession.results.filter((r) => !r.success).length;
    const date = new Date(errorSession.date);
    return (
      <div className="p-4 bg-red-500/10 rounded-[24px] border border-red-300/20 flex items-center gap-3">
        <Icon name="error_outline" className="text-2xl text-red-300" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-red-100">
            {failed} run{failed > 1 ? 's' : ''} en erreur / timeout
          </div>
          <div className="text-[11px] text-red-200/80 truncate">
            {errorSession.mode.toUpperCase()} &middot;{' '}
            {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        </div>
        <button
          onClick={() => onRetryErrors(errorSession)}
          className="px-3 py-2 rounded-full bg-red-500 hover:bg-red-600 text-white text-xs font-bold flex items-center gap-1.5"
        >
          <Icon name="replay" className="text-base" />
          Retry errors
        </button>
      </div>
    );
  }

  return null;
}

function HistorySection({ sessions, onDelete, onClearAll, onResume, onRetryErrors }: {
  sessions: BenchmarkSession[];
  onDelete: (id: string) => void;
  onClearAll: () => void;
  onResume: (session: BenchmarkSession) => void;
  onRetryErrors: (session: BenchmarkSession) => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (sessions.length === 0) {
    return (
      <div className="text-center py-8 text-white/35 text-sm">
        No benchmark sessions yet. Run one to see results here.
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-white/40">
          {sessions.length} session{sessions.length > 1 ? 's' : ''}
        </span>
        <button onClick={onClearAll} className="text-[11px] text-red-500 hover:text-red-700 font-semibold">
          Clear all
        </button>
      </div>

      <div className="space-y-2">
        {sessions.map((session) => {
          const successful = session.results.filter(r => r.success);
          const failed = session.results.filter(r => !r.success);
          const remaining = computeRemainingRunCount(session);
          const best = successful.length > 0
            ? successful.reduce((a, b) => a.throughputKBps > b.throughputKBps ? a : b)
            : null;
          const date = new Date(session.date);
          const isExpanded = expandedId === session.id;

          return (
            <div key={session.id}
              className={`bg-[#15161d]/92 rounded-[24px] border overflow-hidden ${
                session.completed
                  ? 'border-white/10'
                  : 'border-amber-300/30'
              }`}>
              <div className="w-full px-4 py-3 flex items-center gap-3">
                <button
                  onClick={() => setExpandedId(isExpanded ? null : session.id)}
                  className="flex-1 min-w-0 text-left"
                >
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    {!session.completed && (
                      <span className="text-[10px] font-bold text-amber-300 bg-amber-400/10 px-1.5 py-0.5 rounded">PAUSED</span>
                    )}
                    {session.completed && remaining > 0 && (
                      <span className="text-[10px] font-bold text-amber-300 bg-amber-400/10 px-1.5 py-0.5 rounded">PARTIAL</span>
                    )}
                    {session.completed && failed.length > 0 && (
                      <span className="text-[10px] font-bold text-red-200 bg-red-500/10 px-1.5 py-0.5 rounded-full">{failed.length} ERRORS</span>
                    )}
                  </div>
                  <div className="text-xs text-white/40 mt-0.5">
                    {session.mode.toUpperCase()} &middot; {successful.length}/{session.results.length} successful
                    {best && (
                      <span className="ml-2 text-emerald-300 font-semibold">
                        Best: {best.throughputKBps.toFixed(1)} KB/s &middot; {labelForConfig(best.config)}
                      </span>
                    )}
                  </div>
                </button>
                {remaining > 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onResume(session); }}
                    className="px-2.5 py-1.5 rounded-full bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold flex items-center gap-1 shrink-0"
                    title={`${remaining} run(s) missing from this session's matrix`}
                  >
                    <Icon name="play_arrow" className="text-sm" />
                    {session.completed ? 'Continue' : 'Resume'} ({remaining})
                  </button>
                )}
                {failed.length > 0 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onRetryErrors(session); }}
                    className="px-2.5 py-1.5 rounded-full bg-red-500 hover:bg-red-600 text-white text-[11px] font-bold flex items-center gap-1 shrink-0"
                  >
                    <Icon name="replay" className="text-sm" />
                    Retry {failed.length}
                  </button>
                )}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : session.id)}
                  className="shrink-0 p-1"
                  aria-label={isExpanded ? 'Collapse' : 'Expand'}
                >
                  <Icon name={isExpanded ? 'expand_less' : 'expand_more'} className="text-white/35" />
                </button>
              </div>

              {isExpanded && (
                <div className="px-4 pb-3 border-t border-white/10">
                  <div className="flex flex-wrap gap-2 py-3">
                    <button
                      onClick={() => downloadTextFile(`benchmark-${session.id}.csv`, 'text/csv;charset=utf-8', buildSessionCsv(session))}
                      className="px-3 py-1.5 rounded-full bg-white/10 text-white text-xs font-semibold hover:bg-white/15"
                    >
                      Export CSV
                    </button>
                    <button
                      onClick={() => downloadTextFile(`benchmark-${session.id}.json`, 'application/json;charset=utf-8', JSON.stringify(session, null, 2))}
                      className="px-3 py-1.5 rounded-full bg-white/10 text-white text-xs font-semibold hover:bg-white/15"
                    >
                      Export JSON
                    </button>
                  </div>
                  <ResultsTable results={session.results} payloadSize={session.payloadSize} />
                  <div className="mt-3 flex justify-end">
                    <button onClick={() => onDelete(session.id)}
                      className="text-xs text-red-500 hover:text-red-700 font-semibold flex items-center gap-1">
                      <Icon name="delete" className="text-sm" />
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// --- Main page ---

function BenchmarkControls({
  profile,
  onProfileChange,
}: {
  profile: BenchmarkProfile;
  onProfileChange: (next: BenchmarkProfile) => void;
}) {
  const [fpsMinInput, setFpsMinInput] = useState(String(profile.fpsValues[0] ?? 1));
  const [maxFpsInput, setMaxFpsInput] = useState(String(profile.maxFps));
  const [fpsStepInput, setFpsStepInput] = useState(String(profile.fpsStep));
  const [packetMinInput, setPacketMinInput] = useState(String(profile.packetSizes[0] ?? 100));
  const [packetMaxInput, setPacketMaxInput] = useState(String(profile.packetSizes.at(-1) ?? 2800));
  const [packetStepInput, setPacketStepInput] = useState(String(profile.packetSizeStep));
  const [overheadInput, setOverheadInput] = useState(formatNumberList(profile.overheadValues));
  const [payloadKbInput, setPayloadKbInput] = useState(String(Math.round(profile.payloadSizeBytes / 1024)));
  const [topCandidateInput, setTopCandidateInput] = useState(String(profile.topCandidateCount));

  const syncInputsFromProfile = (p: BenchmarkProfile) => {
    setFpsMinInput(String(p.fpsValues[0] ?? 1));
    setMaxFpsInput(String(p.maxFps));
    setFpsStepInput(String(p.fpsStep));
    setPacketMinInput(String(p.packetSizes[0] ?? 100));
    setPacketMaxInput(String(p.packetSizes.at(-1) ?? 2800));
    setPacketStepInput(String(p.packetSizeStep));
    setOverheadInput(formatNumberList(p.overheadValues));
    setPayloadKbInput(String(Math.round(p.payloadSizeBytes / 1024)));
    setTopCandidateInput(String(p.topCandidateCount));
  };

  const handleReset = () => {
    const next = createBenchmarkProfile(DEFAULT_BENCHMARK_PROFILE);
    onProfileChange(next);
    syncInputsFromProfile(next);
  };

  const commitProfile = (patch: Partial<BenchmarkProfile>) => {
    onProfileChange(createBenchmarkProfile({ ...profile, ...patch }));
  };

  const commitFpsSweep = () => {
    const minFps = Number(fpsMinInput);
    const maxFps = Number(maxFpsInput);
    const fpsStep = Number(fpsStepInput);
    if (!Number.isFinite(minFps) || !Number.isFinite(maxFps) || !Number.isFinite(fpsStep) || minFps <= 0 || maxFps <= 0 || fpsStep <= 0 || minFps > maxFps) {
      return;
    }
    commitProfile({ maxFps, fpsStep, fpsValues: buildSteppedRange(minFps, maxFps, fpsStep) });
  };

  const commitManagedRange = ({
    minRaw,
    maxRaw,
    stepRaw,
    valuesKey,
    afterBuild,
  }: {
    minRaw: string;
    maxRaw: string;
    stepRaw: string;
    valuesKey: 'packetSizes' | 'targetSizes';
    stepKey: 'packetSizeStep' | 'targetSizeStep';
    afterBuild?: (values: number[]) => Partial<BenchmarkProfile>;
  }) => {
    const nextMin = Number(minRaw);
    const nextMax = Number(maxRaw);
    const nextStep = Number(stepRaw);
    if (
      !Number.isFinite(nextMin) ||
      !Number.isFinite(nextMax) ||
      !Number.isFinite(nextStep) ||
      nextMin > nextMax ||
      nextStep <= 0
    ) {
      return;
    }

    const values = buildSteppedRange(nextMin, nextMax, nextStep);
    const patch: Partial<BenchmarkProfile> =
      valuesKey === 'packetSizes'
        ? { packetSizes: values, packetSizeStep: nextStep }
        : { targetSizes: values, targetSizeStep: nextStep };

    commitProfile({
      ...patch,
      ...afterBuild?.(values),
    });
  };

  const inputClass = "w-full rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm";
  const labelClass = "text-[11px] font-medium text-white/40";
  const chipActive = "border-[#7C8DFF]/50 bg-[#4C63FF]/10 text-[#7C8DFF]";
  const chipInactive = "border-white/10 text-white/40";

  return (
    <div className="p-4 rounded-[24px] border border-white/10 bg-[#15161d]/92 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-white">Benchmark parameters</h2>
        <button
          onClick={handleReset}
          className="px-3 py-1.5 rounded-full bg-white/10 text-xs font-semibold text-white hover:bg-white/15 whitespace-nowrap"
        >
          Reset defaults
        </button>
      </div>

      {/* Row 1: Payload + Top configs */}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="space-y-1">
          <span className={labelClass}>Payload size (KB)</span>
          <p className="text-[10px] text-white/35">Dummy data sent per run.</p>
          <input aria-label="Payload size (KB)" type="number" min={1} max={51200}
            value={payloadKbInput}
            onChange={(event) => setPayloadKbInput(event.target.value)}
            onBlur={() => {
              const v = Number(payloadKbInput);
              if (Number.isFinite(v) && v > 0) commitProfile({ payloadSizeBytes: v * 1024 });
            }}
            className={inputClass}
          />
        </label>
        <label className="space-y-1">
          <span className={labelClass}>Top configs carried forward</span>
          <p className="text-[10px] text-white/35">Best results kept between sweep rounds.</p>
          <input aria-label="Top configs per follow-up phase" type="number" min={1} max={20}
            value={topCandidateInput}
            onChange={(event) => setTopCandidateInput(event.target.value)}
            onBlur={() => {
              const v = Number(topCandidateInput);
              if (Number.isFinite(v) && v >= 1) commitProfile({ topCandidateCount: v });
            }}
            className={inputClass}
          />
        </label>
      </div>

      {/* Divider */}
      <hr className="border-white/10" />

      {/* Row 2: FPS range */}
      <div>
        <div className="flex items-baseline gap-2 mb-1">
          <span className={labelClass}>Frame rate (FPS)</span>
          <span className="text-[10px] text-white/35">QR frames per second displayed to the scanner.</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <label className="space-y-0.5">
            <span className="text-[10px] text-white/35">Min</span>
            <input aria-label="FPS min" type="number" min={1} max={240}
              value={fpsMinInput}
              onChange={(event) => setFpsMinInput(event.target.value)}
              onBlur={commitFpsSweep}
              className={inputClass}
            />
          </label>
          <label className="space-y-0.5">
            <span className="text-[10px] text-white/35">Max</span>
            <input aria-label="FPS max" type="number" min={1} max={240}
              value={maxFpsInput}
              onChange={(event) => setMaxFpsInput(event.target.value)}
              onBlur={commitFpsSweep}
              className={inputClass}
            />
          </label>
          <label className="space-y-0.5">
            <span className="text-[10px] text-white/35">Step</span>
            <input aria-label="FPS step" type="number" min={1} max={240}
              value={fpsStepInput}
              onChange={(event) => setFpsStepInput(event.target.value)}
              onBlur={commitFpsSweep}
              className={inputClass}
            />
          </label>
        </div>
        <p className="text-[10px] text-white/35 font-mono mt-1">
          {profile.fpsValues.length} values: {profile.fpsValues[0]} → {profile.fpsValues.at(-1)} fps
        </p>
      </div>

      {/* Row 3: Packet size range */}
      <div>
        <div className="flex items-baseline gap-2 mb-1">
          <span className={labelClass}>Packet size (bytes)</span>
          <span className="text-[10px] text-white/35">Data per QR frame. Larger = fewer frames, bigger QR.</span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <label className="space-y-0.5">
            <span className="text-[10px] text-white/35">Min</span>
            <input aria-label="Packet size min" type="number" min={1}
              value={packetMinInput}
              onChange={(event) => setPacketMinInput(event.target.value)}
              onBlur={() => commitManagedRange({
                minRaw: packetMinInput, maxRaw: packetMaxInput, stepRaw: packetStepInput,
                valuesKey: 'packetSizes', stepKey: 'packetSizeStep',
              })}
              className={inputClass}
            />
          </label>
          <label className="space-y-0.5">
            <span className="text-[10px] text-white/35">Max</span>
            <input aria-label="Packet size max" type="number" min={1}
              value={packetMaxInput}
              onChange={(event) => setPacketMaxInput(event.target.value)}
              onBlur={() => commitManagedRange({
                minRaw: packetMinInput, maxRaw: packetMaxInput, stepRaw: packetStepInput,
                valuesKey: 'packetSizes', stepKey: 'packetSizeStep',
              })}
              className={inputClass}
            />
          </label>
          <label className="space-y-0.5">
            <span className="text-[10px] text-white/35">Step</span>
            <input aria-label="Packet size step" type="number" min={1}
              value={packetStepInput}
              onChange={(event) => setPacketStepInput(event.target.value)}
              onBlur={() => commitManagedRange({
                minRaw: packetMinInput, maxRaw: packetMaxInput, stepRaw: packetStepInput,
                valuesKey: 'packetSizes', stepKey: 'packetSizeStep',
              })}
              className={inputClass}
            />
          </label>
        </div>
        <p className="text-[10px] text-white/35 font-mono mt-1">
          {profile.packetSizes.length} values: {profile.packetSizes[0]}B → {profile.packetSizes.at(-1)}B
        </p>
      </div>

      {/* Row 4: Overhead */}
      <div>
        <div className="flex items-baseline gap-2 mb-1">
          <span className={labelClass}>RaptorQ overhead</span>
          <span className="text-[10px] text-white/35">Extra packets multiplier (1.0 = minimum, 2.0 = double). Comma-separated.</span>
        </div>
        <input aria-label="Overhead values"
          value={overheadInput}
          onChange={(event) => setOverheadInput(event.target.value)}
          onBlur={() => {
            const values = parseNumberList(overheadInput);
            if (values.length > 0) {
              commitProfile({ overheadValues: values });
              setOverheadInput(formatNumberList(values));
            } else {
              setOverheadInput(formatNumberList(profile.overheadValues));
            }
          }}
          className={`${inputClass} font-mono`}
        />
      </div>

      {/* Divider */}
      <hr className="border-white/10" />

      {/* Row 6: ECC + Compression side by side */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className={labelClass}>Error Correction (ECC)</span>
            <span className="text-[10px] text-white/35">Higher = resilient, less data.</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {(['LOW', 'MEDIUM', 'QUARTILE', 'HIGH'] as const).map((ecc) => (
              <label key={ecc} className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold cursor-pointer transition-colors ${
                profile.eccValues.includes(ecc) ? chipActive : chipInactive
              }`}>
                <input type="checkbox" checked={profile.eccValues.includes(ecc)}
                  onChange={() => {
                    const next = toggleValue(profile.eccValues, ecc);
                    if (next.length > 0) commitProfile({ eccValues: next });
                  }}
                  className="sr-only"
                />
                <span className={`w-3 h-3 rounded border-2 flex items-center justify-center ${
                  profile.eccValues.includes(ecc) ? 'border-white bg-white text-black' : 'border-white/20'
                }`}>
                  {profile.eccValues.includes(ecc) && <span className="text-white text-[8px]">&#10003;</span>}
                </span>
                {ecc}
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className="flex items-baseline gap-2 mb-2">
            <span className={labelClass}>Compression</span>
            <span className="text-[10px] text-white/35">zstd before encoding.</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {([
              { label: 'Raw', value: false },
              { label: 'Deflate (zstd)', value: true },
            ] as const).map((option) => (
              <label key={option.label} className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-semibold cursor-pointer transition-colors ${
                profile.compressionValues.includes(option.value) ? chipActive : chipInactive
              }`}>
                <input type="checkbox" checked={profile.compressionValues.includes(option.value)}
                  onChange={() => {
                    const next = toggleValue(profile.compressionValues, option.value);
                    if (next.length > 0) commitProfile({ compressionValues: next });
                  }}
                  className="sr-only"
                />
                <span className={`w-3 h-3 rounded border-2 flex items-center justify-center ${
                  profile.compressionValues.includes(option.value) ? 'border-white bg-white text-black' : 'border-white/20'
                }`}>
                  {profile.compressionValues.includes(option.value) && <span className="text-white text-[8px]">&#10003;</span>}
                </span>
                {option.label}
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

type Tab = 'run' | 'history';

const BenchmarkPage: React.FC = () => {
  const [, navigate] = useLocation();
  const { state, start, pause, resume, retryErrors, labelForConfig: label } = useBenchmarkRunner();
  const { phase, currentIndex, totalRuns, results, currentRun, gifUrl, gifFrameInfo, encodeProgress } = state;
  const isRunning = phase !== 'idle' && phase !== 'done';
  const wsConnected = useWsConnectionStatus();
  const uploadConfig = useSettingsStore(s => s.uploadConfig);

  // Auto-connect WebSocket if sync is enabled
  useEffect(() => {
    if (uploadConfig.enabled && uploadConfig.url) {
      const ws = getWebSocketSyncService();
      if (ws.getState() !== 'connected') {
        ws.connect(uploadConfig);
      }
    }
  }, [uploadConfig]);

  const [selectedMode, setSelectedMode] = useState<BenchmarkMode>('quick');
  const [activeTab, setActiveTab] = useState<Tab>('run');
  const [profile, setProfile] = useState<BenchmarkProfile>(() => createBenchmarkProfile());
  const setConfig = useEncoderStore(s => s.setConfig);
  const [, refreshSessions] = useReducer((revision: number) => revision + 1, 0);
  // The runner phase already causes the page to render after session storage
  // changes, so reading the small bounded list directly keeps it current
  // without mirroring terminal transitions in another piece of state.
  const sessions = loadBenchmarkSessions();

  // A session is "resumable" when it has remaining matrix configs not yet
  // successfully run, regardless of whether it's been flagged completed.
  // This covers: paused sessions, sessions where the user hit Retry errors
  // before Smart mode phase3 finished, and any partial runs from crashes.
  const resumableSession = useMemo(() => {
    for (const session of sessions) {
      if (computeRemainingRunCount(session) > 0) {
        return session;
      }
    }
    return null;
  }, [sessions]);
  const resumableRemainingCount = useMemo(
    () => (resumableSession ? computeRemainingRunCount(resumableSession) : 0),
    [resumableSession],
  );
  const latestSessionWithErrors = useMemo(
    () => sessions.find((s) => s.results.some((r) => !r.success)) ?? null,
    [sessions],
  );

  const handleResume = (session: BenchmarkSession) => {
    setActiveTab('run');
    resume(session);
  };

  const handleRetryErrors = (session: BenchmarkSession) => {
    setActiveTab('run');
    retryErrors(session);
  };

  const handleDeleteSession = (id: string) => {
    deleteBenchmarkSession(id);
    refreshSessions();
  };

  const handleClearAll = () => {
    clearBenchmarkSessions();
    refreshSessions();
  };

  const modeCards = useMemo(() => ([
    {
      key: 'quick' as const,
      title: 'Quick',
      description: '10 representative combos for a fast smoke test.',
    },
    {
      key: 'full' as const,
      title: 'Smart',
      description: 'Sweeps FPS / packet / ECC, then refines overhead & compression on the best configs.',
    },
    {
      key: 'exhaustive' as const,
      title: 'Exhaustive',
      description: 'Every combination of every parameter. Complete but very long.',
    },
  ]), []);

  const handleApplyRecommendation = (config: BenchmarkConfig) => {
    setConfig(config);
    navigate('/');
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-white/10">
        <button onClick={() => navigate('/settings')}
          className="airqr-back-button !size-10 !basis-10 !shadow-none">
          <Icon name="arrow_back" className="text-[22px]" />
        </button>
        <h1 className="min-w-0 truncate text-[clamp(1.25rem,3.5vw,1.6rem)] font-extrabold leading-[1.18] text-white">QR Benchmark</h1>
        <div className="flex-1" />
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide border ${
          wsConnected
            ? 'bg-emerald-400/10 text-emerald-200 border-emerald-300/20'
            : 'bg-red-500/10 text-red-200 border-red-300/20'
        }`}>
          <span className={`w-2 h-2 rounded-full ${wsConnected ? 'bg-green-500 animate-pulse' : 'bg-red-500'}`} />
          {wsConnected ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      {/* Tabs — only when not running */}
      {!isRunning && (
        <div className="flex border-b border-white/10">
          {([['run', 'Run'], ['history', 'History']] as const).map(([key, label]) => (
            <button key={key} onClick={() => setActiveTab(key)}
              className={`flex-1 py-2.5 text-sm font-semibold text-center transition-colors ${
                activeTab === key
                  ? 'text-[#7C8DFF] border-b-2 border-[#7C8DFF]'
                  : 'text-white/40 hover:text-white'
              }`}>
              {label}
              {key === 'history' && sessions.length > 0 && (
                <span className="ml-1.5 text-[10px] bg-white/10 text-white/50 px-1.5 py-0.5 rounded-full">
                  {sessions.length}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="px-4 py-3 space-y-3">

        {/* ========== RUN TAB ========== */}
        {(activeTab === 'run' || isRunning) && (
          <>
            {/* Instructions — only when idle */}
            {phase === 'idle' && (
              <div className="p-4 bg-[#334CFF]/10 rounded-[24px] border border-[#334CFF]/20 space-y-3">
                <p className="text-sm text-[#C4CCFF] font-semibold">How it works</p>
                <ol className="text-xs text-[#9BA8FF] space-y-1 list-decimal list-inside">
                  <li>Open the scanner in benchmark mode on the phone: <code className="ml-1 px-1 py-0.5 bg-[#334CFF]/20 rounded text-[10px] select-all">/scanner?autoContinue=1</code></li>
                  <li>Keep both devices on the same sync server and wait for the green connection badge.</li>
                  <li>Review parameters, then start.</li>
                </ol>
                <a
                  href="/scanner?autoContinue=1"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center justify-center gap-2 py-2.5 px-3 rounded-full bg-[#334CFF]/20 text-[#C4CCFF] text-xs font-semibold hover:bg-[#334CFF]/30 transition-colors"
                >
                  <Icon name="open_in_new" className="text-sm" />
                  Open Scanner (benchmark mode)
                </a>
              </div>
            )}

            {/* Resume / retry banner — surfaces the most recent interrupted
                or errored session so the user never has to dig into history */}
            {!isRunning && (resumableSession || latestSessionWithErrors) && (
              <ResumeBanner
                resumableSession={resumableSession}
                resumableRemainingCount={resumableRemainingCount}
                errorSession={latestSessionWithErrors}
                onResume={handleResume}
                onRetryErrors={handleRetryErrors}
              />
            )}

            {/* Mode selector + Start */}
            {!isRunning && (
              <div className="space-y-3">
                <BenchmarkControls profile={profile} onProfileChange={setProfile} />

                <div className="grid gap-2 md:grid-cols-3">
                  {modeCards.map(({ key, title, description }) => {
                    const runCount = estimateBenchmarkRunCount(key, profile);
                    return (
                    <button key={key} onClick={() => setSelectedMode(key)}
                      className={`p-3 rounded-[24px] text-left transition-all border-2 ${
                        selectedMode === key
                          ? 'bg-[#334CFF]/20 border-[#7C8DFF]/70'
                          : 'bg-white/5 border-transparent hover:border-white/20'
                      }`}>
                      <div className={`text-sm font-bold ${selectedMode === key ? 'text-[#7C8DFF]' : 'text-white'}`}>
                        {title}
                      </div>
                      <div className="text-[11px] text-white/40 mt-0.5">
                        {runCount} runs &middot; {formatDurationEstimate(runCount)}
                      </div>
                      <div className="text-[10px] text-white/35 mt-1">{description}</div>
                    </button>
                  )})}
                </div>

                <div className="flex gap-2">
                  <button onClick={() => start(selectedMode, profile)} disabled={!wsConnected}
                    className={`flex-1 py-3 px-4 rounded-[24px] font-bold text-sm flex items-center justify-center gap-2 transition-opacity ${
                      wsConnected ? 'bg-white text-black' : 'bg-white/10 text-white/40 cursor-not-allowed'
                    }`}>
                    <Icon name="play_arrow" className="text-xl" />
                    {phase === 'done' ? 'Run again' : 'Start Benchmark'}
                  </button>
                  {resumableSession && (
                    <button
                      onClick={() => handleResume(resumableSession)}
                      disabled={!wsConnected}
                      className={`py-3 px-4 rounded-[24px] font-bold text-sm flex items-center justify-center gap-2 transition-opacity ${
                        wsConnected
                          ? 'bg-amber-500 hover:bg-amber-600 text-white'
                          : 'bg-white/10 text-white/40 cursor-not-allowed'
                      }`}
                      title={`${resumableRemainingCount} run(s) still missing from the most recent session`}
                    >
                      <Icon name="play_circle" className="text-xl" />
                      Continue ({resumableRemainingCount})
                    </button>
                  )}
                  {!resumableSession && latestSessionWithErrors && (
                    <button
                      onClick={() => handleRetryErrors(latestSessionWithErrors)}
                      disabled={!wsConnected}
                      className={`py-3 px-4 rounded-[24px] font-bold text-sm flex items-center justify-center gap-2 transition-opacity ${
                        wsConnected
                          ? 'bg-red-500 hover:bg-red-600 text-white'
                          : 'bg-white/10 text-white/40 cursor-not-allowed'
                      }`}
                      title={`Retry the ${latestSessionWithErrors.results.filter((r) => !r.success).length} failed run(s) from the last session`}
                    >
                      <Icon name="replay" className="text-xl" />
                      Retry {latestSessionWithErrors.results.filter((r) => !r.success).length}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Progress bar */}
            {isRunning && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-white/50 whitespace-nowrap">
                    Run {Math.min(currentIndex + 1, totalRuns)}/{totalRuns}
                  </span>
                  <button onClick={pause}
                    className="px-2.5 py-1 rounded-full bg-amber-500 text-white text-xs font-bold flex items-center gap-1">
                    <Icon name="pause_circle" className="text-sm" /> Pause
                  </button>
                  <span className="font-mono text-xs text-white/40 ml-auto whitespace-nowrap">
                    {currentRun ? `${currentRun.phase}: ${label(currentRun.config)}` : 'Preparing...'}
                  </span>
                </div>
                {phase === 'encoding' && (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-white/40 whitespace-nowrap">Encoding...</span>
                    <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <div className="h-full bg-[#4C63FF] rounded-full transition-all duration-200"
                        style={{ width: `${encodeProgress}%` }} />
                    </div>
                  </div>
                )}
                {phase === 'displaying' && (
                  <div className="text-[11px] text-amber-300 flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                    Waiting for scan...
                  </div>
                )}
              </div>
            )}

            {/* GIF Display */}
            {gifUrl && (
              <BenchmarkGifViewer gifUrl={gifUrl}
                totalFrames={gifFrameInfo?.totalFrames ?? 0}
                minFrames={gifFrameInfo?.minFrames ?? 0} />
            )}

            {/* Current run results */}
            <ResultsTable results={results} payloadSize={profile.payloadSizeBytes} />

            {/* Done: show best + recommendation */}
            {phase === 'done' && sessions.length > 0 && (
              <RecommendationPanel sessions={sessions} onApply={handleApplyRecommendation} />
            )}
          </>
        )}

        {/* ========== HISTORY TAB ========== */}
        {activeTab === 'history' && !isRunning && (
          <>
            {/* Recommendation at top of history */}
            {sessions.length > 0 && (
              <RecommendationPanel sessions={sessions} onApply={handleApplyRecommendation} />
            )}

            <HistorySection
              sessions={sessions}
              onDelete={handleDeleteSession}
              onClearAll={handleClearAll}
              onResume={handleResume}
              onRetryErrors={handleRetryErrors}
            />
          </>
        )}
      </div>
    </div>
  );
};

export default BenchmarkPage;
