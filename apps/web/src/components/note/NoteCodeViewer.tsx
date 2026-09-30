import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';

import { globalHas } from '../../parse/wire';
import { resolveVisualNoteLineCount } from './noteCodeViewerUtils';

interface NoteCodeViewerProps {
  content: string;
  contentTestId?: string;
}

const NoteCodeViewer = forwardRef<HTMLPreElement, NoteCodeViewerProps>(
  function NoteCodeViewer({ content, contentTestId }, forwardedRef) {
    const contentRef = useRef<HTMLPreElement>(null);
    const logicalLineCount = content.split('\n').length;
    const [measuredVisualLineCount, setMeasuredVisualLineCount] = useState(1);
    const visualLineCount = Math.max(
      logicalLineCount,
      measuredVisualLineCount
    );

    useImperativeHandle(forwardedRef, () => contentRef.current!, []);

    const measureVisualLines = useCallback(() => {
      const contentElement = contentRef.current;
      if (!contentElement) return;

      setMeasuredVisualLineCount(
        resolveVisualNoteLineCount(
          logicalLineCount,
          contentElement.scrollHeight
        )
      );
    }, [logicalLineCount]);

    useEffect(() => {
      const contentElement = contentRef.current;
      if (!contentElement) return;

      const animationFrame = window.requestAnimationFrame(measureVisualLines);
      let resizeObserver: ResizeObserver | null = null;
      if (globalHas('ResizeObserver')) {
        try {
          resizeObserver = new ResizeObserver(measureVisualLines);
        } catch {
          resizeObserver = null;
        }
      }

      resizeObserver?.observe(contentElement);
      window.addEventListener('resize', measureVisualLines);

      return () => {
        window.cancelAnimationFrame(animationFrame);
        resizeObserver?.disconnect();
        window.removeEventListener('resize', measureVisualLines);
      };
    }, [logicalLineCount, measureVisualLines]);

    const lineNumbers = useMemo(
      () => Array.from({ length: visualLineCount }, (_, index) => index + 1),
      [visualLineCount]
    );

    return (
      <div className="grid min-h-full w-full grid-cols-[2.5rem_minmax(0,1fr)]">
        <div
          aria-hidden="true"
          data-testid="note-code-gutter"
          className="select-none border-r border-[var(--airqr-divider)] bg-[var(--airqr-control-surface)] py-0 text-center font-mono text-[10px] leading-6 text-[var(--airqr-text-muted)]"
        >
          {lineNumbers.map((lineNumber) => (
            <div
              key={lineNumber}
              data-testid="note-code-line-number"
              className="h-6 translate-y-[2px] whitespace-nowrap"
            >
              {lineNumber}
            </div>
          ))}
        </div>
        <pre
          ref={contentRef}
          data-testid={contentTestId}
          className="min-w-0 self-start py-0 pl-1 pr-4 font-mono text-sm leading-6 whitespace-pre-wrap break-all text-[var(--airqr-text-primary)]"
        >
          {content}
        </pre>
      </div>
    );
  }
);

export default NoteCodeViewer;
