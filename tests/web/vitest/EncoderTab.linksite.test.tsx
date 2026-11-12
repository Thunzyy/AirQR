import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '@web/App';
import { STORAGE_KEYS } from '@web/constants';
import { useEncoderStore, useSettingsStore } from '@web/store';

vi.mock('@web/pkg/airqr_core', () => ({
  default: vi.fn(() => Promise.resolve({
    AirqrEncoder: class MockEncoder {
      static new() {
        return new MockEncoder();
      }
      encode_to_gif() {
        return new Uint8Array([71, 73, 70, 56, 57, 97]);
      }
    },
    AirqrDecoder: class MockDecoder {
      static new() {
        return new MockDecoder();
      }
      decode_frame() {
        return { type: 'progress', progress: 0.5 };
      }
    },
  })),
}));

describe('EncoderTab encoder linksite shortcut', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useSettingsStore.setState({
      activeTab: 0,
      showEncoderLinksiteNotice: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('copies the encoder linksite data URL to the clipboard', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: vi.fn().mockResolvedValue('<!doctype html><html><body>Encoder</body></html>'),
    });
    const writeText = vi.fn().mockResolvedValue(undefined);

    vi.stubGlobal('fetch', fetchMock);
    navigator.clipboard.writeText = writeText;

    render(<App />);

    const copyButton = screen.getByRole('button', { name: 'Copy standalone URL' });
    await user.click(copyButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/linksites/airqr-encoder-linksite.html', {
        cache: 'no-store',
      });
      expect(writeText).toHaveBeenCalledTimes(1);
    });

    expect(writeText.mock.calls[0][0]).toContain('data:text/html;charset=utf-8;base64,');
  });

  it('shows browser compatibility help with encoder and full-app HTML links', async () => {
    const user = userEvent.setup();

    render(<App />);

    const helpButton = screen.getByRole('button', { name: 'Browser help' });
    await user.click(helpButton);

    expect(screen.getByText('Browser compatibility')).toBeInTheDocument();
    expect(screen.getByText(/Firefox works best/i)).toBeInTheDocument();

    const encoderLink = screen.getByRole('link', { name: 'Download encoder HTML' });
    const portableLink = screen.getByRole('link', { name: 'Download full app HTML' });

    expect(encoderLink).toHaveAttribute('href', '/linksites/airqr-encoder-linksite.html');
    expect(encoderLink).toHaveAttribute('download', 'AirQR_Encoder.html');
    expect(portableLink).toHaveAttribute('href', '/airqr-portable.html');
    expect(portableLink).toHaveAttribute('download', 'airqr-portable.html');
    expect(
      screen.getByText(/const dataUrl = prompt\('Paste the copied AirQR linksite URL'\);/i),
    ).toBeInTheDocument();
  });

  it('keeps the help and dismiss controls together without absolute positioning', () => {
    render(<App />);

    const helpButton = screen.getByRole('button', { name: 'Browser help' });
    const dismissButton = screen.getByRole('button', { name: 'Do not show again' });

    expect(helpButton.parentElement).toBe(dismissButton.parentElement);
    expect(helpButton.parentElement).toHaveAttribute(
      'data-testid',
      'encoder-linksite-notice-controls',
    );
    expect(dismissButton).not.toHaveClass('absolute');
  });

  it('can hide the encoder linksite notice and persist the preference in settings', async () => {
    const user = userEvent.setup();

    render(<App />);

    expect(screen.getByText('Want to use AirQR from another device?')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Do not show again' }));

    await waitFor(() => {
      expect(screen.queryByText('Want to use AirQR from another device?')).not.toBeInTheDocument();
    });

    const persistedSettings = JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS) || '{}');
    expect(persistedSettings.state?.showEncoderLinksiteNotice).toBe(false);

    await user.click(screen.getByRole('button', { name: 'Settings' }));

    expect(screen.getByText('Want to use AirQR from another device?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy standalone URL' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Browser help' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Browser help' }));

    expect(screen.getByText('Browser compatibility')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download encoder HTML' })).toHaveAttribute(
      'href',
      '/linksites/airqr-encoder-linksite.html',
    );
    expect(screen.getByRole('link', { name: 'Download full app HTML' })).toHaveAttribute(
      'href',
      '/airqr-portable.html',
    );

    const noticeToggle = screen.getByRole('switch', { name: 'Show encoder standalone help' });
    expect(noticeToggle).toHaveAttribute('aria-checked', 'false');

    await user.click(noticeToggle);

    await waitFor(() => {
      const updatedSettings = JSON.parse(localStorage.getItem(STORAGE_KEYS.SETTINGS) || '{}');
      expect(updatedSettings.state?.showEncoderLinksiteNotice).toBe(true);
    });

    await user.click(screen.getByRole('button', { name: 'Encoder' }));
    expect(screen.getByText('Want to use AirQR from another device?')).toBeInTheDocument();
  });

  it('shows an encoding indicator immediately even before the first progress update', () => {
    useEncoderStore.setState({
      isEncoding: true,
      progress: 0,
      error: null,
    });

    render(<App />);

    expect(screen.getByTestId('encoder-progress')).toBeInTheDocument();
  });
});
