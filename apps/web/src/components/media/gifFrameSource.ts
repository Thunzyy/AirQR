import { GifReader } from 'omggif';

const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_SOURCES = 3;

/** QR GIF frames are decoded on demand, never expanded into one giant RGBA array. */
export class GifFrameSource {
  readonly bytes: Uint8Array;
  readonly reader: GifReader;
  readonly frameCount: number;
  readonly delays: number[];
  readonly duration: number;
  private readonly frames = new Map<number, ImageData>();

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    this.reader = new GifReader(bytes);
    this.frameCount = this.reader.numFrames();
    if (this.frameCount < 1) throw new Error('GIF contains no frames');
    this.delays = Array.from({ length: this.frameCount }, (_, i) => this.reader.frameInfo(i).delay * 10);
    this.duration = this.delays.reduce((total, delay) => total + delay, 0);
  }

  get width() { return this.reader.width; }
  get height() { return this.reader.height; }
  get decodedByteLength() { return this.frames.size * this.width * this.height * 4; }

  getFrame(index: number): ImageData {
    const cached = this.frames.get(index);
    if (cached) {
      this.frames.delete(index);
      this.frames.set(index, cached);
      return cached;
    }
    const frame = new ImageData(this.width, this.height);
    this.reader.decodeAndBlitFrameRGBA(index, frame.data);
    const capacity = Math.min(8, Math.floor(MAX_FRAME_BYTES / frame.data.byteLength));
    if (capacity > 0) {
      while (this.frames.size >= capacity) this.frames.delete(this.frames.keys().next().value!);
      this.frames.set(index, frame);
    }
    return frame;
  }
}

const sources = new Map<string, GifFrameSource>();
const pending = new Map<string, Promise<GifFrameSource>>();

export function evictGifSource(url: string): void {
  sources.delete(url);
  pending.delete(url);
}

export function clearGifSourceCache(): void {
  sources.clear();
  pending.clear();
}

export function loadGifSource(url: string): Promise<GifFrameSource> {
  const cached = sources.get(url);
  if (cached) {
    sources.delete(url);
    sources.set(url, cached);
    return Promise.resolve(cached);
  }
  const existing = pending.get(url);
  if (existing) return existing;
  const loading = (async () => {
    const response = await fetch(url);
    if (response.ok === false) throw new Error(`GIF load failed (${response.status})`);
    return new GifFrameSource(new Uint8Array(await response.arrayBuffer()));
  })();
  pending.set(url, loading);
  return loading.then((source) => {
    if (pending.get(url) === loading) {
      pending.delete(url);
      if (source.bytes.byteLength <= MAX_SOURCE_BYTES) {
        sources.set(url, source);
        let size = [...sources.values()].reduce((sum, entry) => sum + entry.bytes.byteLength, 0);
        while (sources.size > MAX_SOURCES || size > MAX_SOURCE_BYTES) {
          const oldest = sources.keys().next().value!;
          size -= sources.get(oldest)!.bytes.byteLength;
          sources.delete(oldest);
        }
      }
    }
    return source;
  }).finally(() => {
    if (pending.get(url) === loading) pending.delete(url);
  });
}
