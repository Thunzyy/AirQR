// Real GIF decoding/allocation benchmark; excludes browser paint and camera hardware.
// node --expose-gc scripts/benchmark-qr-performance.mjs input.gif output-directory
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { build } from 'esbuild';
import { GifReader, GifWriter } from 'omggif';

if (!process.argv[2] || !process.argv[3]) throw new Error('Expected input GIF and output directory');
const output = resolve(process.argv[3]);
await mkdir(output, { recursive: true });
globalThis.ImageData = class {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }
};
const compiled = await build({
  stdin: { contents: "export * from './src/components/media/gifFrameSource'; export * from './src/utils/previewCache';", resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { GifFrameSource, PreviewCache } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

const original = new GifReader(new Uint8Array(await readFile(process.argv[2])));
const { width, height } = original;
const indexed = [];
for (let i = 0; i < original.numFrames(); i++) {
  const rgba = new Uint8Array(width * height * 4);
  original.decodeAndBlitFrameRGBA(i, rgba);
  indexed.push(Uint8Array.from({ length: width * height }, (_, p) => rgba[p * 4] < 128 ? 1 : 0));
}
const frameCount = 3000;
const buffer = new Uint8Array(frameCount * width * height + 4096);
const writer = new GifWriter(buffer, width, height, { palette: [0xffffff, 0], loop: 0 });
for (let i = 0; i < frameCount; i++) writer.addFrame(0, 0, width, height, indexed[i % indexed.length], { delay: 10 });
const bytes = buffer.slice(0, writer.end());
await writeFile(join(output, 'large-qr.gif'), bytes);

const before = [];
const firstOpen = [];
const secondOpen = [];
let decodedBytes = 0;
let preparations = 0;
for (let sample = 0; sample < 3; sample++) {
  globalThis.gc?.();
  let started = performance.now();
  const reader = new GifReader(bytes);
  const frames = [];
  for (let i = 0; i < reader.numFrames(); i++) {
    const image = new ImageData(width, height);
    reader.decodeAndBlitFrameRGBA(i, image.data);
    frames.push(image);
  }
  before.push(performance.now() - started);
  decodedBytes = frames.reduce((sum, frame) => sum + frame.data.byteLength, 0);
  frames.length = 0;
  globalThis.gc?.();
  const cache = new PreviewCache((value) => value.bytes.byteLength, () => {});
  const load = async () => { preparations++; return new GifFrameSource(bytes); };
  started = performance.now();
  const cold = await cache.acquire('same-history-entry', load);
  cold.value.getFrame(0);
  firstOpen.push(performance.now() - started);
  cold.release();
  started = performance.now();
  const warm = await cache.acquire('same-history-entry', load);
  warm.value.getFrame(0);
  secondOpen.push(performance.now() - started);
  warm.release();
  cache.clear();
}

const conversionBefore = [];
const transferAfter = [];
for (let sample = 0; sample < 20; sample++) {
  const rgba = new Uint8ClampedArray(1920 * 1080 * 4).fill(127);
  let started = performance.now();
  const grayscale = new Uint8Array(1920 * 1080);
  for (let i = 0; i < grayscale.length; i++) grayscale[i] = (77 * rgba[i*4] + 150 * rgba[i*4+1] + 29 * rgba[i*4+2]) >> 8;
  const expanded = new Uint8ClampedArray(rgba.length);
  for (let i = 0; i < grayscale.length; i++) {
    expanded[i*4] = expanded[i*4+1] = expanded[i*4+2] = grayscale[i];
    expanded[i*4+3] = 255;
  }
  conversionBefore.push(performance.now() - started);
  started = performance.now();
  structuredClone(rgba.buffer, { transfer: [rgba.buffer] });
  transferAfter.push(performance.now() - started);
}
const median = (values) => [...values].sort((a, b) => a-b)[Math.floor(values.length / 2)];
const report = {
  environment: { node: process.version, platform: process.platform, scope: 'real GIF codec, synthetic QR fixture, no browser paint/camera hardware' },
  fixture: { width, height, frameCount, gifBytes: bytes.length },
  preview: { beforeMs: before, firstOpenMs: firstOpen, secondOpenMs: secondOpen,
    medianBeforeMs: median(before), medianFirstOpenMs: median(firstOpen), medianSecondOpenMs: median(secondOpen),
    beforeDecodedBytes: decodedBytes, firstFrameDecodedBytes: width * height * 4, preparations },
  scannerPreparation1080p: { medianConversionsMs: median(conversionBefore), medianTransferMs: median(transferAfter),
    removedAllocatedBytesPerFrame: 1920 * 1080 * 5, excludes: 'capture, worker scheduling and ZXing decoding' },
};
await writeFile(join(output, 'measurements.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
