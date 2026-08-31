/* *****************************************************
 * MicroPythonWebREPL class - WebSocket transport (WebREPL)
 ******************************************************* */

// === REPL i18n helpers ===
if (typeof window !== 'undefined') {
  if (!window.__espideReplFallbacks) window.__espideReplFallbacks = {};
  Object.assign(window.__espideReplFallbacks, {
    "repl.common.transferProgress": "Sending: {percent}%",
    "repl.common.programStopped": "Program stopped.",
    "repl.ws.notSupported": "This browser does not support WebSocket.",
    "repl.ws.invalidUrl": "Invalid WebREPL URL.",
    "repl.ws.connectInProgress": "Connection is already in progress.",
    "repl.ws.connected": "Connected via WebREPL - ESP IDE!",
    "repl.ws.disconnected": "WebREPL disconnected.",
    "repl.ws.notConnected": "WebREPL is not connected.",
    "repl.ws.authFailed": "WebREPL authentication failed.",
    "repl.ws.authTimeout": "Timeout while waiting for WebREPL authentication.",
    "repl.ws.connectError": "WebREPL connect error: {error}",
    "repl.ws.disconnectError": "WebREPL disconnect error: {error}",
    "repl.ws.sendCommandError": "WebREPL command send error: {error}",
    "repl.ws.sendDataError": "WebREPL data send error: {error}",
    "repl.ws.rawEnterFailed": "Failed to enter raw REPL mode (WebREPL).",
    "repl.ws.rawEnterError": "Raw REPL enter error (WebREPL): {error}",
    "repl.ws.rawExitError": "Raw REPL exit error (WebREPL): {error}",
    "repl.ws.rawOkTimeout": "Timeout waiting for OK\\x04 (WebREPL): {buffer}",
    "repl.ws.sendFileError": "File send error (WebREPL): {error}"
  });
}
function replWsT(key, vars){
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

function asWsBytes(x){
  if (x instanceof Uint8Array) return x;
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
  return new TextEncoder().encode(String(x ?? ''));
}

class MicroPythonWebREPL {
  constructor(terminal, onUiState) {
    this.terminal = terminal;
    this.onUiState = typeof onUiState === 'function' ? onUiState : () => {};

    this.socket = null;
    this.url = '';
    this.password = 'pass';

    this.connected = false;
    this._connecting = false;
    this._expectingDisconnect = false;
    this._authDone = false;
    this._authBuffer = '';

    this.inRawMode = false;
    this.rawResponseBuffer = '';
    this.mute_terminal = false;

    this.fm_in_buffer = '';
    this.fm_buf_enabled = true;
    this.fm_buf_limit = 262144;

    this._decoder = new TextDecoder();
    this._openResolve = null;
    this._openReject = null;
    this._openTimer = null;
  }

  _ui(state){
    try { this.onUiState(state); } catch (_) {}
  }

  _isOpen(){
    return !!(this.socket && this.socket.readyState === WebSocket.OPEN);
  }

  _clearOpenWait(){
    if (this._openTimer) {
      clearTimeout(this._openTimer);
      this._openTimer = null;
    }
    this._openResolve = null;
    this._openReject = null;
  }

  _cleanupSocket(){
    if (!this.socket) return;
    try { this.socket.onopen = null; } catch (_) {}
    try { this.socket.onclose = null; } catch (_) {}
    try { this.socket.onerror = null; } catch (_) {}
    try { this.socket.onmessage = null; } catch (_) {}
    this.socket = null;
  }

  _handleIncomingText(decoded){
    if (!decoded) return;

    if (!this._authDone) {
      this._authBuffer += decoded;
      if (/Access denied|Invalid password/i.test(this._authBuffer)) {
        const rej = this._openReject;
        if (rej) rej(new Error(replWsT('repl.ws.authFailed')));
        this._clearOpenWait();
        try { this.socket && this.socket.close(); } catch (_) {}
        return;
      }
      if (this._authBuffer.includes('WebREPL connected') || this._authBuffer.includes('>>>')) {
        this._authDone = true;
        this.connected = true;
        const res = this._openResolve;
        this._clearOpenWait();
        if (res) res(true);
      }
    }

    if (this.inRawMode) {
      this.rawResponseBuffer += decoded;
    }

    if (this.fm_buf_enabled) {
      this.fm_in_buffer += decoded;
      if (this.fm_in_buffer.length > this.fm_buf_limit) {
        this.fm_in_buffer = this.fm_in_buffer.slice(-this.fm_buf_limit);
      }
    }

    if (!this.mute_terminal) {
      this.terminal.write(decoded);
    }
  }

  _handleMessage(data){
    try {
      if (typeof data === 'string') {
        this._handleIncomingText(data);
        return;
      }
      if (data instanceof ArrayBuffer) {
        this._handleIncomingText(this._decoder.decode(new Uint8Array(data)));
        return;
      }
      if (ArrayBuffer.isView(data)) {
        this._handleIncomingText(this._decoder.decode(data));
        return;
      }
      if (typeof Blob !== 'undefined' && data instanceof Blob) {
        data.arrayBuffer().then((ab) => {
          this._handleIncomingText(this._decoder.decode(new Uint8Array(ab)));
        }).catch(() => {});
      }
    } catch (_) {}
  }

  _normalizeUrl(rawUrl){
    const src = String(rawUrl || '').trim();
    if (!src) throw new Error(replWsT('repl.ws.invalidUrl'));

    let out = src;
    if (!/^wss?:\/\//i.test(out)) {
      const proto = (typeof window !== 'undefined' && window.location && window.location.protocol === 'https:') ? 'wss://' : 'ws://';
      out = proto + out;
    }

    const u = new URL(out);
    if (!u.protocol || (u.protocol !== 'ws:' && u.protocol !== 'wss:')) {
      throw new Error(replWsT('repl.ws.invalidUrl'));
    }
    return u.toString();
  }

  async connect(config = {}) {
    if (typeof WebSocket === 'undefined') throw new Error(replWsT('repl.ws.notSupported'));
    if (this._connecting) throw new Error(replWsT('repl.ws.connectInProgress'));

    this._connecting = true;
    this._expectingDisconnect = false;
    this._authDone = false;
    this.connected = false;
    this._authBuffer = '';
    this.rawResponseBuffer = '';
    this.inRawMode = false;

    try {
      const url = this._normalizeUrl(config.url || this.url);
      const password = String(config.password ?? this.password ?? 'pass');
      this.url = url;
      this.password = password;

      await new Promise((resolve, reject) => {
        this._openResolve = resolve;
        this._openReject = reject;
        this._openTimer = setTimeout(() => {
          reject(new Error(replWsT('repl.ws.authTimeout')));
          this._clearOpenWait();
          try { this.socket && this.socket.close(); } catch (_) {}
        }, 10000);

        this.socket = new WebSocket(url);
        this.socket.binaryType = 'arraybuffer';

        this.socket.onopen = () => {
          try {
            this.socket.send(password + '\n');
          } catch (e) {
            reject(e);
          }
        };

        this.socket.onmessage = (ev) => this._handleMessage(ev.data);

        this.socket.onerror = () => {
          // onclose usually follows with details; keep this handler quiet.
        };

        this.socket.onclose = () => {
          const wasConnecting = this._connecting;
          const waitingReject = this._openReject;
          const expected = this._expectingDisconnect;

          this.connected = false;
          this._authDone = false;
          this._clearOpenWait();
          this._cleanupSocket();

          if (wasConnecting && waitingReject) {
            waitingReject(new Error(replWsT('repl.ws.connectError', { error: 'Connection closed.' })));
            return;
          }

          this.inRawMode = false;
          this.rawResponseBuffer = '';

          if (expected) {
            this._ui(STATE.DISCONNECTED);
          } else {
            this._ui(STATE.ERROR);
            this.terminal.writeln('**' + replWsT('repl.ws.disconnected') + '**');
          }
        };
      });

      this.terminal.write('\x1b[32m' + replWsT('repl.ws.connected') + '\x1b[m');

      this.mute_terminal = true;
      await this.sendData('\r\x03');
      await delay(100);
      await this.sendData('\r\x03');
      await delay(20);
      await this.sendData('\r\x03\r');
      await delay(100);
      this.mute_terminal = false;
      await this.sendData('\x02');
      await delay(50);

      this._ui(STATE.CONNECTED);
    } catch (error) {
      this.mute_terminal = false;
      this.connected = false;
      this._authDone = false;
      try { this.socket && this.socket.close(); } catch (_) {}
      this._cleanupSocket();
      this._ui(STATE.ERROR);
      throw new Error(replWsT('repl.ws.connectError', { error: error.message || String(error) }));
    } finally {
      this._connecting = false;
    }
  }

  async disconnect() {
    try {
      this._expectingDisconnect = true;
      if (!this.socket) {
        this.connected = false;
        this._ui(STATE.DISCONNECTED);
        return;
      }

      const ws = this.socket;
      await new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          resolve();
        };
        const t = setTimeout(finish, 800);
        ws.addEventListener('close', () => {
          clearTimeout(t);
          finish();
        }, { once: true });
        try { ws.close(); } catch (_) { clearTimeout(t); finish(); }
      });

      this.connected = false;
      this._authDone = false;
      this.inRawMode = false;
      this.rawResponseBuffer = '';
      this._cleanupSocket();
      this._ui(STATE.DISCONNECTED);
      this.terminal.writeln('**' + replWsT('repl.ws.disconnected') + '**');
    } catch (error) {
      this.terminal.writeln('**' + replWsT('repl.ws.disconnectError', { error: error.message || String(error) }) + '**');
    } finally {
      this._expectingDisconnect = false;
    }
  }

  async sendCommand(command) {
    try {
      if (!this._isOpen() || !this.connected) throw new Error(replWsT('repl.ws.notConnected'));
      if (!command.endsWith('\n')) command += '\r\n';
      this.socket.send(command);
    } catch (error) {
      this.terminal.writeln('**' + replWsT('repl.ws.sendCommandError', { error: error.message || String(error) }) + '**');
      throw error;
    }
  }

  async sendData(data) {
    try {
      if (!this._isOpen() || !this.connected) throw new Error(replWsT('repl.ws.notConnected'));
      if (typeof data === 'string') {
        this.socket.send(data);
      } else {
        this.socket.send(asWsBytes(data));
      }
    } catch (error) {
      this.terminal.writeln('**' + replWsT('repl.ws.sendDataError', { error: error.message || String(error) }) + '**');
      throw error;
    }
  }

  async enterRawREPL() {
    try {
      await this.sendData('\r\x03');
      await new Promise(resolve => setTimeout(resolve, 100));
      await this.sendData('\r\x03');
      await new Promise(resolve => setTimeout(resolve, 20));
      await this.sendData('\r\n');
      await new Promise(resolve => setTimeout(resolve, 20));
      await this.sendData('\r\x02');
      await new Promise(resolve => setTimeout(resolve, 20));

      this.inRawMode = true;
      this.rawResponseBuffer = '';
      await this.sendData('\r\x01');

      const startTime = Date.now();
      while (Date.now() - startTime < 2500) {
        if (this.rawResponseBuffer.includes('raw REPL')) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!this.rawResponseBuffer.includes('raw REPL')) {
        throw new Error(replWsT('repl.ws.rawEnterFailed'));
      }
    } catch (error) {
      this.terminal.writeln('**' + replWsT('repl.ws.rawEnterError', { error: error.message || String(error) }) + '**');
      throw error;
    }
  }

  async exitRawREPL() {
    try {
      await this.sendData('\r\x02');
      this.inRawMode = false;
    } catch (error) {
      this.terminal.writeln('**' + replWsT('repl.ws.rawExitError', { error: error.message || String(error) }) + '**');
    }
  }

  async execRawCommand(command) {
    this.rawResponseBuffer = '';

    await this.sendCommand(command + '\r');
    await this.sendData('\r\x04');

    const response = await new Promise((resolve, reject) => {
      const startTime = Date.now();
      const checkResponse = () => {
        if (this.rawResponseBuffer.includes('OK\x04')) {
          const result = this.rawResponseBuffer;
          this.rawResponseBuffer = '';
          resolve(result);
        } else if (Date.now() - startTime > 3000) {
          reject(new Error(replWsT('repl.ws.rawOkTimeout', { buffer: this.rawResponseBuffer })));
        } else {
          setTimeout(checkResponse, 10);
        }
      };
      checkResponse();
    });

    return response;
  }

  async sendFile(filename, content, init = false) {
    try {
      const bar = document.getElementById('myProgress');
      if (bar) {
        bar.style.transition = 'none';
        bar.style.opacity = 1;
        bar.style.width = '0%';
      }

      await this.enterRawREPL();
      await this.execRawCommand(`\r\n`);

      await this.sendData('import os\r');
      await this.sendData('from ubinascii import a2b_base64\r\n');

      if (filename.includes('/')) {
        const folder = filename.substring(0, filename.lastIndexOf('/'));
        await this.sendData('try:\r');
        await this.sendData(` os.stat("${folder}")\r`);
        await this.sendData('except OSError:\r');
        await this.execRawCommand(` os.mkdir("${folder}")\r`);
      }

      if (init === true) {
        await this.sendData('import gc\r');
        await this.sendData('import utime\r');

        await this.sendData('try:\r');
        await this.sendData(' run_code\r');
        await this.sendData('except NameError:\r');
        await this.sendData(' def run_code():\r');
        await this.sendData('  try:\r');
        await this.sendData('   gc.collect()\r');
        await this.sendData('   exec(open("idecode").read())\r');
        await this.sendData('  except KeyboardInterrupt:\r');
        await this.sendData("   print('" + replWsT('repl.common.programStopped') + "')\r");
        await this.sendData('   gc.collect()\r');
        await this.sendData('   stop_code()\r');

        await this.sendData(' def stop_code():\r');
        await this.sendData('  try:\r');
        await this.sendData('   on_exit()\r');
        await this.sendData('  except:\r');
        await this.execRawCommand('   utime.sleep_ms(0)\r');
        await delay(50);
      }

      await this.execRawCommand(`f = open("${filename}", "wb")`);
      await delay(50);

      const bytes = asWsBytes(content);
      const chunkSize = 64;

      function base64EncodeUint8Array(uint8array) {
        let binary = '';
        for (let i = 0; i < uint8array.length; i++) {
          binary += String.fromCharCode(uint8array[i]);
        }
        return btoa(binary);
      }

      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.slice(i, i + chunkSize);
        const base64Chunk = base64EncodeUint8Array(chunk);
        await this.execRawCommand(`f.write(a2b_base64("${base64Chunk}"))`);

        const percent = Math.min(Math.floor(((i + chunkSize) / bytes.length) * 100), 100);
        this.terminal.write('\r' + replWsT('repl.common.transferProgress', { percent }) + '   ');

        if (bar) {
          bar.style.transition = 'width 0.1s ease';
          bar.style.width = percent + '%';
        }
      }

      await this.execRawCommand('f.close()');
      await this.exitRawREPL();

      if (bar) {
        setTimeout(() => {
          bar.style.opacity = 0;
          bar.style.width = '0%';
        }, 500);
      }

      this.terminal.writeln('');
    } catch (error) {
      this.terminal.writeln('**' + replWsT('repl.ws.sendFileError', { error: error.message || String(error) }) + '**');
      try { await this.exitRawREPL(); } catch (_) {}
      throw error;
    }
  }

  fmEnable(on){ this.fm_buf_enabled = !!on; }
  fmClear(){ this.fm_in_buffer = ''; }
  fmPeek(){ return this.fm_in_buffer; }
  fmTakeAll(){ const s = this.fm_in_buffer; this.fm_in_buffer = ''; return s; }
}
