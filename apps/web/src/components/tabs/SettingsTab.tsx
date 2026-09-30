/**
 * SettingsTab component - App settings and information
 * Exactly matches the UI and order of the original application
 */

import React, { useEffect, useState, useCallback, useMemo, useRef, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'wouter';
import { useSettingsStore, useEncoderStore, useScannerStore, useToastStore } from '../../store';
import { createLogger } from '../../utils/logger';
import {
  buildEncoderLinksiteDataUrl,
  copyTextToClipboard,
  ENCODER_LINKSITE_CONSOLE_SNIPPET,
  ENCODER_LINKSITE_PATH,
  PORTABLE_SINGLEFILE_PATH,
} from '../../utils/linksite';

const logger = createLogger('ui:settingsTab');

import { Button, Toggle, Icon, HelpTip } from '../ui';
import { APP_INFO, ECC_OPTIONS, SCANNER_PRESETS } from '../../constants';
import type { CameraResolution, ECCLevel, LoggingConfig } from '../../types';
import {
  isLocalServerBaseUrl,
  resolveServerAccessMode,
  resolveServerBaseUrl,
} from '../../services/syncUrl';
import { useServerAuthState } from '../../hooks/useServerAuthState';
import { useConnectionTest } from '../../hooks/useConnectionTest';
import { useExportConfig } from '../../hooks/useExportConfig';
import { updateServerCredentials } from '../../services/serverAuth';

type RangeProgressStyle = React.CSSProperties & {
  '--airqr-range-value': string;
};

const getRangeProgressStyle = (
  value: number,
  min: number,
  max: number,
): RangeProgressStyle => {
  const range = max - min;
  const percentage = range <= 0
    ? 0
    : Math.min(100, Math.max(0, ((value - min) / range) * 100));

  return { '--airqr-range-value': `${percentage}%` };
};

// Flag SVG components
const FlagUS = () => (
  <svg className="w-6 h-4 flex-shrink-0" viewBox="0 0 640 480">
    <g fillRule="evenodd">
      <g strokeWidth="1pt">
        <path fill="#bd3d44" d="M0 0h640v37H0zm0 74h640v37H0zm0 73h640v37H0zm0 73h640v37H0zm0 74h640v36H0zm0 73h640v37H0zm0 73h640v37H0z"/>
        <path fill="#fff" d="M0 37h640v37H0zm0 73h640v37H0zm0 74h640v36H0zm0 74h640v36H0zm0 74h640v37H0zm0 73h640v37H0z"/>
      </g>
      <path fill="#192f5d" d="M0 0h257v259H0z"/>
      <path fill="#fff" d="m26 12 2 6h7l-5 4 2 6-6-4-5 4 2-6-6-4h7zm33 0 2 6h7l-6 4 2 6-5-4-6 4 2-6-5-4h7zm33 0 2 6h7l-5 4 2 6-6-4-5 4 2-6-6-4h7zm33 0 2 6h7l-5 4 2 6-6-4-5 4 2-6-6-4h7zm34 0 2 6h6l-5 4 2 6-6-4-5 4 2-6-6-4h7zm32 0 3 6h6l-5 4 2 6-6-4-5 4 2-6-6-4h7zm33 0 2 6h7l-5 4 2 6-6-4-6 4 2-6-5-4h7zm33 0 2 6h7l-5 4 2 6-6-4-6 4 2-6-5-4h7zm34 0 2 6h6l-5 4 2 6-6-4-5 4 2-6-6-4h7z"/>
    </g>
  </svg>
);

const FlagFR = () => (
  <svg className="w-6 h-4 flex-shrink-0" viewBox="0 0 640 480">
    <path fill="#fff" d="M0 0h640v480H0z"/>
    <path fill="#00267f" d="M0 0h213v480H0z"/>
    <path fill="#f31830" d="M426 0h214v480H426z"/>
  </svg>
);

const LANGUAGES = [
  { code: 'en' as const, label: 'English (US)', Flag: FlagUS },
  { code: 'fr' as const, label: 'Francais', Flag: FlagFR },
];

type LoggingCategory = keyof LoggingConfig['enabledCategories'];
type SettingsSectionKey = 'encoder' | 'scanner' | 'sync' | 'appearance' | 'logging' | 'about';

const LOGGING_CATEGORIES = {
  services: true,
  workers: true,
  hooks: true,
  scanner: true,
  ui: true,
  app: true,
} as const;

function isLoggingCategory(value: string): value is LoggingCategory {
  return value in LOGGING_CATEGORIES;
}

function isEccLevel(value: string): value is ECCLevel {
  return ECC_OPTIONS.some((option) => option.value === value);
}

function toEccLevel(value: string, fallback: ECCLevel): ECCLevel {
  return isEccLevel(value) ? value : fallback;
}

function isCameraResolution(value: string): value is CameraResolution {
  return value === '720p' || value === '1080p' || value === '1440p';
}

function isThemeOption(value: string): value is 'light' | 'dark' | 'system' {
  return value === 'light' || value === 'dark' || value === 'system';
}

function isLogLevel(value: string): value is LoggingConfig['level'] {
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error';
}

// Custom Language Selector with flags in dropdown
const LanguageSelector: React.FC<{
  language: 'en' | 'fr';
  setLanguage: (lang: 'en' | 'fr') => void;
  label: string;
}> = ({ language, setLanguage, label }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const labelId = useId();
  const selectedLabelId = useId();

  const selectedLang = LANGUAGES.find(l => l.code === language) || LANGUAGES[0];

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        event.target instanceof Node &&
        !dropdownRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="space-y-3 mb-6">
      <label
        id={labelId}
        className="text-sm font-semibold text-white/82"
      >
        {label}
      </label>
      <div className="relative" ref={dropdownRef}>
        {/* Selected value button */}
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          aria-label={label}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-labelledby={`${labelId} ${selectedLabelId}`}
          className="w-full flex items-center gap-3 px-4 py-3 text-sm font-semibold airqr-settings-control cursor-pointer"
        >
          <selectedLang.Flag />
          <span id={selectedLabelId} className="flex-1 text-left">{selectedLang.label}</span>
          <svg
            className={`w-5 h-5 text-[var(--airqr-text-muted)] transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {/* Dropdown menu */}
        {isOpen && (
          <div className="airqr-settings-menu absolute z-50 w-full mt-2 overflow-hidden rounded-[22px] shadow-2xl">
            {LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                type="button"
                onClick={() => {
                  setLanguage(lang.code);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-semibold text-left transition-colors ${
                  language === lang.code
                    ? 'bg-[var(--airqr-nav-active)] text-[var(--airqr-text-primary)]'
                    : 'text-[var(--airqr-text-secondary)] hover:bg-[var(--airqr-action-hover)] hover:text-[var(--airqr-text-primary)]'
                }`}
              >
                <lang.Flag />
                <span>{lang.label}</span>
                {language === lang.code && (
                  <Icon name="check" className="ml-auto text-[var(--airqr-accent-text)] text-lg" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

type ConnectedSegmentOption = {
  value: string;
  label: string;
};

const ConnectedSegmentedControl: React.FC<{
  options: ConnectedSegmentOption[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
}> = ({ options, value, onChange, ariaLabel }) => {
  const activeIndex = Math.max(0, options.findIndex((option) => option.value === value));

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="relative grid rounded-full bg-[var(--airqr-control-surface)] p-1"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      <div
        className="absolute bottom-1 left-1 top-1 rounded-full bg-[var(--airqr-nav-active)] shadow-[0_10px_28px_rgba(0,0,0,0.14)] transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]"
        style={{
          width: `calc((100% - 8px) / ${options.length})`,
          transform: `translateX(${activeIndex * 100}%)`,
        }}
      />
      {options.map((option) => {
        const selected = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={`relative z-10 h-9 rounded-full px-3 text-sm font-semibold transition-colors ${
              selected
                ? 'text-[var(--airqr-text-primary)]'
                : 'text-[var(--airqr-text-muted)] hover:text-[var(--airqr-text-primary)]'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
};

const SettingsTab: React.FC = () => {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const syncServerUrlInputId = useId();
  const syncUsernameInputId = useId();
  const syncPasswordInputId = useId();
  const exportDirectoryInputId = useId();
  const defaultCameraLabelId = useId();
  const defaultCameraValueId = useId();

  // Scroll to sync section if navigated with ?scrollTo=sync
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('scrollTo') === 'sync') {
      // Small delay to let the DOM render
      const timer = setTimeout(() => {
        document.getElementById('sync-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, []);

  // Store hooks
  const {
    theme,
    setTheme,
    language,
    setLanguage,
    showEncoderLinksiteNotice,
    setShowEncoderLinksiteNotice,
    defaultCameraId,
    setDefaultCameraId,
    clearAppData,
    uploadConfig,
    setUploadConfig,
    loggingConfig,
    setLoggingConfig,
  } = useSettingsStore();
  const syncScanned = uploadConfig.syncScanned ?? true;
  const syncGenerated = uploadConfig.syncGenerated ?? true;
  const autoSyncHistory = uploadConfig.autoSyncHistory ?? true;
  const {
    authEnabled,
    authorized,
    checking: authStatusChecking,
    connectionError: authConnectionError,
    authReady: serverAuthReady,
  } = useServerAuthState(uploadConfig);

  const syncBaseUrl = useMemo(
    () => resolveServerBaseUrl(uploadConfig.url),
    [uploadConfig.url]
  );
  const syncAccessMode = useMemo(
    () => resolveServerAccessMode(uploadConfig.url),
    [uploadConfig.url]
  );
  const storedSyncAuthConfig = useMemo(
    () => ({
      apiKey: uploadConfig.apiKey,
      username: uploadConfig.username,
      password: uploadConfig.password,
    }),
    [uploadConfig.apiKey, uploadConfig.username, uploadConfig.password]
  );
  const canManageServerCredentials = useMemo(
    () =>
      Boolean(
        syncBaseUrl &&
          (syncAccessMode === 'same-origin' || isLocalServerBaseUrl(syncBaseUrl))
      ),
    [syncAccessMode, syncBaseUrl]
  );

  const {
    config: encoderConfig,
    setConfig: setEncoderConfig,
  } = useEncoderStore();

  const {
    config: scannerConfig,
    selectedPreset: scannerPreset,
    applyPreset: applyScannerPreset,
    setConfig: setScannerConfig,
    setSelectedPreset: setScannerPreset,
  } = useScannerStore();
  const showToast = useToastStore((state) => state.show);
  const {
    syncUsernameDraft,
    syncPasswordDraft,
    setSyncUsernameDraft,
    setSyncPasswordDraft,
    syncStatusBadge,
    isConnectionUpdating,
    isConnectionDisconnectAction,
    isSyncing,
    syncTestResult,
    clearSyncTestResult,
    handleConnectionAction,
    performSync,
  } = useConnectionTest({
    uploadConfig,
    setUploadConfig,
    syncBaseUrl,
    authEnabled,
    authorized,
    authStatusChecking,
    authConnectionError,
    t,
    showToast,
  });
  const {
    exportConfig,
    exportDirInput,
    setExportDirInput,
    exportConfigLoading,
    exportConfigError,
    exportConfigSaved,
    saveExportConfig,
  } = useExportConfig({
    uploadConfig,
    storedSyncAuthConfig,
    syncBaseUrl,
    serverAuthReady,
  });
  const [isCopyingEncoderLinksite, setIsCopyingEncoderLinksite] = useState(false);
  const [isLinksiteHelpOpen, setIsLinksiteHelpOpen] = useState(false);
  const [selectedSettingsSection, setSelectedSettingsSection] = useState<SettingsSectionKey | null>(null);
  const [isCredentialsUpdating, setIsCredentialsUpdating] = useState(false);
  const [credentialsResult, setCredentialsResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);

  // Camera list state
  const [availableCameras, setAvailableCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraDropdownOpen, setCameraDropdownOpen] = useState(false);
  const [cameraLoadState, setCameraLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const cameraDropdownRef = useRef<HTMLDivElement>(null);
  const cameraLabelRefreshAttemptedRef = useRef(false);

  const loadCameras = useCallback(async (requestPermission = true) => {
    if (cameraLoadState === 'loading') return;
    if (!navigator.mediaDevices?.enumerateDevices) {
      setCameraLoadState('error');
      return;
    }

    setCameraLoadState('loading');
    try {
      // Request permission on demand to populate labels
      let stream: MediaStream | null = null;
      if (requestPermission) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        } catch (err) {
          logger.warn('Camera permission not granted', { error: err instanceof Error ? err.message : String(err) });
        } finally {
          stream?.getTracks().forEach(track => track.stop());
        }
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      setAvailableCameras(videoDevices);
      setCameraLoadState('ready');

      // Set default to back/rear camera if not already set
      if (!defaultCameraId && videoDevices.length > 0) {
        const backCamera = videoDevices.find(d =>
          d.label.toLowerCase().includes('back') ||
          d.label.toLowerCase().includes('rear') ||
          d.label.toLowerCase().includes('arrière') ||
          d.label.toLowerCase().includes('environment')
        );
        if (backCamera) {
          setDefaultCameraId(backCamera.deviceId);
        } else {
          // Fallback to first camera if no back camera found
          setDefaultCameraId(videoDevices[0].deviceId);
        }
      }
    } catch (err) {
      logger.error('Failed to enumerate cameras', { error: err instanceof Error ? err.message : String(err) });
      setCameraLoadState('error');
    }
  }, [cameraLoadState, defaultCameraId, setDefaultCameraId]);

  const handleCopyEncoderLinksite = useCallback(async () => {
    if (isCopyingEncoderLinksite) {
      return;
    }

    setIsCopyingEncoderLinksite(true);

    try {
      const dataUrl = await buildEncoderLinksiteDataUrl();
      await copyTextToClipboard(dataUrl);
      showToast(t('encoder.encoderLinksiteCopied'), 'success');
    } catch (err) {
      logger.error('Failed to copy encoder linksite URL from settings', { error: err instanceof Error ? err.message : String(err) });
      showToast(t('encoder.encoderLinksiteCopyFailed'), 'error');
    } finally {
      setIsCopyingEncoderLinksite(false);
    }
  }, [isCopyingEncoderLinksite, showToast, t]);

  useEffect(() => {
    if (cameraDropdownOpen && cameraLoadState === 'idle') {
      void loadCameras();
    }
  }, [cameraDropdownOpen, cameraLoadState, loadCameras]);

  // If a default camera is already saved, resolve camera list immediately
  // so Settings can show the actual camera name without waiting for dropdown click.
  useEffect(() => {
    if (!defaultCameraId || cameraLoadState !== 'idle') return;
    void loadCameras(false);
  }, [defaultCameraId, cameraLoadState, loadCameras]);

  // If silent load did not provide labels, try once with permission when dropdown opens.
  useEffect(() => {
    if (!cameraDropdownOpen) {
      cameraLabelRefreshAttemptedRef.current = false;
      return;
    }
    const hasNamedCamera = availableCameras.some((camera) => Boolean(camera.label));
    if (
      cameraLoadState === 'ready' &&
      availableCameras.length > 0 &&
      !hasNamedCamera &&
      !cameraLabelRefreshAttemptedRef.current
    ) {
      cameraLabelRefreshAttemptedRef.current = true;
      void loadCameras(true);
    }
  }, [cameraDropdownOpen, cameraLoadState, availableCameras, loadCameras]);

  // Close camera dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        cameraDropdownRef.current &&
        event.target instanceof Node &&
        !cameraDropdownRef.current.contains(event.target)
      ) {
        setCameraDropdownOpen(false);
      }
    };
    if (cameraDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [cameraDropdownOpen]);

  // Get camera display name
  const getCameraDisplayName = (camera: MediaDeviceInfo, index: number) => {
    if (camera.label) {
      const label = camera.label;
      if (label.length > 35) {
        return label.substring(0, 32) + '...';
      }
      return label;
    }
    return `${t('settings.camera')} ${index + 1}`;
  };

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);
  };

  const handleClearData = async () => {
    if (!window.confirm(t('settings.clearDataConfirm'))) {
      return;
    }

    const success = await clearAppData();
    if (success) {
      window.location.reload();
    } else {
      alert(t('settings.clearDataFailed'));
    }
  };

  const handleCredentialsUpdate = useCallback(async () => {
    if (!syncBaseUrl) {
      setCredentialsResult({
        success: false,
        message: t('settings.credentialsInvalidServerUrl'),
      });
      return;
    }

    const username = syncUsernameDraft.trim();
    const password = syncPasswordDraft;
    if (!username || !password) {
      setCredentialsResult({
        success: false,
        message: t('settings.credentialsMissing'),
      });
      return;
    }

    setIsCredentialsUpdating(true);
    setCredentialsResult(null);

    try {
      await updateServerCredentials(uploadConfig, { username, password });
      setUploadConfig({ enabled: true, username, password });
      setCredentialsResult({
        success: true,
        message: authEnabled
          ? t('settings.credentialsResetSuccess')
          : t('settings.credentialsCreateSuccess'),
      });
      showToast(
        authEnabled
          ? t('settings.credentialsResetSuccess')
          : t('settings.credentialsCreateSuccess'),
        'success'
      );
    } catch (error) {
      const message =
        error instanceof Error && error.message.includes('401')
          ? t('settings.authInvalidCredentials')
          : t('settings.credentialsUpdateFailed');
      setCredentialsResult({ success: false, message });
      showToast(message, 'error');
    } finally {
      setIsCredentialsUpdating(false);
    }
  }, [
    authEnabled,
    setUploadConfig,
    showToast,
    syncBaseUrl,
    syncPasswordDraft,
    syncUsernameDraft,
    t,
    uploadConfig,
  ]);

  const resolutionOptions: CameraResolution[] = ['720p', '1080p', '1440p'];

  const handleScannerConfigChange = (updates: Partial<typeof scannerConfig>) => {
    setScannerConfig(updates);
    if (scannerPreset !== 'custom') {
      setScannerPreset('custom');
    }
  };

  const selectedDefaultCamera = defaultCameraId
    ? availableCameras.find((camera) => camera.deviceId === defaultCameraId) || null
    : null;
  const selectedDefaultCameraIndex = selectedDefaultCamera
    ? availableCameras.findIndex((camera) => camera.deviceId === selectedDefaultCamera.deviceId)
    : -1;
  const fallbackDefaultCameraLabel = defaultCameraId
    ? `${t('settings.camera')} (...${defaultCameraId.slice(-6)})`
    : t('settings.selectDefaultCamera');
  const defaultCameraButtonLabel = defaultCameraId
    ? selectedDefaultCamera
      ? getCameraDisplayName(
          selectedDefaultCamera,
          selectedDefaultCameraIndex >= 0 ? selectedDefaultCameraIndex : 0
        )
      : fallbackDefaultCameraLabel
    : availableCameras.length === 0
      ? cameraLoadState === 'loading'
        ? t('common.loading')
        : cameraLoadState === 'ready'
          ? t('settings.noCameraDetected')
          : t('settings.selectDefaultCamera')
      : t('settings.selectDefaultCamera');

  const settingsMenuItems = [
    {
      id: 'settings-encoder',
      section: 'encoder' as const,
      icon: 'qr_code_2',
      label: 'Encoder',
      description: `${encoderConfig.fps} ${t('common.fps')} · ${encoderConfig.packetSize} ${t('common.bytes')}`,
    },
    {
      id: 'settings-scanner',
      section: 'scanner' as const,
      icon: 'qr_code_scanner',
      label: 'Scanner',
      description: t(`settings.presets.${scannerPreset}`),
    },
    {
      id: 'sync-section',
      section: 'sync' as const,
      icon: 'cloud',
      label: 'Server sync',
      description: `Sync: ${syncStatusBadge.label}`,
    },
    {
      id: 'settings-appearance',
      section: 'appearance' as const,
      icon: 'settings',
      label: 'Appearance',
      description: t(`settings.theme${theme.charAt(0).toUpperCase() + theme.slice(1)}`),
    },
    {
      id: 'settings-logging',
      section: 'logging' as const,
      icon: 'description',
      label: 'Logging',
      description: loggingConfig.level.toUpperCase(),
    },
    {
      id: 'settings-about',
      section: 'about' as const,
      icon: 'info',
      label: 'About',
      description: APP_INFO.version,
    },
  ];

  const selectedSettingsItem = settingsMenuItems.find(
    (item) => item.section === selectedSettingsSection
  );

  return (
    <div className="airqr-screen flex flex-col animate-fade-in"><div className="airqr-content flex flex-col gap-4 px-4 py-4 pb-28">
      <div className={`airqr-settings-menu ${selectedSettingsSection === null ? '' : 'hidden'}`}>
        {settingsMenuItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSelectedSettingsSection(item.section)}
            className="airqr-settings-menu-row"
          >
            <Icon name={item.icon} className="airqr-settings-menu-icon" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[20px] font-semibold leading-6 text-white">
                {item.label}
              </span>
              <span className="mt-1 block truncate text-[15px] font-medium text-white/62">
                {item.description}
              </span>
            </span>
          </button>
        ))}
      </div>

      {selectedSettingsSection !== null ? (
        <div className="airqr-page-header pt-2">
          <button
            type="button"
            onClick={() => setSelectedSettingsSection(null)}
            aria-label="Back to settings"
            className="airqr-settings-back-button"
          >
            <span className="airqr-settings-back-surface" aria-hidden="true">
              <Icon name="arrow_back" className="airqr-settings-back-icon" />
            </span>
          </button>
          <h1 className="airqr-page-title">
            {selectedSettingsItem?.label}
          </h1>
        </div>
      ) : null}

      {/* ENCODER SECTION */}
      <div id="settings-encoder" className={`airqr-settings-group scroll-mt-4 ${selectedSettingsSection === 'encoder' ? '' : 'hidden'}`}>
        {/* FPS */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-semibold text-white/82 flex items-center gap-1.5">
              {t('encoder.frameRate')}
              <HelpTip text="How many QR frames per second. Higher is faster but harder to scan." />
            </label>
            <span className="text-sm font-bold text-[var(--airqr-text-primary)]">
              {encoderConfig.fps} {t('common.fps')}
            </span>
          </div>
          <input
            type="range"
            min="1"
            max="60"
            value={encoderConfig.fps}
            onChange={(e) => setEncoderConfig({ fps: Number(e.target.value) })}
            className="airqr-range"
            style={getRangeProgressStyle(encoderConfig.fps, 1, 60)}
          />
          <div className="flex justify-between text-xs text-white/40 mt-1">
            <span>{t('settings.slowFps')}</span>
            <span>{t('settings.fastFps')}</span>
          </div>
        </div>

        {/* Packet Size */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-semibold text-white/82 flex items-center gap-1.5">
              {t('encoder.packetSize')}
              <HelpTip text="Data bytes per QR frame. Larger means fewer frames but denser QR codes." />
            </label>
            <span className="text-sm font-bold text-[var(--airqr-text-primary)]">
              {encoderConfig.packetSize} {t('common.bytes')}
            </span>
          </div>
          <input
            type="range"
            min="100"
            max="2800"
            step="100"
            value={encoderConfig.packetSize}
            onChange={(e) => setEncoderConfig({ packetSize: Number(e.target.value) })}
            className="airqr-range"
            style={getRangeProgressStyle(encoderConfig.packetSize, 100, 2800)}
          />
          <div className="flex justify-between text-xs text-white/40 mt-1">
            <span>{t('settings.smallPacket')}</span>
            <span>{t('settings.largePacket')}</span>
          </div>
        </div>

        {/* ECC Level */}
        <div className="py-3">
          <div className="flex items-center justify-between">
            <label className="text-sm font-semibold text-white/82 flex items-center gap-1.5">
              {t('encoder.errorCorrection')}
              <HelpTip text="QR error correction level. Higher recovers more damage but reduces data capacity." />
            </label>
            <select
              value={encoderConfig.ecc}
              onChange={(e) =>
                setEncoderConfig({
                  ecc: toEccLevel(e.target.value, encoderConfig.ecc),
                })
              }
              className="airqr-settings-control px-3 py-2 text-sm font-semibold text-[var(--airqr-text-primary)] cursor-pointer"
            >
              {ECC_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Target QR Size */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-semibold text-white/82 flex items-center gap-1.5">
              {t('encoder.targetQrSize')}
              <HelpTip text="Display size of the QR code on screen. Larger is easier to scan from a distance." />
            </label>
            <span className="text-sm font-bold text-[var(--airqr-text-primary)]">
              {encoderConfig.targetSize}px
            </span>
          </div>
          <input
            type="range"
            min="100"
            max="400"
            step="10"
            value={encoderConfig.targetSize}
            onChange={(e) => setEncoderConfig({ targetSize: Number(e.target.value) })}
            className="airqr-range"
            style={getRangeProgressStyle(encoderConfig.targetSize, 100, 400)}
          />
        </div>

        {/* RaptorQ Overhead */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-semibold text-white/82 flex items-center gap-1.5">
              {t('encoder.raptorqOverhead')}
              <HelpTip text="Extra fountain-coded packets multiplier. Higher improves reliability but slows transfer." />
            </label>
            <span className="text-sm font-bold text-[var(--airqr-text-primary)]">
              {encoderConfig.raptorqOverhead.toFixed(1)}x
            </span>
          </div>
          <input
            type="range"
            min="1.0"
            max="3.0"
            step="0.1"
            value={encoderConfig.raptorqOverhead}
            onChange={(e) => setEncoderConfig({ raptorqOverhead: Number(e.target.value) })}
            className="airqr-range"
            style={getRangeProgressStyle(encoderConfig.raptorqOverhead, 1, 3)}
          />
          <div className="flex justify-between text-xs text-white/40 mt-1">
            <span>{t('encoder.lessRedundancy')}</span>
            <span>{t('encoder.moreRedundancy')}</span>
          </div>
        </div>

        {/* Compression Toggle */}
        <Toggle
          label={<span className="flex items-center gap-1.5">{t('encoder.compression')} <HelpTip text="Enable zstd compression before encoding. Helps for compressible files." /></span>}
          checked={encoderConfig.compressionEnabled}
          onChange={(enabled) => setEncoderConfig({ compressionEnabled: enabled })}
          className="py-3 border-t airqr-settings-divider"
        />

        {/* Force Chunk Mode */}
        <Toggle
          label={<span className="flex items-center gap-1.5">{t('encoder.forceChunkMode')} <HelpTip text="Split large files into multiple GIFs for easier scanning." /></span>}
          checked={encoderConfig.forceChunkMode}
          onChange={(enabled) => setEncoderConfig({ forceChunkMode: enabled })}
          className="py-3 border-t airqr-settings-divider"
        />

        {/* Chunk Size */}
        {encoderConfig.forceChunkMode && (
          <div className="pt-3">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold text-white/82">
                {t('encoder.chunkSize')}
              </label>
              <span className="text-sm font-bold text-[var(--airqr-text-primary)]">
                {encoderConfig.customChunkSize} MB
              </span>
            </div>
            <input
              type="range"
              min="1"
              max="50"
              value={encoderConfig.customChunkSize}
              onChange={(e) => setEncoderConfig({ customChunkSize: Number(e.target.value) })}
              className="airqr-range"
              style={getRangeProgressStyle(encoderConfig.customChunkSize, 1, 50)}
            />
          </div>
        )}
      </div>

      {/* SCANNER SECTION */}
      <div id="settings-scanner" className={`airqr-settings-group scroll-mt-4 ${selectedSettingsSection === 'scanner' ? '' : 'hidden'}`}>
        {/* Scanner Presets */}
        <div className="mb-6">
          <label className="text-sm font-semibold text-white/82 block mb-3">
            {t('settings.preset')}
          </label>
          <div className="space-y-2">
            {(['turbo', 'fast', 'balanced', 'reliable', 'custom'] as const).map((presetKey) => {
              const preset = SCANNER_PRESETS[presetKey];
              const presetName = t(`settings.presets.${presetKey}`);
              const presetDesc = t(`settings.presets.${presetKey}Desc`);
              return (
                <button
                  key={presetKey}
                  onClick={() => applyScannerPreset(presetKey)}
                  className={`w-full p-3 rounded-[20px] text-left transition-all flex items-center gap-3 ${
                    scannerPreset === presetKey
                      ? "bg-[var(--airqr-nav-active)] text-[var(--airqr-text-primary)]"
                      : "bg-[var(--airqr-control-surface)] text-[var(--airqr-text-secondary)] hover:bg-[var(--airqr-action-hover)] hover:text-[var(--airqr-text-primary)]"
                  }`}
                >
                  <span className="text-xl">{preset.emoji}</span>
                  <div className="flex-1">
                    <div className={`font-bold ${scannerPreset === presetKey ? "text-[var(--airqr-text-primary)]" : "text-[var(--airqr-text-primary)]"}`}>
                      {presetName}
                    </div>
                    <div className="text-xs text-[var(--airqr-text-muted)]">
                      {presetDesc}
                    </div>
                  </div>
                  {scannerPreset === presetKey && (
                    <Icon name="check_circle" className="text-[var(--airqr-accent-text)]" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Default Camera Selector */}
        <div className="mb-6">
          <label
            id={defaultCameraLabelId}
            className="text-sm font-semibold text-white/82 block mb-3"
          >
            {t('settings.defaultCamera')}
          </label>
          <div className="relative" ref={cameraDropdownRef}>
            <button
              type="button"
              onClick={() => setCameraDropdownOpen(!cameraDropdownOpen)}
              aria-label={t('settings.defaultCamera')}
              aria-expanded={cameraDropdownOpen}
              aria-haspopup="listbox"
              aria-labelledby={`${defaultCameraLabelId} ${defaultCameraValueId}`}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm font-semibold airqr-settings-control cursor-pointer"
            >
              <Icon name="videocam" className="text-[var(--airqr-text-muted)] text-lg" />
              <span id={defaultCameraValueId} className="flex-1 text-left truncate">
                {defaultCameraButtonLabel}
              </span>
              <svg
                className={`w-5 h-5 text-[var(--airqr-text-muted)] transition-transform ${cameraDropdownOpen ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Camera Dropdown */}
            {cameraDropdownOpen && (
              <div className="airqr-settings-menu absolute z-50 w-full mt-2 max-h-[200px] overflow-y-auto overflow-hidden rounded-[22px] shadow-2xl">
                {cameraLoadState === 'loading' && (
                  <div className="px-4 py-3 text-sm font-semibold text-[var(--airqr-text-muted)]">
                    {t('common.loading')}
                  </div>
                )}
                {cameraLoadState === 'error' && (
                  <div className="px-4 py-3 text-sm font-semibold text-[var(--airqr-danger-text)]">
                    {t('common.error')}
                  </div>
                )}
                {cameraLoadState === 'ready' && availableCameras.length === 0 && (
                  <div className="px-4 py-3 text-sm font-semibold text-[var(--airqr-text-muted)]">
                    {t('settings.noCameraDetected')}
                  </div>
                )}
                {availableCameras.map((camera, index) => (
                  <button
                    key={camera.deviceId}
                    type="button"
                    onClick={() => {
                      setDefaultCameraId(camera.deviceId);
                      setCameraDropdownOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-semibold text-left transition-colors ${
                      defaultCameraId === camera.deviceId
                        ? 'bg-[var(--airqr-nav-active)] text-[var(--airqr-text-primary)]'
                        : 'text-[var(--airqr-text-secondary)] hover:bg-[var(--airqr-action-hover)] hover:text-[var(--airqr-text-primary)]'
                    }`}
                  >
                    <Icon
                      name={
                        camera.label?.toLowerCase().includes('front') || camera.label?.toLowerCase().includes('avant')
                          ? 'photo_camera_front'
                          : 'photo_camera_back'
                      }
                      className="text-lg"
                    />
                    <span className="flex-1 truncate">{getCameraDisplayName(camera, index)}</span>
                    {defaultCameraId === camera.deviceId && (
                      <Icon name="check" className="text-[var(--airqr-accent-text)] text-lg" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <p className="text-xs text-white/40 mt-2">
            {t('settings.defaultCameraDesc')}
          </p>
        </div>

        {/* Advanced Configuration */}
        <div className="border-t airqr-settings-divider pt-4">
          <p className="text-xs text-white/40 mb-4">
            {t('settings.customModeHint')}
          </p>

          {/* Scan Interval */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold text-white/82">
                {t('settings.scanInterval')}
              </label>
              <span className="text-sm font-bold text-[var(--airqr-text-primary)]">
                {scannerConfig.scanInterval}ms
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="500"
              step="10"
              value={scannerConfig.scanInterval}
              onChange={(e) =>
                handleScannerConfigChange({ scanInterval: Number(e.target.value) })
              }
              className="airqr-range"
              style={getRangeProgressStyle(scannerConfig.scanInterval, 0, 500)}
            />
            <div className="flex justify-between text-xs text-white/40 mt-1">
              <span>{t('settings.maxSpeed')}</span>
              <span>{t('settings.batterySaver')}</span>
            </div>
          </div>

          {/* Resolution */}
          <div className="mb-4">
            <label className="text-sm font-semibold text-white/82 block mb-2">
              {t('settings.resolution')}
            </label>
            <ConnectedSegmentedControl
              ariaLabel={t('settings.resolution')}
              options={resolutionOptions.map((resolution) => ({
                value: resolution,
                label: resolution,
              }))}
              value={scannerConfig.resolution}
              onChange={(resolution) =>
                handleScannerConfigChange(
                  isCameraResolution(resolution) ? { resolution } : {}
                )
              }
            />
          </div>

          {/* Detection Speed */}
          <div className="mb-4">
            <label className="text-sm font-semibold text-white/82 block mb-2">
              {t('settings.detectionSpeed')}
            </label>
            <ConnectedSegmentedControl
              ariaLabel={t('settings.detectionSpeed')}
              options={[
                { value: 'fast', label: t('settings.fast') },
                { value: 'accurate', label: t('settings.accurate') },
              ]}
              value={scannerConfig.tryHarder ? 'accurate' : 'fast'}
              onChange={(speed) =>
                handleScannerConfigChange({ tryHarder: speed === 'accurate' })
              }
            />
            <p className="text-xs text-white/40 mt-2">
              {t('settings.accurateModeHint')}
            </p>
          </div>

          {/* Torch */}
          <Toggle
            label={t('settings.torch')}
            description={t('settings.torchDesc')}
            checked={scannerConfig.enableTorch}
            onChange={(enabled) => handleScannerConfigChange({ enableTorch: enabled })}
            className="py-3 border-t airqr-settings-divider"
          />
        </div>

        {/* Tip */}
        <div className="airqr-status-warning mt-4 rounded-[18px] p-3">
          <p className="text-xs font-semibold">
            <strong>💡 {t('settings.tipLabel')}</strong> {t('settings.scannerTip')}
          </p>
        </div>

        {/* Benchmark */}
        <button
          onClick={() => navigate('/benchmark')}
          className="airqr-action-button mt-4 w-full py-3 px-4 rounded-full font-semibold text-sm flex items-center justify-center gap-2 transition-colors"
        >
          <Icon name="speed" className="text-xl text-[var(--airqr-accent-text)]" />
          {t('settings.benchmarkButton', 'Find optimal QR settings')}
        </button>
        <p className="text-xs text-white/40 mt-2 text-center">
          {t('settings.benchmarkDesc', 'Find the fastest transfer speed for your device')}
        </p>
      </div>

      {/* SERVER SYNC SECTION */}
      <div id="sync-section" className={`airqr-settings-group scroll-mt-4 ${selectedSettingsSection === 'sync' ? '' : 'hidden'}`}>
        <div className="mb-4 flex justify-end">
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${syncStatusBadge.className}`}
          >
            {syncStatusBadge.label}
          </span>
        </div>

        <Toggle
          label={t('settings.enableSync')}
          description={t('settings.enableSyncDesc')}
          checked={uploadConfig.enabled}
          onChange={(enabled) => {
            // Set default URL when enabling sync for the first time
            if (enabled && !uploadConfig.url) {
              setUploadConfig({
                enabled,
                url: 'same-origin',
                username: ''
              });
            } else {
              setUploadConfig({ enabled });
            }
            clearSyncTestResult();
          }}
          className="py-3"
        />

        {uploadConfig.enabled && (
          <div className="mt-3 space-y-4 border-t airqr-settings-divider pt-4">
            {/* Server URL */}
            <div>
              <label
                htmlFor={syncServerUrlInputId}
                className="text-sm font-semibold text-white/82"
              >
                {t('settings.serverUrl')}
              </label>
              <input
                id={syncServerUrlInputId}
                aria-label={t('settings.serverUrl')}
                type="url"
                value={uploadConfig.url}
                onChange={(e) => {
                  setUploadConfig({ url: e.target.value });
                  clearSyncTestResult();
                }}
                placeholder={t('settings.sameOriginPlaceholder')}
                className="mt-2 w-full px-3 py-2 text-sm airqr-settings-control"
              />
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/40">
                <span>{t('settings.serverUrlHint')}</span>
                <span className="font-medium text-white/70">
                  {t('settings.serverSyncModeLabel', {
                    mode:
                      syncAccessMode === 'same-origin'
                        ? t('settings.serverSyncModeSameOrigin')
                        : t('settings.serverSyncModeExternal'),
                  })}
                </span>
              </div>
            </div>

            {/* Username */}
            <div>
              <label
                htmlFor={syncUsernameInputId}
                className="text-sm font-semibold text-white/82"
              >
                {t('settings.username')}
              </label>
              <input
                id={syncUsernameInputId}
                aria-label={t('settings.username')}
                type="text"
                value={syncUsernameDraft}
                onChange={(e) => setSyncUsernameDraft(e.target.value)}
                placeholder={t('settings.usernamePlaceholder')}
                autoComplete="username"
                className="mt-2 w-full px-3 py-2 text-sm airqr-settings-control"
              />
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor={syncPasswordInputId}
                className="text-sm font-semibold text-white/82"
              >
                {t('settings.password')}
              </label>
              <input
                id={syncPasswordInputId}
                aria-label={t('settings.password')}
                type="password"
                value={syncPasswordDraft}
                onChange={(e) => setSyncPasswordDraft(e.target.value)}
                placeholder="••••••"
                autoComplete="current-password"
                className="mt-2 w-full px-3 py-2 text-sm airqr-settings-control"
              />
            </div>

            {canManageServerCredentials && (
              <div className="rounded-[22px] bg-[var(--airqr-nav-active)] p-3">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white/86">
                      {authEnabled
                        ? t('settings.credentialsResetTitle')
                        : t('settings.credentialsCreateTitle')}
                    </p>
                    <p className="mt-1 text-xs font-medium text-white/46">
                      {authEnabled
                        ? t('settings.credentialsResetDesc')
                        : t('settings.credentialsCreateDesc')}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleCredentialsUpdate}
                    disabled={
                      isCredentialsUpdating ||
                      !uploadConfig.url ||
                      !syncUsernameDraft.trim() ||
                      !syncPasswordDraft
                    }
                    className="shrink-0 gap-2"
                  >
                    {isCredentialsUpdating ? (
                      <>
                        <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
                        {t('settings.credentialsSaving')}
                      </>
                    ) : (
                      <>
                        <Icon name={authEnabled ? 'restart_alt' : 'add'} className="text-lg" />
                        {authEnabled
                          ? t('settings.credentialsResetAction')
                          : t('settings.credentialsCreateAction')}
                      </>
                    )}
                  </Button>
                </div>
                {credentialsResult && (
                  <div
                    className={`mt-3 flex items-center gap-2 rounded-[18px] px-3 py-2 text-xs font-semibold ${
                      credentialsResult.success
                        ? 'airqr-status-success'
                        : 'airqr-status-danger'
                    }`}
                  >
                    <Icon
                      name={credentialsResult.success ? 'check_circle' : 'error'}
                      className="text-base"
                    />
                    <span>{credentialsResult.message}</span>
                  </div>
                )}
              </div>
            )}

            {/* Sync Scanned Files */}
            <Toggle
              label={t('settings.syncScanned')}
              description={t('settings.syncScannedDesc')}
              checked={syncScanned}
              onChange={(syncScanned) => setUploadConfig({ syncScanned })}
              className="py-3 border-t airqr-settings-divider"
            />

            {/* Sync Generated Files */}
            <Toggle
              label={t('settings.syncGenerated')}
              description={t('settings.syncGeneratedDesc')}
              checked={syncGenerated}
              onChange={(syncGenerated) => setUploadConfig({ syncGenerated })}
              className="py-3 border-t airqr-settings-divider"
            />

            {/* Auto Sync */}
            <Toggle
              label={t('settings.autoSync')}
              description={t('settings.autoSyncDesc')}
              checked={autoSyncHistory}
              onChange={(autoSyncHistory) => setUploadConfig({ autoSyncHistory })}
              className="py-3 border-t airqr-settings-divider"
            />

            {/* Connection and Sync buttons */}
            <div className="pt-4 border-t airqr-settings-divider">
              <div className="flex gap-3">
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleConnectionAction}
                  disabled={isConnectionUpdating || !uploadConfig.url}
                  className="flex-1 flex items-center justify-center gap-2"
                >
                  {isConnectionUpdating ? (
                    <>
                      <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
                      {isConnectionDisconnectAction
                        ? t('settings.disconnecting')
                        : t('settings.connecting')}
                    </>
                  ) : (
                    <>
                      <Icon name="wifi_tethering" className="text-lg" />
                      {isConnectionDisconnectAction
                        ? t('settings.disconnectAction')
                        : t('settings.connectionAction')}
                    </>
                  )}
                </Button>
                <Button
                  variant="secondary"
                  size="md"
                  onClick={performSync}
                  disabled={isSyncing || !uploadConfig.url}
                  className="airqr-sync-button min-w-0 flex-1 flex items-center justify-center gap-2 whitespace-nowrap disabled:!bg-[var(--airqr-disabled-surface)] disabled:!text-[var(--airqr-disabled-text)]"
                >
                  {isSyncing ? (
                    <>
                      <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></span>
                      {t('settings.syncing')}
                    </>
                  ) : (
                    <>
                      <Icon name="sync" className="airqr-sync-icon text-lg" />
                      {t('settings.syncNow')}
                    </>
                  )}
                </Button>
              </div>

              {/* Result message */}
              {syncTestResult && (
                <div
                  className={`mt-3 flex items-center gap-2 rounded-[18px] px-3 py-2 text-sm font-semibold ${
                    syncTestResult.success
                      ? 'airqr-status-success'
                      : 'airqr-status-danger'
                  }`}
                >
                  <Icon
                    name={syncTestResult.success ? 'check_circle' : 'error'}
                    className="text-lg"
                  />
                  <span>{syncTestResult.message}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* FILE EXPORT SECTION */}
      {uploadConfig.enabled && uploadConfig.url && (
        <div id="settings-export" className={`airqr-settings-group scroll-mt-4 ${selectedSettingsSection === 'sync' ? '' : 'hidden'}`}>
          <h2 className="airqr-section-title mb-4">
            {t('settings.fileExportSection')}
          </h2>

          <p className="text-xs text-white/40 mb-4">
            {t('settings.fileExportDesc')}
          </p>

          {exportConfigError && (
            <div className="airqr-status-danger mb-4 rounded-[18px] px-3 py-2">
              <p className="text-xs font-semibold">{exportConfigError}</p>
            </div>
          )}

          {exportConfigSaved && (
            <div className="airqr-status-success mb-4 rounded-[18px] px-3 py-2">
              <p className="text-xs font-semibold">{t('settings.configSaved')}</p>
            </div>
          )}

          <Toggle
            label={t('settings.enableExport')}
            description={t('settings.enableExportDesc')}
            checked={exportConfig.enabled}
            onChange={(enabled) => saveExportConfig({ enabled })}
            disabled={exportConfigLoading}
            className="py-3"
          />

          <div className="mt-3 space-y-4 border-t airqr-settings-divider pt-4">
            <Toggle
              label={t('settings.exportScanned')}
              description={t('settings.exportScannedDesc')}
              checked={exportConfig.exportScanned}
              onChange={(exportScanned) => saveExportConfig({ exportScanned })}
              disabled={exportConfigLoading || !exportConfig.enabled}
              className="py-3"
            />

            <Toggle
              label={t('settings.exportGenerated')}
              description={t('settings.exportGeneratedDesc')}
              checked={exportConfig.exportGenerated}
              onChange={(exportGenerated) => saveExportConfig({ exportGenerated })}
              disabled={exportConfigLoading || !exportConfig.enabled}
              className="py-3 border-t airqr-settings-divider"
            />

            <div>
              <label
                htmlFor={exportDirectoryInputId}
                className="text-sm font-semibold text-white/82"
              >
                {t('settings.exportDirectory')}
              </label>
              <div className="flex gap-2 mt-2">
                <input
                  id={exportDirectoryInputId}
                  aria-label={t('settings.exportDirectory')}
                  type="text"
                  value={exportDirInput}
                  onChange={(e) => setExportDirInput(e.target.value)}
                  placeholder={t('settings.exportDirectoryPlaceholder')}
                  disabled={exportConfigLoading || !exportConfig.enabled}
                  className="flex-1 px-3 py-2 text-sm airqr-settings-control"
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => saveExportConfig({ exportDir: exportDirInput || null })}
                  disabled={exportConfigLoading || !exportConfig.enabled}
                >
                  {exportConfigLoading ? '...' : t('common.save')}
                </Button>
              </div>
              <p className="mt-1 text-xs text-white/40">
                {t('settings.exportDirectoryHint')}
              </p>
            </div>

            {exportConfig.exportDir && exportConfig.exportDirValid === false && (
              <div className="airqr-status-warning rounded-[18px] p-3">
                <p className="text-xs font-semibold">
                  <strong>{t('settings.pathWarning')}</strong> {exportConfig.exportDirError || 'Unknown error'}
                </p>
                <p className="mt-1 text-xs text-[var(--airqr-text-secondary)]">
                  {t('settings.nasHint')}
                </p>
              </div>
            )}

            {exportConfig.exportDir && exportConfig.exportDirValid === true && (
              <div className="airqr-status-success rounded-[18px] p-3">
                <p className="text-xs font-semibold">
                  <strong>{t('settings.pathReady')}</strong> {exportConfig.exportDir}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* APPEARANCE SECTION */}
      <div id="settings-appearance" className={`airqr-settings-group scroll-mt-4 ${selectedSettingsSection === 'appearance' ? '' : 'hidden'}`}>
        {/* Language Selector - Custom Dropdown */}
        <LanguageSelector
          language={language}
          setLanguage={setLanguage}
          label={t('settings.language')}
        />

        {/* Theme Selector */}
        <div className="space-y-3">
          <label className="text-sm font-semibold text-white/82">
            {t('settings.theme')}
          </label>
          <ConnectedSegmentedControl
            ariaLabel={t('settings.theme')}
            options={(['light', 'dark', 'system'] as const).map((themeOption) => ({
              value: themeOption,
              label: t(
                `settings.theme${themeOption.charAt(0).toUpperCase() + themeOption.slice(1)}`,
              ),
            }))}
            value={theme}
            onChange={(themeOption) =>
              isThemeOption(themeOption) ? handleThemeChange(themeOption) : undefined
            }
          />
        </div>

        <div className="mt-6 pt-4 border-t airqr-settings-divider">
          <Button
            variant="secondary"
            size="md"
            onClick={handleClearData}
            className="w-full"
          >
            {t('settings.clearData')}
          </Button>
        </div>
      </div>

      {/* LOGGING SECTION */}
      <div id="settings-logging" className={`airqr-settings-group scroll-mt-4 ${selectedSettingsSection === 'logging' ? '' : 'hidden'}`}>
        {/* Log Level */}
        <div className="mb-4">
          <label className="text-sm font-semibold text-white/82 block mb-2">
            Log Level
          </label>
          <ConnectedSegmentedControl
            ariaLabel="Log level"
            value={loggingConfig.level}
            onChange={(level) => {
              if (isLogLevel(level)) {
                setLoggingConfig({ level });
              }
            }}
            options={(['debug', 'info', 'warn', 'error'] as const).map((level) => ({
              value: level,
              label: level.charAt(0).toUpperCase() + level.slice(1),
            }))}
          />
        </div>

        {/* Module Categories */}
        <div className="border-t airqr-settings-divider pt-4">
          <label className="text-sm font-semibold text-white/82 block mb-3">
            Modules
          </label>
          <div className="flex flex-wrap gap-2">
            {Object.entries(loggingConfig.enabledCategories).map(([category, enabled]) => (
              <button
                key={category}
                type="button"
                aria-pressed={enabled}
                onClick={() =>
                  isLoggingCategory(category)
                    ? setLoggingConfig({
                        enabledCategories: { [category]: !enabled },
                      })
                    : undefined
                }
                className={`rounded-full px-4 py-2 text-sm font-bold transition-colors ${
                  enabled
                    ? 'bg-[var(--airqr-primary-button-surface)] text-[var(--airqr-primary-button-text)]'
                    : 'bg-[var(--airqr-control-surface)] text-[var(--airqr-text-muted)] hover:bg-[var(--airqr-action-hover)] hover:text-[var(--airqr-text-primary)]'
                }`}
              >
                {category.charAt(0).toUpperCase() + category.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Reset button */}
        <div className="mt-4 pt-4 border-t airqr-settings-divider">
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              setLoggingConfig({
                level: 'info',
                enabledCategories: {
                  services: true,
                  workers: true,
                  hooks: true,
                  scanner: true,
                  ui: true,
                  app: true,
                },
              })
            }
            className="w-full"
          >
            Reset to defaults
          </Button>
        </div>
      </div>

      <div id="settings-linksite" className={`airqr-settings-group scroll-mt-4 ${selectedSettingsSection === 'encoder' ? '' : 'hidden'}`}>
        <div className="airqr-liquid-alert px-4 py-3 text-sm text-white">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="flex-1">
              <span>{t('encoder.encoderLinksitePrompt')} </span>
              <button
                type="button"
                onClick={handleCopyEncoderLinksite}
                disabled={isCopyingEncoderLinksite}
                className="font-semibold underline decoration-current underline-offset-4 transition-opacity hover:opacity-80 disabled:cursor-wait disabled:opacity-60"
              >
                {isCopyingEncoderLinksite
                  ? t('encoder.copyingEncoderLinksite')
                  : t('encoder.copyEncoderLinksite')}
              </button>
              <span> {t('encoder.encoderLinksiteSuffix')}</span>
            </div>

            <button
              type="button"
              aria-label={t('encoder.encoderLinksiteHelpLabel')}
              aria-expanded={isLinksiteHelpOpen}
              aria-controls="settings-encoder-linksite-help"
              onClick={() => setIsLinksiteHelpOpen((current) => !current)}
              className="airqr-action-button flex size-8 shrink-0 items-center justify-center self-end rounded-full transition-colors sm:self-auto"
            >
              <Icon name="help" className="text-[18px]" />
            </button>
          </div>

          {isLinksiteHelpOpen ? (
            <div
              id="settings-encoder-linksite-help"
              className="mt-3 border-t airqr-settings-divider pt-3"
            >
              <p className="font-semibold text-white">
                {t('encoder.encoderLinksiteHelpTitle')}
              </p>
              <p className="mt-2 text-white/70">
                {t('encoder.encoderLinksiteHelpBody')}
              </p>
              <p className="mt-2 text-white/70">
                {t('encoder.encoderLinksiteHelpFallback')}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={ENCODER_LINKSITE_PATH}
                  download="AirQR_Encoder.html"
                  className="airqr-primary-button inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-bold transition-colors"
                >
                  <Icon name="download" className="text-[16px]" />
                  <span>{t('encoder.downloadEncoderHtml')}</span>
                </a>
                <a
                  href={PORTABLE_SINGLEFILE_PATH}
                  download="airqr-portable.html"
                  className="airqr-primary-button inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-bold transition-colors"
                >
                  <Icon name="download" className="text-[16px]" />
                  <span>{t('encoder.downloadPortableHtml')}</span>
                </a>
              </div>
              <p className="mt-3 text-xs text-white/60">
                {t('encoder.encoderLinksiteConsoleHint')}
              </p>
              <pre className="airqr-liquid-subcard mt-2 overflow-x-auto rounded-[20px] p-3 text-xs leading-5 text-white/80">
                <code>{ENCODER_LINKSITE_CONSOLE_SNIPPET}</code>
              </pre>
            </div>
          ) : null}
        </div>

        <Toggle
          label={t('settings.showEncoderLinksiteNotice')}
          description={t('settings.showEncoderLinksiteNoticeDesc')}
          checked={showEncoderLinksiteNotice}
          onChange={setShowEncoderLinksiteNotice}
          className="mt-4 py-1"
        />
      </div>

      {/* ABOUT SECTION */}
      <div id="settings-about" className={`airqr-settings-group scroll-mt-4 ${selectedSettingsSection === 'about' ? '' : 'hidden'}`}>
        <div className="space-y-4 text-sm text-white/46">
          <div className="flex items-center gap-3">
            <div>
              <img
                src="/logo.svg"
                alt="AirQR logo"
                className="w-10 h-10 object-contain"
              />
            </div>
            <div>
              <h3 className="font-bold text-white">
                {APP_INFO.name}
              </h3>
              <p className="text-xs">{APP_INFO.version}</p>
            </div>
          </div>
          <p>{t('settings.appDescription')}</p>
          <div className="pt-2">
            <p>
              {t('settings.madeWith')}{' '}
              <a href={APP_INFO.authorUrl} target="_blank" rel="noopener noreferrer" className="text-[var(--airqr-accent-text)] font-semibold hover:underline">
                {APP_INFO.author}
              </a>
            </p>
            <a
              href={APP_INFO.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="airqr-primary-button mt-1.5 flex w-fit items-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition-opacity hover:opacity-90"
            >
              <Icon
                name="star"
                className="text-[18px] text-[var(--airqr-primary-button-text)]"
              />
              {t('settings.starOnGithub')}
            </a>
          </div>
        </div>
      </div>

    </div>
    </div>
  );
};
export default SettingsTab;
