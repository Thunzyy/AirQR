/**
 * Card component for content sections
 */

import React from 'react';
import type { CardProps } from '../../types';

const Card: React.FC<CardProps> = ({
  title,
  children,
  className = '',
}) => {
  return (
    <div
      className={`
        airqr-card p-4
        ${className}
      `}
    >
      {title && (
        <h2 className="airqr-section-title mb-4">
          {title}
        </h2>
      )}
      {children}
    </div>
  );
};

export default Card;
