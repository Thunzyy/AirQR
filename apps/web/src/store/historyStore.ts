/**
 * Zustand store for history state management
 */

import { create } from 'zustand';
import type { HistoryStore } from '../types';
import {
  coalesceIncompleteScanItems,
  getIncompleteScanSessionKeys,
} from '../utils/incompleteSync';

export const useHistoryStore = create<HistoryStore>()((set) => ({
  items: [],
  incompleteItems: [],
  resumeSessionId: null,
  resumePackets: null,
  resumeStats: null,
  resumeAuthority: null,

  addItem: (item) => set((state) => ({ items: [item, ...state.items] })),
  removeItem: (id) =>
    set((state) => ({ items: state.items.filter((i) => i.id !== id) })),
  clearHistory: () =>
    set({
      items: [],
      incompleteItems: [],
      resumeSessionId: null,
      resumePackets: null,
      resumeStats: null,
      resumeAuthority: null,
    }),
  setItems: (items) => set({ items }),
  setIncompleteItems: (items) =>
    set({ incompleteItems: coalesceIncompleteScanItems(items) }),
  updateIncompleteScan: (scan) =>
    set((state) => {
      const scanKeys = new Set(getIncompleteScanSessionKeys(scan));
      const existing = state.incompleteItems.findIndex((item) =>
        getIncompleteScanSessionKeys(item).some((key) => scanKeys.has(key))
      );
      if (existing < 0) {
        return {
          incompleteItems: coalesceIncompleteScanItems([
            ...state.incompleteItems,
            scan,
          ]),
        };
      }

      const updated = [...state.incompleteItems];
      updated[existing] = scan;
      return {
        incompleteItems: coalesceIncompleteScanItems(updated),
      };
    }),
  removeIncompleteScan: (sessionId) =>
    set((state) => ({
      incompleteItems: state.incompleteItems.filter(
        (item) => !getIncompleteScanSessionKeys(item).includes(sessionId)
      ),
    })),
  setResumeScan: (sessionId, packets, stats, options) =>
    set({
      resumeSessionId: sessionId,
      resumePackets: packets,
      resumeStats: stats || null,
      resumeAuthority: options?.authority ?? 'local-cache',
    }),
  clearResumeScan: () =>
    set({
      resumeSessionId: null,
      resumePackets: null,
      resumeStats: null,
      resumeAuthority: null,
    }),
}));
