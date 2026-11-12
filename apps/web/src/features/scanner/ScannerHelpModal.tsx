import React, { useEffect, useId, useRef } from "react";

import Icon from "../../components/ui/Icon";

interface ScannerHelpTip {
  icon: string;
  title: string;
  description: string;
}

interface ScannerHelpModalProps {
  closeLabel: string;
  helpTips: ScannerHelpTip[];
  isOpen: boolean;
  onClose: () => void;
  title: string;
}

const ScannerHelpModal: React.FC<ScannerHelpModalProps> = ({
  closeLabel,
  helpTips,
  isOpen,
  onClose,
  title,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const dismissButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    dismissButtonRef.current?.focus();
  }, [isOpen]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    const focusableElements = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    );

    if (focusableElements.length === 0) {
      return;
    }

    const activeElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const currentIndex = focusableElements.indexOf(activeElement ?? focusableElements[0]);
    const nextIndex = event.shiftKey
      ? (currentIndex <= 0 ? focusableElements.length - 1 : currentIndex - 1)
      : (currentIndex + 1) % focusableElements.length;

    focusableElements[nextIndex]?.focus();
    event.preventDefault();
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-[rgb(11_20_31/0.62)] backdrop-blur-sm animate-fade-in">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={handleKeyDown}
        className="airqr-card mx-4 max-h-[80vh] w-full max-w-sm overflow-y-auto p-6"
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id={titleId} className="text-lg font-semibold text-[var(--airqr-text-primary)]">
            {title}
          </h2>
          <button
            ref={dismissButtonRef}
            onClick={onClose}
            className="airqr-action-button flex size-8 items-center justify-center rounded-full transition-colors"
            aria-label={`${closeLabel} ${title}`}
          >
            <Icon name="close" className="text-[20px]" />
          </button>
        </div>
        <div className="space-y-4">
          {helpTips.map((tip) => (
            <div key={tip.title} className="airqr-liquid-subcard flex gap-3 rounded-[18px] p-3">
              <div className="airqr-liquid-icon size-10 flex-shrink-0">
                <Icon name={tip.icon} className="text-[20px] text-[var(--airqr-accent-text)]" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-medium text-[var(--airqr-text-primary)] mb-1">{tip.title}</h3>
                <p className="text-xs leading-relaxed text-[var(--airqr-text-muted)]">{tip.description}</p>
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={onClose}
          className="airqr-primary-button mt-5 w-full rounded-full py-3 font-bold transition-colors"
        >
          {closeLabel}
        </button>
      </div>
    </div>
  );
};

export default ScannerHelpModal;
