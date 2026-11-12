import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Icon from '../../components/ui/Icon';
import NoteCodeViewer from '../../components/note/NoteCodeViewer';
import { type BinaryData, toBinaryBlob } from '../../utils/binaryData';
import { formatSize } from '../../utils/format';
import {
  inferMimeTypeFromFilename,
  resolveHistoryPreviewKind,
} from '../../utils/history';

interface ScanResultProps {
  filename: string;
  fileSize: number;
  duration: number;
  fileData?: BinaryData;
  mimeType?: string;
  isNote?: boolean;
  noteContent?: string;
  onCopyNote?: () => void;
  onDownload: () => void;
  onScanAgain: () => void;
  onClose: () => void;
}

const ScanResult: React.FC<ScanResultProps> = ({
  filename,
  fileSize,
  duration,
  fileData,
  mimeType,
  isNote = false,
  noteContent,
  onCopyNote,
  onDownload,
  onScanAgain,
  onClose,
}) => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const previewMimeType =
    mimeType || inferMimeTypeFromFilename(filename) || 'application/octet-stream';
  const resolvedPreviewKind = resolveHistoryPreviewKind({
    type: 'file',
    title: filename,
    mimeType: previewMimeType,
  });
  const previewKind =
    resolvedPreviewKind === 'qr-gif' ? 'image' : resolvedPreviewKind;
  const previewUrl = useMemo(() => {
    if (
      !fileData ||
      !['image', 'video', 'pdf'].includes(previewKind)
    ) {
      return null;
    }
    return URL.createObjectURL(toBinaryBlob(fileData, previewMimeType));
  }, [fileData, previewKind, previewMimeType]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const handleCopy = () => {
    onCopyNote?.();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isNote) {
    const lines = (noteContent || '').split('\n');

    return (
      <div className="flex flex-col h-full w-full bg-transparent font-display text-[var(--airqr-text-primary)] animate-fade-in">
        {/* Toolbar */}
        <div className="flex items-center gap-3 border-b border-[var(--airqr-divider)] bg-[var(--airqr-control-panel-surface)] px-3 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <button
              onClick={onScanAgain}
              className="airqr-back-button !size-9 !basis-9 !shrink-0 !shadow-none"
              aria-label={t('scanner.scanAgain')}
            >
              <Icon name="arrow_back" className="text-[20px]" />
            </button>
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <Icon name="article" className="text-[16px] text-[var(--airqr-accent-text)]" />
              <span className="truncate font-medium text-[var(--airqr-text-primary)]">{filename}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={handleCopy}
              className="airqr-action-button flex size-10 items-center justify-center rounded-full"
              aria-label={copied ? t('common.copied', 'Copied') : t('scanner.copyToClipboard')}
              title={copied ? t('common.copied', 'Copied') : t('scanner.copyToClipboard')}
            >
              <Icon name={copied ? 'check' : 'content_copy'} className="text-[20px]" />
            </button>
            <button
              onClick={onDownload}
              className="airqr-action-button flex size-10 items-center justify-center rounded-full"
              aria-label={t('common.download')}
              title={t('common.download')}
            >
              <Icon name="download" className="text-[20px]" />
            </button>
          </div>
        </div>

        {/* Code viewer */}
        <div className="flex-1 overflow-auto">
          <NoteCodeViewer
            content={noteContent || ''}
            contentTestId="scanner-note-content"
          />
        </div>

        {/* Bottom bar */}
        <div className="flex items-center justify-between px-4 py-2 bg-[var(--airqr-control-panel-surface)] border-t border-[var(--airqr-divider)] text-xs text-[var(--airqr-text-muted)]">
          <span>{lines.length} {lines.length === 1 ? 'line' : 'lines'}</span>
          <button
            onClick={onScanAgain}
            className="flex items-center gap-1.5 text-[var(--airqr-text-secondary)] transition-colors hover:text-[var(--airqr-text-primary)]"
          >
            <Icon name="qr_code_scanner" className="text-[14px]" />
            {t('scanner.scanAgain')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="airqr-screen relative flex h-full w-full flex-col font-display animate-fade-in">
      <header className="airqr-content z-10 grid grid-cols-[1fr_auto_1fr] items-center gap-3 p-4">
        <button
          onClick={onScanAgain}
          className="airqr-back-button"
          aria-label={t('scanner.scanAgain')}
        >
          <Icon name="arrow_back" className="airqr-back-icon" />
        </button>
        <h2 className="text-center text-[clamp(1.45rem,4.2vw,1.9rem)] font-extrabold leading-[1.18] text-[var(--airqr-text-primary)]">
          {t('scanner.resultTitle')}
        </h2>
        <button
          onClick={onClose}
          className="justify-self-end flex h-10 items-center justify-center rounded-full px-3 text-[var(--airqr-text-secondary)] transition-colors hover:bg-[var(--airqr-control-surface)] hover:text-[var(--airqr-text-primary)]"
        >
          <p className="text-base font-bold leading-normal">
            {t('common.close')}
          </p>
        </button>
      </header>

      <main className="airqr-content flex flex-1 flex-col items-center px-6 pb-28 pt-8">
        <div className="relative flex w-full justify-center py-8">
          {previewUrl && previewKind === 'image' ? (
            <div className="airqr-card flex max-h-[42dvh] min-h-[260px] w-full max-w-[620px] items-center justify-center overflow-hidden rounded-[30px] p-3">
              <img
                src={previewUrl}
                alt={filename}
                className="max-h-[38dvh] max-w-full rounded-[24px] object-contain shadow-[0_18px_70px_rgba(0,0,0,0.42)]"
              />
            </div>
          ) : previewUrl && previewKind === 'video' ? (
            <div className="airqr-card flex max-h-[42dvh] min-h-[260px] w-full max-w-[620px] items-center justify-center overflow-hidden rounded-[30px] p-3">
              <video
                data-testid="scan-result-video-preview"
                src={previewUrl}
                controls
                className="max-h-[38dvh] max-w-full rounded-[24px] shadow-[0_18px_70px_rgba(0,0,0,0.42)]"
              />
            </div>
          ) : previewUrl && previewKind === 'pdf' ? (
            <div className="airqr-card h-[42dvh] min-h-[300px] w-full max-w-[720px] overflow-hidden rounded-[30px] p-3">
              <object
                data={previewUrl}
                type="application/pdf"
                title={filename}
                className="h-full w-full rounded-[24px] bg-white"
              >
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                  <Icon name="description" className="text-5xl text-[var(--airqr-accent-text)]" />
                  <p className="text-sm font-medium text-[var(--airqr-text-secondary)]">
                    {t('history.previewUnavailable')}
                  </p>
                </div>
              </object>
            </div>
          ) : (
            <div className="relative">
              <div className="relative flex h-32 w-32 items-center justify-center rounded-[32px] border border-[var(--airqr-control-border)] bg-[var(--airqr-nav-active)] shadow-xl">
                <Icon
                  name="folder_zip"
                  className="text-[64px] text-[var(--airqr-accent-text)]"
                />

                <div className="absolute -bottom-2 -right-2 flex items-center justify-center rounded-full border-4 border-[var(--airqr-card-surface)] bg-emerald-500 p-1.5">
                  <Icon name="check" className="text-sm text-white" />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="w-full flex flex-col items-center text-center space-y-2 mt-2">
          <h1 className="break-all text-2xl font-bold leading-tight text-[var(--airqr-text-primary)]">
            {filename}
          </h1>
          <div className="flex items-center justify-center gap-2 text-sm font-medium text-[var(--airqr-text-muted)]">
            <span>{formatSize(fileSize)}</span>
            <span className="size-1 rounded-full bg-[var(--airqr-divider)]"></span>
            <span>{t('scanner.scannedIn', { seconds: duration.toFixed(1) })}</span>
          </div>
        </div>

        <div className="w-full space-y-4 mt-8 mb-auto pb-8">
          <button
            onClick={onDownload}
            className="airqr-primary-button group relative flex h-14 w-full cursor-pointer items-center justify-center overflow-hidden rounded-full transition-all duration-200 active:scale-[0.98]"
          >
            <Icon name="download" className="mr-2 group-hover:animate-bounce" />
            <span className="text-lg font-bold tracking-[0.015em]">{t('common.download')}</span>
          </button>

          <button
            onClick={onScanAgain}
            className="flex h-12 w-full cursor-pointer items-center justify-center rounded-full text-base font-semibold text-[var(--airqr-text-secondary)] transition-colors hover:bg-[var(--airqr-control-surface)] hover:text-[var(--airqr-text-primary)]"
          >
            {t('scanner.scanAgain')}
          </button>
        </div>
      </main>
    </div>
  );
};

export default ScanResult;
