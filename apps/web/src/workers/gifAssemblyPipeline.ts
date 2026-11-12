interface CreateContiguousBatchFlusherOptions<TBatch> {
  initialStart: number;
  getBatchLength: (batch: TBatch) => number;
  onFlushBatch: (start: number, batch: TBatch) => void;
}

export interface ContiguousBatchFlusher<TBatch> {
  add: (start: number, batch: TBatch) => void;
  getNextStart: () => number;
}

export function createContiguousBatchFlusher<TBatch>({
  initialStart,
  getBatchLength,
  onFlushBatch,
}: CreateContiguousBatchFlusherOptions<TBatch>): ContiguousBatchFlusher<TBatch> {
  let nextStart = Math.max(0, initialStart);
  const pendingBatches = new Map<number, TBatch>();

  const flushPending = () => {
    while (pendingBatches.has(nextStart)) {
      const batch = pendingBatches.get(nextStart)!;
      pendingBatches.delete(nextStart);
      onFlushBatch(nextStart, batch);
      nextStart += Math.max(0, getBatchLength(batch));
    }
  };

  return {
    add(start, batch) {
      pendingBatches.set(start, batch);
      flushPending();
    },
    getNextStart() {
      return nextStart;
    },
  };
}
