import {
  asWireObject,
  asWireString,
  globalHas,
  isWireArray,
  isWireString,
  parseJsonText,
  type LogContext,
  type WireValue,
} from "../parse/wire";

export type { LogContext } from "../parse/wire";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LoggerConfig {
  level: LogLevel;
  enabledModules: string[] | "*";
}

const LOG_LEVEL_PRIORITY = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
} as const;

function envLogLevel(): LogLevel {
  const level = import.meta.env.VITE_LOG_LEVEL;
  return isWireString(level) && isValidLogLevel(level) ? level : "info";
}

function asEnabledModules(value: WireValue | undefined): string[] | "*" {
  if (value === "*") {
    return "*";
  }
  if (!isWireArray(value)) {
    return "*";
  }
  const modules: string[] = [];
  for (const entry of value) {
    if (!isWireString(entry)) {
      return "*";
    }
    modules.push(entry);
  }
  return modules;
}

let config: LoggerConfig = {
  level: envLogLevel(),
  enabledModules: "*",
};

const STORAGE_KEY = "airqr_logger_config";

function isValidLogLevel(level: string): level is LogLevel {
  return level === "debug" || level === "info" || level === "warn" || level === "error";
}

function loadConfig(): void {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = asWireObject(parseJsonText(saved));
      const level = asWireString(parsed.level);
      config = {
        level: level !== undefined && isValidLogLevel(level) ? level : config.level,
        enabledModules: asEnabledModules(parsed.enabledModules),
      };
    }
  } catch {
    // Ignore parse errors, use defaults
  }
}

function saveConfig(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage errors
  }
}

if (globalHas("localStorage")) {
  loadConfig();
}

export function setLogLevel(level: LogLevel): void {
  config.level = level;
  saveConfig();
}

export function setEnabledModules(modules: string[] | "*"): void {
  config.enabledModules = modules;
  saveConfig();
}

export function getLoggerConfig(): LoggerConfig {
  return { ...config };
}

function shouldLog(level: LogLevel, module: string): boolean {
  if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[config.level]) {
    return false;
  }

  if (config.enabledModules === "*") {
    return true;
  }

  return config.enabledModules.some((pattern) => {
    if (pattern.endsWith(":*")) {
      const category = pattern.slice(0, -2);
      return module.startsWith(category + ":");
    }
    return module === pattern;
  });
}

function formatMessage(level: LogLevel, module: string, message: string): string {
  return `[${level.toUpperCase()}][${module}] ${message}`;
}

export interface Logger {
  debug: (message: string, context?: LogContext) => void;
  info: (message: string, context?: LogContext) => void;
  warn: (message: string, context?: LogContext) => void;
  error: (message: string, context?: LogContext) => void;
}

export function createLogger(module: string): Logger {
  if (!module || !module.trim()) {
    throw new Error("Logger module name cannot be empty");
  }

  const log = (level: LogLevel, message: string, context?: LogContext): void => {
    if (!shouldLog(level, module)) {
      return;
    }

    const formatted = formatMessage(level, module, message);
    if (context) {
      switch (level) {
        case "debug":
          console.debug(formatted, context);
          break;
        case "info":
          console.log(formatted, context);
          break;
        case "warn":
          console.warn(formatted, context);
          break;
        case "error":
          console.error(formatted, context);
          break;
      }
      return;
    }

    switch (level) {
      case "debug":
        console.debug(formatted);
        break;
      case "info":
        console.log(formatted);
        break;
      case "warn":
        console.warn(formatted);
        break;
      case "error":
        console.error(formatted);
        break;
    }
  };

  return {
    debug: (message: string, context?: LogContext) => log("debug", message, context),
    info: (message: string, context?: LogContext) => log("info", message, context),
    warn: (message: string, context?: LogContext) => log("warn", message, context),
    error: (message: string, context?: LogContext) => log("error", message, context),
  };
}

export interface WorkerLogMessage {
  type: "LOG";
  level: LogLevel;
  module: string;
  message: string;
  context?: LogContext;
}

export function handleWorkerLog(msg: WorkerLogMessage): void {
  const logger = createLogger(msg.module);
  logger[msg.level](msg.message, msg.context);
}
