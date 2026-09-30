const uiBaseUrl = process.env.AIRQR_UI_BASE_URL || 'https://localhost:5173';
const apiBaseUrl = process.env.AIRQR_API_BASE_URL || uiBaseUrl;
const username = process.env.AIRQR_USERNAME || 'admin';
const password = process.env.AIRQR_PASSWORD || 'admin';
const manualBackgroundMs = Number(process.env.AIRQR_MANUAL_BACKGROUND_MS || 10000);
const manualVisibilityTimeoutMs = Number(
  process.env.AIRQR_MANUAL_VISIBILITY_TIMEOUT_MS || 90000
);
const manualPacketCount = Number(process.env.AIRQR_MANUAL_PACKET_COUNT || 192);
const manualPacketSize = Number(process.env.AIRQR_MANUAL_PACKET_SIZE || 4096);
const manualWsDelayMs = Number(process.env.AIRQR_MANUAL_WS_DELAY_MS || 80);

function basicAuthHeader(user, pass) {
  const token = Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

async function configureManualWebSyncSettings(context) {
  await context.addInitScript(
    ({ serverUrl, user, pass, wsDelayMs }) => {
      const NativeWebSocket = window.WebSocket;
      if (!window.__airqrTrackedSockets) {
        window.__airqrTrackedSockets = [];
        window.__airqrWsBinaryDelayMs = wsDelayMs;
        window.__airqrVisibilityTimeline = [
          { state: document.visibilityState, at: Date.now() },
        ];
        window.__airqrFocusTimeline = [
          { state: document.hasFocus() ? 'focused' : 'blurred', at: Date.now() },
        ];
        document.addEventListener('visibilitychange', () => {
          window.__airqrVisibilityTimeline.push({
            state: document.visibilityState,
            at: Date.now(),
          });
        });
        window.addEventListener('focus', () => {
          window.__airqrFocusTimeline.push({
            state: 'focused',
            at: Date.now(),
          });
        });
        window.addEventListener('blur', () => {
          window.__airqrFocusTimeline.push({
            state: 'blurred',
            at: Date.now(),
          });
        });
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
    { serverUrl: uiBaseUrl, user: username, pass: password, wsDelayMs: manualWsDelayMs }
  );
}

async function seedRecoveredPacketSession(page, sessionId, packetCount, packetSize = 32) {
  await page.evaluate(
    async ({
      sessionId: seedSessionId,
      packetCount: seedPacketCount,
      packetSize: seedPacketSize,
    }) => {
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

      const scanDb = await openDb('AirQR_ScanSessions', 4, (db) => {
        if (!db.objectStoreNames.contains('packetPages')) {
          const packetStore = db.createObjectStore('packetPages', { keyPath: 'id' });
          packetStore.createIndex('sessionId', 'sessionId', { unique: false });
          packetStore.createIndex('startIndex', 'startIndex', { unique: false });
          packetStore.createIndex('sessionStartIndex', ['sessionId', 'startIndex'], {
            unique: false,
          });
        }
        if (!db.objectStoreNames.contains('packetSessionSummaries')) {
          db.createObjectStore('packetSessionSummaries', { keyPath: 'sessionId' });
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

      const scanTx = scanDb.transaction(
        ['packetPages', 'packetSessionSummaries'],
        'readwrite'
      );
      scanTx.objectStore('packetPages').put({
        id: `${seedSessionId}:0`,
        sessionId: seedSessionId,
        startIndex: 0,
        packets: seedPackets,
      });
      scanTx.objectStore('packetSessionSummaries').put({
        sessionId: seedSessionId,
        packetCount: seedPackets.length,
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
      const historyTx = historyDb.transaction(['incompleteScan'], 'readwrite');
      historyTx.objectStore('incompleteScan').put({
        sessionId: seedSessionId,
        filename: 'manual-background.bin',
        received: seedPacketCount,
        total: seedPacketCount,
        date: new Date().toISOString(),
        source: 'local',
      });
      await txDone(historyTx);
      historyDb.close();
    },
    { sessionId, packetCount, packetSize }
  );
}

async function fetchSessionStatus(api, sessionId, authHeader) {
  const response = await api.get(
    `${apiBaseUrl}/api/scan/session/${sessionId}`,
    {
      headers: {
        Authorization: authHeader,
      },
    }
  );

  if (response.status() === 404) {
    return { status: 404, receivedCount: 0 };
  }

  const body = await response.json();
  return {
    status: response.status(),
    receivedCount: Number(body.receivedCount ?? body.receivedPackets ?? body.packetCount ?? 0),
  };
}

async function getVisibilityTimeline(page) {
  return page.evaluate(() =>
    Array.isArray(window.__airqrVisibilityTimeline)
      ? window.__airqrVisibilityTimeline.map((entry) => ({
          state: String(entry?.state ?? ''),
          at: Number(entry?.at ?? 0),
        }))
      : []
  );
}

async function getFocusTimeline(page) {
  return page.evaluate(() =>
    Array.isArray(window.__airqrFocusTimeline)
      ? window.__airqrFocusTimeline.map((entry) => ({
          state: String(entry?.state ?? ''),
          at: Number(entry?.at ?? 0),
        }))
      : []
  );
}

function getObservedHiddenDurationMs(timeline) {
  let hiddenAt = null;
  for (const entry of timeline) {
    if (entry.state === 'hidden' && hiddenAt === null) {
      hiddenAt = entry.at;
      continue;
    }
    if (entry.state === 'visible' && hiddenAt !== null) {
      return Math.max(0, entry.at - hiddenAt);
    }
  }
  return 0;
}

function getObservedBlurDurationMs(timeline) {
  let blurredAt = null;
  for (const entry of timeline) {
    if (entry.state === 'blurred' && blurredAt === null) {
      blurredAt = entry.at;
      continue;
    }
    if (entry.state === 'focused' && blurredAt !== null) {
      return Math.max(0, entry.at - blurredAt);
    }
  }
  return 0;
}

async function resetVisibilityTimeline(page) {
  await page.evaluate(() => {
    window.__airqrVisibilityTimeline = [
      { state: document.visibilityState, at: Date.now() },
    ];
    window.__airqrFocusTimeline = [
      { state: document.hasFocus() ? 'focused' : 'blurred', at: Date.now() },
    ];
  });
}

async function setInstructionOverlay(page, lines, tone = 'info') {
  await page.evaluate(
    ({ nextLines, nextTone }) => {
      const id = 'airqr-manual-background-overlay';
      const existing = document.getElementById(id);
      const palette =
        nextTone === 'success'
          ? {
              background: 'rgba(20, 83, 45, 0.94)',
              border: 'rgba(74, 222, 128, 0.45)',
            }
          : {
              background: 'rgba(17, 24, 39, 0.94)',
              border: 'rgba(56, 189, 248, 0.45)',
            };
      const overlay = existing || document.createElement('div');
      overlay.id = id;
      overlay.setAttribute('role', 'status');
      overlay.style.position = 'fixed';
      overlay.style.right = '16px';
      overlay.style.bottom = '16px';
      overlay.style.zIndex = '2147483647';
      overlay.style.maxWidth = '420px';
      overlay.style.padding = '14px 16px';
      overlay.style.borderRadius = '16px';
      overlay.style.background = palette.background;
      overlay.style.border = `1px solid ${palette.border}`;
      overlay.style.boxShadow = '0 18px 40px rgba(0, 0, 0, 0.35)';
      overlay.style.color = '#f8fafc';
      overlay.style.fontFamily =
        'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      overlay.style.fontSize = '14px';
      overlay.style.lineHeight = '1.5';
      overlay.innerHTML = `
        <div style="font-weight:700; margin-bottom:8px;">Manual Background Validation</div>
        ${nextLines.map((line) => `<div>${line}</div>`).join('')}
      `;
      if (!existing) {
        document.body.appendChild(overlay);
      }
    },
    { nextLines: lines, nextTone: tone }
  );
}

async function setupHelperTab(helperPage, sessionId) {
  const helperHtml = `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>AirQR Manual Background Helper</title>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <style>
        body {
          margin: 0;
          min-height: 100vh;
          display: grid;
          place-items: center;
          background: linear-gradient(160deg, #0f172a, #111827 60%, #164e63);
          color: #f8fafc;
          font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        main {
          max-width: 720px;
          padding: 32px;
          border-radius: 24px;
          background: rgba(15, 23, 42, 0.82);
          border: 1px solid rgba(56, 189, 248, 0.28);
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
        }
        h1 {
          margin-top: 0;
          margin-bottom: 12px;
          font-size: 28px;
        }
        p {
          line-height: 1.6;
          font-size: 16px;
        }
        code {
          color: #7dd3fc;
        }
      </style>
    </head>
    <body>
      <main>
        <h1>Manual Background Helper</h1>
        <p>Stay on this tab for the requested background interval, then switch back to the original AirQR tab.</p>
        <p>Session: <code>${sessionId}</code></p>
        <p>You do not need to interact with this page further.</p>
      </main>
    </body>
  </html>`;

  await helperPage.setContent(helperHtml, { waitUntil: 'load' });
}

export function registerManualBackgroundVisibilityTests({ test, expect }) {
  test.describe('Manual Background Validation', () => {
    test('observes a real hidden/visible cycle and completes backfill after returning', async ({
      page,
      context,
      request,
    }) => {
      test.setTimeout(manualVisibilityTimeoutMs + 120000);
      const authHeader = basicAuthHeader(username, password);
      const sessionId = `manual-background-${Date.now()}`;
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

      await configureManualWebSyncSettings(context);
      await page.goto(`${uiBaseUrl}/linksites/airqr-encoder-linksite.html`);
      await seedRecoveredPacketSession(page, sessionId, manualPacketCount, manualPacketSize);

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
          message: 'manual background scenario should open the dedicated scan websocket',
        })
        .toBeGreaterThan(0);

      await expect
        .poll(() => scanFramesSent.length, {
          timeout: 20000,
          message: 'manual background scenario should start sending frames before backgrounding',
        })
        .toBeGreaterThan(10);

      const helperPage = await context.newPage();
      await setupHelperTab(helperPage, sessionId);
      await page.bringToFront();
      await resetVisibilityTimeline(page);

      const initialStatus = await fetchSessionStatus(request, sessionId, authHeader);
      console.log(
        `[manual] Click the "AirQR Manual Background Helper" tab now, keep it open for at least ${
          manualBackgroundMs / 1000
        }s, then click back to the original AirQR tab.`
      );
      console.log(
        `[manual] Session ${sessionId} currently has ${initialStatus.receivedCount}/${manualPacketCount} packets on the server.`
      );

      await setInstructionOverlay(page, [
        `Session: ${sessionId}`,
        'Click the browser tab named "AirQR Manual Background Helper".',
        `Keep the helper tab active for at least ${
          manualBackgroundMs / 1000
        } seconds.`,
        `Then click back here before the timeout (${manualVisibilityTimeoutMs / 1000} seconds total).`,
      ]);

      await expect
        .poll(
          async () => {
            const timeline = await getVisibilityTimeline(page);
            if (timeline.some((entry) => entry.state === 'hidden')) {
              return true;
            }
            const focusTimeline = await getFocusTimeline(page);
            return focusTimeline.some((entry) => entry.state === 'blurred');
          },
          {
            timeout: manualVisibilityTimeoutMs,
            message:
              'No real hidden or blur transition was observed. Click the "AirQR Manual Background Helper" tab now.',
          }
        )
        .toBe(true);

      await setInstructionOverlay(page, [
        `Hidden transition observed for ${sessionId}.`,
        `Keep the helper tab active for at least ${manualBackgroundMs / 1000} seconds.`,
        'Then click back to this AirQR tab to let the backfill finish.',
      ]);

      await expect
        .poll(
          async () => {
            const visibilityTimeline = await getVisibilityTimeline(page);
            const focusTimeline = await getFocusTimeline(page);
            return Math.max(
              getObservedHiddenDurationMs(visibilityTimeline),
              getObservedBlurDurationMs(focusTimeline)
            );
          },
          {
            timeout: manualVisibilityTimeoutMs,
            message:
              'Return to the original AirQR tab after the requested helper-tab interval so the background interval can be observed.',
          }
        )
        .toBeGreaterThanOrEqual(manualBackgroundMs);

      const visibilityTimeline = await getVisibilityTimeline(page);
      const focusTimeline = await getFocusTimeline(page);
      const hiddenDurationMs = getObservedHiddenDurationMs(visibilityTimeline);
      const blurDurationMs = getObservedBlurDurationMs(focusTimeline);
      const observedDurationMs = Math.max(hiddenDurationMs, blurDurationMs);
      const observedMode =
        hiddenDurationMs >= blurDurationMs && hiddenDurationMs > 0
          ? 'visibilitychange'
          : 'blur/focus';
      console.log(`[manual] Visibility timeline: ${JSON.stringify(visibilityTimeline)}`);
      console.log(`[manual] Focus timeline: ${JSON.stringify(focusTimeline)}`);
      console.log(
        `[manual] Observed background interval via ${observedMode}: ${Math.round(
          observedDurationMs / 1000
        )}s`
      );

      await setInstructionOverlay(
        page,
        [
          `Background interval observed via ${observedMode}: ${Math.round(
            observedDurationMs / 1000
          )} seconds.`,
          'Keep the page visible while the remaining packets finish uploading.',
        ],
        'success'
      );

      await expect
        .poll(async () => (await fetchSessionStatus(request, sessionId, authHeader)).receivedCount, {
          timeout: 60000,
          message: 'real backgrounded backfill should complete after returning to the foreground',
        })
        .toBe(manualPacketCount);

      await expect
        .poll(() => scanFramesSent.length, {
          timeout: 10000,
          message:
            'manual background scenario should transmit many frames across the real visibility cycle',
        })
        .toBeGreaterThan(manualPacketCount / 2);

      console.log(
        `[manual] Session ${sessionId} completed successfully after the real background cycle.`
      );

      await helperPage.close();
    });
  });
}

export default { registerManualBackgroundVisibilityTests };
