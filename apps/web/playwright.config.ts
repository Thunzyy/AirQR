import { defineConfig, devices } from '@playwright/test';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHARED_HOST_WORKERS = 1;

export default defineConfig({
  testDir: resolve(__dirname, './playwright-runners'),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // These realtime suites share one local sync-server and one browser host.
  workers: SHARED_HOST_WORKERS,
  reporter: 'html',
  use: {
    baseURL: process.env.AIRQR_UI_BASE_URL || 'https://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    ignoreHTTPSErrors: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
