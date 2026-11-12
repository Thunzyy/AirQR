import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import NoteEditor from '@web/components/encoder/NoteEditor';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOptions?: string | Record<string, unknown>) => {
      if (key === 'encoder.noteFormat') return 'Format';
      if (key.startsWith('encoder.noteFormats.')) {
        return typeof fallbackOrOptions === 'string'
          ? fallbackOrOptions
          : key.split('.').at(-1);
      }
      if (key === 'encoder.clearNote') return 'Clear note';
      if (key === 'encoder.notePlaceholder') return 'Type your note';
      if (key === 'encoder.noteCharCount') {
        return `${(fallbackOrOptions as { count: number }).count} chars`;
      }
      if (key === 'encoder.noteByteCount') {
        return `${(fallbackOrOptions as { count: number }).count} bytes`;
      }
      return key;
    },
  }),
}));

const renderEditor = (overrides: Partial<React.ComponentProps<typeof NoteEditor>> = {}) => {
  const props: React.ComponentProps<typeof NoteEditor> = {
    noteText: 'hello',
    noteFormat: 'plain',
    onNoteTextChange: vi.fn(),
    onNoteFormatChange: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  };

  return {
    ...render(<NoteEditor {...props} />),
    props,
  };
};

describe('NoteEditor format menu', () => {
  it('shows a styled listbox with file extensions and the selected format', async () => {
    const user = userEvent.setup();
    renderEditor();

    const trigger = screen.getByRole('button', { name: 'Format: Plain text' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('listbox', { name: 'Format' })).toHaveClass(
      'max-h-[min(280px,calc(100dvh-7rem))]',
      'sm:max-h-[min(360px,55vh)]',
    );
    expect(screen.getByRole('option', { name: /Plain text.*\.txt/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('option', { name: /Markdown.*\.md/i })).toBeInTheDocument();
  });

  it('changes format and closes the menu', async () => {
    const user = userEvent.setup();
    const onNoteFormatChange = vi.fn();
    renderEditor({ onNoteFormatChange });

    await user.click(screen.getByRole('button', { name: 'Format: Plain text' }));
    await user.click(screen.getByRole('option', { name: /Markdown.*\.md/i }));

    expect(onNoteFormatChange).toHaveBeenCalledWith('markdown');
    expect(screen.queryByRole('listbox', { name: 'Format' })).not.toBeInTheDocument();
  });

  it('supports keyboard navigation and Escape', async () => {
    const user = userEvent.setup();
    renderEditor({ noteFormat: 'javascript' });

    const trigger = screen.getByRole('button', { name: 'Format: JavaScript' });
    trigger.focus();
    await user.keyboard('{ArrowDown}');

    const selectedOption = screen.getByRole('option', { name: /JavaScript.*\.js/i });
    await waitFor(() => expect(selectedOption).toHaveFocus());

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('option', { name: /Python.*\.py/i })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox', { name: 'Format' })).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
