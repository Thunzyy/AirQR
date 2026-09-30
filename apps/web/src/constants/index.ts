/**
 * Constants and default values for AirQR Web App
 */

import type {
  EncoderConfig,
  NoteFormat,
  ScannerPreset,
  ScannerPresetInfo,
  SelectOption,
} from '../types';

// ========== Encoder Defaults ==========
export const DEFAULT_ENCODER_CONFIG: EncoderConfig = {
  fps: 10,
  packetSize: 1500,
  ecc: 'LOW',
  targetSize: 177,
  raptorqOverhead: 1.3,
  compressionEnabled: true,
  forceChunkMode: false,
  customChunkSize: 10,
};

export const ENCODER_LIMITS = {
  fps: { min: 1, max: 30 },
  packetSize: { min: 100, max: 2800 },
  targetSize: { min: 100, max: 400 },
  raptorqOverhead: { min: 1.0, max: 3.0 },
  customChunkSize: { min: 1, max: 50 },
};

export const ECC_OPTIONS = [
  { value: 'LOW', label: 'LOW (7%)', description: 'Low error correction' },
  { value: 'MEDIUM', label: 'MEDIUM (15%)', description: 'Medium error correction' },
  { value: 'QUARTILE', label: 'QUARTILE (25%)', description: 'High error correction' },
  { value: 'HIGH', label: 'HIGH (30%)', description: 'Maximum error correction' },
] as const;

export const DEFAULT_NOTE_FORMAT: NoteFormat = 'plain';

export const NOTE_FORMAT_OPTIONS: Array<
  SelectOption<NoteFormat> & { extension: string }
> = [
  { value: 'plain', label: 'Plain text', extension: 'txt' },
  { value: 'markdown', label: 'Markdown', extension: 'md' },
  { value: 'javascript', label: 'JavaScript', extension: 'js' },
  { value: 'python', label: 'Python', extension: 'py' },
  { value: 'typescript', label: 'TypeScript', extension: 'ts' },
  { value: 'json', label: 'JSON', extension: 'json' },
  { value: 'html', label: 'HTML', extension: 'html' },
  { value: 'css', label: 'CSS', extension: 'css' },
  { value: 'rust', label: 'Rust', extension: 'rs' },
  { value: 'sql', label: 'SQL', extension: 'sql' },
  { value: 'yaml', label: 'YAML', extension: 'yml' },
  { value: 'shell', label: 'Shell', extension: 'sh' },
];

// ========== Scanner Defaults ==========
export const SCANNER_PRESETS = {
  turbo: {
    scanInterval: 0,
    resolution: '1080p',
    tryHarder: false,
    enableTorch: false,
    emoji: '🚀',
    name: 'Turbo',
    desc: 'Maximum speed, lower accuracy',
  },
  fast: {
    scanInterval: 16,
    resolution: '720p',
    tryHarder: false,
    enableTorch: false,
    emoji: '⚡',
    name: 'Fast',
    desc: 'Fast scanning, good balance',
  },
  balanced: {
    scanInterval: 33,
    resolution: '1080p',
    tryHarder: true,
    enableTorch: false,
    emoji: '⚖️',
    name: 'Balanced',
    desc: 'Recommended for most cases',
  },
  reliable: {
    scanInterval: 100,
    resolution: '1440p',
    tryHarder: true,
    enableTorch: false,
    emoji: '🎯',
    name: 'Reliable',
    desc: 'Best accuracy, slower',
  },
  silent: {
    scanInterval: 33,
    resolution: '1080p',
    tryHarder: true,
    enableTorch: false,
    emoji: '🔇',
    name: 'Silent',
    desc: 'No sounds or vibrations',
  },
  custom: {
    scanInterval: 0,
    resolution: '1080p',
    tryHarder: true,
    enableTorch: false,
    emoji: '🔧',
    name: 'Custom',
    desc: 'Your custom settings',
  },
} as const satisfies { readonly [K in ScannerPreset]: ScannerPresetInfo };

export const MAX_HISTORY_ITEMS = 50;

// ========== App Info ==========
export const APP_INFO = {
  name: 'AirQR Web App',
  version: 'v1.0',
  description: 'Air-gapped file transfer using animated QR codes',
  author: 'Thunzyy',
  authorUrl: 'https://github.com/Thunzyy',
  repoUrl: 'https://github.com/Thunzyy/AirQR',
  releasesUrl: 'https://get-airqr.pgnrd.fr/',
};

// ========== Storage Keys ==========
export const STORAGE_KEYS = {
  ENCODER_CONFIG: 'airqr_encoder_config',
  SCANNER_CONFIG: 'airqr_scanner_config',
  HISTORY: 'airqr_history',
  THEME: 'airqr_theme',
  SETTINGS: 'airqr_settings',
} as const;

// ========== Error Messages ==========
export const ERROR_MESSAGES = {
  WASM_INIT_FAILED: 'Failed to initialize WebAssembly module',
  CAMERA_ACCESS_DENIED: 'Camera access denied or unavailable',
  FILE_TOO_LARGE: 'File is too large to process',
  INVALID_FILE_TYPE: 'Invalid file type. Please select a valid file.',
  ENCODING_FAILED: 'Failed to encode file to QR codes',
  DECODING_FAILED: 'Failed to decode QR codes',
  BROWSER_NOT_SUPPORTED: 'Your browser does not support this feature',
} as const;

// ========== MIME Types ==========
export const MIME_TYPES = {
  GIF: 'image/gif',
  ZIP: 'application/zip',
  OCTET_STREAM: 'application/octet-stream',
} as const;

// ========== File Size Limits ==========
export const FILE_SIZE_LIMITS = {
  MAX_SINGLE_FILE: 100 * 1024 * 1024, // 100 MB
  CHUNK_THRESHOLD: 10 * 1024 * 1024, // 10 MB - files larger than this will be chunked
} as const;
