/**
 * Shared TypeScript types for AirQR Web App
 */

import type React from 'react';
import type { BinaryData } from '../utils/binaryData';

// ========== History Types ==========
export interface HistoryItem {
  id: string;
  type: 'file' | 'text' | 'wifi' | 'contact' | 'payment';
  origin: 'scanned' | 'generated';
  title: string;
  subtitle: string;
  date: string;
  sortTimestamp?: string;
  category?: 'today' | 'yesterday' | 'older';
  size?: number;
  fileData?: BinaryData;
  mimeType?: string;
  totalFrames?: number;
  minFrames?: number;
  chunkMinFrames?: number[];
  source?: 'local' | 'server';
  remoteSessionId?: string;
  remoteHistoryId?: string;
  // Sync status
  isSynced?: boolean;       // True if synced with server
  serverId?: string;        // Server-side ID
  isLocalOnly?: boolean;    // True if user explicitly detached from server
  syncFailed?: boolean;     // True if sync failed after max retries
  syncFailedAt?: string;    // ISO timestamp of when sync failed
}

export interface IncompleteScanItem {
  sessionId: string;
  filename: string;
  received: number;
  total: number;
  totalIsEstimate?: boolean;
  progressPercent?: number;
  date: string;
  chunksCompleted?: number;
  totalChunks?: number;
  chunksSaved?: number;
  /** Server-side packet count while a local incomplete scan is still uploading. */
  serverReceived?: number;
  /** Server-side expected packet total while a local incomplete scan is still uploading. */
  serverTotal?: number;
  source?: 'local' | 'server';
  remoteSessionId?: string;
  // Device identification for cross-device sync
  deviceId?: string;
  deviceName?: string;
}

export interface IncompleteScanLegacyBuffers {
  packets?: Array<Uint8Array | ArrayBuffer>;
  chunks?: Array<{ id: number; data: Uint8Array | ArrayBuffer }>;
}

export type PersistedIncompleteScanItem =
  IncompleteScanItem & IncompleteScanLegacyBuffers;

// ========== Encoder Types ==========
export type NoteFormat =
  | 'plain'
  | 'markdown'
  | 'javascript'
  | 'python'
  | 'typescript'
  | 'json'
  | 'html'
  | 'css'
  | 'rust'
  | 'sql'
  | 'yaml'
  | 'shell';

export type EncoderMode = 'file' | 'note';

export interface EncoderConfig {
  fps: number;
  packetSize: number;
  ecc: ECCLevel;
  targetSize: number;
  raptorqOverhead: number;
  compressionEnabled: boolean;
  forceChunkMode: boolean;
  customChunkSize: number;
  // Additional properties for compatibility
  frameDelay?: number;
  qrScale?: number;
  chunkSizeMB?: number;
}

export type ECCLevel = 'LOW' | 'MEDIUM' | 'QUARTILE' | 'HIGH';

export interface GifMetadata {
  width: number;
  height: number;
  totalFrames: number;
  minFrames: number;
  duration: number;
  fileSize: number;
  originalSize: number;
}

export interface ChunkInfo {
  id: number;
  url: string;
  metadata?: GifMetadata;
}

// ========== Scanner Types ==========
export type ScannerPreset = 'turbo' | 'fast' | 'balanced' | 'reliable' | 'silent' | 'custom';

export interface ScannerConfig {
  useStaticImage: boolean;
  enableTorch: boolean;
  selectedCamera: 'user' | 'environment';
  resolution: CameraResolution;
  scanInterval: number;
  tryHarder: boolean;
  enableBeep: boolean;
  enableVibration: boolean;
  enableAutoDownload: boolean;
  showDebugInfo: boolean;
}

export type CameraResolution = '720p' | '1080p' | '1440p';

export interface ScannerPresetInfo {
  scanInterval: number;
  resolution?: CameraResolution;
  tryHarder?: boolean;
  enableTorch?: boolean;
  emoji: string;
  name: string;
  desc: string;
}

export interface CameraInfo {
  id: string;
  label: string;
  facing?: 'user' | 'environment';
}

export interface ScanStats {
    received: number;
    min: number;
    total?: number;
    chunkTotal?: number;
  }

export interface ScanResult {
  filename: string;
  data: BinaryData;
  duration: number;
}

export interface ScanUploadConfig {
  enabled: boolean;
  url: string;
  apiKey: string;
  username: string;
  password: string;
  syncScanned: boolean;
  syncGenerated: boolean;
  autoSyncHistory: boolean;
}

// ========== Decoder Types ==========
export interface DecoderStats {
  totalFrames: number;
  processedFrames: number;
  qrDetected: number;
  startTime: number;
  fileSize: number;
  filename: string;
}

export interface DecodeResult {
  type: 'progress' | 'completed' | 'chunk_completed' | 'error';
  filename?: string;
  data?: Uint8Array;
  percent?: number;
  overallPercent?: number;
  chunkId?: number;
  totalChunks?: number;
  chunksCompleted?: number;
  chunkData?: Uint8Array;
  sessionId?: bigint;
  error?: string;
}

// ========== UI Component Props ==========
export interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

export interface ToggleProps {
  label: React.ReactNode;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  minLabel?: string;
  maxLabel?: string;
  onChange: (value: number) => void;
  disabled?: boolean;
  className?: string;
}

export interface CardProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export interface SelectOption<T = string> {
  value: T;
  label: string;
  description?: string;
}

export interface SelectProps<T = string> {
  label: string;
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}

// ========== Worker Message Types ==========
export interface QREncoderWorkerMessage {
  type: 'ENCODE';
  data: Uint8Array;
  config: EncoderConfig;
}

export interface QREncoderWorkerResponse {
  type: 'SUCCESS' | 'ERROR' | 'PROGRESS';
  data?: Uint8Array;
  error?: string;
  progress?: number;
}

export interface ScanWorkerMessage {
  type: 'SCAN' | 'WORKER_READY';
  grayscale?: Uint8Array;
  width?: number;
  height?: number;
  tryHarder?: boolean;
}

export interface ScanWorkerResponse {
  type: 'WORKER_READY' | 'RESULT' | 'ERROR';
  found?: boolean;
  binaryData?: ArrayBuffer;
  location?: {
    topLeftCorner: { x: number; y: number };
    topRightCorner: { x: number; y: number };
    bottomLeftCorner: { x: number; y: number };
    bottomRightCorner: { x: number; y: number };
  };
  error?: string;
}

// ========== Store Types ==========
export interface EncoderStore {
  // File state
  selectedFiles: File[] | null;
  selectedFolderName: string | null;
  encoderMode: EncoderMode;
  noteText: string;
  noteFormat: NoteFormat;

  // Config
  config: EncoderConfig;

  // Output
  gifUrls: string[];
  gifMetadata: GifMetadata | null;
  generatedFps: number | null;
  downloadUrl: string | null;
  isStreamingResult: boolean;
  isEncoding: boolean;
  progress: number;
  error: string | null;

  // Actions
  setFiles: (files: File[] | null) => void;
  setFolderName: (name: string | null) => void;
  setEncoderMode: (mode: EncoderMode) => void;
  setNoteText: (value: string) => void;
  setNoteFormat: (format: NoteFormat) => void;
  setConfig: (config: Partial<EncoderConfig>) => void;
  resetOutput: () => void;
  setEncoding: (isEncoding: boolean) => void;
  setProgress: (progress: number) => void;
  setError: (error: string | null) => void;
  setGifMetadata: (metadata: Partial<GifMetadata>) => void;
  setGifResults: (
    urls: string[],
    metadata: Partial<GifMetadata> | null,
    options?: {
      downloadUrl?: string | null;
      isStreamingResult?: boolean;
      generatedFps?: number | null;
    }
  ) => void;
}

export interface SettingsStore {
  // UI state
  activeTab: number;
  theme: 'light' | 'dark' | 'system';
  language: 'en' | 'fr';
  showEncoderLinksiteNotice: boolean;
  defaultCameraId: string | null;
  uploadConfig: ScanUploadConfig;
  debugInfo: {
    browserVersion: string;
    userAgent: string;
    platform: string;
    cores: number;
    memory: number;
    webgl: boolean;
    webrtc: boolean;
    webworker: boolean;
    wasm: boolean;
    indexedDB: boolean;
    localStorage: boolean;
    sessionStorage: boolean;
    cookies: boolean;
    cacheStorage: boolean;
  };
  storageStats: {
    used: number;
    quota: number;
  } | null;
  isSharing: boolean;
  shareError: string | null;

  // Actions
  setActiveTab: (tab: number) => void;
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  setLanguage: (language: 'en' | 'fr') => void;
  setShowEncoderLinksiteNotice: (show: boolean) => void;
  setDefaultCameraId: (cameraId: string | null) => void;
  setUploadConfig: (config: Partial<ScanUploadConfig>) => void;
  setDebugInfo: (info: SettingsStore['debugInfo']) => void;
  setStorageStats: (stats: SettingsStore['storageStats']) => void;
  setSharing: (isSharing: boolean, error?: string | null) => void;
  clearAppData: () => Promise<boolean>;
  loggingConfig: LoggingConfig;
  setLoggingConfig: (config: LoggingConfigUpdate) => void;
}

// ========== Logging Types ==========
export interface LoggingConfig {
  level: 'debug' | 'info' | 'warn' | 'error';
  enabledCategories: {
    services: boolean;
    workers: boolean;
    hooks: boolean;
    scanner: boolean;
    ui: boolean;
    app: boolean;
  };
}

export type LoggingConfigUpdate = Partial<Omit<LoggingConfig, 'enabledCategories'>> & {
  enabledCategories?: Partial<LoggingConfig['enabledCategories']>;
};

export interface ScannerStore {
  // Config
  config: ScannerConfig;
  staticImage: string | null;

  // Scan state
  isScanning: boolean;
  progress: number;
  decodedFile: ScanResult | null;
  error: string | null;

  // UI state
  selectedPreset: ScannerPreset;
  cameras: CameraInfo[];
  currentCameraId: string | null;
  debugInfo: ScanStats | null;
  qrDetected: boolean;
  lastScanTime: number | null;

  // Actions
  setConfig: (config: Partial<ScannerConfig>) => void;
  setStaticImage: (image: string | null) => void;
  setScanning: (isScanning: boolean) => void;
  setProgress: (progress: number) => void;
  setDecodedFile: (file: ScanResult | null) => void;
  setError: (error: string | null) => void;
  setSelectedPreset: (preset: ScannerPreset) => void;
  setCameras: (cameras: CameraInfo[]) => void;
  setCurrentCameraId: (id: string | null) => void;
  setDebugInfo: (info: ScanStats | null) => void;
  setQrDetected: (detected: boolean) => void;
  setLastScanTime: (time: number | null) => void;
  resetScanner: () => void;
  applyPreset: (preset: ScannerPreset) => void;
  toggleTorch: () => void;
  switchCamera: () => void;
}

export interface ResumeStats {
  received: number;
  total: number;
  filename?: string;
}

export type ResumeAuthority = 'local-cache' | 'server';

export interface ResumeScanOptions {
  authority?: ResumeAuthority;
}

export interface HistoryStore {
  items: HistoryItem[];
  incompleteItems: IncompleteScanItem[];
  resumeSessionId: string | null;
  resumePackets: Uint8Array[] | null;
  resumeStats: ResumeStats | null;
  resumeAuthority: ResumeAuthority | null;

  // Actions
  addItem: (item: HistoryItem) => void;
  removeItem: (id: string) => void;
  clearHistory: () => void;
  setItems: (items: HistoryItem[]) => void;
  setIncompleteItems: (items: IncompleteScanItem[]) => void;
  updateIncompleteScan: (scan: IncompleteScanItem) => void;
  removeIncompleteScan: (sessionId: string) => void;
  setResumeScan: (
    sessionId: string,
    packets: Uint8Array[] | null,
    stats?: ResumeStats,
    options?: ResumeScanOptions
  ) => void;
  clearResumeScan: () => void;
}
