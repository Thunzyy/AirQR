/**
 * Toggle switch component
 */

import React, { useId } from 'react';
import type { ToggleProps } from '../../types';

const Toggle: React.FC<ToggleProps> = ({
  label,
  description,
  checked,
  onChange,
  disabled = false,
  className = '',
}) => {
  const toggleId = useId();
  const descriptionId = description ? `${toggleId}-description` : undefined;

  const handleToggle = () => {
    if (!disabled) {
      onChange(!checked);
    }
  };

  return (
    <div className={`flex items-center justify-between gap-4 ${className}`}>
      <div className="flex-1">
        <label
          id={toggleId}
          className="text-sm font-semibold text-[var(--airqr-text-primary)]"
        >
          {label}
        </label>
        {description && (
          <p
            id={descriptionId}
            className="text-xs font-medium text-[var(--airqr-text-muted)]"
          >
            {description}
          </p>
        )}
      </div>
      <button
        onClick={handleToggle}
        disabled={disabled}
        aria-labelledby={toggleId}
        aria-describedby={descriptionId}
        className={`
          relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors
          ${checked ? 'bg-[var(--airqr-switch-selected)]' : 'bg-[var(--airqr-control-surface)]'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
        role="switch"
        aria-checked={checked}
      >
        <span
          className={`
            inline-block h-5 w-5 transform rounded-full bg-white transition-transform
            ${checked ? 'translate-x-6' : 'translate-x-1'}
          `}
        />
      </button>
    </div>
  );
};

export default Toggle;
