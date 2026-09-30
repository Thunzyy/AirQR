// apps/web/src/services/websocketSyncService.ts

import {
  asWireFiniteNumber,
  asWireObject,
  asWireString,
  globalHas,
  isWireBoolean,
  parseJsonText,
  type WireObject,
} from '../parse/wire';
import type { ScanUploadConfig } from '../types';
import { createLogger } from '../utils/logger';
import { getDeviceInfo, type DeviceInfo } from '../utils/deviceId';
import { buildServerWebSocketUrl, resolveServerBaseUrl } from './syncUrl';

const logger = createLogger('services:websocketSync');

// Event types broadcasted by the server
export type WebSocketEventType =
  | 'history'
  | 'scan-progress'
  | 'scan-session-state'
  | 'scan-complete'
  | 'delete';

export interface WebSocketEvent {
  type: WebSocketEventType;
  payload: WireObject;
}

export type EventHandler = (event: WebSocketEvent) => void;

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

// WebSocket protocol messages
interface HelloMessage {
  type: 'hello';
  protocol: string;
  version: number;
  deviceId: string;
  deviceName: string;
  // Auth fields at root level (server expects them here, not nested)
  apiKey?: string;
  username?: string;
  password?: string;
}

interface WelcomeMessage {
  type: 'welcome';
  clientId: string;
  serverVersion?: number;
}

interface PingMessage {
  type: 'ping';
}

interface ServerEventMessage {
  type: WebSocketEventType;
  payload: WireObject;
}

const WS_PROTOCOL = 'airqr-events';
const WS_VERSION = 1;
const MAX_WS_RECONNECT_ATTEMPTS = 5;
const RECONNECT_BASE_DELAY = 1000; // 1 second
const RECONNECT_MAX_DELAY = 30000; // 30 seconds
const PING_INTERVAL = 30000; // 30 seconds
const PONG_TIMEOUT = 10000; // 10 seconds

export class WebSocketSyncService {
  private ws: WebSocket | null = null;
  private config: ScanUploadConfig | null = null;
  private state: ConnectionState = 'disconnected';
  private deviceInfo: DeviceInfo;
  private clientId: string | null = null;
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private pongTimeout: ReturnType<typeof setTimeout> | null = null;
  private eventHandlers: Set<EventHandler> = new Set();
  private isConnecting = false;
  private browserOffline =
    globalHas('navigator') && isWireBoolean(navigator.onLine)
      ? navigator.onLine === false
      : false;
  private browserLifecycleRegistered = false;
  private readonly handleOnline = () => {
    this.browserOffline = false;
    this.resumeFromBrowserLifecycle();
  };
  private readonly handleOffline = () => {
    this.browserOffline = true;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close();
    }
  };
  private readonly handlePageShow = () => {
    this.resumeFromBrowserLifecycle();
  };
  private readonly handleVisibilityChange = () => {
    if (globalHas('document') && document.visibilityState !== 'visible') {
      return;
    }
    this.resumeFromBrowserLifecycle();
  };

  constructor() {
    this.deviceInfo = getDeviceInfo();
    logger.info('WebSocketSyncService initialized', {
      deviceId: this.deviceInfo.deviceId,
      deviceName: this.deviceInfo.deviceName,
    });
  }

  /**
   * Connect to the WebSocket server
   */
  connect(config: ScanUploadConfig): void {
    if (!config.enabled || !config.url) {
      logger.warn('Sync not enabled or URL missing, skipping connection');
      return;
    }

    this.registerBrowserLifecycleListeners();

    // Prevent concurrent connect() calls.
    if (this.isConnecting) {
      logger.debug('Connection already in progress, ignoring concurrent connect() call');
      return;
    }

    // If already connected with same config, skip reconnection
    if (this.state === 'connected' && this.config?.url === config.url) {
      logger.debug('Already connected to same server, skipping reconnection');
      return;
    }

    // If already connecting with same config, skip
    if (this.state === 'connecting' && this.config?.url === config.url) {
      logger.debug('Already connecting to same server, skipping');
      return;
    }

    this.config = config;

    // If already connected to a different server, disconnect first
    if (this.state === 'connected' || this.state === 'connecting') {
      logger.info('Connected to different server, disconnecting first');
      this.disconnect();
    }

    this.isConnecting = true;
    this.attemptWebSocketConnection();
  }

  /**
   * Attempt WebSocket connection with retry logic
   */
  private attemptWebSocketConnection(): void {
    if (!this.config) return;
    if (this.browserOffline) {
      logger.info('Skipping WebSocket connection attempt while browser is offline');
      this.isConnecting = false;
      this.setState('disconnected');
      return;
    }

    const baseUrl = resolveServerBaseUrl(this.config.url);
    if (!baseUrl) {
      logger.error('Failed to resolve server base URL');
      this.setState('error');
      return;
    }

    const wsUrl = this.buildWebSocketUrl(baseUrl);
    if (!wsUrl) {
      logger.error('Failed to build WebSocket URL');
      this.isConnecting = false;
      this.setState('error');
      return;
    }

    logger.info(`Connecting to WebSocket (attempt ${this.reconnectAttempts + 1}/${MAX_WS_RECONNECT_ATTEMPTS})`, { wsUrl });
    this.setState('connecting');

    try {
      // Note: Don't pass WS_PROTOCOL as subprotocol - the server expects it in the hello message, not as WebSocket subprotocol negotiation
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.onopen = () => {
        if (this.ws !== ws) return;
        logger.info('WebSocket connection opened');
        this.reconnectAttempts = 0;
        this.sendHello();
      };

      ws.onmessage = (event) => {
        if (this.ws !== ws) return;
        this.handleWebSocketMessage(event.data);
      };

      ws.onerror = (error) => {
        if (this.ws !== ws) return;
        logger.error('WebSocket error', { error: error instanceof Error ? error.message : String(error) });
        this.setState('error');
      };

      ws.onclose = (event) => {
        if (this.ws !== ws) return;
        logger.warn('WebSocket connection closed', { code: event.code, reason: event.reason });
        this.handleWebSocketClose();
      };
    } catch (error) {
      logger.error('Failed to create WebSocket', { error: error instanceof Error ? error.message : String(error) });
      this.handleWebSocketClose();
    }
  }

  /**
   * Build the public WebSocket URL from the configured server base URL.
   *
   * The client should only know one public origin. Same-origin URLs route
   * through the page origin; explicit mixed-content external URLs are rejected
   * by the URL helper.
   */
  private buildWebSocketUrl(baseUrl: string): string | null {
    const wsUrl = buildServerWebSocketUrl(baseUrl, '/api/v1/ws/events');
    if (!wsUrl) {
      logger.error('Failed to parse base URL', { baseUrl });
    }
    return wsUrl;
  }

  /**
   * Send hello handshake message
   */
  private sendHello(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.config) return;

    const hello: HelloMessage = {
      type: 'hello',
      protocol: WS_PROTOCOL,
      version: WS_VERSION,
      deviceId: this.deviceInfo.deviceId,
      deviceName: this.deviceInfo.deviceName,
    };

    // Add auth at root level (server expects apiKey/username/password at root, not nested)
    if (this.config.apiKey) {
      hello.apiKey = this.config.apiKey;
    }
    if (this.config.username) {
      hello.username = this.config.username;
    }
    if (this.config.password) {
      hello.password = this.config.password;
    }

    // Redact password before logging
    const helloToLog = {
      ...hello,
      password: hello.password ? '***' : undefined,
    };

    logger.debug('Sending hello message', { hello: helloToLog });

    try {
      this.ws.send(JSON.stringify(hello));
    } catch (error) {
      logger.error('Failed to send hello message', { error: error instanceof Error ? error.message : String(error) });
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleWebSocketMessage(data: string): void {
    try {
      const parsed = asWireObject(parseJsonText(data));
      const type = asWireString(parsed.type);
      if (type === 'welcome') {
        this.handleWelcome({
          type: 'welcome',
          clientId: asWireString(parsed.clientId) ?? '',
          serverVersion: asWireFiniteNumber(parsed.serverVersion),
        });
        return;
      }
      if (type === 'pong') {
        this.handlePong();
        return;
      }
      if (
        type === 'history' ||
        type === 'scan-progress' ||
        type === 'scan-session-state' ||
        type === 'scan-complete' ||
        type === 'delete'
      ) {
        this.handleServerEvent({
          type,
          payload: asWireObject(parsed.payload),
        });
        return;
      }
      logger.warn('Unknown message type', { type });
    } catch (error) {
      logger.error('Failed to parse WebSocket message', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Handle welcome message from server
   */
  private handleWelcome(message: WelcomeMessage): void {
    logger.info('Realtime transport connected', {
      clientId: message.clientId,
      transport: 'websocket',
    });
    this.clientId = message.clientId;
    this.isConnecting = false;
    this.setState('connected');
    this.startPingInterval();
    this.broadcastEvent({
      type: 'history',
      payload: {
        kind: 'connection-ready',
        clientId: message.clientId,
      },
    });
  }

  /**
   * Handle pong response
   */
  private handlePong(): void {
    logger.debug('Received pong');
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  /**
   * Handle server event (history, scan-progress, etc.)
   */
  private handleServerEvent(message: ServerEventMessage): void {
    logger.info('Received server event', {
      type: message.type,
      payloadKeys: Object.keys(message.payload).join(','),
    });

    this.broadcastEvent({
      type: message.type,
      payload: message.payload,
    });
  }

  /**
   * Handle WebSocket close event
   */
  private handleWebSocketClose(): void {
    this.stopPingInterval();
    this.ws = null;
    this.clientId = null;
    this.isConnecting = false;

    if (this.browserOffline) {
      this.setState('disconnected');
      return;
    }

    if (this.reconnectAttempts < MAX_WS_RECONNECT_ATTEMPTS - 1) {
      this.scheduleReconnect();
    } else {
      logger.warn('Max WebSocket reconnect attempts reached');
      this.setState('error');
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      RECONNECT_BASE_DELAY * Math.pow(2, this.reconnectAttempts - 1),
      RECONNECT_MAX_DELAY
    );

    logger.info(`Scheduling reconnect in ${delay}ms`, { attempt: this.reconnectAttempts });
    this.setState('disconnected');

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.attemptWebSocketConnection();
    }, delay);
  }

  private resumeFromBrowserLifecycle(): void {
    if (this.browserOffline || !this.config?.enabled || !this.config.url) {
      return;
    }
    if (this.state === 'connected' || this.isConnecting) {
      return;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.attemptWebSocketConnection();
  }

  /**
   * Start ping interval to keep connection alive
   */
  private startPingInterval(): void {
    this.stopPingInterval();

    this.pingInterval = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.stopPingInterval();
        return;
      }

      logger.debug('Sending ping');
      const ping: PingMessage = { type: 'ping' };

      try {
        this.ws.send(JSON.stringify(ping));
      } catch (error) {
        logger.error('Failed to send ping', { error: error instanceof Error ? error.message : String(error) });
        return;
      }

      // Set timeout for pong response
      this.pongTimeout = setTimeout(() => {
        logger.warn('Pong timeout, closing connection');
        this.ws?.close();
      }, PONG_TIMEOUT);
    }, PING_INTERVAL);
  }

  /**
   * Stop ping interval
   */
  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
    if (this.pongTimeout) {
      clearTimeout(this.pongTimeout);
      this.pongTimeout = null;
    }
  }

  /**
   * Subscribe to server events
   */
  subscribe(handler: EventHandler): () => void {
    this.eventHandlers.add(handler);
    logger.debug('Event handler subscribed', { totalHandlers: this.eventHandlers.size });

    // Return unsubscribe function
    return () => {
      this.eventHandlers.delete(handler);
      logger.debug('Event handler unsubscribed', { totalHandlers: this.eventHandlers.size });
    };
  }

  private broadcastEvent(event: WebSocketEvent): void {
    this.eventHandlers.forEach((handler) => {
      try {
        handler(event);
      } catch (error) {
        logger.error('Event handler error', {
          error: error instanceof Error ? error.message : String(error),
          type: event.type,
        });
      }
    });
  }

  /**
   * Disconnect and cleanup
   */
  disconnect(): void {
    logger.info('Disconnecting');

    if (this.clientId) {
      logger.debug('Clearing WebSocket client', { clientId: this.clientId });
    }

    // Clear reconnect timeout
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    // Stop ping interval
    this.stopPingInterval();

    // Close WebSocket
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null; // Prevent reconnect
      this.ws.close();
      this.ws = null;
    }

    // Reset state
    this.clientId = null;
    this.reconnectAttempts = 0;
    this.isConnecting = false;
    this.setState('disconnected');
    this.unregisterBrowserLifecycleListeners();
  }

  /**
   * Get connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Get device info
   */
  getDeviceInfo(): DeviceInfo {
    return { ...this.deviceInfo };
  }

  /**
   * Update internal state and log
   */
  private setState(newState: ConnectionState): void {
    if (this.state === newState) return;

    logger.info(`State changed: ${this.state} -> ${newState}`);
    this.state = newState;
  }

  private registerBrowserLifecycleListeners(): void {
    if (this.browserLifecycleRegistered) {
      return;
    }

    if (globalHas('window')) {
      window.addEventListener('online', this.handleOnline);
      window.addEventListener('offline', this.handleOffline);
      window.addEventListener('pageshow', this.handlePageShow);
    }
    if (globalHas('document')) {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }

    this.browserLifecycleRegistered = true;
  }

  private unregisterBrowserLifecycleListeners(): void {
    if (!this.browserLifecycleRegistered) {
      return;
    }

    if (globalHas('window')) {
      window.removeEventListener('online', this.handleOnline);
      window.removeEventListener('offline', this.handleOffline);
      window.removeEventListener('pageshow', this.handlePageShow);
    }
    if (globalHas('document')) {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }

    this.browserLifecycleRegistered = false;
  }
}

// Singleton instance
let instance: WebSocketSyncService | null = null;

/**
 * Get the singleton WebSocket sync service instance
 */
export function getWebSocketSyncService(): WebSocketSyncService {
  if (!instance) {
    instance = new WebSocketSyncService();
  }
  return instance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetWebSocketSyncService(): void {
  if (instance) {
    instance.disconnect();
    instance = null;
  }
}

export function setWebSocketSyncServiceForTests(
  service: WebSocketSyncService | null
): void {
  instance = service;
}
