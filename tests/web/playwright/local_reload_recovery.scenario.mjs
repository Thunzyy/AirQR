const uiBaseUrl = process.env.AIRQR_UI_BASE_URL || 'https://localhost:5173';
const username = process.env.AIRQR_USERNAME || 'admin';
const password = process.env.AIRQR_PASSWORD || 'admin';

function basicAuthHeader(user, pass) {
  const token = Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

async function configureWebSyncSettings(context) {
  await context.addInitScript(
    ({ serverUrl, user, pass }) => {
      const NativeWebSocket = window.WebSocket;
      if (!window.__airqrTrackedSockets) {
        window.__airqrTrackedSockets = [];
        window.__airqrWsBinaryDelayMs = 3;
        window.__airqrVisibilityEvents = [document.visibilityState];
        document.addEventListener('visibilitychange', () => {
          window.__airqrVisibilityEvents.push(document.visibilityState);
        });
        let forcedVisibilityState = document.visibilityState;
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get() {
            return forcedVisibilityState;
          },
        });
        Object.defineProperty(document, 'hidden', {
          configurable: true,
          get() {
            return forcedVisibilityState !== 'visible';
          },
        });
        window.__airqrSetVisibilityState = (nextState) => {
          forcedVisibilityState = nextState === 'hidden' ? 'hidden' : 'visible';
          document.dispatchEvent(new Event('visibilitychange'));
        };
        class TrackedWebSocket extends NativeWebSocket {
          constructor(...args) {
            super(...args);
            const url = String(args[0] ?? '');
            window.__airqrTrackedSockets.push({ url, socket: this });
          }

          send(data) {
            const shouldDelay =
              typeof this.url === 'string' &&
              this.url.includes('/api/v1/ws/scan/');

            if (!shouldDelay) {
              return super.send(data);
            }

            const delayMs = Number(window.__airqrWsBinaryDelayMs ?? 0);
            const payload =
              typeof data === 'string'
                ? data
                : data instanceof ArrayBuffer
                ? data.slice(0)
                : ArrayBuffer.isView(data)
                  ? data.slice(0)
                  : data;
            const queue = this.__airqrSendQueue ?? Promise.resolve();
            this.__airqrSendQueue = queue
              .then(
                () =>
                  new Promise((resolve) => {
                    window.setTimeout(resolve, delayMs);
                  })
              )
              .then(() => {
                if (this.readyState === this.OPEN) {
                  super.send(payload);
                }
              });
          }
        }
        TrackedWebSocket.CONNECTING = NativeWebSocket.CONNECTING;
        TrackedWebSocket.OPEN = NativeWebSocket.OPEN;
        TrackedWebSocket.CLOSING = NativeWebSocket.CLOSING;
        TrackedWebSocket.CLOSED = NativeWebSocket.CLOSED;
        window.WebSocket = TrackedWebSocket;
      }

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
      localStorage.setItem('airqr_history_filter', 'scanned');
    },
    { serverUrl: uiBaseUrl, user: username, pass: password }
  );
}

async function getVisibilityEvents(page) {
  return page.evaluate(() =>
    Array.isArray(window.__airqrVisibilityEvents) ? [...window.__airqrVisibilityEvents] : []
  );
}

async function setVisibilityState(page, nextState) {
  await page.evaluate((state) => {
    if (typeof window.__airqrSetVisibilityState === 'function') {
      window.__airqrSetVisibilityState(state);
    }
  }, nextState);
}

async function forceCloseTrackedScanSocket(page, sessionId) {
  await page.evaluate((targetSessionId) => {
    const trackedSockets = Array.isArray(window.__airqrTrackedSockets)
      ? window.__airqrTrackedSockets
      : [];
    const targetPath = `/api/v1/ws/scan/${targetSessionId}`;
    for (const entry of trackedSockets) {
      if (!entry || typeof entry.url !== 'string' || !entry.socket) {
        continue;
      }
      if (!entry.url.includes(targetPath)) {
        continue;
      }
      if (entry.socket.readyState === entry.socket.OPEN) {
        entry.socket.close();
      }
    }
  }, sessionId);
}

async function seedRecoveredPacketSession(page, sessionId, packetCount, packetSize = 32) {
  await page.evaluate(
    async ({ sessionId: seedSessionId, packetCount: seedPacketCount, packetSize: seedPacketSize }) => {
      const deleteDb = (name) =>
        new Promise((resolve) => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = () => resolve();
          request.onerror = () => resolve();
          request.onblocked = () => resolve();
        });

      const openDb = (name, version, onUpgrade) =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open(name, version);
          request.onupgradeneeded = () => onUpgrade(request.result);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });

      const txDone = (transaction) =>
        new Promise((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });

      await deleteDb('AirQR_History');
      await deleteDb('AirQR_ScanSessions');

      const scanDb = await openDb('AirQR_ScanSessions', 2, (db) => {
        if (!db.objectStoreNames.contains('packetPages')) {
          const packetStore = db.createObjectStore('packetPages', { keyPath: 'id' });
          packetStore.createIndex('sessionId', 'sessionId', { unique: false });
          packetStore.createIndex('startIndex', 'startIndex', { unique: false });
        }
        if (!db.objectStoreNames.contains('chunkRecords')) {
          const chunkStore = db.createObjectStore('chunkRecords', { keyPath: 'id' });
          chunkStore.createIndex('sessionId', 'sessionId', { unique: false });
          chunkStore.createIndex('chunkId', 'chunkId', { unique: false });
        }
      });

      const seedPackets = Array.from({ length: seedPacketCount }, (_, index) => {
        const packet = new Uint8Array(seedPacketSize);
        const view = new DataView(packet.buffer);
        view.setUint32(0, index, false);
        packet[4] = 0x51;
        packet[5] = 0x52;
        for (let i = 6; i < packet.length; i += 1) {
          packet[i] = ((index * 31) + i) % 256;
        }
        return packet;
      });

      const scanTx = scanDb.transaction(['packetPages'], 'readwrite');
      scanTx.objectStore('packetPages').put({
        id: `${seedSessionId}:0`,
        sessionId: seedSessionId,
        startIndex: 0,
        packets: seedPackets,
      });
      await txDone(scanTx);
      scanDb.close();

      const historyDb = await openDb('AirQR_History', 4, (db) => {
        if (!db.objectStoreNames.contains('history')) {
          const historyStore = db.createObjectStore('history', { keyPath: 'id' });
          historyStore.createIndex('date', 'date', { unique: false });
          historyStore.createIndex('origin', 'origin', { unique: false });
        }
        if (!db.objectStoreNames.contains('incompleteScan')) {
          db.createObjectStore('incompleteScan', { keyPath: 'sessionId' });
        }
      });
      historyDb.close();
    },
    { sessionId, packetCount, packetSize }
  );
}

async function fetchSessionStatus(api, sessionId, authHeader) {
  const response = await api.get(`${uiBaseUrl}/api/scan/session/${sessionId}`, {
    headers: {
      Authorization: authHeader,
    },
  });

  if (response.status() === 404) {
    return { status: 404, receivedCount: 0 };
  }

  const body = await response.json();
  return {
    status: response.status(),
    receivedCount: Number(body.receivedCount ?? body.receivedPackets ?? body.packetCount ?? 0),
  };
}

export function registerLocalReloadRecoveryTests({ test, expect, environment = 'desktop' }) {
  test.describe('Local Packet Recovery', () => {
    test('recovers a packet-backed local session after reload and backfills only after the first remote snapshot', async ({
      page,
      context,
      request,
    }) => {
      test.setTimeout(120000);
      const authHeader = basicAuthHeader(username, password);
      const sessionId = `reload-${Date.now()}`;
      const packetCount = 3;
      const scanSocketUrls = [];
      const scanFramesSent = [];

      page.on('websocket', (socket) => {
        const socketUrl = socket.url();
        if (!socketUrl.includes(`/api/v1/ws/scan/${sessionId}`)) {
          return;
        }
        scanSocketUrls.push(socketUrl);
        socket.on('framesent', (event) => {
          scanFramesSent.push(event.payload);
        });
      });

      await configureWebSyncSettings(context);
      await page.goto(`${uiBaseUrl}/linksites/airqr-encoder-linksite.html`);
      await seedRecoveredPacketSession(page, sessionId, packetCount);

      let releaseInitialHistory;
      const initialHistoryReleased = new Promise((resolve) => {
        releaseInitialHistory = resolve;
      });
      let interceptedInitialHistory = false;

      await page.route('**/api/scan/history**', async (route) => {
        if (!interceptedInitialHistory) {
          interceptedInitialHistory = true;
          await initialHistoryReleased;
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              entries: [],
              totalCount: 0,
            }),
          });
          return;
        }
        await route.continue();
      });

      await page.goto(`${uiBaseUrl}/history`);

      const resumeButton = page.locator(`[data-testid="history-resume-${sessionId}"]`);
      await expect(resumeButton).toBeVisible({ timeout: 30000 });

      await expect
        .poll(async () => (await fetchSessionStatus(request, sessionId, authHeader)).status, {
          timeout: 5000,
          message: 'server session should stay absent before the first history snapshot is released',
        })
        .toBe(404);

      releaseInitialHistory();

      await expect
        .poll(() => scanSocketUrls.length, {
          timeout: 10000,
          message: 'recovered local session should open the dedicated scan websocket for backfill',
        })
        .toBeGreaterThan(0);

      await expect
        .poll(() => scanFramesSent.length, {
          timeout: 10000,
          message: 'recovered local session should send frames over the dedicated scan websocket',
        })
        .toBeGreaterThan(0);

      await expect
        .poll(async () => (await fetchSessionStatus(request, sessionId, authHeader)).receivedCount, {
          timeout: 20000,
          message: 'server session should be backfilled after the first history snapshot completes',
        })
        .toBe(packetCount);

      await page.reload();

      await expect(resumeButton).toHaveCount(1);
      await expect(resumeButton).toBeVisible({ timeout: 30000 });
      await expect
        .poll(async () => (await fetchSessionStatus(request, sessionId, authHeader)).receivedCount, {
          timeout: 10000,
          message: 'reload should keep the recovered session stable without duplicating server progress',
        })
        .toBe(packetCount);
    });

    test('reconnects and completes a long packet-backed backfill after a forced scan socket interruption', async ({
      page,
      context,
      request,
    }) => {
      test.setTimeout(180000);
      const authHeader = basicAuthHeader(username, password);
      const sessionId = `reload-long-${Date.now()}`;
      const packetCount = 320;
      const packetSize = 8192;
      const scanSocketUrls = [];
      const scanFramesSent = [];

      page.on('websocket', (socket) => {
        const socketUrl = socket.url();
        if (!socketUrl.includes(`/api/v1/ws/scan/${sessionId}`)) {
          return;
        }
        scanSocketUrls.push(socketUrl);
        socket.on('framesent', (event) => {
          scanFramesSent.push(event.payload);
        });
      });

      await configureWebSyncSettings(context);
      await page.goto(`${uiBaseUrl}/linksites/airqr-encoder-linksite.html`);
      await seedRecoveredPacketSession(page, sessionId, packetCount, packetSize);

      let releaseInitialHistory;
      const initialHistoryReleased = new Promise((resolve) => {
        releaseInitialHistory = resolve;
      });
      let interceptedInitialHistory = false;

      await page.route('**/api/scan/history**', async (route) => {
        if (!interceptedInitialHistory) {
          interceptedInitialHistory = true;
          await initialHistoryReleased;
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              entries: [],
              totalCount: 0,
            }),
          });
          return;
        }
        await route.continue();
      });

      await page.goto(`${uiBaseUrl}/history`);

      const resumeButton = page.locator(`[data-testid="history-resume-${sessionId}"]`);
      await expect(resumeButton).toBeVisible({ timeout: 30000 });
      await expect
        .poll(async () => (await fetchSessionStatus(request, sessionId, authHeader)).status, {
          timeout: 5000,
          message: 'server session should stay absent before the first history snapshot is released',
        })
        .toBe(404);

      releaseInitialHistory();

      await expect
        .poll(() => scanSocketUrls.length, {
          timeout: 10000,
          message: 'long backfill should open the dedicated scan websocket',
        })
        .toBeGreaterThan(0);

      await expect
        .poll(() => scanFramesSent.length, {
          timeout: 10000,
          message: 'long backfill should start sending frames before the first forced interruption',
        })
        .toBeGreaterThan(20);

      await forceCloseTrackedScanSocket(page, sessionId);

      await expect
        .poll(() => scanSocketUrls.length, {
          timeout: 20000,
          message: 'client should reconnect the scan websocket after the first forced interruption',
        })
        .toBeGreaterThan(1);

      await expect
        .poll(() => scanFramesSent.length, {
          timeout: 30000,
          message: 'reconnected socket should resume sending frames after the forced interruption',
        })
        .toBeGreaterThan(packetCount / 2);

      await expect
        .poll(async () => (await fetchSessionStatus(request, sessionId, authHeader)).receivedCount, {
          timeout: 45000,
          message: 'long backfill should complete after the forced reconnect without losing progress',
        })
        .toBe(packetCount);

      await page.reload();

      await expect(resumeButton).toHaveCount(1);
      await expect(resumeButton).toBeVisible({ timeout: 30000 });
      await expect
        .poll(async () => (await fetchSessionStatus(request, sessionId, authHeader)).receivedCount, {
          timeout: 10000,
          message: 'reload should keep the long recovered session stable after the forced reconnect',
        })
        .toBe(packetCount);
      await expect
        .poll(() => scanFramesSent.length, {
          timeout: 10000,
          message: 'the long backfill should have transmitted multiple frames across reconnects',
        })
        .toBeGreaterThan(packetCount / 2);
    });

    if (environment === 'desktop') {
      test('resumes a long packet-backed backfill after a temporary offline gap', async ({
        page,
        context,
        request,
      }) => {
        test.setTimeout(180000);
        const authHeader = basicAuthHeader(username, password);
        const sessionId = `reload-offline-${Date.now()}`;
        const packetCount = 224;
        const packetSize = 4096;
        const scanSocketUrls = [];
        const scanFramesSent = [];

        page.on('websocket', (socket) => {
          const socketUrl = socket.url();
          if (!socketUrl.includes(`/api/v1/ws/scan/${sessionId}`)) {
            return;
          }
          scanSocketUrls.push(socketUrl);
          socket.on('framesent', (event) => {
            scanFramesSent.push(event.payload);
          });
        });

        await configureWebSyncSettings(context);
        await page.goto(`${uiBaseUrl}/linksites/airqr-encoder-linksite.html`);
        await seedRecoveredPacketSession(page, sessionId, packetCount, packetSize);

        let releaseInitialHistory;
        const initialHistoryReleased = new Promise((resolve) => {
          releaseInitialHistory = resolve;
        });
        let interceptedInitialHistory = false;

        await page.route('**/api/scan/history**', async (route) => {
          if (!interceptedInitialHistory) {
            interceptedInitialHistory = true;
            await initialHistoryReleased;
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                entries: [],
                totalCount: 0,
              }),
            });
            return;
          }
          await route.continue();
        });

        await page.goto(`${uiBaseUrl}/history`);

        const resumeButton = page.locator(`[data-testid="history-resume-${sessionId}"]`);
        await expect(resumeButton).toBeVisible({ timeout: 30000 });

        releaseInitialHistory();

        await expect
          .poll(() => scanSocketUrls.length, {
            timeout: 10000,
            message: 'offline-gap scenario should open the dedicated scan websocket',
          })
          .toBeGreaterThan(0);

        await expect
          .poll(() => scanFramesSent.length, {
            timeout: 10000,
            message: 'offline-gap scenario should start sending frames before going offline',
          })
          .toBeGreaterThan(20);

        const serverCountBeforeOffline = await fetchSessionStatus(request, sessionId, authHeader);

        try {
          await context.setOffline(true);
          await page.waitForTimeout(1500);
        } finally {
          await context.setOffline(false);
        }

        await expect
          .poll(() => scanSocketUrls.length, {
            timeout: 20000,
            message: 'client should reconnect the scan websocket after the offline gap',
          })
          .toBeGreaterThan(1);

        await expect
          .poll(async () => (await fetchSessionStatus(request, sessionId, authHeader)).receivedCount, {
            timeout: 45000,
            message: 'offline-gap backfill should complete after connectivity returns',
          })
          .toBe(packetCount);

        await expect
          .poll(async () => (await fetchSessionStatus(request, sessionId, authHeader)).receivedCount, {
            timeout: 10000,
            message: 'server progress should not regress after the offline gap',
          })
          .toBeGreaterThanOrEqual(serverCountBeforeOffline.receivedCount);
      });
    }

    test('completes a long packet-backed backfill after a background-tab visibility cycle', async ({
      page,
      context,
      request,
    }) => {
      test.setTimeout(180000);
      const authHeader = basicAuthHeader(username, password);
      const sessionId = `reload-background-${Date.now()}`;
      const packetCount = 192;
      const packetSize = 4096;
      const scanSocketUrls = [];
      const scanFramesSent = [];

      page.on('websocket', (socket) => {
        const socketUrl = socket.url();
        if (!socketUrl.includes(`/api/v1/ws/scan/${sessionId}`)) {
          return;
        }
        scanSocketUrls.push(socketUrl);
        socket.on('framesent', (event) => {
          scanFramesSent.push(event.payload);
        });
      });

      await configureWebSyncSettings(context);
      await page.goto(`${uiBaseUrl}/linksites/airqr-encoder-linksite.html`);
      await seedRecoveredPacketSession(page, sessionId, packetCount, packetSize);

      let releaseInitialHistory;
      const initialHistoryReleased = new Promise((resolve) => {
        releaseInitialHistory = resolve;
      });
      let interceptedInitialHistory = false;

      await page.route('**/api/scan/history**', async (route) => {
        if (!interceptedInitialHistory) {
          interceptedInitialHistory = true;
          await initialHistoryReleased;
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              entries: [],
              totalCount: 0,
            }),
          });
          return;
        }
        await route.continue();
      });

      await page.goto(`${uiBaseUrl}/history`);

      const resumeButton = page.locator(`[data-testid="history-resume-${sessionId}"]`);
      await expect(resumeButton).toBeVisible({ timeout: 30000 });

      releaseInitialHistory();

      await expect
        .poll(() => scanSocketUrls.length, {
          timeout: 10000,
          message: 'background-tab scenario should open the dedicated scan websocket',
        })
        .toBeGreaterThan(0);

      await expect
        .poll(() => scanFramesSent.length, {
          timeout: 10000,
          message: 'background-tab scenario should start sending frames before backgrounding',
        })
        .toBeGreaterThan(0);

      await setVisibilityState(page, 'hidden');

      await expect
        .poll(() => getVisibilityEvents(page), {
          timeout: 15000,
          message: 'primary page should record a hidden visibility transition when backgrounded',
        })
        .toContain('hidden');

      await page.waitForTimeout(1500);

      await setVisibilityState(page, 'visible');

      await expect
        .poll(() => getVisibilityEvents(page), {
          timeout: 15000,
          message: 'primary page should record a visible visibility transition after returning',
        })
        .toContain('visible');

      await expect
        .poll(async () => (await fetchSessionStatus(request, sessionId, authHeader)).receivedCount, {
          timeout: 45000,
          message: 'backgrounded long backfill should still complete without losing progress',
        })
        .toBe(packetCount);

      await expect
        .poll(() => scanFramesSent.length, {
          timeout: 10000,
          message: 'background-tab scenario should transmit multiple frames across the visibility cycle',
        })
        .toBeGreaterThan(packetCount / 2);
    });

  });
}

export default { registerLocalReloadRecoveryTests };
