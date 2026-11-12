/**
 * Analyze all benchmark sessions and recommend optimal encoder parameters.
 *
 * Strategy: aggregate all successful results across sessions, group by config
 * fingerprint, compute median throughput per config, rank by median.
 * Using median (not max) avoids one-off outliers.
 */

import type { BenchmarkConfig, BenchmarkSession } from './types';
import { fingerprintConfig, labelForConfig } from './matrix';

export interface Recommendation {
  config: BenchmarkConfig;
  label: string;
  medianKBps: number;
  bestKBps: number;
  sampleCount: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function computeRecommendations(sessions: BenchmarkSession[]): Recommendation[] {
  const byConfig = new Map<string, { config: BenchmarkConfig; kbps: number[] }>();

  for (const session of sessions) {
    for (const r of session.results) {
      if (!r.success) continue;
      const key = fingerprintConfig(r.config);
      let entry = byConfig.get(key);
      if (!entry) {
        entry = { config: r.config, kbps: [] };
        byConfig.set(key, entry);
      }
      entry.kbps.push(r.throughputKBps);
    }
  }

  const recommendations: Recommendation[] = [];
  for (const { config, kbps } of byConfig.values()) {
    recommendations.push({
      config,
      label: labelForConfig(config),
      medianKBps: median(kbps),
      bestKBps: Math.max(...kbps),
      sampleCount: kbps.length,
    });
  }

  recommendations.sort((a, b) => b.medianKBps - a.medianKBps);
  return recommendations;
}
