import { describe, expect, it } from 'vitest';

import {
  buildAdaptiveFpsValues,
  buildPhase1Matrix,
  buildPhase3Matrix,
  createBenchmarkProfile,
  estimateBenchmarkRunCount,
} from '@web/features/benchmark/matrix';
import { computeRecommendations } from '@web/features/benchmark/recommend';
import type { BenchmarkSession } from '@web/features/benchmark/types';

describe('benchmark matrix', () => {
  it('builds packet sizes and target sizes from 25-step ranges without hardcoded comparison points', () => {
    const profile = createBenchmarkProfile();

    expect(profile.packetSizes.slice(0, 5)).toEqual([100, 125, 150, 175, 200]);
    expect(profile.packetSizes.at(-1)).toBe(2800);
    expect(profile.targetSizes).toEqual([100, 125, 150, 175, 200, 225, 250, 275, 300, 325, 350, 375, 400]);
    expect(profile.targetSizes.includes(177)).toBe(false);
  });

  it('extends the adaptive FPS sweep up to the detected device limit without gaps by default', () => {
    expect(buildAdaptiveFpsValues(30).slice(0, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(buildAdaptiveFpsValues(30).at(-1)).toBe(30);
    expect(buildAdaptiveFpsValues(60).slice(0, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(buildAdaptiveFpsValues(60).at(-1)).toBe(60);
    expect(buildAdaptiveFpsValues(60)).toHaveLength(60);
  });

  it('rebuilds regular sweeps when editable steps change', () => {
    const profile = createBenchmarkProfile({
      maxFps: 60,
      fpsStep: 2,
      packetSizeStep: 50,
      targetSizeStep: 50,
    });

    expect(profile.fpsStep).toBe(2);
    expect(profile.fpsValues.slice(0, 5)).toEqual([1, 3, 5, 7, 9]);
    expect(profile.fpsValues.at(-1)).toBe(60);

    expect(profile.packetSizeStep).toBe(50);
    expect(profile.packetSizes.slice(0, 5)).toEqual([100, 150, 200, 250, 300]);
    expect(profile.packetSizes.at(-1)).toBe(2800);

    expect(profile.targetSizeStep).toBe(50);
    expect(profile.targetSizes).toEqual([100, 150, 200, 250, 300, 350, 400]);
  });

  it('estimates the smart benchmark run count from phase 1 plus the follow-up sweep', () => {
    const profile = createBenchmarkProfile({
      maxFps: 60,
      fpsStep: 2,
      packetSizes: [100, 200],
      packetSizeStep: 100,
      eccValues: ['LOW', 'HIGH'],
      targetSizes: [150, 250, 350],
      targetSizeStep: 100,
      overheadValues: [1.0, 1.2],
      compressionValues: [false, true],
      topCandidateCount: 2,
    });

    expect(estimateBenchmarkRunCount('full', profile)).toBe(
      buildPhase1Matrix(profile).length +
      (profile.topCandidateCount * profile.overheadValues.length * profile.compressionValues.length),
    );
  });

  it('builds the phase 3 follow-up sweep from top phase 1 configs', () => {
    const profile = createBenchmarkProfile({
      maxFps: 30,
      targetSizes: [100, 250],
      overheadValues: [1.0, 1.5],
      compressionValues: [false, true],
      topCandidateCount: 2,
    });

    const topConfigs = [
      {
        fps: 20,
        packetSize: 1200,
        ecc: 'LOW' as const,
        targetSize: 250,
        raptorqOverhead: 1.2,
        compressionEnabled: false,
      },
      {
        fps: 12,
        packetSize: 800,
        ecc: 'MEDIUM' as const,
        targetSize: 250,
        raptorqOverhead: 1.2,
        compressionEnabled: false,
      },
    ];

    const phase3 = buildPhase3Matrix(profile, topConfigs);

    expect(phase3).toHaveLength(8);
    expect(phase3.map((run) => run.config.targetSize)).toEqual([
      250,
      250,
      250,
      250,
      250,
      250,
      250,
      250,
    ]);
    expect(phase3.some((run) => run.config.compressionEnabled)).toBe(true);
    expect(phase3.some((run) => run.config.raptorqOverhead === 1.5)).toBe(true);
  });

  it('keeps recommendations distinct when non-core axes differ', () => {
    const sessions: BenchmarkSession[] = [
      {
        id: 'session-1',
        date: '2026-03-30T12:00:00.000Z',
        mode: 'full',
        payloadSize: 13 * 1024,
        profile: createBenchmarkProfile(),
        results: [
          {
            phase: 'phase3',
            config: {
              fps: 20,
              packetSize: 1200,
              ecc: 'LOW',
              targetSize: 250,
              raptorqOverhead: 1.0,
              compressionEnabled: false,
            },
            transferTimeMs: 1_000,
            throughputKBps: 13,
            success: true,
          },
          {
            phase: 'phase3',
            config: {
              fps: 20,
              packetSize: 1200,
              ecc: 'LOW',
              targetSize: 250,
              raptorqOverhead: 1.5,
              compressionEnabled: true,
            },
            transferTimeMs: 700,
            throughputKBps: 18,
            success: true,
          },
        ],
      },
    ];

    const recommendations = computeRecommendations(sessions);

    expect(recommendations).toHaveLength(2);
    expect(recommendations[0].config.compressionEnabled).toBe(true);
    expect(recommendations[1].config.compressionEnabled).toBe(false);
  });
});
