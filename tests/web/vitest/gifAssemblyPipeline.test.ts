import { describe, expect, it } from "vitest";

import { createContiguousBatchFlusher } from "@web/workers/gifAssemblyPipeline";

describe("gif assembly pipeline", () => {
  it("flushes out-of-order batches once the contiguous prefix is available", () => {
    const flushed: string[] = [];
    const flusher = createContiguousBatchFlusher<{
      label: string;
      length: number;
    }>({
      initialStart: 1,
      getBatchLength: (batch) => batch.length,
      onFlushBatch: (start, batch) => {
        flushed.push(`${start}:${batch.label}`);
      },
    });

    flusher.add(5, { label: "chunk-c", length: 2 });
    expect(flushed).toEqual([]);
    expect(flusher.getNextStart()).toBe(1);

    flusher.add(1, { label: "chunk-a", length: 2 });
    expect(flushed).toEqual(["1:chunk-a"]);
    expect(flusher.getNextStart()).toBe(3);

    flusher.add(3, { label: "chunk-b", length: 2 });
    expect(flushed).toEqual(["1:chunk-a", "3:chunk-b", "5:chunk-c"]);
    expect(flusher.getNextStart()).toBe(7);
  });
});
