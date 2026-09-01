/*
  ESP IDE v2 - New top menu module
  Uses existing global actions and controls from index.html.
*/
(function () {
  'use strict';

  var NM = {
    icons: [
      'btn_run', 'btn_stop', 'btn_undo', 'btn_redo',
      'menu_project', 'menu_device', 'menu_settings', 'menu_info',
      'item_autostart', 'item_open_pc', 'item_save_pc',
      'item_open_esp', 'item_save_esp', 'item_share',
      'item_load_shared', 'item_examples', 'item_show_code', 'item_extensions',
      'item_blocks_display', 'item_screenshot',
      'item_processor', 'item_usb', 'item_bluetooth',
      'item_usb_disconnected', 'item_usb_connected', 'item_usb_error',
      'item_bluetooth_disconnected', 'item_bluetooth_connected', 'item_bluetooth_error',
      'item_webrepl_disconnected', 'item_webrepl_connected',
      'item_filemanager', 'item_ble_settings', 'item_device_info',
      'item_reset', 'item_firmware', 'item_joystick',
      'item_language', 'item_theme', 'item_menu_type',
      'item_auto_start_blocks',
      'item_toolbox_icons', 'item_about', 'item_version', 'item_changelog'
    ],
    layouts: {
      layout1: true,
      layout2: true,
      original: true
    },
    responsive: {
      // Adjustable breakpoints (px):
      // 1) hideConnections first, 2) iconOnlyMenus later.
      hideConnections: 1050,
      iconOnlyMenus: 900
    }
  };

  var FALLBACK = {
    'newMenu.project': 'Projekt',
    'newMenu.device': 'Zařízení',
    'newMenu.settings': 'Nastavení',
    'newMenu.info': 'Info',
    'newMenu.run': 'Spustit',
    'newMenu.stop': 'Stop',
    'newMenu.undo': 'Zpět',
    'newMenu.redo': 'Znovu',
    'newMenu.autostart': 'Auto-run po startu',
    'newMenu.examples': 'Příklady',
    'newMenu.openFromPC': 'Otevřít z PC',
    'newMenu.saveToPC': 'Uložit do PC',
    'newMenu.openLastBackup': 'Otevřít poslední zálohu',
    'newMenu.openFromESP': 'Otevřít z ESP',
    'newMenu.saveToESP': 'Uložit do ESP',
    'newMenu.shareProject': 'Sdílet projekt',
    'newMenu.loadShared': 'Načíst sdílený projekt',
    'newMenu.showCode': 'Zobrazit kód',
    'newMenu.extensions': 'Správce doplňků',
    'newMenu.blocksDisplay': 'Zobrazení bloků',
    'newMenu.screenshot': 'Snímek workspace',
    'newMenu.processor': 'Procesor',
    'newMenu.connectUSB': 'Připojení USB',
    'newMenu.disconnectUSB': 'Odpojit USB',
    'newMenu.reconnectUSB': 'Znovu připojit USB',
    'newMenu.connectBT': 'Připojení Bluetooth',
    'newMenu.disconnectBT': 'Odpojit Bluetooth',
    'newMenu.reconnectBT': 'Znovu připojit Bluetooth',
    'newMenu.connectWebREPL': 'Připojení WebREPL',
    'newMenu.disconnectWebREPL': 'Odpojit WebREPL',
    'newMenu.reconnectWebREPL': 'Znovu připojit WebREPL',
    'newMenu.fileManager': 'Správce souborů',
    'newMenu.btSettings': 'Bluetooth nastavení',
    'newMenu.joystick': 'Bluetooth joystick',
    'newMenu.deviceInfo': 'Informace o zařízení',
    'newMenu.reset': 'Restart zařízení',
    'newMenu.firmware': 'Instalace firmwaru',
    'newMenu.language': 'Language',
    'newMenu.theme': 'Téma',
    'newMenu.themeLight': 'Světlé',
    'newMenu.themeDark': 'Tmavé',
    'newMenu.darkMode': 'Tmavý režim',
    'newMenu.menuType': 'Typ menu',
    'newMenu.backupMode': 'Ukládat zálohu',
    'newMenu.backupNever': 'Nikdy',
    'newMenu.backupUsb': 'Jen přes USB',
    'newMenu.backupAlways': 'Vždy',
    'newMenu.autostartDefault': 'Vždy spouštět kód po startu',
    'newMenu.autoStartProgramBlocks': 'Startovní programové bloky',
    'newMenu.toolboxIcons': 'Zobrazit ikony kategorií',
    'newMenu.about': 'O aplikaci',
    'newMenu.layout1': 'Rozložení 1',
    'newMenu.layout2': 'Rozložení 2',
    'newMenu.layoutOriginal': 'Původní menu',
    'newMenu.version': 'Verze',
    'newMenu.documentation': 'Dokumentace',
    'newMenu.changelog': 'Historie změn',
    'examples.categories.basic': 'Základy',
    'examples.categories.sensor': 'Senzory',
    'examples.categories.display': 'Displeje',
    'examples.categories.games': 'Hry',
    'examples.items.basic01': 'Ahoj desko, blikání LED',
    'examples.items.basic02': 'Počítadlo stisků tlačítka',
    'examples.items.basic03': 'Elektronická hrací kostka',
    'examples.items.basic04': 'Regulace jasu LED potenciometrem',
    'examples.items.basic05': 'Semafor',
    'examples.items.sensor01': 'Analogový joystick',
    'examples.items.sensor02': 'Regulace jasu LED rotačním enkodérem',
    'examples.items.sensor03': 'DHT11/22 měření teploty a vlhkosti',
    'examples.items.sensor04': 'USB joystick s ESP32-S3 a RPi Pico',
    'examples.items.sensor05': 'Nastavení úhlu servomotoru potenciometrem',
    'examples.items.display01': 'Neopixel duha',
    'examples.items.display02': 'Zobrazení textu na OLED 128×64',
    'examples.items.game01': 'Dodge 3 Lanes',
    'examples.items.game02': 'Flappy Bird',
    'examples.items.game03': 'Pong',
    'examples.items.game04': 'Arkanoid',
    'examples.items.game05': 'Space Invaders',
    'examples.comingSoon': 'Příklady se připravují',
    'examples.loading': 'Načítám příklad…',
    'examples.loadError': 'Příklad se nepodařilo načíst. Aktuální projekt zůstal beze změny.'
  };

  var state = {
    initDone: false,
    layout: 'layout1',
    openDropdownId: null,
    msEl: null,
    msSavedParent: null,
    msSavedNext: null,
    toolTipEl: null,
    overlayEl: null,
    bar: null,
    observers: [],
    controls: {},
    hideTimer: 0,
    ddCloseTimer: 0,
    ddOpenRaf: 0,
    connSaved: {},
    connEls: {},
    outsideCloseBound: false,
    exampleLoading: false
  };
  var SYNC_MIN_MS = 50;
  var syncQueued = false;
  var syncRaf = 0;
  var syncTimer = 0;
  var lastSyncTs = 0;

  var CONNECT_BTN_IDS = ['SerialConnectButton', 'BLE_SerialConnectButton'];
  var AUTOSTART_PREF_KEY = 'autoRunOnBootDefault';
  var AP_HOST = '192.168.4.1';

  /**
   * Returns true when USB/BLE controls should be hidden for AP-hosted editor.
   * Source of truth is shared flag from index.html with hostname fallback.
   */
  function shouldHideLegacyConnectRows() {
    if (window.__espideHideLegacyConnectButtons === true) return true;
    try {
      return String((window.location && window.location.hostname) || '').trim() === AP_HOST;
    } catch (_) {
      return false;
    }
  }

  /**
   * Applies visibility rule for USB/BLE rows in Device dropdown.
   * Returns true when rows should stay visible.
   */
  function applyLegacyConnectRowVisibility(usbItem, btItem) {
    var visible = !shouldHideLegacyConnectRows();
    if (usbItem) usbItem.style.display = visible ? '' : 'none';
    if (btItem) btItem.style.display = visible ? '' : 'none';
    return visible;
  }

  /**
   * Returns the existing mode switch DOM node (`#modeSwitch`).
   * The function caches the element reference in `state.msEl` so repeated calls
   * do not perform a new DOM lookup unless the cache is empty.
   */
  function getModeSwitchEl() {
    if (state.msEl) return state.msEl;
    var ms = document.getElementById('modeSwitch');
    if (ms) state.msEl = ms;
    return ms;
  }

  /**
   * Returns a connection button node by id and keeps a stable cached reference.
   * This is important because layout rebuild temporarily detaches these nodes from
   * the DOM; cached references allow us to move them back reliably.
   */
  function getConnBtnEl(id) {
    // Keep returning cached node even when temporarily detached during rebuilds.
    // Layout switch clears the bar first, then re-attaches these same nodes.
    if (state.connEls[id]) return state.connEls[id];
    var el = document.getElementById(id);
    if (el) state.connEls[id] = el;
    return el || null;
  }

  /**
   * Returns true when node is one of legacy quick-panel hosts.
   * These hosts require `.in-panel` class for narrow-layout visibility rules.
   */
  function isQuickPanelHost(node) {
    return !!(node && node.nodeType === 1 &&
      (node.id === 'quick_panel_inner' || node.id === 'quick_panel_row'));
  }

  /**
   * Stores each connection button's original DOM parent and sibling position.
   * The saved anchors are later used to restore buttons when switching back
   * to the original layout mode.
   */
  function saveConnectButtons() {
    CONNECT_BTN_IDS.forEach(function (id) {
      if (state.connSaved[id]) return;
      var el = getConnBtnEl(id);
      if (!el || !el.parentNode) return;
      state.connSaved[id] = {
        parent: el.parentNode,
        next: el.nextSibling
      };
    });
  }

  /**
   * Moves USB/BLE connection buttons into the provided target container.
   * Returns `true` when at least one button was moved so caller can decide
   * whether to render wrapper/separator UI.
   */
  function moveConnectButtons(targetEl) {
    if (!targetEl) return false;
    saveConnectButtons();
    var moved = false;
    CONNECT_BTN_IDS.forEach(function (id) {
      var el = getConnBtnEl(id);
      if (!el) return;
      el.classList.remove('in-panel');
      targetEl.appendChild(el);
      moved = true;
    });
    return moved;
  }

  /**
   * Restores connection buttons to their original DOM positions.
   * Uses saved parent + sibling references to preserve original ordering.
   */
  function restoreConnectButtons() {
    CONNECT_BTN_IDS.forEach(function (id) {
      var el = getConnBtnEl(id);
      var saved = state.connSaved[id];
      if (!el || !saved || !saved.parent) return;
      if (isQuickPanelHost(saved.parent)) el.classList.add('in-panel');
      else el.classList.remove('in-panel');
      if (saved.next && saved.next.parentNode === saved.parent) {
        saved.parent.insertBefore(el, saved.next);
      } else {
        saved.parent.appendChild(el);
      }
    });
  }

  /**
   * Reads user settings from localStorage and returns a plain object.
   * Any parse error or unavailable storage gracefully falls back to `{}`.
   */
  function readSettings() {
    try {
      return JSON.parse(localStorage.getItem('userSettings') || '{}') || {};
    } catch (_) {
      return {};
    }
  }

  /**
   * Merges a partial settings patch into persisted `userSettings`.
   * This updates both localStorage and `window.userSettings` (if present)
   * to keep legacy code and new menu code synchronized.
   */
  function writeSettings(patch) {
    try {
      var data = readSettings();
      Object.keys(patch || {}).forEach(function (k) {
        data[k] = patch[k];
      });
      localStorage.setItem('userSettings', JSON.stringify(data));
      if (window.userSettings && typeof window.userSettings === 'object') {
        Object.keys(patch || {}).forEach(function (k) {
          window.userSettings[k] = patch[k];
        });
      }
    } catch (_) {
      // Keep UI functional even if storage is unavailable.
    }
  }

  function normalizeBackupMode(value) {
    var mode = String(value || '').trim().toLowerCase();
    return (mode === 'never' || mode === 'always' || mode === 'usb') ? mode : 'usb';
  }

  /**
   * Reads persisted default preference for "Auto-run on boot".
   * Returns `true`/`false` when explicitly configured, otherwise `null`.
   */
  function readAutostartBootPreference() {
    var data = readSettings();
    if (typeof data[AUTOSTART_PREF_KEY] === 'boolean') {
      return data[AUTOSTART_PREF_KEY];
    }
    return null;
  }

  /**
   * Applies the stored default "Auto-run on boot" preference to legacy checkbox.
   * If preference is not stored yet, current checkbox value is persisted as baseline.
   */
  function applyAutostartBootPreferenceOnLoad() {
    var autostart = document.getElementById('autostart');
    if (!autostart) return;

    var pref = readAutostartBootPreference();
    if (typeof pref === 'boolean') {
      autostart.checked = pref;
      return;
    }

    // First run default: keep auto-run enabled for new users.
    autostart.checked = true;
    writeSettings((function () {
      var patch = {};
      patch[AUTOSTART_PREF_KEY] = true;
      return patch;
    })());
  }

  /**
   * Persists new default "Auto-run on boot" preference and updates live checkbox.
   * This keeps project dropdown toggle and startup behavior in sync.
   */
  function setAutostartBootPreference(enabled) {
    var patch = {};
    patch[AUTOSTART_PREF_KEY] = !!enabled;
    writeSettings(patch);

    var autostart = document.getElementById('autostart');
    if (autostart) autostart.checked = !!enabled;
  }

  /**
   * Validates requested layout name against known layouts.
   * Returns a safe default (`layout1`) for unknown values.
   */
  function validLayout(layout) {
    return NM.layouts[layout] ? layout : 'layout1';
  }

  /**
   * Resolves translation for new menu keys.
   * First tries global i18n function `t()`, then falls back to local static map.
   */
  function nmT(key) {
    if (typeof window.t === 'function') {
      var translated = window.t(key);
      if (translated && translated !== key) return translated;
    }
    return FALLBACK[key] || key;
  }

  /**
   * Returns true when application is currently in dark theme mode.
   */
  function isDark() {
    return document.documentElement.classList.contains('theme-dark');
  }

  /**
   * Returns true when app runs inside Electron.
   * Prefer existing global flag from index.html, then use runtime detection.
   */
  function isElectronRuntime() {
    try {
      if (typeof isElectron === 'boolean') return isElectron;
    } catch (_) {
      // Ignore and use runtime detection fallback.
    }
    return !!(
      (typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent || '')) ||
      !!(globalThis.process && globalThis.process.versions && globalThis.process.versions.electron)
    );
  }

  /**
   * Returns true when WebREPL connect row should be visible in new menu.
   * Allowed only for Electron, localhost/loopback, or unsecured HTTP pages.
   */
  function shouldShowWsConnectRow() {
    if (isElectronRuntime()) return true;
    try {
      var loc = window.location || {};
      var protocol = String(loc.protocol || '').toLowerCase();
      var host = String(loc.hostname || '').trim().toLowerCase();

      if (protocol === 'https:') return false;
      if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return true;
      return protocol === 'http:';
    } catch (_) {
      return false;
    }
  }

  /**
   * Builds an icon path for the new menu icon set.
   */
  function iconSrc(name) {
    return 'media/new_menu/' + name + '.png';
  }

  /**
   * Preloads all known menu icons to reduce visible icon pop-in.
   */
  function preloadIcons() {
    NM.icons.forEach(function (name) {
      var img = new Image();
      img.src = iconSrc(name);
    });
  }

  /**
   * Legacy fallback used only when Pointer Events are unavailable.
   * Returns true for environments where hover-open via mouse events is sensible.
   */
  function canUseHoverOpen() {
    try {
      return !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);
    } catch (_) {
      return false;
    }
  }

  /**
   * Binds hover-open behavior for one trigger button.
   * - Pointer Events path: open only for real mouse pointer.
   * - Legacy fallback: mouseenter only on hover-capable environments.
   */
  function bindHoverOpen(btn, onEnter) {
    if (!btn || typeof onEnter !== 'function') return;

    if (window.PointerEvent) {
      btn.addEventListener('pointerenter', function (e) {
        if (!e || e.pointerType !== 'mouse') return;
        onEnter();
      });
      return;
    }

    if (canUseHoverOpen()) btn.addEventListener('mouseenter', onEnter);
  }

  /**
   * Handles overlay press start (mouse/touch/pointer).
   * `preventDefault()` avoids click-through re-open on some touch browsers.
   */
  function onOverlayPressStart(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    closeDropdowns();
  }

  /**
   * Creates (or reuses) fullscreen click-away overlay for dropdown closing.
   * The overlay blocks interactions with underlying UI while dropdown is open.
   * Close runs on press-start to avoid touch click-through timing issues.
   */
  function ensureOverlay() {
    var overlay = document.getElementById('nm-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'nm-overlay';
      document.body.appendChild(overlay);
    }

    if (!overlay._nmCloseBound) {
      if (window.PointerEvent) {
        overlay.addEventListener('pointerdown', onOverlayPressStart);
      } else {
        overlay.addEventListener('touchstart', onOverlayPressStart, { passive: false });
        overlay.addEventListener('mousedown', onOverlayPressStart);
      }
      overlay._nmCloseBound = true;
    }
    state.overlayEl = overlay;
  }

  /**
   * Creates (or reuses) a single tooltip node used by icon-only buttons.
   */
  function ensureTooltip() {
    var tt = document.getElementById('nm-tooltip-div');
    if (!tt) {
      tt = document.createElement('div');
      tt.id = 'nm-tooltip-div';
      document.body.appendChild(tt);
    }
    state.toolTipEl = tt;
  }

  /**
   * Stores original mode switch DOM position once.
   * This allows temporary re-parenting into the new topbar center section
   * and exact restoration for `original` layout.
   */
  function saveModeSwitch() {
    if (state.msSavedParent) return;
    var ms = getModeSwitchEl();
    if (!ms || !ms.parentNode) return;
    state.msEl = ms;
    state.msSavedParent = ms.parentNode;
    state.msSavedNext = ms.nextSibling;
  }

  /**
   * Moves mode switch into target container used by current new-menu layout.
   */
  function moveModeSwitch(targetEl) {
    var ms = getModeSwitchEl();
    if (!ms || !targetEl) return;
    state.msEl = ms;
    ms.classList.remove('in-panel');
    targetEl.appendChild(ms);
  }

  /**
   * Restores mode switch to its original DOM location captured by saveModeSwitch().
   */
  function restoreModeSwitch() {
    var ms = getModeSwitchEl();
    if (!ms || !state.msSavedParent) return;
    state.msEl = ms;
    if (isQuickPanelHost(state.msSavedParent)) ms.classList.add('in-panel');
    else ms.classList.remove('in-panel');
    if (state.msSavedNext && state.msSavedNext.parentNode === state.msSavedParent) {
      state.msSavedParent.insertBefore(ms, state.msSavedNext);
    } else {
      state.msSavedParent.appendChild(ms);
    }
  }

  /**
   * Triggers optional haptic feedback using existing global helper.
   * Errors are intentionally swallowed to keep UI interactions safe.
   */
  function triggerVibrate() {
    try {
      if (typeof window.phone_vibrate === 'function') window.phone_vibrate();
    } catch (_) {
      // Ignore vibration errors.
    }
  }

  /**
   * Executes a callback safely and logs errors instead of throwing.
   * This prevents one menu action from breaking the whole menu runtime.
   */
  function safeCall(fn) {
    try {
      if (typeof fn === 'function') return fn();
    } catch (e) {
      console.warn('New menu action failed:', e);
    }
    return undefined;
  }

  /**
   * Returns new topbar root element with lazy cached lookup.
   */
  function getBar() {
    if (!state.bar) state.bar = document.getElementById('new_topbar');
    return state.bar;
  }

  /**
   * Clears all dynamic children from new topbar before layout rebuild.
   * Preserves re-usable external nodes (mode switch, connection buttons)
   * by detaching them first.
   */
  function clearBar() {
    var bar = getBar();
    if (!bar) return;
    var ms = getModeSwitchEl();
    // Keep modeSwitch alive during bar rebuilds (layout1 <-> layout2).
    if (ms && bar.contains(ms)) ms.remove();
    CONNECT_BTN_IDS.forEach(function (id) {
      var btn = getConnBtnEl(id);
      if (btn && bar.contains(btn)) btn.remove();
    });
    while (bar.firstChild) bar.removeChild(bar.firstChild);
  }

  /**
   * Creates an icon `<img>` element with standard new-menu attributes.
   * Missing icon files are hidden to avoid broken image placeholders.
   */
  function makeIcon(name, cls) {
    var img = document.createElement('img');
    img.setAttribute('data-nm-icon', name);
    img.src = iconSrc(name);
    if (cls) img.className = cls;
    img.alt = '';
    img.draggable = false;
    img.onerror = function () {
      img.style.visibility = 'hidden';
    };
    return img;
  }

  /**
   * Applies translation attributes inside provided root subtree.
   * Supports text (`data-nm-i18n`), title, tooltip text and aria-label fields.
   */
  function applyTranslations(root) {
    var scope = root || document;

    scope.querySelectorAll('[data-nm-i18n]').forEach(function (el) {
      el.textContent = nmT(el.getAttribute('data-nm-i18n'));
    });

    scope.querySelectorAll('[data-nm-i18n-title]').forEach(function (el) {
      el.setAttribute('title', nmT(el.getAttribute('data-nm-i18n-title')));
    });

    scope.querySelectorAll('[data-nm-i18n-tooltip]').forEach(function (el) {
      el.setAttribute('data-nm-tooltip', nmT(el.getAttribute('data-nm-i18n-tooltip')));
    });

    scope.querySelectorAll('[data-nm-i18n-aria]').forEach(function (el) {
      el.setAttribute('aria-label', nmT(el.getAttribute('data-nm-i18n-aria')));
    });
  }

  /**
   * Re-applies icon URLs for all icon nodes in the topbar subtree.
   * Useful after rebuilds, dynamic icon-name changes, or runtime theme refresh.
   */
  function updateAllIcons() {
    var scope = getBar();
    if (!scope) return;
    scope.querySelectorAll('[data-nm-icon]').forEach(function (img) {
      var icon = img.getAttribute('data-nm-icon');
      img.src = iconSrc(icon);
      img.style.visibility = '';
    });
  }

  /**
   * Creates an icon-only action button (Run/Stop/Undo/Redo).
   * Button has localized tooltip/aria labels and executes supplied handler.
   */
  function makeActionButton(id, iconName, tipKey, handler) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = id;
    btn.className = 'nm-icon-btn';
    btn.setAttribute('data-nm-i18n-tooltip', tipKey);
    btn.setAttribute('data-nm-i18n-aria', tipKey);
    btn.appendChild(makeIcon(iconName));
    wireTooltip(btn);

    btn.addEventListener('click', function () {
      triggerVibrate();
      closeDropdowns();
      safeCall(handler);
    });
    return btn;
  }

  /**
   * Creates a topbar menu button that opens/closes assigned dropdown.
   * The dropdown opens on hover and toggles on click for desktop usability.
   */
  function makeMenuButton(id, iconName, labelKey, dropdownId) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = id;
    btn.className = 'nm-menu-btn';
    btn.setAttribute('data-nm-target-dd', dropdownId);
    btn.setAttribute('data-nm-i18n-aria', labelKey);

    var icon = makeIcon(iconName, 'nm-btn-icon');
    var label = document.createElement('span');
    label.className = 'nm-menu-label';
    label.setAttribute('data-nm-i18n', labelKey);

    btn.appendChild(icon);
    btn.appendChild(label);

    bindHoverOpen(btn, function () {
      if (state.openDropdownId === dropdownId) return;
      openDropdown(dropdownId, btn);
    });

    btn.addEventListener('click', function (e) {
      e.preventDefault();
      if (state.openDropdownId === dropdownId) {
        closeDropdowns();
      } else {
        openDropdown(dropdownId, btn);
      }
    });

    return btn;
  }

  /**
   * Creates right-side info button that controls the info dropdown.
   */
  function makeInfoButton() {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'nm-info-btn';
    btn.className = 'nm-info-btn';
    btn.setAttribute('data-nm-i18n-tooltip', 'newMenu.info');
    btn.setAttribute('data-nm-i18n-aria', 'newMenu.info');
    btn.appendChild(makeIcon('menu_info'));
    wireTooltip(btn);

    bindHoverOpen(btn, function () {
      if (state.openDropdownId === 'nm-dd-info') return;
      openDropdown('nm-dd-info', btn);
    });

    btn.addEventListener('click', function () {
      if (state.openDropdownId === 'nm-dd-info') closeDropdowns();
      else openDropdown('nm-dd-info', btn);
    });

    return btn;
  }

  /**
   * Creates compact vertical separator used in topbar row groups.
   */
  function makeSep() {
    var sep = document.createElement('div');
    sep.className = 'nm-sep';
    sep.setAttribute('aria-hidden', 'true');
    return sep;
  }

  /**
   * Attaches tooltip show/hide behavior to an interactive button.
   */
  function wireTooltip(btn) {
    btn.addEventListener('mouseenter', function () { showTooltip(btn); });
    btn.addEventListener('mouseleave', hideTooltip);
    btn.addEventListener('blur', hideTooltip);
    btn.addEventListener('click', hideTooltip);
  }

  /**
   * Positions and shows tooltip near provided trigger button.
   * Horizontal position is clamped to viewport to avoid cutoff.
   */
  function showTooltip(btn) {
    if (!state.toolTipEl) return;
    var text = btn.getAttribute('data-nm-tooltip');
    if (!text) return;

    clearTimeout(state.hideTimer);
    var tt = state.toolTipEl;
    tt.textContent = text;
    tt.style.left = '-9999px';

    requestAnimationFrame(function () {
      var w = tt.offsetWidth;
      var rect = btn.getBoundingClientRect();
      var left = Math.max(4, Math.min(rect.left + (rect.width / 2) - (w / 2), window.innerWidth - w - 4));
      tt.style.left = left + 'px';
      tt.style.top = (rect.bottom + 6) + 'px';
      tt.classList.add('nm-tt-visible');
    });
  }

  /**
   * Hides tooltip with a small delay to avoid flicker on rapid pointer moves.
   */
  function hideTooltip() {
    if (!state.toolTipEl) return;
    state.hideTimer = setTimeout(function () {
      if (state.toolTipEl) state.toolTipEl.classList.remove('nm-tt-visible');
    }, 40);
  }

  /**
   * Creates base dropdown container for one menu group.
   */
  function makeDropdown(id) {
    var dd = document.createElement('div');
    dd.id = id;
    dd.className = 'nm-dropdown';
    return dd;
  }

  /**
   * Creates a standard clickable dropdown row with icon + localized label.
   * After action execution, state sync is requested immediately.
   */
  function makeItem(iconName, key, onClick) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nm-item';
    if (iconName) btn.appendChild(makeIcon(iconName, 'nm-item-icon'));

    var label = document.createElement('span');
    label.className = 'nm-item-label';
    label.setAttribute('data-nm-i18n', key);
    btn.appendChild(label);

    btn.addEventListener('click', function () {
      triggerVibrate();
      closeDropdowns();
      safeCall(onClick);
      syncState({ immediate: true });
    });

    return btn;
  }

  /** Downloads and opens one catalog project without using the share service. */
  async function loadExampleProject(file) {
    closeDropdowns();
    if (state.exampleLoading) return;

    var relativeFile = String(file || '').replace(/\\/g, '/');
    var isSafeFile = /^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*\.blk$/i.test(relativeFile);
    if (!isSafeFile || typeof window.__espideFM_openBlocksFromString !== 'function') {
      console.warn('Invalid example catalog entry:', file);
      Swal.fire(nmT('errors.title'), nmT('examples.loadError'), 'error');
      return;
    }

    state.exampleLoading = true;
    Swal.fire({
      title: nmT('examples.loading'),
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: function () { Swal.showLoading(); }
    });

    try {
      var activeLanguage = (window.__espideI18n && window.__espideI18n.language) ||
        document.documentElement.lang || 'en';
      var normalizedLanguage = String(activeLanguage).toLowerCase();
      // Czech projects may fall back to English. German and future locales use English.
      var languages = /^(cs|cz)(?:[-_]|$)/.test(normalizedLanguage) ? ['cs', 'en'] : ['en'];
      var projectText = '';
      var sourceUrl = '';
      var lastError = null;

      for (var i = 0; i < languages.length; i++) {
        var relativeUrl = 'examples/' + languages[i] + '/' + relativeFile;
        var requestUrl = (typeof window.withAppVersion === 'function')
          ? window.withAppVersion(relativeUrl)
          : relativeUrl;
        try {
          var response = await fetch(requestUrl, { cache: 'no-cache' });
          if (!response.ok) throw new Error('HTTP ' + response.status + ' (' + relativeUrl + ')');
          var candidateText = await response.text();
          if (!candidateText.trim()) throw new Error('Empty example file (' + relativeUrl + ')');

          // Parse before changing the active workspace. This catches damaged files
          // and HTML error pages while leaving the current project untouched.
          if (!window.Blockly || !Blockly.Xml || typeof Blockly.Xml.textToDom !== 'function') {
            throw new Error('Blockly is not ready');
          }
          var parsed = (typeof window.peelExtensionsComment === 'function')
            ? window.peelExtensionsComment(candidateText)
            : { strippedText: candidateText };
          var xml = Blockly.Xml.textToDom(parsed.strippedText || '');
          if (!xml || String(xml.nodeName).toLowerCase() !== 'xml') {
            throw new Error('Invalid Blockly project (' + relativeUrl + ')');
          }

          projectText = candidateText;
          sourceUrl = relativeUrl;
          break;
        } catch (candidateError) {
          lastError = candidateError;
          console.warn('Example candidate could not be loaded:', relativeUrl, candidateError);
        }
      }

      if (!projectText) throw lastError || new Error('Example file is unavailable');
      await window.__espideFM_openBlocksFromString(projectText, sourceUrl, { rethrow: true });
      Swal.close();
    } catch (e) {
      Swal.close();
      console.warn('Example project load failed:', relativeFile, e);
      Swal.fire(nmT('errors.title'), nmT('examples.loadError'), 'error');
    } finally {
      state.exampleLoading = false;
    }
  }

  /** Fills the compact category tree from js/examples_catalog.js. */
  function buildExamplesPanel(panel) {
    var catalog = Array.isArray(window.ESPIDE_EXAMPLES_CATALOG) ? window.ESPIDE_EXAMPLES_CATALOG : [];

    catalog.forEach(function (category, index) {
      var branch = document.createElement('details');
      branch.className = 'nm-example-category';
      if (index === 0) branch.open = true;

      var summary = document.createElement('summary');
      var categoryLabel = document.createElement('span');
      categoryLabel.setAttribute('data-nm-i18n', category.labelKey);
      summary.appendChild(categoryLabel);
      branch.appendChild(summary);

      var list = document.createElement('div');
      list.className = 'nm-example-list';
      var items = Array.isArray(category.items) ? category.items : [];

      if (!items.length) {
        var empty = document.createElement('div');
        empty.className = 'nm-example-empty';
        empty.setAttribute('data-nm-i18n', 'examples.comingSoon');
        list.appendChild(empty);
      }

      items.forEach(function (example) {
        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'nm-item nm-example-link';
        item.setAttribute('data-nm-i18n', example.labelKey);
        item.addEventListener('click', function () {
          triggerVibrate();
          loadExampleProject(example.file);
        });
        list.appendChild(item);
      });

      branch.appendChild(list);
      panel.appendChild(branch);
    });
  }

  /** Positions the examples tree next to Project menu, with a narrow-screen fallback. */
  function toggleExamplesPanel(triggerBtn) {
    var panel = document.getElementById('nm-examples-panel');
    var projectMenu = document.getElementById('nm-dd-project');
    var bar = getBar();
    if (!panel || !projectMenu || !bar) return;

    if (panel.classList.contains('nm-open')) {
      panel.classList.remove('nm-open');
      triggerBtn.setAttribute('aria-expanded', 'false');
      return;
    }

    var barRect = bar.getBoundingClientRect();
    var menuRect = projectMenu.getBoundingClientRect();
    var triggerRect = triggerBtn.getBoundingClientRect();
    var panelWidth = panel.offsetWidth;
    var left = menuRect.right + 6;

    if (left + panelWidth > window.innerWidth - 4) left = menuRect.left - panelWidth - 6;
    if (left < 4) left = 4;

    var top = Math.max(48, triggerRect.top - 6);
    var maxTop = Math.max(48, window.innerHeight - panel.offsetHeight - 4);
    top = Math.min(top, maxTop);

    panel.style.left = (left - barRect.left) + 'px';
    panel.style.top = (top - barRect.top) + 'px';
    panel.classList.add('nm-open');
    triggerBtn.setAttribute('aria-expanded', 'true');
  }

  /**
   * Creates a toggle-like dropdown row with check indicator.
   * The visual `is-on` state is controlled by `getter()` after toggle.
   */
  function makeCheckItem(iconName, key, getter, toggler) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'nm-item-check';
    btn.setAttribute('data-nm-check-key', key);

    if (iconName) btn.appendChild(makeIcon(iconName, 'nm-item-icon'));

    var label = document.createElement('span');
    label.className = 'nm-item-label';
    label.setAttribute('data-nm-i18n', key);

    var ind = document.createElement('span');
    ind.className = 'nm-check-ind';
    ind.setAttribute('aria-hidden', 'true');

    btn.appendChild(label);
    btn.appendChild(ind);

    btn.addEventListener('click', function () {
      triggerVibrate();
      safeCall(toggler);
      if (getter && getter()) btn.classList.add('is-on');
      else btn.classList.remove('is-on');
    });

    btn._nmGetter = getter;
    return btn;
  }

  /**
   * Creates horizontal separator used inside dropdown menus.
   */
  function makeSepItem() {
    var hr = document.createElement('hr');
    hr.className = 'nm-dd-sep';
    return hr;
  }

  /**
   * Creates a dropdown row that pairs icon + label with a `<select>` control.
   */
  function makeSelectItem(iconName, labelKey, selectEl) {
    var row = document.createElement('div');
    row.className = 'nm-item-select';
    if (iconName) row.appendChild(makeIcon(iconName, 'nm-item-icon'));

    var label = document.createElement('span');
    label.className = 'nm-select-label';
    label.setAttribute('data-nm-i18n', labelKey);
    row.appendChild(label);

    row.appendChild(selectEl);
    return row;
  }

  /**
   * Maps numeric connection state index (0..5) to semantic group.
   * 0/1: disconnected, 2/3: connected, 4/5: error.
   */
  function connStateGroup(idx) {
    if (idx === 2 || idx === 3) return 'connected';
    if (idx === 4 || idx === 5) return 'error';
    return 'disconnected';
  }

  /**
   * Reads current connection state index from button background image URL.
   * This is a compatibility fallback when direct globals are unavailable.
   */
  function parseConnStateFromButton(btn) {
    if (!btn || !btn.style) return 0;
    var bg = String(btn.style.backgroundImage || '');
    var m = /img([0-5])\.(?:gif|png)/i.exec(bg);
    return m ? parseInt(m[1], 10) : 0;
  }

  /**
   * Resolves current connection state group for USB, Bluetooth or WebREPL.
   * Prefers global state vars and falls back to parsing button background image
   * naming convention for button-backed transports.
   */
  function getConnStateGroup(kind) {
    var idx = null;
    var btn = null;
    if (kind === 'usb') btn = document.getElementById('SerialConnectButton');
    if (kind === 'bt') btn = document.getElementById('BLE_SerialConnectButton');
    if (kind === 'usb' && typeof currentState === 'number') idx = currentState;
    if (kind === 'bt' && typeof bleState === 'number') idx = bleState;
    if (kind === 'ws') {
      if (typeof wsState === 'number') idx = wsState;
      else if (typeof window.getWebReplState === 'function') idx = window.getWebReplState();
    }
    if ((kind === 'usb' || kind === 'bt') && (typeof idx !== 'number' || isNaN(idx))) {
      idx = parseConnStateFromButton(btn);
    }
    if (typeof idx !== 'number' || isNaN(idx)) idx = 0;
    return connStateGroup(idx);
  }

  /**
   * Returns i18n key for connection menu label by transport and state.
   */
  function connLabelKey(kind, stateGroup) {
    if (kind === 'usb') {
      if (stateGroup === 'connected') return 'newMenu.disconnectUSB';
      if (stateGroup === 'error') return 'newMenu.reconnectUSB';
      return 'newMenu.connectUSB';
    }
    if (kind === 'ws') {
      if (stateGroup === 'connected') return 'newMenu.disconnectWebREPL';
      if (stateGroup === 'error') return 'newMenu.reconnectWebREPL';
      return 'newMenu.connectWebREPL';
    }
    if (stateGroup === 'connected') return 'newMenu.disconnectBT';
    if (stateGroup === 'error') return 'newMenu.reconnectBT';
    return 'newMenu.connectBT';
  }

  /**
   * Returns dynamic icon name for connection menu row by transport/state.
   */
  function connIconName(kind, stateGroup) {
    if (kind === 'usb') return 'item_usb_' + stateGroup;
    if (kind === 'ws') return stateGroup === 'connected' ? 'item_webrepl_connected' : 'item_webrepl_disconnected';
    return 'item_bluetooth_' + stateGroup;
  }

  /**
   * Returns base fallback icon name when state-specific icon is missing.
   */
  function connIconFallback(kind) {
    if (kind === 'usb') return 'item_usb';
    if (kind === 'ws') return 'item_webrepl_disconnected';
    return 'item_bluetooth';
  }

  /**
   * Applies state-specific icon to a dropdown row with robust fallback logic.
   * If desired icon file fails to load, fallback icon is used automatically.
   */
  function applyDynamicItemIcon(itemEl, iconName, fallbackIcon) {
    if (!itemEl) return;
    var img = itemEl.querySelector('img.nm-item-icon');
    if (!img) return;
    var desired = iconName || fallbackIcon;
    var fallback = fallbackIcon || desired;
    img.style.visibility = '';
    img.setAttribute('data-nm-icon', desired);
    img.onerror = function () {
      if (desired !== fallback) {
        img.onerror = function () {
          img.style.visibility = 'hidden';
        };
        img.setAttribute('data-nm-icon', fallback);
        img.src = iconSrc(fallback);
      } else {
        img.style.visibility = 'hidden';
      }
    };
    img.src = iconSrc(desired);
  }

  /**
   * Synchronizes USB/Bluetooth/WebREPL rows in Device dropdown:
   * updates row label text and icon according to live connection state.
   */
  function syncConnectionMenuItems(bar) {
    if (!bar) return;
    var usbItem = document.getElementById('nm-dd-item-usb');
    var btItem = document.getElementById('nm-dd-item-bt');
    var wsItem = document.getElementById('nm-dd-item-ws');

    var usbState = getConnStateGroup('usb');
    var btState = getConnStateGroup('bt');
    var wsStateGroup = getConnStateGroup('ws');

    if (usbItem) {
      var usbLabel = usbItem.querySelector('.nm-item-label');
      if (usbLabel) usbLabel.textContent = nmT(connLabelKey('usb', usbState));
      applyDynamicItemIcon(usbItem, connIconName('usb', usbState), connIconFallback('usb'));
    }

    if (btItem) {
      var btLabel = btItem.querySelector('.nm-item-label');
      if (btLabel) btLabel.textContent = nmT(connLabelKey('bt', btState));
      applyDynamicItemIcon(btItem, connIconName('bt', btState), connIconFallback('bt'));
    }

    if (wsItem) {
      var wsLabel = wsItem.querySelector('.nm-item-label');
      if (wsLabel) wsLabel.textContent = nmT(connLabelKey('ws', wsStateGroup));
      applyDynamicItemIcon(wsItem, connIconName('ws', wsStateGroup), connIconFallback('ws'));
    }
  }

  /**
   * Returns true when editor is connected over any supported transport.
   * Prefers legacy global helper `isEditorConnected()` and falls back to
   * local USB/BLE/WebREPL state-group detection when helper is unavailable.
   */
  function isAnyDeviceConnected() {
    if (typeof window.isEditorConnected === 'function') {
      try {
        return !!window.isEditorConnected();
      } catch (_) {
        // Ignore and use fallback state detection.
      }
    }
    return getConnStateGroup('usb') === 'connected'
      || getConnStateGroup('bt') === 'connected'
      || getConnStateGroup('ws') === 'connected';
  }

  /**
   * Applies enabled/disabled visual + interaction state to a dropdown button row.
   * Disabled state mirrors existing UI convention used for unsupported BLE row.
   */
  function setMenuItemEnabled(itemEl, enabled) {
    if (!itemEl) return;
    var canUse = !!enabled;
    itemEl.disabled = !canUse;
    itemEl.setAttribute('aria-disabled', canUse ? 'false' : 'true');
    itemEl.style.opacity = canUse ? '1' : '0.45';
    itemEl.style.cursor = canUse ? 'pointer' : 'not-allowed';
  }

  /**
   * Clones a legacy `<select>` into new menu DOM with current options/value.
   * This avoids moving original controls while preserving existing behavior.
   */
  function cloneSelect(sourceId, newId) {
    var src = document.getElementById(sourceId);
    if (!src) return null;

    var sel = document.createElement('select');
    sel.id = newId;
    sel.className = 'nm-dd-select';

    Array.from(src.options || []).forEach(function (opt) {
      var o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.textContent;
      if (opt.getAttribute('data-i18n')) o.setAttribute('data-i18n', opt.getAttribute('data-i18n'));
      sel.appendChild(o);
    });

    sel.value = src.value;
    return sel;
  }

  /**
   * Populates Project dropdown with actions mapped to existing global handlers.
   * Includes dynamic labels for blocks/text mode specific items.
   */
  function buildProjectDropdown(dd) {
    var autostart = document.getElementById('autostart');

    var autoItem = makeCheckItem('item_autostart', 'newMenu.autostart', function () {
      return !!(autostart && autostart.checked);
    }, function () {
      if (!autostart) return;
      autostart.checked = !autostart.checked;
    });

    var openItem = makeItem('item_open_pc', 'newMenu.openFromPC', function () {
      return safeCall(window.openCurrentProject);
    });
    openItem.setAttribute('data-nm-role', 'openpc');

    var saveItem = makeItem('item_save_pc', 'newMenu.saveToPC', function () {
      return safeCall(window.saveCurrentProjectToPC);
    });
    saveItem.setAttribute('data-nm-role', 'savepc');

    var shareItem = makeItem('item_share', 'newMenu.shareProject', function () {
      return safeCall(window.shareCurrentProject);
    });
    shareItem.setAttribute('data-nm-role', 'share');

    var examplesItem = document.createElement('button');
    examplesItem.type = 'button';
    examplesItem.className = 'nm-item nm-examples-trigger';
    examplesItem.setAttribute('aria-haspopup', 'true');
    examplesItem.setAttribute('aria-expanded', 'false');
    examplesItem.setAttribute('aria-controls', 'nm-examples-panel');
    examplesItem.appendChild(makeIcon('item_examples', 'nm-item-icon'));

    var examplesLabel = document.createElement('span');
    examplesLabel.className = 'nm-item-label';
    examplesLabel.setAttribute('data-nm-i18n', 'newMenu.examples');
    examplesItem.appendChild(examplesLabel);

    var examplesArrow = document.createElement('span');
    examplesArrow.className = 'nm-submenu-arrow';
    examplesArrow.setAttribute('aria-hidden', 'true');
    examplesArrow.textContent = '›';
    examplesItem.appendChild(examplesArrow);

    examplesItem.addEventListener('click', function (e) {
      e.stopPropagation();
      triggerVibrate();
      toggleExamplesPanel(examplesItem);
    });

    dd.appendChild(autoItem);
    dd.appendChild(examplesItem);
    dd.appendChild(makeSepItem());
    dd.appendChild(openItem);
    dd.appendChild(saveItem);
    dd.appendChild(makeSepItem());
    var openBackupItem = makeItem('item_open_esp', 'newMenu.openLastBackup', function () {
      return safeCall(window.openLastBlocklyBackup);
    });
    openBackupItem.id = 'nm-dd-item-open-backup';
    dd.appendChild(openBackupItem);

    var openEspItem = makeItem('item_open_esp', 'newMenu.openFromESP', function () { return safeCall(window.openFM); });
    openEspItem.id = 'nm-dd-item-open-esp';
    dd.appendChild(openEspItem);

    var saveEspItem = makeItem('item_save_esp', 'newMenu.saveToESP', function () { return safeCall(window.saveProjectToESP || window.saveCurrentProject); });
    saveEspItem.id = 'nm-dd-item-save-esp';
    dd.appendChild(saveEspItem);
    dd.appendChild(makeSepItem());
    dd.appendChild(shareItem);
    dd.appendChild(makeItem('item_load_shared', 'newMenu.loadShared', function () { return safeCall(window.openShareLoadDialog); }));
    dd.appendChild(makeSepItem());
    dd.appendChild(makeItem('item_show_code', 'newMenu.showCode', function () { return safeCall(window.showCode); }));
    dd.appendChild(makeItem('item_extensions', 'newMenu.extensions', function () { return safeCall(window.openExtensionsDialog); }));
    //dd.appendChild(makeSepItem());
    dd.appendChild(makeItem('item_blocks_display', 'newMenu.blocksDisplay', function () { return safeCall(window.custom_blocks_select); }));
    dd.appendChild(makeItem('item_screenshot', 'newMenu.screenshot', function () { return safeCall(window.captureWorkspaceScreenshotFromMenu); }));
  }

  /**
   * Populates Device dropdown:
   * processor select clone, USB/BLE connect rows, device tools and firmware actions.
   */
  function buildDeviceDropdown(dd) {
    var procSelect = cloneSelect('processorDropdown', 'nm-dd-processor-sel');
    if (procSelect) {
      procSelect.addEventListener('change', function () {
        var source = document.getElementById('processorDropdown');
        if (!source) return;
        source.value = procSelect.value;
        source.dispatchEvent(new Event('change', { bubbles: true }));
      });
      dd.appendChild(makeSelectItem('item_processor', 'newMenu.processor', procSelect));
      state.controls.processor = procSelect;
    }

    dd.appendChild(makeSepItem());

    var usbItem = makeItem('item_usb', 'newMenu.connectUSB', function () {
      var btn = document.getElementById('SerialConnectButton');
      if (btn) btn.click();
    });
    usbItem.id = 'nm-dd-item-usb';
    dd.appendChild(usbItem);

    var btItem = makeItem('item_bluetooth', 'newMenu.connectBT', function () {
      var btn = document.getElementById('BLE_SerialConnectButton');
      if (btn && btn.style.display !== 'none') btn.click();
    });
    btItem.id = 'nm-dd-item-bt';
    dd.appendChild(btItem);

    applyLegacyConnectRowVisibility(usbItem, btItem);

    var wsItem = makeItem('item_webrepl_disconnected', 'newMenu.connectWebREPL', function () {
      return safeCall(window.toggleWebReplConnection);
    });
    wsItem.id = 'nm-dd-item-ws';
    wsItem.style.display = shouldShowWsConnectRow() ? '' : 'none';
    dd.appendChild(wsItem);

    var fmItem = makeItem('item_filemanager', 'newMenu.fileManager', function () { return safeCall(window.openFM); });
    fmItem.id = 'nm-dd-item-filemanager';
    dd.appendChild(fmItem);

    var bleSettingsItem = makeItem('item_ble_settings', 'newMenu.btSettings', function () { return safeCall(window.openBluetoothSettingsDialogFromMenu); });
    bleSettingsItem.id = 'nm-dd-item-ble-settings';
    if (shouldHideLegacyConnectRows()) bleSettingsItem.style.display = 'none';
    dd.appendChild(bleSettingsItem);

    var infoItem = makeItem('item_device_info', 'newMenu.deviceInfo', function () { return safeCall(window.get_Info); });
    infoItem.id = 'nm-dd-item-device-info';
    dd.appendChild(infoItem);

    var resetItem = makeItem('item_reset', 'newMenu.reset', function () { return safeCall(window.ResetCPU); });
    resetItem.id = 'nm-dd-item-reset';
    dd.appendChild(resetItem);
    dd.appendChild(makeSepItem());
    dd.appendChild(makeItem('item_firmware', 'newMenu.firmware', function () { return safeCall(window.openInstall); }));
    var joystickItem = makeItem('item_joystick', 'newMenu.joystick', function () { return safeCall(window.openJoy_App); });
    joystickItem.id = 'nm-dd-item-joystick';
    if (shouldHideLegacyConnectRows()) joystickItem.style.display = 'none';
    dd.appendChild(joystickItem);
  }

  /**
   * Populates Settings dropdown:
   * language clone, theme selector, layout selector and utility toggles/actions.
   */
  function buildSettingsDropdown(dd) {
    var langSelect = cloneSelect('languageSelect', 'nm-dd-language-sel');
    if (langSelect) {
      langSelect.addEventListener('change', function () {
        var source = document.getElementById('languageSelect');
        if (!source) return;
        source.value = langSelect.value;
        source.dispatchEvent(new Event('change', { bubbles: true }));
      });
      dd.appendChild(makeSelectItem('item_language', 'newMenu.language', langSelect));
      state.controls.language = langSelect;
    }

    dd.appendChild(makeSepItem());

    var themeSel = document.createElement('select');
    themeSel.id = 'nm-dd-theme-sel';
    [
      { value: 'light', key: 'newMenu.themeLight' },
      { value: 'dark', key: 'newMenu.themeDark' }
    ].forEach(function (item) {
      var opt = document.createElement('option');
      opt.value = item.value;
      opt.setAttribute('data-nm-i18n', item.key);
      opt.textContent = nmT(item.key);
      themeSel.appendChild(opt);
    });
    themeSel.value = isDark() ? 'dark' : 'light';
    themeSel.addEventListener('change', function () {
      var tgl = document.getElementById('themeToggle');
      if (!tgl) return;
      var wantDark = themeSel.value === 'dark';
      if (tgl.checked !== wantDark) {
        tgl.checked = wantDark;
        tgl.dispatchEvent(new Event('change', { bubbles: true }));
      }
      syncState({ immediate: true });
      updateAllIcons();
    });
    dd.appendChild(makeSelectItem('item_theme', 'newMenu.theme', themeSel));
    state.controls.theme = themeSel;

    var menuLayoutSel = document.createElement('select');
    menuLayoutSel.id = 'nm-dd-layout-sel';
    [
      { value: 'layout1', key: 'newMenu.layout1' },
      { value: 'layout2', key: 'newMenu.layout2' },
      { value: 'original', key: 'newMenu.layoutOriginal' }
    ].forEach(function (item) {
      var opt = document.createElement('option');
      opt.value = item.value;
      opt.setAttribute('data-nm-i18n', item.key);
      opt.textContent = nmT(item.key);
      menuLayoutSel.appendChild(opt);
    });
    menuLayoutSel.value = state.layout;
    menuLayoutSel.addEventListener('change', function () {
      applyLayout(menuLayoutSel.value);
      syncState({ immediate: true });
    });

    dd.appendChild(makeSelectItem('item_menu_type', 'newMenu.menuType', menuLayoutSel));
    state.controls.layout = menuLayoutSel;

    var backupSel = document.createElement('select');
    backupSel.id = 'nm-dd-backup-sel';
    [
      { value: 'never', key: 'newMenu.backupNever' },
      { value: 'usb', key: 'newMenu.backupUsb' },
      { value: 'always', key: 'newMenu.backupAlways' }
    ].forEach(function (item) {
      var opt = document.createElement('option');
      opt.value = item.value;
      opt.setAttribute('data-nm-i18n', item.key);
      opt.textContent = nmT(item.key);
      backupSel.appendChild(opt);
    });
    backupSel.value = (typeof window.getBlocklyBackupMode === 'function')
      ? window.getBlocklyBackupMode()
      : normalizeBackupMode(readSettings().blocklyBackupMode);
    backupSel.addEventListener('change', function () {
      var value = normalizeBackupMode(backupSel.value);
      if (typeof window.setBlocklyBackupMode === 'function') {
        window.setBlocklyBackupMode(value);
      } else {
        writeSettings({ blocklyBackupMode: value });
      }
      backupSel.value = value;
    });
    dd.appendChild(makeSelectItem('item_save_esp', 'newMenu.backupMode', backupSel));
    state.controls.backup = backupSel;

    dd.appendChild(makeSepItem());

    dd.appendChild(makeCheckItem('item_autostart', 'newMenu.autostartDefault', function () {
      var pref = readAutostartBootPreference();
      if (typeof pref === 'boolean') return pref;
      var autostart = document.getElementById('autostart');
      return !!(autostart && autostart.checked);
    }, function () {
      var pref = readAutostartBootPreference();
      var current = (typeof pref === 'boolean')
        ? pref
        : !!(document.getElementById('autostart') && document.getElementById('autostart').checked);
      setAutostartBootPreference(!current);
      syncState({ immediate: true });
    }));

    dd.appendChild(makeCheckItem('item_auto_start_blocks', 'newMenu.autoStartProgramBlocks', function () {
      if (typeof window.getAutoStartProgramBlocksEnabled === 'function') {
        return !!window.getAutoStartProgramBlocksEnabled();
      }
      var settings = readSettings();
      return settings.autoStartProgramBlocks !== false;
    }, function () {
      var current = true;
      if (typeof window.getAutoStartProgramBlocksEnabled === 'function') {
        current = !!window.getAutoStartProgramBlocksEnabled();
      } else {
        current = readSettings().autoStartProgramBlocks !== false;
      }
      if (typeof window.setAutoStartProgramBlocksEnabled === 'function') {
        window.setAutoStartProgramBlocksEnabled(!current);
      } else {
        writeSettings({ autoStartProgramBlocks: !current });
      }
      syncState({ immediate: true });
    }));

    dd.appendChild(makeCheckItem('item_toolbox_icons', 'newMenu.toolboxIcons', function () {
      if (typeof window.getToolboxCategoryIconsEnabled === 'function') {
        return !!window.getToolboxCategoryIconsEnabled();
      }
      return true;
    }, function () {
      if (typeof window.getToolboxCategoryIconsEnabled === 'function' &&
          typeof window.setToolboxCategoryIconsEnabled === 'function') {
        var next = !window.getToolboxCategoryIconsEnabled();
        window.setToolboxCategoryIconsEnabled(next);
      } else if (typeof window.injectToolboxIcons === 'function') {
        // Fallback for older index.html without explicit toggle API.
        window.injectToolboxIcons();
      }
      syncState({ immediate: true });
    }));


  }

  /**
   * Populates Info dropdown with current version row and changelog action.
   */
  function buildInfoDropdown(dd) {
    var versionRow = document.createElement('div');
    versionRow.className = 'nm-item';

    versionRow.appendChild(makeIcon('item_version', 'nm-item-icon'));

    var labelBox = document.createElement('div');
    labelBox.style.display = 'flex';
    labelBox.style.flexDirection = 'column';
    labelBox.style.gap = '2px';

    var vLabel = document.createElement('span');
    vLabel.className = 'nm-item-label';
    vLabel.setAttribute('data-nm-i18n', 'newMenu.version');

    var vValue = document.createElement('span');
    vValue.className = 'nm-item-muted';
    vValue.id = 'nm-version-value';

    labelBox.appendChild(vLabel);
    labelBox.appendChild(vValue);
    versionRow.appendChild(labelBox);

    dd.appendChild(versionRow);
    dd.appendChild(makeSepItem());
    dd.appendChild(makeItem('item_about', 'newMenu.documentation', function () {
      if (typeof window.openDocs_App === 'function') window.openDocs_App();
    }));
    dd.appendChild(makeItem('item_changelog', 'newMenu.changelog', function () {
      if (typeof window.showChangelog === 'function') window.showChangelog();
    }));
  }

  /**
   * Builds all dropdown containers and appends them to the topbar root.
   * Also resets `state.controls` references used by runtime synchronization.
   */
  function buildDropdowns(bar) {
    state.controls = {};

    var ddProject = makeDropdown('nm-dd-project');
    var ddDevice = makeDropdown('nm-dd-device');
    var ddSettings = makeDropdown('nm-dd-settings');
    var ddInfo = makeDropdown('nm-dd-info');
    var examplesPanel = makeDropdown('nm-examples-panel');
    examplesPanel.classList.add('nm-examples-panel');

    buildProjectDropdown(ddProject);
    buildDeviceDropdown(ddDevice);
    buildSettingsDropdown(ddSettings);
    buildInfoDropdown(ddInfo);
    buildExamplesPanel(examplesPanel);

    bar.appendChild(ddProject);
    bar.appendChild(ddDevice);
    bar.appendChild(ddSettings);
    bar.appendChild(ddInfo);
    bar.appendChild(examplesPanel);
  }

  /**
   * Builds full topbar structure for selected layout (left/center/right sections).
   * This function reuses persistent external controls (mode switch + connection buttons),
   * attaches dropdowns, applies translations/icons, and performs initial sync.
   */
  function buildBar(layout) {
    var bar = getBar();
    if (!bar) return;

    clearBar();

    var left = document.createElement('div');
    left.className = 'nm-section nm-left';

    var center = document.createElement('div');
    center.className = 'nm-section nm-center';

    var right = document.createElement('div');
    right.className = 'nm-section nm-right';

    var runBtn = makeActionButton('nm-btn-run', 'btn_run', 'newMenu.run', window.runCode);
    var stopBtn = makeActionButton('nm-btn-stop', 'btn_stop', 'newMenu.stop', window.stopCode);
    var undoBtn = makeActionButton('nm-btn-undo', 'btn_undo', 'newMenu.undo', window.topbarUndo);
    var redoBtn = makeActionButton('nm-btn-redo', 'btn_redo', 'newMenu.redo', window.topbarRedo);

    var projectBtn = makeMenuButton('nm-mbtn-project', 'menu_project', 'newMenu.project', 'nm-dd-project');
    var deviceBtn = makeMenuButton('nm-mbtn-device', 'menu_device', 'newMenu.device', 'nm-dd-device');
    var settingsBtn = makeMenuButton('nm-mbtn-settings', 'menu_settings', 'newMenu.settings', 'nm-dd-settings');

    if (layout === 'layout2') {
      left.appendChild(projectBtn);
      left.appendChild(deviceBtn);
      left.appendChild(settingsBtn);
      left.appendChild(makeSep());
      left.appendChild(undoBtn);
      left.appendChild(redoBtn);

      center.appendChild(runBtn);
      center.appendChild(stopBtn);
      center.appendChild(makeSep());
    } else {
      left.appendChild(runBtn);
      left.appendChild(stopBtn);
      left.appendChild(makeSep());
      left.appendChild(undoBtn);
      left.appendChild(redoBtn);
      left.appendChild(makeSep());
      left.appendChild(projectBtn);
      left.appendChild(deviceBtn);
      left.appendChild(settingsBtn);
    }

    var connWrap = document.createElement('div');
    connWrap.className = 'nm-conn-wrap';
    if (moveConnectButtons(connWrap)) {
      left.appendChild(makeSep());
      left.appendChild(connWrap);
    }

    moveModeSwitch(center);
    right.appendChild(makeInfoButton());

    bar.appendChild(left);
    bar.appendChild(center);
    bar.appendChild(right);

    buildDropdowns(bar);

    applyTranslations(bar);
    updateAllIcons();
    applyResponsiveBreakpoints();
    syncState({ immediate: true });
    adjustCenterAlign();

    if (!bar._nmLeaveBound) {
      // Hover-close is intentionally mouse-only (no touch/pen hover behavior).
      if (window.PointerEvent) {
        bar.addEventListener('pointerenter', function (e) {
          if (!e || e.pointerType !== 'mouse') return;
          cancelDeferredDropdownClose();
        });
        bar.addEventListener('pointerleave', function (e) {
          if (!e || e.pointerType !== 'mouse') return;
          scheduleDeferredDropdownClose();
        });
      } else if (canUseHoverOpen()) {
        bar.addEventListener('mouseenter', cancelDeferredDropdownClose);
        bar.addEventListener('mouseleave', scheduleDeferredDropdownClose);
      }
      bar._nmLeaveBound = true;
    }
  }

  /**
   * Applies class-based responsive states to topbar according to configured breakpoints.
   * `nm-bp-hide-connections`: hide USB/BLE pair first.
   * `nm-bp-icons-only`: collapse menu buttons to icons only.
   */
  function applyResponsiveBreakpoints() {
    var bar = getBar();
    if (!bar) return;

    // Original layout keeps legacy controls untouched (no responsive hiding).
    if (state.layout === 'original') {
      bar.classList.remove('nm-bp-hide-connections');
      bar.classList.remove('nm-bp-icons-only');
      return;
    }

    var w = window.innerWidth || document.documentElement.clientWidth || 0;
    bar.classList.toggle('nm-bp-hide-connections', w <= NM.responsive.hideConnections);
    bar.classList.toggle('nm-bp-icons-only', w <= NM.responsive.iconOnlyMenus);
  }

  /**
   * Keeps center section visually centered while preventing overlap with left section.
   * If overlap occurs, center section switches to follow-left flow mode.
   * Otherwise center x-position is pixel-snapped to avoid icon blur.
   */
  function adjustCenterAlign() {
    var bar = getBar();
    if (!bar || state.layout === 'original') return;

    var centerEl = bar.querySelector('.nm-center');
    var leftEl = bar.querySelector('.nm-left');
    if (!centerEl || !leftEl) return;

    // Reset to baseline centered mode before collision detection.
    centerEl.classList.remove('nm-follow-left');
    centerEl.style.left = '';
    centerEl.style.transform = '';

    var leftRight = leftEl.getBoundingClientRect().right;
    var centerLeft = centerEl.getBoundingClientRect().left;
    if (centerLeft <= leftRight + 2) {
      centerEl.classList.add('nm-follow-left');
      return;
    }

    // Pixel-snap center position to avoid sub-pixel blur on bitmap icons (modeSwitch).
    var barRect = bar.getBoundingClientRect();
    var centerRect = centerEl.getBoundingClientRect();
    var snapLeft = Math.max(0, Math.round((barRect.width - centerRect.width) / 2));
    centerEl.style.left = snapLeft + 'px';
    centerEl.style.transform = 'none';
  }

  /**
   * Clears pending delayed dropdown close (used by hover-close logic).
   */
  function cancelDeferredDropdownClose() {
    if (!state.ddCloseTimer) return;
    clearTimeout(state.ddCloseTimer);
    state.ddCloseTimer = 0;
  }

  /**
   * Cancels pending dropdown open animation frame callback.
   * Prevents late `nm-open` re-apply after a fast outside close.
   */
  function cancelPendingDropdownOpen() {
    if (!state.ddOpenRaf) return;
    cancelAnimationFrame(state.ddOpenRaf);
    state.ddOpenRaf = 0;
  }

  /**
   * Schedules safe delayed dropdown close after pointer leaves topbar region.
   * Delay prevents accidental close while cursor travels from trigger button
   * to dropdown on narrow layouts.
   */
  function scheduleDeferredDropdownClose() {
    cancelDeferredDropdownClose();
    state.ddCloseTimer = setTimeout(function () {
      state.ddCloseTimer = 0;
      if (!state.openDropdownId) return;
      var bar = getBar();
      if (!bar) return;
      var dd = document.getElementById(state.openDropdownId);
      var examplesPanel = document.getElementById('nm-examples-panel');
      var overBar = false;
      var overDd = false;
      var overExamples = false;
      try {
        overBar = bar.matches(':hover');
        overDd = !!(dd && dd.matches(':hover'));
        overExamples = !!(examplesPanel && examplesPanel.matches(':hover'));
      } catch (_) {
        // If hover-state query fails, fall back to closing safely.
      }
      if (!overBar && !overDd && !overExamples) closeDropdowns();
    }, 140);
  }

  /**
   * Closes opened dropdown when user starts interaction outside topbar area.
   * Capture phase ensures this works even when other layers swallow bubbling.
   * Together with overlay handling this provides reliable outside-close behavior.
   */
  function onGlobalPressStart(e) {
    if (!state.openDropdownId) return;
    var bar = getBar();
    if (!bar) return;

    var target = e && e.target;
    if (target && bar.contains(target)) return;
    closeDropdowns();
  }

  /**
   * Installs one-time global outside-close listeners (desktop + touch fallback).
   */
  function ensureOutsideCloseHandlers() {
    if (state.outsideCloseBound) return;

    if (window.PointerEvent) {
      document.addEventListener('pointerdown', onGlobalPressStart, { capture: true, passive: true });
    } else {
      document.addEventListener('touchstart', onGlobalPressStart, { capture: true, passive: true });
      document.addEventListener('mousedown', onGlobalPressStart, { capture: true, passive: true });
    }
    state.outsideCloseBound = true;
  }

  /**
   * Opens target dropdown for given trigger button and computes safe horizontal position.
   * Position is clamped to viewport width and right-align mode is used when needed.
   */
  function openDropdown(ddId, triggerBtn) {
    var bar = getBar();
    if (!bar) return;

    var dd = document.getElementById(ddId);
    if (!dd || !triggerBtn) return;

    cancelDeferredDropdownClose();
    cancelPendingDropdownOpen();
    closeDropdowns();

    var bRect = bar.getBoundingClientRect();
    var tRect = triggerBtn.getBoundingClientRect();
    var left = tRect.left - bRect.left;

    dd.classList.remove('nm-right-align');
    dd.style.left = left + 'px';

    // Use offsetWidth so clamp is not affected by scale transforms.
    var ddW = dd.offsetWidth;
    var overflow = (bRect.left + left + ddW) - (window.innerWidth - 4);

    if (overflow > 0) {
      dd.style.left = Math.max(0, left - overflow) + 'px';
      dd.classList.add('nm-right-align');
    }

    if (parseFloat(dd.style.left) < 0) dd.style.left = '0px';

    state.ddOpenRaf = requestAnimationFrame(function () {
      state.ddOpenRaf = 0;
      if (state.openDropdownId !== ddId) return;
      dd.classList.add('nm-open');
    });

    triggerBtn.classList.add('nm-open-trigger');
    state.openDropdownId = ddId;

    if (state.overlayEl) state.overlayEl.classList.add('nm-visible');
  }

  /**
   * Closes all open dropdowns and resets trigger/overlay/tooltip state.
   */
  function closeDropdowns() {
    cancelDeferredDropdownClose();
    cancelPendingDropdownOpen();
    var bar = getBar();
    if (!bar) return;

    bar.querySelectorAll('.nm-dropdown.nm-open').forEach(function (dd) {
      dd.classList.remove('nm-open');
    });

    bar.querySelectorAll('.nm-open-trigger').forEach(function (btn) {
      btn.classList.remove('nm-open-trigger');
    });

    var examplesTrigger = bar.querySelector('.nm-examples-trigger');
    if (examplesTrigger) examplesTrigger.setAttribute('aria-expanded', 'false');

    if (state.overlayEl) state.overlayEl.classList.remove('nm-visible');
    state.openDropdownId = null;
    hideTooltip();
  }

  /**
   * Updates the version value shown in the Info dropdown.
   * Keeps compatibility with older id used by earlier menu revisions.
   */
  function setInfoVersionText(text) {
    var versionText = text || '';
    var vv = document.getElementById('nm-version-value');
    if (vv) vv.textContent = versionText;
    var vvCompat = document.getElementById('nm-dd-version-value');
    if (vvCompat) vvCompat.textContent = versionText;
  }

  /**
   * Performs full immediate synchronization of new menu with legacy UI state.
   * This updates check rows, select values, dynamic labels, connection rows,
   * BLE availability, and version text.
   */
  function syncStateNow() {
    var bar = getBar();
    if (!bar) return;

    var autostart = document.getElementById('autostart');
    var themeToggle = document.getElementById('themeToggle');
    var processor = document.getElementById('processorDropdown');
    var language = document.getElementById('languageSelect');
    var mode = (window.projectMode === 'text') ? 'text' : 'blocks';

    bar.querySelectorAll('.nm-item-check').forEach(function (item) {
      if (typeof item._nmGetter === 'function') {
        if (item._nmGetter()) item.classList.add('is-on');
        else item.classList.remove('is-on');
      }
    });

    if (state.controls.processor && processor) {
      if (state.controls.processor.options.length !== processor.options.length) {
        // Keep options aligned after processor list updates.
        var old = state.controls.processor;
        var replacement = cloneSelect('processorDropdown', old.id);
        if (replacement && old.parentNode) {
          old.parentNode.replaceChild(replacement, old);
          replacement.addEventListener('change', function () {
            processor.value = replacement.value;
            processor.dispatchEvent(new Event('change', { bubbles: true }));
          });
          state.controls.processor = replacement;
        }
      }
      state.controls.processor.value = processor.value;
    }

    if (state.controls.language && language) {
      state.controls.language.value = language.value;
    }

    if (state.controls.theme) {
      state.controls.theme.value = isDark() ? 'dark' : 'light';
      Array.from(state.controls.theme.options).forEach(function (opt) {
        var key = opt.getAttribute('data-nm-i18n');
        if (key) opt.textContent = nmT(key);
      });
    }

    if (state.controls.layout) {
      state.controls.layout.value = state.layout;
      Array.from(state.controls.layout.options).forEach(function (opt) {
        var key = opt.getAttribute('data-nm-i18n');
        if (key) opt.textContent = nmT(key);
      });
    }

    if (state.controls.backup) {
      state.controls.backup.value = (typeof window.getBlocklyBackupMode === 'function')
        ? window.getBlocklyBackupMode()
        : normalizeBackupMode(readSettings().blocklyBackupMode);
      Array.from(state.controls.backup.options).forEach(function (opt) {
        var key = opt.getAttribute('data-nm-i18n');
        if (key) opt.textContent = nmT(key);
      });
    }

    var legacyLayoutSel = document.getElementById('nm-more-layout-sel');
    if (legacyLayoutSel) legacyLayoutSel.value = state.layout;

    // Keep dynamic labels matching current project mode.
    var openKey = mode === 'text' ? 'menu.openFileText' : 'newMenu.openFromPC';
    var saveKey = mode === 'text' ? 'menu.saveFileText' : 'newMenu.saveToPC';
    var shareKey = mode === 'text' ? 'menu.shareFile' : 'newMenu.shareProject';

    var openRow = bar.querySelector('[data-nm-role="openpc"] .nm-item-label');
    var saveRow = bar.querySelector('[data-nm-role="savepc"] .nm-item-label');
    var shareRow = bar.querySelector('[data-nm-role="share"] .nm-item-label');

    if (openRow) openRow.textContent = nmT(openKey);
    if (saveRow) saveRow.textContent = nmT(saveKey);
    if (shareRow) shareRow.textContent = nmT(shareKey);

    var usbItem = document.getElementById('nm-dd-item-usb');
    var btItem = document.getElementById('nm-dd-item-bt');
    var wsItem = document.getElementById('nm-dd-item-ws');
    var bleSettingsItem = document.getElementById('nm-dd-item-ble-settings');
    var joystickItem = document.getElementById('nm-dd-item-joystick');
    var usbBtn = document.getElementById('SerialConnectButton');
    var bleBtn = document.getElementById('BLE_SerialConnectButton');
    var showLegacyRows = applyLegacyConnectRowVisibility(usbItem, btItem);
    var showWsRow = shouldShowWsConnectRow();
    if (bleSettingsItem) bleSettingsItem.style.display = showLegacyRows ? '' : 'none';
    if (joystickItem) joystickItem.style.display = showLegacyRows ? '' : 'none';
    if (wsItem) wsItem.style.display = showWsRow ? '' : 'none';
    syncConnectionMenuItems(bar);
    var canUsb = !!(showLegacyRows && usbBtn && usbBtn.style.display !== 'none');
    var canBle = !!(showLegacyRows && bleBtn && bleBtn.style.display !== 'none');
    var canWs = !!(showWsRow && typeof window.WebSocket !== 'undefined');
    setMenuItemEnabled(usbItem, canUsb);
    setMenuItemEnabled(btItem, canBle);
    setMenuItemEnabled(wsItem, canWs);

    var deviceConnected = isAnyDeviceConnected();
    setMenuItemEnabled(document.getElementById('nm-dd-item-open-backup'), deviceConnected);
    setMenuItemEnabled(document.getElementById('nm-dd-item-open-esp'), deviceConnected);
    setMenuItemEnabled(document.getElementById('nm-dd-item-save-esp'), deviceConnected);
    setMenuItemEnabled(document.getElementById('nm-dd-item-filemanager'), deviceConnected);
    setMenuItemEnabled(document.getElementById('nm-dd-item-ble-settings'), deviceConnected);
    setMenuItemEnabled(document.getElementById('nm-dd-item-device-info'), deviceConnected);
    setMenuItemEnabled(document.getElementById('nm-dd-item-reset'), deviceConnected);
    setMenuItemEnabled(document.getElementById('nm-dd-item-joystick'), !isElectronRuntime());

    var menuVersion = document.getElementById('menuVersionText');
    var versionText = '';
    if (menuVersion && menuVersion.textContent) versionText = menuVersion.textContent;
    else if (typeof window.ESPIDE_VERSION === 'string') versionText = window.ESPIDE_VERSION;
    setInfoVersionText(versionText);

    // Ensure external controls reflect checkbox state if available.
    if (autostart && !bar.querySelector('[data-nm-check-key="newMenu.autostart"]')) {
      autostart.checked = autostart.checked;
    }
    if (themeToggle) themeToggle.checked = isDark();
  }

  /**
   * Cancels any queued throttled sync work.
   * Used before forced immediate sync to avoid stale delayed updates.
   */
  function cancelScheduledSync() {
    if (syncRaf) {
      cancelAnimationFrame(syncRaf);
      syncRaf = 0;
    }
    if (syncTimer) {
      clearTimeout(syncTimer);
      syncTimer = 0;
    }
    syncQueued = false;
  }

  /**
   * Public sync entry point with optional throttling.
   * - `immediate: true` => sync immediately.
   * - default => coalesce bursts via requestAnimationFrame + 50ms throttle window.
   */
  function syncState(opts) {
    opts = opts || {};
    if (opts.immediate) {
      cancelScheduledSync();
      lastSyncTs = Date.now();
      syncStateNow();
      return;
    }

    if (syncQueued) return;
    syncQueued = true;

    syncRaf = requestAnimationFrame(function () {
      syncRaf = 0;
      var now = Date.now();
      var wait = Math.max(0, SYNC_MIN_MS - (now - lastSyncTs));
      syncTimer = setTimeout(function () {
        syncTimer = 0;
        syncQueued = false;
        lastSyncTs = Date.now();
        syncStateNow();
      }, wait);
    });
  }

  /**
   * Attaches mutation observers for runtime synchronization triggers:
   * theme class changes, language changes, and USB/BLE button state attributes.
   */
  function setupObservers() {
    state.observers.forEach(function (ob) { try { ob.disconnect(); } catch (_) {} });
    state.observers = [];

    var classObs = new MutationObserver(function () {
      updateAllIcons();
      syncState();
    });
    classObs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    state.observers.push(classObs);

    var langObs = new MutationObserver(function () {
      applyTranslations(getBar());
      syncState();
    });
    langObs.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    state.observers.push(langObs);

    var usbBtn = document.getElementById('SerialConnectButton');
    var bleBtn = document.getElementById('BLE_SerialConnectButton');
    if (usbBtn || bleBtn) {
      var connObs = new MutationObserver(function () {
        syncState();
      });
      if (usbBtn) connObs.observe(usbBtn, { attributes: true, attributeFilter: ['style', 'class', 'disabled'] });
      if (bleBtn) connObs.observe(bleBtn, { attributes: true, attributeFilter: ['style', 'class', 'disabled'] });
      state.observers.push(connObs);
    }
  }

  /**
   * Applies selected menu layout and persists it to settings.
   * Handles switching between custom layouts and `original` mode, including
   * moving/restoring shared controls and forcing post-layout resize alignment.
   */
  function applyLayout(layout) {
    saveModeSwitch();
    state.layout = validLayout(layout);
    writeSettings({ menuLayout: state.layout });

    var bar = getBar();
    if (!bar) return;

    closeDropdowns();

    if (state.layout === 'original') {
      bar.style.display = 'none';
      document.body.classList.remove('nm-active');
      restoreModeSwitch();
      restoreConnectButtons();
      syncState({ immediate: true });
      setTimeout(function () {
        window.dispatchEvent(new Event('resize'));
      }, 20);
      return;
    }

    buildBar(state.layout);

    // Activate the new menu only after modeSwitch is safely moved.
    document.body.classList.add('nm-active');
    bar.style.display = 'flex';

    applyTranslations(bar);
    syncState({ immediate: true });

    setTimeout(function () {
      adjustCenterAlign();
      window.dispatchEvent(new Event('resize'));
    }, 20);
  }

  /**
   * One-time module initialization entry.
   * Reads saved layout, prepares DOM helpers, installs observers/resize logic,
   * and renders initial layout after short startup delay.
   */
  function init() {
    if (state.initDone) return;

    var bar = getBar();
    if (!bar) return;

    state.initDone = true;

    var saved = readSettings();
    state.layout = validLayout(saved.menuLayout || 'layout1');

    preloadIcons();
    ensureOverlay();
    ensureOutsideCloseHandlers();
    ensureTooltip();
    saveModeSwitch();
    saveConnectButtons();
    applyAutostartBootPreferenceOnLoad();
    setupObservers();
    window.addEventListener('espide:version-updated', function (e) {
      var versionText = '';
      if (e && e.detail && typeof e.detail.version === 'string') versionText = e.detail.version;
      else if (typeof window.ESPIDE_VERSION === 'string') versionText = window.ESPIDE_VERSION;
      setInfoVersionText(versionText);
    });

    window.addEventListener('resize', function () {
      applyResponsiveBreakpoints();
      adjustCenterAlign();
      if (state.openDropdownId) {
        var trigger = bar.querySelector('.nm-menu-btn.nm-open-trigger') || document.getElementById('nm-info-btn');
        if (trigger && state.openDropdownId) openDropdown(state.openDropdownId, trigger);
      }
    }, { passive: true });

    applyLayout(state.layout);
  }

  // Public API for integration with existing app code.
  window.nmApplyTranslations = function () {
    applyTranslations(getBar());
    syncState({ immediate: true });
  };
  window.nmSyncState = function () {
    syncState({ immediate: true });
  };
  window.nmUpdateIcons = updateAllIcons;
  window.nmApplyLayout = applyLayout;

  setTimeout(init, 250);
})();
