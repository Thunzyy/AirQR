// apps/web/src/utils/deviceId.ts

import { globalHas } from '../parse/wire';

const DEVICE_ID_KEY = 'airqr_device_id';
const DEVICE_NAME_KEY = 'airqr_device_name';

/**
 * Generate a unique device ID (persisted in localStorage).
 */
export function getDeviceId(): string {
  if (!globalHas('localStorage')) {
    return `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  try {
    let deviceId = localStorage.getItem(DEVICE_ID_KEY);
    if (!deviceId) {
      deviceId = `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem(DEVICE_ID_KEY, deviceId);
    }
    return deviceId;
  } catch (error) {
    // localStorage may throw in private browsing mode
    console.warn('localStorage access failed, using temporary device ID:', error);
    return `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

/**
 * Get or generate device name.
 * Defaults to browser + platform info.
 */
export function getDeviceName(): string {
  if (!globalHas('localStorage')) {
    return 'Web Browser';
  }

  try {
    let deviceName = localStorage.getItem(DEVICE_NAME_KEY);
    if (!deviceName) {
      const ua = navigator.userAgent;
      if (/iPhone|iPad|iPod/.test(ua)) {
        deviceName = 'iOS Browser';
      } else if (/Android/.test(ua)) {
        deviceName = 'Android Browser';
      } else if (/Windows/.test(ua)) {
        deviceName = 'Windows Browser';
      } else if (/Mac/.test(ua)) {
        deviceName = 'Mac Browser';
      } else {
        deviceName = 'Web Browser';
      }
      localStorage.setItem(DEVICE_NAME_KEY, deviceName);
    }
    return deviceName;
  } catch (error) {
    // localStorage may throw in private browsing mode
    console.warn('localStorage access failed, using default device name:', error);
    return 'Web Browser';
  }
}

/**
 * Set custom device name.
 * @param name - Custom device name (max 100 characters, will be trimmed)
 * @throws {Error} If name is empty after trimming
 */
export function setDeviceName(name: string): void {
  // Input validation
  const trimmedName = name.trim();

  if (!trimmedName) {
    throw new Error('Device name cannot be empty');
  }

  if (trimmedName.length > 100) {
    throw new Error('Device name cannot exceed 100 characters');
  }

  if (globalHas('localStorage')) {
    try {
      localStorage.setItem(DEVICE_NAME_KEY, trimmedName);
    } catch (error) {
      // localStorage may throw in private browsing mode
      console.warn('Failed to save device name to localStorage:', error);
      throw new Error('Failed to save device name: localStorage is unavailable');
    }
  }
}

export interface DeviceInfo {
  deviceId: string;
  deviceName: string;
}

export function getDeviceInfo(): DeviceInfo {
  return {
    deviceId: getDeviceId(),
    deviceName: getDeviceName(),
  };
}
