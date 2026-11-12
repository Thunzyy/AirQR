/**
 * Promise-based replacement for window.confirm that renders ConfirmDialog.
 */

import { useCallback, useState } from 'react';
import ConfirmDialog, { type ConfirmOptions } from './ConfirmDialog';

interface PendingConfirm extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
  returnFocus: HTMLElement | null;
}

/**
 * `await confirm({...})` resolves true/false like window.confirm, while the
 * caller renders `confirmDialog` somewhere in its tree.
 */
export function useConfirmDialog() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        const returnFocus =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setPending({ ...options, resolve, returnFocus });
      }),
    []
  );

  const handleResolve = (confirmed: boolean) => {
    if (!pending) return;
    setPending(null);
    pending.returnFocus?.focus();
    pending.resolve(confirmed);
  };

  const confirmDialog = pending ? (
    <ConfirmDialog
      title={pending.title}
      message={pending.message}
      confirmLabel={pending.confirmLabel}
      cancelLabel={pending.cancelLabel}
      tone={pending.tone}
      onResolve={handleResolve}
    />
  ) : null;

  return { confirm, confirmDialog };
}
