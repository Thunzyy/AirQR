const uiBaseUrl = process.env.AIRQR_UI_BASE_URL || 'https://localhost:5173';
const apiBaseUrl = process.env.AIRQR_API_BASE_URL || uiBaseUrl;
const username = process.env.AIRQR_USERNAME || 'admin';
const password = process.env.AIRQR_PASSWORD || 'admin';

const webActor = {
  deviceName: 'iOS Browser E2E',
  deviceId: 'ios-browser-e2e',
};

const flutterActor = {
  deviceName: 'Android Flutter E2E',
  deviceId: 'android-flutter-e2e',
};

function basicAuthHeader(user, pass) {
  const token = Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

function packetBytes(index, size = 810) {
  const seed = Buffer.from(`pkt-${index}-web-ui-realtime`, 'utf8');
  const output = Buffer.alloc(size);
  for (let i = 0; i < size; i += seed.length) {
    seed.copy(output, i);
  }
  return output;
}

async function uploadPacket(api, expect, authHeader, args) {
  const payload = {
    sessionId: args.sessionId,
    packetBase64: packetBytes(args.packetIndex).toString('base64'),
    expectedPackets: args.expectedPackets,
    totalPackets: args.expectedPackets,
    receivedPackets: 0,
    filename: 'cross-device-realtime.bin',
    deviceName: args.actor.deviceName,
    deviceId: args.actor.deviceId,
    isStreaming: false,
  };
  const resp = await api.post(`${apiBaseUrl}/api/scan/packet`, {
    headers: {
      Authorization: authHeader,
    },
    data: payload,
  });
  expect(resp.ok()).toBeTruthy();
  const body = await resp.json();
  expect(body.ok).toBeTruthy();
}

async function uploadRange(api, expect, authHeader, args) {
  let lastIndex = args.fromIndex;
  for (let i = 0; i < args.count; i += 1) {
    await uploadPacket(api, expect, authHeader, {
      sessionId: args.sessionId,
      expectedPackets: args.expectedPackets,
      packetIndex: args.fromIndex + i,
      actor: args.actor,
    });
    lastIndex = args.fromIndex + i;
  }
  return lastIndex + 1;
}

async function completeSession(api, expect, authHeader, sessionId, actor) {
  const fileBytes = Buffer.from(`complete-${sessionId}-${actor.deviceId}`, 'utf8');
  const params = new URLSearchParams({
    sessionId,
    filename: 'cross-device-realtime-complete.bin',
    fileSize: String(fileBytes.length),
    mimeType: 'application/octet-stream',
    deviceName: actor.deviceName,
    deviceId: actor.deviceId,
    duration: '1',
    completedAt: new Date().toISOString(),
  });
  const resp = await api.post(`${apiBaseUrl}/api/scan/complete?${params.toString()}`, {
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/octet-stream',
    },
    data: fileBytes,
  });
  expect(resp.ok()).toBeTruthy();
  const body = await resp.json();
  expect(body.ok).toBeTruthy();
}

async function fetchSession(api, expect, authHeader, sessionId) {
  const resp = await api.get(`${apiBaseUrl}/api/scan/session/${sessionId}`, {
    headers: {
      Authorization: authHeader,
    },
  });
  expect(resp.ok()).toBeTruthy();
  const body = await resp.json();
  return {
    receivedCount: Number(body.receivedCount ?? body.receivedPackets ?? body.packetCount ?? 0),
    expectedPackets: Number(body.expectedPackets ?? body.totalPackets ?? 0),
    completed: Boolean(body.completed) || String(body.status || '').toLowerCase() === 'complete',
  };
}

async function configureWebSyncSettings(context) {
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
    },
    { serverUrl: apiBaseUrl, user: username, pass: password },
  );
}

async function configureCookieOnlySyncSettings(context) {
  await context.addInitScript(
    ({ serverUrl }) => {
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
            username: '',
            password: '',
            syncScanned: true,
            syncGenerated: true,
            autoSyncHistory: true,
          },
        },
        version: 0,
      };
      localStorage.setItem('airqr_settings', JSON.stringify(persisted));
      localStorage.setItem('airqr_language', 'en');
    },
    { serverUrl: uiBaseUrl },
  );
}

async function createAuthenticatedStorageState(browser, expect) {
  const bootstrapContext = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const response = await bootstrapContext.request.post(`${uiBaseUrl}/api/auth/login`, {
      headers: {
        'Content-Type': 'application/json',
        'X-AirQR-CSRF': '1',
      },
      data: {
        username,
        password,
        remember: true,
      },
    });
    expect(response.ok()).toBeTruthy();
    return await bootstrapContext.storageState();
  } finally {
    await bootstrapContext.close();
  }
}

async function queueBrowserScanPackets(page, {
  sessionId,
  chunkId,
  packetCount,
  expectedPackets,
  totalPackets,
}) {
  return page.evaluate(
    async ({ sessionId, chunkId, packetCount, expectedPackets, totalPackets }) => {
      const authModule = await import('/src/services/serverAuth.ts');
      authModule.resetServerAuthStatusCache();
      const wsModule = await import('/src/services/scanWebSocketSyncService.ts');
      wsModule.resetScanWebSocketSyncService();
      const uploadModule = await import('/src/services/scanUploadService.ts');
      const diagnosticsModule = await import('/src/services/multiScanDiagnostics.ts');

      const config = {
        enabled: true,
        url: window.location.origin,
        apiKey: '',
        username: '',
        password: '',
        syncScanned: true,
        syncGenerated: true,
        autoSyncHistory: true,
      };

      const buildPacket = (targetChunkId, packetIndex) => {
        const packetSize = 835;
        const totalChunks = 3;
        const totalSize = 250500;
        const body = new Uint8Array(packetSize);
        const seed = new TextEncoder().encode(`playwright-${targetChunkId}-${packetIndex}`);
        for (let i = 0; i < body.length; i += 1) {
          body[i] = seed[i % seed.length];
        }

        const payload = new Uint8Array(35 + packetSize);
        const view = new DataView(payload.buffer);
        let offset = 0;
        view.setUint8(offset, 2); offset += 1;
        view.setUint32(offset, Number(sessionId), false); offset += 4;
        view.setUint32(offset, targetChunkId, false); offset += 4;
        view.setUint32(offset, totalChunks, false); offset += 4;
        view.setBigUint64(offset, 0n, false); offset += 8;
        view.setUint32(offset, totalSize, false); offset += 4;
        view.setUint16(offset, packetSize, false); offset += 2;
        view.setUint32(offset, totalPackets, false); offset += 4;
        view.setUint32(offset, packetIndex, false); offset += 4;
        payload.set(body, offset);
        return payload;
      };

      for (let index = 0; index < packetCount; index += 1) {
        uploadModule.queueScanPacket(
          buildPacket(chunkId, index),
          {
            sessionId,
            filename: 'playwright-browser-realtime.bin',
            isStreaming: true,
            packetIndex: index,
            chunkId,
            totalChunks: 3,
            expectedPackets,
            totalPackets,
            totalPacketsExact: true,
          },
          config,
        );
      }

      const samples = [];
      for (let sampleIndex = 0; sampleIndex < 4; sampleIndex += 1) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        samples.push(
          await diagnosticsModule.captureMultiScanDiagnosticsSnapshot({
            config,
            sessionId,
          })
        );
      }
      return {
        authStatus: await fetch('/api/auth/status', {
          credentials: 'same-origin',
        }).then((response) => response.json()),
        samples,
      };
    },
    {
      sessionId,
      chunkId,
      packetCount,
      expectedPackets,
      totalPackets,
    },
  );
}

async function captureBrowserDiagnostics(page, sessionId) {
  return page.evaluate(async ({ sessionId }) => {
    const diagnosticsModule = await import('/src/services/multiScanDiagnostics.ts');
    return diagnosticsModule.captureMultiScanDiagnosticsSnapshot({ sessionId });
  }, { sessionId });
}

async function openHistoryAndResume(page, expect, sessionId) {
  await page.goto(`${uiBaseUrl}/history`);
  const resumeButton = page.locator(`[data-testid="history-resume-${sessionId}"]`);
  await expect(resumeButton).toBeVisible({ timeout: 30000 });
  await resumeButton.click();
}

async function assertScannerCounts(page, expect, scanned, expectedMin) {
  const scannedCounter = page.getByTestId('scanner-stat-scanned');
  const minCounter = page.getByTestId('scanner-stat-min');
  await expect.poll(
    async () => Number((await scannedCounter.textContent())?.trim() || '0'),
    { timeout: 25000, message: `scanner should show scanned=${scanned}` },
  ).toBe(scanned);
  await expect.poll(
    async () => Number((await minCounter.textContent())?.trim() || '0'),
    { timeout: 10000, message: `scanner should show min=${expectedMin}` },
  ).toBe(expectedMin);
}

async function assertServerReceived(api, expect, authHeader, sessionId, expectedReceived) {
  await expect.poll(
    async () => (await fetchSession(api, expect, authHeader, sessionId)).receivedCount,
    { timeout: 20000, message: `server session should reach received=${expectedReceived}` },
  ).toBe(expectedReceived);
}

async function assertServerChunkCounts(api, expect, authHeader, sessionId, expectedCounts) {
  await expect.poll(
    async () => {
      const response = await api.get(`${apiBaseUrl}/api/scan/session/${sessionId}`, {
        headers: {
          Authorization: authHeader,
        },
      });
      expect(response.ok()).toBeTruthy();
      const body = await response.json();
      const chunkStates = Array.isArray(body.chunkStates) ? body.chunkStates : [];
      return Object.fromEntries(
        chunkStates.map((chunk) => [
          String(chunk.chunkId),
          Number(chunk.receivedCount ?? 0),
        ]),
      );
    },
    {
      timeout: 20000,
      message: `server session should expose chunk counts ${JSON.stringify(expectedCounts)}`,
    },
  ).toEqual(expectedCounts);
}

async function runResumeFlow(page, context, api, expect, authHeader, args) {
  let packetIndex = 0;
  let received = 0;

  const [initialBlock, ...resumeBlocks] = args.blocks;
  packetIndex = await uploadRange(api, expect, authHeader, {
    sessionId: args.sessionId,
    expectedPackets: args.expectedPackets,
    fromIndex: packetIndex,
    count: initialBlock.count,
    actor: initialBlock.actor,
  });
  received += initialBlock.count;

  await configureWebSyncSettings(context);
  await openHistoryAndResume(page, expect, args.sessionId);
  await assertScannerCounts(page, expect, received, args.expectedPackets);
  await assertServerReceived(api, expect, authHeader, args.sessionId, received);

  for (const block of resumeBlocks) {
    packetIndex = await uploadRange(api, expect, authHeader, {
      sessionId: args.sessionId,
      expectedPackets: args.expectedPackets,
      fromIndex: packetIndex,
      count: block.count,
      actor: block.actor,
    });
    received += block.count;

    await assertScannerCounts(page, expect, received, args.expectedPackets);
    const syncSource = page.getByTestId('scanner-sync-source');
    await expect(syncSource).toContainText(block.actor.deviceName);
    await assertServerReceived(api, expect, authHeader, args.sessionId, received);
  }
}

export function registerRealtimeCrossDeviceTests({ test, expect }) {
  test.describe('Realtime Cross-Device Scanner UI', () => {
    test('web init -> flutter resume', async ({ page, context, request }, testInfo) => {
      test.setTimeout(120000);
      const authHeader = basicAuthHeader(username, password);
      const sessionId = `${Date.now()}01`;
      const expectedPackets = 86;

      await runResumeFlow(page, context, request, expect, authHeader, {
        sessionId,
        expectedPackets,
        blocks: [
          { actor: webActor, count: 12 },
          { actor: flutterActor, count: 8 },
        ],
      });

      await testInfo.attach('scenario.txt', {
        body: Buffer.from('web init -> flutter resume', 'utf8'),
        contentType: 'text/plain',
      });
    });

    test('flutter init -> web resume', async ({ page, context, request }, testInfo) => {
      test.setTimeout(120000);
      const authHeader = basicAuthHeader(username, password);
      const sessionId = `${Date.now()}02`;
      const expectedPackets = 86;

      await runResumeFlow(page, context, request, expect, authHeader, {
        sessionId,
        expectedPackets,
        blocks: [
          { actor: flutterActor, count: 10 },
          { actor: webActor, count: 9 },
        ],
      });

      await testInfo.attach('scenario.txt', {
        body: Buffer.from('flutter init -> web resume', 'utf8'),
        contentType: 'text/plain',
      });
    });

    test('web -> flutter -> web roundtrip', async ({ page, context, request }, testInfo) => {
      test.setTimeout(120000);
      const authHeader = basicAuthHeader(username, password);
      const sessionId = `${Date.now()}03`;
      const expectedPackets = 86;

      await runResumeFlow(page, context, request, expect, authHeader, {
        sessionId,
        expectedPackets,
        blocks: [
          { actor: webActor, count: 8 },
          { actor: flutterActor, count: 7 },
          { actor: webActor, count: 6 },
        ],
      });

      await testInfo.attach('scenario.txt', {
        body: Buffer.from('web -> flutter -> web', 'utf8'),
        contentType: 'text/plain',
      });
    });

    test('flutter -> web -> flutter roundtrip', async ({ page, context, request }, testInfo) => {
      test.setTimeout(120000);
      const authHeader = basicAuthHeader(username, password);
      const sessionId = `${Date.now()}04`;
      const expectedPackets = 86;

      await runResumeFlow(page, context, request, expect, authHeader, {
        sessionId,
        expectedPackets,
        blocks: [
          { actor: flutterActor, count: 8 },
          { actor: webActor, count: 7 },
          { actor: flutterActor, count: 6 },
        ],
      });

      await testInfo.attach('scenario.txt', {
        body: Buffer.from('flutter -> web -> flutter', 'utf8'),
        contentType: 'text/plain',
      });
    });

    test('completed session from web is not resumable', async ({ page, context, request }) => {
      test.setTimeout(120000);
      const authHeader = basicAuthHeader(username, password);
      const sessionId = `${Date.now()}05`;
      const expectedPackets = 86;
      await uploadRange(request, expect, authHeader, {
        sessionId,
        expectedPackets,
        fromIndex: 0,
        count: expectedPackets,
        actor: webActor,
      });
      await completeSession(request, expect, authHeader, sessionId, webActor);

      await expect
        .poll(async () => (await fetchSession(request, expect, authHeader, sessionId)).completed, {
          timeout: 15000,
          message: 'session should be completed after /api/scan/complete',
        })
        .toBe(true);

      await configureWebSyncSettings(context);
      await page.goto(`${uiBaseUrl}/history`);
      const resumeButton = page.locator(`[data-testid="history-resume-${sessionId}"]`);
      await expect.poll(async () => await resumeButton.count(), {
        timeout: 20000,
        message: 'completed session should not expose resume action',
      }).toBe(0);
    });

    test('completed session from flutter is not resumable', async ({ page, context, request }) => {
      test.setTimeout(120000);
      const authHeader = basicAuthHeader(username, password);
      const sessionId = `${Date.now()}06`;
      const expectedPackets = 86;
      await uploadRange(request, expect, authHeader, {
        sessionId,
        expectedPackets,
        fromIndex: 0,
        count: expectedPackets,
        actor: flutterActor,
      });
      await completeSession(request, expect, authHeader, sessionId, flutterActor);

      await expect
        .poll(async () => (await fetchSession(request, expect, authHeader, sessionId)).completed, {
          timeout: 15000,
          message: 'session should be completed after /api/scan/complete',
        })
        .toBe(true);

      await configureWebSyncSettings(context);
      await page.goto(`${uiBaseUrl}/history`);
      const resumeButton = page.locator(`[data-testid="history-resume-${sessionId}"]`);
      await expect.poll(async () => await resumeButton.count(), {
        timeout: 20000,
        message: 'completed session should not expose resume action',
      }).toBe(0);
    });

    test('cookie-only browser WS scan converges across two browser contexts and history resume reflects shared progress', async ({
      browser,
      request,
    }, testInfo) => {
      test.setTimeout(120000);
      test.skip(
        apiBaseUrl !== uiBaseUrl,
        'This browser transport test requires the same-origin UI proxy path.',
      );

      const authHeader = basicAuthHeader(username, password);
      const sessionId = `${Date.now()}07`;
      const expectedPackets = 1182;
      const chunkPacketTotal = 472;
      const authenticatedStorageState = await createAuthenticatedStorageState(browser, expect);

      const senderAContext = await browser.newContext({
        ignoreHTTPSErrors: true,
        storageState: authenticatedStorageState,
      });
      const senderBContext = await browser.newContext({
        ignoreHTTPSErrors: true,
        storageState: authenticatedStorageState,
      });
      const viewerContext = await browser.newContext({
        ignoreHTTPSErrors: true,
        storageState: authenticatedStorageState,
      });

      try {
        await Promise.all([
          configureCookieOnlySyncSettings(senderAContext),
          configureCookieOnlySyncSettings(senderBContext),
          configureCookieOnlySyncSettings(viewerContext),
        ]);

        const senderAPage = await senderAContext.newPage();
        const senderBPage = await senderBContext.newPage();
        const viewerPage = await viewerContext.newPage();

        await Promise.all([
          senderAPage.goto(`${uiBaseUrl}/`),
          senderBPage.goto(`${uiBaseUrl}/`),
        ]);

        const [senderADebug, senderBDebug] = await Promise.all([
          queueBrowserScanPackets(senderAPage, {
            sessionId,
            chunkId: 0,
            packetCount: 80,
            expectedPackets,
            totalPackets: chunkPacketTotal,
          }),
          queueBrowserScanPackets(senderBPage, {
            sessionId,
            chunkId: 1,
            packetCount: 80,
            expectedPackets,
            totalPackets: chunkPacketTotal,
          }),
        ]);

        await assertServerReceived(request, expect, authHeader, sessionId, 160);
        await assertServerChunkCounts(request, expect, authHeader, sessionId, {
          0: 80,
          1: 80,
        });
        const senderAFinalDiagnostics = await captureBrowserDiagnostics(senderAPage, sessionId);
        const senderBFinalDiagnostics = await captureBrowserDiagnostics(senderBPage, sessionId);
        expect(senderAFinalDiagnostics.server?.receivedCount).toBe(160);
        expect(senderBFinalDiagnostics.server?.receivedCount).toBe(160);
        expect(senderAFinalDiagnostics.transport).not.toBeNull();
        expect(senderBFinalDiagnostics.transport).not.toBeNull();

        await viewerPage.goto(`${uiBaseUrl}/history`);
        const resumeButton = viewerPage.locator(`[data-testid="history-resume-${sessionId}"]`);
        await expect(resumeButton).toBeVisible({ timeout: 30000 });
        await resumeButton.click();
        await assertScannerCounts(viewerPage, expect, 160, expectedPackets);
        const viewerDiagnostics = await captureBrowserDiagnostics(viewerPage, sessionId);

        await testInfo.attach('browser-ws-sender-a.json', {
          body: Buffer.from(JSON.stringify(senderADebug, null, 2), 'utf8'),
          contentType: 'application/json',
        });
        await testInfo.attach('browser-ws-sender-b.json', {
          body: Buffer.from(JSON.stringify(senderBDebug, null, 2), 'utf8'),
          contentType: 'application/json',
        });
        await testInfo.attach('browser-ws-sender-a-final.json', {
          body: Buffer.from(JSON.stringify(senderAFinalDiagnostics, null, 2), 'utf8'),
          contentType: 'application/json',
        });
        await testInfo.attach('browser-ws-sender-b-final.json', {
          body: Buffer.from(JSON.stringify(senderBFinalDiagnostics, null, 2), 'utf8'),
          contentType: 'application/json',
        });
        await testInfo.attach('browser-ws-viewer.json', {
          body: Buffer.from(JSON.stringify(viewerDiagnostics, null, 2), 'utf8'),
          contentType: 'application/json',
        });
      } finally {
        await Promise.allSettled([
          senderAContext.close(),
          senderBContext.close(),
          viewerContext.close(),
        ]);
      }
    });
  });
}

export default { registerRealtimeCrossDeviceTests };
