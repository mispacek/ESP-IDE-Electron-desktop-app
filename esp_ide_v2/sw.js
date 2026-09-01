// /esp_ide_v2/sw.js — robustní PWA cache
// scope: /esp_ide_v2/
// Verze ma jediny zdroj v index.html. Worker ji prevezme z registracni URL,
// napr. sw.js?v=<APP_VERSION>.
const SW_SCRIPT_URL = new URL(self.location.href);
const APP_VERSION = SW_SCRIPT_URL.searchParams.get('v') || 'unversioned';
const CACHE_PREFIX = 'espide-static-';
const STATIC_CACHE = `${CACHE_PREFIX}${APP_VERSION}`;
const BASE = new URL('./', self.registration.scope).href;
const PRECACHE_CONCURRENCY = 8;
// Keep the host's SW_INSTALL_TIMEOUT_MS at least this long.
const PRECACHE_TIMEOUT_MS = 45000;

// Přehledně udržovaný seznam. Duplicity se odfiltrují.
// Nepřidávej "./" kořen; stačí index.html.
// Pokud neco chybi na serveru, nova verze se neaktivuje a zustane stara
// kompletni offline cache. Klientsky loading ma vlastni casovy limit.
const PRECACHE_PATHS = [
  'changelog_cs.txt',
  'changelog_en.txt',
  'css/filemanager.css',
  'css/new_menu.css',
  'css/sweetalert2.min.css',
  'css/xterm.css',
  'js/display_designer/display_designer.css',
  'js/display_designer/font_editor.css',
  'favicon.ico',
  'filemanager.html',
  'img_editor.html',
  'img_editor_cs.html',
  'img_editor_de.html',
  'img_editor_en.html',
  'index.html',
  'i18n/en.json',
  'i18n/cs.json',
  'i18n/de.json',
  'js/ace.js',
  'js/blockly_compressed.js',
  'js/blockly_project_dependencies.js',
  'js/blocks_compressed.js',
  'js/cs.js',
  'js/de.js',
  'js/display_designer/bitmap_font_importer.js',
  'js/display_designer/default_fonts/catalog.js',
  'js/display_designer/default_fonts/font_3x6.mfnt',
  'js/display_designer/default_fonts/font_3x6.png',
  'js/display_designer/default_fonts/font_5x8.mfnt',
  'js/display_designer/default_fonts/font_5x8.png',
  'js/display_designer/default_fonts/font_6x14_bold.mfnt',
  'js/display_designer/default_fonts/font_6x14_bold.png',
  'js/display_designer/default_fonts/font_12x24.mfnt',
  'js/display_designer/default_fonts/font_12x24.png',
  'js/display_designer/default_fonts/font_16x28.mfnt',
  'js/display_designer/default_fonts/font_16x28.png',
  'js/display_designer/default_fonts/font_7x16.mfnt',
  'js/display_designer/default_fonts/font_7x16.png',
  'js/display_designer/default_fonts/spleen_8.mfnt',
  'js/display_designer/default_fonts/spleen_8.png',
  'js/display_designer/default_fonts/spleen_12.mfnt',
  'js/display_designer/default_fonts/spleen_12.png',
  'js/display_designer/default_fonts/spleen_16.mfnt',
  'js/display_designer/default_fonts/spleen_16.png',
  'js/display_designer/default_fonts/spleen_24.mfnt',
  'js/display_designer/default_fonts/spleen_24.png',
  'js/display_designer/default_fonts/spleen_32.mfnt',
  'js/display_designer/default_fonts/spleen_32.png',
  'js/display_designer/default_fonts/spleen_64.mfnt',
  'js/display_designer/default_fonts/spleen_64.png',
  'js/display_designer/default_fonts/ter_14_narrow.mfnt',
  'js/display_designer/default_fonts/ter_14_narrow.png',
  'js/display_designer/default_fonts/ter_16_narrow.mfnt',
  'js/display_designer/default_fonts/ter_16_narrow.png',
  'js/display_designer/default_fonts/ter_20_narrow.mfnt',
  'js/display_designer/default_fonts/ter_20_narrow.png',
  'js/display_designer/default_fonts/ter_22_narrow.mfnt',
  'js/display_designer/default_fonts/ter_22_narrow.png',
  'js/display_designer/default_fonts/ter_24_narrow.mfnt',
  'js/display_designer/default_fonts/ter_24_narrow.png',
  'js/display_designer/default_fonts/ter_28_narrow.mfnt',
  'js/display_designer/default_fonts/ter_28_narrow.png',
  'js/display_designer/default_fonts/ter_32_narrow.mfnt',
  'js/display_designer/default_fonts/ter_32_narrow.png',
  'js/display_designer/default_fonts/ter_12_bold.mfnt',
  'js/display_designer/default_fonts/ter_12_bold.png',
  'js/display_designer/default_fonts/ter_14_bold.mfnt',
  'js/display_designer/default_fonts/ter_14_bold.png',
  'js/display_designer/default_fonts/ter_16_bold.mfnt',
  'js/display_designer/default_fonts/ter_16_bold.png',
  'js/display_designer/default_fonts/ter_20_bold.mfnt',
  'js/display_designer/default_fonts/ter_20_bold.png',
  'js/display_designer/default_fonts/ter_22_bold.mfnt',
  'js/display_designer/default_fonts/ter_22_bold.png',
  'js/display_designer/default_fonts/ter_24_bold.mfnt',
  'js/display_designer/default_fonts/ter_24_bold.png',
  'js/display_designer/default_fonts/ter_32_bold.mfnt',
  'js/display_designer/default_fonts/ter_32_bold.png',
  'js/display_designer/default_fonts/Tamzen_8.mfnt',
  'js/display_designer/default_fonts/Tamzen_8.png',
  'js/display_designer/default_fonts/Tamzen_13.mfnt',
  'js/display_designer/default_fonts/Tamzen_13.png',
  'js/display_designer/default_fonts/Tamzen_16.mfnt',
  'js/display_designer/default_fonts/Tamzen_16.png',
  'js/display_designer/default_fonts/Tamzen_8_bold.mfnt',
  'js/display_designer/default_fonts/Tamzen_8_bold.png',
  'js/display_designer/default_fonts/Tamzen_13_bold.mfnt',
  'js/display_designer/default_fonts/Tamzen_13_bold.png',
  'js/display_designer/default_fonts/Tamzen_16_bold.mfnt',
  'js/display_designer/default_fonts/Tamzen_16_bold.png',
  'js/display_designer/default_fonts/7_Seg_33x19.mfnt',
  'js/display_designer/default_fonts/7_Seg_33x19.png',
  'js/display_designer/display_designer.js',
  'js/display_designer/bitmap_codec.js',
  'js/display_designer/scene_compiler.js',
  'js/display_designer/font_editor.js',
  'js/display_designer/font_rasterizer.js',
  'js/display_designer/live_preview.js',
  'js/display_designer/display_targets.js',
  'js/display_designer/mfnt_codec.js',
  'js/en.js',
  'js/custom-dialog.js',
  'js/ext-language_tools.js',
  'js/html2canvas.min.js',
  'js/ext-searchbox.js',
  'js/espide_ai_api.js',
  'js/espide_ai_mcp_bridge.js',
  'js/examples_catalog.js',
  'js/filemanager.js',
  'js/mode-python.js',
  'js/new_menu.js',
  'js/pako.min.js',
  'js/python_compressed.js',
  'js/repl_web_bluetooth_serial.js',
  'js/repl_web_usb_serial.js',
  'js/repl_web_websocket.js',
  'js/snippets/python.js',
  'js/snippets/text.js',
  'js/split.min.js',
  'js/sweetalert2.all.min.js',
  'js/theme-chrome.js',
  'js/theme-espide_dark.js',
  'js/xterm.js',
  'manifest.webmanifest',
  'media/1x1.gif',
  'media/ble_img0.gif',
  'media/ble_img0.png',
  'media/ble_img1.png',
  'media/ble_img2.png',
  'media/ble_img3.png',
  'media/ble_img4.png',
  'media/ble_img5.png',
  'media/dark_ble_img0.gif',
  'media/dark_ble_img0.png',
  'media/dark_ble_img1.png',
  'media/dark_ble_img2.png',
  'media/dark_ble_img3.png',
  'media/dark_ble_img4.png',
  'media/dark_ble_img5.png',
  'media/blockly_switch.png',
  'media/blockly_switch2.png',
  'media/blockly_switch2_en.png',
  'media/dark_blockly_switch.png',
  'media/dark_blockly_switch2.png',
  'media/dark_blockly_switch2_en.png',
  'media/click.mp3',
  'media/click.ogg',
  'media/click.wav',
  'media/code_switch2.png',
  'media/dark_code_switch2.png',
  'media/delete.mp3',
  'media/delete.ogg',
  'media/delete.wav',
  'media/disconnect.mp3',
  'media/disconnect.ogg',
  'media/disconnect.wav',
  'media/display_designer_brush.svg',
  'media/display_designer_eraser.svg',
  'media/display_designer_trash.svg',
  'media/gamepad.png',
  'media/dark_gamepad.png',
  'media/handclosed.cur',
  'media/handdelete.cur',
  'media/handopen.cur',
  'media/icon-192.png',
  'media/icon-512.png',
  'media/icons/clear.png',
  'media/icons/copy.png',
  'media/icons/delete.png',
  'media/icons/download.png',
  'media/icons/exit.png',
  'media/icons/home.png',
  'media/icons/move.png',
  'media/icons/new_folder.png',
  'media/icons/rename.png',
  'media/icons/upload.png',
  'media/new_menu/btn_redo.png',
  'media/new_menu/btn_run.png',
  'media/new_menu/btn_stop.png',
  'media/new_menu/btn_undo.png',
  'media/new_menu/item_about.png',
  'media/new_menu/item_auto_start_blocks.png',
  'media/new_menu/item_autostart.png',
  'media/new_menu/item_ble_settings.png',
  'media/new_menu/item_blocks_display.png',
  'media/new_menu/item_bluetooth.png',
  'media/new_menu/item_bluetooth_connected.png',
  'media/new_menu/item_bluetooth_disconnected.png',
  'media/new_menu/item_bluetooth_error.png',
  'media/new_menu/item_changelog.png',
  'media/new_menu/item_device_info.png',
  'media/new_menu/item_extensions.png',
  'media/new_menu/item_filemanager.png',
  'media/new_menu/item_firmware.png',
  'media/new_menu/item_joystick.png',
  'media/new_menu/item_language.png',
  'media/new_menu/item_load_shared.png',
  'media/new_menu/item_examples.png',
  'media/new_menu/item_menu_type.png',
  'media/new_menu/item_open_esp.png',
  'media/new_menu/item_open_pc.png',
  'media/new_menu/item_processor.png',
  'media/new_menu/item_reset.png',
  'media/new_menu/item_save_esp.png',
  'media/new_menu/item_save_pc.png',
  'media/new_menu/item_screenshot.png',
  'media/new_menu/item_share.png',
  'media/new_menu/item_show_code.png',
  'media/new_menu/item_theme.png',
  'media/new_menu/item_toolbox_icons.png',
  'media/new_menu/item_usb.png',
  'media/new_menu/item_usb_connected.png',
  'media/new_menu/item_usb_disconnected.png',
  'media/new_menu/item_usb_error.png',
  'media/new_menu/item_webrepl_connected.png',
  'media/new_menu/item_webrepl_disconnected.png',
  'media/new_menu/item_version.png',
  'media/new_menu/menu_device.png',
  'media/new_menu/menu_info.png',
  'media/new_menu/menu_project.png',
  'media/new_menu/menu_settings.png',
  'media/quote0.png',
  'media/quote1.png',
  'media/sprites.png',
  'media/topbar_blk.png',
  'media/dark_topbar_blk.png',
  'media/usb_img0.gif',
  'media/usb_img0.png',
  'media/usb_img1.png',
  'media/usb_img2.png',
  'media/usb_img3.png',
  'media/usb_img4.png',
  'media/usb_img5.png',
  'media/dark_usb_img0.gif',
  'media/dark_usb_img0.png',
  'media/dark_usb_img1.png',
  'media/dark_usb_img2.png',
  'media/dark_usb_img3.png',
  'media/dark_usb_img4.png',
  'media/dark_usb_img5.png',
  'toolbox.xml',
  'toolbox_Generic.xml',
  'toolbox_ESP32.xml',
  'toolbox_ESP32C3.xml',
  'toolbox_ESP32S3.xml',
  'toolbox_ESP32S3_robo_board.xml',
  'toolbox_ESP32C6.xml',
  'toolbox_ESP8266.xml',
  'toolbox_RP2040.xml',
  'toolbox_RP2040_picoed.xml',
  'toolbox_RP2350.xml',
  'toolbox_ESPBIT.xml',
];


function canCacheResponse(res) {
  if (!res) return false;
  // cross-origin requesty – OK, status nevidíme
  if (res.type === 'opaque') return true;
  // musí být OK
  if (!res.ok) return false;
  // 206 Partial Content NESMÍ do cache
  if (res.status === 206) return false;
  return true;
}

// Tyto soubory index.html skutecne nacita s ?v=APP_VERSION. Ostatni polozky
// zustavaji pod URL, kterou pouziva jejich runtime pozadavek. Fallback
// ignoreSearch nize pokryva i stary filemanager.html a dynamicke loadery.
const VERSIONED_PRECACHE_PATHS = new Set([
  'css/filemanager.css',
  'css/new_menu.css',
  'css/sweetalert2.min.css',
  'css/xterm.css',
  'js/display_designer/display_designer.css',
  'js/display_designer/font_editor.css',
  'i18n/en.json',
  'i18n/cs.json',
  'i18n/de.json',
  'js/ace.js',
  'js/blockly_compressed.js',
  'js/blockly_project_dependencies.js',
  'js/blocks_compressed.js',
  'js/cs.js',
  'js/de.js',
  'js/display_designer/bitmap_font_importer.js',
  'js/display_designer/bitmap_codec.js',
  'js/display_designer/display_designer.js',
  'js/display_designer/scene_compiler.js',
  'js/display_designer/font_editor.js',
  'js/display_designer/font_rasterizer.js',
  'js/display_designer/live_preview.js',
  'js/display_designer/display_targets.js',
  'js/display_designer/mfnt_codec.js',
  'js/en.js',
  'js/custom-dialog.js',
  'js/ext-language_tools.js',
  'js/espide_ai_api.js',
  'js/espide_ai_mcp_bridge.js',
  'js/examples_catalog.js',
  'js/filemanager.js',
  'js/html2canvas.min.js',
  'js/new_menu.js',
  'js/pako.min.js',
  'js/python_compressed.js',
  'js/repl_web_bluetooth_serial.js',
  'js/repl_web_usb_serial.js',
  'js/repl_web_websocket.js',
  'js/split.min.js',
  'js/sweetalert2.all.min.js',
  'js/xterm.js',
]);

function toPrecacheUrl(path) {
  const url = new URL(path, BASE);
  if (VERSIONED_PRECACHE_PATHS.has(path)) url.searchParams.set('v', APP_VERSION);
  return url.href;
}

// Normalizace na absolutni URL a deduplikace.
const PRECACHE = Array.from(new Set(PRECACHE_PATHS))
  .map(toPrecacheUrl);
const PRECACHE_COMPLETE_URL = new URL(`.precache-complete?v=${encodeURIComponent(APP_VERSION)}`, BASE).href;
let precacheProgressClientsPromise = null;

async function publishPrecacheProgress(percent) {
  try {
    if (!precacheProgressClientsPromise) {
      precacheProgressClientsPromise = self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true
      });
    }
    const clients = await precacheProgressClientsPromise;
    const payload = {
      type: 'PRECACHE_PROGRESS',
      appVersion: APP_VERSION,
      percent
    };
    for (const client of clients) client.postMessage(payload);
  } catch (_) {
    // Progress is informational and must never make installation fail.
  }
}

async function precacheCurrentVersion() {
  const cache = await caches.open(STATIC_CACHE);

  // Opakovany update stejne verze nesmi znovu stahovat hotovou cache.
  if (await cache.match(PRECACHE_COMPLETE_URL)) return;

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, PRECACHE_TIMEOUT_MS);
  const failures = [];
  let nextIndex = 0;
  let fetched = 0;
  let reused = 0;
  let completed = 0;
  let lastPercent = -1;
  let progressQueue = Promise.resolve();

  function reportProgress() {
    const percent = PRECACHE.length
      ? Math.min(100, Math.floor(completed * 100 / PRECACHE.length))
      : 100;
    if (percent === lastPercent) return;
    lastPercent = percent;
    progressQueue = progressQueue
      .then(() => publishPrecacheProgress(percent))
      .catch(() => {});
  }

  reportProgress();

  async function worker() {
    while (nextIndex < PRECACHE.length) {
      const index = nextIndex++;
      const url = PRECACHE[index];
      try {
        // Po neuspesnem predchozim pokusu pouzij uz dokoncene polozky stejne verze.
        if (await cache.match(url)) {
          reused++;
          completed++;
          reportProgress();
          continue;
        }
        const resp = await fetch(url, { cache: 'no-cache', signal: controller.signal });
        if (!canCacheResponse(resp)) {
          throw new Error(`HTTP ${resp && resp.status}`);
        }
        await cache.put(url, resp.clone());
        fetched++;
        completed++;
        reportProgress();
      } catch (err) {
        failures.push([url, String(err)]);
      }
    }
  }

  try {
    const workerCount = Math.min(PRECACHE_CONCURRENCY, PRECACHE.length);
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    await progressQueue;
    if (failures.length) {
      console.error('PRECACHE_FAILED', { timedOut, failures });
      throw new Error(timedOut
        ? `Precache timeout after ${PRECACHE_TIMEOUT_MS} ms`
        : `Precache failed for ${failures.length} asset(s)`);
    }
    await cache.put(PRECACHE_COMPLETE_URL, new Response(JSON.stringify({
      version: APP_VERSION,
      assets: PRECACHE.length,
      fetched,
      reused
    }), { headers: { 'Content-Type': 'application/json' } }));
  } finally {
    clearTimeout(timer);
  }
}

// ------- INSTALL: paralelni, uplny a casove omezeny precache -------
self.addEventListener('install', (e) => {
  // Zadne automaticke skipWaiting: aktivaci povoli stranka az pod loadingem.
  e.waitUntil(precacheCurrentVersion());
});

// ------- ACTIVATE: úklid starých verzí + claim + navigationPreload -------
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map(k => (k !== STATIC_CACHE && k.startsWith('espide-static-')) && caches.delete(k))
    );
    try { await self.registration.navigationPreload.enable(); } catch (_) {}
    await self.clients.claim();
  })());
});

function inScope(u) {
  const scopePath = new URL('.', BASE).pathname;
  return u.origin === location.origin && u.pathname.startsWith(scopePath);
}

function isXML(u) {
  return /\.(xml|blk)(\?.*)?$/i.test(u.pathname);
}

function isExampleProject(u) {
  const examplesPath = new URL('examples/', BASE).pathname;
  return u.pathname.startsWith(examplesPath) && /\.blk$/i.test(u.pathname);
}


self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (!inScope(url)) return;

  e.respondWith((async () => {
    const cache = await caches.open(STATIC_CACHE);

    // 1) Navigace → network-first s fallbackem na index.html
    if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
      try {
        const preload = await e.preloadResponse;
        const res = preload || await fetch(req);
        if (canCacheResponse(res)) {
          cache.put(new URL('index.html', BASE).href, res.clone());
        }
        return res;
      } catch {
        return (await cache.match(new URL('index.html', BASE).href)) || Response.error();
      }
    }

    // 2) Examples → freshest server copy, cached copy only when offline.
    if (isExampleProject(url)) {
      try {
        const res = await fetch(req, { cache: 'no-cache' });
        if (canCacheResponse(res)) await cache.put(req, res.clone());
        return res;
      } catch {
        return (await cache.match(req, { ignoreSearch: true }))
          || new Response('', { status: 404, statusText: 'Offline example not in cache' });
      }
    }

    // 3) Other XML/BLK → cache-first, without fallback to index.html.
    if (isXML(url)) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
      const res = await fetch(req);
      if (canCacheResponse(res)) {
          await cache.put(req, res.clone());
      }
      return res;
      } catch {
        // vrať 404, ať to klient správně zachytí
        return new Response('', { status: 404, statusText: 'Offline XML not in cache' });
      }
    }


    // 4) Ostatni statika -> nemenny cache-first v ramci aktualni APP_VERSION.
    // Po zmene souboru se musi zvysit APP_VERSION; pak vznikne nova cache.
    const isStatic = /\.(?:js|css|png|jpg|jpeg|gif|svg|webp|ico|json|wasm|mp3|ogg|wav|cur)(\?.*)?$/i.test(url.pathname);
    if (isStatic) {
      const hit = (await cache.match(req)) || (await cache.match(req, { ignoreSearch: true }));
      if (hit) return hit;

      try {
        const res = await fetch(req);
        if (canCacheResponse(res)) {
          try {
            await cache.put(req, res.clone());
          } catch (e) {
            // sem max. log do console v SW, ale hlavně nepropagovat výjimku
            // console.warn('cache put failed', e);
          }
        }
        return res;           // i 206 vrátíme klientovi, jen ho necacheujeme
      } catch {
        // pro statiku (včetně audio) už NEVRACEJ index.html
        return (await cache.match(req, { ignoreSearch: true })) || Response.error();
      }
    }




    // 5) Default → network-first, fallback cache
    try {
      const res = await fetch(req);
      if (canCacheResponse(res)) {
        try {
          await cache.put(req, res.clone());
        } catch (e) {
          // ignoruj chybu cache.put
        }
      }
      return res;
    } catch {
      return (await cache.match(req, { ignoreSearch: true }))
          || (await cache.match(new URL('index.html', BASE).href));
    }

  })());
});

// SW client messaging: activation + version query.
self.addEventListener('message', (e) => {
  const data = e && e.data;
  if (data === 'skipWaiting') {
    self.skipWaiting();
    return;
  }
  if (data && data.type === 'GET_VERSION') {
    const payload = { type: 'SW_VERSION', version: STATIC_CACHE, appVersion: APP_VERSION };
    try {
      if (e.ports && e.ports[0]) e.ports[0].postMessage(payload);
      else if (e.source && typeof e.source.postMessage === 'function') e.source.postMessage(payload);
    } catch (_) {}
  }
});
