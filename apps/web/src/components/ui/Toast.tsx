import { useEffect, useState } from 'react';
import { useToastStore } from '../../store/toastStore';
import Icon from './Icon';

export default function Toast() {
  const { message, type, visible, hide } = useToastStore();
  const [show, setShow] = useState(false);

  useEffect(() => {
    let frameId: number | null = null;
    let hideTimer: number | null = null;
    let removeTimer: number | null = null;

    if (visible) {
      frameId = requestAnimationFrame(() => setShow(true));
      hideTimer = window.setTimeout(() => {
        setShow(false);
        removeTimer = window.setTimeout(hide, 300);
      }, 3000);
    } else if (show) {
      frameId = requestAnimationFrame(() => setShow(false));
    }

    return () => {
      if (frameId != null) {
        cancelAnimationFrame(frameId);
      }
      if (hideTimer != null) {
        window.clearTimeout(hideTimer);
      }
      if (removeTimer != null) {
        window.clearTimeout(removeTimer);
      }
    };
  }, [visible, hide, show]);

  if (!visible && !show) return null;

  const iconMap = {
    info: 'info',
    success: 'check_circle',
    warning: 'warning',
    error: 'error',
  };

  const colorMap = {
    info: 'border-[var(--airqr-control-border)] text-[var(--airqr-text-primary)]',
    success: 'airqr-status-success',
    warning: 'airqr-status-warning',
    error: 'airqr-status-danger',
  };

  const isAssertive = type === 'warning' || type === 'error';
  const liveRole = isAssertive ? 'alert' : 'status';
  const liveMode = isAssertive ? 'assertive' : 'polite';

  return (
    <div
      role={liveRole}
      aria-live={liveMode}
      aria-atomic="true"
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-[200] transition-all duration-300 ${
        show ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4'
      }`}
    >
      <div
        className={`flex max-w-sm items-center gap-3 rounded-[22px] border bg-[var(--airqr-card-surface)] px-4 py-3 text-[var(--airqr-text-primary)] shadow-[var(--airqr-shadow-strong)] backdrop-blur-xl ${colorMap[type]}`}
      >
        <Icon name={iconMap[type]} className="text-xl shrink-0" />
        <p className="text-sm font-medium">{message}</p>
      </div>
    </div>
  );
}
