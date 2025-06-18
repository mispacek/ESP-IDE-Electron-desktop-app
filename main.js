// --- kousek na začátku main.js ---
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('node:path');

let mainWin;   // hlavní okno
let splash;    // splash screen

const SPLASH_MIN = 1250;          // ms – změň podle potřeby
let splashStart;                  // čas, kdy jsme splash otevřeli

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
