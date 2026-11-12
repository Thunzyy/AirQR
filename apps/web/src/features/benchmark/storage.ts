import { createBenchmarkProfile } from './matrix';
import type { BenchmarkConfig, BenchmarkResult, BenchmarkSession } from './types';

const STORAGE_KEY = 'airqr_benchmark_sessions';
const MAX_SESSIONS = 20;

function normalizeConfig(config: Partial<BenchmarkConfig> | undefined): BenchmarkConfig {
  const profile = createBenchmarkProfile();
  return {
    fps: Math.max(1, Math.round(config?.fps ?? 10)),
    packetSize: Math.max(4, Math.round(config?.packetSize ?? 800)),
    ecc: config?.ecc ?? 'MEDIUM',
    targetSize: Math.max(50, Math.round(config?.targetSize ?? profile.phase1TargetSize)),
    raptorqOverhead: Number((config?.raptorqOverhead ?? profile.phase1Overhead).toFixed(2)),
    compressionEnabled: config?.compressionEnabled ?? false,
  };
}

function normalizeResult(result: Partial<BenchmarkResult>): BenchmarkResult {
  return {
    phase: result.phase ?? 'phase1',
    config: normalizeConfig(result.config),
    transferTimeMs: result.transferTimeMs ?? 0,
    throughputKBps: result.throughputKBps ?? 0,
    success: result.success ?? false,
    error: result.error,
    totalFrames: result.totalFrames,
    minFrames: result.minFrames,
    gifSizeBytes: result.gifSizeBytes,
  };
}

function normalizeSession(session: Partial<BenchmarkSession>): BenchmarkSession {
  const mode = session.mode === 'quick' ? 'quick' : session.mode === 'exhaustive' ? 'exhaustive' : 'full';

  return {
    id: session.id ?? Date.now().toString(),
    date: session.date ?? new Date().toISOString(),
    mode,
    profile: createBenchmarkProfile(session.profile),
    results: Array.isArray(session.results)
      ? session.results.map((result) => normalizeResult(result))
      : [],
    payloadSize: session.payloadSize ?? session.profile?.payloadSizeBytes ?? createBenchmarkProfile().payloadSizeBytes,
    completed: session.completed ?? true,
  };
}

export function loadBenchmarkSessions(): BenchmarkSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.map((session) => normalizeSession(session))
      : [];
  } catch {
    return [];
  }
}

export function saveBenchmarkSession(session: BenchmarkSession): void {
  const sessions = loadBenchmarkSessions();
  sessions.unshift(session);
  if (sessions.length > MAX_SESSIONS) sessions.length = MAX_SESSIONS;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

export function updateBenchmarkSession(session: BenchmarkSession): void {
  const sessions = loadBenchmarkSessions();
  const index = sessions.findIndex(s => s.id === session.id);
  if (index >= 0) {
    sessions[index] = session;
  } else {
    sessions.unshift(session);
  }
  if (sessions.length > MAX_SESSIONS) sessions.length = MAX_SESSIONS;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

export function deleteBenchmarkSession(id: string): void {
  const sessions = loadBenchmarkSessions().filter(s => s.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

export function clearBenchmarkSessions(): void {
  localStorage.removeItem(STORAGE_KEY);
}
