import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  applyFilesystemOverlay,
  captureFilesystem,
  diffFilesystem,
  emptyOverlay,
  normaliseOverlay,
  overlaysEqual,
  pruneEmscriptenFilesystem,
} from '../runtime/fs-overlay.js';
import { IndexedDbOverlayStore } from '../core/fs-store.js';

const DIRECTORY_MODE = 0x4000;
const FILE_MODE = 0x8000;

function pathParts(value) {
  return String(value).replaceAll('\\', '/').split('/').filter(Boolean);
}

function pathOf(value) {
  const parts = pathParts(value);
  return parts.length ? `/${parts.join('/')}` : '/';
}

class FakeFs {
  constructor() {
    this.entries = new Map([['/', { type: 'directory' }]]);
  }

  mkdirTree(value) {
    let current = '';
    for (const part of pathParts(value)) {
      current += `/${part}`;
      if (!this.entries.has(current)) this.entries.set(current, { type: 'directory' });
      if (this.entries.get(current).type !== 'directory') throw new Error(`${current} není adresář.`);
    }
  }

  writeFile(value, data) {
    const path = pathOf(value);
    const parent = path.slice(0, path.lastIndexOf('/')) || '/';
    this.mkdirTree(parent);
    const bytes = data instanceof Uint8Array ? data.slice() : new Uint8Array(data);
    this.entries.set(path, { type: 'file', data: bytes });
  }

  readFile(value) {
    const entry = this.entries.get(pathOf(value));
    if (!entry || entry.type !== 'file') throw new Error(`${value} není soubor.`);
    return entry.data.slice();
  }

  readdir(value) {
    const path = pathOf(value);
    const entry = this.entries.get(path);
    if (!entry || entry.type !== 'directory') throw new Error(`${value} není adresář.`);
    const prefix = path === '/' ? '/' : `${path}/`;
    const names = new Set();
    for (const candidate of this.entries.keys()) {
      if (candidate === path || !candidate.startsWith(prefix)) continue;
      names.add(candidate.slice(prefix.length).split('/')[0]);
    }
    return ['.', '..', ...names];
  }

  stat(value) {
    const entry = this.entries.get(pathOf(value));
    if (!entry) throw new Error(`${value} neexistuje.`);
    return { mode: entry.type === 'directory' ? DIRECTORY_MODE : FILE_MODE };
  }

  isDir(mode) {
    return mode === DIRECTORY_MODE;
  }

  isFile(mode) {
    return mode === FILE_MODE;
  }

  unlink(value) {
    const path = pathOf(value);
    if (this.entries.get(path)?.type !== 'file') throw new Error(`${value} není soubor.`);
    this.entries.delete(path);
  }

  rmdir(value) {
    const path = pathOf(value);
    if (this.entries.get(path)?.type !== 'directory') throw new Error(`${value} není adresář.`);
    const prefix = `${path}/`;
    if ([...this.entries.keys()].some((candidate) => candidate.startsWith(prefix))) {
      throw new Error(`${value} není prázdný.`);
    }
    this.entries.delete(path);
  }
}

function createDistribution() {
  const fs = new FakeFs();
  fs.writeFile('/boot.py', new TextEncoder().encode("print('factory boot')\n"));
  fs.writeFile('/main.py', new TextEncoder().encode("print('factory main')\n"));
  fs.writeFile('/lib/base.mpy', new Uint8Array([77, 80, 89, 0]));
  fs.writeFile('/tmp/not-persistent.raw', new Uint8Array([9, 9, 9]));
  fs.writeFile('/lib/machine.py', new Uint8Array([1, 2, 3]));
  return fs;
}

const emscriptenLayout = new FakeFs();
for (const path of ['/home/web_user', '/tmp', '/proc/self/fd', '/dev']) emscriptenLayout.mkdirTree(path);
pruneEmscriptenFilesystem(emscriptenLayout);
assert.deepEqual(emscriptenLayout.readdir('/').sort(), ['.', '..', 'dev']);

const distribution = createDistribution();
const base = captureFilesystem(distribution);
assert.ok(!base.files.some((file) => file.path.startsWith('/tmp/')));
assert.ok(!base.files.some((file) => file.path === '/lib/machine.py'));

const changed = createDistribution();
changed.writeFile('/boot.py', new TextEncoder().encode("print('user boot')\n"));
changed.unlink('/main.py');
changed.mkdirTree('/empty-directory');
changed.writeFile('/empty.dat', new Uint8Array());
changed.writeFile('/user/image.raw', new Uint8Array([0, 255, 1, 128]));
changed.writeFile('/user/module.mpy', new Uint8Array([77, 80, 89, 255]));
changed.writeFile('/user/font.mfnt', new Uint8Array([0, 16, 32, 48]));
changed.writeFile('/user/settings.dat', new Uint8Array([222, 173, 190, 239]));

const overlay = diffFilesystem(base, captureFilesystem(changed));
assert.ok(overlay.deleted.includes('/main.py'));
assert.ok(overlay.directories.includes('/empty-directory'));
assert.ok(overlay.files.some((file) => file.path === '/empty.dat' && file.data.byteLength === 0));

const restarted = createDistribution();
applyFilesystemOverlay(restarted, structuredClone(overlay));
assert.equal(new TextDecoder().decode(restarted.readFile('/boot.py')), "print('user boot')\n");
assert.throws(() => restarted.readFile('/main.py'));
for (const extension of ['raw', 'mpy', 'mfnt', 'dat']) {
  const source = overlay.files.find((file) => file.path.endsWith(`.${extension}`));
  assert.ok(source, `Chybí testovací .${extension} soubor.`);
  assert.deepEqual(restarted.readFile(source.path), source.data);
}
assert.ok(overlaysEqual(overlay, normaliseOverlay(structuredClone(overlay))));
assert.ok(overlaysEqual(emptyOverlay(), diffFilesystem(base, captureFilesystem(createDistribution()))));

const factoryReset = createDistribution();
applyFilesystemOverlay(factoryReset, emptyOverlay());
assert.deepEqual(captureFilesystem(factoryReset), base);
assert.throws(() => normaliseOverlay({ ...emptyOverlay(), files: [{ path: '/../escape', data: new Uint8Array() }] }), /Neplatná cesta/);
assert.throws(() => applyFilesystemOverlay(createDistribution(), {
  ...emptyOverlay(),
  files: [{ path: '/lib/machine.py', data: new Uint8Array([8]) }],
}), /runtime cestu/);

const worker = await readFile(new URL('../worker.js', import.meta.url), 'utf8');
const captureIndex = worker.indexOf('baseFilesystemSnapshot = captureFilesystem');
const applyIndex = worker.indexOf('lastPublishedOverlay = applyFilesystemOverlay');
const startupIndex = worker.indexOf("for (const startupFile of ['/boot.py', '/main.py'])");
assert.ok(captureIndex >= 0 && captureIndex < applyIndex);
assert.ok(applyIndex >= 0 && applyIndex < startupIndex);
assert.match(worker, /publishFilesystemOverlay\(true\)/);
assert.match(worker, /filesystemPersistence/);

const unavailableStore = new IndexedDbOverlayStore({ indexedDB: null });
assert.equal(unavailableStore.available, false);
assert.ok(overlaysEqual(await unavailableStore.load(), emptyOverlay()));
await unavailableStore.save(overlay);
await unavailableStore.clear();
await unavailableStore.close();

console.log('simulator_lite fs-overlay.test.mjs: OK');
