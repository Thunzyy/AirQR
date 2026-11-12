# Flutter/web interface and scanner verification

Issue: [#13](https://github.com/Thunzyy/AirQR/issues/13). Implementation: `7cca2a9a`, based on `964bd5a9` (PR #12). Review date: 2026-11-12.

This audit covers the five main pages, their shared controls and settings subpages. It combines rendered widgets/browser checks with the existing interaction tests. It does **not** establish physical iPhone camera throughput or pixel-for-pixel identity between native controls and browser controls.

## Shared design

The reference is the existing web design in `apps/web/src/index.css`, not a new theme. Flutter uses Manrope, the existing Lucide assets and `AirQrUiColors`. The changes align:

- page margins, title hierarchy, card radii (34 px for main surfaces), shadows and light/dark colors;
- the bottom navigation's standard 76 px height, while allowing large text to grow;
- history toolbar buttons adapt between 32 and 48 px, remaining circular on the same row as the full connection badge;
- history item actions with a 44 px touch target and 40 px visible surface;
- decoder picker, empty state and disabled action; the sample GIF action and obsolete copy are removed;
- settings menus, detail headings, cards, dividers, sliders and dropdowns;
- encoder source controls and network notice, plus a note editor that wraps at large text sizes.

## Page and control inventory

“Rendered” means a real browser component or Flutter widget was captured. “Tests” means interaction/behavior assertions, not a physical device test. Test names below refer to `apps/flutter/test/` and `tests/web/vitest/` respectively.

| Area | Controls and states reviewed | Evidence and result |
| --- | --- | --- |
| App shell | Five tabs, active icon/label, safe-area clearance, keyboard, large text, reduced motion | Flutter `app_shell_test.dart`, `text_scaling_test.dart`; rendered light/dark pages. Navigation matches the web height while retaining accessible growth, and remains mounted in the same position behind the system keyboard. |
| Encoder source | File/note switch, file picker, note format, content, clear, character count, encode action, network notice/dismiss/link actions | `encoder_page_test.dart`, `encoder_source_controller_test.dart`, `encoder_page_widgets_test.dart`; web `EncoderTab.linksite.test.tsx`, `encoderPayload.test.ts`; rendered file and note views. Large-text format selector/footer overflow fixed. |
| Encoder output | Play/pause, previous/next frame, frame slider/count, FPS controls, zoom, fullscreen/exit, chunks, automatic chunk selection, download | `encoder_inline_preview_test.dart`, `encoder_fullscreen_view_test.dart`, `generated_history_viewer_test.dart`, `encoder_download_controller_test.dart`; web encoder/viewer tests in the complete suite. Existing controls retained; mobile spacing and shared surfaces reviewed. |
| Decoder | Empty file picker, selected GIF/ZIP, disabled/enabled Decode, busy/progress/error, successful file/note result, download/copy | `decoder_page_test.dart`, `decoder_failure_test.dart`, `scanner_result_view_test.dart`; web `GifDecoder.test.tsx`. Rendered empty states in both themes. “Try a sample GIF” removed; unsupported QR guidance remains on relevant failures. |
| Scanner camera | Camera selection, torch, help, reset, unavailable/permission state, active/inactive camera | `scanner_mobile_controller_controller_test.dart`, `scanner_lifecycle_controller_test.dart`, `scanner_page_chrome_test.dart`; web `scannerCameraLifecycle.test.tsx`, `ScannerHelpModal.test.tsx`, camera hook tests. Browser camera-unavailable/help views inspected; native overlay captured with synthetic progress. |
| Scanner progress | FPS, scanned/min/max, source, progress, chunk details, threshold/decoding/complete states | `scanner_analysis_metrics_test.dart`, `scanner_session_progress_test.dart`; web `ScannerChrome.test.tsx`, frame/progress hook tests. Browser panel rectangle stays at y=535.5 / height=338.5 at 402×874 across scanning, threshold reached, decoding and complete. Transient details now live in the details popover. |
| Scanner completion/resume | File/note preview, save/copy, history, completed-session guard, incomplete resume, reset then same QR | `scanner_operation_controller_test.dart`, `scanner_session_resolution_controller_test.dart`, resume/completion/result controller tests; web `scannerCameraLifecycle.test.tsx`, `useScannerDecoderBootstrap.test.tsx`, `Scanner.noteAutoSave.test.tsx`. Late results are rejected after reset; explicit reset permits rescanning the previous completed session. |
| History toolbar | Connected/local/unavailable badge, search/close, sort menu, selection mode, refresh, sync all, clear | `history_page_widgets_test.dart`, `history_page_selection_test.dart`, `history_query_test.dart`; web `History.test.tsx`, `HistoryTab.test.tsx`. Follow-up geometry checks at 320/360/375/390/402/820 px: the full badge and six circular actions fit on one row. |
| History entries | All/scanned/generated filters and counts, date groups, empty view, preview, download, delete, keep local, sync/retry, incomplete progress/resume/delete | `history_page_test.dart`, `history_page_actions_test.dart`, `history_page_refresh_test.dart`, `history_selection_widgets_test.dart`; web history, resume and backfill tests. Rendered populated light/dark native history and connected web history. Incomplete cards use full-width progress and wrap metadata/actions. |
| History bulk/dialogs | Select/clear selection, download selected, ZIP export, delete confirmation, clear history confirmation, remote-only materialization failures | `history_bulk_export_test.dart`, selection/refresh tests; web `ConfirmDialog.test.tsx`, `HistoryTab.test.tsx`. Existing destructive confirmations and local/remote semantics retained. |
| Settings menu | Encoder, Scanner, Server sync, Appearance, Logging, About; back navigation | `settings_page_test.dart`; browser and Flutter subpage captures. Shared menu/title/card layout aligned. Native Offline web app section remains available. |
| Settings Encoder | Frame rate, packet size, QR target size, error correction, redundancy, compression, forced chunks/chunk size | `settings_page_test.dart`, `settings_page_helpers_test.dart`; web `EncoderSettings.test.tsx`, `settingsStore.test.ts`. Selected values remain visible at narrow widths and large text. |
| Settings Scanner | Presets, scan interval, resolution, detection mode, torch, camera preference, advanced options | `settings_page_test.dart`, `scanner_config_camera_test.dart`, `scanner_settings_controller_test.dart`; web scanner defaults/camera tests. Saved settings and controller reload paths retained. |
| Settings Server sync | Enable/origin switches, URL/user/password, verify/save, local server start/stop, status, retention | `settings_page_test.dart`, `settings_sync_controller_test.dart`, `local_sync_server_controller_test.dart`; web `serverSync.test.ts`, `HistoryRetentionSetting.test.tsx`. Previous iOS draft-credential verification and keyboard fixes preserved. |
| Settings Appearance | Theme/system mode, language, motion preferences | `settings_page_test.dart`, `settings_page_controller_test.dart`, text-scaling tests; web `settingsStore.test.ts`. Main pages captured in light/dark; FR strings regenerated alongside EN. |
| Settings Logging/About | Log level/filter/export/clear, version, project links, maintenance/configuration actions and confirmation dialogs | `settings_page_test.dart`, `settings_maintenance_service_test.dart`, controller/helper tests; web settings and confirm dialog tests. Rendered Logging and About subpages. |
| Native hosting | Offline web app start/stop, local/alternative network URLs, copy/open links | `settings_page_test.dart`, local server tests; rendered native hosting section. This is a native capability, not a browser-hosted server implementation. |

## Scanner correctness

The old Flutter FPS counter counted accepted QR results after duplicate filtering. A 10 FPS animated sender could therefore produce a displayed value near 10 even if the native pipeline examined more camera images. On iOS, the patched `mobile_scanner` now exposes actual analysis attempts per elapsed second through a method channel. Web counts frames submitted to analysis, after readiness guards. Neither number is useful file throughput, unique packet throughput, nor a promise of 60 FPS.

`ScannerOperationController` serializes decoder reset with pending local work, invalidates obsolete results, and releases its busy state after success or error. Camera recreation waits for that work rather than using a fixed delay. Remote progress has a generation check and a request token so an old callback cannot unlock a newer request. The web worker/native-decoder paths likewise keep a stale callback from changing the current scan.

The iOS patch remains pinned to `mobile_scanner` 7.1.3 and is applied to a Pods copy, not to the shared Pub cache. Patch application is checked against the unmodified upstream Swift file. The earlier exact binary payload and centered `BoxFit.cover` overlay corrections remain in this branch.

## Synchronization behavior

- A manual sync remains busy until acknowledgement or a reported failure. Duplicate taps are ignored while that item is pending.
- Native file sync checks `SyncResult.success` and a positive upload count before changing local-only/synced metadata. Stable server IDs are reused on retry.
- Web file sync preserves stable IDs and timestamps, reports disabled/unavailable/preparation failures, and handles asynchronous failure callbacks. Concurrent acknowledgements read the current store, preventing one completion from undoing another.
- Web incomplete scans wait for all pending packet acknowledgements before showing success; timeout/discard releases the manual action for retry. Native incomplete scans check every packet upload result.
- Manual refresh is not silently skipped by the former ten-second cooldown. “Connected” requires a successful remote-history response.
- Existing reconnect/outbox/chunk-aware replay mechanisms remain covered by the WebSocket suites.

## Executed verification

| Command (working directory) | Result |
| --- | --- |
| `flutter test --no-pub` (`apps/flutter`) | 664 passed; capture and live-server smoke tests are opt-in. |
| `flutter test --no-pub test/parity_visual_capture_test.dart --dart-define=AIRQR_CAPTURE_DIR=<absolute-output-directory> --dart-define=AIRQR_MONO_FONT=C:/Windows/Fonts/consola.ttf` (`apps/flutter`) | 2 passed; 26 real-widget captures at 402×874, light/dark. The optional monospace font is only for the test renderer. |
| `flutter test --no-pub test/history_page_refresh_test.dart` (`apps/flutter`, after final cleanup) | 19 passed. |
| `flutter analyze --no-pub` (`apps/flutter`) | No issues. |
| `npm test` (`apps/web`) | 85 files / 635 tests passed. |
| `npm test -- HistoryTab scanUploadService scanWebSocketSyncService` (`apps/web`, final sync changes) | 3 files / 85 tests passed, including simultaneous acknowledgements and retry after failure. Use the repository's `test-runners` configuration, not standalone Vitest from the repository root. |
| `npm run lint` (`apps/web`) | ESLint and Oxlint passed. |
| `npm run build` (`apps/web`) | TypeScript/Vite passed. Existing bundle-size warning remains. |
| `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 python -m pytest -p pytest_asyncio.plugin tests/python/sync_server/test_cross_device_reliability.py -q` (root; use PowerShell environment assignment on Windows) | 7 passed: real local HTTP/SSE/WebSocket server, alternating/parallel producers, monotonic counters, multi-chunk packet storage. These are simulated device clients, not a physical iPhone/browser pair. |
| `git apply --check --no-index <mobile_scanner-7.1.3.patch>` (clean upstream-source scratch directory) | Passed. Patch context contains upstream whitespace and is excluded from the ordinary source whitespace check. |

Rendered checks use Playwright CLI and the opt-in Flutter capture helper. Screenshots are review artifacts, not golden image assertions. A temporary web component harness was removed before the build/commit.

### Real client interoperability smoke

In addition to the seven server protocol tests, both actual client services exchanged files through a disposable loopback SQLite sync server:

1. Flutter `SyncService.uploadGenerated` and `uploadScan` each uploaded 65,792 bytes (every byte value, repeated; reverse order for the scan).
2. Chromium loaded the actual web `fetchServerHistoryFile` / `fetchServerFile` modules and verified every downloaded byte.
3. Web `queueHistoryItem` / `queueScanComplete` uploaded the same two payloads with new IDs, awaiting both success callbacks.
4. Flutter `fetchServerHistory` saw all four entries; `downloadFile` read both web uploads and verified every byte.

Both native phases passed (one active test and one skipped in each phase); the browser reported two confirmed uploads and four shared history entries. Uploads/downloads used the real HTTP services, with HTTPS for the browser and final native download. Preferences were test fixtures; no HTTP client mock was installed. This verifies the app service implementations, not a physical iOS build's network stack or UI automation.

The reusable native runner is `apps/flutter/test/live_sync_interop_test.dart`. Run it only against a disposable loopback server with `--dart-define=AIRQR_LIVE_SYNC_URL=<url>` and `--dart-define=AIRQR_LIVE_SYNC_PHASE=upload`, then exchange the payloads in the browser, then repeat with phase `download`. A HTTPS web page needs a HTTPS sync URL; the application's mixed-content protection remains enabled.

## Platform boundaries and remaining device check

### Follow-up: keyboard stability and a single history toolbar row

Lucas's second iPhone comparison requests the badge beside the buttons, allowing smaller buttons to fit. This supersedes the first implementation's wrapped 48 px toolbar.

- Flutter keeps `AirQrBottomNav` mounted at a fixed bottom position; `SafeArea.maintainBottomViewPadding` prevents the safe-area margin from jumping during keyboard animation. The system keyboard covers the navigation naturally. The existing URL/user/password reachability test now checks stable element identity and geometry at keyboard insets 1/80/300/420 px and after dismissal, with a 34 px iPhone safe area.
- Both history toolbars adapt their circular actions to the remaining row width (32–48 px), compacting badge padding/gaps on narrow displays. Flutter measures the actual Manrope label. At large accessibility text sizes, native actions retain 48 px targets in a horizontally scrollable single row.
- Button geometry changes immediately; only hover/focus colors animate. This avoids a transient overflow when the connection/data state or available width changes.
- Flutter: 56 shell/toolbar tests and 53 selection/text-scaling tests passed. The 2 opt-in capture tests produce 26 light/dark images. Web: 41 History interaction tests, lint and build passed. Browser geometry assertions cover six widths and the open sort menu. These checks use synthetic history entries; iPhone keyboard animation still needs confirmation on the new IPA.

Native file selection, sharing, permissions and keyboard behavior remain OS controls. The browser benchmark/calibration route is browser-specific; native local hosting is native-specific. These are not represented as newly ported features. The table covers shared controls and identifies these boundaries explicitly.

Review was a self-review of the diff plus executable checks; no independent reviewer was run. [iOS build 43146322312](https://github.com/Thunzyy/AirQR/actions/runs/43146322312) succeeded on implementation commit `7cca2a9a`; subsequent commits change documentation/tests only. The unsigned IPA passed ZIP integrity verification. SHA-256: `E3167E5C482F9A9C59BB4312F28D6705BCF1280834F23C319C30A2003C8C12D9`. It requires the same signing/sideload method as the previous build.

On a physical iPhone, validate the new analysis counter with a fixed/slow/fast QR stream, reset during scanning and immediately rescan the same QR, then sync files in both directions with the web and retry once after a network interruption. Physical throughput, camera geometry and the keyboard on the new IPA remain device validation items; local tests are not substituted for that evidence.

Rollback: revert implementation commit `7cca2a9a` on this issue branch. Its parent retains the earlier iOS payload, overlay, credential and keyboard fixes. No server schema migration is introduced.
