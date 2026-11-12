# QR generation, scanner and history performance

Issue [#15](https://github.com/Thunzyy/AirQR/issues/15), based on `1674583ee46063b1fd533d6d4818f34061174adf` (PR #14). Measurements below were taken on 2026-11-12 on Windows, Intel Core i9-13900 (24 cores / 32 threads), Node 25.2.1 and Rust 1.92.0. These are PC measurements, not iPhone throughput claims.

## Changes

- Native generation renders QR images and compresses GIF LZW data in parallel Rayon jobs. Intermediate images are bounded to batches of 128 instead of retaining every uncompressed image. GIF serialization preserves packet order. Both GIF and multi-chunk ZIP use the same helper; storing a chunk preview no longer clones its GIF buffer.
- Web playback parses GIF metadata, then decodes only the requested frame. Previously, opening a GIF synchronously decoded all its frames before displaying any. Seeking, pause, FPS controls and chunk selection remain available.
- History reopens reuse prepared sources, including ZIP extraction and Blob URLs on web, and file loading / ZIP extraction / GIF inspection on Flutter. Concurrent requests share preparation; errors remain retryable.
- Web camera images transfer their existing RGBA buffer to the scan worker. This removes an RGBA-to-gray conversion on the UI thread and a gray-to-RGBA allocation in the worker. ZXing already accepts RGBA. Capture, submission and result-handler exceptions release the processing gate so subsequent frames can run.

The QR payload, error correction and packet format are unchanged. Counters still represent real unique packets; repeated or unreadable images do not artificially advance progress.

## Cache ownership and limits

Web prepared previews retain at most three entries / 64 MiB, accounting for input data and extracted GIFs. Leases keep a currently displayed preview alive during eviction. Deletion, metadata/data changes, account/server context changes and unmount invalidate the relevant entries; stale pending requests cannot reopen a closed preview. The prepared cache lasts while History is mounted, not across application restarts or leaving that tab.

The shared web GIF source cache separately retains at most three parsed GIFs / 64 MiB of compressed bytes. Each parsed source caches up to eight decoded frames, capped at 8 MiB. These are separate budgets, not a total process-memory cap. An active preview or oversized source can exceed retained-cache budgets while it is displayed; oversized sources are not retained after use.

Flutter retains up to three prepared sources / 64 MiB of GIF bytes in process memory. Every open checks path, size, modification time and fallback frame metadata. Replacement/deletion prevents reuse. It retains compressed GIF chunks and metadata, not all decoded images. A process restart clears this cache.

## Measurements

| Operation | Before / first open | After / warm reopen | Scope |
| --- | ---: | ---: | --- |
| Native GIF generation | 146 ms | 89 ms | Median of three release runs; 256 KiB deterministic input, 263 frames, about 39% less time |
| Web GIF preparation | 1,316.9 ms eager | 11.95 ms lazy, 0.022 ms warm | Median of three Node codec runs, excluding browser paint |
| Initially decoded web pixel storage | 238,572,000 bytes | 79,524 bytes | 3,000 full frames vs one 141×141 RGBA frame; excludes source bytes and metadata |
| History GIF click to first canvas draw | 102.1 ms | 7.3 ms | Actual Chromium History component, one cold/warm pair |
| History ZIP click to first canvas draw | 99.9 ms | 10.5 ms | Actual Chromium History component, one cold/warm pair |
| Flutter source preparation | 12.235 ms | 0.426 ms | Median of three host widget-runtime samples, includes file stat; excludes native paint |
| 1080p scan preparation | 17.961 ms conversions | 0.081 ms buffer transfer | Median microbenchmark; excludes capture, scheduling and ZXing |

The native fixture uses xorshift32 seed `0x12345678`, filename `benchmark.bin`, packet size 1200, Medium ECC, overhead 1.2, no payload compression and 10 FPS. Before/after GIFs are byte-identical (763,685 bytes), SHA-256 `FC4C11E911CB4420AFF17D35E36AEC59836C1F6833B180474B2B5F94C31C1F34`.

The preview benchmark repeats valid native QR frames into an 8,710,940-byte / 3,000-frame GIF. Its Node ImageData shim allocates real RGBA storage; this measures codec and allocation work rather than rendering. The scan-preparation change avoids 10,368,000 allocated bytes per 1080p frame. It does not imply a measured camera FPS gain.

The browser check used synthetic local IndexedDB history, the real GIF/ZIP viewer, ZIP worker and ZXing worker. Reopening created no new Blob URLs, fetched no new GIF and did not repeat ZIP extraction. It also sought frame 3,000 and paused playback. Passing the rendered QR through the legacy grayscale path and the new RGBA path returned identical 1,210-byte packets. These checks use actual application modules; no camera was connected.

## Reproduce and verify

Run in the indicated directory. Benchmarks use disposable synthetic files only.

| Directory and command | Observed result |
| --- | --- |
| `apps/web`: `npm test -- GifPlayer.test QrGifViewer.test HistoryTab.test previewCache.test useScannerFrameLoop.test useScannerDecoderBootstrap.test scannerCameraLifecycle.test` | 7 files / 115 tests passed |
| `apps/web`: `npm test -- GifPlayer.test HistoryTab.test previewCache.test useScannerFrameLoop.test useScannerDecoderBootstrap.test` | Final affected rerun: 5 files / 72 passed |
| `apps/web`: `npm run lint` | ESLint and Oxlint passed |
| `apps/web`: `npm run build` | TypeScript and Vite passed; existing bundle-size warning |
| `apps/flutter`: `flutter test --no-pub --reporter expanded test/generated_viewer_cache_test.dart test/generated_history_viewer_test.dart test/encoder_inline_preview_test.dart test/encoder_fullscreen_view_test.dart` | 29 passed before adding the opt-in benchmark |
| `apps/flutter`: `flutter analyze --no-pub` | No issues found |
| `apps/flutter/rust`: `cargo test --release` | 6 passed; one manual benchmark ignored |
| Root: `git -c core.whitespace=cr-at-eol diff --check` | Passed |

Native generation benchmark, in `apps/flutter/rust` (PowerShell):

```powershell
$env:AIRQR_PERF_OUTPUT = 'C:/temporary/airqr-perf.gif'
cargo test --release performance_encode_sample -- --ignored --nocapture
```

Codec/scan preparation benchmark, in `apps/web`:

```powershell
node --expose-gc scripts/benchmark-qr-performance.mjs C:/temporary/airqr-perf.gif C:/temporary/airqr-measurements
```

Flutter source benchmark, in `apps/flutter` (five tests passed including the benchmark):

```powershell
flutter test --no-pub --reporter expanded test/generated_viewer_cache_test.dart --dart-define=AIRQR_PERF_GIF=C:/temporary/airqr-measurements/large-qr.gif
```

Regression tests first reproduced eager decoding of all 3,000 frames and scanner gates stuck after capture/submission/handler exceptions. Cache tests cover concurrent loads, eviction while displayed, oversized sources, failure retry and stale pending results. Self-review and executable checks were performed; no independent reviewer or physical iPhone validation was run.

## Remaining performance work

The native `ScannerLocalDecodeController._handleProgress` still awaits each packet's disk write and `IncompleteScanService.updateProgress` history serialization before returning its UI transition. This is a plausible source of pauses under large history or slow storage. A follow-up should measure these stages on iPhone, then introduce bounded persistence batching with explicit flush on pause/reset/completion, session-generation checks and resume-after-interruption tests. Simply making those writes unawaited risks losing or misattributing packets and is not part of this change.

Web generation already uses workers and WASM; this change does not claim a new web-generation speedup. Camera focus, exposure, resolution and actual optical scan throughput require physical-device measurements. The current web fixes recover exception-related gate stalls, not every possible worker hang or hardware bottleneck.

Next device check: generate the same medium/large file before and after, open and close the large GIF/ZIP twice, scan a fixed and then animated QR, interrupt/resume, and compare elapsed time, unique packet progression and memory. Preserve the previously verified binary QR, reset, keyboard and toolbar behavior. Merge/deployment is a separate action; this work introduces no schema migration.

## iOS delivery

[PR #16](https://github.com/Thunzyy/AirQR/pull/16) targets PR #14's branch. Implementation commit: `014c09a30af941f75dcaf600691a3a2b8073370c`. [Build 43225209042](https://github.com/Thunzyy/AirQR/actions/runs/43225209042) succeeded on that exact revision. The subsequent documentation commit does not change application code.

The downloaded `AirQR-iOS-performance.ipa` passed ZIP integrity and arm64 Mach-O checks (23,668,092 bytes). SHA-256: `47A118892C97080D7D3A7262AA08602057A0A0FD8A5CF3D1BE821FCED3210B0F`. It is unsigned and requires the usual signing/sideload method. Build success does not substitute for physical-device performance verification. Rollback: revert `014c09a3`.
