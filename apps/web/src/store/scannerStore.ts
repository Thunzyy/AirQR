/**
 * Zustand store for scanner state management
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ScannerStore, ScannerConfig } from '../types';
import { SCANNER_PRESETS, STORAGE_KEYS } from '../constants';

export const DEFAULT_SCANNER_CONFIG: ScannerConfig = {
  useStaticImage: false,
  enableTorch: false,
  selectedCamera: 'environment',
  scanInterval: SCANNER_PRESETS.fast.scanInterval,
  resolution: SCANNER_PRESETS.fast.resolution ?? '720p',
  tryHarder: SCANNER_PRESETS.fast.tryHarder ?? false,
  enableBeep: true,
  enableVibration: true,
  enableAutoDownload: false,
  showDebugInfo: false,
};

export const useScannerStore = create<ScannerStore>()(
  persist(
    (set) => ({
      // Initial state
      config: DEFAULT_SCANNER_CONFIG,
      staticImage: null,
      isScanning: false,
      progress: 0,
      decodedFile: null,
      error: null,
      selectedPreset: 'fast',
      cameras: [],
      currentCameraId: null,
      debugInfo: null,
      qrDetected: false,
      lastScanTime: null,

      // Actions
      setConfig: (config) =>
        set((state) => ({
          config: { ...state.config, ...config },
        })),
      setStaticImage: (image) => set({ staticImage: image }),
      setScanning: (isScanning) => set({ isScanning }),
      setProgress: (progress) => set({ progress }),
      setDecodedFile: (file) =>
        set({
          decodedFile: file,
          isScanning: false,
          progress: file ? 100 : 0,
        }),
      setError: (error) =>
        set({
          error,
          isScanning: false,
          progress: 0,
        }),
      setSelectedPreset: (preset) => set({ selectedPreset: preset }),
      setCameras: (cameras) => set({ cameras }),
      setCurrentCameraId: (id) => set({ currentCameraId: id }),
      setDebugInfo: (info) => set({ debugInfo: info }),
      setQrDetected: (detected) => set({ qrDetected: detected }),
      setLastScanTime: (time) => set({ lastScanTime: time }),

      resetScanner: () =>
        set({
          staticImage: null,
          isScanning: false,
          progress: 0,
          decodedFile: null,
          error: null,
          qrDetected: false,
          lastScanTime: null,
          debugInfo: null,
        }),

      // Preset management
      applyPreset: (preset) => {
        const presetConfig = SCANNER_PRESETS[preset];
        set({
          selectedPreset: preset,
          config: {
            ...DEFAULT_SCANNER_CONFIG,
            scanInterval: presetConfig.scanInterval,
            resolution:
              presetConfig.resolution ?? DEFAULT_SCANNER_CONFIG.resolution,
            tryHarder: presetConfig.tryHarder ?? DEFAULT_SCANNER_CONFIG.tryHarder,
            enableTorch:
              presetConfig.enableTorch ?? DEFAULT_SCANNER_CONFIG.enableTorch,
            enableBeep: preset === 'silent' ? false : true,
            enableVibration: preset === 'silent' ? false : true,
          },
        });
      },

      // Camera control helpers
      toggleTorch: () =>
        set((state) => ({
          config: {
            ...state.config,
            enableTorch: !state.config.enableTorch,
          },
        })),

      switchCamera: () =>
        set((state) => {
          const currentIndex = state.cameras.findIndex(
            (cam) => cam.id === state.currentCameraId
          );
          const nextIndex = (currentIndex + 1) % state.cameras.length;
          const nextCamera = state.cameras[nextIndex];
          return {
            currentCameraId: nextCamera?.id || null,
            config: {
              ...state.config,
              selectedCamera: nextCamera?.label.includes('back')
                ? 'environment'
                : 'user',
            },
          };
        }),
    }),
    {
      name: STORAGE_KEYS.SCANNER_CONFIG,
      partialize: (state) => ({
        config: state.config,
        selectedPreset: state.selectedPreset,
      }),
      merge: (persistedState, currentState) => {
        // SAFETY: zustand persist merge receives this store's partialize snapshot.
        const stored = persistedState as Partial<ScannerStore>;
        return {
          ...currentState,
          ...stored,
          config: {
            ...DEFAULT_SCANNER_CONFIG,
            ...stored.config,
          },
        };
      },
    }
  )
);
