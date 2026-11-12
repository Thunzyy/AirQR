import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildServerEndpoint,
  buildServerWebSocketUrl,
  getConnectionFailureTranslationKey,
  getConnectionTimeoutTranslationKey,
  isLocalServerBaseUrl,
  isMixedContentBlocked,
  resolveFetchCredentials,
  resolveSameOriginLocalFallback,
  resolveServerAccessMode,
  resolveServerBaseUrl,
} from '@web/services/syncUrl';

const originalLocation = window.location;

function setWindowLocation(value: { origin: string; protocol: string; host: string }) {
  Object.defineProperty(window, 'location', {
    value,
    writable: true,
    configurable: true,
  });
}

beforeEach(() => {
  setWindowLocation({
    origin: 'https://app.airqr.test',
    protocol: 'https:',
    host: 'app.airqr.test',
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', {
    value: originalLocation,
    writable: true,
    configurable: true,
  });
});

describe('sync server access mode', () => {
  it('treats empty and same-origin aliases as same-origin mode', () => {
    expect(resolveServerAccessMode('')).toBe('same-origin');
    expect(resolveServerAccessMode('/')).toBe('same-origin');
    expect(resolveServerAccessMode('self')).toBe('same-origin');
    expect(resolveServerAccessMode('same-origin')).toBe('same-origin');
  });

  it('treats the current origin URL as same-origin mode', () => {
    expect(resolveServerAccessMode('https://app.airqr.test')).toBe('same-origin');
  });

  it('treats an explicit different origin as external mode', () => {
    expect(resolveServerAccessMode('https://airqr.pgnrd.fr')).toBe('external');
    expect(resolveServerAccessMode('192.168.1.50:8081')).toBe('external');
  });

  it('uses same-origin credentials only for same-origin endpoints', () => {
    expect(resolveFetchCredentials('https://app.airqr.test/api/history')).toBe('same-origin');
    expect(resolveFetchCredentials('https://airqr.pgnrd.fr/api/history')).toBe('omit');
  });

  it('builds direct external endpoints and websockets for external URLs', () => {
    const baseUrl = resolveServerBaseUrl('https://airqr.pgnrd.fr');

    expect(baseUrl).toBe('https://airqr.pgnrd.fr');
    expect(buildServerEndpoint(baseUrl!, 'api/history')).toBe('https://airqr.pgnrd.fr/api/history');
    expect(buildServerWebSocketUrl(baseUrl!, '/api/v1/ws/events')).toBe(
      'wss://airqr.pgnrd.fr/api/v1/ws/events'
    );
  });

  it('detects browser-blocked HTTPS page to HTTP external server access', () => {
    expect(isMixedContentBlocked('http://airqr.pgnrd.fr:8081')).toBe(true);
    expect(isMixedContentBlocked('https://airqr.pgnrd.fr')).toBe(false);
  });

  it('blocks browser-blocked HTTP external endpoints instead of rewriting to same-origin', () => {
    expect(() =>
      buildServerEndpoint('http://192.168.1.50:8081', 'api/auth/status')
    ).toThrow('Mixed content');
  });

  it('does not rewrite browser-blocked HTTP external websockets to same-origin', () => {
    expect(
      buildServerWebSocketUrl('http://192.168.1.50:8081', '/api/v1/ws/events')
    ).toBeNull();
  });
});

describe('getConnectionFailureTranslationKey', () => {
  it('returns the external CORS hint for private LAN IPs when the app is on a public origin', () => {
    expect(
      getConnectionFailureTranslationKey('https://192.168.1.100:8081')
    ).toBe('errors.connectionFailedCors');
  });

  it('returns the local HTTPS hint for private LAN IPs when the app is also local', () => {
    setWindowLocation({
      origin: 'https://192.168.1.36:5177',
      protocol: 'https:',
      host: '192.168.1.36:5177',
    });

    expect(
      getConnectionFailureTranslationKey('https://192.168.1.100:8081')
    ).toBe('errors.connectionFailedLocalHttps');
  });

  it('returns the external CORS hint for public HTTPS hosts', () => {
    expect(
      getConnectionFailureTranslationKey('https://airqr.example.com')
    ).toBe('errors.connectionFailedCors');
  });

  it('returns the external CORS hint for insecure local URLs', () => {
    expect(
      getConnectionFailureTranslationKey('http://192.168.1.100:8081')
    ).toBe('errors.connectionFailedCors');
  });
});

describe('getConnectionTimeoutTranslationKey', () => {
  it('returns the generic timeout key for private LAN IPs when the app is on a public origin', () => {
    expect(
      getConnectionTimeoutTranslationKey('https://192.168.1.100:8081')
    ).toBe('settings.connectionTimedOut');
  });

  it('returns the local HTTPS timeout hint for private LAN IPs when the app is also local', () => {
    setWindowLocation({
      origin: 'https://192.168.1.36:5177',
      protocol: 'https:',
      host: '192.168.1.36:5177',
    });

    expect(
      getConnectionTimeoutTranslationKey('https://192.168.1.100:8081')
    ).toBe('settings.connectionTimedOutLocalHttps');
  });

  it('returns the generic timeout key for public HTTPS hosts', () => {
    expect(
      getConnectionTimeoutTranslationKey('https://airqr.example.com')
    ).toBe('settings.connectionTimedOut');
  });
});

describe('isLocalServerBaseUrl', () => {
  it('detects loopback and LAN servers without treating public domains as local', () => {
    expect(isLocalServerBaseUrl('http://127.0.0.1:8081')).toBe(true);
    expect(isLocalServerBaseUrl('http://localhost:8081')).toBe(true);
    expect(isLocalServerBaseUrl('https://192.168.1.36:8081')).toBe(true);
    expect(isLocalServerBaseUrl('https://10.0.0.12:8081')).toBe(true);
    expect(isLocalServerBaseUrl('https://172.20.0.12:8081')).toBe(true);
    expect(isLocalServerBaseUrl('https://airqr.pgnrd.fr')).toBe(false);
  });

  it('reuses the trusted app origin for a local HTTPS listener on the same host', () => {
    setWindowLocation({
      origin: 'https://192.168.1.36:5173',
      protocol: 'https:',
      host: '192.168.1.36:5173',
    });

    expect(
      resolveSameOriginLocalFallback('https://192.168.1.36:8081')
    ).toBe('https://192.168.1.36:5173');
    expect(
      resolveSameOriginLocalFallback('https://192.168.1.100:8081')
    ).toBeNull();
  });
});
