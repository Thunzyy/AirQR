import { afterEach, describe, expect, it, vi } from 'vitest';

import { downloadScannerResult } from '@web/features/scanner/downloadScannerResult';

describe('downloadScannerResult', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('downloads a decoded note as a UTF-8 text file', () => {
    const createObjectUrl = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:note-download');
    const revokeObjectUrl = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => undefined);
    const originalCreateElement = document.createElement.bind(document);
    const anchor = originalCreateElement('a');
    const click = vi.spyOn(anchor, 'click').mockImplementation(() => undefined);
    vi.spyOn(document, 'createElement').mockImplementation((tagName) =>
      tagName.toLowerCase() === 'a' ? anchor : originalCreateElement(tagName)
    );

    downloadScannerResult({
      kind: 'note',
      filename: 'note.txt',
      data: new TextEncoder().encode('bonjour'),
    });

    const blob = createObjectUrl.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob?.type).toBe('text/plain;charset=utf-8');
    expect(anchor.download).toBe('note.txt');
    expect(anchor.href).toBe('blob:note-download');
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:note-download');
  });
});
