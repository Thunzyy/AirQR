/**
 * Benchmark matrix generation inspired by
 * https://divan.dev/posts/animatedqr/
 *
 * We keep the blog-style phase 1 sweep (FPS x packet size x ECC), then add:
 * - phase 3: RaptorQ overhead + compression sweep on the best phase 1 configs
 *
 * The sweep adapts to the measured device FPS ceiling so higher-refresh
 * devices expand the matrix without changing the UI or code.
 */

import type { ECCLevel } from '../../types';
import { ENCODER_LIMITS } from '../../constants';

// QR v40 binary capacity per ECC level (bytes), minus 10-byte packet header
const QR_MAX_PAYLOAD = {
  LOW: 2953 - 10,
  MEDIUM: 2331 - 10,
  QUARTILE: 1663 - 10,
  HIGH: 1273 - 10,
} as const;

function fitsInQr(packetSize: number, ecc: ECCLevel): boolean {
  return packetSize <= QR_MAX_PAYLOAD[ecc];
}
import type {
  BenchmarkConfig,
  BenchmarkMode,
  BenchmarkProfile,
  BenchmarkResult,
  BenchmarkRunDefinition,
} from './types';

const DEFAULT_MAX_FPS = 30;
const RANGE_STEP = 25;
const FPS_STEP = 1;
const DEFAULT_PACKET_SIZE_MIN = ENCODER_LIMITS.packetSize.min;
const DEFAULT_PACKET_SIZE_MAX = ENCODER_LIMITS.packetSize.max;
const DEFAULT_TARGET_SIZE_MIN = ENCODER_LIMITS.targetSize.min;
const DEFAULT_TARGET_SIZE_MAX = ENCODER_LIMITS.targetSize.max;
const DEFAULT_OVERHEAD_VALUES = [1.0, 1.1, 1.2, 1.5, 2.0];
const DEFAULT_COMPRESSION_VALUES = [false, true];
const DEFAULT_ECC_VALUES: ECCLevel[] = ['LOW', 'MEDIUM', 'QUARTILE', 'HIGH'];
const QUICK_SAMPLE_COUNT = 10;

type LegacyBenchmarkProfileOverrides = Partial<BenchmarkProfile> & {
  coreTargetSize?: number;
  coreOverhead?: number;
  coreCompressionEnabled?: boolean;
};

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampFloat(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function uniqueSortedIntegers(values: number[], min: number, max = Number.MAX_SAFE_INTEGER): number[] {
  return [...new Set(values.map((value) => clampInt(value, min, max)))]
    .filter((value) => value >= min && value <= max)
    .sort((a, b) => a - b);
}

function uniqueSortedFloats(values: number[], min: number): number[] {
  return [...new Set(values.map((value) => Number(clampFloat(value, min, Number.MAX_SAFE_INTEGER).toFixed(2))))]
    .filter((value) => value >= min)
    .sort((a, b) => a - b);
}

function uniqueBooleans(values: boolean[]): boolean[] {
  return [...new Set(values)];
}

export function buildSteppedRange(min: number, max: number, step: number): number[] {
  const normalizedStep = Math.max(1, Math.round(step));
  const start = Math.round(min);
  const end = Math.round(max);
  const values: number[] = [];

  for (let current = start; current <= end; current += normalizedStep) {
    values.push(current);
  }

  if (values.length === 0 || values[values.length - 1] !== end) {
    values.push(end);
  }

  return values;
}

function inferRangeStep(values: number[]): number | null {
  if (values.length < 2) {
    return null;
  }

  const deltas = values
    .slice(1)
    .map((value, index) => value - values[index])
    .filter((delta) => delta > 0);

  return deltas.length > 0 ? Math.min(...deltas) : null;
}

type ManagedStepRange = {
  min: number;
  max: number;
  step: number;
  values: number[];
};

function buildManagedStepRange(
  values: number[] | undefined,
  step: number | undefined,
  limits: { min: number; max: number },
  fallback: { min: number; max: number; step: number },
): ManagedStepRange {
  const normalizedValues = uniqueSortedIntegers(
    values ?? buildSteppedRange(fallback.min, fallback.max, fallback.step),
    limits.min,
    limits.max,
  );
  const minValue = normalizedValues[0] ?? fallback.min;
  const maxValue = normalizedValues[normalizedValues.length - 1] ?? fallback.max;
  const maxStep = Math.max(1, maxValue - minValue);
  const normalizedStep = clampInt(
    step ?? inferRangeStep(normalizedValues) ?? fallback.step,
    1,
    maxStep,
  );

  return {
    min: minValue,
    max: maxValue,
    step: normalizedStep,
    values: buildSteppedRange(minValue, maxValue, normalizedStep),
  };
}

function pickMiddleValue(values: number[]): number {
  return values[Math.floor(values.length / 2)] ?? 0;
}

function pickMiddleFloat(values: number[]): number {
  return values[Math.floor(values.length / 2)] ?? 1.2;
}

function pickValue<T>(values: T[], ratio: number): T {
  const index = Math.min(values.length - 1, Math.max(0, Math.round((values.length - 1) * ratio)));
  return values[index];
}

function sampleQuickConfigs(profile: BenchmarkProfile): BenchmarkConfig[] {
  const fpsLow = pickValue(profile.fpsValues, 0.15);
  const fpsMid = pickValue(profile.fpsValues, 0.5);
  const fpsHigh = pickValue(profile.fpsValues, 0.75);
  const fpsMax = profile.fpsValues[profile.fpsValues.length - 1];

  const packetLow = pickValue(profile.packetSizes, 0.15);
  const packetMid = pickValue(profile.packetSizes, 0.5);
  const packetHigh = pickValue(profile.packetSizes, 0.75);
  const packetMax = profile.packetSizes[profile.packetSizes.length - 1];

  const lowEcc = profile.eccValues.includes('LOW') ? 'LOW' : profile.eccValues[0];
  const mediumEcc = profile.eccValues.includes('MEDIUM') ? 'MEDIUM' : profile.eccValues[0];
  const highEcc = profile.eccValues.includes('HIGH')
    ? 'HIGH'
    : profile.eccValues[profile.eccValues.length - 1];

  const base = {
    targetSize: profile.phase1TargetSize,
    raptorqOverhead: profile.phase1Overhead,
    compressionEnabled: profile.phase1CompressionEnabled,
  } as const;

  const candidates: BenchmarkConfig[] = [
    { fps: fpsLow, packetSize: packetLow, ecc: mediumEcc, ...base },
    { fps: fpsLow, packetSize: packetMid, ecc: lowEcc, ...base },
    { fps: fpsMid, packetSize: packetLow, ecc: lowEcc, ...base },
    { fps: fpsMid, packetSize: packetMid, ecc: mediumEcc, ...base },
    { fps: fpsMid, packetSize: packetHigh, ecc: lowEcc, ...base },
    { fps: fpsHigh, packetSize: packetMid, ecc: lowEcc, ...base },
    { fps: fpsHigh, packetSize: packetHigh, ecc: mediumEcc, ...base },
    { fps: fpsHigh, packetSize: packetMax, ecc: lowEcc, ...base },
    { fps: fpsMax, packetSize: packetMid, ecc: lowEcc, ...base },
    { fps: fpsMax, packetSize: packetHigh, ecc: highEcc, ...base },
  ];

  const seen = new Set<string>();
  const deduped = candidates.filter((config) => {
    if (!fitsInQr(config.packetSize, config.ecc)) return false;
    const key = fingerprintConfig(config);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });

  return deduped.slice(0, QUICK_SAMPLE_COUNT);
}

export function buildAdaptiveFpsValues(maxFps: number, step = FPS_STEP, minFps = 1): number[] {
  const normalizedMin = clampInt(minFps || 1, 1, 240);
  const normalizedMax = clampInt(maxFps || DEFAULT_MAX_FPS, normalizedMin, 240);
  const normalizedStep = clampInt(step || FPS_STEP, 1, normalizedMax);
  return buildSteppedRange(normalizedMin, normalizedMax, normalizedStep);
}

export const DEFAULT_BENCHMARK_PROFILE: BenchmarkProfile = {
  maxFps: DEFAULT_MAX_FPS,
  fpsStep: FPS_STEP,
  fpsValues: buildAdaptiveFpsValues(DEFAULT_MAX_FPS, FPS_STEP),
  packetSizeStep: RANGE_STEP,
  packetSizes: buildSteppedRange(DEFAULT_PACKET_SIZE_MIN, DEFAULT_PACKET_SIZE_MAX, RANGE_STEP),
  eccValues: [...DEFAULT_ECC_VALUES],
  targetSizeStep: RANGE_STEP,
  targetSizes: buildSteppedRange(DEFAULT_TARGET_SIZE_MIN, DEFAULT_TARGET_SIZE_MAX, RANGE_STEP),
  overheadValues: [...DEFAULT_OVERHEAD_VALUES],
  compressionValues: [...DEFAULT_COMPRESSION_VALUES],
  phase1TargetSize: pickMiddleValue(
    buildSteppedRange(DEFAULT_TARGET_SIZE_MIN, DEFAULT_TARGET_SIZE_MAX, RANGE_STEP),
  ),
  phase1Overhead: 1.2,
  phase1CompressionEnabled: false,
  topCandidateCount: 5,
  payloadSizeBytes: 13 * 1024,
};

export function createBenchmarkProfile(
  overrides: LegacyBenchmarkProfileOverrides = {},
): BenchmarkProfile {
  const minFpsFromValues = overrides.fpsValues?.[0];
  const maxFpsFromValues = overrides.fpsValues?.[overrides.fpsValues.length - 1];
  const maxFps = clampInt(
    overrides.maxFps ?? maxFpsFromValues ?? DEFAULT_BENCHMARK_PROFILE.maxFps,
    1,
    240,
  );
  const minFps = clampInt(
    minFpsFromValues ?? 1,
    1,
    maxFps,
  );
  const fpsStep = clampInt(
    overrides.fpsStep ?? inferRangeStep(overrides.fpsValues ?? []) ?? DEFAULT_BENCHMARK_PROFILE.fpsStep,
    1,
    maxFps,
  );
  const packetSweep = buildManagedStepRange(
    overrides.packetSizes,
    overrides.packetSizeStep,
    ENCODER_LIMITS.packetSize,
    {
      min: DEFAULT_PACKET_SIZE_MIN,
      max: DEFAULT_PACKET_SIZE_MAX,
      step: DEFAULT_BENCHMARK_PROFILE.packetSizeStep,
    },
  );
  const targetSweep = buildManagedStepRange(
    overrides.targetSizes,
    overrides.targetSizeStep,
    ENCODER_LIMITS.targetSize,
    {
      min: DEFAULT_TARGET_SIZE_MIN,
      max: DEFAULT_TARGET_SIZE_MAX,
      step: DEFAULT_BENCHMARK_PROFILE.targetSizeStep,
    },
  );
  const legacyTargetSize = overrides.phase1TargetSize ?? overrides.coreTargetSize;
  const legacyOverhead = overrides.phase1Overhead ?? overrides.coreOverhead;
  const legacyCompression =
    overrides.phase1CompressionEnabled ?? overrides.coreCompressionEnabled;
  const minTargetSize = targetSweep.values[0] ?? DEFAULT_TARGET_SIZE_MIN;
  const maxTargetSize = targetSweep.values[targetSweep.values.length - 1] ?? DEFAULT_TARGET_SIZE_MAX;

  return {
    maxFps,
    fpsStep,
    fpsValues: buildAdaptiveFpsValues(maxFps, fpsStep, minFps),
    packetSizeStep: packetSweep.step,
    packetSizes: packetSweep.values,
    eccValues: [...new Set(overrides.eccValues ?? DEFAULT_BENCHMARK_PROFILE.eccValues)],
    targetSizeStep: targetSweep.step,
    targetSizes: targetSweep.values,
    overheadValues: uniqueSortedFloats(
      overrides.overheadValues ?? DEFAULT_BENCHMARK_PROFILE.overheadValues,
      1,
    ),
    compressionValues: uniqueBooleans(
      overrides.compressionValues ?? DEFAULT_BENCHMARK_PROFILE.compressionValues,
    ),
    phase1TargetSize: clampInt(
      legacyTargetSize ?? pickMiddleValue(targetSweep.values),
      minTargetSize,
      maxTargetSize,
    ),
    phase1Overhead: Number(
      clampFloat(
        legacyOverhead ?? pickMiddleFloat(
          uniqueSortedFloats(overrides.overheadValues ?? DEFAULT_BENCHMARK_PROFILE.overheadValues, 1),
        ),
        1,
        10,
      ).toFixed(2),
    ),
    phase1CompressionEnabled:
      legacyCompression ?? (
        uniqueBooleans(overrides.compressionValues ?? DEFAULT_BENCHMARK_PROFILE.compressionValues).includes(false)
          ? false
          : uniqueBooleans(overrides.compressionValues ?? DEFAULT_BENCHMARK_PROFILE.compressionValues)[0]
      ),
    topCandidateCount: clampInt(
      overrides.topCandidateCount ?? DEFAULT_BENCHMARK_PROFILE.topCandidateCount,
      1,
      20,
    ),
    payloadSizeBytes: clampInt(
      overrides.payloadSizeBytes ?? DEFAULT_BENCHMARK_PROFILE.payloadSizeBytes,
      1024,
      50 * 1024 * 1024,
    ),
  };
}

export function fingerprintConfig(config: BenchmarkConfig): string {
  return [
    config.fps,
    config.packetSize,
    config.ecc,
    config.targetSize,
    config.raptorqOverhead.toFixed(2),
    config.compressionEnabled ? '1' : '0',
  ].join('|');
}

export function buildQuickMatrix(profile: BenchmarkProfile = DEFAULT_BENCHMARK_PROFILE): BenchmarkRunDefinition[] {
  return sampleQuickConfigs(profile).map((config) => ({
    phase: 'quick',
    config,
  }));
}

export function buildPhase1Matrix(profile: BenchmarkProfile = DEFAULT_BENCHMARK_PROFILE): BenchmarkRunDefinition[] {
  const configs: BenchmarkRunDefinition[] = [];

  for (const fps of profile.fpsValues) {
    for (const packetSize of profile.packetSizes) {
      for (const ecc of profile.eccValues) {
        if (!fitsInQr(packetSize, ecc)) continue;
        configs.push({
          phase: 'phase1',
          config: {
            fps,
            packetSize,
            ecc,
            targetSize: profile.phase1TargetSize,
            raptorqOverhead: profile.phase1Overhead,
            compressionEnabled: profile.phase1CompressionEnabled,
          },
        });
      }
    }
  }

  return configs;
}

export function buildPhase3Matrix(
  profile: BenchmarkProfile = DEFAULT_BENCHMARK_PROFILE,
  topConfigs: BenchmarkConfig[],
): BenchmarkRunDefinition[] {
  const configs: BenchmarkRunDefinition[] = [];

  for (const base of topConfigs) {
    for (const raptorqOverhead of profile.overheadValues) {
      for (const compressionEnabled of profile.compressionValues) {
        configs.push({
          phase: 'phase3',
          config: {
            ...base,
            raptorqOverhead,
            compressionEnabled,
          },
        });
      }
    }
  }

  return configs;
}

export function buildExhaustiveMatrix(
  profile: BenchmarkProfile = DEFAULT_BENCHMARK_PROFILE,
): BenchmarkRunDefinition[] {
  const configs: BenchmarkRunDefinition[] = [];

  for (const fps of profile.fpsValues) {
    for (const packetSize of profile.packetSizes) {
      for (const ecc of profile.eccValues) {
        if (!fitsInQr(packetSize, ecc)) continue;
        for (const raptorqOverhead of profile.overheadValues) {
          for (const compressionEnabled of profile.compressionValues) {
            configs.push({
              phase: 'phase1',
              config: {
                fps,
                packetSize,
                ecc,
                targetSize: profile.phase1TargetSize,
                raptorqOverhead,
                compressionEnabled,
              },
            });
          }
        }
      }
    }
  }

  return configs;
}

export function estimateBenchmarkRunCount(
  mode: BenchmarkMode,
  profile: BenchmarkProfile = DEFAULT_BENCHMARK_PROFILE,
): number {
  if (mode === 'quick') {
    return buildQuickMatrix(profile).length;
  }

  if (mode === 'exhaustive') {
    return buildExhaustiveMatrix(profile).length;
  }

  // Smart mode: phase1 valid combos + follow-up on top candidates
  const phase1Count = buildPhase1Matrix(profile).length;
  return (
    phase1Count +
    (profile.topCandidateCount * profile.overheadValues.length * profile.compressionValues.length)
  );
}

export function selectTopConfigs(
  results: BenchmarkResult[],
  limit: number,
): BenchmarkConfig[] {
  const bestByConfig = new Map<string, BenchmarkResult>();

  for (const result of results) {
    if (!result.success) {
      continue;
    }

    const key = fingerprintConfig(result.config);
    const current = bestByConfig.get(key);
    if (!current || current.throughputKBps < result.throughputKBps) {
      bestByConfig.set(key, result);
    }
  }

  return [...bestByConfig.values()]
    .sort((left, right) => right.throughputKBps - left.throughputKBps)
    .slice(0, limit)
    .map((result) => result.config);
}

/**
 * Count matrix configurations from a previous session that still need to run.
 * A run is "remaining" when its config fingerprint does not yet appear in the
 * session's successful results. Mirrors useBenchmarkRunner.resume() logic so
 * the UI can surface a Continue action for sessions that look "complete" but
 * never ran their full matrix (e.g. user retried errors before Smart mode had
 * a chance to build phase3).
 */
export function computeRemainingRunCount(session: {
  mode: BenchmarkMode;
  profile?: Partial<BenchmarkProfile>;
  results: BenchmarkResult[];
}): number {
  const profile = createBenchmarkProfile(session.profile);

  let allRuns: BenchmarkRunDefinition[];
  if (session.mode === 'full') {
    const hasPhase3 = session.results.some((r) => r.phase === 'phase3');
    if (hasPhase3) {
      const topConfigs = selectTopConfigs(
        session.results.filter((r) => r.phase === 'phase1'),
        profile.topCandidateCount,
      );
      allRuns = [
        ...buildPhase1Matrix(profile),
        ...buildPhase3Matrix(profile, topConfigs),
      ];
    } else {
      allRuns = buildPhase1Matrix(profile);
    }
  } else if (session.mode === 'quick') {
    allRuns = buildQuickMatrix(profile);
  } else {
    allRuns = buildExhaustiveMatrix(profile);
  }

  const doneKeys = new Set(
    session.results
      .filter((r) => r.success)
      .map((r) => fingerprintConfig(r.config)),
  );

  return allRuns.filter((run) => !doneKeys.has(fingerprintConfig(run.config))).length;
}

export function formatNumberList(values: number[]): string {
  return values.join(', ');
}

export const BENCHMARK_RANGE_STEP = RANGE_STEP;
export const BENCHMARK_FPS_STEP = FPS_STEP;

export function labelForConfig(config: BenchmarkConfig): string {
  return [
    `${config.fps}fps`,
    `${config.packetSize}B`,
    config.ecc,
    `${config.targetSize}px`,
    `${config.raptorqOverhead.toFixed(1)}x`,
    config.compressionEnabled ? 'deflate' : 'raw',
  ].join(' / ');
}

export const BENCHMARK_TIMEOUT_MS = 30_000;
