import { create } from 'zustand';

type ToastType = 'info' | 'success' | 'warning' | 'error';

interface ToastState {
  message: string;
  type: ToastType;
  visible: boolean;
  show: (message: string, type?: ToastType) => void;
  hide: () => void;
}

export const useToastStore = create<ToastState>((set) => ({
  message: '',
  type: 'info',
  visible: false,
  show: (message, type = 'info') => set({ message, type, visible: true }),
  hide: () => set({ visible: false }),
}));
