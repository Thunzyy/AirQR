export interface GifDecodeMetrics {
  processedFrames: number;
  qrDetected: number;
  wallTimeMs: number;
  workerDecodeTimeMs: number;
  framesPerSecond: number;
  averageFrameDecodeMs: number;
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

export function buildGifDecodeMetrics(input: {
  processedFrames: number;
  qrDetected: number;
  wallTimeMs: number;
  workerDecodeTimeMs: number;
}): GifDecodeMetrics {
  const processedFrames = Math.max(0, Math.round(input.processedFrames));
  const qrDetected = Math.max(0, Math.round(input.qrDetected));
  const wallTimeMs = Math.max(0, input.wallTimeMs);
  const workerDecodeTimeMs = Math.max(0, input.workerDecodeTimeMs);

  const framesPerSecond =
    processedFrames > 0 && wallTimeMs > 0
      ? roundMetric(processedFrames / (wallTimeMs / 1000))
      : 0;
  const averageFrameDecodeMs =
    processedFrames > 0
      ? roundMetric(workerDecodeTimeMs / processedFrames)
      : 0;

  return {
    processedFrames,
    qrDetected,
    wallTimeMs,
    workerDecodeTimeMs,
    framesPerSecond,
    averageFrameDecodeMs,
  };
}
