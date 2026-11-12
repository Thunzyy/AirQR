import type { WireValue } from "../parse/wire";

export const SERVER_FETCH_TIMEOUT_MS = 10_000;

export class ServerRequestTimeoutError extends Error {
  constructor(message = 'Server request timed out') {
    super(message);
    this.name = 'ServerRequestTimeoutError';
  }
}

export function isServerRequestTimeoutError(
  error: WireValue
): error is ServerRequestTimeoutError {
  return (
    error instanceof ServerRequestTimeoutError ||
    (error instanceof Error && error.name === 'ServerRequestTimeoutError')
  );
}

export async function fetchServerWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = SERVER_FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const upstreamSignal = init.signal;

  const handleAbort = () => {
    controller.abort(upstreamSignal?.reason);
  };

  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      controller.abort(upstreamSignal.reason);
    } else {
      upstreamSignal.addEventListener('abort', handleAbort, { once: true });
    }
  }

  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (timedOut) {
      throw new ServerRequestTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    upstreamSignal?.removeEventListener?.('abort', handleAbort);
  }
}
