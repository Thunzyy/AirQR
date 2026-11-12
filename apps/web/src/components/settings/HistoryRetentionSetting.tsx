/**
 * How long the sync server keeps history entries, or never deletes them.
 */

import React, { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Toggle } from '../ui';
import { useConfirmDialog } from '../ui/useConfirmDialog';
import type { ScanUploadConfig } from '../../types';
import {
  HISTORY_RETENTION_MAX_DAYS,
  HISTORY_RETENTION_MIN_DAYS,
  fetchHistoryRetention,
  saveHistoryRetention,
  type HistoryRetention,
} from '../../services/serverRetention';
import { createLogger } from '../../utils/logger';

const logger = createLogger('ui:historyRetention');

type RetentionLoadState = 'loading' | 'ready' | 'unavailable';

interface HistoryRetentionSettingProps {
  uploadConfig: Pick<ScanUploadConfig, 'url' | 'apiKey' | 'username' | 'password'>;
}

const parseDays = (value: string): number | null => {
  if (!/^\d+$/.test(value.trim())) return null;
  const days = Number(value);
  return days >= HISTORY_RETENTION_MIN_DAYS && days <= HISTORY_RETENTION_MAX_DAYS
    ? days
    : null;
};

const HistoryRetentionSetting: React.FC<HistoryRetentionSettingProps> = ({ uploadConfig }) => {
  const { t } = useTranslation();
  const daysInputId = useId();
  const [loadState, setLoadState] = useState<RetentionLoadState>('loading');
  const [current, setCurrent] = useState<HistoryRetention | null>(null);
  const [neverDelete, setNeverDelete] = useState(false);
  const [daysText, setDaysText] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const { confirm, confirmDialog } = useConfirmDialog();

  const { url, apiKey, username, password } = uploadConfig;

  useEffect(() => {
    let cancelled = false;
    setLoadState('loading');
    fetchHistoryRetention({ url, apiKey, username, password })
      .then((retention) => {
        if (cancelled) return;
        setCurrent(retention);
        setNeverDelete(retention.historyDays === null);
        setDaysText(String(retention.historyDays ?? retention.defaultHistoryDays ?? 90));
        setLoadState('ready');
      })
      .catch((error) => {
        if (cancelled) return;
        logger.warn('Could not load the server history retention', {
          error: error instanceof Error ? error.message : String(error),
        });
        setLoadState('unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, [url, apiKey, username, password]);

  if (loadState === 'loading') {
    return (
      <p className="py-3 border-t airqr-settings-divider text-xs text-[var(--airqr-text-muted)]">
        {t('settings.historyRetentionLoading')}
      </p>
    );
  }

  if (loadState === 'unavailable' || !current) {
    return (
      <p className="py-3 border-t airqr-settings-divider text-xs text-[var(--airqr-text-muted)]">
        {t('settings.historyRetentionUnavailable')}
      </p>
    );
  }

  const parsedDays = parseDays(daysText);
  const nextDays = neverDelete ? null : parsedDays;
  const isValid = neverDelete || parsedDays !== null;
  const isDirty = isValid && nextDays !== current.historyDays;

  const handleSave = async () => {
    if (!isDirty) return;
    // Shorter retention deletes entries that are kept today; ask first.
    const shortens =
      nextDays !== null && (current.historyDays === null || nextDays < current.historyDays);
    if (
      shortens &&
      !(await confirm({
        title: t('settings.historyRetentionShortenTitle'),
        message: t('settings.historyRetentionShortenConfirm', { days: nextDays }),
        confirmLabel: t('settings.historyRetentionShortenAction'),
        tone: 'danger',
      }))
    ) {
      return;
    }
    setSaving(true);
    setResult(null);
    try {
      const saved = await saveHistoryRetention({ url, apiKey, username, password }, nextDays);
      setCurrent(saved);
      setResult({ success: true, message: t('settings.historyRetentionSaved') });
    } catch (error) {
      logger.error('Could not save the server history retention', {
        error: error instanceof Error ? error.message : String(error),
      });
      setResult({ success: false, message: t('settings.historyRetentionSaveFailed') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="py-3 border-t airqr-settings-divider">
      <p className="text-sm font-semibold text-[var(--airqr-text-primary)]">
        {t('settings.historyRetentionTitle')}
      </p>
      <p className="text-xs font-medium text-[var(--airqr-text-muted)]">
        {t('settings.historyRetentionHint')}
        {current.source === 'server-default' && current.defaultHistoryDays !== null
          ? ` ${t('settings.historyRetentionServerDefault', { days: current.defaultHistoryDays })}`
          : ''}
      </p>

      <label
        htmlFor={daysInputId}
        className="mt-3 block text-xs font-semibold text-[var(--airqr-text-secondary)]"
      >
        {t('settings.historyRetentionDays')}
      </label>
      <input
        id={daysInputId}
        type="number"
        inputMode="numeric"
        min={HISTORY_RETENTION_MIN_DAYS}
        max={HISTORY_RETENTION_MAX_DAYS}
        value={daysText}
        disabled={neverDelete}
        onChange={(e) => {
          setDaysText(e.target.value);
          setResult(null);
        }}
        className="mt-2 w-full px-3 py-2 text-sm tabular-nums airqr-settings-control disabled:opacity-50"
      />
      {!neverDelete && parsedDays === null && (
        <p className="mt-1 text-xs font-semibold text-[var(--airqr-danger-text)]">
          {t('settings.historyRetentionInvalid', {
            min: HISTORY_RETENTION_MIN_DAYS,
            max: HISTORY_RETENTION_MAX_DAYS,
          })}
        </p>
      )}

      <Toggle
        label={t('settings.historyRetentionNever')}
        description={t('settings.historyRetentionNeverDesc')}
        checked={neverDelete}
        onChange={(checked) => {
          setNeverDelete(checked);
          setResult(null);
        }}
        className="mt-3"
      />

      <div className="mt-3 flex items-center gap-3">
        <Button
          variant="primary"
          size="md"
          onClick={handleSave}
          disabled={!isDirty || saving}
        >
          {t('settings.historyRetentionSave')}
        </Button>
        {result && (
          <span
            role="status"
            className={`text-xs font-semibold ${
              result.success
                ? 'text-[var(--airqr-success-text)]'
                : 'text-[var(--airqr-danger-text)]'
            }`}
          >
            {result.message}
          </span>
        )}
      </div>
      {confirmDialog}
    </div>
  );
};

export default HistoryRetentionSetting;
