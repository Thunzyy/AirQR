import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { NOTE_FORMAT_OPTIONS } from '../../constants';
import type { NoteFormat } from '../../types';
import Icon from '../ui/Icon';

interface NoteEditorProps {
  noteText: string;
  noteFormat: NoteFormat;
  onNoteTextChange: (value: string) => void;
  onNoteFormatChange: (value: NoteFormat) => void;
  onClear: () => void;
}

const NoteEditor: React.FC<NoteEditorProps> = ({
  noteText,
  noteFormat,
  onNoteTextChange,
  onNoteFormatChange,
  onClear,
}) => {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLDivElement>(null);
  const formatMenuRef = useRef<HTMLDivElement>(null);
  const formatTriggerRef = useRef<HTMLButtonElement>(null);
  const formatOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const formatListboxId = useId();
  const [isFormatMenuOpen, setIsFormatMenuOpen] = useState(false);

  const noteBytes = new TextEncoder().encode(noteText).length;
  const lines = noteText.split('\n');
  const lineCount = lines.length;
  const selectedFormat =
    NOTE_FORMAT_OPTIONS.find((option) => option.value === noteFormat) ??
    NOTE_FORMAT_OPTIONS[0];
  const selectedFormatLabel = t(
    `encoder.noteFormats.${selectedFormat.value}`,
    selectedFormat.label,
  );

  const closeFormatMenu = useCallback((restoreFocus = false) => {
    setIsFormatMenuOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => formatTriggerRef.current?.focus());
    }
  }, []);

  const focusFormatOption = useCallback((index: number) => {
    requestAnimationFrame(() => formatOptionRefs.current[index]?.focus());
  }, []);

  const openFormatMenu = useCallback(() => {
    const selectedIndex = Math.max(
      NOTE_FORMAT_OPTIONS.findIndex((option) => option.value === noteFormat),
      0,
    );
    setIsFormatMenuOpen(true);
    focusFormatOption(selectedIndex);
  }, [focusFormatOption, noteFormat]);

  useEffect(() => {
    if (!isFormatMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !formatMenuRef.current?.contains(target)) {
        closeFormatMenu();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [closeFormatMenu, isFormatMenuOpen]);

  const handleFormatTriggerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      openFormatMenu();
    },
    [openFormatMenu],
  );

  const handleFormatMenuKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeFormatMenu(true);
        return;
      }

      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;

      event.preventDefault();
      const activeIndex = formatOptionRefs.current.findIndex(
        (option) => option === document.activeElement,
      );
      let nextIndex = activeIndex;

      if (event.key === 'Home') nextIndex = 0;
      if (event.key === 'End') nextIndex = NOTE_FORMAT_OPTIONS.length - 1;
      if (event.key === 'ArrowDown') {
        nextIndex = (Math.max(activeIndex, -1) + 1) % NOTE_FORMAT_OPTIONS.length;
      }
      if (event.key === 'ArrowUp') {
        nextIndex =
          (activeIndex <= 0 ? NOTE_FORMAT_OPTIONS.length : activeIndex) - 1;
      }

      formatOptionRefs.current[nextIndex]?.focus();
    },
    [closeFormatMenu],
  );

  const handleFormatSelect = useCallback(
    (value: NoteFormat) => {
      onNoteFormatChange(value);
      closeFormatMenu(true);
    },
    [closeFormatMenu, onNoteFormatChange],
  );

  const handleScroll = useCallback(() => {
    if (textareaRef.current && lineNumbersRef.current) {
      lineNumbersRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

  const handleLineClick = useCallback((lineIndex: number) => {
    if (!textareaRef.current) return;
    const lines = noteText.split('\n');
    let pos = 0;
    for (let i = 0; i < lineIndex; i++) {
      pos += lines[i].length + 1;
    }
    textareaRef.current.focus();
    textareaRef.current.setSelectionRange(pos, pos + lines[lineIndex].length);
  }, [noteText]);

  return (
    <div className="airqr-liquid-card flex flex-col rounded-[34px] !overflow-visible">
      {/* Toolbar */}
      <div className="!z-20 flex items-center justify-between rounded-t-[34px] border-b border-[var(--airqr-divider)] bg-[var(--airqr-control-surface)] px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="airqr-liquid-icon flex size-7 text-[var(--airqr-text-primary)]">
            <Icon name="article" className="text-[16px]" />
          </span>
          <div
            ref={formatMenuRef}
            className="relative"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) {
                closeFormatMenu();
              }
            }}
          >
            <button
              ref={formatTriggerRef}
              type="button"
              aria-label={`${t('encoder.noteFormat')}: ${selectedFormatLabel}`}
              aria-haspopup="listbox"
              aria-expanded={isFormatMenuOpen}
              aria-controls={formatListboxId}
              onClick={() =>
                isFormatMenuOpen ? closeFormatMenu() : openFormatMenu()
              }
              onKeyDown={handleFormatTriggerKeyDown}
              className={`airqr-liquid-subcard flex h-9 max-w-[148px] items-center gap-2 rounded-full pl-3 pr-2 text-xs font-bold text-[var(--airqr-text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] transition-colors hover:bg-[var(--airqr-action-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--airqr-accent)] ${
                isFormatMenuOpen ? 'bg-[var(--airqr-action-hover)]' : ''
              }`}
            >
              <span className="min-w-0 flex-1 truncate text-left">
                {selectedFormatLabel}
              </span>
              <Icon
                name="expand_more"
                className={`shrink-0 text-[16px] text-[var(--airqr-text-secondary)] transition-transform duration-150 ${
                  isFormatMenuOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {isFormatMenuOpen ? (
              <div
                id={formatListboxId}
                role="listbox"
                aria-label={t('encoder.noteFormat')}
                onKeyDown={handleFormatMenuKeyDown}
                className="absolute left-0 top-[calc(100%+0.5rem)] z-50 max-h-[min(280px,calc(100dvh-7rem))] w-[min(220px,calc(100vw-2rem))] overflow-y-auto rounded-[22px] border border-[var(--airqr-control-border)] bg-[var(--airqr-card-surface)] p-1.5 shadow-[0_24px_64px_rgba(0,0,0,0.38)] backdrop-blur-2xl sm:max-h-[min(360px,55vh)]"
              >
                {NOTE_FORMAT_OPTIONS.map((option, index) => {
                  const isSelected = option.value === noteFormat;
                  const label = t(
                    `encoder.noteFormats.${option.value}`,
                    option.label,
                  );

                  return (
                    <button
                      key={option.value}
                      ref={(element) => {
                        formatOptionRefs.current[index] = element;
                      }}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => handleFormatSelect(option.value)}
                      className={`flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[var(--airqr-accent)] ${
                        isSelected
                          ? 'bg-[var(--airqr-nav-active)] font-bold text-[var(--airqr-text-primary)]'
                          : 'font-semibold text-[var(--airqr-text-secondary)] hover:bg-[var(--airqr-action-hover)] hover:text-[var(--airqr-text-primary)]'
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{label}</span>
                      <span className="rounded-full bg-[var(--airqr-control-surface)] px-2 py-0.5 font-mono text-[10px] font-bold uppercase text-[var(--airqr-text-muted)]">
                        .{option.extension}
                      </span>
                      <span className="flex size-4 shrink-0 items-center justify-center">
                        {isSelected ? (
                          <Icon name="check" className="text-[14px]" />
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          onClick={onClear}
          disabled={noteText.length === 0}
          className="airqr-action-button flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-30"
        >
          <Icon name="delete" className="text-[14px]" />
          {t('encoder.clearNote')}
        </button>
      </div>

      {/* Editor area */}
      <div className="relative flex min-h-[320px] max-h-[60vh] bg-[var(--airqr-preview-surface)]">
        {/* Line numbers */}
        <div
          ref={lineNumbersRef}
          className="shrink-0 select-none overflow-hidden border-r border-[var(--airqr-divider)] bg-[var(--airqr-control-surface)] py-4"
          aria-hidden="true"
        >
          {Array.from({ length: Math.max(lineCount, 15) }, (_, i) => (
            <div
              key={i}
              onClick={() => i < lineCount ? handleLineClick(i) : undefined}
              className={`cursor-pointer px-4 text-right font-mono text-xs leading-6 transition-colors ${
                i < lineCount
                  ? 'text-[var(--airqr-text-muted)] hover:text-[var(--airqr-text-secondary)]'
                  : 'text-[var(--airqr-disabled-text)]'
              }`}
            >
              {i + 1}
            </div>
          ))}
        </div>

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={noteText}
          onChange={(event) => onNoteTextChange(event.target.value)}
          onScroll={handleScroll}
          placeholder={t('encoder.notePlaceholder')}
          spellCheck={false}
          className="flex-1 resize-none overflow-auto bg-transparent py-4 pl-4 pr-4 font-mono text-sm leading-6 text-[var(--airqr-text-primary)] outline-none placeholder:text-[var(--airqr-text-muted)]"
        />
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between rounded-b-[34px] border-t border-[var(--airqr-divider)] bg-[var(--airqr-control-surface)] px-4 py-2.5 text-xs font-semibold text-[var(--airqr-text-muted)]">
        <div className="flex items-center gap-3">
          <span>{lineCount} {lineCount === 1 ? 'line' : 'lines'}</span>
          <span className="text-[var(--airqr-divider)]">|</span>
          <span>{t('encoder.noteCharCount', { count: noteText.length })}</span>
        </div>
        <span>{t('encoder.noteByteCount', { count: noteBytes })}</span>
      </div>
    </div>
  );
};

export default NoteEditor;
