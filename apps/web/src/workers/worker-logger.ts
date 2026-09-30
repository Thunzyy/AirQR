import type { LogContext } from "../parse/wire";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface WorkerLogMessage {
  type: "LOG";
  level: LogLevel;
  module: string;
  message: string;
  context?: LogContext;
}

export interface WorkerLogger {
  debug: (message: string, context?: LogContext) => void;
  info: (message: string, context?: LogContext) => void;
  warn: (message: string, context?: LogContext) => void;
  error: (message: string, context?: LogContext) => void;
}

export function createWorkerLogger(module: string): WorkerLogger {
  if (!module || module.trim().length === 0) {
    throw new Error("Module name cannot be empty");
  }

  const log = (level: LogLevel, message: string, context?: LogContext): void => {
    const msg: WorkerLogMessage = {
      type: "LOG",
      level,
      module,
      message,
      context,
    };
    self.postMessage(msg);
  };

  return {
    debug: (message: string, context?: LogContext) => log("debug", message, context),
    info: (message: string, context?: LogContext) => log("info", message, context),
    warn: (message: string, context?: LogContext) => log("warn", message, context),
    error: (message: string, context?: LogContext) => log("error", message, context),
  };
}
