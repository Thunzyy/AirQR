# Tests

The repository-managed test suites are centralized here.

## Layout

- `tests/web/vitest/`: web unit and integration tests
- `tests/web/playwright/`: shared real-time Playwright scenario logic
- `tests/python/build/`: build script validation tests
- `tests/python/sync_server/`: sync server Pytest suite
- `tests/tools/`: repository-level wrappers and manual test orchestration scripts

## Commands

```powershell
cd apps/web
npm test
npm run test:e2e
npm run test:ui:realtime
npm run test:ui:background:manual

cd ../..
python -m pytest tests/python -q
```

## Flutter Note

Flutter tests stay in `apps/flutter/integration_test/` because `flutter test` depends on that layout.

## Playwright Note

Playwright entry files stay in `apps/web/playwright-runners/`, while the shared implementation lives in `tests/web/playwright/`.
The repository-managed web Playwright runs are intentionally pinned to `--workers=1` because the heavy realtime suites share one local sync-server and one browser host.
The real browser background-cycle validation stays manual-on-purpose and is exposed separately through `npm run test:ui:background:manual`.
