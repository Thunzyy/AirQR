import { describe, expect, it, vi } from 'vitest';
import { PreviewCache } from '@web/utils/previewCache';

describe('PreviewCache', () => {
  it('shares preparation and retains a closed preview for the next open', async () => {
    const dispose = vi.fn();
    const cache = new PreviewCache<number>(() => 1, dispose);
    const load = vi.fn(async () => 42);
    const [first, concurrent] = await Promise.all([cache.acquire('a', load), cache.acquire('a', load)]);
    expect(load).toHaveBeenCalledTimes(1);
    first.release();
    concurrent.release();
    const again = await cache.acquire('a', load);
    expect(again.value).toBe(42);
    expect(load).toHaveBeenCalledTimes(1);
    cache.clear();
    expect(dispose).not.toHaveBeenCalled();
    again.release();
    again.release();
    expect(dispose).toHaveBeenCalledExactlyOnceWith(42);
  });

  it('bounds retained bytes without revoking a displayed preview', async () => {
    const dispose = vi.fn();
    const cache = new PreviewCache<number>(() => 8, dispose, 10);
    const active = await cache.acquire('a', async () => 1);
    const next = await cache.acquire('b', async () => 2);
    expect(dispose).not.toHaveBeenCalled();
    active.release();
    expect(dispose).toHaveBeenCalledExactlyOnceWith(1);
    next.release();
    const reload = vi.fn(async () => 3);
    (await cache.acquire('a', reload)).release();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledWith(2);
  });

  it('does not retain oversized entries and retries failures', async () => {
    const dispose = vi.fn();
    const cache = new PreviewCache<number>(() => 20, dispose, 10);
    await expect(cache.acquire('a', async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    const load = vi.fn(async () => 1);
    (await cache.acquire('a', load)).release();
    (await cache.acquire('a', load)).release();
    expect(load).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it('discards an in-flight result after deletion or context change', async () => {
    const dispose = vi.fn();
    const cache = new PreviewCache<number>(() => 1, dispose);
    let complete!: (value: number) => void;
    const source = new Promise<number>((resolve) => { complete = resolve; });
    const loading = cache.acquire('a', () => source);
    cache.clear();
    complete(7);
    await expect(loading).rejects.toMatchObject({ name: 'AbortError' });
    expect(dispose).toHaveBeenCalledExactlyOnceWith(7);
    expect((await cache.acquire('a', async () => 8)).value).toBe(8);
  });

  it('keeps concurrent active acquisitions alive during eviction', async () => {
    const dispose = vi.fn();
    const cache = new PreviewCache<string>(() => 1, dispose, 1, 1);
    const leases = await Promise.all([
      cache.acquire('a', async () => 'a'), cache.acquire('a', async () => 'a'),
      cache.acquire('b', async () => 'b'),
    ]);
    expect(dispose).not.toHaveBeenCalled();
    leases[0].release();
    expect(dispose).not.toHaveBeenCalled();
    leases[1].release();
    expect(dispose).toHaveBeenCalledExactlyOnceWith('a');
    leases[2].release();
    cache.retainKeys(new Set());
    expect(dispose).toHaveBeenCalledWith('b');
  });
});
