/* *****************************************************
 * MicroPythonBLE class - Web Bluetooth transport
 *******************************************************/

// === REPL i18n helpers ===
if (typeof window !== 'undefined') {
  if (!window.__espideReplFallbacks) window.__espideReplFallbacks = {};
  Object.assign(window.__espideReplFallbacks, {
    "repl.common.transferProgress": "Sending: {percent}%",
    "repl.ble.notSupported": "This browser does not support Web Bluetooth.",
    "repl.ble.connectInProgress": "Connection is already in progress.",
    "repl.ble.uartMissing": "BLE UART characteristics not found (NUS/ADA/CH9143/MPY).",
    "repl.ble.connected": "Connected via BLE - ESP IDE!",
    "repl.ble.disconnected": "BLE disconnected.",
    "repl.ble.notConnected": "Not connected to a BLE device.",
    "repl.ble.sessionEnded": "Interrupted: session ended.",
    "repl.ble.rawEnterFailed": "Failed to enter raw REPL mode (BLE).",
    "repl.ble.rawError": "Raw REPL error (BLE): {error}",
    "repl.ble.rawExitError": "Raw REPL exit error (BLE): {error}",
    "repl.ble.rawOkTimeout": "Timeout waiting for OK\\x04 (BLE): {buffer}",
    "repl.ble.sendFileError": "File send error (BLE): {error}",
    "repl.ble.joyNotWritable": "Joystick characteristic is not writable."
  });
}
function replT(key, vars){
  try {
    if (typeof window !== 'undefined' && window.__espideI18n && typeof window.__espideI18n.t === 'function') {
      return window.__espideI18n.t(key, vars);
    }
    if (typeof window !== 'undefined' && typeof window.t === 'function') return window.t(key, vars);
  } catch (_) {}
  const base = (typeof window !== 'undefined' && window.__espideReplFallbacks && window.__espideReplFallbacks[key]) || key;
  if (!vars) return base;
  return base.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
}

// === Web Bluetooth UUIDs (NUS + Adafruit NUS + CH9143), inspired by ViperIDE transports.js ===

// Nordic UART Service (NUS)
const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_TX      = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // Write
const NUS_RX      = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // Notify
const NUS_TX_LIMIT = 20;  // conservative (often works up to 244, 128 is safe)

// Adafruit NUS (CircuitPython BLE)
const ADA_NUS_SERVICE = 'adaf0001-4369-7263-7569-74507974686e';
const ADA_NUS_TX      = 'adaf0002-4369-7263-7569-74507974686e';
const ADA_NUS_RX      = 'adaf0003-4369-7263-7569-74507974686e';
const ADA_FT_SERVICE  = 0xfebb; // FileTransfer/Version service
const ADA_VER         = 'adaf0100-4669-6c65-5472-616e73666572';
const ADA_NUS_TX_LIMIT= 20;

// CH9143 (common BLE-UART clones)
const CH9143_SERVICE  = '0000fff0-0000-1000-8000-00805f9b34fb';
const CH9143_TX       = '0000fff2-0000-1000-8000-00805f9b34fb';
const CH9143_RX       = '0000fff1-0000-1000-8000-00805f9b34fb';
const CH9143_CTRL     = '0000fff3-0000-1000-8000-00805f9b34fb';
const CH9143_TX_LIMIT = 20;

// ESP IDE joystick service
const JOY_SERVICE = '23f10010-5f90-11ee-8c99-0242ac120002';
const JOY_CHAR    = '23f10012-5f90-11ee-8c99-0242ac120002'; // 4x Int8: Lx,Ly,Rx,Ry


// ---- MicroPythonBLE: API compatible with MicroPythonSerial ----
class MicroPythonBLE {
  constructor(terminal, onUiState) {
    this.terminal = terminal;
    this.onUiState = typeof onUiState === "function" ? onUiState : () => {};
    this._expectingDisconnect = false;
    
    this.device = null;
    this.server = null;
    this.service = null;
    this.rx = null;
    this.tx = null;
    this.tx_limit = 20;
    this.joy = null;   // joystick characteristic
    
    
    this.fm_in_buffer  = "";
    this.fm_buf_enabled = true;            // always collect
    this.fm_buf_limit   = 262144;          // 256 KiB overflow guard

    this._notifyHandler = this._onNotify.bind(this);
    this._writeBusy = Promise.resolve();

    // same high-level flags as in MicroPythonSerial
    this.inRawMode = false;
    this.rawResponseBuffer = "";
    this.mute_terminal = false;
    
    this._abort = null;
    this._connecting = false;
    this._session = 0;
  }
  
  
  _finalizeCleanup() {
        try { this.rx?.removeEventListener("characteristicvaluechanged", this._notifyHandler); } catch(_) {}
        try { this.rx?.stopNotifications?.(); } catch(_) {}
        try { if (this.device?.gatt?.connected) this.device.gatt.disconnect(); } catch(_) {}
        try { this._abort?.abort(); } catch(_) {}
        this._abort = null;
        this._teardown();

        // reset higher-layer state and the TX pipeline
        this.inRawMode = false;
        this.rawResponseBuffer = "";
        this._writeBusy = Promise.resolve();
        this._session++;              // invalidate in-flight writes
  }

  _ui(s) { try { this.onUiState(s); } catch(_) {} }

  _onGattDisconnect = () => {
    // if the link drops unexpectedly -> ERROR; if we initiated it -> DISCONNECTED
    const state = this._expectingDisconnect ? STATE.DISCONNECTED : STATE.ERROR;
    this._ui(state);
    this._expectingDisconnect = false;

    // keep alias and UI consistent
    if (activeLink === 'ble') {
      activeLink = (typeof isUsbConnected === 'function' && isUsbConnected()) ? 'usb' : 'none';
    }

    this._teardown();
    this.terminal.writeln("**" + replT("repl.ble.disconnected") + "**");
  };



  get connected() {
    return !!(this.device && this.device.gatt && this.device.gatt.connected);
  }
  
  
  
  
  async connect() {
    if (!navigator.bluetooth) throw new Error(replT("repl.ble.notSupported"));
    if (this._connecting) throw new Error(replT("repl.ble.connectInProgress"));
    this._connecting = true;
    let ok = false;
    try {
      this._abort = new AbortController();

      this.device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [NUS_SERVICE] }, { namePrefix: 'MPY-' }, { namePrefix: 'CIRCUITPY' }, { namePrefix: 'CH9143' }],
        optionalServices: [NUS_SERVICE, ADA_NUS_SERVICE, ADA_FT_SERVICE, CH9143_SERVICE, JOY_SERVICE]
      });

      this.device.addEventListener("gattserverdisconnected", this._onGattDisconnect, { signal: this._abort.signal });
      this.server = await this.device.gatt.connect();

      // Scan primary services and resolve NUS / ADA / CH9143
        const primaryServices = await this.server.getPrimaryServices();
        for (const svc of primaryServices) {
          if (svc.uuid === NUS_SERVICE) {
            this.service  = svc;
            this.rx       = await svc.getCharacteristic(NUS_RX);
            this.tx       = await svc.getCharacteristic(NUS_TX);
            this.tx_limit = NUS_TX_LIMIT;
            break;
          }
          if (svc.uuid === ADA_NUS_SERVICE) {
            this.service  = svc;
            this.rx       = await svc.getCharacteristic(ADA_NUS_RX);
            this.tx       = await svc.getCharacteristic(ADA_NUS_TX);
            this.tx_limit = ADA_NUS_TX_LIMIT;

            // Optionally validate ADA FT service version (ignore if missing)
            try {
              const ft = await this.server.getPrimaryService(ADA_FT_SERVICE);
              const v  = await ft.getCharacteristic(ADA_VER);
              await v.readValue(); // jen pro validaci
            } catch(_) {}
            break;
          }
          if (svc.uuid === CH9143_SERVICE) {
            this.service  = svc;
            this.rx       = await svc.getCharacteristic(CH9143_RX);
            this.tx       = await svc.getCharacteristic(CH9143_TX);
            this.tx_limit = CH9143_TX_LIMIT;
            break;
          }
        }

      if (!this.service || !this.rx || !this.tx) {
        throw new Error(replT("repl.ble.uartMissing"));
      }

      await this.rx.startNotifications();
      this.rx.addEventListener("characteristicvaluechanged", this._notifyHandler);

      // 4) Optionally attach the joystick characteristic
      try {
          const joySvc = await this.server.getPrimaryService(JOY_SERVICE);
          this.joy = await joySvc.getCharacteristic(JOY_CHAR);
          console.debug('[BLE] JOY characteristic OK');
      } catch(e) {
          this.joy = null;
          console.debug('[BLE] JOY characteristic missing', e);
      }

      this.terminal.write('\x1b[32m' + replT("repl.ble.connected") + '\x1b[m');
      await this.sendData("\x02"); // Ctrl-B

      this._ui(STATE.CONNECTED);
      ok = true;
    } finally {
      this._connecting = false;
      if (!ok) {
        // if something failed mid-connection, clean everything up
        this._finalizeCleanup();
        this._ui(STATE.ERROR);
      } else {
        // new valid session
        this._session++;
      }
    }
  }


  async disconnect() {
    try {
      this._expectingDisconnect = true;
      if (this.rx) {
        try { await this.rx.stopNotifications(); } catch(_) {}
        this.rx.removeEventListener("characteristicvaluechanged", this._notifyHandler);
      }
      if (this.device && this.device.gatt && this.device.gatt.connected) {
        await this.device.gatt.disconnect();
      }
    } finally {
      this._finalizeCleanup();
      this._abort?.abort();           // unregister all addEventListener handlers
      this._abort = null;
      this._teardown();
      this.terminal.writeln("**" + replT("repl.ble.disconnected") + "**");
      this._ui(STATE.DISCONNECTED);
      this._expectingDisconnect = false;
    }
  }

  _teardown() {
    this.server = null;
    this.service = null;
    this.rx = null;
    this.tx = null;
    this.joy = null;
  }

  _onNotify(ev) {
    const v = ev.target.value;
    // decode to text
    let s = "";
    for (let i = 0; i < v.byteLength; i++) s += String.fromCharCode(v.getUint8(i));
    if (this.inRawMode) this.rawResponseBuffer += s;
    if (!this.mute_terminal) this.terminal.write(s);
    
    if (this.fm_buf_enabled) {
      this.fm_in_buffer += s;
      if (this.fm_in_buffer.length > this.fm_buf_limit) {
        this.fm_in_buffer = this.fm_in_buffer.slice(-this.fm_buf_limit);
      }
    }
    
  }

  // --- Low-level layer compatible with MicroPythonSerial ---

  async sendCommand(command) {
    if (!this.tx) throw new Error(replT("repl.ble.notConnected"));
    if (!command.endsWith("\n")) command += "\r\n";
    await this._writeChunked(command);
  }

  async sendData(data) {
    if (!this.tx) throw new Error(replT("repl.ble.notConnected"));
    await this._writeChunked(data);
  }
  
  // API pro TX joysticku  
  async sendJoy(lx, ly, rx, ry) {
      if (!this.connected || !this.joy) return;
      const clamp = v => Math.max(-100, Math.min(100, v|0));
      const buf = new Int8Array([clamp(lx), clamp(ly), clamp(rx), clamp(ry)]);
      const props = this.joy.properties || {};
      if (props.writeWithoutResponse) {
        await this.joy.writeValueWithoutResponse(buf);
      } else if (props.write) {
        await this.joy.writeValue(buf);
      } else {
        throw new Error(replT("repl.ble.joyNotWritable"));
      }
  }

  async _writeChunked(text) {
      const mySession = this._session;
      this._writeBusy = this._writeBusy.then(async () => {
        const mtu = this.tx_limit || 20;               // 20 for WebBT
        const enc = new TextEncoder();
        const bytes = enc.encode(text);
        let i = 0;
        let window = 4;                                // number of blocks per micro-tick
        while (i < bytes.length) {
          if (mySession !== this._session) throw new Error(replT("repl.ble.sessionEnded"));
          let ok = 0;
          for (; ok < window && i < bytes.length; ok++) {
            const slice = bytes.slice(i, i + mtu);
            //console.log(slice);
            try {
              if (this.tx.writeValueWithoutResponse)
                await this.tx.writeValueWithoutResponse(slice);
              else
                await this.tx.writeValue(slice);
              i += mtu;
            } catch (e) {
              // Back off when the stack reports "operation in progress"
              window = Math.max(1, Math.floor(window / 2));
              await new Promise(r => setTimeout(r, 8));
              break; // stop inner loop, retry
            }
          }
          // Micro-yield to let OS drain queues; ramp up to 8
          await new Promise(r => setTimeout(r, 1));
          if (ok === window && window < 8) window++;
        }
      });
      return this._writeBusy;
    }

  // --- High-level API matches Serial (mirrors sendData/sendCommand) ---

  async enterRawREPL() {
    try {
      await this.sendData("\x03"); // Ctrl-C
      await new Promise(r => setTimeout(r, 100));
      this.inRawMode = true;
      await this.sendData("\x01"); // Ctrl-A
      const start = Date.now();
      while (Date.now() - start < 2000) {
        if (this.rawResponseBuffer.includes("raw REPL")) break;
        await new Promise(r => setTimeout(r, 100));
      }
      if (!this.rawResponseBuffer.includes("raw REPL")) {
        throw new Error(replT("repl.ble.rawEnterFailed"));
      }
    } catch (e) {
      console.error(e);
      this.terminal.writeln("**" + replT("repl.ble.rawError", { error: e.message }) + "**");
      throw e;
    }
  }

  async exitRawREPL() {
    try {
      await this.sendData("\x02"); // Ctrl-B
      this.inRawMode = false;
    } catch (e) {
      console.error(e);
      this.terminal.writeln("**" + replT("repl.ble.rawExitError", { error: e.message }) + "**");
    }
  }

  async execRawCommand(command) {
    this.rawResponseBuffer = "";
    await this.sendCommand(command + "\r");
    await this.sendData("\x04"); // EOT
    // wait for "OK\x04" just like Serial
    const result = await new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (this.rawResponseBuffer.includes("OK\x04")) {
          const out = this.rawResponseBuffer;
          this.rawResponseBuffer = "";
          resolve(out);
        } else if (Date.now() - start > 2000) {
          reject(new Error(replT("repl.ble.rawOkTimeout", { buffer: this.rawResponseBuffer })));
        } else {
          setTimeout(tick, 10);
        }
      };
      tick();
    });
    return result;
  }

  // Helper splitter (shared pattern with Serial)
  splitIntoChunks(content, chunkSize) {
    const chunks = [];
    for (let i = 0; i < content.length; i += chunkSize) {
      chunks.push(content.substring(i, i + chunkSize));
    }
    return chunks;
  }


  // sendFile matches Serial: uses execRawCommand, sendData, exitRawREPL, etc.
  async sendFile(filename, content, init=false) {
      try {
        const bar = document.getElementById("myProgress");
        if (bar) { bar.style.transition = "none"; bar.style.opacity = 1; bar.style.width = "0%"; }

        // Enter raw REPL and prepare the write
        await this.enterRawREPL();
        await this.execRawCommand(`import sys, os`);
        await this.execRawCommand(`from ubinascii import a2b_base64`);

        // Create a folder if needed
        if (filename.includes("/")) {
          const folder = filename.substring(0, filename.lastIndexOf("/"));
          await this.sendData(`try:\r`);
          await this.sendData(` os.stat("${folder}")\r`);
          await this.sendData(`except OSError:\r`);
          await this.execRawCommand(` os.mkdir("${folder}")\r`);
        }

        await this.execRawCommand(`f=open("${filename}","wb")`);

        // --- Key change: robust base64 encoding from bytes ---
        const toBytes = (x) => {
          if (x instanceof Uint8Array) return x;
          if (x instanceof ArrayBuffer) return new Uint8Array(x);
          if (typeof x === 'string') return new TextEncoder().encode(x);
          return new TextEncoder().encode(String(x ?? ''));
        };
        const u8ToB64 = (u8) => {
          let s = ''; const CH = 0x8000;
          for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
          return btoa(s);
        };

        const bytes = toBytes(content);
        const base64 = u8ToB64(bytes);

        // Send base64 chunks
        const chunkSize = 128; // keep as-is
        for (let i = 0; i < base64.length; i += chunkSize) {
          const base64Chunk = base64.substring(i, i + chunkSize);
          await this.execRawCommand(`f.write(a2b_base64("${base64Chunk}"))`);
          if (bar) {
            const percent = Math.min(Math.floor(((i + chunkSize) / base64.length) * 100), 100);
            this.terminal.write("\r" + replT("repl.common.transferProgress", { percent }) + "   ");
            bar.style.transition = "width 0.1s ease";
            bar.style.width = percent + "%";
          }
        }

        await this.execRawCommand("f.close()");
        await this.exitRawREPL();

        if (bar) setTimeout(() => { bar.style.opacity = 0; bar.style.width = "0%"; }, 500);
        this.terminal.writeln("");
      } catch (e) {
        console.error(e);
        this.terminal.writeln("**" + replT("repl.ble.sendFileError", { error: e.message }) + "**");
      }
  }

  
  
  fmEnable(on){ this.fm_buf_enabled = !!on; }
  fmClear(){ this.fm_in_buffer = ""; }
  fmPeek(){ return this.fm_in_buffer; }
  fmTakeAll(){ const s = this.fm_in_buffer; this.fm_in_buffer = ""; return s; }
  
  
  
  
  
}
