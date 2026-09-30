export type DecodeState =
  | "scanning"
  | "threshold_reached"
  | "assembling"
  | "decode_pending"
  | "complete"
  | "failed";

export type ChunkState =
  | "missing"
  | "scanning"
  | "threshold_reached"
  | "complete"
  | "failed";

export interface ScanChunkState {
  chunkId: number;
  receivedUnique: number;
  decodeThreshold: number | null;
  totalPackets: number | null;
  totalPacketsExact: boolean;
  state: ChunkState;
  missingCount: number | null;
  missingRanges: Array<[number, number]>;
  targetFrameCount: number | null;
  targetFrameRanges: Array<[number, number]>;
  unseenFrameCount: number | null;
  unseenFrameRanges: Array<[number, number]>;
}

export interface ScanAssemblyState {
  inProgress: boolean;
  attempts: number;
  lastAttemptAt: string | null;
  lastError: string | null;
}

export interface ScanSessionState {
  type: "scan-session-state";
  stateVersion: number;
  sessionId: string;
  status: "active" | "complete" | "failed";
  updatedAt: string;
  filename: string | null;
  receivedUnique: number;
  decodeThreshold: number | null;
  totalPackets: number | null;
  totalPacketsExact: boolean;
  completionPercent: number;
  decodeState: DecodeState;
  isComplete: boolean;
  fileAvailable: boolean;
  chunksTotal: number | null;
  chunksComplete: number;
  chunksMissing: number | null;
  chunks: ScanChunkState[];
  assembly: ScanAssemblyState;
}
