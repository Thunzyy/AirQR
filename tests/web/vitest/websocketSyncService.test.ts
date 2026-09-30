import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  WebSocketSyncService,
  getWebSocketSyncService,
  resetWebSocketSyncService,
} from '@web/services/websocketSyncService';
import type { ScanUploadConfig } from '@web/types';

// Mock dependencies
vi.mock('@web/utils/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@web/utils/deviceId', () => ({
  getDeviceInfo: vi.fn(() => ({
    deviceId: 'test-device-id',
    deviceName: 'Test Device',
  })),
}));

vi.mock('@web/services/syncUrl', () => ({
  resolveServerBaseUrl: vi.fn((url: string) => {
    if (url.includes('invalid')) return null;
    return url.startsWith('http') ? url : `http://${url}`;
  }),
  buildServerWebSocketUrl: vi.fn((baseUrl: string, path: string) => {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    if (baseUrl.includes('invalid')) return null;
    if (
      typeof window !== 'undefined' &&
      window.location?.protocol === 'https:' &&
      baseUrl.startsWith('http://')
    ) {
      return null;
    }
    const url = new URL(baseUrl.startsWith('http') ? baseUrl : `http://${baseUrl}`);
    const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${url.host}${normalizedPath}`;
  }),
}));

// Mock WebSocket
class MockWebSocket {
  public onopen: ((event: Event) => void) | null = null;
  public onclose: ((event: CloseEvent) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public readyState: number = WebSocket.CONNECTING;
  public url: string;
  public protocol: string;

  private static instances: MockWebSocket[] = [];

  constructor(url: string, protocol?: string | string[]) {
    this.url = url;
    this.protocol = Array.isArray(protocol) ? protocol[0] : protocol || '';
    MockWebSocket.instances.push(this);
  }

  send(_data: string): void {
    if (this.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not open');
    }
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new CloseEvent('close', { code: 1000, reason: 'Normal closure' }));
    }
  }

  // Test helpers
  simulateOpen(): void {
    this.readyState = WebSocket.OPEN;
    if (this.onopen) {
      this.onopen(new Event('open'));
    }
  }

  simulateMessage(data: string): void {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data }));
    }
  }

  simulateError(): void {
    if (this.onerror) {
      this.onerror(new Event('error'));
    }
  }

  static getLastInstance(): MockWebSocket | undefined {
    return this.instances[this.instances.length - 1];
  }

  static reset(): void {
    this.instances = [];
  }
}

describe('WebSocketSyncService', () => {
  let service: WebSocketSyncService;
  let config: ScanUploadConfig;

  beforeEach(() => {
    // Setup global WebSocket mock
    (globalThis as any).WebSocket = MockWebSocket as any;
    MockWebSocket.reset();

    // Reset singleton
    resetWebSocketSyncService();

    // Default config
    config = {
      enabled: true,
      url: 'http://localhost:8081',
      apiKey: '',
      username: '',
      password: '',
      syncScanned: false,
      syncGenerated: false,
      autoSyncHistory: false,
    };

    service = new WebSocketSyncService();

    vi.useFakeTimers();
  });

  afterEach(() => {
    service.disconnect();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('Singleton pattern', () => {
    it('should return the same instance on multiple calls', () => {
      resetWebSocketSyncService();

      const instance1 = getWebSocketSyncService();
      const instance2 = getWebSocketSyncService();

      expect(instance1).toBe(instance2);
    });

    it('should create a new instance after reset', () => {
      const instance1 = getWebSocketSyncService();
      resetWebSocketSyncService();
      const instance2 = getWebSocketSyncService();

      expect(instance1).not.toBe(instance2);
    });
  });

  describe('Connection', () => {
    it('does not expose the obsolete scan packet transport API on the shared realtime service', () => {
      expect('sendPacket' in service).toBe(false);
    });

    it('should not connect when sync is disabled', () => {
      config.enabled = false;
      service.connect(config);

      expect(service.getState()).toBe('disconnected');
      expect(MockWebSocket.getLastInstance()).toBeUndefined();
    });

    it('should not connect when URL is missing', () => {
      config.url = '';
      service.connect(config);

      expect(service.getState()).toBe('disconnected');
      expect(MockWebSocket.getLastInstance()).toBeUndefined();
    });

    it('should establish WebSocket connection successfully', () => {
      service.connect(config);

      const ws = MockWebSocket.getLastInstance();
      expect(ws).toBeDefined();
      expect(ws!.url).toContain('ws://');
      // Protocol is sent in hello message, not as WebSocket subprotocol
      expect(ws!.protocol).toBe('');
      expect(service.getState()).toBe('connecting');
    });

    it('should send hello message after connection opens', () => {
      service.connect(config);

      const ws = MockWebSocket.getLastInstance()!;
      const sendSpy = vi.spyOn(ws, 'send');

      ws.simulateOpen();

      expect(sendSpy).toHaveBeenCalledWith(
        expect.stringContaining('"type":"hello"')
      );
      expect(sendSpy).toHaveBeenCalledWith(
        expect.stringContaining('"deviceId":"test-device-id"')
      );
    });

    it('should transition to connected state after welcome message', () => {
      service.connect(config);

      const ws = MockWebSocket.getLastInstance()!;
      ws.simulateOpen();
      ws.simulateMessage(JSON.stringify({
        type: 'welcome',
        clientId: 'client-123',
      }));

      expect(service.getState()).toBe('connected');
    });

    it('should include auth credentials in hello message', () => {
      config.apiKey = 'test-api-key';
      config.username = 'testuser';
      config.password = 'testpass';

      service.connect(config);

      const ws = MockWebSocket.getLastInstance()!;
      const sendSpy = vi.spyOn(ws, 'send');

      ws.simulateOpen();

      expect(sendSpy).toHaveBeenCalledWith(
        expect.stringContaining('"apiKey":"test-api-key"')
      );
      expect(sendSpy).toHaveBeenCalledWith(
        expect.stringContaining('"username":"testuser"')
      );
      // Password should be included but redacted in logs
      expect(sendSpy).toHaveBeenCalledWith(
        expect.stringContaining('"password":"testpass"')
      );
    });

    it('should prevent concurrent connect calls', () => {
      service.connect(config);
      service.connect(config); // Second call should be ignored

      const instances = (MockWebSocket as any).instances;
      expect(instances.length).toBe(1);
    });

    it('should disconnect before reconnecting if already connected', () => {
      service.connect(config);
      const ws1 = MockWebSocket.getLastInstance()!;
      ws1.simulateOpen();
      ws1.simulateMessage(JSON.stringify({ type: 'welcome', clientId: 'client-1' }));

      expect(service.getState()).toBe('connected');

      service.connect(config);

      // Should disconnect first
      expect(ws1.readyState).toBe(WebSocket.CLOSED);
    });
  });

  describe('Reconnect failures', () => {
    it('enters error state after max WebSocket reconnect attempts', () => {
      service.connect(config);

      // Simulate 5 failed WebSocket connections
      for (let i = 0; i < 5; i++) {
        const ws = MockWebSocket.getLastInstance()!;
        ws.simulateError();
        ws.close();

        if (i < 4) {
          vi.advanceTimersByTime(2 ** (i + 1) * 1000); // Exponential backoff
        }
      }

      expect(service.getState()).toBe('error');
    });

    it('should handle connection failures gracefully', () => {
      service.connect(config);

      // Exhaust retries
      for (let i = 0; i < 5; i++) {
        const ws = MockWebSocket.getLastInstance()!;
        ws.simulateError();
        ws.close();
        if (i < 4) {
          vi.advanceTimersByTime(2 ** (i + 1) * 1000);
        }
      }

      expect(service.getState()).toBe('error');
    });

    it('should cleanup on disconnect after failed reconnect attempts', () => {
      service.connect(config);

      // Exhaust retries
      for (let i = 0; i < 5; i++) {
        const ws = MockWebSocket.getLastInstance()!;
        ws.simulateError();
        ws.close();
        if (i < 4) {
          vi.advanceTimersByTime(2 ** (i + 1) * 1000);
        }
      }

      service.disconnect();

      // Should have cleaned up and not throw
      expect(service.getState()).toBe('disconnected');
    });
  });

  describe('Reconnection', () => {
    it('should reconnect after a successful handshake closes later', () => {
      service.connect(config);

      const ws1 = MockWebSocket.getLastInstance()!;
      ws1.simulateOpen();
      ws1.simulateMessage(JSON.stringify({ type: 'welcome', clientId: 'client-1' }));

      ws1.close();
      vi.advanceTimersByTime(1000);

      expect((MockWebSocket as any).instances.length).toBe(2);
    });

    it('should not reconnect after manual disconnect', () => {
      service.connect(config);

      const ws = MockWebSocket.getLastInstance()!;
      ws.simulateOpen();
      ws.simulateMessage(JSON.stringify({ type: 'welcome', clientId: 'client-1' }));

      service.disconnect();

      vi.advanceTimersByTime(10000);

      // Should not create new WebSocket after disconnect
      expect((MockWebSocket as any).instances.length).toBe(1);
    });

    it('reconnects immediately when the browser comes back online during retry backoff', () => {
      service.connect(config);

      const ws1 = MockWebSocket.getLastInstance()!;
      ws1.simulateOpen();
      ws1.simulateMessage(JSON.stringify({ type: 'welcome', clientId: 'client-1' }));

      ws1.close();
      expect((MockWebSocket as any).instances.length).toBe(1);

      window.dispatchEvent(new Event('online'));
      vi.advanceTimersByTime(0);

      expect((MockWebSocket as any).instances.length).toBe(2);
    });

    it('reconnects immediately when the tab becomes visible again during retry backoff', () => {
      const originalVisibilityState = document.visibilityState;
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        value: 'hidden',
      });

      try {
        service.connect(config);

        const ws1 = MockWebSocket.getLastInstance()!;
        ws1.simulateOpen();
        ws1.simulateMessage(JSON.stringify({ type: 'welcome', clientId: 'client-1' }));

        ws1.close();
        expect((MockWebSocket as any).instances.length).toBe(1);

        document.dispatchEvent(new Event('visibilitychange'));
        vi.advanceTimersByTime(0);
        expect((MockWebSocket as any).instances.length).toBe(1);

        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          value: 'visible',
        });
        document.dispatchEvent(new Event('visibilitychange'));
        vi.advanceTimersByTime(0);

        expect((MockWebSocket as any).instances.length).toBe(2);
      } finally {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          value: originalVisibilityState,
        });
      }
    });

    it('closes an active websocket on offline and waits for online before reconnecting', () => {
      service.connect(config);

      const ws1 = MockWebSocket.getLastInstance()!;
      ws1.simulateOpen();
      ws1.simulateMessage(JSON.stringify({ type: 'welcome', clientId: 'client-1' }));

      window.dispatchEvent(new Event('offline'));
      vi.advanceTimersByTime(1000);

      expect(ws1.readyState).toBe(WebSocket.CLOSED);
      expect((MockWebSocket as any).instances.length).toBe(1);

      window.dispatchEvent(new Event('online'));
      vi.advanceTimersByTime(0);

      expect((MockWebSocket as any).instances.length).toBe(2);
    });
  });

  describe('Message handling', () => {
    it('should parse and handle welcome message', () => {
      service.connect(config);

      const ws = MockWebSocket.getLastInstance()!;
      ws.simulateOpen();
      ws.simulateMessage(JSON.stringify({
        type: 'welcome',
        clientId: 'client-abc-123',
        serverVersion: 1,
      }));

      expect(service.getState()).toBe('connected');
    });

    it('should handle pong message', () => {
      service.connect(config);

      const ws = MockWebSocket.getLastInstance()!;
      ws.simulateOpen();
      ws.simulateMessage(JSON.stringify({ type: 'welcome', clientId: 'client-1' }));

      // Advance time to trigger ping
      vi.advanceTimersByTime(30000);

      // Simulate pong response
      ws.simulateMessage(JSON.stringify({ type: 'pong' }));

      // Should not close connection
      expect(service.getState()).toBe('connected');
    });

    it('should close connection on pong timeout', () => {
      service.connect(config);

      const ws = MockWebSocket.getLastInstance()!;
      ws.simulateOpen();
      ws.simulateMessage(JSON.stringify({ type: 'welcome', clientId: 'client-1' }));

      const closeSpy = vi.spyOn(ws, 'close');

      // Trigger ping
      vi.advanceTimersByTime(30000);

      // Wait for pong timeout (10 seconds)
      vi.advanceTimersByTime(10000);

      expect(closeSpy).toHaveBeenCalled();
    });

    it('should broadcast server events to subscribers', () => {
      const handler = vi.fn();
      service.subscribe(handler);

      service.connect(config);

      const ws = MockWebSocket.getLastInstance()!;
      ws.simulateOpen();
      ws.simulateMessage(JSON.stringify({ type: 'welcome', clientId: 'client-1' }));

      ws.simulateMessage(JSON.stringify({
        type: 'history',
        payload: { action: 'add', id: '123' },
      }));

      expect(handler).toHaveBeenCalledWith({
        type: 'history',
        payload: { action: 'add', id: '123' },
      });
    });

    it('should handle invalid JSON gracefully', () => {
      service.connect(config);

      const ws = MockWebSocket.getLastInstance()!;
      ws.simulateOpen();

      // Should not throw
      expect(() => {
        ws.simulateMessage('invalid json');
      }).not.toThrow();

      expect(service.getState()).toBe('connecting');
    });

    it('should handle unknown message types', () => {
      service.connect(config);

      const ws = MockWebSocket.getLastInstance()!;
      ws.simulateOpen();
      ws.simulateMessage(JSON.stringify({ type: 'welcome', clientId: 'client-1' }));

      // Should not throw
      expect(() => {
        ws.simulateMessage(JSON.stringify({ type: 'unknown', data: 'test' }));
      }).not.toThrow();

      expect(service.getState()).toBe('connected');
    });
  });

  describe('Subscription', () => {
    it('should allow multiple subscribers', () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      service.subscribe(handler1);
      service.subscribe(handler2);

      service.connect(config);

      const ws = MockWebSocket.getLastInstance()!;
      ws.simulateOpen();
      ws.simulateMessage(JSON.stringify({ type: 'welcome', clientId: 'client-1' }));

      ws.simulateMessage(JSON.stringify({
        type: 'scan-complete',
        payload: { sessionId: 'session-1' },
      }));

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('should return unsubscribe function', () => {
      const handler = vi.fn();
      const unsubscribe = service.subscribe(handler);

      service.connect(config);

      const ws = MockWebSocket.getLastInstance()!;
      ws.simulateOpen();
      ws.simulateMessage(JSON.stringify({ type: 'welcome', clientId: 'client-1' }));
      expect(handler).toHaveBeenCalledTimes(1);
      handler.mockClear();

      unsubscribe();

      ws.simulateMessage(JSON.stringify({
        type: 'history',
        payload: { action: 'add' },
      }));

      expect(handler).not.toHaveBeenCalled();
    });

    it('should handle errors in event handlers gracefully', () => {
      const errorHandler = vi.fn(() => {
        throw new Error('Handler error');
      });
      const normalHandler = vi.fn();

      service.subscribe(errorHandler);
      service.subscribe(normalHandler);

      service.connect(config);

      const ws = MockWebSocket.getLastInstance()!;
      ws.simulateOpen();
      ws.simulateMessage(JSON.stringify({ type: 'welcome', clientId: 'client-1' }));

      // Should not throw and should still call other handlers
      expect(() => {
        ws.simulateMessage(JSON.stringify({
          type: 'history',
          payload: { action: 'add' },
        }));
      }).not.toThrow();

      expect(errorHandler).toHaveBeenCalled();
      expect(normalHandler).toHaveBeenCalled();
    });
  });

  describe('Disconnect', () => {
    it('should close WebSocket connection', () => {
      service.connect(config);

      const ws = MockWebSocket.getLastInstance()!;
      ws.simulateOpen();
      ws.simulateMessage(JSON.stringify({ type: 'welcome', clientId: 'client-1' }));

      service.disconnect();

      expect(ws.readyState).toBe(WebSocket.CLOSED);
      expect(service.getState()).toBe('disconnected');
    });

    it('should clear all timers on disconnect', () => {
      service.connect(config);

      const ws = MockWebSocket.getLastInstance()!;
      ws.simulateOpen();
      ws.simulateMessage(JSON.stringify({ type: 'welcome', clientId: 'client-1' }));

      service.disconnect();

      // Advance time significantly
      vi.advanceTimersByTime(100000);

      // Should not create new connections or send pings
      expect((MockWebSocket as any).instances.length).toBe(1);
    });

  });

  describe('getDeviceInfo', () => {
    it('should return device info', () => {
      const deviceInfo = service.getDeviceInfo();

      expect(deviceInfo).toEqual({
        deviceId: 'test-device-id',
        deviceName: 'Test Device',
      });
    });

    it('should return a copy of device info', () => {
      const deviceInfo1 = service.getDeviceInfo();
      const deviceInfo2 = service.getDeviceInfo();

      expect(deviceInfo1).not.toBe(deviceInfo2);
      expect(deviceInfo1).toEqual(deviceInfo2);
    });
  });

  describe('WebSocket URL building', () => {
    // Store original window.location
    const originalLocation = window.location;

    beforeEach(() => {
      // Mock window.location for HTTP page (no mixed content)
      Object.defineProperty(window, 'location', {
        value: {
          origin: 'http://localhost:5173',
          protocol: 'http:',
          host: 'localhost:5173',
        },
        writable: true,
        configurable: true,
      });
    });

    afterEach(() => {
      // Restore original window.location
      Object.defineProperty(window, 'location', {
        value: originalLocation,
        writable: true,
        configurable: true,
      });
    });

    it('should build WebSocket URL on the configured server origin without port+1', () => {
      config.url = 'http://localhost:8081';
      service.connect(config);

      const ws = MockWebSocket.getLastInstance()!;
      expect(ws.url).toBe('ws://localhost:8081/api/v1/ws/events');
    });

    it('should build secure WebSocket URL on same origin without forcing +1 port', () => {
      // Mock HTTPS page with HTTPS sync server (no mixed content)
      Object.defineProperty(window, 'location', {
        value: {
          origin: 'https://example.com',
          protocol: 'https:',
          host: 'example.com',
        },
        writable: true,
        configurable: true,
      });

      config.url = 'https://example.com';
      service.connect(config);

      const ws = MockWebSocket.getLastInstance()!;
      // Same-origin HTTPS should use default port and path-based WS routing.
      expect(ws.url).toBe('wss://example.com/api/v1/ws/events');
    });

    it('should reject browser-blocked HTTP external servers from HTTPS pages', () => {
      // Mock HTTPS page (would cause mixed content with HTTP server)
      Object.defineProperty(window, 'location', {
        value: {
          origin: 'https://192.168.1.100:5173',
          protocol: 'https:',
          host: '192.168.1.100:5173',
        },
        writable: true,
        configurable: true,
      });

      config.url = 'http://192.168.1.100:8081';
      service.connect(config);

      expect(service.getState()).toBe('error');
      expect(MockWebSocket.getLastInstance()).toBeUndefined();
    });

    it('should keep the configured origin for non-standard ports', () => {
      config.url = 'http://localhost:3000';
      service.connect(config);

      const ws = MockWebSocket.getLastInstance()!;
      expect(ws.url).toBe('ws://localhost:3000/api/v1/ws/events');
    });

    it('should enter error state when WebSocket URL building fails', () => {
      config.url = 'invalid-url';
      service.connect(config);

      expect(service.getState()).toBe('error');
    });
  });
});
