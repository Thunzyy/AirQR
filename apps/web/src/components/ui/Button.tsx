/**
 * Button component with variants and sizes
 */

import React from 'react';
import type { ButtonProps } from '../../types';

const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = false,
  children,
  onClick,
  className = '',
}) => {
  // Base classes
  const baseClasses =
    'font-bold rounded-full transition-all active:scale-[0.98] flex items-center justify-center';

  // Variant classes
  const variantClasses = {
    primary:
      'airqr-primary-button disabled:bg-[var(--airqr-disabled-surface)] disabled:text-[var(--airqr-disabled-text)]',
    secondary:
      'airqr-action-button text-[var(--airqr-text-primary)] disabled:bg-[var(--airqr-disabled-surface)] disabled:text-[var(--airqr-disabled-text)]',
    ghost:
      'bg-transparent text-[var(--airqr-text-secondary)] hover:bg-[var(--airqr-control-surface)] hover:text-[var(--airqr-text-primary)] disabled:hover:bg-transparent disabled:text-[var(--airqr-text-muted)]',
  };

  // Size classes
  const sizeClasses = {
    sm: 'px-3 py-2 text-sm',
    md: 'px-4 py-3 text-base',
    lg: 'px-6 py-4 text-lg',
  };

  // Width classes
  const widthClasses = fullWidth ? 'w-full' : '';

  // Disabled/loading state
  const isDisabled = disabled || loading;

  return (
    <button
      className={`
        ${baseClasses}
        ${variantClasses[variant]}
        ${sizeClasses[size]}
        ${widthClasses}
        ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}
        ${className}
      `.trim()}
      onClick={onClick}
      disabled={isDisabled}
    >
      {loading ? (
        <>
          <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
          Loading...
        </>
      ) : (
        children
      )}
    </button>
  );
};

export default Button;
