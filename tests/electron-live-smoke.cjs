'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, ipcMain } = require('electron');
const { TOKEN_HEADER, shouldInjectToken, startLocalServer } = require('../electron/local-server');

const appRoot = path.resolve(__dirname, '..');
const smokeUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'espide-electron-smoke-'));
const token = crypto.randomBytes(16).toString('hex');
let localServer = null;

app.setPath('userData', smokeUserData);
ipcMain.on('espide:legacy-storage-read', (event) => { event.returnValue = null; });
ipcMain.on('espide:legacy-storage-confirmed', () => {});

function unauthenticatedStatus(origin) {
  return new Promise((resolve, reject) => {
    const request = http.get(`${origin}/esp_ide_v2/index.html`, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
    });
    request.once('error', reject);
  });
}

function createTestWindow() {
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(appRoot, 'preload.js'),
      sandbox: false,
    },
  });
  window.webContents.on('console-message', (_event, _level, message, line, sourceId) => {
    if (/Simulator Lite:|ERR_|Uncaught/i.test(message)) {
      process.stderr.write(`ESPIDE_ELECTRON_SMOKE console ${sourceId}:${line} ${message}\n`);
    }
  });
  window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
    process.stderr.write(`ESPIDE_ELECTRON_SMOKE load ${code} ${description} ${url} main=${isMainFrame}\n`);
  });
  return window;
}

function collectLegacyStorageProbe() {
  return new Promise((resolve, reject) => {
    const legacyUrl = pathToFileURL(path.join(appRoot, 'index.html')).href;
    const legacyWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(appRoot, 'electron', 'legacy-storage-preload.js'),
        sandbox: false,
      },
    });
    const timer = setTimeout(() => {
      legacyWindow.destroy();
      reject(new Error('Legacy storage preload timeout'));
    }, 5000);
    ipcMain.once('espide:legacy-storage-export', (event, values) => {
      clearTimeout(timer);
      const result = { senderUrl: event.sender.getURL(), values };
      legacyWindow.destroy();
      resolve({ expectedUrl: legacyUrl, ...result });
    });
    legacyWindow.loadURL(legacyUrl).catch((error) => {
      clearTimeout(timer);
      legacyWindow.destroy();
      reject(error);
    });
  });
}

async function probePickerLocalization() {
  async function loadPicker(filename, preload, language, expression) {
    const picker = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(appRoot, preload),
        sandbox: false,
      },
    });
    try {
      await picker.loadFile(path.join(appRoot, filename), { query: { lang: language } });
      return await picker.webContents.executeJavaScript(expression);
    } finally {
      picker.destroy();
    }
  }

  const usbCs = await loadPicker(
    'portPicker.html',
    'pickerPreload.js',
    'cs-CZ',
    `({ lang: document.documentElement.lang, title: document.title, close: document.getElementById('closeBtn').textContent })`,
  );
  const bluetoothDe = await loadPicker(
    'btPicker.html',
    'btPickerPreload.js',
    'de-DE',
    `({ lang: document.documentElement.lang, title: document.title, close: document.getElementById('closeBtn').textContent, loading: document.getElementById('loadingText').textContent })`,
  );
  const fallbackEn = await loadPicker(
    'btPicker.html',
    'btPickerPreload.js',
    'fr-FR',
    `({ lang: document.documentElement.lang, title: document.title })`,
  );
  return { bluetoothDe, fallbackEn, usbCs };
}

async function waitForIde(window, appUrl) {
  await window.loadURL(appUrl);
  await window.webContents.executeJavaScript(`(async () => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (typeof ensureSimulatorBridge === 'function' && window.__espideI18n) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('ESP IDE startup timeout');
  })()`);
}

async function run() {
  await app.whenReady();
  localServer = await startLocalServer({
    ideRoot: appRoot,
    port: 0,
    simulatorRoot: path.join(appRoot, 'simulator_lite'),
    token,
  });
  const appUrl = `${localServer.origin}/esp_ide_v2/index.html`;
  const requestFilter = { urls: [`${localServer.origin}/*`] };
  const firstWindow = createTestWindow();
  firstWindow.webContents.session.webRequest.onBeforeSendHeaders(requestFilter, (details, callback) => {
    const requestHeaders = { ...details.requestHeaders };
    if (shouldInjectToken(details, localServer.origin, appUrl)) requestHeaders[TOKEN_HEADER] = token;
    callback({ requestHeaders });
  });

  const legacyProbe = await collectLegacyStorageProbe();
  assert.equal(legacyProbe.senderUrl, legacyProbe.expectedUrl);
  assert.equal(typeof legacyProbe.values, 'object');
  const pickerProbe = await probePickerLocalization();
  assert.deepEqual(pickerProbe.usbCs, { lang: 'cs', title: 'Vyberte USB zařízení', close: 'Zavřít' });
  assert.deepEqual(pickerProbe.bluetoothDe, {
    lang: 'de',
    title: 'Bluetooth-Gerät auswählen',
    close: 'Schließen',
    loading: 'Geräte werden gesucht…',
  });
  assert.deepEqual(pickerProbe.fallbackEn, { lang: 'en', title: 'Select Bluetooth device' });
  assert.equal(await unauthenticatedStatus(localServer.origin), 403);
  await waitForIde(firstWindow, appUrl);
  const result = await firstWindow.webContents.executeJavaScript(`(async () => {
    const testWorker = (url, type) => new Promise((resolve) => {
      const worker = new Worker(url, type ? { type } : undefined);
      const timer = setTimeout(() => {
        worker.terminate();
        resolve({ timeout: true });
      }, 5000);
      worker.onmessage = (event) => {
        clearTimeout(timer);
        worker.terminate();
        resolve(event.data);
      };
      worker.onerror = (event) => {
        clearTimeout(timer);
        worker.terminate();
        resolve({ error: event.message || 'empty Worker error' });
      };
    });
    const probeUrl = new URL('./tests/electron-worker-probe.js', location.href).href;
    const probes = {
      classic: await testWorker(probeUrl),
      module: await testWorker(probeUrl, 'module'),
    };
    const settings = JSON.parse(localStorage.getItem('userSettings') || '{}');
    const bridge = await ensureSimulatorBridge();
    await bridge.activate();
    const frame = bridge.frame;
    await bridge.enterRawREPL();
    const raw = await bridge.execRawCommand("print('ELECTRON_SMOKE_OK')");
    await bridge.exitRawREPL();
    return {
      frameIsolated: frame.contentWindow.crossOriginIsolated,
      frameUrl: frame.src,
      isSecureContext,
      language: settings.language,
      location: location.href,
      parentIsolated: crossOriginIsolated,
      probes,
      raw,
    };
  })()`);

  assert.equal(result.location, appUrl);
  assert.equal(result.language, 'en');
  assert.equal(result.isSecureContext, true);
  assert.equal(result.parentIsolated, true);
  assert.equal(result.frameIsolated, true);
  assert.equal(new URL(result.frameUrl).origin, localServer.origin);
  assert.equal(new URL(result.frameUrl).pathname, '/simulator_lite/index.html');
  assert.equal(result.probes.classic.ok, true);
  assert.equal(result.probes.module.ok, true);
  assert.match(result.raw, /ELECTRON_SMOKE_OK/);

  await firstWindow.webContents.executeJavaScript(`(() => {
    const settings = JSON.parse(localStorage.getItem('userSettings') || '{}');
    settings.language = 'cs';
    localStorage.setItem('userSettings', JSON.stringify(settings));
  })()`);
  const secondWindow = createTestWindow();
  firstWindow.destroy();

  await waitForIde(secondWindow, appUrl);
  const persistedLanguage = await secondWindow.webContents.executeJavaScript(
    `JSON.parse(localStorage.getItem('userSettings') || '{}').language`,
  );
  assert.equal(persistedLanguage, 'cs');
  secondWindow.destroy();

  process.stdout.write(`ESPIDE_ELECTRON_SMOKE ${JSON.stringify({ ...result, persistedLanguage, pickerProbe, unauthenticatedStatus: 403 })}\n`);
}

const watchdog = setTimeout(() => {
  process.stderr.write('ESPIDE_ELECTRON_SMOKE timeout\n');
  app.exit(1);
}, 60000);

run()
  .then(async () => {
    clearTimeout(watchdog);
    if (localServer) await localServer.close();
    app.exit(0);
  })
  .catch(async (error) => {
    clearTimeout(watchdog);
    process.stderr.write(`${error && error.stack ? error.stack : error}\n`);
    if (localServer) await localServer.close();
    app.exit(1);
  });

process.once('exit', () => {
  try { fs.rmSync(smokeUserData, { force: true, recursive: true }); } catch (_) {}
});
