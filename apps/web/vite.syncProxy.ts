import type { ProxyOptions } from "vite";

import {
  asWireString,
  errorMessage,
  isWireString,
  type WireValue,
} from "./src/parse/wire";

const DEFAULT_SYNC_SERVER_TARGET = "http://127.0.0.1:8081";

type ProxyHeaderValue = string | string[] | undefined;

type WebSocketProxyRequestLike = {
  setHeader: (name: string, value: string | string[]) => void;
};

type HttpProxyRequestLike = {
  setHeader: (name: string, value: string | string[]) => void;
};

type HttpProxyIncomingRequestLike = {
  headers: Record<string, ProxyHeaderValue>;
};

type WebSocketUpgradeRequestLike = {
  headers: Record<string, ProxyHeaderValue>;
  url?: string;
};

type ProxyLoggerLike = Pick<Console, "info" | "warn">;
type ProxyConfigureCallback = NonNullable<ProxyOptions["configure"]>;
type ViteProxyServer = Parameters<ProxyConfigureCallback>[0];
type ViteProxyOptions = Parameters<ProxyConfigureCallback>[1];
type SyncProxyConfigureOptions = {
  rewriteWsOrigin?: boolean;
  logger?: ProxyLoggerLike;
};
type SyncProxyLoggerOrOptions =
  | ViteProxyOptions
  | ProxyLoggerLike
  | SyncProxyConfigureOptions;

const WS_AUTH_HEADER_FORWARD_MAP = [
  ["cookie", "Cookie"],
  ["authorization", "Authorization"],
  ["x-api-key", "X-API-Key"],
] as const;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function deriveWebSocketProxyTarget(target: string): string {
  const normalizedTarget = trimTrailingSlash(target.trim());
  try {
    const url = new URL(normalizedTarget);
    if (url.protocol === "https:") {
      url.protocol = "wss:";
    } else if (url.protocol === "http:") {
      url.protocol = "ws:";
    }
    return trimTrailingSlash(url.toString());
  } catch {
    return normalizedTarget
      .replace(/^https:/i, "wss:")
      .replace(/^http:/i, "ws:");
  }
}

const DEFAULT_SYNC_EVENTS_WS_TARGET = deriveWebSocketProxyTarget(
  DEFAULT_SYNC_SERVER_TARGET,
);

export type WebSocketProxyLogContext = {
  channel: "scan" | "events" | "unknown";
  connectionId?: string;
  deviceId?: string;
  host?: string;
  origin?: string;
  path: string;
  sessionId?: string;
  url: string;
};

function firstHeaderValue(value: ProxyHeaderValue): string | undefined {
  if (Array.isArray(value)) {
    return value.find((entry) => isWireString(entry) && entry.length > 0);
  }
  return isWireString(value) && value.length > 0 ? value : undefined;
}

function classifyWebSocketProxyChannel(pathname: string): "scan" | "events" | "unknown" {
  if (/\/api\/(?:v1\/)?ws\/scan\//i.test(pathname)) {
    return "scan";
  }
  if (/\/api\/(?:v1\/)?ws(?:\/events)?$/i.test(pathname) || /\/api\/v1\/ws\/events$/i.test(pathname)) {
    return "events";
  }
  return "unknown";
}

function extractWebSocketProxySessionId(pathname: string): string | undefined {
  const match = pathname.match(/\/api\/(?:v1\/)?ws\/scan\/([^/?#]+)/i);
  return match?.[1];
}

type ProxyErrorInfo = {
  code?: string;
  message: string;
  name?: string;
};

function formatProxyError(error: WireValue): ProxyErrorInfo {
  if (error instanceof Error) {
    const info: ProxyErrorInfo = {
      message: error.message,
      name: error.name,
    };
    if ("code" in error) {
      // SAFETY: Node-style errors may carry an optional string `code` field.
      const code = asWireString(error.code as WireValue);
      if (code !== undefined) {
        info.code = code;
      }
    }
    return info;
  }
  return {
    message: errorMessage(error),
  };
}

export function extractWebSocketProxyLogContext(
  req: WebSocketUpgradeRequestLike,
): WebSocketProxyLogContext {
  const rawUrl = req.url || "";
  const parsed = new URL(rawUrl || "/", "http://vite.local");
  return {
    channel: classifyWebSocketProxyChannel(parsed.pathname),
    connectionId: parsed.searchParams.get("connectionId") || undefined,
    deviceId: parsed.searchParams.get("deviceId") || undefined,
    host: firstHeaderValue(req.headers.host),
    origin: firstHeaderValue(req.headers.origin),
    path: parsed.pathname,
    sessionId: extractWebSocketProxySessionId(parsed.pathname),
    url: rawUrl,
  };
}

type ProxyEventExtra = {
  error?: ProxyErrorInfo;
  target?: string;
};

function logWebSocketProxyEvent(
  level: "info" | "warn",
  message: string,
  context: WebSocketProxyLogContext,
  extra: ProxyEventExtra = {},
  logger: ProxyLoggerLike = console,
): void {
  logger[level](`[airqr][vite-ws-proxy] ${message}`, {
    ...context,
    ...extra,
  });
}

function isProxyLoggerLike(value: ProxyLoggerLike | ViteProxyOptions): value is ProxyLoggerLike {
  if (!("info" in value) || !("warn" in value)) {
    return false;
  }
  return value.info instanceof Function && value.warn instanceof Function;
}

function resolveProxyLogger(value: SyncProxyLoggerOrOptions): ProxyLoggerLike {
  if (isProxyLoggerLike(value)) {
    return value;
  }
  if ("logger" in value) {
    const nestedLogger = value.logger;
    if (nestedLogger != null && isProxyLoggerLike(nestedLogger)) {
      return nestedLogger;
    }
  }
  return console;
}

export type SyncProxyTargets = {
  syncServerTarget: string;
  syncServerWsTarget: string;
};

export function resolveSyncProxyTargets(
  env: Record<string, string | undefined>,
): SyncProxyTargets {
  const syncServerTarget = trimTrailingSlash(
    (env.VITE_SYNC_SERVER_URL || DEFAULT_SYNC_SERVER_TARGET).trim(),
  );
  const explicitWsTarget =
    env.VITE_SYNC_EVENTS_WS_TARGET || env.VITE_SYNC_WS_URL;
  const syncServerWsTarget = trimTrailingSlash(
    (
      explicitWsTarget ||
      (env.VITE_SYNC_SERVER_URL
        ? deriveWebSocketProxyTarget(syncServerTarget)
        : DEFAULT_SYNC_EVENTS_WS_TARGET)
    ).trim(),
  );

  return {
    syncServerTarget,
    syncServerWsTarget,
  };
}

export function forwardWebSocketAuthHeaders(
  proxyReq: WebSocketProxyRequestLike,
  req: WebSocketUpgradeRequestLike,
): void {
  for (const [sourceName, targetName] of WS_AUTH_HEADER_FORWARD_MAP) {
    const value = req.headers[sourceName];
    if (value === undefined) {
      continue;
    }
    proxyReq.setHeader(targetName, value);
  }
}

export function forwardHttpProxyHeaders(
  proxyReq: HttpProxyRequestLike,
  req: HttpProxyIncomingRequestLike,
): void {
  const host = req.headers.host;
  if (host !== undefined) {
    proxyReq.setHeader("X-Forwarded-Host", host);
  }
}

export function configureSyncWebSocketProxy(
  proxy: ViteProxyServer,
  loggerOrOptions: SyncProxyLoggerOrOptions = console,
): void {
  const logger = resolveProxyLogger(loggerOrOptions);
  proxy.on("proxyReqWs", (proxyReq, req) => {
    forwardWebSocketAuthHeaders(proxyReq, req);
    logWebSocketProxyEvent(
      "info",
      "upgrade",
      extractWebSocketProxyLogContext(req),
      {},
      logger,
    );
  });
  proxy.on("error", (error, req, _socket, target) => {
    if (!req) {
      return;
    }
    logWebSocketProxyEvent(
      "warn",
      "error",
      extractWebSocketProxyLogContext(req),
      {
        error: formatProxyError(error),
        target: target instanceof URL ? undefined : asWireString(target),
      },
      logger,
    );
  });
  proxy.on("econnreset", (error, req, _socket, target) => {
    if (!req) {
      return;
    }
    logWebSocketProxyEvent(
      "warn",
      "econnreset",
      extractWebSocketProxyLogContext(req),
      {
        error: formatProxyError(error),
        target: target instanceof URL ? undefined : asWireString(target),
      },
      logger,
    );
  });
}

export function configureSyncHttpProxy(proxy: ViteProxyServer): void {
  proxy.on("proxyReq", (proxyReq, req) => {
    forwardHttpProxyHeaders(proxyReq, req);
  });
}
