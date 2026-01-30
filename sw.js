// /esp_ide_v2/sw.js — robustní PWA cache
// scope: /esp_ide_v2/
const VERSION = 'espide-static-2026-01-29-i18n-only';

const STATIC_CACHE = VERSION;
const BASE = new URL('./', self.registration.scope).href;

// Přehledně udržovaný seznam. Duplicity se odfiltrují.
// Nepřidávej "./" kořen; stačí index.html.
// Pokud něco chybí na serveru, instalace kvůli tomu nespadne.
const PRECACHE_PATHS = [
  'css/filemanager.css',
  'css/sweetalert2.min.css',
  'css/xterm.css',
  'favicon.ico',
  'filemanager.html',
  'img_editor.html',
  'img_editor_cs.html',
  'img_editor_en.html',
  'index.html',
  'i18n/en.json',
  'i18n/cs.json',
  'js/ace.js',
  'js/blockly_compressed.js',
  'js/blocks_compressed.js',
  'js/cs.js',
  'js/custom-dialog.js',
  'js/ext-language_tools.js',
  'js/ext-searchbox.js',
  'js/filemanager.js',
  'js/mode-python.js',
  'js/python_compressed.js',
  'js/repl_web_bluetooth_serial.js',
  'js/repl_web_usb_serial.js',
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
  'media/dark_blockly_switch.png',
  'media/dark_blockly_switch2.png',
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
  'media/gamepad.png',
  'media/dark_gamepad.png',
  'media/handclosed.cur',
  'media/handdelete.cur',
  'media/handopen.cur',
  'media/icon-192.png',
  'media/icon-512.png',
  'media/dark_icon-192.png',
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
  'toolbox_ESP32.xml',
  'toolbox_ESP32C3.xml',
  'toolbox_ESP32S3.xml',
  'toolbox_ESP8266.xml',
  'toolbox_RP2040.xml',
  'toolbox_RP2040_picoed.xml',

  // SW samotný pro případ offline otevření z cache (volitelné)
  'sw.js',
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

// Normalizace na absolutní URL a deduplikace
const PRECACHE = Array.from(new Set(PRECACHE_PATHS))
  .map(p => new URL(p, BASE).href);

// ------- INSTALL: robustní precache, nikdy nespadne kvůli jedné chybě -------
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    const skipped = [];
    for (const url of PRECACHE) {
      try {
        const resp = await fetch(url, { cache: 'no-cache' });
        if (!resp || (!resp.ok && resp.type !== 'opaque')) {
          skipped.push([url, resp && resp.status]);
          continue;
        }
        await cache.put(url, resp.clone());
      } catch (err) {
        skipped.push([url, String(err)]);
      }
    }
    if (skipped.length) console.warn('PRECACHE_SKIPPED', skipped);
  })());
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

    // 2) XML/BLK → cache-first, bez fallbacku na index.html
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


    // 3) Ostatní statika → SWR
    const isStatic = /\.(?:js|css|png|jpg|jpeg|gif|svg|webp|ico|json|wasm|mp3|ogg|wav|cur)(\?.*)?$/i.test(url.pathname);
    if (isStatic) {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) {
        // stale-while-revalidate na pozadí, ale IGNORUJ chyby cache.put (vč. 206)
        fetch(req)
          .then(r => { if (canCacheResponse(r)) return cache.put(req, r.clone()); })
          .catch(() => {});
        return hit;
      }

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




    // 4) Default → network-first, fallback cache
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

// Volitelně: rychlý update z klienta
self.addEventListener('message', (e) => { if (e.data === 'skipWaiting') self.skipWaiting(); });
