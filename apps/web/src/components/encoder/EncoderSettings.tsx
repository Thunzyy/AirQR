/**
 * EncoderSettings - Configuration panel for encoding
 * Matches the original UI with added presets
 */

import React, { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Toggle, Icon, HelpTip } from '../ui';
import { ECC_OPTIONS } from '../../constants';
import type { ECCLevel, EncoderConfig } from '../../types';

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

interface EncoderSettingsProps {
  config: EncoderConfig;
  forceChunkMode: boolean;
  onConfigChange: (updates: Partial<EncoderConfig>) => void;
  onForceChunkModeChange: (enabled: boolean) => void;
}

const EncoderSettings: React.FC<EncoderSettingsProps> = ({
  config,
  forceChunkMode,
  onConfigChange,
  onForceChunkModeChange,
}) => {
  const { t } = useTranslation();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const advancedPanelId = useId();
  const frameRateInputId = useId();
  const packetSizeInputId = useId();
  const errorCorrectionInputId = useId();
  const targetQrSizeInputId = useId();
  const raptorqOverheadInputId = useId();
  const chunkSizeInputId = useId();
  const isEccLevel = (value: string): value is ECCLevel =>
    ECC_OPTIONS.some((option) => option.value === value);
  const toEccLevel = (value: string): ECCLevel =>
    isEccLevel(value) ? value : config.ecc;

  return (
    <div className="flex flex-col gap-4">
      {/* Advanced Settings Collapsible */}
      <div className="airqr-liquid-card flex flex-col rounded-[34px] transition-all duration-300">
        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          aria-expanded={showAdvanced}
          aria-controls={advancedPanelId}
          className="flex w-full items-center justify-between p-4 text-left transition-colors hover:bg-[var(--airqr-control-surface)]"
        >
          <div className="flex items-center gap-2 text-[var(--airqr-text-primary)]">
            <Icon name="settings" className="text-[20px]" />
            <span className="text-sm font-semibold">{t('encoder.advancedSettings')}</span>
          </div>
          <div className={showAdvanced ? "rotate-180" : ""}>
            <Icon name="expand_more" className="transition-transform duration-300" />
          </div>
        </button>

        {showAdvanced ? (
          <div
            id={advancedPanelId}
            className="grid transition-all duration-300 ease-in-out grid-rows-[1fr] opacity-100"
          >
            <div className="overflow-hidden">
            <div className="mt-2 flex flex-col gap-4 border-t border-[var(--airqr-divider)] p-4 pt-0">
              <div className="flex flex-col gap-4 pt-2">
                {/* FPS */}
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <label
                      htmlFor={frameRateInputId}
                      className="text-sm font-medium text-[var(--airqr-text-primary)] flex items-center gap-1.5"
                    >
                      {t('encoder.frameRate')}
                      <HelpTip text="How many QR frames per second. Higher is faster but harder to scan." />
                    </label>
                    <span className="text-sm font-bold text-[var(--airqr-text-primary)]">{config.fps} {t('common.fps')}</span>
                  </div>
                  <input
                    id={frameRateInputId}
                    type="range"
                    min="1"
                    max="60"
                    value={config.fps}
                    onChange={(e) => {
                      onConfigChange({ fps: parseInt(e.target.value) });
                    }}
                    className="airqr-range"
                    style={getRangeProgressStyle(config.fps, 1, 60)}
                  />
                  <div className="flex justify-between text-xs text-[var(--airqr-text-muted)]">
                    <span>{t('encoder.slowFps')}</span>
                    <span>{t('encoder.fastFps')}</span>
                  </div>
                </div>

                {/* Packet Size */}
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <label
                      htmlFor={packetSizeInputId}
                      className="text-sm font-medium text-[var(--airqr-text-primary)] flex items-center gap-1.5"
                    >
                      {t('encoder.packetSize')}
                      <HelpTip text="Data bytes per QR frame. Larger means fewer frames but denser QR codes." />
                    </label>
                    <span className="text-sm font-bold text-[var(--airqr-text-primary)]">{config.packetSize} {t('common.bytes')}</span>
                  </div>
                  <input
                    id={packetSizeInputId}
                    type="range"
                    min="100"
                    max="2800"
                    step="100"
                    value={config.packetSize}
                    onChange={(e) => {
                      onConfigChange({ packetSize: parseInt(e.target.value) });
                    }}
                    className="airqr-range"
                    style={getRangeProgressStyle(config.packetSize, 100, 2800)}
                  />
                  <div className="flex justify-between text-xs text-[var(--airqr-text-muted)]">
                    <span>{t('encoder.smallPacket')}</span>
                    <span>{t('encoder.largePacket')}</span>
                  </div>
                </div>

                {/* ECC Level */}
                <div className="flex items-center justify-between">
                  <label
                    htmlFor={errorCorrectionInputId}
                    className="text-sm font-medium text-[var(--airqr-text-primary)] flex items-center gap-1.5"
                  >
                    {t('encoder.errorCorrection')}
                    <HelpTip text="QR error correction level. Higher recovers more damage but reduces data capacity." />
                  </label>
                  <select
                    id={errorCorrectionInputId}
                    value={config.ecc}
                    onChange={(e) => {
                      onConfigChange({ ecc: toEccLevel(e.target.value) });
                    }}
                    className="airqr-input cursor-pointer px-3 py-2 text-sm font-semibold text-[var(--airqr-text-primary)]"
                  >
                    {ECC_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                {/* Target QR Size */}
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <label
                      htmlFor={targetQrSizeInputId}
                      className="text-sm font-medium text-[var(--airqr-text-primary)] flex items-center gap-1.5"
                    >
                      {t('encoder.targetQrSize')}
                      <HelpTip text="Display size of the QR code on screen. Larger is easier to scan from a distance." />
                    </label>
                    <span className="text-sm font-bold text-[var(--airqr-text-primary)]">{config.targetSize}px</span>
                  </div>
                  <input
                    id={targetQrSizeInputId}
                    type="range"
                    min="100"
                    max="500"
                    step="10"
                    value={config.targetSize}
                    onChange={(e) => {
                      onConfigChange({ targetSize: parseInt(e.target.value) });
                    }}
                    className="airqr-range"
                    style={getRangeProgressStyle(config.targetSize, 100, 500)}
                  />
                </div>

                {/* RaptorQ Overhead */}
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <label
                      htmlFor={raptorqOverheadInputId}
                      className="text-sm font-medium text-[var(--airqr-text-primary)] flex items-center gap-1.5"
                    >
                      {t('encoder.raptorqOverhead')}
                      <HelpTip text="Extra fountain-coded packets multiplier. Higher improves reliability but slows transfer." />
                    </label>
                    <span className="text-sm font-bold text-[var(--airqr-text-primary)]">{config.raptorqOverhead.toFixed(1)}x</span>
                  </div>
                  <input
                    id={raptorqOverheadInputId}
                    type="range"
                    min="1.0"
                    max="3.0"
                    step="0.1"
                    value={config.raptorqOverhead}
                    onChange={(e) => {
                      onConfigChange({ raptorqOverhead: parseFloat(e.target.value) });
                    }}
                    className="airqr-range"
                    style={getRangeProgressStyle(config.raptorqOverhead, 1, 3)}
                  />
                </div>

                {/* Compression */}
                <div className="flex flex-col gap-2 py-2">
                  <Toggle
                    label={<span className="flex items-center gap-1.5">{t('encoder.compression')} <HelpTip text="Enable zstd compression before encoding. Helps for compressible files." /></span>}
                    checked={config.compressionEnabled}
                    onChange={(enabled) => onConfigChange({ compressionEnabled: enabled })}
                  />
                </div>

                {/* Force Chunk Mode */}
                <div className="flex flex-col gap-2 py-2">
                  <Toggle
                    label={<span className="flex items-center gap-1.5">{t('encoder.forceChunkMode')} <HelpTip text="Split large files into multiple GIFs for easier scanning." /></span>}
                    checked={forceChunkMode}
                    onChange={(enabled) => onForceChunkModeChange(enabled)}
                  />
                </div>

                {/* Chunk Size */}
                {forceChunkMode && (
                  <div className="flex flex-col gap-2 pl-4 border-l-2 border-[var(--airqr-accent)] animate-fade-in">
                    <div className="flex justify-between items-center">
                      <label
                        htmlFor={chunkSizeInputId}
                        className="text-sm font-medium text-[var(--airqr-text-primary)]"
                      >
                        {t('encoder.chunkSize')}
                      </label>
                      <span className="text-sm font-bold text-[var(--airqr-text-primary)]">{config.customChunkSize} MB</span>
                    </div>
                    <input
                      id={chunkSizeInputId}
                      type="range"
                      min="0.1"
                      max="50"
                      step="0.1"
                      value={config.customChunkSize}
                      onChange={(e) => onConfigChange({ customChunkSize: parseFloat(e.target.value) })}
                      className="airqr-range"
                      style={getRangeProgressStyle(config.customChunkSize, 0.1, 50)}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
export default EncoderSettings;
