import { lazy } from 'react';

const loadEncoderTab = () => import('./components/tabs/EncoderTab');
const loadDecoderTab = () => import('./components/tabs/DecoderTab');
const loadScannerTab = () => import('./components/tabs/ScannerTab');
const loadHistoryTab = () => import('./components/tabs/HistoryTab');
const loadSettingsTab = () => import('./components/tabs/SettingsTab');

export const EncoderTab = lazy(loadEncoderTab);
export const DecoderTab = lazy(loadDecoderTab);
export const ScannerTab = lazy(loadScannerTab);
export const HistoryTab = lazy(loadHistoryTab);
export const SettingsTab = lazy(loadSettingsTab);

export const preloadScannerTab = async () => {
  await loadScannerTab();
};
