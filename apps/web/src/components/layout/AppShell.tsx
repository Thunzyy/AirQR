/**
 * AppShell - Main application layout wrapper
 */

import React, { useEffect, useState } from 'react';

import { globalHas } from '../../parse/wire';

interface AppShellProps {
  children: React.ReactNode;
}

function isEditableElement(element: Element | null): boolean {
  if (!element) {
    return false;
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return true;
  }

  if (element instanceof HTMLElement && element.isContentEditable) {
    return true;
  }

  return false;
}

function getViewportHeight(): number | null {
  if (!globalHas('window')) {
    return null;
  }

  const visualViewportHeight = window.visualViewport?.height;
  if (visualViewportHeight !== undefined && visualViewportHeight > 0) {
    if (
      isEditableElement(document.activeElement) &&
      window.innerHeight > 0 &&
      window.innerHeight - visualViewportHeight > 140
    ) {
      return window.innerHeight;
    }
    return Math.round(visualViewportHeight);
  }

  return window.innerHeight > 0 ? window.innerHeight : null;
}

const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const [viewportHeight, setViewportHeight] = useState<number | null>(() =>
    getViewportHeight()
  );

  useEffect(() => {
    const updateViewportHeight = () => {
      setViewportHeight(getViewportHeight());
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        updateViewportHeight();
      }
    };

    updateViewportHeight();

    window.addEventListener('pageshow', updateViewportHeight);
    window.addEventListener('resize', updateViewportHeight);
    window.addEventListener('orientationchange', updateViewportHeight);
    window.addEventListener('focusin', updateViewportHeight);
    window.addEventListener('focusout', updateViewportHeight);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.visualViewport?.addEventListener('resize', updateViewportHeight);

    return () => {
      window.removeEventListener('pageshow', updateViewportHeight);
      window.removeEventListener('resize', updateViewportHeight);
      window.removeEventListener('orientationchange', updateViewportHeight);
      window.removeEventListener('focusin', updateViewportHeight);
      window.removeEventListener('focusout', updateViewportHeight);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.visualViewport?.removeEventListener('resize', updateViewportHeight);
    };
  }, []);

  return (
    <div
      className="airqr-app-bg flex h-screen h-dvh flex-col text-[var(--airqr-text-primary)]"
      style={viewportHeight ? { height: `${viewportHeight}px` } : undefined}
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-4 focus:bg-white focus:text-black"
      >
        Skip to main content
      </a>
      <main
        id="main-content"
        className="relative flex-1 min-h-0 overflow-y-auto custom-scrollbar"
      >
        {children}
      </main>
    </div>
  );
};

export default AppShell;
