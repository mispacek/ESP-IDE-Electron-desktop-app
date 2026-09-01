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
const ADA_FT_SERVICE  = '0000febb-0000-1000-8000-00805f9b34fb'; // FileTransfer/Version service
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

const BLE_OPTIONAL_SERVICES = [NUS_SERVICE, ADA_NUS_SERVICE, ADA_FT_SERVICE, CH9143_SERVICE, JOY_SERVICE];
const BLE_FILTERS_STRICT = [
  { services: [NUS_SERVICE] },
  { namePrefix: 'MPY-' },
  { namePrefix: 'CIRCUITPY' },
  { namePrefix: 'CH9143' }
];

function bleNormUuid(u) {
  return String(u || '').toLowerCase();
}

function bleIsWriteChar(ch) {
  const p = ch?.properties || {};
  return !!(p.write || p.writeWithoutResponse);
}

function bleIsNotifyChar(ch) {
  const p = ch?.properties || {};
  return !!(p.notify || p.indicate);
}

function bleIsBluefyLike() {
  try {
    if (typeof navigator === 'undefined') return false;
    const ua = String(navigator.userAgent || '');
    return /Bluefy/i.test(ua) || (/iPad|iPhone|iPod/i.test(ua) && /AppleWebKit/i.test(ua));
  } catch (_) {
    return false;
  }
}

function bleDiagEnabled() {
  try {
    if (typeof window === 'undefined') return false;
    if (window.__espideBleDiag !== undefined) return !!window.__espideBleDiag;
    return bleIsBluefyLike();
  } catch (_) {
    return false;
  }
}

function bleDiagFormat(x) {
  if (x === undefined) return "";
  if (x === null) return "null";
  if (typeof x === "string") return x;
  try {
    return JSON.stringify(x);
  } catch (_) {
    try { return String(x); } catch (_) { return "[unprintable]"; }
  }
}

function bleDiagEnsurePanel() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return null;
  if (window.__espideBleDiagPanel?.body) return window.__espideBleDiagPanel.body;

  const root = document.createElement('div');
  root.id = 'espide-ble-diag-panel';
  root.style.position = 'fixed';
  root.style.left = '8px';
  root.style.right = '8px';
  root.style.bottom = '8px';
  root.style.maxHeight = '36vh';
  root.style.zIndex = '2147483647';
  root.style.background = 'rgba(0,0,0,0.86)';
  root.style.border = '1px solid rgba(255,255,255,0.28)';
  root.style.borderRadius = '8px';
  root.style.color = '#c7ffd1';
  root.style.font = '12px/1.35 Menlo,Consolas,monospace';
  root.style.pointerEvents = 'auto';
  root.style.boxShadow = '0 6px 16px rgba(0,0,0,0.45)';
  root.style.overflow = 'hidden';

  const bar = document.createElement('div');
  bar.style.display = 'flex';
  bar.style.alignItems = 'center';
  bar.style.justifyContent = 'space-between';
  bar.style.padding = '6px 8px';
  bar.style.background = 'rgba(255,255,255,0.08)';
  bar.style.borderBottom = '1px solid rgba(255,255,255,0.12)';

  const title = document.createElement('div');
  title.textContent = 'BLE DIAG';
  title.style.fontWeight = '700';
  title.style.letterSpacing = '0.3px';
  bar.appendChild(title);

  const actions = document.createElement('div');
  actions.style.display = 'flex';
  actions.style.gap = '6px';

  const mkBtn = (label, onClick) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.type = 'button';
    b.style.font = '11px/1.2 Menlo,Consolas,monospace';
    b.style.padding = '2px 6px';
    b.style.borderRadius = '4px';
    b.style.border = '1px solid rgba(255,255,255,0.25)';
    b.style.background = 'rgba(255,255,255,0.07)';
    b.style.color = '#fff';
    b.style.cursor = 'pointer';
    b.addEventListener('click', onClick);
    return b;
  };

  const body = document.createElement('pre');
  body.style.margin = '0';
  body.style.padding = '6px 8px';
  body.style.whiteSpace = 'pre-wrap';
  body.style.wordBreak = 'break-word';
  body.style.maxHeight = 'calc(36vh - 34px)';
  body.style.overflow = 'auto';

  actions.appendChild(mkBtn('CLEAR', () => { body.textContent = ''; }));
  actions.appendChild(mkBtn('HIDE', () => { root.style.display = 'none'; }));
  bar.appendChild(actions);

  root.appendChild(bar);
  root.appendChild(body);
  document.body.appendChild(root);

  window.__espideBleDiagPanel = { root, body };
  window.__espideBleDiagShow = () => { try { root.style.display = ''; } catch (_) {} };
  return body;
}

function bleDiagPush(level, msg, extra) {
  if (!bleDiagEnabled()) return;
  const body = bleDiagEnsurePanel();
  if (!body) return;

  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const ms = String(now.getMilliseconds()).padStart(3, '0');
  const line = `[${hh}:${mm}:${ss}.${ms}] [${level}] ${msg}${extra === undefined ? '' : ' ' + bleDiagFormat(extra)}\n`;

  body.textContent += line;
  const lines = body.textContent.split('\n');
  if (lines.length > 180) {
    body.textContent = lines.slice(lines.length - 180).join('\n');
  }
  body.scrollTop = body.scrollHeight;
}


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
    this._disconnectedByEvent = false;
    this._encoder = null;
    this._decoder = null;
    this._ft_active = false;
    this._ft_ack_seq = null;
    this._ft_ack_ok = false;
    this._ft_hello_buf = "";
    this._ft_supported = null;
    this._ft_debug = (typeof window !== 'undefined' && window.__espideBleDebug !== undefined)
      ? !!window.__espideBleDebug
      : true;
    this._ft_payload_max = 20;
    this._ft_dev_mtu = null;
    this._ft_caps_ready = false;
    this._ble_kind = null;
    this._connectStage = "idle";
    this._ble_safe_mode = bleIsBluefyLike();
    this._diag_enabled = bleDiagEnabled();
    this._diag('INFO', 'ctor', { bluefy_like: bleIsBluefyLike(), safe_mode: this._ble_safe_mode });
  }
  
  
  _finalizeCleanup() {
        try { this.rx?.removeEventListener("characteristicvaluechanged", this._notifyHandler); } catch(_) {}
        try { this.rx?.stopNotifications?.().catch?.(()=>{}); } catch(_) {}
        try { if (this.device?.gatt?.connected) this.device.gatt.disconnect(); } catch(_) {}
        try { this._abort?.abort(); } catch(_) {}
        this._abort = null;
        this._teardown();

        // reset higher-layer state and the TX pipeline
        this.inRawMode = false;
        this.rawResponseBuffer = "";
        this._writeBusy = Promise.resolve();
        this._session++;              // invalidate in-flight writes
        this._ft_active = false;
        this._ft_ack_seq = null;
        this._ft_ack_ok = false;
        this._ft_hello_buf = "";
        this._ft_supported = null;
        this._ft_payload_max = 20;
        this._ft_dev_mtu = null;
        this._ft_caps_ready = false;
        this._ble_kind = null;
  }

  _ui(s) { try { this.onUiState(s); } catch(_) {} }

  _onGattDisconnect = () => {
    // if the link drops unexpectedly -> ERROR; if we initiated it -> DISCONNECTED
    const expected = this._expectingDisconnect;
    const state = expected ? STATE.DISCONNECTED : STATE.ERROR;
    this._ui(state);
    this._expectingDisconnect = false;
    if (expected) this._disconnectedByEvent = true;

    // keep alias and UI consistent
    if (activeLink === 'ble') {
      activeLink = (typeof isUsbConnected === 'function' && isUsbConnected()) ? 'usb' : 'none';
    }

    this._finalizeCleanup();
    this._diag('WARN', 'gatt_disconnected', { expected });
    this.terminal.writeln("**" + replT("repl.ble.disconnected") + "**");
  };



  get connected() {
    return !!(this.device && this.device.gatt && this.device.gatt.connected);
  }

  _diag(level, msg, extra) {
    if (!this._diag_enabled) return;
    bleDiagPush(level, msg, extra);
  }

  _bleLog(step, extra) {
    this._connectStage = step;
    this._diag('DBG', `connect:${step}`, extra);
    try {
      if (this._ft_debug) {
        if (extra === undefined) console.debug(`[BLE][connect] ${step}`);
        else console.debug(`[BLE][connect] ${step}`, extra);
      }
      if (typeof window !== 'undefined') {
        window.__espideBleLastConnectStage = step;
        if (extra !== undefined) window.__espideBleLastConnectDetail = extra;
      }
    } catch (_) {}
  }

  async _requestDeviceCompat() {
    const modes = [
      {
        name: 'strict',
        options: { filters: BLE_FILTERS_STRICT, optionalServices: BLE_OPTIONAL_SERVICES }
      },
      {
        name: 'name-only',
        options: {
          filters: [{ namePrefix: 'MPY-' }, { namePrefix: 'CIRCUITPY' }, { namePrefix: 'CH9143' }],
          optionalServices: BLE_OPTIONAL_SERVICES
        }
      },
      {
        name: 'accept-all',
        options: {
          acceptAllDevices: true,
          optionalServices: BLE_OPTIONAL_SERVICES
        }
      },
      {
        name: 'accept-all-minimal',
        options: {
          acceptAllDevices: true,
          optionalServices: [NUS_SERVICE]
        }
      }
    ];

    let lastErr = null;
    for (const mode of modes) {
      try {
        this._bleLog(`requestDevice:${mode.name}`);
        return await navigator.bluetooth.requestDevice(mode.options);
      } catch (e) {
        lastErr = e;
        const name = String(e?.name || '');
        const msg = String(e?.message || e || '');
        this._bleLog(`requestDevice:${mode.name}:error`, { name, msg });
        if (/User cancelled|No device selected|chooser/i.test(msg)) {
          throw e;
        }
      }
    }
    throw lastErr || new Error("BLE requestDevice failed");
  }

  async _resolveUartChars(service, kind) {
    const chars = await service.getCharacteristics();
    const byUuid = (u) => chars.find(c => bleNormUuid(c?.uuid) === bleNormUuid(u));

    let tx = null;
    let rx = null;
    if (kind === 'NUS') {
      tx = byUuid(NUS_TX);
      rx = byUuid(NUS_RX);
    } else if (kind === 'ADA') {
      tx = byUuid(ADA_NUS_TX);
      rx = byUuid(ADA_NUS_RX);
    } else if (kind === 'CH9143') {
      tx = byUuid(CH9143_TX);
      rx = byUuid(CH9143_RX);
    }

    if (!bleIsWriteChar(tx)) tx = chars.find(bleIsWriteChar) || null;
    if (!bleIsNotifyChar(rx)) rx = chars.find(bleIsNotifyChar) || null;
    if (!tx || !rx) return null;

    return { tx, rx, chars };
  }

  async _resolveKnownUart(primaryServices) {
    const bySvcUuid = new Map(primaryServices.map(s => [bleNormUuid(s.uuid), s]));
    const known = [
      { kind: 'NUS', serviceUuid: NUS_SERVICE, txLimit: NUS_TX_LIMIT },
      { kind: 'ADA', serviceUuid: ADA_NUS_SERVICE, txLimit: ADA_NUS_TX_LIMIT },
      { kind: 'CH9143', serviceUuid: CH9143_SERVICE, txLimit: CH9143_TX_LIMIT }
    ];

    for (const k of known) {
      const svc = bySvcUuid.get(bleNormUuid(k.serviceUuid));
      if (!svc) continue;
      this._bleLog(`resolve:${k.kind}:service`, svc.uuid);
      try {
        const resolved = await this._resolveUartChars(svc, k.kind);
        if (!resolved) continue;
        this.service = svc;
        this.tx = resolved.tx;
        this.rx = resolved.rx;
        this.tx_limit = k.txLimit;
        this._ble_kind = k.kind;
        this._bleLog(`resolve:${k.kind}:ok`, {
          service: svc.uuid,
          tx: this.tx?.uuid || null,
          rx: this.rx?.uuid || null
        });

        if (k.kind === 'ADA') {
          try {
            const ft = await this.server.getPrimaryService(ADA_FT_SERVICE);
            const v = await ft.getCharacteristic(ADA_VER);
            await v.readValue();
          } catch (_) {}
        }
        return true;
      } catch (e) {
        this._bleLog(`resolve:${k.kind}:error`, String(e?.message || e || ''));
      }
    }
    return false;
  }
  
  
  
  
  async connect() {
    if (!navigator.bluetooth) throw new Error(replT("repl.ble.notSupported"));
    if (this._connecting) throw new Error(replT("repl.ble.connectInProgress"));
    this._connecting = true;
    let ok = false;
    const withTimeout = (p, ms, msg) => {
      let t;
      const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(msg)), ms); });
      return Promise.race([p, timeout]).finally(() => clearTimeout(t));
    };
    try {
      this._abort = new AbortController();

      this.device = await this._requestDeviceCompat();
      this._bleLog("requestDevice:ok", { name: this.device?.name || null, id: this.device?.id || null });

      try {
        this.device.addEventListener("gattserverdisconnected", this._onGattDisconnect, { signal: this._abort.signal });
      } catch (_) {
        this.device.addEventListener("gattserverdisconnected", this._onGattDisconnect);
      }
      this._bleLog("gatt:connect:start");
      this.server = await withTimeout(this.device.gatt.connect(), 8000, "GATT connect timeout");
      this._bleLog("gatt:connect:ok");

      // Scan primary services and resolve NUS / ADA / CH9143
      this._bleLog("gatt:services:start");
      const primaryServices = await withTimeout(this.server.getPrimaryServices(), 8000, "GATT services timeout");
      this._bleLog("gatt:services:ok", primaryServices.map(s => s.uuid));
      await this._resolveKnownUart(primaryServices);

      if (!this.service || !this.rx || !this.tx) {
        this._bleLog("uart:missing", { stage: this._connectStage });
        throw new Error(replT("repl.ble.uartMissing"));
      }

      {
        const notifyCandidates = [];
        if (this.rx) notifyCandidates.push(this.rx);
        try {
          const chars = await this.service.getCharacteristics();
          for (const ch of chars) {
            if (!bleIsNotifyChar(ch)) continue;
            const exists = notifyCandidates.some(c => bleNormUuid(c?.uuid) === bleNormUuid(ch?.uuid));
            if (!exists) notifyCandidates.push(ch);
          }
        } catch (_) {}

        let notifyErr = null;
        for (let i = 0; i < notifyCandidates.length; i++) {
          const candidate = notifyCandidates[i];
          this.rx = candidate;
          this._bleLog(`notify:start:attempt${i + 1}`, this.rx?.uuid || null);
          try {
            await withTimeout(this.rx.startNotifications(), 8000, "GATT notify timeout");
            this.rx.addEventListener("characteristicvaluechanged", this._notifyHandler);
            this._bleLog("notify:ok", this.rx?.uuid || null);
            notifyErr = null;
            break;
          } catch (e) {
            notifyErr = e;
            const msg = String(e?.message || e || "");
            this._bleLog(`notify:error:attempt${i + 1}`, msg);
            if (/already|in progress/i.test(msg)) {
              this.rx.addEventListener("characteristicvaluechanged", this._notifyHandler);
              this._bleLog("notify:ok:already", this.rx?.uuid || null);
              notifyErr = null;
              break;
            }
          }
        }
        if (notifyErr) throw notifyErr;
      }

      // 4) Optionally attach the joystick characteristic
      try {
          this._bleLog("joy:start");
          const joySvc = await this.server.getPrimaryService(JOY_SERVICE);
          this.joy = await joySvc.getCharacteristic(JOY_CHAR);
          this._bleLog("joy:ok");
          console.debug('[BLE] JOY characteristic OK');
      } catch(e) {
          this.joy = null;
          this._bleLog("joy:missing", String(e?.message || e || ''));
          console.debug('[BLE] JOY characteristic missing', e);
      }

      this._bleLog("ftcaps:start");
      await this._initFtCaps();
      this._bleLog("ftcaps:ok");
      try {
        const props = this.tx?.properties || {};
        console.info(
          `[BLE] connected kind=${this._ble_kind || 'unknown'} ` +
          `tx_limit=${this.tx_limit || 20} ` +
          `wnr=${!!props.writeWithoutResponse} write=${!!props.write} ` +
          `ft_supported=${this._ft_supported} payload_max=${this._ft_payload_max} ` +
          `dev_mtu=${this._ft_dev_mtu ?? 'n/a'}`
        );
      } catch (_) {}
      this.terminal.write('\x1b[32m' + replT("repl.ble.connected") + '\x1b[m');
      
      this.mute_terminal = true;
      await this.sendData("\r\x03"); // Ctrl-C
      await delay(100);
      await this.sendData("\r\x03"); // Ctrl-C
      await delay(20);
      await this.sendData("\r\x03\r"); // Ctrl-C
      await delay(100);
      this.mute_terminal = false;
      await this.sendData("\x02"); // Ctrl-B
      await delay(50);

      this._ui(STATE.CONNECTED);
      ok = true;
    } finally {
      this.mute_terminal = false;
      this._connecting = false;
      if (!ok) {
        this._bleLog("connect:failed", { stage: this._connectStage });
        try { this.terminal.writeln(`**BLE connect stage: ${this._connectStage}**`); } catch (_) {}
        // if something failed mid-connection, clean everything up and show ERROR state (not DISCONNECTED, since we were never really connected)
        this._finalizeCleanup();
        this._ui(STATE.ERROR);
      } else {
        this._bleLog("connect:ok");
        // new valid session
        this._session++;
      }
    }
  }


  async disconnect() {
    try {
      this._expectingDisconnect = true;
      this._disconnectedByEvent = false;
      if (this.rx) {
        try { await this.rx.stopNotifications(); } catch(_) {}
        this.rx.removeEventListener("characteristicvaluechanged", this._notifyHandler);
      }
      if (this.device && this.device.gatt && this.device.gatt.connected) {
        await this.device.gatt.disconnect();
      }
    } finally {
      if (!this._disconnectedByEvent) {
        this._finalizeCleanup();
        // keep alias and UI consistent
        if (activeLink === 'ble') {
          activeLink = (typeof isUsbConnected === 'function' && isUsbConnected()) ? 'usb' : 'none';
        }
        this.terminal.writeln("**" + replT("repl.ble.disconnected") + "**");
        this._ui(STATE.DISCONNECTED);
      }
      this._expectingDisconnect = false;
      this._disconnectedByEvent = false;
    }
  }

  _teardown() {
    this.device = null;
    this.server = null;
    this.service = null;
    this.rx = null;
    this.tx = null;
    this.joy = null;
  }

  async _initFtCaps() {
    this._ft_supported = null;
    this._ft_payload_max = 20;
    this._ft_dev_mtu = null;
    this._ft_caps_ready = false;

    const deadline = Date.now() + 800;
    while (Date.now() < deadline) {
      if (this._ft_caps_ready) break;
      await new Promise(r => setTimeout(r, 20));
    }
    if (!this._ft_caps_ready) {
      this._ft_supported = false;
      this._ft_payload_max = 20;
      this._ft_caps_ready = true;
      if (this._ft_debug) {
        console.warn("[BLE] Config not received, fallback to MTU20 and legacy transfer.");
      }
      return;
    }
    if (this._ft_debug) {
      console.info(`[BLE] Config received: payload_max=${this._ft_payload_max}, dev_mtu=${this._ft_dev_mtu ?? 'n/a'}`);
    }
  }

  _onNotify(ev) {
    const v = ev.target.value;
    if (this._ft_active) {
      // handle file-transfer ACK/NAK frames (binary)
      for (let i = 0; i < v.byteLength; ) {
        const b = v.getUint8(i);
        if ((b === 0x06 || b === 0x15) && (i + 2) < v.byteLength) {
          this._ft_ack_seq = v.getUint8(i + 1) | (v.getUint8(i + 2) << 8);
          this._ft_ack_ok = (b === 0x06);
          i += 3;
          continue;
        }
        i += 1;
      }
      // During file transfer, suppress REPL output handling.
      return;
    }
    // decode to text
    if (!this._decoder) this._decoder = new TextDecoder();
    const s = this._decoder.decode(v);

    // Filter out BLE Config lines (can appear anywhere) without altering line endings.
    let out = "";
    let buf = (this._ft_hello_buf || "") + s;
    let start = 0;
    for (let i = 0; i < buf.length; i++) {
      const c = buf.charCodeAt(i);
      if (c === 10 || c === 13) {
        let end = i + 1;
        if (c === 13 && i + 1 < buf.length && buf.charCodeAt(i + 1) === 10) {
          end = i + 2;
          i++;
        }
        const line = buf.slice(start, end);
        if (line.indexOf("BLE Config") >= 0) {
          const m = /BLE Config\s+mtu=(\d+)\s+chunk=(\d+)/.exec(line);
          if (m) {
            this._ft_dev_mtu = parseInt(m[1], 10);
            this._ft_payload_max = parseInt(m[2], 10) || 20;
            this._ft_supported = true;
            this._ft_caps_ready = true;
            if (this._ft_debug) {
              console.debug(`[BLE] Config: dev_mtu=${this._ft_dev_mtu} payload_max=${this._ft_payload_max}`);
            }
          }
        } else {
          out += line;
        }
        start = end;
      }
    }
    let tail = buf.slice(start);
    if (tail) {
      if ("BLE Config".startsWith(tail) || tail.indexOf("BLE Config") >= 0) {
        this._ft_hello_buf = tail;
      } else {
        out += tail;
        this._ft_hello_buf = "";
      }
    } else {
      this._ft_hello_buf = "";
    }

    if (this.inRawMode) this.rawResponseBuffer += out;
    if (!this.mute_terminal && out) this.terminal.write(out);
    
    if (this.fm_buf_enabled && out) {
      this.fm_in_buffer += out;
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

  async _writePacket(packet, opts = {}) {
      const mySession = this._session;
      this._writeBusy = this._writeBusy.then(async () => {
        if (mySession !== this._session) throw new Error(replT("repl.ble.sessionEnded"));
        const props = this.tx?.properties || {};
        const canWnr = !opts.forceWriteWithResponse && !!props.writeWithoutResponse && typeof this.tx.writeValueWithoutResponse === 'function';
        if (canWnr) await this.tx.writeValueWithoutResponse(packet);
        else await this.tx.writeValue(packet);
      });
      return this._writeBusy;
  }

  async _writeChunked(text, opts = {}) {
      const mySession = this._session;
      this._writeBusy = this._writeBusy.then(async () => {
        const mtu = this.tx_limit || 20;               // 20 for WebBT
        if (!this._encoder) this._encoder = new TextEncoder();
        const bytes = this._toBytes(text);
        let i = 0;
        let window = 4;                                // number of blocks per micro-tick
        const props = this.tx?.properties || {};
        const canWnr = !opts.forceWriteWithResponse && !!props.writeWithoutResponse && typeof this.tx.writeValueWithoutResponse === 'function';
        while (i < bytes.length) {
          if (mySession !== this._session) throw new Error(replT("repl.ble.sessionEnded"));
          let ok = 0;
          for (; ok < window && i < bytes.length; ok++) {
            const slice = bytes.subarray(i, i + mtu);
            //console.log(slice);
            try {
              if (canWnr)
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

  _toBytes(x) {
      if (x instanceof Uint8Array) return x;
      if (x instanceof ArrayBuffer) return new Uint8Array(x);
      if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
      if (!this._encoder) this._encoder = new TextEncoder();
      return this._encoder.encode(typeof x === 'string' ? x : String(x ?? ''));
  }

  async _ft_waitAck(expectedSeq, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this._ft_ack_seq !== null) {
        const seq = this._ft_ack_seq;
        const ok = this._ft_ack_ok;
        this._ft_ack_seq = null;
        this._ft_ack_ok = false;
        if (expectedSeq === null || expectedSeq === undefined || seq === expectedSeq) {
          return { seq, ok };
        }
      }
      await new Promise(r => setTimeout(r, 5));
    }
    return null;
  }

  // --- High-level API matches Serial (mirrors sendData/sendCommand) ---

  async enterRawREPL() {
    try {
      await this.sendData("\r\x03"); // Ctrl-C
      await new Promise(resolve => setTimeout(resolve, 100));
      await this.sendData("\r\x03"); // Ctrl-C
      await new Promise(resolve => setTimeout(resolve, 40));
      await this.sendData("\r\n"); // ensure we're on a new line
      await new Promise(resolve => setTimeout(resolve, 40));
      await this.sendData("\r\x02"); // Ctrl-B to exit raw REPL
      await new Promise(resolve => setTimeout(resolve, 40));

      this.inRawMode = true;
      this.rawResponseBuffer = "";
      await this.sendData("\r\x01"); // Ctrl-A
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
      await this.sendData("\r\x02"); // Ctrl-B
      this.inRawMode = false;
    } catch (e) {
      console.error(e);
      this.terminal.writeln("**" + replT("repl.ble.rawExitError", { error: e.message }) + "**");
    }
  }

  async execRawCommand(command) {
    this.rawResponseBuffer = "";
    await this.sendCommand(command + "\r");
    await this.sendData("\r\x04"); // EOT
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

  async _sendFileBinary(filename, content, init=false) {
      const bar = document.getElementById("myProgress");
      if (bar) { bar.style.transition = "none"; bar.style.opacity = 1; bar.style.width = "0%"; }
      const prevMute = this.mute_terminal;
      const prevFm = this.fm_buf_enabled;
      let cancelFrame = null;
      let statusFrame = null;
      const ctrlC = new Uint8Array([0x03]);
      const ctrlB = new Uint8Array([0x02]);
      let hadError = false;
      let ok = false;
      const writePacket = async (packet, opts = {}, timeoutMs = 2500) => {
        let t = null;
        const timeout = new Promise((_, rej) => {
          t = setTimeout(() => rej(new Error("BLE write timeout")), timeoutMs);
        });
        try {
          return await Promise.race([this._writePacket(packet, opts), timeout]);
        } finally {
          if (t) clearTimeout(t);
        }
      };
      try {
        if (!this.tx) throw new Error(replT("repl.ble.notConnected"));
        this._diag('INFO', 'file:binary:start', { filename: filename || 'data.bin', init: !!init });

        cancelFrame = new Uint8Array([0xFA, 0xCE, 0xB0, 0x0C, 0xFE, 0x00, 0x00, 0x00]);
        statusFrame = new Uint8Array([0xFA, 0xCE, 0xB0, 0x0C, 0xFD, 0x00, 0x00, 0x00]);

        // Stop user code before binary transfer.
        await this.sendData("\r\x03"); // Ctrl-C
        await new Promise(resolve => setTimeout(resolve, 100));
        await this.sendData("\r\x03"); // Ctrl-C
        await new Promise(resolve => setTimeout(resolve, 40));
        await this.sendData("\r\x02"); // Ctrl-B to exit raw REPL
        await new Promise(resolve => setTimeout(resolve, 40));

        const bytes = this._toBytes(content);
        if (bytes.length > 0xFFFFFF) throw new Error("File too large for 24-bit length");
        this._diag('INFO', 'file:binary:size', { bytes: bytes.length });

        if (!this._encoder) this._encoder = new TextEncoder();
        const nameBytes = this._encoder.encode(filename || "data.bin");
        if (nameBytes.length > 48) throw new Error("Filename too long (max 48 bytes)");
        const sink = (typeof window !== 'undefined' && window.__espideBleSink) ? true : false;

        // Build header: MAGIC(4) + NAME_LEN(1) + FILE_LEN(3) + NAME
        const header = new Uint8Array(8 + nameBytes.length);
        header[0] = 0xFA; header[1] = 0xCE; header[2] = 0xB0; header[3] = 0x0C;
        const nameLen = nameBytes.length & 0x7F;
        header[4] = sink ? (nameLen | 0x80) : nameLen;
        header[5] = bytes.length & 0xFF;
        header[6] = (bytes.length >> 8) & 0xFF;
        header[7] = (bytes.length >> 16) & 0xFF;
        header.set(nameBytes, 8);

        // File-transfer state
        this.mute_terminal = true;
        this.fm_buf_enabled = false;
        this._ft_active = true;
        this._ft_ack_seq = null;
        this._ft_ack_ok = false;

        const payloadMaxRaw = this._ft_payload_max || 20;
        const payloadMax = this._ble_safe_mode
          ? Math.max(20, Math.min(payloadMaxRaw, this.tx_limit || 20))
          : Math.max(20, payloadMaxRaw);
        if (this._ft_debug && payloadMax !== payloadMaxRaw) {
          console.info(`[BLE-FT] payload clamp raw=${payloadMaxRaw} tx_limit=${this.tx_limit || 20} use=${payloadMax} safe=${this._ble_safe_mode}`);
        }
        this._diag('DBG', 'file:binary:payload', {
          raw: payloadMaxRaw,
          use: payloadMax,
          tx_limit: this.tx_limit || 20,
          safe: this._ble_safe_mode
        });
        const maxData = Math.min(255, Math.max(1, payloadMax - 4));
        const pkt = new Uint8Array(maxData + 4);
        const props = this.tx?.properties || {};
        const canWnr = (!this._ble_safe_mode) && !!props.writeWithoutResponse && typeof this.tx.writeValueWithoutResponse === 'function';
        const win = this._ble_safe_mode ? 2 : 4;
        const gapMs = this._ble_safe_mode ? 6 : 10;
        if (this._ft_debug) {
          console.info(`[BLE-FT] mode=${this._ble_safe_mode ? 'safe' : 'fast'} wnr=${canWnr} win=${win} gap_ms=${gapMs}`);
        }
        this._diag('INFO', 'file:binary:mode', {
          safe: this._ble_safe_mode,
          wnr: canWnr,
          win,
          gap_ms: gapMs,
          immutable_pkt: !!this._ble_safe_mode
        });

        // Send header+name (chunked) and wait for header ACK (seq=0xFFFF).
        let headerRetries = 0;
        while (true) {
          for (let i = 0; i < header.length; i += payloadMax) {
            await writePacket(header.subarray(i, i + payloadMax), { forceWriteWithResponse: true });
          }
          const ack = await this._ft_waitAck(0xFFFF, 500);
          if (ack && ack.ok) break;
          headerRetries++;
          this._diag('WARN', 'file:binary:header_retry', { retry: headerRetries });
          if (headerRetries >= 6) throw new Error("Header ACK timeout");
        }

        // Data packets: [SEQ_LO][SEQ_HI][LEN][DATA...][CRC]
        let seq = 0;
        let offset = 0;
        let retries = 0;
        const maxRetries = 30;
        let transferCompleteByStatus = false;
        let lastAcked = -1;
        let ackSum = 0;
        let ackMin = 1e9;
        let ackMax = 0;
        let ackCount = 0;
        while (offset < bytes.length) {
          let sent = 0;
          let lastSeqSent = seq - 1;
          let tSend = 0;
          for (; sent < win && offset < bytes.length; sent++) {
            const dataLen = Math.min(maxData, bytes.length - offset);
            pkt[0] = seq & 0xFF;
            pkt[1] = (seq >> 8) & 0xFF;
            pkt[2] = dataLen & 0xFF;
            pkt.set(bytes.subarray(offset, offset + dataLen), 3);
            let crc = (pkt[0] + pkt[1] + pkt[2]) & 0xFF;
            for (let i = 0; i < dataLen; i++) crc = (crc + pkt[3 + i]) & 0xFF;
            pkt[3 + dataLen] = crc;
            tSend = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const nearEnd = (bytes.length - (offset + dataLen)) <= (maxData * 2);
            const forceWriteWithResponse = this._ble_safe_mode || !canWnr || nearEnd;
            // Bluefy/iOS can defer reading BufferSource; use immutable packet copy.
            const outPkt = this._ble_safe_mode
              ? new Uint8Array(pkt.subarray(0, 4 + dataLen))
              : pkt.subarray(0, 4 + dataLen);
            await writePacket(outPkt, { forceWriteWithResponse });
            lastSeqSent = seq;
            seq = (seq + 1) & 0xFFFF;
            offset += dataLen;
            if (gapMs > 0) await new Promise(r => setTimeout(r, gapMs));
          }

          const sentAllNow = offset >= bytes.length;
          const shouldExpectAck = sentAllNow || ((lastSeqSent & 0x03) === 3);
          if (!shouldExpectAck) {
            retries = 0;
            if (bar) {
              const percent = bytes.length ? Math.min(Math.floor((offset / bytes.length) * 100), 100) : 100;
              this.terminal.write("\r" + replT("repl.common.transferProgress", { percent }) + "   ");
              bar.style.transition = "width 0.1s ease";
              bar.style.width = percent + "%";
            }
            continue;
          }

          const ack = await this._ft_waitAck(null, sentAllNow ? 2200 : 800);
          const tAck = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          const dt = tAck - tSend;
          if (dt >= 0) {
            ackSum += dt;
            ackCount++;
            if (dt < ackMin) ackMin = dt;
            if (dt > ackMax) ackMax = dt;
          }
          if (!ack) {
            retries++;
            if (this._ft_debug) {
              console.warn(`[BLE-FT] retry (no-ack) #${retries} resume_seq=${(lastAcked + 1) & 0xFFFF}`);
            }
            this._diag('WARN', 'file:binary:no_ack', {
              retries,
              resume_seq: (lastAcked + 1) & 0xFFFF,
              sent_all: sentAllNow,
              last_seq_sent: lastSeqSent
            });
            if (retries > maxRetries) throw new Error("Too many retries");
            if (statusFrame) {
              try { await writePacket(statusFrame, { forceWriteWithResponse: true }); } catch (_) {}
              const st = await this._ft_waitAck(null, sentAllNow ? 1200 : 600);
              if (st && st.ok) {
                const stSeq = st.seq & 0xFFFF;
                const nextSeq = seq & 0xFFFF;
                // End-of-transfer corner case on iOS/Bluefy:
                // final ACK can be dropped while device already closed transfer and reset seq to 0.
                if (sentAllNow && (stSeq === nextSeq || stSeq === 0)) {
                  if (this._ft_debug) {
                    console.info(`[BLE-FT] final status accepted seq=${stSeq} next=${nextSeq}`);
                  }
                  this._diag('INFO', 'file:binary:final_status_accepted', { st_seq: stSeq, next_seq: nextSeq });
                  transferCompleteByStatus = true;
                  retries = 0;
                  break;
                }
                seq = st.seq & 0xFFFF;
                offset = seq * maxData;
                if (offset > bytes.length) offset = bytes.length;
                lastAcked = st.seq;
                retries = 0;
                continue;
              }
            }
            seq = (lastAcked + 1) & 0xFFFF;
            offset = seq * maxData;
            if (offset > bytes.length) offset = bytes.length;
            continue;
          }
          if (ack.ok) {
            if (ack.seq > lastAcked) lastAcked = ack.seq;
            retries = 0;
            if (ack.seq < lastSeqSent) {
              seq = (ack.seq + 1) & 0xFFFF;
              offset = seq * maxData;
              if (offset > bytes.length) offset = bytes.length;
            }
          } else {
            retries++;
            if (this._ft_debug) {
              console.warn(`[BLE-FT] retry (nak) #${retries} seq=${ack.seq & 0xFFFF}`);
            }
            this._diag('WARN', 'file:binary:nak', { retries, seq: ack.seq & 0xFFFF });
            if (retries > maxRetries) throw new Error("Too many retries");
            if (statusFrame && (retries >= 3)) {
              try { await writePacket(statusFrame, { forceWriteWithResponse: true }); } catch (_) {}
              const st = await this._ft_waitAck(null, 700);
              if (st && st.ok) {
                const stSeq = st.seq & 0xFFFF;
                if (this._ft_debug) {
                  console.info(`[BLE-FT] nak-resync status_seq=${stSeq}`);
                }
                this._diag('INFO', 'file:binary:nak_resync', { status_seq: stSeq });
                seq = stSeq;
                offset = seq * maxData;
                if (offset > bytes.length) offset = bytes.length;
                lastAcked = (seq - 1) & 0xFFFF;
                retries = 0;
                continue;
              }
            }
            seq = ack.seq & 0xFFFF;
            offset = seq * maxData;
            if (offset > bytes.length) offset = bytes.length;
          }

          if (bar) {
            const percent = bytes.length ? Math.min(Math.floor((offset / bytes.length) * 100), 100) : 100;
            this.terminal.write("\r" + replT("repl.common.transferProgress", { percent }) + "   ");
            bar.style.transition = "width 0.1s ease";
            bar.style.width = percent + "%";
          }
        }

        if (transferCompleteByStatus && bar) {
          bar.style.transition = "width 0.1s ease";
          bar.style.width = "100%";
        }
        if (bar) setTimeout(() => { bar.style.opacity = 0; bar.style.width = "0%"; }, 500);
        this.terminal.writeln("");
        if (this._ft_debug && ackCount > 0) {
          const avg = ackSum / ackCount;
          console.info(`[BLE-FT] ack_avg_ms=${avg.toFixed(1)} ack_min_ms=${ackMin.toFixed(1)} ack_max_ms=${ackMax.toFixed(1)} count=${ackCount} sink=${sink}`);
        }
        this._diag('INFO', 'file:binary:ok', {
          bytes: bytes.length,
          ack_count: ackCount,
          final_by_status: transferCompleteByStatus
        });
        ok = true;
      } catch (e) {
        console.error(e);
        this._diag('ERR', 'file:binary:error', String(e?.message || e || ''));
        hadError = true;
        if (cancelFrame) {
          try {
            for (let i = 0; i < 3; i++) {
              await writePacket(cancelFrame, { forceWriteWithResponse: true });
              await new Promise(r => setTimeout(r, 60));
            }
          } catch (_) {}
        }
        try {
          await writePacket(ctrlC, { forceWriteWithResponse: true });
          await new Promise(r => setTimeout(r, 80));
          await writePacket(ctrlB, { forceWriteWithResponse: true });
        } catch (_) {}
        this.terminal.writeln("**" + replT("repl.ble.sendFileError", { error: e.message }) + "**");
      } finally {
        this.mute_terminal = prevMute;
        this.fm_buf_enabled = prevFm;
        if (hadError) {
          await new Promise(r => setTimeout(r, 200));
        }
        this._ft_active = false;
        this._ft_ack_seq = null;
        this._ft_ack_ok = false;
      }
      return ok;
  }

  async _sendFileLegacy(filename, content, init=false) {
      try {
        this._diag('INFO', 'file:legacy:start', { filename: filename || 'data.bin', init: !!init });
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
        const u8ToB64 = (u8) => {
          let s = ''; const CH = 0x8000;
          for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
          return btoa(s);
        };

        const bytes = this._toBytes(content);
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
        this._diag('INFO', 'file:legacy:ok');
      } catch (e) {
        console.error(e);
        this._diag('ERR', 'file:legacy:error', String(e?.message || e || ''));
        this.terminal.writeln("**" + replT("repl.ble.sendFileError", { error: e.message }) + "**");
      }
  }

  async sendFile(filename, content, init=false) {
      if (this._ft_supported === null) await this._initFtCaps();
      if (this._ft_supported) {
        const ok = await this._sendFileBinary(filename, content, init);
        if (ok) return;
        if (this._ft_debug) {
          console.warn("[BLE-FT] binary transfer failed, fallback to legacy mode.");
        }
        this._diag('WARN', 'file:binary:fallback_legacy');
      }
      this._ft_active = false;
      return this._sendFileLegacy(filename, content, init);
  }

  
  
  fmEnable(on){ this.fm_buf_enabled = !!on; }
  fmClear(){ this.fm_in_buffer = ""; }
  fmPeek(){ return this.fm_in_buffer; }
  fmTakeAll(){ const s = this.fm_in_buffer; this.fm_in_buffer = ""; return s; }
  
  
  
  
  
}
