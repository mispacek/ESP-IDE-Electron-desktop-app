// --- kousek na začátku main.js ---
const { app, BrowserWindow, dialog, ipcMain, session, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
  LOOPBACK_PORT,
  TOKEN_HEADER,
  shouldInjectToken,
  startLocalServer,
} = require('./local-server');
const { normalizeLanguage: normalizePickerLanguage } = require('../ui/pickers/picker-i18n');
const { createRuntimePaths } = require('./runtime-paths');
const { installNavigationPolicy, installTrustedEmbedPolicy } = require('./external-content');

let mainWin;   // hlavní okno
let splash;    // splash screen

const SPLASH_MIN = 1500;          // ms – změň podle potřeby
let splashStart;                  // čas, kdy jsme splash otevřeli
let legacyStorageValues = null;
let legacyMigrationPending = false;
let localServer = null;
let localServerToken = null;
let isQuitting = false;
let startupInProgress = true;

const APP_ORIGIN = `http://127.0.0.1:${LOOPBACK_PORT}`;
const APP_URL = `${APP_ORIGIN}/esp_ide_v2/index.html`;
const LEGACY_MIGRATION_MARKER = 'espide-legacy-file-storage-v1.json';
const LEGACY_MIGRATION_TIMEOUT_MS = 2000;
const runtimePaths = createRuntimePaths({ app, mainDirectory: __dirname, resourcesPath: process.resourcesPath });

async function getCurrentPickerLanguage() {
  if (!mainWin || mainWin.isDestroyed() || mainWin.webContents.isDestroyed()) return 'en';
  try {
    const language = await mainWin.webContents.executeJavaScript(`(() => {
      const active = window.__espideI18n && window.__espideI18n.language;
      if (typeof active === 'string' && active.trim()) return active;
      try {
        const settings = JSON.parse(localStorage.getItem('userSettings') || '{}');
        return settings && settings.language;
      } catch (_) {
        return null;
      }
    })()`);
    return normalizePickerLanguage(language);
  } catch (_) {
    return 'en';
  }
}

async function loadLocalizedPicker(pickerWindow, filename) {
  const language = await getCurrentPickerLanguage();
  if (!pickerWindow || pickerWindow.isDestroyed()) return;
  await pickerWindow.loadFile(filename, { query: { lang: language } });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();

app.on('second-instance', () => {
  if (!mainWin || mainWin.isDestroyed()) return;
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.focus();
});


if (process.platform === 'linux') {
  // vypne Chromium sandbox globálně
  app.commandLine.appendSwitch('no-sandbox') // --no-sandbox
  // zruší blok-list, aby WebSerial viděl všechna zařízení
  app.commandLine.appendSwitch('disable-serial-blocklist')
  // pojistka: totéž přes proměnnou prostředí
  process.env.ELECTRON_DISABLE_SANDBOX = 'true'
}


function createWindow () {

  // splash window (pouze pro splash můžeme povolit nodeIntegration)
  splash = new BrowserWindow({
      width: 420, height: 300,
      frame: false,
      transparent: true,        // ↔ aby průhlednost fungovala
      alwaysOnTop: true,
      resizable: false,
      skipTaskbar: true,
      webPreferences: {
        sandbox: false,         // renderer bez sandboxu
        nodeIntegration: true,  // dovolí require('electron') v splash.html
        contextIsolation: false
      }
    });
  splash.loadFile(runtimePaths.splashHtml);
  splashStart = Date.now();       // zapamatuj start

  // 2) HLAVNÍ OKNO (původní kód, ale show:false)
  mainWin = new BrowserWindow({
    width: 1280, height: 800,
    icon: runtimePaths.appIcon,
    show: false,                    // *** důležité ***
    webPreferences: {
      preload: runtimePaths.mainPreload,
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWin.setMenu(null);

  installNavigationPolicy(mainWin.webContents, APP_ORIGIN, (url) => shell.openExternal(url));

  // ▼ WebSerial API – zapnout v Chromium engine
  app.commandLine.appendSwitch('enable-experimental-web-platform-features');
  app.commandLine.appendSwitch('enable-blink-features', 'Serial');

  const ses = mainWin.webContents.session;
  installTrustedEmbedPolicy(ses, () => mainWin && !mainWin.isDestroyed() ? mainWin.webContents.id : -1);

  // ▼ Povolit Serial oprávnění pro file:// + vlastní picker
  ses.setPermissionCheckHandler((_wc, permission) => permission === 'serial');
  ses.setDevicePermissionHandler(() => true);

 

 
    // ---- BLE picker window ----
    let bleCb = null;
    let blePickerWin = null;
    const bleDevices = new Map();

    // nahraď svou openBlePicker():
    function openBlePicker() {
      if (blePickerWin && !blePickerWin.isDestroyed()) return;

      const { BrowserWindow } = require('electron');
      const parent = mainWin; // stejný rodič jako portPicker
      const { x: baseX, y: baseY } = parent.getBounds(); // pozicionování jako u portPickeru

      blePickerWin = new BrowserWindow({
        parent,
        modal: false,
        width: 420,
        height: 400,
        x: baseX + 350,
        y: baseY + 120,
        resizable: false,
        frame: false,             // bez rámečku
        show: false,              // zobraz až po načtení
        skipTaskbar: true,
        backgroundColor: '#ffffff',
        webPreferences: {
          contextIsolation: true,
          sandbox: false,
          nodeIntegration: false,
          preload: runtimePaths.bluetoothPickerPreload
        }
      });

      void loadLocalizedPicker(blePickerWin, runtimePaths.bluetoothPickerHtml);
      blePickerWin.once('ready-to-show', () => blePickerWin.show());

      blePickerWin.on('closed', () => {
        if (bleCb) { bleCb(''); bleCb = null; }  // zruš výběr, pokud nic nevybral
        blePickerWin = null;
        bleDevices.clear();
      });

      // po načtení pošli aktuální seznam
      blePickerWin.webContents.once('did-finish-load', () => emitBleDevicesToPicker());
    }


    function emitBleDevicesToPicker() {
      if (blePickerWin && !blePickerWin.isDestroyed()) {
        const list = Array.from(bleDevices.values());
        blePickerWin.webContents.send('ble-devices', list);
      }
    }

    // Chromium BLE chooser → přesměruj do našeho okna
    mainWin.webContents.on('select-bluetooth-device', (event, devices, callback) => {
      event.preventDefault();
      bleCb = callback;
      openBlePicker();

      // inicializuj seznam
      bleDevices.clear();
      for (const d of devices) {
        bleDevices.set(d.deviceId, {
          id: d.deviceId,
          name: d.deviceName || '',
          rssi: typeof d.rssi === 'number' ? d.rssi : null
        });
      }
      emitBleDevicesToPicker();
    });

    // doplňování během skenu
    mainWin.webContents.on('bluetooth-device-added', (_e, d) => {
      bleDevices.set(d.deviceId, {
        id: d.deviceId,
        name: d.deviceName || '',
        rssi: typeof d.rssi === 'number' ? d.rssi : null
      });
      emitBleDevicesToPicker();
    });

    mainWin.webContents.on('bluetooth-device-changed', (_e, details) => {
      // některé platformy sem hlásí zrušení systémového chooseru; náš picker řídíme sami
    });

    // volba z pickeru
    const { ipcMain } = require('electron');
    ipcMain.on('ble-picker-choose', (_e, deviceId) => {
      if (bleCb) { bleCb(deviceId || ''); bleCb = null; }
      if (blePickerWin && !blePickerWin.isDestroyed()) blePickerWin.close();
    });
    ipcMain.on('ble-picker-cancel', () => {
      if (bleCb) { bleCb(''); bleCb = null; }
      if (blePickerWin && !blePickerWin.isDestroyed()) blePickerWin.close();
    });
  
  //*****************
  //** F12 - Debug **
  //*****************
  mainWin.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') mainWin.webContents.toggleDevTools();
  });
  
  
  
  // ⚑ vlastní volba portu
    ses.on('select-serial-port',
      (event, portList, webContents, callback) => {

      event.preventDefault();

      // 0 / 1 port rychle:
      if (!portList.length)      { callback('');          return; }
      if (portList.length === 1) { callback(portList[0].portId); return; }

      // ── víc portů ➜ naše modální okno ───────────────
      
      const parent = BrowserWindow.fromWebContents(webContents);
      const { x: baseX, y: baseY } = parent.getBounds();      // ❶ rám okna v DIP
      const picker = new BrowserWindow({
        parent,                   // modální k rodiči
        modal:  false,
        width:  420,
        height: 400,
        x: baseX + 350,            // 250 px vpravo
        y: baseY + 120,            // 100 px dolů
        resizable: false,
        frame: false,             // bez systémového title-baru
        show: false,              // zobraz až bude připraveno
        webPreferences: {
          preload: runtimePaths.usbPickerPreload,
          sandbox: false,
          contextIsolation: true,
          nodeIntegration: false
        }
      });

      void loadLocalizedPicker(picker, runtimePaths.usbPickerHtml);
      picker.once('ready-to-show', () => picker.show());

      // ➜ Pošli seznam portů do rendereru
      picker.webContents.once('did-finish-load',
        () => picker.webContents.send('ports', portList));

      // ➜ Čekej na odpověď z rendereru
      ipcMain.once('port-chosen', (_e, portId) => {
        callback(portId || portList[0].portId); // vždy zavolej
        picker.close();
      });
    });
  
 

  // načti UI z interního, standardního originu namísto file://.
  mainWin.loadURL(APP_URL);
  
  // 3) Po načtení hlavního okna počkej, dokud neuplyne SPLASH_MIN
  mainWin.once('ready-to-show', () => {
    const elapsed = Date.now() - splashStart;
    const wait    = Math.max(SPLASH_MIN - elapsed, 0);

    setTimeout(() => {
      splash?.destroy();          // zavři splash
      mainWin.show();             // ukaž appku
    }, wait);
  });
}

ipcMain.handle('dialog-message', async (_evt, opts) => {
  const win = BrowserWindow.getFocusedWindow();
  return dialog.showMessageBox(win, opts);
});

function legacyMigrationMarkerPath() {
  return path.join(app.getPath('userData'), LEGACY_MIGRATION_MARKER);
}

async function hasLegacyMigrationMarker() {
  try {
    await fs.access(legacyMigrationMarkerPath());
    return true;
  } catch (_) {
    return false;
  }
}

async function collectLegacyStorageOnce() {
  if (await hasLegacyMigrationMarker()) return;
  const legacyUrl = pathToFileURL(runtimePaths.legacyIndex).toString();
  await new Promise((resolve) => {
    let finished = false;
    let migrationWindow;
    const done = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      ipcMain.removeListener('espide:legacy-storage-export', receiveStorage);
      if (migrationWindow && !migrationWindow.isDestroyed()) migrationWindow.destroy();
      resolve();
    };
    const receiveStorage = (event, values) => {
      if (!migrationWindow || event.sender.id !== migrationWindow.webContents.id || event.sender.getURL() !== legacyUrl) return;
      if (values && typeof values === 'object' && !Array.isArray(values)) {
        legacyStorageValues = values;
        legacyMigrationPending = true;
      }
      done();
    };
    const timeout = setTimeout(done, LEGACY_MIGRATION_TIMEOUT_MS);
    ipcMain.once('espide:legacy-storage-export', receiveStorage);
    try {
      migrationWindow = new BrowserWindow({
        show: false,
        webPreferences: {
          contextIsolation: true,
          nodeIntegration: false,
          preload: runtimePaths.legacyStoragePreload,
          sandbox: false,
        },
      });
      migrationWindow.webContents.once('did-fail-load', done);
      migrationWindow.loadURL(legacyUrl).catch(done);
    } catch (_) {
      done();
    }
  });
}

async function startDesktopServer() {
  // Kept only in process memory. The token is never persisted or logged.
  localServerToken = crypto.randomBytes(16).toString('hex');
  try {
    localServer = await startLocalServer({
      ideRoot: runtimePaths.ideRoot,
      simulatorRoot: runtimePaths.simulatorRoot,
      token: localServerToken,
    });
  } catch (error) {
    localServerToken = null;
    dialog.showErrorBox('ESP IDE could not start', `The local IDE server on port ${LOOPBACK_PORT} is unavailable.\n\n${error.code || error.message || 'Unknown error'}`);
    app.quit();
    return false;
  }
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [`${APP_ORIGIN}/*`] }, (details, callback) => {
    if (!shouldInjectToken(details, APP_ORIGIN, APP_URL)) {
      callback({ requestHeaders: details.requestHeaders });
      return;
    }
    callback({
      requestHeaders: {
        ...details.requestHeaders,
        [TOKEN_HEADER]: localServerToken,
      },
    });
  });
  const failClosed = (error) => {
    if (isQuitting) return;
    dialog.showErrorBox('ESP IDE local server stopped', error?.message || 'The local IDE server stopped unexpectedly.');
    if (mainWin && !mainWin.isDestroyed()) mainWin.destroy();
    app.quit();
  };
  localServer.server.once('error', failClosed);
  localServer.server.once('close', () => failClosed(new Error('The local IDE server stopped unexpectedly.')));
  return true;
}

ipcMain.on('espide:legacy-storage-read', (event) => {
  // Only the main ESP IDE renderer may receive the legacy payload.
  event.returnValue = mainWin && event.sender.id === mainWin.webContents.id
    ? legacyStorageValues
    : null;
});

ipcMain.on('espide:legacy-storage-confirmed', (event, result) => {
  if (!legacyMigrationPending || !mainWin || event.sender.id !== mainWin.webContents.id || !result || result.success !== true) return;
  // The marker is deliberately written only after the custom-origin preload
  // confirms it imported data or safely preserved already-populated storage.
  fs.writeFile(legacyMigrationMarkerPath(), JSON.stringify({ migratedAt: new Date().toISOString() }), 'utf8')
    .then(() => { legacyMigrationPending = false; legacyStorageValues = null; })
    .catch(() => {});
});

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;
  if (!await startDesktopServer()) return;
  // A failed, disabled or slow legacy document never prevents startup.
  await collectLegacyStorageOnce();
  try {
    createWindow();
  } catch (error) {
    dialog.showErrorBox('ESP IDE could not start', error?.message || 'The main window could not be created.');
    app.quit();
  } finally {
    startupInProgress = false;
  }
});
app.on('before-quit', () => {
  isQuitting = true;
  if (localServer) void localServer.close();
});
app.on('window-all-closed', () => {
  if (!startupInProgress && process.platform !== 'darwin') app.quit();
});
