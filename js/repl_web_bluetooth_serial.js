/* *****************************************************
 * Třída MicroPythonBLE – nová webBluetooth komunikace *
 *******************************************************/

// === Web Bluetooth UUIDs (NUS + Adafruit NUS + CH9143), inspirováno ViperIDE transports.js ===

// Nordic UART Service (NUS)
const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_TX      = '6e400002-b5a3-f393-e0a9-e50e24dcca9e'; // Write
const NUS_RX      = '6e400003-b5a3-f393-e0a9-e50e24dcca9e'; // Notify
const NUS_TX_LIMIT = 96;  // konzervativní (často funguje až 244, 128 je bezpečné)

// Adafruit NUS (CircuitPython BLE)
const ADA_NUS_SERVICE = 'adaf0001-4369-7263-7569-74507974686e';
const ADA_NUS_TX      = 'adaf0002-4369-7263-7569-74507974686e';
const ADA_NUS_RX      = 'adaf0003-4369-7263-7569-74507974686e';
const ADA_FT_SERVICE  = 0xfebb; // FileTransfer/Version service
const ADA_VER         = 'adaf0100-4669-6c65-5472-616e73666572';
const ADA_NUS_TX_LIMIT= 20;

// CH9143 (často klony BLE↔UART)
const CH9143_SERVICE  = '0000fff0-0000-1000-8000-00805f9b34fb';
const CH9143_TX       = '0000fff2-0000-1000-8000-00805f9b34fb';
const CH9143_RX       = '0000fff1-0000-1000-8000-00805f9b34fb';
const CH9143_CTRL     = '0000fff3-0000-1000-8000-00805f9b34fb';
const CH9143_TX_LIMIT = 20;

// ---- MicroPythonBLE: API kompatibilní s MicroPythonSerial ----
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

    this._notifyHandler = this._onNotify.bind(this);
    this._writeBusy = Promise.resolve();

    // stejné vyšší vrstvy jako v MicroPythonSerial
    this.inRawMode = false;
    this.rawResponseBuffer = "";
    this.mute_terminal = false;
    
    this._abort = null;
  }

  _ui(s) { try { this.onUiState(s); } catch(_) {} }

  _onGattDisconnect = () => {
    // když spojení spadne „samo“, ukaž ERROR; když jsme odpojili my, DISCONNECTED
    const state = this._expectingDisconnect ? STATE.DISCONNECTED : STATE.ERROR;
    this._ui(state);
    this._expectingDisconnect = false;

    // udrž alias a UI konzistentní
    if (activeLink === 'ble') {
      activeLink = (typeof isUsbConnected === 'function' && isUsbConnected()) ? 'usb' : 'none';
    }

    this._teardown();
    this.terminal.writeln("**BLE odpojeno.**");
  };



  get connected() {
    return !!(this.device && this.device.gatt && this.device.gatt.connected);
  }

  async connect() {
    if (!navigator.bluetooth) throw new Error("Tento prohlížeč nepodporuje Web Bluetooth.");

    this._abort = new AbortController();

    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [NUS_SERVICE] }, { namePrefix: 'mpy-' }, { namePrefix: 'CIRCUITPY' }, { namePrefix: 'CH9143' }],
      optionalServices: [NUS_SERVICE, ADA_NUS_SERVICE, ADA_FT_SERVICE, CH9143_SERVICE]
    });
    
    // nečekané odpojení → ERROR; očekávané → DISCONNECTED
    this.device.addEventListener(
      "gattserverdisconnected",
      this._onGattDisconnect,
      { signal: this._abort.signal }
    );
    
    this.server = await this.device.gatt.connect();

    // Projedeme primární služby a zkusíme NUS / ADA / CH9143
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

        // Volitelně zkontroluj verzi ADA FT služby (nebude-li, nevadí)
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
      await this.disconnect();
      throw new Error("Nepodařilo se najít BLE UART (NUS/ADA/CH9143) charakteristiky.");
    }

    // 3) Notifikace z RX → terminál/raw buffer
    await this.rx.startNotifications();
    this.rx.addEventListener("characteristicvaluechanged", this._notifyHandler);

    // 4) Pozdrav + návrat do „friendly REPL“ (Ctrl-B) jako u serialu
    this.terminal.write('\x1b[32mPřipojeno přes BLE — ESP IDE!\x1b[m');
    await this.sendData("\x02"); // Ctrl-B
    
    this._ui(STATE.CONNECTED);
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
      this._abort?.abort();           // odregistrovat všechny addEventListener s tímto signálem
      this._abort = null;
      this._teardown();
      this.terminal.writeln("**BLE odpojeno.**");
      this._ui(STATE.DISCONNECTED);
      this._expectingDisconnect = false;
    }
  }

  _teardown() {
    this.server = null;
    this.service = null;
    this.rx = null;
    this.tx = null;
  }

  _onNotify(ev) {
    const v = ev.target.value;
    // převod na text:
    let s = "";
    for (let i = 0; i < v.byteLength; i++) s += String.fromCharCode(v.getUint8(i));
    if (this.inRawMode) this.rawResponseBuffer += s;
    if (!this.mute_terminal) this.terminal.write(s);
  }

  // --- Nízká vrstva kompatibilní s MicroPythonSerial ---

  async sendCommand(command) {
    if (!this.tx) throw new Error("Nejsi připojen k BLE zařízení.");
    if (!command.endsWith("\n")) command += "\r\n";
    await this._writeChunked(command);
  }

  async sendData(data) {
    if (!this.tx) throw new Error("Nejsi připojen k BLE zařízení.");
    await this._writeChunked(data);
  }

  async _writeChunked(text) {
    // serializuj zápisy (vyhneš se kolizím v BLE stacku)
    this._writeBusy = this._writeBusy.then(async () => {
      const enc = new TextEncoder();
      const bytes = enc.encode(text);
      for (let i = 0; i < bytes.length; i += this.tx_limit) {
        const slice = bytes.slice(i, i + this.tx_limit);
        // Preferuj writeWithoutResponse, je rychlejší a běžné u NUS
        if (this.tx.writeValueWithoutResponse) {
          await this.tx.writeValueWithoutResponse(slice);
        } else {
          await this.tx.writeValue(slice);
        }
        // drobná pauza chrání pomalejší stacky
        await new Promise(r => setTimeout(r, 2));
      }
    });
    return this._writeBusy;
  }

  // --- Stejná „vyšší“ API jako u Serialu (kopie používající sendData/sendCommand) ---

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
        throw new Error("Nepodařilo se vstoupit do raw REPL režimu (BLE).");
      }
    } catch (e) {
      console.error(e);
      this.terminal.writeln(`**Chyba raw REPL (BLE): ${e.message}**`);
      throw e;
    }
  }

  async exitRawREPL() {
    try {
      await this.sendData("\x02"); // Ctrl-B
      this.inRawMode = false;
    } catch (e) {
      console.error(e);
      this.terminal.writeln(`**Chyba opuštění raw REPL (BLE): ${e.message}**`);
    }
  }

  async execRawCommand(command) {
    this.rawResponseBuffer = "";
    await this.sendCommand(command + "\r");
    await this.sendData("\x04"); // EOT
    // čekání na "OK\x04" stejně jako u Serialu
    const result = await new Promise((resolve, reject) => {
      const start = Date.now();
      const tick = () => {
        if (this.rawResponseBuffer.includes("OK\x04")) {
          const out = this.rawResponseBuffer;
          this.rawResponseBuffer = "";
          resolve(out);
        } else if (Date.now() - start > 2000) {
          reject(new Error("Timeout při čekání na OK\\x04 (BLE): " + this.rawResponseBuffer));
        } else {
          setTimeout(tick, 10);
        }
      };
      tick();
    });
    return result;
  }

  // Pomocný splitter (sdílený pattern se Serialem)
  splitIntoChunks(content, chunkSize) {
    const chunks = [];
    for (let i = 0; i < content.length; i += chunkSize) {
      chunks.push(content.substring(i, i + chunkSize));
    }
    return chunks;
  }

  // Stejná implementace sendFile jako u Serialu: používá execRawCommand, sendData, exitRawREPL atd.
  async sendFile(filename, content, init=false) {
    try {
      const bar = document.getElementById("myProgress");
      bar.style.transition = "none";
      bar.style.opacity = 1;
      bar.style.width = "0%";

      // Přepni do raw REPL a připrav zápis
      await this.enterRawREPL();
      await this.execRawCommand(`import ubinascii,sys`);
      await this.execRawCommand(`f=open("${filename}","wb")`);

      const base64 = btoa(unescape(encodeURIComponent(content)));
      const chunkSize = 128; // textový chunk (base64, není BLE MTU)
      for (let i = 0; i < base64.length; i += chunkSize) {
        const base64Chunk = base64.substring(i, i + chunkSize);
        // Přímé volání write v raw REPL:
        await this.execRawCommand(`f.write(ubinascii.a2b_base64("${base64Chunk}"))`);
        const percent = Math.min(Math.floor(((i + chunkSize) / base64.length) * 100), 100);
        this.terminal.write(`\rOdesílání: ${percent}%   `);
        bar.style.transition = "width 0.1s ease";
        bar.style.width = percent + "%";
      }

      await this.execRawCommand("f.close()");
      await this.exitRawREPL();

      setTimeout(() => { bar.style.opacity = 0; bar.style.width = "0%"; }, 500);
      this.terminal.writeln("");
    } catch (e) {
      console.error(e);
      this.terminal.writeln(`**Chyba při odesílání souboru (BLE): ${e.message}**`);
    }
  }
}