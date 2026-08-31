const MODULE_VERSION = new URL(import.meta.url).searchParams.get('v');
const moduleUrl = (path) => {
  const url = new URL(path, import.meta.url);
  if (MODULE_VERSION) url.searchParams.set('v', MODULE_VERSION);
  return url.href;
};
const [
  { loadMicroPython },
  { installTextModule, loadFilesList },
  {
    applyFilesystemOverlay,
    captureFilesystem,
    cloneOverlay,
    diffFilesystem,
    emptyOverlay,
    HIDDEN_RUNTIME_ROOTS,
    overlayForTransfer,
    overlaysEqual,
    pruneEmscriptenFilesystem,
  },
  { I2cRegistry },
] = await Promise.all([
  import(moduleUrl('./vendor/micropython.mjs')),
  import(moduleUrl('./runtime/fs-loader.js')),
  import(moduleUrl('./runtime/fs-overlay.js')),
  import(moduleUrl('./core/i2c.js')),
]);

const MAX_GPIO = 64;
const CONTROL_INTERRUPT = 0;
const DIGITAL_BASE = 1;
const ADC_BASE = DIGITAL_BASE + MAX_GPIO;
const DHT_TEMPERATURE_BASE = ADC_BASE + MAX_GPIO;
const DHT_HUMIDITY_BASE = DHT_TEMPERATURE_BASE + MAX_GPIO;
const SIGNAL_SLOTS = DHT_HUMIDITY_BASE + MAX_GPIO;
const HTTP_CONTROL_SLOTS = 4;
const HTTP_CONTROL_BYTES = Int32Array.BYTES_PER_ELEMENT * HTTP_CONTROL_SLOTS;

const MACHINE_URL = moduleUrl('./runtime/machine.py');
const COMPAT_URL = moduleUrl('./runtime/wasm-compat.py');
const NEOPIXEL_URL = moduleUrl('./runtime/neopixel.py');
const NETWORK_URL = moduleUrl('./runtime/network.py');
const NTPTIME_URL = moduleUrl('./runtime/ntptime.py');
const DHT_URL = moduleUrl('./runtime/dht.py');
const UREQUESTS_URL = moduleUrl('./runtime/urequests.py');

let mp = null;
let signals = null;
let httpControl = null;
let httpData = null;
let httpRequestSequence = 0;
let stdoutBuffer = [];
let stdoutDropped = 0;
let stdoutPendingChars = 0;
let stderrBuffer = [];
let stderrDropped = 0;
let stderrPendingChars = 0;
let lastStdoutFlush = 0;
let lastStderrFlush = 0;
let interruptDelivered = false;
let replInitialised = false;
let sharedSignals = false;
let interruptRequested = false;
let vmState = 'BOOTING';
let vmQueue = Promise.resolve();
let queuedRun = false;
let replPrompt = 'primary';
let replMode = 'friendly';
let replLineBuffer = '';
let replPromptTail = '';
let replEscapeBuffer = '';
const pendingHardwareOutputs = new Map();
const pendingNeoPixels = new Map();
const pendingOledFrames = new Map();
let hardwareFlushTimer = null;
let lastHardwareFlush = 0;
let i2cRegistry = null;
let externallyDrivenPins = new Set();
let baseFilesystemSnapshot = null;
let lastPublishedOverlay = emptyOverlay();
let lastOverlayPublish = 0;

const OUTPUT_INTERVAL_MS = 50;
const MAX_PENDING_OUTPUT_CHARS = 32768;
const HARDWARE_EVENT_INTERVAL_MS = 16;
const FILESYSTEM_PUBLISH_INTERVAL_MS = 500;
const PROTOCOL_VERSION = 1;
const RUNTIME_VERSION = '1.28.0-6';
const CAPABILITIES = Object.freeze({
  gpio: true,
  gpio_pull: true,
  pwm: true,
  adc: true,
  adc_read_uv: true,
  dht: true,
  network: 'virtual-connected',
  rtc: 'host-clock',
  http_requests: 'fetch-proxy-get',
  irq: 'cooperative-edges-and-levels',
  neopixel: true,
  i2c: 'registry',
  oled_ssd1306: true,
  timing: 'cooperative-5ms-i2c-clocked',
  sockets: false,
  filesystem: 'persistent-overlay',
  factory_reset_filesystem: true,
  raw_repl: true,
  filemanager_transport: 'repl-buffer',
});

const textDecoder = new TextDecoder();

function post(type, payload = {}, transfer = []) {
  self.postMessage({ type, ...payload }, transfer);
}

function responseOk(requestId, payload = {}) {
  if (requestId == null) return;
  const { transfer = [], ...body } = payload;
  post('response', { requestId, ok: true, ...body }, transfer);
}

function responseError(requestId, error) {
  if (requestId == null) return;
  post('response', {
    requestId,
    ok: false,
    error: error?.stack || error?.message || String(error),
  });
}

function busyError() {
  return new Error(`BUSY: MicroPython VM je ve stavu ${vmState}.`);
}

function isVmBusy() {
  return queuedRun || vmState === 'RUNNING' || vmState === 'STOPPING';
}

function enqueueRequest(data, operation) {
  if (vmState === 'FAILED') {
    responseError(data.requestId, new Error('RUNTIME_FAILED: MicroPython runtime selhal.'));
    return;
  }
  if (isVmBusy()) {
    responseError(data.requestId, busyError());
    return;
  }
  const task = vmQueue.then(operation);
  vmQueue = task.catch(() => {});
  task.then(
    (payload) => responseOk(data.requestId, payload),
    (error) => responseError(data.requestId, error),
  );
}

function enqueueRun(data) {
  if (vmState === 'FAILED') {
    responseError(data.requestId, new Error('RUNTIME_FAILED: MicroPython runtime selhal.'));
    return;
  }
  if (isVmBusy()) {
    responseError(data.requestId, busyError());
    return;
  }
  interruptRequested = false;
  if (sharedSignals) Atomics.store(signals, CONTROL_INTERRUPT, 0);
  queuedRun = true;
  responseOk(data.requestId, { accepted: true });
  post('run-accepted');
  const task = vmQueue.then(async () => {
    queuedRun = false;
    await runCode(data.code);
  });
  vmQueue = task.catch((error) => {
    queuedRun = false;
    vmState = 'FAILED';
    post('error', { text: error?.stack || error?.message || String(error) });
  });
}

function pinIndex(pin) {
  const number = Number(pin);
  return Number.isInteger(number) && number >= 0 && number < MAX_GPIO
    ? DIGITAL_BASE + number
    : -1;
}

function adcIndex(pin) {
  const number = Number(pin);
  return Number.isInteger(number) && number >= 0 && number < MAX_GPIO
    ? ADC_BASE + number
    : -1;
}

function dhtIndex(base, pin) {
  const number = Number(pin);
  return Number.isInteger(number) && number >= 0 && number < MAX_GPIO
    ? base + number
    : -1;
}

function flushStdout(force = false) {
  if (!stdoutPendingChars && !stdoutDropped) return;
  if (!force && performance.now() - lastStdoutFlush < OUTPUT_INTERVAL_MS) return;
  const skipped = stdoutDropped ? `[console skipped ${stdoutDropped} fast characters]\r\n` : '';
  post('stdout', { text: skipped + stdoutBuffer.join('') });
  stdoutBuffer = [];
  stdoutPendingChars = 0;
  stdoutDropped = 0;
  lastStdoutFlush = performance.now();
}

function flushStderr(force = false) {
  if (!stderrPendingChars && !stderrDropped) return;
  if (!force && performance.now() - lastStderrFlush < OUTPUT_INTERVAL_MS) return;
  const skipped = stderrDropped ? `[console skipped ${stderrDropped} error characters]\r\n` : '';
  post('stderr', { text: skipped + stderrBuffer.join('') });
  stderrBuffer = [];
  stderrPendingChars = 0;
  stderrDropped = 0;
  lastStderrFlush = performance.now();
}

function decodeOutput(value) {
  if (value instanceof Uint8Array) return textDecoder.decode(value);
  if (value instanceof ArrayBuffer) return textDecoder.decode(new Uint8Array(value));
  return String(value ?? '');
}

function appendOutput(stream, value) {
  const text = decodeOutput(value);
  if (!text) return;
  const chunks = stream === 'stdout' ? stdoutBuffer : stderrBuffer;
  chunks.push(text);
  if (stream === 'stdout') stdoutPendingChars += text.length;
  else stderrPendingChars += text.length;
  const pendingChars = stream === 'stdout' ? stdoutPendingChars : stderrPendingChars;
  if (pendingChars > MAX_PENDING_OUTPUT_CHARS) {
    // The WASM stdout callback is byte-oriented in REPL mode. Keep chunks in
    // an array so a fast loop does not repeatedly copy a growing string.
    const combined = chunks.join('');
    const kept = combined.slice(-MAX_PENDING_OUTPUT_CHARS);
    const dropped = combined.length - kept.length;
    chunks.length = 0;
    chunks.push(kept);
    if (stream === 'stdout') {
      stdoutPendingChars = kept.length;
      stdoutDropped += dropped;
    } else {
      stderrPendingChars = kept.length;
      stderrDropped += dropped;
    }
  }
}

function handleStdout(value) {
  appendOutput('stdout', value);
  trackReplPrompt(decodeOutput(value));
  // Do not call performance.now()/postMessage for every byte. Cooperative
  // sleep checkpoints call flushStdout(), and command boundaries force it.
}

function handleStderr(value) {
  appendOutput('stderr', value);
}

function trackReplPrompt(value) {
  replPromptTail = (replPromptTail + String(value || '')).slice(-32);
  if (replPromptTail.endsWith('>>> ')) replPrompt = 'primary';
  else if (replPromptTail.endsWith('... ')) replPrompt = 'continuation';
}

function restoreReplPrompt() {
  // run_code() is invoked directly from the Worker rather than typed into
  // the WASM REPL. Restore the prompt bytes that a physical friendly REPL
  // would print when that command returns.
  appendOutput('stdout', '\r\n>>> ');
  replPromptTail = '>>> ';
  replPrompt = 'primary';
  replMode = 'friendly';
  replLineBuffer = '';
  flushStdout(true);
}

function updateReplLine(character) {
  if (replEscapeBuffer) {
    replEscapeBuffer += character;
    if (/[A-Za-z~]$/.test(character)) {
      if (replEscapeBuffer === '\x1b[A' || replEscapeBuffer === '\x1b[B') {
        // History navigation makes the line contents unknown to this small
        // tracker; let MicroPython evaluate it instead of treating it as blank.
        replLineBuffer = '__history__';
      }
      replEscapeBuffer = '';
    }
    return;
  }
  if (character === '\x1b') {
    replEscapeBuffer = character;
    return;
  }
  if (character === '\x08' || character === '\x7f') {
    replLineBuffer = Array.from(replLineBuffer).slice(0, -1).join('');
    return;
  }
  if (character === '\r' || character === '\n' || character === '\x03' || character === '\x04') return;
  if (character >= ' ') replLineBuffer += character;
}

function inputValue(pin) {
  const index = pinIndex(pin);
  return index >= 0 && signals ? signalLoad(index) : 0;
}

function signalLoad(index) {
  return sharedSignals ? Atomics.load(signals, index) : signals[index];
}

function signalStore(index, value) {
  if (sharedSignals) Atomics.store(signals, index, value);
  else signals[index] = value;
}

function collectExternallyDrivenPins(hardware) {
  const pins = new Set();
  for (const component of hardware || []) {
    const connections = component?.connections || {};
    const names = component?.type === 'button'
      ? ['pin']
      : component?.type === 'rotary-encoder'
        ? ['aPin', 'bPin', 'buttonPin']
        : component?.type === 'joystick'
          ? ['buttonPin']
          : [];
    for (const name of names) {
      const pin = Number(connections[name]);
      if (Number.isInteger(pin) && pin >= 0 && pin < MAX_GPIO) pins.add(pin);
    }
  }
  return pins;
}

function flushHardwareEvents(force = false) {
  const now = performance.now();
  if (!force && now - lastHardwareFlush < HARDWARE_EVENT_INTERVAL_MS) return;
  if (hardwareFlushTimer !== null) clearTimeout(hardwareFlushTimer);
  hardwareFlushTimer = null;
  i2cRegistry?.flush();
  for (const event of pendingHardwareOutputs.values()) post('output', event);
  for (const event of pendingNeoPixels.values()) post('neopixel', event);
  for (const frame of pendingOledFrames.values()) {
    const data = frame.data.slice().buffer;
    post('oled-frame', { ...frame, data }, [data]);
  }
  pendingHardwareOutputs.clear();
  pendingNeoPixels.clear();
  pendingOledFrames.clear();
  if (hardwareFlushTimer !== null) clearTimeout(hardwareFlushTimer);
  hardwareFlushTimer = null;
  lastHardwareFlush = now;
}

function scheduleHardwareFlush() {
  if (hardwareFlushTimer !== null) return;
  hardwareFlushTimer = setTimeout(flushHardwareEvents, HARDWARE_EVENT_INTERVAL_MS);
}

function queueHardwareOutput(event) {
  pendingHardwareOutputs.set(Number(event.pin), event);
  scheduleHardwareFlush();
}

function queueNeoPixel(event) {
  pendingNeoPixels.set(Number(event.pin), event);
  scheduleHardwareFlush();
}

function queueOledFrame(frame) {
  pendingOledFrames.set(frame.componentId, { ...frame, data: frame.data.slice() });
  scheduleHardwareFlush();
}

function outputDigital(pin, value) {
  const number = Number(pin);
  const index = pinIndex(number);
  const digital = value ? 1 : 0;
  if (index >= 0 && signals) signalStore(index, digital);
  queueHardwareOutput({ kind: 'digital', pin: number, value: digital, duty: digital ? 65535 : 0, frequency: 0 });
}

function outputPwm(pin, duty, frequency) {
  const number = Number(pin);
  const boundedDuty = Math.max(0, Math.min(65535, Number(duty) || 0));
  const index = pinIndex(number);
  if (index >= 0 && signals) signalStore(index, boundedDuty > 0 ? 1 : 0);
  queueHardwareOutput({
    kind: 'pwm',
    pin: number,
    value: boundedDuty > 0 ? 1 : 0,
    duty: boundedDuty,
    frequency: Number(frequency) || 0,
  });
}

function interruptPoll() {
  if (!signals) return false;
  const requested = sharedSignals
    ? Atomics.exchange(signals, CONTROL_INTERRUPT, 0) === 1
    : interruptRequested;
  interruptRequested = false;
  if (!requested) return false;
  interruptDelivered = true;
  if (vmState === 'RUNNING') vmState = 'STOPPING';
  if (mp?._module?._mp_sched_keyboard_interrupt) {
    mp._module._mp_sched_keyboard_interrupt();
    return true;
  }
  return false;
}

function createHardwareBridge() {
  return {
    pin_init(pin, mode, pull, value) {
      const index = pinIndex(pin);
      if (index < 0 || !signals) return;
      if (value !== null && value !== undefined) {
        signalStore(index, value ? 1 : 0);
      } else if (!externallyDrivenPins.has(Number(pin))) {
        if (Number(pull) === 1) signalStore(index, 1);
        if (Number(pull) === 2) signalStore(index, 0);
      }
    },
    pin_read: inputValue,
    pin_write: outputDigital,
    pin_irq() {},
    pwm_write: outputPwm,
    adc_read(pin) {
      const index = adcIndex(pin);
      return index >= 0 && signals ? signalLoad(index) : 0;
    },
    dht_read(pin) {
      const temperatureIndex = dhtIndex(DHT_TEMPERATURE_BASE, pin);
      const humidityIndex = dhtIndex(DHT_HUMIDITY_BASE, pin);
      if (temperatureIndex < 0 || humidityIndex < 0 || !signals) return null;
      return [signalLoad(temperatureIndex), signalLoad(humidityIndex)];
    },
    http_request(method, url, timeoutMs) {
      if (!httpControl || !httpData) {
        throw new Error('HTTP requests require SharedArrayBuffer support.');
      }
      const requestId = ++httpRequestSequence;
      Atomics.store(httpControl, 0, 0);
      Atomics.store(httpControl, 1, requestId);
      Atomics.store(httpControl, 2, 0);
      Atomics.store(httpControl, 3, 0);
      post('http-request', {
        httpRequestId: requestId,
        method: String(method || 'GET').toUpperCase(),
        url: String(url || ''),
      });
      const waitResult = Atomics.wait(
        httpControl,
        0,
        0,
        Math.max(1, Number(timeoutMs) || 10000),
      );
      if (waitResult === 'timed-out') {
        Atomics.compareExchange(httpControl, 0, 0, -2);
        throw new Error(`HTTP request timed out: ${url}`);
      }
      const state = Atomics.load(httpControl, 0);
      const length = Math.max(0, Math.min(httpData.byteLength, Atomics.load(httpControl, 3)));
      const payload = httpData.slice(0, length);
      if (state !== 1) {
        throw new Error(textDecoder.decode(payload) || `HTTP request failed: ${url}`);
      }
      return [Atomics.load(httpControl, 2), payload];
    },
    poll_interrupt: interruptPoll,
    i2c_init(id, scl, sda) {
      return i2cRegistry.initialise(id, scl, sda);
    },
    i2c_scan(key) {
      return i2cRegistry.scan(key);
    },
    i2c_writeto(key, address, data) {
      const written = i2cRegistry.writeto(key, address, data);
      scheduleHardwareFlush();
      return written;
    },
    i2c_readfrom(key, address, length) {
      return i2cRegistry.readfrom(key, address, length);
    },
    i2c_writeto_mem(key, address, memoryAddress, data, addressSize) {
      const written = i2cRegistry.writetoMem(key, address, memoryAddress, data, addressSize);
      scheduleHardwareFlush();
      return written;
    },
    i2c_readfrom_mem(key, address, memoryAddress, length, addressSize) {
      return i2cRegistry.readfromMem(key, address, memoryAddress, length, addressSize);
    },
    spi_write(id, data) {
      post('spi-write', { id: Number(id), data: Array.from(new Uint8Array(data)) });
    },
    flush_stdout() {
      // A timer-only flush would hide final bytes before an infinite
      // sleep_ms(0) loop, so machine._poll() invokes this checkpoint too.
      // The WASM call can keep the Worker stack active indefinitely; browser
      // timers therefore cannot be the only path that publishes GPIO/OLED.
      flushStdout();
      flushStderr();
      flushHardwareEvents();
      maybePublishFilesystemOverlay();
    },
    neopixel_write(pin, count, bpp, data) {
      const pixelCount = Math.max(0, Number(count) || 0);
      const channels = Math.max(3, Number(bpp) || 3);
      const encoded = String(data || '');
      const pixels = [];
      for (let index = 0; index < pixelCount; index += 1) {
        const offset = index * channels * 2;
        pixels.push([
          Number.parseInt(encoded.slice(offset, offset + 2), 16) || 0,
          Number.parseInt(encoded.slice(offset + 2, offset + 4), 16) || 0,
          Number.parseInt(encoded.slice(offset + 4, offset + 6), 16) || 0,
        ]);
      }
      queueNeoPixel({
        pin: Number(pin),
        count: pixelCount,
        bpp: channels,
        pixels,
      });
    },
  };
}

async function readText(url) {
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return textDecoder.decode(await response.arrayBuffer());
}

function writeModuleFromUrl(url, path) {
  return readText(url).then((source) => {
    installTextModule(mp, path, source);
  });
}

function listFiles(path = '/') {
  const result = [];
  const visit = (directory) => {
    for (const name of mp.FS.readdir(directory)) {
      if (name === '.' || name === '..') continue;
      const child = `${directory === '/' ? '' : directory}/${name}`;
      if (directory === '/' && HIDDEN_RUNTIME_ROOTS.includes(child)) continue;
      const stat = mp.FS.stat(child);
      if (mp.FS.isDir(stat.mode)) visit(child);
      else result.push(child);
    }
  };
  visit(path);
  return result.sort();
}

function publishFilesystemOverlay(force = false) {
  if (!mp || !baseFilesystemSnapshot) return;
  if (!force && performance.now() - lastOverlayPublish < FILESYSTEM_PUBLISH_INTERVAL_MS) return;
  const current = captureFilesystem(mp.FS);
  const overlay = diffFilesystem(baseFilesystemSnapshot, current);
  lastOverlayPublish = performance.now();
  if (overlaysEqual(overlay, lastPublishedOverlay)) return;
  lastPublishedOverlay = cloneOverlay(overlay);
  const outgoing = overlayForTransfer(overlay);
  post('filesystem-overlay', { overlay: outgoing.overlay }, outgoing.transfer);
}

function maybePublishFilesystemOverlay() {
  publishFilesystemOverlay(false);
}

async function initialise(message) {
  vmState = 'BOOTING';
  signals = new Int32Array(message.signals);
  const hasSharedHttpBuffer = typeof SharedArrayBuffer !== 'undefined'
    && message.httpBuffer instanceof SharedArrayBuffer;
  httpControl = hasSharedHttpBuffer
    ? new Int32Array(message.httpBuffer, 0, HTTP_CONTROL_SLOTS)
    : null;
  httpData = hasSharedHttpBuffer
    ? new Uint8Array(message.httpBuffer, HTTP_CONTROL_BYTES)
    : null;
  httpRequestSequence = 0;
  externallyDrivenPins = collectExternallyDrivenPins(message.hardware);
  i2cRegistry = new I2cRegistry({ onFrame: queueOledFrame });
  i2cRegistry.configure(message.hardware || []);
  sharedSignals = typeof SharedArrayBuffer !== 'undefined' && signals.buffer instanceof SharedArrayBuffer;
  interruptRequested = false;
  replInitialised = false;
  vmQueue = Promise.resolve();
  queuedRun = false;
  replPrompt = 'primary';
  replLineBuffer = '';
  replPromptTail = '';
  replEscapeBuffer = '';
  stdoutBuffer = [];
  stdoutDropped = 0;
  stdoutPendingChars = 0;
  stderrBuffer = [];
  stderrDropped = 0;
  stderrPendingChars = 0;
  baseFilesystemSnapshot = null;
  lastPublishedOverlay = emptyOverlay();
  lastOverlayPublish = 0;
  lastHardwareFlush = performance.now();
  mp = await loadMicroPython({
    url: moduleUrl('./vendor/micropython.wasm'),
    stdout: handleStdout,
    stderr: handleStderr,
    // The interactive REPL must preserve every byte (echo, backspace,
    // carriage-return and prompt). Line buffering removes that information
    // and delays the prompt until a later input character arrives.
    linebuffer: false,
    heapsize: 2 * 1024 * 1024,
  });
  pruneEmscriptenFilesystem(mp.FS);

  mp.registerJsModule('simhw', createHardwareBridge());
  await writeModuleFromUrl(MACHINE_URL, '/lib/machine.py');
  await writeModuleFromUrl(COMPAT_URL, '/lib/_simulator_wasm_compat.py');
  await writeModuleFromUrl(NEOPIXEL_URL, '/lib/neopixel.py');
  await writeModuleFromUrl(NETWORK_URL, '/lib/network.py');
  await writeModuleFromUrl(NTPTIME_URL, '/lib/ntptime.py');
  await writeModuleFromUrl(DHT_URL, '/lib/dht.py');
  await writeModuleFromUrl(UREQUESTS_URL, '/lib/urequests.py');

  mp.runPython(`
import sys
if '/lib' not in sys.path:
    sys.path.insert(0, '/lib')
import machine
import _simulator_wasm_compat
`);

  const fsBase = new URL(message.fsBase, self.location.href).href;
  const files = await loadFilesList(mp, {
    baseUrl: fsBase,
    cacheVersion: message.cacheVersion || MODULE_VERSION,
    onFile: (entry) => post('file-loaded', entry),
  });
  baseFilesystemSnapshot = captureFilesystem(mp.FS);
  try {
    lastPublishedOverlay = applyFilesystemOverlay(mp.FS, message.filesystemOverlay || emptyOverlay());
  } catch (error) {
    lastPublishedOverlay = emptyOverlay();
    post('persistence-error', { text: error?.message || String(error) });
  }

  for (const startupFile of ['/boot.py', '/main.py']) {
    post('startup', { file: startupFile });
    mp.runPython(textDecoder.decode(mp.FS.readFile(startupFile)), { filename: startupFile });
  }
  // Start the same friendly REPL that a freshly connected board exposes.
  // mp.replInit() emits the MicroPython banner and the initial `>>> ` prompt.
  mp.replInit();
  replInitialised = true;
  replPrompt = 'primary';
  replLineBuffer = '';
  replPromptTail = '>>> ';
  flushStdout(true);
  flushStderr(true);
  post('ready', {
    protocolVersion: PROTOCOL_VERSION,
    runtimeVersion: RUNTIME_VERSION,
    capabilities: CAPABILITIES,
    filesystemPersistence: message.filesystemPersistence || 'memory-overlay',
    files: files.files,
    bytes: files.bytes,
    signalSlots: SIGNAL_SLOTS,
  });
  publishFilesystemOverlay(true);
  vmState = 'READY';
}

async function runCode(code) {
  vmState = 'RUNNING';
  post('running');
  interruptDelivered = false;
  try {
    mp.FS.writeFile('/idecode', new TextEncoder().encode(String(code)));
    mp.runPython('machine._reset_simulator_state()');
    mp.runPython('run_code()');
    flushStdout(true);
    flushStderr(true);
    if (interruptDelivered) {
      mp.runPython('__lite_alive_probe = 1 + 1');
      restoreReplPrompt();
      post('interrupted', { interpreterAlive: mp.globals.get('__lite_alive_probe') === 2 });
    } else {
      restoreReplPrompt();
      post('done');
    }
  } catch (error) {
    flushStdout(true);
    flushStderr(true);
    restoreReplPrompt();
    if (error?.type === 'KeyboardInterrupt') {
      let interpreterAlive = false;
      try {
        mp.runPython('__lite_alive_probe = 1 + 1');
        interpreterAlive = mp.globals.get('__lite_alive_probe') === 2;
      } catch (_) {}
      post('interrupted', { text: error.message || 'KeyboardInterrupt', interpreterAlive });
    } else {
      post('error', { text: error?.stack || error?.message || String(error) });
    }
  }
  flushHardwareEvents(true);
  publishFilesystemOverlay(true);
  if (vmState !== 'FAILED') vmState = 'READY';
}

async function processRepl(data) {
  vmState = 'RUNNING';
  post('repl-running');
  try {
    if (!replInitialised) {
      mp.replInit();
      replInitialised = true;
      replPrompt = 'primary';
      replPromptTail = '>>> ';
    }
    const input = String(data.data || '');
    let previousWasCarriageReturn = false;
    for (const character of input) {
      // Some transports send CRLF for one Enter. MicroPython only needs one
      // line terminator, so do not turn it into two REPL commands.
      if (character === '\n' && previousWasCarriageReturn) {
        previousWasCarriageReturn = false;
        continue;
      }
      previousWasCarriageReturn = character === '\r';
      const isLineEnd = character === '\r' || character === '\n';
      const isBlankPrimaryLine = isLineEnd
        && replMode === 'friendly'
        && replPrompt === 'primary'
        && replLineBuffer.trim() === '';
      if (isBlankPrimaryLine) {
        // The Emscripten REPL currently raises SyntaxError for an empty
        // primary line. A physical MicroPython REPL simply redraws its
        // prompt, so provide that byte sequence without evaluating code.
        appendOutput('stdout', '\r\n>>> ');
        replPromptTail = '>>> ';
        replPrompt = 'primary';
        replLineBuffer = '';
        continue;
      }
      if (character === '\x01') {
        replMode = 'raw';
        replLineBuffer = '';
      } else if (character === '\x02') {
        replMode = 'friendly';
        replLineBuffer = '';
      } else if (replMode === 'friendly') {
        updateReplLine(character);
      }
      await mp.replProcessCharWithAsyncify(character.codePointAt(0));
      if (isLineEnd || (replMode === 'friendly' && character === '\x03')) replLineBuffer = '';
    }
    flushStdout(true);
    flushStderr(true);
  } finally {
    flushHardwareEvents(true);
    publishFilesystemOverlay(true);
    if (vmState !== 'FAILED') vmState = 'READY';
    post('repl-done');
  }
}

self.addEventListener('message', async ({ data }) => {
  try {
    if (data.type === 'init') {
      await initialise(data);
      return;
    }
    if (!mp) {
      responseError(data.requestId, new Error('RUNTIME_NOT_READY: MicroPython runtime ještě není připravený.'));
      return;
    }
    if (data.type === 'run') {
      enqueueRun(data);
      return;
    }
    if (data.type === 'exec') {
      enqueueRequest(data, async () => {
        mp.runPython(String(data.code || ''));
        flushStdout(true);
        flushStderr(true);
        flushHardwareEvents(true);
        publishFilesystemOverlay(true);
      });
      return;
    }
    if (data.type === 'repl') {
      enqueueRequest(data, () => processRepl(data));
      return;
    }
    if (data.type === 'interrupt') {
      if (sharedSignals) Atomics.store(signals, CONTROL_INTERRUPT, 1);
      else interruptRequested = true;
      if (vmState === 'RUNNING') vmState = 'STOPPING';
      return;
    }
    if (data.type === 'set-digital') {
      const index = pinIndex(data.pin);
      if (index >= 0) {
        externallyDrivenPins.add(Number(data.pin));
        signalStore(index, data.value ? 1 : 0);
      }
      return;
    }
    if (data.type === 'set-adc') {
      const index = adcIndex(data.pin);
      if (index >= 0) signalStore(index, Math.max(0, Math.min(65535, Number(data.value) || 0)));
      return;
    }
    if (data.type === 'set-dht') {
      const temperatureIndex = dhtIndex(DHT_TEMPERATURE_BASE, data.pin);
      const humidityIndex = dhtIndex(DHT_HUMIDITY_BASE, data.pin);
      if (temperatureIndex >= 0 && humidityIndex >= 0) {
        signalStore(temperatureIndex, Math.round(Number(data.temperature) * 1000));
        signalStore(humidityIndex, Math.round(Number(data.humidity) * 1000));
      }
      return;
    }
    if (data.type === 'write-file') {
      enqueueRequest(data, async () => {
        const bytes = data.data instanceof ArrayBuffer ? new Uint8Array(data.data) : new Uint8Array(data.data || []);
        const path = String(data.path || '/idecode');
        mp.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')) || '/');
        mp.FS.writeFile(path, bytes);
        publishFilesystemOverlay(true);
      });
      return;
    }
    if (data.type === 'read-file') {
      enqueueRequest(data, async () => {
        const bytes = mp.FS.readFile(String(data.path || '/idecode'));
        const copy = bytes.slice().buffer;
        return { data: copy, transfer: [copy] };
      });
      return;
    }
    if (data.type === 'list-files') {
      enqueueRequest(data, async () => ({ files: listFiles(data.path || '/') }));
    }
  } catch (error) {
    if (data.type === 'init') vmState = 'FAILED';
    post('error', { requestId: data.requestId, text: error?.stack || error?.message || String(error) });
  }
});

// Module Workers with top-level dynamic imports can receive host messages
// before their handler is installed. Let the controller send init only after
// this explicit bootstrap barrier.
post('bootstrap-ready');
