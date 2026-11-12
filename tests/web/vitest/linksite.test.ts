import { describe, expect, it, vi } from 'vitest';

import {
  buildEncoderLinksiteDataUrl,
  ENCODER_LINKSITE_PATH,
  htmlToDataUrl,
} from '@web/utils/linksite';

describe('linksite utilities', () => {
  it('encodes HTML into a data URL', () => {
    const dataUrl = htmlToDataUrl('<!doctype html><title>AirQR</title>');

    expect(dataUrl.startsWith('data:text/html;charset=utf-8;base64,')).toBe(true);
    expect(atob(dataUrl.split(',')[1])).toContain('<title>AirQR</title>');
  });

  it('loads the encoder linksite HTML and returns a data URL', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('<!doctype html><h1>Encoder</h1>'),
    });

    const dataUrl = await buildEncoderLinksiteDataUrl(
      fetchImpl as unknown as typeof fetch,
    );

    expect(fetchImpl).toHaveBeenCalledWith(ENCODER_LINKSITE_PATH, {
      cache: 'no-store',
    });
    expect(atob(dataUrl.split(',')[1])).toContain('<h1>Encoder</h1>');
  });

  it('throws when the encoder linksite asset cannot be loaded', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: vi.fn(),
    });

    await expect(
      buildEncoderLinksiteDataUrl(fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow('Failed to load encoder linksite (404)');
  });
});
