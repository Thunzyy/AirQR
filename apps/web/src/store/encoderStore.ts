/**
 * Zustand store for encoder state management
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { EncoderStore } from '../types';
import {
  DEFAULT_ENCODER_CONFIG,
  DEFAULT_NOTE_FORMAT,
  STORAGE_KEYS,
} from '../constants';
import { migrateLegacyEncoderDefaults } from '../utils/encoderConfig';

export function mergeEncoderStoreState(
  persistedState: Partial<EncoderStore> | undefined,
  currentState: EncoderStore
): EncoderStore {
  const stored = persistedState;
  return {
    ...currentState,
    ...stored,
    config: {
      ...DEFAULT_ENCODER_CONFIG,
      ...stored?.config,
    },
  };
}

export const useEncoderStore = create<EncoderStore>()(
  persist(
    (set) => ({
      // Initial state
      selectedFiles: null,
      selectedFolderName: null,
      encoderMode: 'file',
      noteText: '',
      noteFormat: DEFAULT_NOTE_FORMAT,
      config: DEFAULT_ENCODER_CONFIG,
      gifUrls: [],
      gifMetadata: null,
      generatedFps: null,
      downloadUrl: null,
      isStreamingResult: false,
      isEncoding: false,
      progress: 0,
      error: null,

      // Actions
      setFiles: (files) => set({ selectedFiles: files }),
      setFolderName: (name) => set({ selectedFolderName: name }),
      setEncoderMode: (encoderMode) => set({ encoderMode }),
      setNoteText: (noteText) => set({ noteText }),
      setNoteFormat: (noteFormat) => set({ noteFormat }),
      setConfig: (config) =>
        set((state) => ({
          config: { ...state.config, ...config },
        })),
      resetOutput: () =>
        set({
          gifUrls: [],
          gifMetadata: null,
          generatedFps: null,
          downloadUrl: null,
          isStreamingResult: false,
          progress: 0,
          error: null,
        }),
      setEncoding: (isEncoding) => set({ isEncoding }),
      setProgress: (progress) => set({ progress }),
      setError: (error) => set({ error }),
      setGifMetadata: (metadata) =>
        set((state) => ({
          gifMetadata: {
            ...(state.gifMetadata || {
              width: 0,
              height: 0,
              totalFrames: 0,
              minFrames: 0,
              duration: 0,
              fileSize: 0,
              originalSize: 0,
            }),
            ...metadata,
          },
        })),
      setGifResults: (urls, metadata, options) =>
        set((state) => ({
          gifUrls: urls.length > 0 ? urls : state.gifUrls,
          gifMetadata: {
            ...(state.gifMetadata || {
              width: 0,
              height: 0,
              totalFrames: 0,
              minFrames: 0,
              duration: 0,
              fileSize: 0,
              originalSize: 0,
            }),
            ...metadata
          },
          downloadUrl:
            options?.downloadUrl === undefined
              ? state.downloadUrl
              : options.downloadUrl,
          generatedFps:
            options?.generatedFps === undefined
              ? state.generatedFps
              : options.generatedFps,
          isStreamingResult:
            options?.isStreamingResult === undefined
              ? state.isStreamingResult
              : options.isStreamingResult,
          isEncoding: false,
          progress: 100,
        })),
    }),
    {
      name: STORAGE_KEYS.ENCODER_CONFIG,
      version: 1,
      migrate: (persistedState) => {
        // SAFETY: zustand persist migrate receives this store's partialize snapshot.
        const state = persistedState as Partial<
          Pick<EncoderStore, 'config' | 'encoderMode' | 'noteFormat'>
        >;
        return {
          config: migrateLegacyEncoderDefaults(state.config ?? {}),
          encoderMode: state.encoderMode ?? 'file',
          noteFormat: state.noteFormat ?? DEFAULT_NOTE_FORMAT,
        };
      },
      partialize: (state) => ({
        config: state.config,
        encoderMode: state.encoderMode,
        noteFormat: state.noteFormat,
      }),
      merge: (persistedState, currentState) => {
        // SAFETY: zustand persist merge receives this store's partialize snapshot.
        return mergeEncoderStoreState(
          persistedState as Partial<EncoderStore> | undefined,
          currentState
        );
      },
    }
  )
);
