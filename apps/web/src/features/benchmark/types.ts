import type { ECCLevel } from '../../types';

export interface BenchmarkConfig {
  fps: number;
  packetSize: number;
  ecc: ECCLevel;
  targetSize: number;
  raptorqOverhead: number;
  compressionEnabled: boolean;
}

export type BenchmarkMode = 'quick' | 'full' | 'exhaustive';

export type BenchmarkRunPhase = 'quick' | 'phase1' | 'phase3';

export interface BenchmarkProfile {
  maxFps: number;
  fpsStep: number;
  fpsValues: number[];
  packetSizeStep: number;
  packetSizes: number[];
  eccValues: ECCLevel[];
  targetSizeStep: number;
  targetSizes: number[];
  overheadValues: number[];
  compressionValues: boolean[];
  phase1TargetSize: number;
  phase1Overhead: number;
  phase1CompressionEnabled: boolean;
  topCandidateCount: number;
  payloadSizeBytes: number;
}

export interface BenchmarkRunDefinition {
  phase: BenchmarkRunPhase;
  config: BenchmarkConfig;
}

export interface BenchmarkResult {
  phase: BenchmarkRunPhase;
  config: BenchmarkConfig;
  transferTimeMs: number;
  throughputKBps: number;
  success: boolean;
  error?: string;
  totalFrames?: number;
  minFrames?: number;
  gifSizeBytes?: number;
}

export type BenchmarkPhase =
  | 'idle'
  | 'encoding'
  | 'displaying'
  | 'waiting'
  | 'done'
  | 'error';

export interface GifFrameInfo {
  totalFrames: number;
  minFrames: number;
}

export interface BenchmarkRunState {
  phase: BenchmarkPhase;
  currentIndex: number;
  totalRuns: number;
  results: BenchmarkResult[];
  currentRun: BenchmarkRunDefinition | null;
  gifUrl: string | null;
  gifFrameInfo: GifFrameInfo | null;
  encodeProgress: number;
  displayStartTime: number;
}

export interface BenchmarkSession {
  id: string;
  date: string;
  mode: BenchmarkMode;
  profile: BenchmarkProfile;
  results: BenchmarkResult[];
  payloadSize: number;
  completed: boolean;
}
