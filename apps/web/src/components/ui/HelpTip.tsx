import { useState } from 'react';

function HelpTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--airqr-control-surface)] text-[10px] font-bold text-[var(--airqr-text-muted)] transition-colors hover:bg-[var(--airqr-action-hover)] hover:text-[var(--airqr-text-primary)]"
      >
        ?
      </button>
      {open && (
        <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-52 -translate-x-1/2 whitespace-normal rounded-xl border border-[var(--airqr-control-border)] bg-[var(--airqr-card-surface)] px-2.5 py-1.5 text-center text-[11px] leading-tight text-[var(--airqr-text-primary)] shadow-lg backdrop-blur-xl">
          {text}
        </span>
      )}
    </span>
  );
}

export default HelpTip;
