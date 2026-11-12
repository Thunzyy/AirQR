type Entry<T> = { value: T; bytes: number; users: number; retained: boolean };
type PendingEntry<T> = { promise: Promise<Entry<T>>; users: number };

/** Bounded LRU with shared in-flight loads and leases for displayed previews. */
export class PreviewCache<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly pending = new Map<string, PendingEntry<T>>();
  private generation = 0;
  private readonly sizeOf: (value: T) => number;
  private readonly dispose: (value: T) => void;
  private readonly maxBytes: number;
  private readonly maxEntries: number;

  constructor(
    sizeOf: (value: T) => number,
    dispose: (value: T) => void,
    maxBytes = 64 * 1024 * 1024,
    maxEntries = 3,
  ) {
    this.sizeOf = sizeOf;
    this.dispose = dispose;
    this.maxBytes = maxBytes;
    this.maxEntries = maxEntries;
  }

  async acquire(key: string, load: () => Promise<T>): Promise<{ value: T; release: () => void }> {
    const generation = this.generation;
    let entry = this.entries.get(key);
    if (entry) {
      entry.users++;
      this.entries.delete(key);
      this.entries.set(key, entry);
    } else {
      let job = this.pending.get(key);
      if (!job) {
        const promise: Promise<Entry<T>> = Promise.resolve().then(load).then((value) => {
          const created: Entry<T> = { value, bytes: this.sizeOf(value), users: createdJob.users, retained: false };
          if (generation !== this.generation || this.pending.get(key) !== createdJob) {
            this.dispose(value);
            throw new DOMException('Preview invalidated', 'AbortError');
          }
          this.pending.delete(key);
          if (created.bytes <= this.maxBytes) {
            created.retained = true;
            this.entries.set(key, created);
            this.trim();
          }
          return created;
        }).finally(() => {
          if (this.pending.get(key) === createdJob) this.pending.delete(key);
        });
        const createdJob: PendingEntry<T> = { promise, users: 0 };
        job = createdJob;
        this.pending.set(key, job);
      }
      job.users++;
      entry = await job.promise;
    }
    let released = false;
    return {
      value: entry.value,
      release: () => {
        if (released) return;
        released = true;
        entry.users--;
        if (!entry.retained && entry.users === 0) this.dispose(entry.value);
      },
    };
  }

  invalidate(key: string): void {
    this.pending.delete(key);
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    entry.retained = false;
    if (entry.users === 0) this.dispose(entry.value);
  }

  clear(): void {
    this.generation++;
    this.pending.clear();
    for (const key of this.entries.keys()) this.invalidate(key);
  }

  retainKeys(keys: Set<string>): void {
    for (const key of new Set([...this.entries.keys(), ...this.pending.keys()])) {
      if (!keys.has(key)) this.invalidate(key);
    }
  }

  private trim(): void {
    let bytes = [...this.entries.values()].reduce((sum, entry) => sum + entry.bytes, 0);
    while (bytes > this.maxBytes || this.entries.size > this.maxEntries) {
      const key = this.entries.keys().next().value!;
      bytes -= this.entries.get(key)!.bytes;
      this.invalidate(key);
    }
  }
}
