// Optional ESP IDE host adapter.
//
// The IDE remains a normal, non-isolated document.  It talks to the isolated
// Simulator Lite page through an iframe, which keeps the Worker/SAB runtime
// outside the existing USB/BLE/WebREPL transport implementations.

const IDE_BRIDGE_VERSION = new URL(import.meta.url).searchParams.get('v');
const moduleUrl = (path) => {
  const url = new URL(path, import.meta.url);
  if (IDE_BRIDGE_VERSION) url.searchParams.set('v', IDE_BRIDGE_VERSION);
  return url.href;
};
const [
  { RpcClient, rpcError },
  { CTRL_B, CTRL_C, CTRL_D, parseRawReplResponse, RAW_REPL_ENTER_SEQUENCE },
  { isJoystickKeyboardCode, joystickKeyboardState },
] = await Promise.all([
  import(moduleUrl('./core/rpc.js')),
  import(moduleUrl('./runtime/repl-protocol.js')),
  import(moduleUrl('./core/joystick-keyboard.js')),
]);

const BRIDGE_SOURCE = 'esp-simulator-lite';
const PROTOCOL_VERSION = 1;
const FRAME_BASE_URL = new URL('./index.html', import.meta.url);
const MAX_REPL_BUFFER_CHARS = 120000;
const MAX_FILE_MANAGER_BUFFER_CHARS = 262144;
const DOCK_WIDTH_STORAGE_KEY = 'espide-simulator-dock-width';
const DOCK_VIEW_STORAGE_KEY = 'espide-simulator-dock-view';
const PANEL_MODE_STORAGE_KEY = 'espide-simulator-panel-mode';
const FLOATING_RECT_STORAGE_KEY = 'espide-simulator-floating-rect';
const MIN_DOCK_WIDTH = 320;
const MAX_DOCK_WIDTH = 600;
const NARROW_LAYOUT_WIDTH = 920;
const THEME_VARIABLES = [
  '--ui-bg', '--ui-bg-soft', '--ui-bg-panel', '--ui-bg-elevated', '--ui-bg-input',
  '--ui-border', '--ui-border-soft', '--ui-text', '--ui-text-muted', '--ui-accent',
  '--ui-accent-contrast', '--ui-hover', '--ui-shadow', '--button-bg', '--button-border',
  '--button-hover', '--button-text', '--terminal-bg', '--sim-canvas-bg',
];
const HOST_LABELS = {
  title: ['simulator.title', 'ESP IDE Simulator'],
  toggle: ['simulator.toggle', 'Simulator'],
  showTitle: ['simulator.showTitle', 'Zobrazit nebo skrýt simulátor'],
  hide: ['simulator.hide', 'Skrýt simulátor'],
  panelAria: ['simulator.panelAria', 'ESP IDE Simulator'],
  frameTitle: ['simulator.frameTitle', 'ESP IDE Simulator Lite'],
  componentLed: ['simulator.componentLed', 'LED\nGPIO {pin}'],
  componentButton: ['simulator.componentButton', 'Button GPIO {pin}'],
  componentAdc: ['simulator.componentAdc', 'ADC GPIO {pin}'],
  componentServo180: ['simulator.componentServo180', 'Servo 180°\nGPIO {pin}'],
  componentServo360: ['simulator.componentServo360', 'Servo 360°\nGPIO {pin}'],
  componentMotor: ['simulator.componentMotor', 'DC motor / H-bridge\nGPIO {in1} / {in2}'],
  componentEncoder: ['simulator.componentEncoder', 'Encoder A{a} / B{b}\nSW{sw}'],
  componentNeoPixel: ['simulator.componentNeoPixel', 'NeoPixel GPIO {pin} / {count} LEDs'],
  componentOled: ['simulator.componentOled', 'OLED 128×64\nSDA{sda} / SCL{scl}'],
  componentJoystick: ['simulator.componentJoystick', 'Joystick X{x} / Y{y}\nSW{sw}'],
  componentDht22: ['simulator.componentDht22', 'DHT22 GPIO {pin}'],
  temperature: ['simulator.temperature', 'Temperature'],
  humidity: ['simulator.humidity', 'Humidity'],
  positionDegrees: ['simulator.positionDegrees', '{value}°'],
  speedPercent: ['simulator.speedPercent', '{value}%'],
  encoderPosition: ['simulator.encoderPosition', '{steps} steps · {angle}°'],
  press: ['simulator.press', 'Press'],
  ledColor: ['simulator.ledColor', 'Change {label} colour'],
  servoMode: ['simulator.servoMode', 'Switch servo between 180° and 360°'],
  unsupported: ['simulator.unsupported', 'Unsupported type: {type}'],
  factoryReset: ['simulator.factoryReset', 'Factory reset FS'],
  factoryResetTitle: ['simulator.factoryResetTitle', 'Restore the simulator filesystem'],
  factoryResetConfirm: ['simulator.factoryResetConfirm', 'Delete all simulator filesystem changes and restore the original files?'],
  factoryResetDone: ['simulator.factoryResetDone', 'The simulator filesystem was restored.'],
  factoryResetFailed: ['simulator.factoryResetFailed', 'The simulator filesystem could not be restored.'],
  more: ['simulator.more', 'Simulator options'],
  detach: ['simulator.detach', 'Detach simulator'],
  dock: ['simulator.dock', 'Dock simulator on the right'],
};

function hostText(key, fallback) {
  try {
    const translated = globalThis.__espideI18n?.t?.(key);
    return translated && translated !== key ? String(translated) : fallback;
  } catch (_) {
    return fallback;
  }
}

function hostLabels() {
  return Object.fromEntries(Object.entries(HOST_LABELS).map(([name, [key, fallback]]) => [
    name,
    hostText(key, fallback),
  ]));
}

const PANEL_CSS = `
  :root { --espide-simulator-dock-width: 460px; }
  body.espide-simulator-docked #editor_div,
  body.espide-simulator-docked #terminal_div,
  body.espide-simulator-docked > .gutter.gutter-vertical {
    width: calc(100% - var(--espide-simulator-dock-width)) !important;
  }
  #espide-simulator-toggle {
    position: fixed;
    top: 50%;
    right: max(0px, env(safe-area-inset-right, 0px));
    z-index: 1200;
    width: 34px;
    height: auto;
    min-height: 116px;
    border: 1px solid var(--button-border, var(--ui-border, #a8a8a8));
    border-radius: 9px 0 0 9px;
    padding: 10px 7px;
    background: var(--button-bg, var(--ui-bg-panel, #f6f6f6));
    color: var(--button-text, var(--ui-text, #1f2328));
    cursor: pointer;
    box-shadow: -2px 2px 8px var(--ui-shadow, rgba(0,0,0,.22));
    font: 600 13px/1.2 system-ui, sans-serif;
    writing-mode: vertical-rl;
    text-orientation: mixed;
    letter-spacing: .2px;
    touch-action: manipulation;
    transform: translateY(-50%);
    transition: background-color .15s ease, box-shadow .15s ease, transform .08s ease;
  }
  #espide-simulator-toggle:hover { background: var(--button-hover, var(--ui-hover, #e5e7eb)); }
  #espide-simulator-toggle:active { transform: translateY(calc(-50% + 1px)); }
  #espide-simulator-toggle:focus-visible { outline: 2px solid var(--ui-accent, #3f51b5); outline-offset: 2px; }
  #espide-simulator-toggle[hidden], #espide-simulator-panel[hidden] { display: none !important; }
  #espide-simulator-panel {
    position: fixed;
    top: 46px;
    right: 0;
    bottom: 0;
    width: var(--espide-simulator-dock-width);
    z-index: 1100;
    display: flex;
    flex-direction: column;
    background: var(--ui-bg-panel, #f6f6f6);
    border-left: 1px solid var(--ui-border-soft, #d0d7de);
    color: var(--ui-text, #1f2328);
    box-shadow: none;
  }
  #espide-simulator-panel.is-floating {
    right: auto;
    bottom: auto;
    min-width: 340px;
    min-height: 360px;
    max-width: calc(100vw - 16px);
    max-height: calc(100vh - 54px);
    resize: both;
    overflow: hidden;
    border: 1px solid var(--ui-border-soft, #d0d7de);
    border-radius: 10px;
    box-shadow: 0 14px 38px var(--ui-shadow, rgba(0,0,0,.28));
  }
  #espide-simulator-panel.is-narrow {
    right: auto;
    bottom: auto;
    width: auto;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }
  #espide-simulator-panel.is-interacting iframe { pointer-events: none; }
  .espide-simulator-resize {
    position: absolute;
    top: 0;
    bottom: 0;
    left: -5px;
    z-index: 4;
    width: 10px;
    cursor: col-resize;
    touch-action: none;
  }
  .espide-simulator-resize::after {
    content: '';
    position: absolute;
    top: 42%;
    bottom: 42%;
    left: 4px;
    width: 2px;
    border-radius: 2px;
    background: var(--ui-border, #a8a8a8);
    opacity: 0;
    transition: opacity .15s ease;
  }
  .espide-simulator-resize:hover::after,
  .espide-simulator-resize:focus-visible::after { opacity: 1; }
  #espide-simulator-panel.is-floating .espide-simulator-resize,
  #espide-simulator-panel.is-narrow .espide-simulator-resize { display: none; }
  #espide-simulator-panel > header {
    flex: 0 0 38px;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 40px;
    padding: 0 8px 0 12px;
    color: var(--ui-text, #1f2328);
    background: var(--ui-bg-elevated, var(--ui-bg-panel, #f6f6f6));
    border-bottom: 1px solid var(--ui-border-soft, #d0d7de);
    font: 600 14px/1.2 system-ui, sans-serif;
    user-select: none;
  }
  #espide-simulator-panel.is-floating > header { cursor: move; }
  .espide-simulator-heading {
    display: flex;
    min-width: 0;
    flex: 1 1 auto;
    align-items: center;
    gap: 8px;
  }
  .espide-simulator-heading [data-simulator-title] {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .espide-simulator-status-dot {
    width: 8px;
    height: 8px;
    flex: 0 0 8px;
    border-radius: 50%;
    background: var(--ui-text-muted, #6b7280);
    box-shadow: 0 0 0 2px color-mix(in srgb, currentColor 10%, transparent);
  }
  .espide-simulator-status-dot.is-ready { background: #2e9d50; }
  .espide-simulator-status-dot.is-running { background: #3b82f6; }
  .espide-simulator-status-dot.is-error { background: #d14343; }
  .espide-simulator-status-dot.is-starting { background: #d49320; }
  #espide-simulator-panel > header .espide-simulator-header-actions {
    position: relative;
    display: flex;
    align-items: center;
    gap: 3px;
  }
  #espide-simulator-panel > header button {
    width: 28px;
    height: 28px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: 600 18px/1 system-ui, sans-serif;
  }
  #espide-simulator-panel > header button:hover { background: var(--ui-hover, #303947); }
  #espide-simulator-panel > header button:focus-visible { outline: 2px solid var(--ui-accent, #3f51b5); outline-offset: 1px; }
  .espide-simulator-menu {
    position: absolute;
    top: 32px;
    right: 0;
    z-index: 8;
    min-width: 205px;
    padding: 5px;
    background: var(--ui-bg-elevated, #fff);
    border: 1px solid var(--ui-border-soft, #d0d7de);
    border-radius: 8px;
    box-shadow: 0 8px 22px var(--ui-shadow, rgba(0,0,0,.22));
  }
  .espide-simulator-menu[hidden] { display: none !important; }
  #espide-simulator-panel > header .espide-simulator-menu button {
    display: block;
    width: 100%;
    height: auto;
    min-height: 32px;
    padding: 6px 9px;
    text-align: left;
    font: 500 13px/1.25 system-ui, sans-serif;
  }
  #espide-simulator-frame {
    flex: 1 1 auto;
    min-height: 0;
    width: 100%;
    border: 0;
    background: transparent;
    color-scheme: light dark;
  }
  @media (max-width: 920px) {
    body.espide-simulator-docked #editor_div,
    body.espide-simulator-docked #terminal_div,
    body.espide-simulator-docked > .gutter.gutter-vertical { width: 100% !important; }
    [data-simulator-mode] { display: none; }
  }
`;

function bytesFrom(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new TextEncoder().encode(String(value ?? ''));
}

function devicePath(value) {
  const path = String(value || '/idecode').replaceAll('\\', '/');
  return path.startsWith('/') ? path : `/${path}`;
}

function clampNumber(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || minimum));
}

function readStoredValue(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value == null ? fallback : value;
  } catch (_) {
    return fallback;
  }
}

function storeValue(key, value) {
  try { localStorage.setItem(key, String(value)); } catch (_) {}
}

class SimulatorFrameTransport {
  constructor() {
    this.active = false;
    this.connected = false;
    this.transportReady = false;
    this.programRunning = false;
    this.joystickKeys = new Set();
    this.mute_terminal = false;
    this.fm_buf_enabled = true;
    this.fm_in_buffer = '';
    this.inRawMode = false;
    this.rawMode = false;
    this.rawResponseBuffer = '';
    this.frameSession = 0;
    this.factoryResetPending = true;
    this.restartOnActivate = false;
    this.rpc = new RpcClient({
      send: (message, transfer) => {
        if (!this.frame?.contentWindow) throw rpcError('FRAME_UNAVAILABLE', 'Iframe simulátoru není dostupný.');
        this.frame.contentWindow.postMessage({
          source: BRIDGE_SOURCE,
          session: String(this.frameSession),
          ...message,
        }, this.targetOrigin, transfer);
      },
    });
    this.pending = this.rpc.pending;
    this.frame = null;
    this.panel = null;
    this.toggle = null;
    this.readyPromise = null;
    this.readyResolve = null;
    this.readyReject = null;
    this.frameReady = false;
    this.panelOpen = false;
    this.panelMode = readStoredValue(PANEL_MODE_STORAGE_KEY, 'docked') === 'floating'
      ? 'floating'
      : 'docked';
    this.dockWidth = clampNumber(
      readStoredValue(DOCK_WIDTH_STORAGE_KEY, 460),
      MIN_DOCK_WIDTH,
      MAX_DOCK_WIDTH,
    );
    this.floatingRect = null;
    try {
      this.floatingRect = JSON.parse(readStoredValue(FLOATING_RECT_STORAGE_KEY, 'null'));
    } catch (_) {}
    this.dockedView = { left: 0, top: 0 };
    try {
      const storedDockView = JSON.parse(readStoredValue(DOCK_VIEW_STORAGE_KEY, 'null'));
      if (storedDockView && Number.isFinite(storedDockView.left) && Number.isFinite(storedDockView.top)) {
        this.dockedView = { left: storedDockView.left, top: storedDockView.top };
      }
    } catch (_) {}
    this.layoutRaf = 0;
    this.panelResizeObserver = null;
    this.originalConnectionStyles = new Map();
    this.appearanceObserver = typeof MutationObserver === 'function'
      ? new MutationObserver(() => this._syncAppearance())
      : null;
    this.loadingObserver = null;
    this.appearanceObserver?.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'lang'] });
    this.targetOrigin = FRAME_BASE_URL.origin;
    this._onMessage = this._onMessage.bind(this);
    this._onWindowResize = () => this._applyPanelLayout();
    this._onWorkspaceResize = () => this._applyPanelLayout();
    this._onDocumentPointerDown = (event) => {
      if (!this.panel?.querySelector('.espide-simulator-menu')?.contains(event.target) &&
          !event.target.closest?.('[data-simulator-menu-toggle]')) {
        this._setMenuOpen(false);
      }
    };
    this._onDocumentKeyDown = (event) => {
      if (event.key === 'Escape') this._setMenuOpen(false);
      this._handleJoystickKeyboardEvent(event, true);
    };
    this._onDocumentKeyUp = (event) => this._handleJoystickKeyboardEvent(event, false);
    this._onWindowBlur = () => this._resetJoystickKeyboard();
    window.addEventListener('message', this._onMessage);
    window.addEventListener('resize', this._onWindowResize);
    window.addEventListener('espide-workspace-resized', this._onWorkspaceResize);
    document.addEventListener('pointerdown', this._onDocumentPointerDown);
    document.addEventListener('keydown', this._onDocumentKeyDown, true);
    document.addEventListener('keyup', this._onDocumentKeyUp, true);
    window.addEventListener('blur', this._onWindowBlur);
  }

  _postJoystickKeyboardState() {
    if (!this.frame?.contentWindow || !this.frameReady) return;
    this.frame.contentWindow.postMessage({
      source: BRIDGE_SOURCE,
      session: String(this.frameSession),
      type: 'joystick-keyboard',
      state: joystickKeyboardState(this.joystickKeys),
    }, this.targetOrigin);
  }

  _handleJoystickKeyboardEvent(event, pressed) {
    const code = event.code || (event.key === ' ' ? 'Space' : event.key);
    if (!isJoystickKeyboardCode(code)) return;
    const wasHeld = this.joystickKeys.has(code);
    if (pressed && (!this.active || !this.programRunning)) return;
    if (!pressed && !wasHeld) return;
    event.preventDefault();
    event.stopPropagation();
    if (pressed === wasHeld) return;
    if (pressed) this.joystickKeys.add(code);
    else this.joystickKeys.delete(code);
    this._postJoystickKeyboardState();
  }

  _resetJoystickKeyboard({ notify = true } = {}) {
    const hadKeys = this.joystickKeys.size > 0;
    this.joystickKeys.clear();
    if (notify && (hadKeys || this.programRunning)) this._postJoystickKeyboardState();
  }

  _ensurePanel() {
    if (this.panel) return;
    const style = document.createElement('style');
    style.dataset.espideSimulatorLite = 'true';
    style.textContent = PANEL_CSS;
    document.head.append(style);

    this.toggle = document.createElement('button');
    this.toggle.id = 'espide-simulator-toggle';
    this.toggle.type = 'button';
    const labels = hostLabels();
    this.toggle.textContent = `▣ ${labels.toggle}`;
    this.toggle.title = labels.showTitle;
    this.toggle.setAttribute('aria-expanded', 'false');
    this.toggle.hidden = true;

    this.panel = document.createElement('aside');
    this.panel.id = 'espide-simulator-panel';
    this.panel.hidden = true;
    this.panel.setAttribute('aria-label', labels.panelAria);
    this.panel.innerHTML = `
      <div class="espide-simulator-resize" data-simulator-resize role="separator"
        aria-orientation="vertical" tabindex="0"></div>
      <header>
        <span class="espide-simulator-heading">
          <span class="espide-simulator-status-dot is-starting" data-simulator-status></span>
          <span data-simulator-title>${labels.title}</span>
        </span>
        <span class="espide-simulator-header-actions">
          <button type="button" data-simulator-mode title="${labels.detach}"
            aria-label="${labels.detach}">↗</button>
          <button type="button" data-simulator-close title="${labels.hide}"
            aria-label="${labels.hide}">−</button>
          <button type="button" data-simulator-menu-toggle title="${labels.more}"
            aria-label="${labels.more}" aria-expanded="false">⋮</button>
          <div class="espide-simulator-menu" data-simulator-menu role="menu" hidden>
            <button type="button" role="menuitem" data-simulator-factory-reset
              title="${labels.factoryResetTitle}">${labels.factoryReset}</button>
          </div>
        </span>
      </header>
      <iframe id="espide-simulator-frame" title="${hostText('simulator.frameTitle', 'ESP IDE Simulator Lite')}" loading="eager"></iframe>`;
    document.body.append(this.toggle, this.panel);
    this.frame = this.panel.querySelector('#espide-simulator-frame');
    this.frame.addEventListener('load', () => this._syncAppearance());
    this.toggle.addEventListener('click', () => this.togglePanel());
    this.panel.querySelector('[data-simulator-close]').addEventListener('click', () => this.closePanel());
    this.panel.querySelector('[data-simulator-mode]').addEventListener('click', () => {
      this._setPanelMode(this.panelMode === 'floating' ? 'docked' : 'floating');
    });
    this.panel.querySelector('[data-simulator-menu-toggle]').addEventListener('click', (event) => {
      event.stopPropagation();
      this._setMenuOpen(this.panel.querySelector('[data-simulator-menu]').hidden);
    });
    this.panel.querySelector('[data-simulator-factory-reset]').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      const currentLabels = hostLabels();
      this._setMenuOpen(false);
      if (!globalThis.confirm(currentLabels.factoryResetConfirm)) return;
      button.disabled = true;
      try {
        await this.factoryResetFilesystem();
        globalThis.alert(currentLabels.factoryResetDone);
      } catch (error) {
        console.error('Simulator filesystem factory reset:', error);
        globalThis.alert(currentLabels.factoryResetFailed);
      } finally {
        button.disabled = false;
      }
    });
    const resizeHandle = this.panel.querySelector('[data-simulator-resize]');
    resizeHandle.addEventListener('pointerdown', (event) => this._beginDockResize(event));
    resizeHandle.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      this._setDockWidth(this.dockWidth + (event.key === 'ArrowLeft' ? 20 : -20));
    });
    this.panel.querySelector('header').addEventListener('pointerdown', (event) => {
      if (this.panelMode !== 'floating' || this._isNarrow() || event.target.closest('button')) return;
      this._beginFloatingDrag(event);
    });
    if (typeof ResizeObserver === 'function') {
      this.panelResizeObserver = new ResizeObserver(() => {
        if (this.panelMode === 'floating' && !this._isNarrow() && !this.panel.classList.contains('is-interacting')) {
          this._saveFloatingRect();
        }
      });
      this.panelResizeObserver.observe(this.panel);
    }
    const loadingScreen = document.getElementById('loading_screen');
    if (loadingScreen && typeof MutationObserver === 'function') {
      this.loadingObserver = new MutationObserver(() => {
        if (!this.active || !loadingScreen.classList.contains('loading-hidden')) return;
        this.panel.hidden = false;
        this.toggle.hidden = false;
        this._setPanelOpen(true);
      });
      this.loadingObserver.observe(loadingScreen, { attributes: true, attributeFilter: ['class'] });
    }
    this._setDockWidth(this.dockWidth, false);
    this._setPanelStatus('starting');
    this._applyPanelLayout();
    this._syncAppearance();
  }

  _isNarrow() {
    return window.innerWidth <= NARROW_LAYOUT_WIDTH;
  }

  _setMenuOpen(open) {
    const menu = this.panel?.querySelector('[data-simulator-menu]');
    const toggle = this.panel?.querySelector('[data-simulator-menu-toggle]');
    if (!menu || !toggle) return;
    menu.hidden = !open;
    toggle.setAttribute('aria-expanded', String(!!open));
  }

  _setPanelStatus(status) {
    const dot = this.panel?.querySelector('[data-simulator-status]');
    if (!dot) return;
    dot.className = `espide-simulator-status-dot is-${status}`;
    const title = status === 'running'
      ? hostText('simulator.running', 'Program running')
      : status === 'error'
        ? hostText('simulator.error', 'Error')
        : status === 'starting'
          ? hostText('simulator.starting', 'Starting…')
          : hostText('simulator.readyShort', 'Ready');
    dot.title = title;
    dot.setAttribute('aria-label', title);
  }

  _dispatchLayoutChange() {
    cancelAnimationFrame(this.layoutRaf);
    this.layoutRaf = requestAnimationFrame(() => {
      this.layoutRaf = 0;
      window.dispatchEvent(new CustomEvent('espide-simulator-layoutchange'));
    });
  }

  _setDockWidth(width, persist = true) {
    this.dockWidth = clampNumber(width, MIN_DOCK_WIDTH, Math.min(MAX_DOCK_WIDTH, window.innerWidth - 260));
    document.documentElement.style.setProperty('--espide-simulator-dock-width', `${this.dockWidth}px`);
    const handle = this.panel?.querySelector('[data-simulator-resize]');
    handle?.setAttribute('aria-valuemin', String(MIN_DOCK_WIDTH));
    handle?.setAttribute('aria-valuemax', String(MAX_DOCK_WIDTH));
    handle?.setAttribute('aria-valuenow', String(Math.round(this.dockWidth)));
    if (persist) storeValue(DOCK_WIDTH_STORAGE_KEY, Math.round(this.dockWidth));
    if (this.panelOpen && this.panelMode === 'docked' && !this._isNarrow()) this._dispatchLayoutChange();
  }

  _setPanelMode(mode) {
    if (this.panelMode === 'docked') this._saveDockView();
    this.panelMode = mode === 'floating' ? 'floating' : 'docked';
    storeValue(PANEL_MODE_STORAGE_KEY, this.panelMode);
    this._setMenuOpen(false);
    this._applyPanelLayout();
    if (this.panelMode === 'docked') this._restoreDockView();
  }

  _dockScroller() {
    try {
      return this.frame?.contentDocument
        ?.getElementById('simulator-root')
        ?.shadowRoot
        ?.querySelector('[data-scene-host]') || null;
    } catch (_) {
      return null;
    }
  }

  _saveDockView() {
    if (!this.panel || this.panelMode !== 'docked' || this._isNarrow()) return;
    const scroller = this._dockScroller();
    if (!scroller) return;
    this.dockedView = {
      left: Math.max(0, Math.round(scroller.scrollLeft)),
      top: Math.max(0, Math.round(scroller.scrollTop)),
    };
    storeValue(DOCK_VIEW_STORAGE_KEY, JSON.stringify(this.dockedView));
  }

  _restoreDockView() {
    if (!this.panelOpen || this.panelMode !== 'docked' || this._isNarrow()) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!this.panelOpen || this.panelMode !== 'docked') return;
      const scroller = this._dockScroller();
      if (!scroller) return;
      scroller.scrollLeft = this.dockedView.left;
      scroller.scrollTop = this.dockedView.top;
    }));
  }

  _floatingLayout() {
    const fallbackWidth = Math.min(460, window.innerWidth - 24);
    const fallbackHeight = Math.min(825, window.innerHeight - 70);
    const stored = this.floatingRect || {};
    const width = clampNumber(stored.width || fallbackWidth, 340, Math.max(340, window.innerWidth - 16));
    const height = clampNumber(stored.height || fallbackHeight, 360, Math.max(360, window.innerHeight - 54));
    return {
      width,
      height,
      left: clampNumber(stored.left ?? (window.innerWidth - width - 16), 8, Math.max(8, window.innerWidth - width - 8)),
      top: clampNumber(stored.top ?? 62, 46, Math.max(46, window.innerHeight - height - 8)),
    };
  }

  _saveFloatingRect() {
    if (!this.panel || this.panelMode !== 'floating' || this._isNarrow()) return;
    const rect = this.panel.getBoundingClientRect();
    this.floatingRect = {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
    storeValue(FLOATING_RECT_STORAGE_KEY, JSON.stringify(this.floatingRect));
  }

  _applyPanelLayout() {
    if (!this.panel) return;
    const narrow = this._isNarrow();
    this.panel.classList.toggle('is-narrow', narrow);
    this.panel.classList.toggle('is-floating', !narrow && this.panelMode === 'floating');
    document.body.classList.toggle(
      'espide-simulator-docked',
      this.panelOpen && !narrow && this.panelMode === 'docked',
    );
    const modeButton = this.panel.querySelector('[data-simulator-mode]');
    const labels = hostLabels();
    if (modeButton) {
      const docked = this.panelMode !== 'floating';
      modeButton.textContent = docked ? '↗' : '▣';
      modeButton.title = docked ? labels.detach : labels.dock;
      modeButton.setAttribute('aria-label', docked ? labels.detach : labels.dock);
    }
    if (!this.panelOpen) {
      this.panel.hidden = true;
      this._dispatchLayoutChange();
      return;
    }
    this.panel.hidden = false;
    if (narrow) {
      const editor = document.getElementById('editor_div');
      const rect = editor?.getBoundingClientRect();
      const top = Math.max(44, (rect?.top || 0) + 44);
      Object.assign(this.panel.style, {
        top: `${top}px`,
        left: `${rect?.left || 0}px`,
        right: 'auto',
        bottom: 'auto',
        width: `${rect?.width || window.innerWidth}px`,
        height: `${Math.max(240, (rect?.bottom || window.innerHeight) - top)}px`,
      });
    } else if (this.panelMode === 'floating') {
      const rect = this._floatingLayout();
      Object.assign(this.panel.style, {
        top: `${rect.top}px`,
        left: `${rect.left}px`,
        right: 'auto',
        bottom: 'auto',
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
    } else {
      Object.assign(this.panel.style, {
        top: '46px',
        left: 'auto',
        right: '0px',
        bottom: '0px',
        width: 'var(--espide-simulator-dock-width)',
        height: 'auto',
      });
    }
    this._dispatchLayoutChange();
  }

  _beginDockResize(event) {
    if (event.button !== 0 || this.panelMode !== 'docked' || this._isNarrow()) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = this.dockWidth;
    this.panel.classList.add('is-interacting');
    handle.setPointerCapture?.(event.pointerId);
    const move = (moveEvent) => this._setDockWidth(startWidth + startX - moveEvent.clientX, false);
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      this.panel.classList.remove('is-interacting');
      this._setDockWidth(this.dockWidth, true);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  _beginFloatingDrag(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    const header = event.currentTarget;
    const start = this.panel.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    this.panel.classList.add('is-interacting');
    header.setPointerCapture?.(event.pointerId);
    const move = (moveEvent) => {
      const left = clampNumber(start.left + moveEvent.clientX - startX, 8, Math.max(8, window.innerWidth - start.width - 8));
      const top = clampNumber(start.top + moveEvent.clientY - startY, 46, Math.max(46, window.innerHeight - start.height - 8));
      this.panel.style.left = `${left}px`;
      this.panel.style.top = `${top}px`;
    };
    const end = () => {
      header.removeEventListener('pointermove', move);
      header.removeEventListener('pointerup', end);
      header.removeEventListener('pointercancel', end);
      this.panel.classList.remove('is-interacting');
      this._saveFloatingRect();
    };
    header.addEventListener('pointermove', move);
    header.addEventListener('pointerup', end);
    header.addEventListener('pointercancel', end);
  }

  _currentAppearance() {
    const root = document.documentElement;
    const styles = getComputedStyle(root);
    const vars = {};
    for (const name of THEME_VARIABLES) {
      const value = styles.getPropertyValue(name).trim();
      if (value) vars[name] = value;
    }
    return {
      theme: root.classList.contains('theme-dark') ? 'dark' : 'light',
      locale: globalThis.__espideI18n?.language || root.lang || 'en',
      vars,
      labels: {
        title: hostText('simulator.title', 'ESP IDE Simulator Lite'),
        starting: hostText('simulator.starting', 'Startuji…'),
        run: hostText('simulator.run', 'Spustit'),
        stop: hostText('simulator.stop', 'Stop'),
        restart: hostText('simulator.restart', 'Restart'),
        editor: hostText('simulator.editor', 'MicroPython'),
        console: hostText('simulator.console', 'Konzole / REPL'),
        replAria: hostText('simulator.replAria', 'MicroPython REPL'),
        ready: hostText('simulator.ready', 'Připraveno · {files} souborů'),
        running: hostText('simulator.running', 'Program běží'),
        done: hostText('simulator.done', 'Program dokončen'),
        interrupted: hostText('simulator.interrupted', 'Program zastaven Ctrl+C'),
        stopping: hostText('simulator.stopping', 'Zastavuji…'),
        error: hostText('simulator.error', 'Chyba'),
        readyShort: hostText('simulator.readyShort', 'Připraveno'),
        runMarker: '\n> run\n',
        componentLed: hostText('simulator.componentLed', 'LED\nGPIO {pin}'),
        componentButton: hostText('simulator.componentButton', 'Button GPIO {pin}'),
        componentAdc: hostText('simulator.componentAdc', 'ADC GPIO {pin}'),
        componentServo180: hostText('simulator.componentServo180', 'Servo 180°\nGPIO {pin}'),
        componentServo360: hostText('simulator.componentServo360', 'Servo 360°\nGPIO {pin}'),
        componentMotor: hostText('simulator.componentMotor', 'DC motor / H-bridge\nGPIO {in1} / {in2}'),
        componentEncoder: hostText('simulator.componentEncoder', 'Encoder A{a} / B{b}\nSW{sw}'),
        componentNeoPixel: hostText('simulator.componentNeoPixel', 'NeoPixel GPIO {pin} / {count} LEDs'),
        componentOled: hostText('simulator.componentOled', 'OLED 128×64\nSDA{sda} / SCL{scl}'),
        componentJoystick: hostText('simulator.componentJoystick', 'Joystick X{x} / Y{y}\nSW{sw}'),
        componentDht22: hostText('simulator.componentDht22', 'DHT22 GPIO {pin}'),
        temperature: hostText('simulator.temperature', 'Temperature'),
        humidity: hostText('simulator.humidity', 'Humidity'),
        positionDegrees: hostText('simulator.positionDegrees', '{value}°'),
        speedPercent: hostText('simulator.speedPercent', '{value}%'),
        encoderPosition: hostText('simulator.encoderPosition', '{steps} steps · {angle}°'),
        press: hostText('simulator.press', 'Press'),
        ledColor: hostText('simulator.ledColor', 'Change {label} colour'),
        servoMode: hostText('simulator.servoMode', 'Switch servo between 180° and 360°'),
        unsupported: hostText('simulator.unsupported', 'Unsupported type: {type}'),
      },
    };
  }

  _updateHostLabels() {
    if (!this.panel || !this.toggle) return;
    const labels = hostLabels();
    this.toggle.textContent = `▣ ${labels.toggle}`;
    this.toggle.title = labels.showTitle;
    this.panel.setAttribute('aria-label', labels.panelAria);
    const title = this.panel.querySelector('[data-simulator-title]');
    if (title) title.textContent = labels.title;
    const close = this.panel.querySelector('[data-simulator-close]');
    if (close) {
      close.title = labels.hide;
      close.setAttribute('aria-label', labels.hide);
    }
    const menuToggle = this.panel.querySelector('[data-simulator-menu-toggle]');
    if (menuToggle) {
      menuToggle.title = labels.more;
      menuToggle.setAttribute('aria-label', labels.more);
    }
    const factoryReset = this.panel.querySelector('[data-simulator-factory-reset]');
    if (factoryReset) {
      factoryReset.textContent = labels.factoryReset;
      factoryReset.title = labels.factoryResetTitle;
    }
    this._setPanelStatus(this.programRunning ? 'running' : this.connected ? 'ready' : 'starting');
    this._applyPanelLayout();
    this.frame?.setAttribute('title', hostText('simulator.frameTitle', 'ESP IDE Simulator Lite'));
  }

  _syncAppearance() {
    this._updateHostLabels();
    if (!this.frame?.contentWindow) return;
    this.frame.contentWindow.postMessage({
      source: BRIDGE_SOURCE,
      session: String(this.frameSession),
      type: 'appearance',
      appearance: this._currentAppearance(),
    }, this.targetOrigin);
  }

  _setPanelOpen(open) {
    if (!this.panel || !this.toggle) return;
    if (!open) this._saveDockView();
    this.panelOpen = !!open;
    this.panel.classList.toggle('is-open', !!open);
    this.toggle.setAttribute('aria-expanded', String(!!open));
    this.toggle.hidden = !!open;
    this._setMenuOpen(false);
    this._applyPanelLayout();
    if (open) this._restoreDockView();
  }

  openPanel() {
    this._ensurePanel();
    const loadingScreen = document.getElementById('loading_screen');
    if (loadingScreen && !loadingScreen.classList.contains('loading-hidden')) {
      this.panel.hidden = true;
      this.toggle.hidden = true;
      return;
    }
    this._setPanelOpen(true);
  }

  closePanel() {
    this._setPanelOpen(false);
  }

  togglePanel() {
    this._ensurePanel();
    this._setPanelOpen(!this.panelOpen);
  }

  _setConnectionButtonsHidden(hidden) {
    for (const id of ['SerialConnectButton', 'BLE_SerialConnectButton']) {
      const element = document.getElementById(id);
      if (!element) continue;
      if (!this.originalConnectionStyles.has(element)) {
        this.originalConnectionStyles.set(element, element.getAttribute('style'));
      }
      if (hidden) {
        element.style.display = 'none';
      } else {
        const original = this.originalConnectionStyles.get(element);
        if (original === null) element.removeAttribute('style');
        else element.setAttribute('style', original);
      }
    }
  }

  _startFrame({ factoryReset = false } = {}) {
    this._ensurePanel();
    clearTimeout(this.readyTimer);
    this.readyReject?.(rpcError('RUNTIME_RESTARTED', 'Runtime simulátoru se restartuje.'));
    this.rpc.rejectAll(rpcError('RUNTIME_RESTARTED', 'Runtime simulátoru se restartuje.'));
    this.frame.dataset.simulatorFrame = 'true';
    this.frameSession += 1;
    this.frameReady = false;
    this.connected = false;
    this._resetJoystickKeyboard({ notify: false });
    this.programRunning = false;
    this._setPanelStatus('starting');
    this.inRawMode = false;
    this.rawMode = false;
    this.rawResponseBuffer = '';
    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.readyTimer = setTimeout(() => {
      this.readyReject?.(rpcError('FRAME_READY_TIMEOUT', 'Iframe simulátoru se nepřipravil včas.'));
      this.readyResolve = null;
      this.readyReject = null;
    }, 20_000);
    const url = new URL(FRAME_BASE_URL);
    url.searchParams.set('embed', '1');
    url.searchParams.set('session', String(this.frameSession));
    url.searchParams.set('theme', document.documentElement.classList.contains('theme-dark') ? 'dark' : 'light');
    if (IDE_BRIDGE_VERSION) url.searchParams.set('v', IDE_BRIDGE_VERSION);
    if (factoryReset) url.searchParams.set('factoryReset', '1');
    this.frame.src = url.href;
  }

  _ensureFrame() {
    this._ensurePanel();
    if (this.frame?.dataset.simulatorFrame === 'true') return;
    const factoryReset = this.factoryResetPending;
    this.factoryResetPending = false;
    this._startFrame({ factoryReset });
  }

  _reloadFrame() {
    if (!this.frame) return;
    this._startFrame();
  }

  async activate() {
    this.active = true;
    this.transportReady = true;
    this._setConnectionButtonsHidden(true);
    this.openPanel();
    if (this.restartOnActivate && this.frame?.dataset.simulatorFrame === 'true') {
      this.restartOnActivate = false;
      this._reloadFrame();
    } else {
      this._ensureFrame();
    }
    this._syncAppearance();
    await this.readyPromise;
    return this;
  }

  deactivate() {
    this._resetJoystickKeyboard();
    if (this.connected && this.frame?.contentWindow) {
      this.frame.contentWindow.postMessage({
        source: BRIDGE_SOURCE,
        session: String(this.frameSession),
        type: 'suspend',
      }, this.targetOrigin);
    }
    this.restartOnActivate = true;
    this.active = false;
    this.connected = false;
    this.transportReady = false;
    this.programRunning = false;
    this.inRawMode = false;
    this.rawMode = false;
    this.rawResponseBuffer = '';
    this.rpc.rejectAll(rpcError('RUNTIME_DEACTIVATED', 'Simulator byl deaktivován.'));
    this.closePanel();
    if (this.panel) this.panel.hidden = true;
    if (this.toggle) this.toggle.hidden = true;
    this._setConnectionButtonsHidden(false);
  }

  isConnected() {
    // A selected simulator is considered connected while its iframe starts;
    // every operation below still waits for the ready event before sending.
    return this.active && !!this.frame;
  }

  async _waitReady() {
    this._ensureFrame();
    if (this.connected) return;
    await this.readyPromise;
  }

  async restartRuntime() {
    if (!this.active) throw rpcError('RUNTIME_DEACTIVATED', 'Simulator není aktivní.');
    this._ensureFrame();
    this._resetJoystickKeyboard();
    this.programRunning = false;
    try {
      await this._request('restart');
    } catch (_) {
      // The iframe main thread normally survives even a blocked WASM Worker.
      // Reload the document only when that lightweight recovery path is dead too.
      this._reloadFrame();
      await this.readyPromise;
    }
    return this;
  }

  async resetForUpload() {
    return this.restartRuntime();
  }

  _request(type, payload = {}, transfer = []) {
    return this._waitReady().then(() => this.rpc.request(type, payload, transfer));
  }

  _writeTerminal(text, stream = 'stdout') {
    const output = String(text ?? '');
    if (this.inRawMode) {
      this.rawResponseBuffer += output;
      if (this.rawResponseBuffer.length > MAX_REPL_BUFFER_CHARS) {
        this.rawResponseBuffer = this.rawResponseBuffer.slice(-MAX_REPL_BUFFER_CHARS);
      }
    }
    if (this.fm_buf_enabled) this.fm_in_buffer += output;
    if (this.fm_in_buffer.length > MAX_FILE_MANAGER_BUFFER_CHARS) {
      this.fm_in_buffer = this.fm_in_buffer.slice(-MAX_FILE_MANAGER_BUFFER_CHARS);
    }
    const terminal = globalThis.term;
    if (terminal?.write && !this.mute_terminal) {
      // xterm expects CRLF for a physical-REPL-like line break.  Keep the
      // unmodified LF form in the event buffer used by file-manager helpers.
      const terminalOutput = output.replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n');
      terminal.write(stream === 'stderr' ? `\r\n${terminalOutput}` : terminalOutput);
    }
    window.dispatchEvent(new CustomEvent('esp-simulator-lite-console', {
      detail: { text: output, stream },
    }));
  }

  _onMessage(event) {
    if (!this.frame || event.source !== this.frame.contentWindow || event.origin !== this.targetOrigin) return;
    const message = event.data;
    if (!message || message.source !== BRIDGE_SOURCE || message.session !== String(this.frameSession)) return;
    if (message.type === 'response') {
      this.rpc.resolve(message);
      return;
    }
    if (message.type !== 'event') return;
    const detail = message.detail || {};
    if (detail.type === 'running' || detail.type === 'repl-running') {
      this.programRunning = true;
      this._setPanelStatus('running');
    }
    if (detail.type === 'done' || detail.type === 'interrupted' || detail.type === 'error' || detail.type === 'repl-done') {
      this._resetJoystickKeyboard();
      this.programRunning = false;
      this._setPanelStatus(detail.type === 'error' ? 'error' : 'ready');
    }
    if (detail.type === 'ready') {
      if (detail.protocolVersion !== PROTOCOL_VERSION) {
        this.readyReject?.(new Error(`Neznámá verze protokolu simulátoru: ${detail.protocolVersion}.`));
        this.readyResolve = null;
        this.readyReject = null;
        return;
      }
      this.frameReady = true;
      this.connected = true;
      this._setPanelStatus('ready');
      this.transportReady = this.active;
      if (!this.active) this.connected = false;
      this.inRawMode = false;
      this.rawMode = false;
      this.rawResponseBuffer = '';
      clearTimeout(this.readyTimer);
      this._syncAppearance();
      this.readyResolve?.(detail);
      this.readyResolve = null;
      this.readyReject = null;
    } else if (detail.type === 'error' && !this.connected) {
      this._setPanelStatus('error');
      this.readyReject?.(new Error(detail.text || 'Simulator se nespustil.'));
      this.readyResolve = null;
      this.readyReject = null;
    }
    if (detail.type === 'stdout') this._writeTerminal(detail.text, 'stdout');
    if (detail.type === 'stderr') this._writeTerminal(detail.text, 'stderr');
    window.dispatchEvent(new CustomEvent('esp-simulator-lite', { detail }));
  }

  async sendFile(filename, content) {
    const bytes = bytesFrom(content).slice();
    await this._request('write-file', { path: devicePath(filename), data: bytes.buffer }, [bytes.buffer]);
  }

  async sendData(data) {
    const text = String(data ?? '');
    if (text.includes(CTRL_C) && this.programRunning) {
      await this._request('stop');
      return;
    }
    if (text.includes(CTRL_D) && !this.inRawMode) {
      await this._request('restart');
      return;
    }
    if (text) await this._request('repl', { data: text });
  }

  async sendCommand(command) {
    const text = String(command ?? '');
    if (this.inRawMode) {
      return this.sendData(text.endsWith('\n') ? text : `${text}\r\n`);
    }
    const compact = text.trim();
    if (compact === 'run_code()') {
      this._writeTerminal(`${compact}\n`, 'stdout');
      return this._request('run');
    }
    if (compact === 'stop_code()') return this._request('stop');
    if (compact === 'info()') return this._request('exec', { code: "print('Simulator Lite')" });
    return this._request('exec', { code: text });
  }

  async enterRawREPL() {
    this.rawResponseBuffer = '';
    this.inRawMode = true;
    this.rawMode = true;
    try {
      await this._request('repl', { data: RAW_REPL_ENTER_SEQUENCE });
      if (!this.rawResponseBuffer.includes('raw REPL')) {
        throw new Error('Simulator nevstoupil do raw REPL.');
      }
    } catch (error) {
      this.inRawMode = false;
      this.rawMode = false;
      throw error;
    }
  }

  async exitRawREPL() {
    try {
      if (this.inRawMode) await this._request('repl', { data: `\r${CTRL_B}` });
    } finally {
      this.inRawMode = false;
      this.rawMode = false;
    }
  }

  async execRawCommand(command) {
    if (!this.inRawMode) throw new Error('Raw REPL není aktivní.');
    this.rawResponseBuffer = '';
    await this._request('repl', { data: `${String(command ?? '')}\r${CTRL_D}` });
    const response = parseRawReplResponse(this.rawResponseBuffer);
    if (!response.complete) throw new Error(`Neúplná odpověď raw REPL: ${this.rawResponseBuffer}`);
    return response.raw;
  }

  fmEnable(enabled) {
    this.fm_buf_enabled = !!enabled;
  }

  fmClear() {
    this.fm_in_buffer = '';
  }

  fmPeek() {
    return this.fm_in_buffer;
  }

  fmTakeAll() {
    const value = this.fm_in_buffer;
    this.fm_in_buffer = '';
    return value;
  }

  splitIntoChunks(content, chunkSize) {
    const chunks = [];
    const value = String(content ?? '');
    const size = Math.max(1, Number(chunkSize) || 1);
    for (let index = 0; index < value.length; index += size) {
      chunks.push(value.substring(index, index + size));
    }
    return chunks;
  }

  async readFile(path) {
    const response = await this._request('read-file', { path: devicePath(path) });
    return new Uint8Array(response.data);
  }

  async listFiles(path = '/') {
    const response = await this._request('list-files', { path });
    return response.files || [];
  }

  async factoryResetFilesystem() {
    await this._request('factory-reset-filesystem');
  }

  async previewDisplayFrame(value) {
    const bytes = bytesFrom(value).slice();
    await this._request('preview-oled-frame', { data: bytes.buffer }, [bytes.buffer]);
  }

  async setDigital(pin, value) {
    await this._request('set-digital', { pin, value });
  }

  async setAdc(pin, value) {
    await this._request('set-adc', { pin, value });
  }

  connect() {
    return this.activate();
  }

  disconnect() {
    this.deactivate();
  }

  destroy() {
    this.rpc.rejectAll(rpcError('RUNTIME_DESTROYED', 'Simulator bridge byl zrušen.'));
    clearTimeout(this.readyTimer);
    this.readyReject?.(rpcError('RUNTIME_DESTROYED', 'Simulator bridge byl zrušen.'));
    this.readyResolve = null;
    this.readyReject = null;
    window.removeEventListener('message', this._onMessage);
    window.removeEventListener('resize', this._onWindowResize);
    window.removeEventListener('espide-workspace-resized', this._onWorkspaceResize);
    document.removeEventListener('pointerdown', this._onDocumentPointerDown);
    document.removeEventListener('keydown', this._onDocumentKeyDown, true);
    document.removeEventListener('keyup', this._onDocumentKeyUp, true);
    window.removeEventListener('blur', this._onWindowBlur);
    this.appearanceObserver?.disconnect();
    this.loadingObserver?.disconnect();
    this.panelResizeObserver?.disconnect();
    cancelAnimationFrame(this.layoutRaf);
    this.deactivate();
    this.frame?.remove();
    this.panel?.remove();
    this.toggle?.remove();
    this.frame = null;
    this.panel = null;
    this.toggle = null;
    document.body.classList.remove('espide-simulator-docked');
  }
}

let singleton = null;

export function installSimulatorBridge() {
  if (!singleton) {
    singleton = new SimulatorFrameTransport();
    globalThis.ESPIDE_SIMULATOR = singleton;
  }
  const selector = document.getElementById('processorDropdown');
  if (selector?.value === 'Simulator') singleton.activate();
  return singleton;
}

export default installSimulatorBridge;
