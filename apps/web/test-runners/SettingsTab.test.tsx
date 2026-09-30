import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import SettingsTab from '@web/components/tabs/SettingsTab';
import { useSettingsSync } from '@web/hooks/useSettingsSync';
import * as serverAuth from '@web/services/serverAuth';
import { resetServerAuthStatusCache } from '@web/services/serverAuth';
import { useEncoderStore, useScannerStore, useSettingsStore, useToastStore } from '@web/store';

describe('SettingsTab server auth flow', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const originalLocation = window.location;
  const SettingsTabWithBootstrap = () => {
    useSettingsSync();
    return <SettingsTab />;
  };

  beforeEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    resetServerAuthStatusCache();
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });

    useSettingsStore.setState({
      ...useSettingsStore.getInitialState(),
      uploadConfig: {
        ...useSettingsStore.getInitialState().uploadConfig,
        enabled: true,
        url: 'https://sync.example.test',
        apiKey: '',
        username: '',
        password: '',
      },
    });
    useEncoderStore.setState(useEncoderStore.getInitialState());
    useScannerStore.setState(useScannerStore.getInitialState());
    useToastStore.setState({
      ...useToastStore.getState(),
      message: '',
      type: 'info',
      visible: false,
    });
  });

  const openSettingsSection = async (name: RegExp) => {
    const settingsMenu = document.querySelector('.airqr-settings-menu');
    expect(settingsMenu).not.toBeNull();
    if (!(settingsMenu instanceof HTMLElement)) {
      throw new Error('settings menu is missing');
    }
    await userEvent.click(within(settingsMenu).getByRole('button', { name }));
  };

  const backToSettingsMenu = async () => {
    await userEvent.click(screen.getByRole('button', { name: /Back to settings/i }));
  };

  it('uses a compact visual back control with a full touch target', async () => {
    render(<SettingsTab />);

    await openSettingsSection(/Encoder/i);

    const back = screen.getByRole('button', { name: /Back to settings/i });
    expect(back).toHaveClass('airqr-settings-back-button');
    expect(back.querySelector('.airqr-settings-back-surface')).not.toBeNull();
    expect(back.querySelector('.airqr-settings-back-icon')).not.toBeNull();
  });

  it('matches the Flutter release version and keeps the GitHub star readable', async () => {
    render(<SettingsTab />);

    await openSettingsSection(/About/i);

    expect(screen.getAllByText('v1.0')).toHaveLength(2);
    const githubLink = screen.getByRole('link', { name: /star on github/i });
    expect(githubLink).toHaveClass('mt-1.5');
    expect(githubLink).not.toHaveClass('mt-3');
    const star = githubLink.querySelector('[data-icon="star"]');
    expect(star).toHaveClass('airqr-icon-explicit');
    expect(star).toHaveClass('text-[var(--airqr-primary-button-text)]');
  });

  it('does not issue duplicate login requests when testing a draft-authenticated server connection', async () => {
    let loginCalls = 0;
    let historyCalls = 0;

    fetchMock.mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes('/api/auth/status')) {
        return new Response(
          JSON.stringify({
            enabled: true,
            authorized: loginCalls > 0,
            username: loginCalls > 0 ? 'admin' : null,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      if (url.includes('/api/auth/login')) {
        loginCalls += 1;
        return new Response(
          JSON.stringify({
            ok: true,
            enabled: true,
            authorized: true,
            username: 'admin',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      if (url.includes('/api/history?limit=1')) {
        historyCalls += 1;
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/config/settings')) {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/config/export')) {
        return new Response(
          JSON.stringify({
            enabled: true,
            exportDir: null,
            exportScanned: true,
            exportGenerated: true,
            effectiveDir: null,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      throw new Error(`Unexpected fetch in SettingsTab.test.tsx: ${url}`);
    });

    render(<SettingsTabWithBootstrap />);
    await openSettingsSection(/Server sync/i);

    await userEvent.clear(screen.getByPlaceholderText('admin'));
    await userEvent.type(screen.getByPlaceholderText('admin'), 'admin');
    await userEvent.type(screen.getByPlaceholderText('••••••'), 'admin');

    expect(useSettingsStore.getState().uploadConfig.username).toBe('');
    expect(useSettingsStore.getState().uploadConfig.password).toBe('');

    await userEvent.click(
      screen.getByRole('button', { name: /^Connection$/i })
    );

    await waitFor(() => {
      expect(historyCalls).toBe(1);
    });

    await waitFor(() => {
      expect(loginCalls).toBe(1);
    });

    await waitFor(() => {
      expect(useSettingsStore.getState().uploadConfig.username).toBe('admin');
      expect(useSettingsStore.getState().uploadConfig.password).toBe('admin');
    });
    const persistedSettings = JSON.parse(localStorage.getItem('airqr_settings') ?? '{}');
    expect(persistedSettings.state.uploadConfig.username).toBe('admin');
    expect(persistedSettings.state.uploadConfig.password).toBe('admin');

    expect(screen.getByRole('button', { name: /^Connection$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Disconnect$/i })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('admin')).toHaveValue('admin');
    const passwordInput = screen.getByPlaceholderText('••••••');
    expect(passwordInput).toHaveAttribute('type', 'password');
    expect(passwordInput).toHaveValue('admin');
    expect(screen.queryByText(/Connected as/i)).not.toBeInTheDocument();
  });

  it('does not render a separate Sign In button when the server requires auth', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes('/api/auth/status')) {
        return new Response(
          JSON.stringify({
            enabled: true,
            authorized: false,
            username: null,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      if (url.includes('/api/config/export')) {
        return new Response(
          JSON.stringify({
            enabled: true,
            exportDir: null,
            exportScanned: true,
            exportGenerated: true,
            effectiveDir: null,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      throw new Error(`Unexpected fetch in SettingsTab.test.tsx: ${url}`);
    });

    render(<SettingsTab />);
    await openSettingsSection(/Server sync/i);

    expect(
      screen.getByRole('button', { name: /^Connection$/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Test$/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Sign In|settings\.signIn/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Sign Out|settings\.signOut/i })
    ).not.toBeInTheDocument();
  });

  it('renders a live unavailable status badge when the server auth probe fails', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    render(<SettingsTab />);
    await openSettingsSection(/Server sync/i);

    await waitFor(() => {
      expect(screen.getByText('Unavailable')).toBeInTheDocument();
    });
  });

  it('clears the signed-out status message once the browser is authorized again', async () => {
    let authorized = true;

    fetchMock.mockImplementation(async (input) => {
      const url = String(input);

      if (url.includes('/api/auth/status')) {
        return new Response(
          JSON.stringify({
            enabled: true,
            authorized,
            username: authorized ? 'admin' : null,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      if (url.includes('/api/auth/logout')) {
        authorized = false;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url.includes('/api/config/export')) {
        return new Response(
          JSON.stringify({
            enabled: true,
            exportDir: null,
            exportScanned: true,
            exportGenerated: true,
            effectiveDir: null,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        );
      }

      throw new Error(`Unexpected fetch in SettingsTab.test.tsx: ${url}`);
    });

    render(<SettingsTab />);
    await openSettingsSection(/Server sync/i);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /^Disconnect$/i })
      ).toBeInTheDocument();
    });

    await userEvent.click(
      screen.getByRole('button', { name: /^Disconnect$/i })
    );

    await waitFor(() => {
      expect(screen.getByText('Signed out from this browser.')).toBeInTheDocument();
    });
    expect(useToastStore.getState().visible).toBe(false);

    authorized = true;
    act(() => {
      serverAuth.resetServerAuthStatusCache();
    });

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /^Disconnect$/i })
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByText('Signed out from this browser.')
    ).not.toBeInTheDocument();
  });

  it('does not show a proactive local HTTPS certificate hint before the first failed mobile attempt', async () => {
    useSettingsStore.setState({
      ...useSettingsStore.getState(),
      uploadConfig: {
        ...useSettingsStore.getState().uploadConfig,
        url: 'https://192.168.1.25',
      },
    });

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ enabled: true, authorized: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    render(<SettingsTab />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    expect(document.body.textContent).not.toMatch(
      /Mobile local HTTPS setup|Configuration HTTPS locale sur mobile|mkcert root certificate|certificat racine mkcert|localHttpsCertificateHint/i
    );
  });

  it('handles a timed-out connection probe and stops the loading state', async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);

      if (url.includes('/api/auth/status')) {
        return Promise.resolve(
          new Response(JSON.stringify({ enabled: true, authorized: false }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
        );
      }

      if (url.includes('/api/history?limit=1')) {
        expect(init?.method).toBe('GET');
        return Promise.reject(new serverAuth.ServerRequestTimeoutError());
      }

      if (url.includes('/api/config/export')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              enabled: true,
              exportDir: null,
              exportScanned: true,
              exportGenerated: true,
              effectiveDir: null,
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }
          )
        );
      }

      throw new Error(`Unexpected fetch in timeout test: ${url}`);
    });

    render(<SettingsTab />);
    await openSettingsSection(/Server sync/i);

    await userEvent.clear(screen.getByPlaceholderText('admin'));
    await userEvent.type(screen.getByPlaceholderText('admin'), 'admin');
    await userEvent.type(screen.getByPlaceholderText('••••••'), 'admin');

    await userEvent.click(
      screen.getByRole('button', { name: /^Connection$/i })
    );

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([input]) =>
          String(input).includes('/api/history?limit=1')
        )
      ).toBe(true);
    });

    expect(useSettingsStore.getState().uploadConfig.password).toBe('');
    const inlineErrors = await screen.findAllByText(
      /timed out|HTTPS certificate|certificat HTTPS local/i
    );
    expect(inlineErrors).toHaveLength(1);
    expect(useToastStore.getState().visible).toBe(false);
    expect(screen.getByRole('button', { name: /^Connection$/i })).toBeEnabled();
  });

  it('shows external mode for an explicit external sync server URL', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    useSettingsStore.setState({
      ...useSettingsStore.getState(),
      uploadConfig: {
        ...useSettingsStore.getState().uploadConfig,
        enabled: true,
        url: 'https://airqr.pgnrd.fr',
      },
    });

    render(<SettingsTab />);
    await openSettingsSection(/Server sync/i);

    await waitFor(() => {
      expect(screen.getByText('Mode: external')).toBeInTheDocument();
      expect(screen.getByText('Unavailable')).toBeInTheDocument();
    });
  });

  it('shows same-origin mode for the default sync server URL', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    useSettingsStore.setState({
      ...useSettingsStore.getState(),
      uploadConfig: {
        ...useSettingsStore.getState().uploadConfig,
        enabled: true,
        url: 'same-origin',
      },
    });

    render(<SettingsTab />);
    await openSettingsSection(/Server sync/i);

    await waitFor(() => {
      expect(screen.getByText('Mode: same-origin')).toBeInTheDocument();
      expect(screen.getByText('Unavailable')).toBeInTheDocument();
    });
  });

  it('lets users clear saved credentials for browser-blocked HTTP external servers', async () => {
    Object.defineProperty(window, 'location', {
      value: {
        origin: 'https://app.airqr.test',
        protocol: 'https:',
        host: 'app.airqr.test',
      },
      writable: true,
      configurable: true,
    });
    useSettingsStore.setState({
      ...useSettingsStore.getState(),
      uploadConfig: {
        ...useSettingsStore.getState().uploadConfig,
        enabled: true,
        url: 'http://192.168.1.50:8081',
        apiKey: 'local-key',
        username: 'admin',
        password: 'secret',
      },
    });

    render(<SettingsTab />);
    await openSettingsSection(/Server sync/i);

    await waitFor(() => {
      expect(screen.getByText('Unavailable')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /^Disconnect$/i })
      ).toBeInTheDocument();
    });

    await userEvent.click(
      screen.getByRole('button', { name: /^Disconnect$/i })
    );

    await waitFor(() => {
      expect(useSettingsStore.getState().uploadConfig).toMatchObject({
        apiKey: '',
        username: '',
        password: '',
      });
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByText('Signed out from this browser.')).toBeInTheDocument();
  });

  it('exposes accessible names for the sync and selector controls', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ enabled: true, authorized: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );

    render(<SettingsTab />);
    await openSettingsSection(/Server sync/i);

    expect(screen.getByPlaceholderText('same-origin')).toHaveAccessibleName(/Server URL|settings\.serverUrl/i);
    expect(screen.getByPlaceholderText('admin')).toHaveAccessibleName(/Username|settings\.username/i);
    expect(screen.getByPlaceholderText('••••••')).toHaveAccessibleName(/Password|settings\.password/i);
    expect(
      screen.getByPlaceholderText('C:\\AirQR-Files or \\\\NAS\\share\\AirQR')
    ).toHaveAccessibleName(/Export Directory \(PC or NAS path\)|settings\.exportDirectory/i);
    await backToSettingsMenu();
    await openSettingsSection(/Appearance/i);
    expect(screen.getByRole('button', { name: /Language|settings\.language/i })).toBeInTheDocument();
    await backToSettingsMenu();
    await openSettingsSection(/Scanner/i);
    expect(screen.getByRole('button', { name: /Default Camera|settings\.defaultCamera/i })).toBeInTheDocument();
    await backToSettingsMenu();
    await openSettingsSection(/Server sync/i);
    expect(
      screen.getByRole('switch', { name: /Auto-sync browser history|settings\.autoSync/i })
    ).toBeChecked();
    const syncButton = screen.getByRole('button', { name: /^Sync$/i });
    expect(syncButton).toHaveClass('airqr-sync-button');
    expect(syncButton).not.toHaveClass('airqr-success-button');
  });
});
