// --- kousek na začátku main.js ---
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('node:path');

let mainWin;   // hlavní okno
let splash;    // splash screen

const SPLASH_MIN = 1350;          // ms – změň podle potřeby
let splashStart;                  // čas, kdy jsme splash otevřeli


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
  splash.loadFile(path.join(__dirname, 'splash.html'));
  splashStart = Date.now();       // zapamatuj start

  // 2) HLAVNÍ OKNO (původní kód, ale show:false)
  mainWin = new BrowserWindow({
    width: 1280, height: 800,
    icon: path.join(__dirname, 'icon.png'),
    show: false,                    // *** důležité ***
    webPreferences: {
      preload: path.join(__dirname,'preload.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWin.setMenu(null);

  // ▼ WebSerial API – zapnout v Chromium engine
  app.commandLine.appendSwitch('enable-experimental-web-platform-features');
  app.commandLine.appendSwitch('enable-blink-features', 'Serial');

  const ses = mainWin.webContents.session;

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
          preload: require('path').join(__dirname, 'btPickerPreload.js')
        }
      });

      blePickerWin.loadFile('btPicker.html');
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
          name: d.deviceName || '(nepojmenované)',
          rssi: typeof d.rssi === 'number' ? d.rssi : null
        });
      }
      emitBleDevicesToPicker();
    });

    // doplňování během skenu
    mainWin.webContents.on('bluetooth-device-added', (_e, d) => {
      bleDevices.set(d.deviceId, {
        id: d.deviceId,
        name: d.deviceName || '(nepojmenované)',
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
          preload: path.join(__dirname, 'pickerPreload.js'),
          sandbox: false,
          contextIsolation: true,
          nodeIntegration: false
        }
      });

      picker.loadFile('portPicker.html');
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
  
 

  // načti UI
  mainWin.loadFile(path.join(__dirname, 'index.html'));
  
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


app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
