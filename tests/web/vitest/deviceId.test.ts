import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDeviceId, getDeviceName, setDeviceName, getDeviceInfo } from '@web/utils/deviceId';

describe('deviceId', () => {
  let localStorageMock: Record<string, string> = {};

  beforeEach(() => {
    // Mock localStorage
    localStorageMock = {};

    (globalThis as any).localStorage = {
      getItem: vi.fn((key: string) => localStorageMock[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        localStorageMock[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete localStorageMock[key];
      }),
      clear: vi.fn(() => {
        localStorageMock = {};
      }),
      key: vi.fn((index: number) => Object.keys(localStorageMock)[index] || null),
      length: 0,
    };

    // Mock navigator.userAgent
    Object.defineProperty(globalThis.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      configurable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getDeviceId', () => {
    it('should generate and persist a new device ID when none exists', () => {
      const deviceId = getDeviceId();

      expect(deviceId).toMatch(/^web-\d+-[a-z0-9]{6}$/);
      expect(localStorage.setItem).toHaveBeenCalledWith('airqr_device_id', deviceId);
    });

    it('should return existing device ID from localStorage', () => {
      const existingId = 'web-1234567890-abc123';
      localStorageMock['airqr_device_id'] = existingId;

      const deviceId = getDeviceId();

      expect(deviceId).toBe(existingId);
      expect(localStorage.setItem).not.toHaveBeenCalled();
    });

    it('should generate temporary ID when localStorage is undefined (SSR)', () => {
      delete (globalThis as any).localStorage;

      const deviceId = getDeviceId();

      expect(deviceId).toMatch(/^web-\d+-[a-z0-9]{6}$/);
    });

    it('should handle localStorage errors gracefully (private browsing)', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const error = new Error('QuotaExceededError');

      vi.mocked(localStorage.getItem).mockImplementation(() => {
        throw error;
      });

      const deviceId = getDeviceId();

      expect(deviceId).toMatch(/^web-\d+-[a-z0-9]{6}$/);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'localStorage access failed, using temporary device ID:',
        error
      );

      consoleWarnSpy.mockRestore();
    });

    it('should generate unique IDs on multiple calls when localStorage fails', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      vi.mocked(localStorage.getItem).mockImplementation(() => {
        throw new Error('Access denied');
      });

      const id1 = getDeviceId();
      const id2 = getDeviceId();

      // IDs should be different (because timestamp and random change)
      expect(id1).not.toBe(id2);
      expect(consoleWarnSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('getDeviceName', () => {
    it('should return existing device name from localStorage', () => {
      const existingName = 'My Custom Device';
      localStorageMock['airqr_device_name'] = existingName;

      const deviceName = getDeviceName();

      expect(deviceName).toBe(existingName);
      expect(localStorage.setItem).not.toHaveBeenCalled();
    });

    it('should detect and persist iOS device', () => {
      Object.defineProperty(globalThis.navigator, 'userAgent', {
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X)',
        configurable: true,
      });

      const deviceName = getDeviceName();

      expect(deviceName).toBe('iOS Browser');
      expect(localStorage.setItem).toHaveBeenCalledWith('airqr_device_name', 'iOS Browser');
    });

    it('should detect and persist Android device', () => {
      Object.defineProperty(globalThis.navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Linux; Android 10)',
        configurable: true,
      });

      const deviceName = getDeviceName();

      expect(deviceName).toBe('Android Browser');
      expect(localStorage.setItem).toHaveBeenCalledWith('airqr_device_name', 'Android Browser');
    });

    it('should detect and persist Windows device', () => {
      Object.defineProperty(globalThis.navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        configurable: true,
      });

      const deviceName = getDeviceName();

      expect(deviceName).toBe('Windows Browser');
      expect(localStorage.setItem).toHaveBeenCalledWith('airqr_device_name', 'Windows Browser');
    });

    it('should detect and persist Mac device', () => {
      Object.defineProperty(globalThis.navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        configurable: true,
      });

      const deviceName = getDeviceName();

      expect(deviceName).toBe('Mac Browser');
      expect(localStorage.setItem).toHaveBeenCalledWith('airqr_device_name', 'Mac Browser');
    });

    it('should default to "Web Browser" for unknown platform', () => {
      Object.defineProperty(globalThis.navigator, 'userAgent', {
        value: 'Mozilla/5.0 (Unknown Platform)',
        configurable: true,
      });

      const deviceName = getDeviceName();

      expect(deviceName).toBe('Web Browser');
      expect(localStorage.setItem).toHaveBeenCalledWith('airqr_device_name', 'Web Browser');
    });

    it('should return "Web Browser" when localStorage is undefined (SSR)', () => {
      delete (globalThis as any).localStorage;

      const deviceName = getDeviceName();

      expect(deviceName).toBe('Web Browser');
    });

    it('should handle localStorage errors gracefully (private browsing)', () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const error = new Error('QuotaExceededError');

      vi.mocked(localStorage.getItem).mockImplementation(() => {
        throw error;
      });

      const deviceName = getDeviceName();

      expect(deviceName).toBe('Web Browser');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'localStorage access failed, using default device name:',
        error
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('setDeviceName', () => {
    it('should set device name successfully', () => {
      setDeviceName('My Custom Device');

      expect(localStorage.setItem).toHaveBeenCalledWith('airqr_device_name', 'My Custom Device');
    });

    it('should trim whitespace from device name', () => {
      setDeviceName('  My Device  ');

      expect(localStorage.setItem).toHaveBeenCalledWith('airqr_device_name', 'My Device');
    });

    it('should throw error for empty device name', () => {
      expect(() => setDeviceName('')).toThrow('Device name cannot be empty');
      expect(localStorage.setItem).not.toHaveBeenCalled();
    });

    it('should throw error for whitespace-only device name', () => {
      expect(() => setDeviceName('   ')).toThrow('Device name cannot be empty');
      expect(localStorage.setItem).not.toHaveBeenCalled();
    });

    it('should throw error for device name exceeding 100 characters', () => {
      const longName = 'a'.repeat(101);

      expect(() => setDeviceName(longName)).toThrow('Device name cannot exceed 100 characters');
      expect(localStorage.setItem).not.toHaveBeenCalled();
    });

    it('should accept device name with exactly 100 characters', () => {
      const maxName = 'a'.repeat(100);

      expect(() => setDeviceName(maxName)).not.toThrow();
      expect(localStorage.setItem).toHaveBeenCalledWith('airqr_device_name', maxName);
    });

    it('should throw error when localStorage is unavailable', () => {
      vi.mocked(localStorage.setItem).mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      expect(() => setDeviceName('My Device')).toThrow(
        'Failed to save device name: localStorage is unavailable'
      );

      consoleWarnSpy.mockRestore();
    });

    it('should handle SSR environment gracefully', () => {
      delete (globalThis as any).localStorage;

      // Should not throw, just silently fail
      expect(() => setDeviceName('My Device')).not.toThrow();
    });
  });

  describe('getDeviceInfo', () => {
    it('should return an object with deviceId and deviceName', () => {
      localStorageMock['airqr_device_id'] = 'web-1234567890-abc123';
      localStorageMock['airqr_device_name'] = 'My Custom Device';

      const deviceInfo = getDeviceInfo();

      expect(deviceInfo).toEqual({
        deviceId: 'web-1234567890-abc123',
        deviceName: 'My Custom Device',
      });
    });

    it('should generate new ID and name if none exist', () => {
      const deviceInfo = getDeviceInfo();

      expect(deviceInfo.deviceId).toMatch(/^web-\d+-[a-z0-9]{6}$/);
      expect(deviceInfo.deviceName).toBe('Windows Browser');
    });

    it('should work in SSR environment', () => {
      delete (globalThis as any).localStorage;

      const deviceInfo = getDeviceInfo();

      expect(deviceInfo.deviceId).toMatch(/^web-\d+-[a-z0-9]{6}$/);
      expect(deviceInfo.deviceName).toBe('Web Browser');
    });
  });
});
