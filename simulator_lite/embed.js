const MODULE_VERSION = new URL(import.meta.url).searchParams.get('v');
const moduleUrl = (path) => {
  const url = new URL(path, import.meta.url);
  if (MODULE_VERSION) url.searchParams.set('v', MODULE_VERSION);
  return url.href;
};
const [
  { Scene },
  { SIMULATOR_STYLES },
  { validateConfig },
  { RpcClient, rpcError },
  { IndexedDbOverlayStore },
  { emptyOverlay, normaliseOverlay, overlayForTransfer },
  {
    combineJoystickKeyboardStates,
    isJoystickKeyboardCode,
    joystickKeyboardState,
    normaliseJoystickKeyboardState,
  },
] = await Promise.all([
  import(moduleUrl('./core/scene.js')),
  import(moduleUrl('./core/styles.js')),
  import(moduleUrl('./core/config.js')),
  import(moduleUrl('./core/rpc.js')),
  import(moduleUrl('./core/fs-store.js')),
  import(moduleUrl('./runtime/fs-overlay.js')),
  import(moduleUrl('./core/joystick-keyboard.js')),
]);

const MAX_GPIO = 64;
const DHT_TEMPERATURE_BASE = 129;
const DHT_HUMIDITY_BASE = DHT_TEMPERATURE_BASE + MAX_GPIO;
const SIGNAL_SLOTS = DHT_HUMIDITY_BASE + MAX_GPIO;
const HTTP_CONTROL_SLOTS = 4;
const HTTP_CONTROL_BYTES = Int32Array.BYTES_PER_ELEMENT * HTTP_CONTROL_SLOTS;
const HTTP_MAX_RESPONSE_BYTES = 1024 * 1024;
const PROTOCOL_VERSION = 1;
const INTERRUPT_SLOT = 0;
const DIGITAL_BASE = 1;
const ADC_BASE = 65;
const MAX_CONSOLE_CHARS = 120000;

const DEFAULT_CONFIG_URL = new URL('./config/default.json', import.meta.url);
const DEFAULT_FS_BASE = new URL('./filesystem/', import.meta.url).href;

const DEFAULT_LABELS = {
  title: 'ESP IDE Simulator Lite',
  starting: 'Startuji…',
  run: 'Spustit',
  stop: 'Stop',
  restart: 'Restart',
  editor: 'MicroPython',
  console: 'Konzole / REPL',
  replAria: 'MicroPython REPL',
  ready: 'Připraveno · {files} souborů',
  running: 'Program běží',
  done: 'Program dokončen',
  interrupted: 'Program zastaven Ctrl+C',
  stopping: 'Zastavuji…',
  error: 'Chyba',
  runMarker: '\n> run\n',
  componentLed: 'LED\nGPIO {pin}',
  componentButton: 'Tlačítko GPIO {pin}',
  componentAdc: 'ADC GPIO {pin}',
  componentServo180: 'Servo 180°\nGPIO {pin}',
  componentServo360: 'Servo 360°\nGPIO {pin}',
  componentMotor: 'DC motor\nGPIO {in1} / {in2}',
  componentEncoder: 'Enkodér A{a} / B{b}\nSW{sw}',
  componentNeoPixel: 'NeoPixel GPIO {pin} / {count} LED',
  componentOled: 'OLED 128×64\nSDA{sda} / SCL{scl}',
  componentJoystick: 'Joystick X{x} / Y{y}\nSW{sw}',
  componentDht22: 'DHT22 GPIO {pin}',
  temperature: 'Teplota',
  humidity: 'Vlhkost',
  positionDegrees: '{value}°',
  speedPercent: '{value}%',
  encoderPosition: '{steps} kroků · {angle}°',
  press: 'Stisk',
  ledColor: 'Změnit barvu {label}',
  servoMode: 'Přepnout servo mezi 180° a 360°',
  unsupported: 'Nepodporovaný typ: {type}',
};

function asUrl(value, fallback) {
  return value ? new URL(value, import.meta.url).href : fallback;
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new TextEncoder().encode(String(value ?? ''));
}

export class SimulatorLiteController {
  constructor(container, options = {}) {
    if (!(container instanceof Element)) throw new TypeError('mountSimulator() očekává DOM element.');
    this.container = container;
    this.options = options;
    this.worker = null;
    this.scene = null;
    this.signals = null;
    this.httpControl = null;
    this.httpData = null;
    this.sharedSignals = false;
    this.programRunning = false;
    this.runAccepted = false;
    this.localJoystickKeys = new Set();
    this.hostJoystickKeyboardState = joystickKeyboardState();
    this._onJoystickKeyDown = (event) => this._handleJoystickKeyboardEvent(event, true);
    this._onJoystickKeyUp = (event) => this._handleJoystickKeyboardEvent(event, false);
    this._onJoystickBlur = () => this._resetLocalJoystickKeyboard();
    window.addEventListener('keydown', this._onJoystickKeyDown, true);
    window.addEventListener('keyup', this._onJoystickKeyUp, true);
    window.addEventListener('blur', this._onJoystickBlur);
    const indexedDB = Object.prototype.hasOwnProperty.call(options, 'indexedDB')
      ? options.indexedDB
      : globalThis.indexedDB;
    this.filesystemOverlay = emptyOverlay();
    this.filesystemStore = options.filesystemStore || new IndexedDbOverlayStore({
      indexedDB,
      key: options.persistenceKey || 'default',
    });
    this.filesystemStoreLoaded = false;
    this.filesystemSave = Promise.resolve();
    this.rpc = new RpcClient({
      send: (message, transfer) => {
        if (!this.worker) throw rpcError('RUNTIME_UNAVAILABLE', 'Worker simulátoru není spuštěný.');
        this.worker.postMessage(message, transfer);
      },
    });
    this.pending = this.rpc.pending;
    this.status = 'starting';
    this.labels = { ...DEFAULT_LABELS, ...(options.labels || {}) };
    if (options.compact) this.container.dataset.compact = 'true';
    this._renderShell();
    this.ready = this._boot();
  }

  _label(key, fallback = '', vars = {}) {
    const template = this.labels[key] ?? fallback;
    return String(template).replace(/\{(\w+)\}/g, (_, name) => (
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : `{${name}}`
    ));
  }

  _applyJoystickKeyboardState() {
    const local = joystickKeyboardState(this.localJoystickKeys);
    this.scene?.setJoystickKeyboardState(combineJoystickKeyboardStates(
      local,
      this.hostJoystickKeyboardState,
    ));
  }

  _handleJoystickKeyboardEvent(event, pressed) {
    const code = event.code || (event.key === ' ' ? 'Space' : event.key);
    if (!isJoystickKeyboardCode(code)) return;
    const wasHeld = this.localJoystickKeys.has(code);
    if (pressed && !this.programRunning) return;
    if (!pressed && !wasHeld) return;
    event.preventDefault();
    event.stopPropagation();
    if (pressed) this.localJoystickKeys.add(code);
    else this.localJoystickKeys.delete(code);
    this._applyJoystickKeyboardState();
  }

  _resetLocalJoystickKeyboard() {
    if (!this.localJoystickKeys.size) return;
    this.localJoystickKeys.clear();
    this._applyJoystickKeyboardState();
  }

  _resetJoystickKeyboard() {
    this.localJoystickKeys.clear();
    this.hostJoystickKeyboardState = joystickKeyboardState();
    this._applyJoystickKeyboardState();
  }

  setJoystickKeyboardState(state = {}) {
    this.hostJoystickKeyboardState = this.programRunning
      ? normaliseJoystickKeyboardState(state)
      : joystickKeyboardState();
    this._applyJoystickKeyboardState();
    return this;
  }

  _applyLabels() {
    if (!this.elements) return;
    const labels = this.elements;
    if (labels.title) labels.title.textContent = this._label('title', DEFAULT_LABELS.title);
    if (labels.run) labels.run.textContent = this._label('run', DEFAULT_LABELS.run);
    if (labels.stop) labels.stop.textContent = this._label('stop', DEFAULT_LABELS.stop);
    if (labels.restart) labels.restart.textContent = this._label('restart', DEFAULT_LABELS.restart);
    if (labels.editor) labels.editor.textContent = this._label('editor', DEFAULT_LABELS.editor);
    if (labels.consoleTitle) labels.consoleTitle.textContent = this._label('console', DEFAULT_LABELS.console);
    if (labels.replInput) labels.replInput.setAttribute('aria-label', this._label('replAria', DEFAULT_LABELS.replAria));
    if (this.status === 'starting' && labels.status) labels.status.textContent = this._label('starting', DEFAULT_LABELS.starting);
  }

  _renderShell() {
    this.shadow = this.container.shadowRoot || this.container.attachShadow({ mode: 'open' });
    const sceneOnly = !!this.options.sceneOnly;
    this.shadow.innerHTML = `
      <style>${SIMULATOR_STYLES}</style>
      <div class="lite-shell${sceneOnly ? ' scene-only' : ''}">
        ${sceneOnly ? '' : `
          <header class="lite-toolbar">
            <strong data-label-title></strong>
            <span class="lite-status" data-status>Startuji…</span>
            <div class="lite-actions">
              <button type="button" data-run></button>
              <button type="button" data-stop></button>
              <button type="button" data-restart></button>
            </div>
          </header>`}
        <div class="lite-layout">
          <section class="lite-scene-host" data-scene-host></section>
          ${sceneOnly ? '' : `
            <aside class="lite-tools">
              <label class="lite-editor" data-editor-wrap>
                <span data-editor-label></span>
                <textarea data-code spellcheck="false"></textarea>
              </label>
              <section class="lite-console-wrap" data-console-wrap>
                <div class="lite-console-title" data-console-title></div>
                <pre class="lite-console" data-console aria-live="polite"></pre>
                <div class="lite-repl-input-row">
                  <span class="lite-repl-caret" aria-hidden="true">›</span>
                  <input data-repl-input type="text" autocomplete="off" autocapitalize="off"
                    autocorrect="off" spellcheck="false">
                </div>
              </section>
            </aside>`}
        </div>
      </div>`;
    this.elements = {
      status: this.shadow.querySelector('[data-status]'),
      title: this.shadow.querySelector('[data-label-title]'),
      run: this.shadow.querySelector('[data-run]'),
      stop: this.shadow.querySelector('[data-stop]'),
      restart: this.shadow.querySelector('[data-restart]'),
      sceneHost: this.shadow.querySelector('[data-scene-host]'),
      editorWrap: this.shadow.querySelector('[data-editor-wrap]'),
      consoleWrap: this.shadow.querySelector('[data-console-wrap]'),
      editor: this.shadow.querySelector('[data-editor-label]'),
      consoleTitle: this.shadow.querySelector('[data-console-title]'),
      code: this.shadow.querySelector('[data-code]'),
      console: this.shadow.querySelector('[data-console]'),
      replInput: this.shadow.querySelector('[data-repl-input]'),
    };
    this._applyLabels();
    this.elements.run?.addEventListener('click', () => void this.run());
    this.elements.stop?.addEventListener('click', () => this.stop());
    this.elements.restart?.addEventListener('click', () => void this.restart());
    this.elements.replInput?.addEventListener('input', () => {
      const text = this.elements.replInput.value;
      this.elements.replInput.value = '';
      if (text) this._sendRepl(text);
    });
    this.elements.replInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this._sendRepl('\r');
      } else if (event.ctrlKey && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        // While a program is running Ctrl+C must use the interrupt slot
        // immediately; queueing it behind replProcessChar would be too late.
        if (this.programRunning) this.stop();
        else this._sendRepl('\x03');
      } else if (event.ctrlKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        this._sendRepl('\x04');
      } else if (event.key === 'Backspace' && !this.elements.replInput.value) {
        event.preventDefault();
        this._sendRepl('\x08');
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        this._sendRepl('\x1b[D');
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        this._sendRepl('\x1b[C');
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        this._sendRepl('\x1b[A');
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        this._sendRepl('\x1b[B');
      }
    });
    this.elements.console?.addEventListener('click', () => this.elements.replInput?.focus());
    if (this.elements.editorWrap && this.options.showEditor === false) this.elements.editorWrap.hidden = true;
    if (this.elements.consoleWrap && this.options.showConsole === false) this.elements.consoleWrap.hidden = true;
    if (this.elements.code) this.elements.code.value = this.options.initialCode || '';
  }

  _sendRepl(data) {
    void this.repl(data).catch((error) => {
      this._writeConsole(`${error?.message || error}\n`, 'stderr');
    });
  }

  async _loadConfig() {
    if (this.options.config && typeof this.options.config === 'object') return structuredClone(this.options.config);
    const url = asUrl(this.options.config, DEFAULT_CONFIG_URL.href);
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Konfiguraci simulátoru nelze načíst: ${response.status}`);
    return response.json();
  }

  async _loadFilesystemOverlay() {
    if (this.filesystemStoreLoaded) return;
    this.filesystemStoreLoaded = true;
    try {
      if (this.options.factoryResetOnBoot) {
        await this.filesystemStore.clear();
        this.options.factoryResetOnBoot = false;
      }
      this.filesystemOverlay = normaliseOverlay(await this.filesystemStore.load());
    } catch (error) {
      this.filesystemOverlay = emptyOverlay();
      this._writeConsole(`FS persistence: ${error?.message || error}\n`, 'stderr');
    }
  }

  _saveFilesystemOverlay(value) {
    try {
      this.filesystemOverlay = normaliseOverlay(value);
    } catch (error) {
      this._writeConsole(`FS overlay: ${error?.message || error}\n`, 'stderr');
      return;
    }
    this.filesystemSave = this.filesystemStore.save(this.filesystemOverlay).catch((error) => {
      this._writeConsole(`FS persistence: ${error?.message || error}\n`, 'stderr');
      this._emit({ type: 'persistence-error', text: error?.message || String(error) });
    });
  }

  async _boot() {
    await this._loadFilesystemOverlay();
    this.config = validateConfig(await this._loadConfig());
    this.scene?.destroy();
    this.scene = new Scene(this.elements.sceneHost, this.config, {
      assetBase: asUrl(this.options.assetBase, new URL('./assets/components/', import.meta.url).href),
      setDigital: (pin, value) => this.setDigital(pin, value),
      setAdc: (pin, value) => this.setAdc(pin, value),
      setDht: (pin, temperature, humidity) => this.setDht(pin, temperature, humidity),
      labels: this.labels,
    });
    await this._startWorker();
    return this;
  }

  async _startWorker() {
    this.sharedSignals = !!globalThis.crossOriginIsolated && typeof SharedArrayBuffer !== 'undefined';
    const buffer = this.sharedSignals
      ? new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * SIGNAL_SLOTS)
      : new ArrayBuffer(Int32Array.BYTES_PER_ELEMENT * SIGNAL_SLOTS);
    this.signals = new Int32Array(buffer);
    const httpBuffer = this.sharedSignals
      ? new SharedArrayBuffer(HTTP_CONTROL_BYTES + HTTP_MAX_RESPONSE_BYTES)
      : null;
    this.httpControl = httpBuffer ? new Int32Array(httpBuffer, 0, HTTP_CONTROL_SLOTS) : null;
    this.httpData = httpBuffer ? new Uint8Array(httpBuffer, HTTP_CONTROL_BYTES) : null;
    this.scene?.resetInputs();
    this.worker?.terminate();
    const workerUrl = new URL('./worker.js', import.meta.url);
    if (MODULE_VERSION) workerUrl.searchParams.set('v', MODULE_VERSION);
    const worker = new Worker(workerUrl, { type: 'module' });
    this.worker = worker;
    const persisted = overlayForTransfer(this.filesystemOverlay);
    let initSent = false;
    worker.addEventListener('message', (event) => {
      if (this.worker !== worker) return;
      if (event.data?.type === 'bootstrap-ready') {
        if (initSent) return;
        initSent = true;
        worker.postMessage({
          type: 'init',
          signals: this.signals.buffer,
          httpBuffer,
          fsBase: asUrl(this.options.fsBase, DEFAULT_FS_BASE),
          cacheVersion: MODULE_VERSION,
          filesystemOverlay: persisted.overlay,
          filesystemPersistence: this.filesystemStore.available ? 'indexeddb-overlay' : 'memory-overlay',
          hardware: this.config.components,
        }, persisted.transfer);
        return;
      }
      this._handleWorker(event.data);
    });
    worker.addEventListener('error', (event) => {
      if (this.worker !== worker) return;
      const error = new Error(event.message || 'Worker simulátoru selhal.');
      this.rpc.rejectAll(rpcError('RUNTIME_WORKER_ERROR', error.message));
      this._setStatus(error.message, true);
      this._rejectReady?.(error);
      this._rejectReady = null;
    });

    const ready = new Promise((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
    });
    const readyTimer = setTimeout(() => {
      this._rejectReady?.(rpcError('RUNTIME_READY_TIMEOUT', 'Worker simulátoru se nepřipravil včas.'));
      this._rejectReady = null;
    }, 20_000);
    try {
      await ready;
    } catch (error) {
      this.worker?.terminate();
      this.worker = null;
      throw error;
    } finally {
      clearTimeout(readyTimer);
    }
    // The host may deliver its first appearance message while the Worker is
    // still loading.  Re-apply labels after Scene creation so a late theme or
    // locale update can never leave component captions in the old language.
    this.scene?.setLabels(this.labels);
    return this;
  }

  _handleWorker(message) {
    if (message.type === 'http-request') {
      void this._handleHttpRequest(message);
      return;
    }
    if (message.type === 'filesystem-overlay') {
      this._saveFilesystemOverlay(message.overlay);
      return;
    }
    if (message.type === 'persistence-error') {
      this._writeConsole(`FS persistence: ${message.text}\n`, 'stderr');
    }
    if (message.type === 'stdout') this._writeConsole(message.text, 'stdout');
    if (message.type === 'stderr') this._writeConsole(message.text, 'stderr');
    if (message.type === 'output') this.scene?.handleOutput(message);
    if (message.type === 'neopixel') this.scene?.handleNeoPixel(message);
    if (message.type === 'oled-frame') this.scene?.handleOledFrame(message);
    if (message.type === 'startup') this._setStatus(`${this._label('starting', DEFAULT_LABELS.starting)} ${message.file}`);
    if (message.type === 'running') {
      this.programRunning = true;
      this._setStatus(this._label('running', DEFAULT_LABELS.running));
    }
    if (message.type === 'repl-running') this.programRunning = true;
    if (message.type === 'repl-done') {
      this.programRunning = false;
      this._resetJoystickKeyboard();
    }
    if (message.type === 'done') {
      this.programRunning = false;
      this.runAccepted = false;
      this._resetJoystickKeyboard();
      this._setStatus(this._label('done', DEFAULT_LABELS.done));
    }
    if (message.type === 'interrupted') {
      this.programRunning = false;
      this.runAccepted = false;
      this._resetJoystickKeyboard();
      this._setStatus(this._label('interrupted', DEFAULT_LABELS.interrupted));
    }
    if (message.type === 'error') {
      this.programRunning = false;
      this.runAccepted = false;
      this._resetJoystickKeyboard();
      if (message.requestId != null) this.rpc.reject(message.requestId, new Error(message.text));
      else {
        this._writeConsole(message.text, 'stderr');
        this._rejectReady?.(new Error(message.text));
        this._rejectReady = null;
      }
      this._setStatus(this._label('error', DEFAULT_LABELS.error), true);
    }
    if (message.type === 'ready') {
      if (message.protocolVersion !== PROTOCOL_VERSION) {
        const error = new Error(`Neznámá verze protokolu simulátoru: ${message.protocolVersion}.`);
        this._setStatus(error.message, true);
        this._rejectReady?.(error);
        this._rejectReady = null;
        return;
      }
      this._setStatus(this._label('ready', DEFAULT_LABELS.ready, { files: message.files }));
      this._resolveReady?.(message);
      this._resolveReady = null;
      this._rejectReady = null;
    }
    if (message.type === 'response') {
      this.rpc.resolve(message);
      return;
    }
    this._emit(message);
  }

  async _handleHttpRequest(message) {
    if (!this.httpControl || !this.httpData) return;
    const requestId = Number(message.httpRequestId);
    const finish = (state, statusCode, bytes) => {
      if (Atomics.load(this.httpControl, 1) !== requestId || Atomics.load(this.httpControl, 0) !== 0) return;
      const payload = bytes.byteLength > this.httpData.byteLength
        ? new TextEncoder().encode(`HTTP response exceeds ${this.httpData.byteLength} bytes.`)
        : bytes;
      this.httpData.fill(0, 0, Math.min(this.httpData.byteLength, payload.byteLength));
      this.httpData.set(payload.subarray(0, this.httpData.byteLength), 0);
      Atomics.store(this.httpControl, 2, Number(statusCode) || 0);
      Atomics.store(this.httpControl, 3, Math.min(payload.byteLength, this.httpData.byteLength));
      Atomics.store(this.httpControl, 0, state);
      Atomics.notify(this.httpControl, 0);
    };
    try {
      if (String(message.method || 'GET').toUpperCase() !== 'GET') {
        throw new Error('Simulator Lite currently supports HTTP GET only.');
      }
      const target = new URL(String(message.url || ''));
      if (target.protocol !== 'http:' && target.protocol !== 'https:') {
        throw new Error('Only HTTP and HTTPS URLs are allowed.');
      }
      let requestUrl = target;
      if (target.origin !== location.origin) {
        requestUrl = new URL('./http-proxy.php', import.meta.url);
        requestUrl.searchParams.set('url', target.href);
      }
      const response = await fetch(requestUrl, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'omit',
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > this.httpData.byteLength) {
        throw new Error(`HTTP response exceeds ${this.httpData.byteLength} bytes.`);
      }
      finish(1, response.status, bytes);
    } catch (error) {
      finish(-1, 0, new TextEncoder().encode(error?.message || String(error)));
    }
  }

  _emit(detail) {
    this.container.dispatchEvent(new CustomEvent('esp-simulator-lite', { detail }));
    this.options.onEvent?.(detail);
  }

  _setStatus(text, error = false) {
    this.status = error ? 'error' : 'ready';
    if (this.elements?.status) {
      this.elements.status.textContent = text;
      this.elements.status.classList.toggle('is-error', error);
    }
  }

  setAppearance(appearance = {}) {
    const root = document.documentElement;
    if (appearance.theme) {
      const theme = String(appearance.theme);
      this.container.dataset.theme = theme;
      root.dataset.theme = theme;
    }
    if (appearance.vars && typeof appearance.vars === 'object') {
      for (const [name, value] of Object.entries(appearance.vars)) {
        if (name.startsWith('--') && value != null) {
          this.container.style.setProperty(name, String(value));
          root.style.setProperty(name, String(value));
        }
      }
    }
    if (appearance.labels && typeof appearance.labels === 'object') {
      this.labels = { ...this.labels, ...appearance.labels };
      this._applyLabels();
      this.scene?.setLabels(this.labels);
    }
    return this;
  }

  _writeConsole(text, stream = 'stdout') {
    const payload = { text: String(text ?? ''), stream };
    const adapter = this.options.consoleAdapter;
    if (typeof adapter === 'function') adapter(payload);
    else adapter?.write?.(payload);
    if (!adapter && this.elements.console) {
      this.elements.console.classList.toggle('has-error', stream === 'stderr');
      const next = this.elements.console.textContent + payload.text;
      this.elements.console.textContent = next.length > MAX_CONSOLE_CHARS
        ? next.slice(-MAX_CONSOLE_CHARS)
        : next;
      this.elements.console.scrollTop = this.elements.console.scrollHeight;
    }
  }

  clearConsole() {
    if (this.elements.console) this.elements.console.textContent = '';
    this.options.consoleAdapter?.clear?.();
  }

  getCode() {
    return this.elements.code?.value || '';
  }

  setCode(code) {
    if (this.elements.code) this.elements.code.value = String(code ?? '');
    return this;
  }

  async run(code) {
    await this.ready;
    const provided = this.options.codeProvider ? await this.options.codeProvider() : code;
    const source = provided === undefined ? this.getCode() : String(provided);
    if (!this.options.sceneOnly) {
      this._writeConsole(this._label('runMarker', DEFAULT_LABELS.runMarker), 'stdout');
    }
    await this._request('run', { code: source });
    this.runAccepted = true;
    return this;
  }

  async exec(code) {
    await this.ready;
    await this._request('exec', { code: String(code ?? '') });
    return this;
  }

  async repl(data) {
    await this.ready;
    await this._request('repl', { data: String(data ?? '') });
    return this;
  }

  stop() {
    this._resetJoystickKeyboard();
    if (!this.programRunning && !this.runAccepted) {
      this._setStatus(this._label('readyShort', 'Připraveno'));
      return;
    }
    if (!this.sharedSignals && this.programRunning) {
      this._setStatus(this._label('stopping', DEFAULT_LABELS.stopping));
      const restart = this.restart();
      restart.then(() => this._setStatus(this._label('interrupted', DEFAULT_LABELS.interrupted))).catch(() => {});
      return;
    }
    if (this.signals && this.sharedSignals) Atomics.store(this.signals, INTERRUPT_SLOT, 1);
    this.worker?.postMessage({ type: 'interrupt' });
    this._setStatus(this._label('stopping', DEFAULT_LABELS.stopping));
  }

  suspend() {
    this._resetJoystickKeyboard();
    if (this.programRunning || this.runAccepted) this.stop();
    this.scene?.suspend();
  }

  resume() {
    this.scene?.resume();
    return this;
  }

  async restart() {
    this.worker?.terminate();
    this.worker = null;
    this.programRunning = false;
    this.runAccepted = false;
    this._resetJoystickKeyboard();
    this.rpc.rejectAll(rpcError('RUNTIME_RESTARTED', 'Runtime se restartuje.'));
    this.clearConsole();
    this.ready = this._startWorker();
    await this.ready;
    return this;
  }

  async factoryResetFilesystem() {
    this.worker?.terminate();
    this.worker = null;
    this.programRunning = false;
    this.runAccepted = false;
    this._resetJoystickKeyboard();
    this.rpc.rejectAll(rpcError('RUNTIME_RESTARTED', 'Obnovuje se tovární filesystém.'));
    this.filesystemOverlay = emptyOverlay();
    await this.filesystemStore.clear();
    this.clearConsole();
    this.ready = this._startWorker();
    await this.ready;
    return this;
  }

  async flushFilesystemPersistence() {
    await this.filesystemSave;
    return this;
  }

  previewOledFrame(value) {
    const definition = this.config?.components?.find(
      (component) => component.type === 'oled-ssd1306',
    );
    if (!definition) throw new Error('OLED komponenta není v konfiguraci simulátoru.');
    const width = Number(definition.appearance?.width) || 128;
    const height = Number(definition.appearance?.height) || 64;
    const bytes = asBytes(value).slice();
    const expected = width * Math.ceil(height / 8);
    if (bytes.byteLength !== expected) {
      throw new Error(`OLED framebuffer má ${bytes.byteLength} B, očekáváno ${expected} B.`);
    }
    this.scene?.handleOledFrame({
      componentId: definition.id,
      width,
      height,
      displayOn: true,
      inverted: false,
      data: bytes,
    });
    return this;
  }

  setDigital(pin, value) {
    const number = Number(pin);
    if (!this.signals || !Number.isInteger(number) || number < 0 || number >= 64) return;
    if (this.sharedSignals) {
      Atomics.store(this.signals, DIGITAL_BASE + number, value ? 1 : 0);
      Atomics.notify(this.signals, DIGITAL_BASE + number);
    } else {
      this.worker?.postMessage({ type: 'set-digital', pin: number, value: value ? 1 : 0 });
    }
  }

  setAdc(pin, value) {
    const number = Number(pin);
    if (!this.signals || !Number.isInteger(number) || number < 0 || number >= 64) return;
    const bounded = Math.max(0, Math.min(65535, Number(value) || 0));
    if (this.sharedSignals) {
      Atomics.store(this.signals, ADC_BASE + number, bounded);
      Atomics.notify(this.signals, ADC_BASE + number);
    } else {
      this.worker?.postMessage({ type: 'set-adc', pin: number, value: bounded });
    }
  }

  setDht(pin, temperature, humidity) {
    const number = Number(pin);
    if (!this.signals || !Number.isInteger(number) || number < 0 || number >= MAX_GPIO) return;
    const temperatureValue = Math.round(Number(temperature) * 1000);
    const humidityValue = Math.round(Number(humidity) * 1000);
    if (this.sharedSignals) {
      Atomics.store(this.signals, DHT_TEMPERATURE_BASE + number, temperatureValue);
      Atomics.store(this.signals, DHT_HUMIDITY_BASE + number, humidityValue);
      Atomics.notify(this.signals, DHT_TEMPERATURE_BASE + number);
    } else {
      this.worker?.postMessage({
        type: 'set-dht',
        pin: number,
        temperature: Number(temperature),
        humidity: Number(humidity),
      });
    }
  }

  _request(type, payload = {}, transfer = []) {
    return this.rpc.request(type, payload, transfer);
  }

  async writeFile(path, data) {
    await this.ready;
    const bytes = asBytes(data);
    const copy = bytes.slice();
    await this._request('write-file', { path, data: copy.buffer }, [copy.buffer]);
  }

  async readFile(path) {
    await this.ready;
    const response = await this._request('read-file', { path });
    return new Uint8Array(response.data);
  }

  async listFiles(path = '/') {
    await this.ready;
    const response = await this._request('list-files', { path });
    return response.files || [];
  }

  destroy() {
    this.rpc.rejectAll(rpcError('RUNTIME_DESTROYED', 'Runtime simulátoru byl zrušen.'));
    this._rejectReady?.(rpcError('RUNTIME_DESTROYED', 'Runtime simulátoru byl zrušen.'));
    this._rejectReady = null;
    this.worker?.terminate();
    this.worker = null;
    this._resetJoystickKeyboard();
    window.removeEventListener('keydown', this._onJoystickKeyDown, true);
    window.removeEventListener('keyup', this._onJoystickKeyUp, true);
    window.removeEventListener('blur', this._onJoystickBlur);
    this.scene?.destroy();
    this.scene = null;
    this.runAccepted = false;
    void this.filesystemStore.close?.();
  }
}

export function mountSimulatorLite(container, options = {}) {
  return new SimulatorLiteController(container, options);
}

export default mountSimulatorLite;
