const uiBaseUrl = process.env.AIRQR_UI_BASE_URL || 'https://localhost:5173';
const apiBaseUrl = process.env.AIRQR_API_BASE_URL || uiBaseUrl;
const username = process.env.AIRQR_USERNAME || 'admin';
const password = process.env.AIRQR_PASSWORD || 'admin';

function basicAuthHeader(user, pass) {
  const token = Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

async function configureGeneratedHistorySyncSettings(context) {
  await context.addInitScript(
    ({ serverUrl, user, pass }) => {
      const persisted = {
        state: {
          activeTab: 3,
          theme: 'system',
          language: 'en',
          defaultCameraId: null,
          uploadConfig: {
            enabled: true,
            url: serverUrl,
            apiKey: '',
            username: user,
            password: pass,
            syncScanned: true,
            syncGenerated: true,
            autoSyncHistory: true,
          },
        },
        version: 0,
      };
      localStorage.setItem('airqr_settings', JSON.stringify(persisted));
      localStorage.setItem('airqr_language', 'en');
      localStorage.setItem('airqr_history_filter', 'generated');
    },
    { serverUrl: apiBaseUrl, user: username, pass: password },
  );
}

async function uploadGeneratedHistoryItem(api, expect, authHeader, historyId, title) {
  const fileBytes = Buffer.from(`generated-${historyId}`, 'utf8');
  const params = new URLSearchParams({
    historyId,
    title,
    filename: `${historyId}.bin`,
    mimeType: 'application/octet-stream',
    size: String(fileBytes.length),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const response = await api.post(`${apiBaseUrl}/api/history/item?${params.toString()}`, {
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/octet-stream',
    },
    data: fileBytes,
  });

  expect(response.ok()).toBeTruthy();
  await expect.poll(async () => response.status()).toBe(200);
}

async function deleteGeneratedHistoryItem(api, expect, authHeader, historyId) {
  const response = await api.delete(`${apiBaseUrl}/api/history/item/${historyId}`, {
    headers: {
      Authorization: authHeader,
    },
  });

  expect(response.ok()).toBeTruthy();
  await expect.poll(async () => response.status()).toBe(200);
}

export function registerHistoryRealtimeTests({ test, expect }) {
  test.describe('History Realtime Shared WebSocket', () => {
    test('shows a generated history item pushed while the page is online', async ({
      page,
      context,
      request,
    }) => {
      test.setTimeout(120000);
      const authHeader = basicAuthHeader(username, password);
      const historyId = `history-live-${Date.now()}`;
      const title = `Realtime Generated ${historyId}`;
      const eventSocketUrls = [];

      page.on('websocket', (socket) => {
        const socketUrl = socket.url();
        if (!socketUrl.includes('/api/v1/ws/events')) {
          return;
        }
        eventSocketUrls.push(socketUrl);
      });

      await configureGeneratedHistorySyncSettings(context);
      await page.goto(`${uiBaseUrl}/history`);

      await expect
        .poll(() => eventSocketUrls.length, {
          timeout: 15000,
          message: 'history page should establish the shared realtime websocket',
        })
        .toBeGreaterThan(0);

      await expect(page.getByText(title, { exact: true })).toHaveCount(0);

      await uploadGeneratedHistoryItem(request, expect, authHeader, historyId, title);

      await expect(page.getByText(title, { exact: true })).toBeVisible({ timeout: 20000 });
    });

    test('shows a generated history item created during an offline gap after shared websocket reconnect', async ({
      page,
      context,
      request,
    }) => {
      test.setTimeout(120000);
      const authHeader = basicAuthHeader(username, password);
      const historyId = `history-offline-${Date.now()}`;
      const title = `Offline Generated ${historyId}`;
      const eventSocketUrls = [];

      page.on('websocket', (socket) => {
        const socketUrl = socket.url();
        if (!socketUrl.includes('/api/v1/ws/events')) {
          return;
        }
        eventSocketUrls.push(socketUrl);
      });

      await configureGeneratedHistorySyncSettings(context);
      await page.goto(`${uiBaseUrl}/history`);

      await expect
        .poll(() => eventSocketUrls.length, {
          timeout: 15000,
          message: 'history page should establish the shared realtime websocket before offline',
        })
        .toBeGreaterThan(0);

      await expect(page.getByText(title, { exact: true })).toHaveCount(0);

      try {
        await context.setOffline(true);
        await page.waitForTimeout(1500);
        await uploadGeneratedHistoryItem(request, expect, authHeader, historyId, title);
      } finally {
        await context.setOffline(false);
      }

      await expect
        .poll(() => eventSocketUrls.length, {
          timeout: 20000,
          message: 'shared realtime websocket should reconnect after the offline gap',
        })
        .toBeGreaterThan(1);

      await expect(page.getByText(title, { exact: true })).toBeVisible({ timeout: 20000 });
    });

    test('removes a generated history item in real time when it is deleted remotely', async ({
      page,
      context,
      request,
    }) => {
      test.setTimeout(120000);
      const authHeader = basicAuthHeader(username, password);
      const historyId = `history-delete-${Date.now()}`;
      const title = `Realtime Delete ${historyId}`;
      const eventSocketUrls = [];

      page.on('websocket', (socket) => {
        const socketUrl = socket.url();
        if (!socketUrl.includes('/api/v1/ws/events')) {
          return;
        }
        eventSocketUrls.push(socketUrl);
      });

      await configureGeneratedHistorySyncSettings(context);
      await page.goto(`${uiBaseUrl}/history`);

      await expect
        .poll(() => eventSocketUrls.length, {
          timeout: 15000,
          message: 'history page should establish the shared realtime websocket before delete test',
        })
        .toBeGreaterThan(0);

      await uploadGeneratedHistoryItem(request, expect, authHeader, historyId, title);
      await expect(page.getByText(title, { exact: true })).toBeVisible({ timeout: 20000 });

      await deleteGeneratedHistoryItem(request, expect, authHeader, historyId);

      await expect(page.getByText(title, { exact: true })).toHaveCount(0, {
        timeout: 20000,
      });
    });
  });
}

export default { registerHistoryRealtimeTests };
