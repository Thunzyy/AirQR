/**
 * In-app confirmation card, used instead of the browser's native confirm().
 */

import React, { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import Icon from './Icon';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  /** "danger" for destructive actions (red action, warning icon). */
  tone?: 'danger' | 'default';
}

interface ConfirmDialogProps extends ConfirmOptions {
  onResolve: (confirmed: boolean) => void;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  title,
  message,
  confirmLabel,
  cancelLabel,
  tone = 'default',
  onResolve,
}) => {
  const { t } = useTranslation();
  const titleId = useId();
  const messageId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Cancel first: a stray Enter must never run a destructive action.
    cancelButtonRef.current?.focus();
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onResolve(false);
      return;
    }
    if (event.key !== 'Tab' || !dialogRef.current) {
      return;
    }
    const focusable = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    );
    if (focusable.length === 0) {
      return;
    }
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const currentIndex = focusable.indexOf(active ?? focusable[0]);
    const nextIndex = event.shiftKey
      ? currentIndex <= 0
        ? focusable.length - 1
        : currentIndex - 1
      : (currentIndex + 1) % focusable.length;
    focusable[nextIndex]?.focus();
    event.preventDefault();
  };

  const isDanger = tone === 'danger';

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-[rgb(11_20_31/0.62)] px-4 backdrop-blur-sm animate-fade-in"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onResolve(false);
      }}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? messageId : undefined}
        onKeyDown={handleKeyDown}
        className="airqr-card w-full max-w-sm p-6"
      >
        <div className="flex items-start gap-4">
          {isDanger && (
            <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--airqr-danger-surface)]">
              <Icon name="delete" className="text-[22px] text-[var(--airqr-danger-text)]" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-lg font-bold text-[var(--airqr-text-primary)]">
              {title}
            </h2>
            {message && (
              <p id={messageId} className="mt-1 text-sm text-[var(--airqr-text-secondary)]">
                {message}
              </p>
            )}
          </div>
        </div>
        <div className="mt-6 flex gap-3">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={() => onResolve(false)}
            className="airqr-action-button flex-1 rounded-full border py-3 text-sm font-bold text-[var(--airqr-text-primary)] transition-colors"
          >
            {cancelLabel ?? t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => onResolve(true)}
            className={`flex-1 rounded-full py-3 text-sm font-bold transition-colors ${
              isDanger
                ? 'airqr-action-button airqr-action-button-danger border'
                : 'airqr-primary-button'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ConfirmDialog;
