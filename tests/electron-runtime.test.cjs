'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const {
  createEspideProtocolHandler,
  getMimeType,
  mapEspideUrl,
  staticHeaders,
} = require('../electron/main/protocol-handler');
const {
  MAX_RESPONSE_BYTES,
  createHttpProxyHandler,
  fetchPinned,
  isPublicIPv4,
  resolvePublicIPv4,
  validateTarget,
} = require('../electron/main/http-proxy');
const {
  LOOPBACK_HOST,
  TOKEN_HEADER,
  shouldInjectToken,
  startLocalServer,
} = require('../electron/main/local-server');
const {
  importLegacyStorageIfEmpty,
  seedDefaultLanguage,
} = require('../electron/preload/main-preload');
const {
  MESSAGES: PICKER_MESSAGES,
  getMessages: getPickerMessages,
  normalizeLanguage: normalizePickerLanguage,
} = require('../electron/ui/pickers/picker-i18n');
const { createRuntimePaths } = require('../electron/main/runtime-paths');

class MemoryStorage {
  constructor(initial = {}) {
    this.values = new Map(Object.entries(initial));
  }
  get length() { return this.values.size; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  key(index) { return Array.from(this.values.keys())[index] || null; }
}

const roots = {
  ideRoot: 'C:/package',
  simulatorRoot: 'C:/package/simulator_lite',
};
const pathForTest = (...segments) => path.resolve(...segments);

test('runtime paths separate the wrapper from the two manually copied runtimes', () => {
  const mainDirectory = pathForTest('project', 'electron', 'main');
  const development = createRuntimePaths({
    app: { isPackaged: false },
    mainDirectory,
    resourcesPath: pathForTest('unused'),
  });
  assert.equal(development.projectRoot, pathForTest('project'));
  assert.equal(development.ideRoot, pathForTest('project', 'esp_ide_v2'));
  assert.equal(development.simulatorRoot, pathForTest('project', 'simulator_lite'));
  assert.equal(development.mainPreload, pathForTest('project', 'electron', 'preload', 'main-preload.js'));

  const packaged = createRuntimePaths({
    app: { isPackaged: true, getAppPath: () => pathForTest('resources', 'app.asar') },
    mainDirectory,
    resourcesPath: pathForTest('resources'),
  });
  assert.equal(packaged.ideRoot, pathForTest('resources', 'esp_ide_v2'));
  assert.equal(packaged.simulatorRoot, pathForTest('resources', 'simulator_lite'));
  assert.equal(packaged.legacyIndex, pathForTest('resources', 'app.asar', 'index.html'));
});

test('maps only the virtual app roots and rejects encoded traversal', () => {
  const ide = mapEspideUrl('espide://app/esp_ide_v2/index.html', roots);
  assert.equal(ide.kind, 'ide');
  assert.match(ide.filePath, /index\.html$/);
  assert.equal(mapEspideUrl('espide://other/esp_ide_v2/index.html', roots).error, 403);
  assert.equal(mapEspideUrl('espide://app/esp_ide_v2/%2e%2e/secret.txt', roots).error, 403);
  assert.equal(mapEspideUrl('espide://app/esp_ide_v2/%5csecret.txt', roots).error, 403);
  assert.equal(mapEspideUrl('espide://app/other/index.html', roots).error, 404);
});

test('uses fixed MIME and isolation headers for IDE and simulator documents', () => {
  assert.equal(getMimeType('runtime/micropython.wasm'), 'application/wasm');
  assert.equal(getMimeType('worker.mjs'), 'text/javascript; charset=utf-8');
  assert.equal(getMimeType('unknown.bin'), 'application/octet-stream');
  const ide = staticHeaders('ide', 'index.html');
  const simulator = staticHeaders('simulator', 'index.html');
  assert.equal(ide['cross-origin-opener-policy'], 'same-origin');
  assert.equal(ide['cross-origin-embedder-policy'], 'credentialless');
  assert.equal(simulator['cross-origin-embedder-policy'], 'require-corp');
  assert.equal(simulator['cross-origin-resource-policy'], 'same-origin');
  assert.equal(simulator['x-content-type-options'], 'nosniff');
  assert.equal(staticHeaders('simulator', 'worker.js')['cross-origin-embedder-policy'], 'require-corp');
});

test('static protocol handler serves regular files and accepts HEAD without a body', async () => {
  const handler = createEspideProtocolHandler({
    ideRoot: process.cwd(),
    simulatorRoot: `${process.cwd()}/simulator_lite`,
    proxyHandler: async () => new Response('proxy'),
    fsApi: {
      realpath: async (value) => value,
      stat: async () => ({ isFile: () => true }),
      readFile: async () => Buffer.from('<!doctype html>'),
    },
  });
  const get = await handler(new Request('espide://app/esp_ide_v2/index.html'));
  assert.equal(get.status, 200);
  assert.equal(get.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(get.headers.get('cross-origin-embedder-policy'), 'credentialless');
  const head = await handler(new Request('espide://app/esp_ide_v2/index.html', { method: 'HEAD' }));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const disallowed = await handler(new Request('espide://app/esp_ide_v2/index.html', { method: 'POST' }));
  assert.equal(disallowed.status, 405);
  assert.equal(disallowed.headers.get('allow'), 'GET, HEAD');
});

test('static protocol handler returns 404 for a missing real file', async () => {
  const missing = Object.assign(new Error('missing'), { code: 'ENOENT' });
  const handler = createEspideProtocolHandler({
    ideRoot: process.cwd(),
    simulatorRoot: `${process.cwd()}/simulator_lite`,
    proxyHandler: async () => new Response('proxy'),
    fsApi: {
      realpath: async (value) => {
        if (value.endsWith('missing.html')) throw missing;
        return value;
      },
      stat: async () => ({ isFile: () => true }),
      readFile: async () => Buffer.from('unreachable'),
    },
  });
  const result = await handler(new Request('espide://app/esp_ide_v2/missing.html'));
  assert.equal(result.status, 404);
});

test('legacy storage imports only into an empty custom origin and seeds English', () => {
  const destination = new MemoryStorage();
  const imported = importLegacyStorageIfEmpty(destination, {
    userSettings: JSON.stringify({ processor: 'ESP32', language: 'cs' }),
    extensions: '{"demo":true}',
  });
  assert.deepEqual(imported, { success: true, imported: true, existing: false });
  assert.equal(seedDefaultLanguage(destination).changed, false);
  assert.equal(JSON.parse(destination.getItem('userSettings')).language, 'cs');

  const existing = new MemoryStorage({ userSettings: JSON.stringify({ language: 'de' }) });
  const skipped = importLegacyStorageIfEmpty(existing, { userSettings: JSON.stringify({ language: 'cs' }) });
  assert.deepEqual(skipped, { success: true, imported: false, existing: true });
  assert.equal(JSON.parse(existing.getItem('userSettings')).language, 'de');

  const missingLanguage = new MemoryStorage({ userSettings: JSON.stringify({ processor: 'ESP32' }) });
  assert.deepEqual(seedDefaultLanguage(missingLanguage), { changed: true, language: 'en' });
  assert.deepEqual(JSON.parse(missingLanguage.getItem('userSettings')), { processor: 'ESP32', language: 'en' });

  const futureLocale = new MemoryStorage({ userSettings: JSON.stringify({ language: 'fr' }) });
  assert.deepEqual(seedDefaultLanguage(futureLocale), { changed: false, language: 'fr' });
  assert.equal(JSON.parse(futureLocale.getItem('userSettings')).language, 'fr');
});

test('picker translations follow supported IDE languages and fall back to English', () => {
  const expectedKeys = Object.keys(PICKER_MESSAGES.en).sort();
  for (const [language, messages] of Object.entries(PICKER_MESSAGES)) {
    assert.deepEqual(Object.keys(messages).sort(), expectedKeys, `${language} picker keys`);
    assert.equal(Object.values(messages).every((value) => typeof value === 'string' && value.length > 0), true);
  }
  assert.equal(normalizePickerLanguage('cs-CZ'), 'cs');
  assert.equal(normalizePickerLanguage('EN_us'), 'en');
  assert.equal(normalizePickerLanguage('de'), 'de');
  assert.equal(normalizePickerLanguage('fr'), 'en');
  assert.equal(getPickerMessages('cs').messages.close, 'Zavřít');
  assert.equal(getPickerMessages('de-DE').messages.bluetoothTitle, 'Bluetooth-Gerät auswählen');
  assert.equal(getPickerMessages('unknown').messages.usbTitle, 'Select USB device');
});

test('proxy validation accepts only public IPv4 destinations and pins the DNS result', async () => {
  assert.equal(isPublicIPv4('8.8.8.8'), true);
  assert.equal(isPublicIPv4('127.0.0.1'), false);
  assert.equal(isPublicIPv4('192.168.1.10'), false);
  assert.equal(isPublicIPv4('2001:4860:4860::8888'), false);
  assert.throws(() => validateTarget('https://user@example.com/'), { status: 400 });
  assert.throws(() => validateTarget('ftp://example.com/'), { status: 400 });
  assert.throws(() => validateTarget('https://example.com:8443/'), { status: 400 });
  assert.equal(await resolvePublicIPv4('example.test', async () => [{ address: '8.8.8.8', family: 4 }]), '8.8.8.8');
  await assert.rejects(
    resolvePublicIPv4('example.test', async () => [{ address: '10.0.0.1', family: 4 }]),
    { status: 403 },
  );
});

function fakeRequestFactory(statusCode, chunks, received) {
  return (options, onResponse) => {
    received.push(options);
    const request = new EventEmitter();
    request.setTimeout = () => {};
    request.destroy = () => { request.destroyed = true; };
    request.end = () => process.nextTick(() => {
      const upstream = new EventEmitter();
      upstream.statusCode = statusCode;
      upstream.headers = { 'content-type': 'text/plain' };
      onResponse(upstream);
      for (const chunk of chunks) upstream.emit('data', chunk);
      upstream.emit('end');
    });
    return request;
  };
}

function requestLocalServer({ port, method = 'GET', headers = {}, path = '/esp_ide_v2/index.html' }) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: LOOPBACK_HOST, port, method, path, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.once('end', () => resolve({ body: Buffer.concat(chunks), headers: response.headers, status: response.statusCode }));
    });
    request.once('error', reject);
    request.end();
  });
}

test('loopback server requires the exact host and process token for GET and HEAD', async (t) => {
  const token = '0123456789abcdef0123456789abcdef';
  const local = await startLocalServer({
    port: 0,
    token,
    protocolHandler: async (request) => new Response(request.method === 'HEAD' ? null : 'IDE', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    }),
  });
  t.after(() => local.close());
  const validHeaders = { [TOKEN_HEADER]: token, 'sec-fetch-site': 'same-origin' };
  const get = await requestLocalServer({ port: local.port, headers: validHeaders });
  assert.equal(get.status, 200);
  assert.equal(get.body.toString(), 'IDE');
  assert.equal(get.headers['cache-control'], 'no-store');
  const head = await requestLocalServer({ port: local.port, method: 'HEAD', headers: validHeaders });
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  const missingToken = await requestLocalServer({ port: local.port });
  assert.equal(missingToken.status, 403);
  const wrongHost = await requestLocalServer({
    port: local.port,
    headers: { ...validHeaders, host: `localhost:${local.port}` },
  });
  assert.equal(wrongHost.status, 403);
  const disallowed = await requestLocalServer({ port: local.port, method: 'POST', headers: validHeaders });
  assert.equal(disallowed.status, 405);
  assert.equal(disallowed.headers.allow, 'GET, HEAD');

  const topLevel = await requestLocalServer({
    port: local.port,
    headers: { [TOKEN_HEADER]: token, 'sec-fetch-site': 'none' },
  });
  assert.equal(topLevel.status, 200);
  const crossSite = await requestLocalServer({
    port: local.port,
    headers: { [TOKEN_HEADER]: token, 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(crossSite.status, 403);
  const untrustedNavigation = await requestLocalServer({
    port: local.port,
    path: '/simulator_lite/index.html',
    headers: { [TOKEN_HEADER]: token, 'sec-fetch-site': 'none' },
  });
  assert.equal(untrustedNavigation.status, 403);
});

test('renderer token injection accepts only app navigation and app-origin initiators', () => {
  const origin = 'http://127.0.0.1:48765';
  const appUrl = `${origin}/esp_ide_v2/index.html`;
  assert.equal(shouldInjectToken({ resourceType: 'mainFrame', url: appUrl }, origin, appUrl), true);
  assert.equal(shouldInjectToken({ referrer: appUrl, resourceType: 'script', url: `${origin}/esp_ide_v2/app.js` }, origin, appUrl), true);
  assert.equal(shouldInjectToken({ initiator: origin, resourceType: 'worker', url: `${origin}/simulator_lite/worker.js` }, origin, appUrl), true);
  assert.equal(shouldInjectToken({ initiator: 'https://example.com', resourceType: 'xhr', url: `${origin}/simulator_lite/http-proxy.php` }, origin, appUrl), false);
  assert.equal(shouldInjectToken({ referrer: 'https://example.com/page', resourceType: 'xhr', url: `${origin}/simulator_lite/http-proxy.php` }, origin, appUrl), false);
  assert.equal(shouldInjectToken({ initiator: 'https://example.com', referrer: appUrl, resourceType: 'xhr', url: `${origin}/simulator_lite/http-proxy.php` }, origin, appUrl), false);
  assert.equal(shouldInjectToken({ resourceType: 'xhr', url: `${origin}/simulator_lite/http-proxy.php` }, origin, appUrl), false);
  assert.equal(shouldInjectToken({ resourceType: 'mainFrame', url: `${origin}/simulator_lite/index.html` }, origin, appUrl), false);
});

test('loopback server fails closed when its stable port is already occupied', async (t) => {
  const first = await startLocalServer({
    port: 0,
    token: '0123456789abcdef0123456789abcdef',
    protocolHandler: async () => new Response('first'),
  });
  t.after(() => first.close());
  await assert.rejects(
    startLocalServer({
      port: first.port,
      token: 'fedcba9876543210fedcba9876543210',
      protocolHandler: async () => new Response('second'),
    }),
    { code: 'EADDRINUSE' },
  );
});

test('pinned proxy keeps redirects local and enforces the response cap', async () => {
  const target = validateTarget('https://example.test/path?q=1');
  const received = [];
  const redirected = await fetchPinned(target, '8.8.8.8', {
    requestFactory: fakeRequestFactory(302, [Buffer.from('redirect')], received),
  });
  assert.equal(redirected.status, 302);
  assert.equal(redirected.body.toString(), 'redirect');
  assert.equal(received[0].hostname, '8.8.8.8');
  assert.equal(received[0].servername, 'example.test');
  assert.equal(received[0].headers.host, 'example.test');
  assert.equal(received[0].headers['accept-encoding'], 'identity');

  await assert.rejects(
    fetchPinned(target, '8.8.8.8', {
      requestFactory: fakeRequestFactory(200, [Buffer.alloc(MAX_RESPONSE_BYTES + 1)], []),
    }),
    { status: 413 },
  );
});

test('proxy preserves bodyless upstream statuses and rejects non-GET methods', async () => {
  for (const status of [204, 304]) {
    const handler = createHttpProxyHandler({
      lookup: async () => [{ address: '8.8.8.8', family: 4 }],
      requestFactory: fakeRequestFactory(status, [Buffer.from('ignored')], []),
    });
    const response = await handler(new Request('espide://app/simulator_lite/http-proxy.php?url=https%3A%2F%2Fexample.test%2F'));
    assert.equal(response.status, status);
    assert.equal(await response.text(), '');
  }
  const handler = createHttpProxyHandler();
  const disallowed = await handler(new Request('espide://app/simulator_lite/http-proxy.php', { method: 'POST' }));
  assert.equal(disallowed.status, 405);
  assert.equal(disallowed.headers.get('allow'), 'GET');
});
