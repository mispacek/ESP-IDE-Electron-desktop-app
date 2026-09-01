import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { listPackage } = require('@electron/asar');
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const requestedAsar = process.argv[2] ? path.resolve(process.argv[2]) : null;
const candidates = [
  requestedAsar,
  path.join(projectRoot, 'dist', 'win-unpacked', 'resources', 'app.asar'),
].filter(Boolean);
const asarPath = candidates.find((candidate) => fs.existsSync(candidate));

if (!asarPath) {
  process.stderr.write('Usage: npm run verify:package -- <path-to-app.asar>\n');
  process.exit(1);
}

const normalize = (value) => String(value).replaceAll('\\', '/').replace(/^\/+/, '');
const entries = new Set(listPackage(asarPath).map(normalize));
const requiredAsar = [
  'electron/main/main.js',
  'electron/main/local-server.js',
  'electron/main/protocol-handler.js',
  'electron/main/http-proxy.js',
  'electron/main/runtime-paths.js',
  'electron/preload/bluetooth-picker-preload.js',
  'electron/preload/legacy-storage-preload.js',
  'electron/preload/main-preload.js',
  'electron/preload/usb-picker-preload.js',
  'electron/ui/splash/index.html',
  'electron/ui/splash/icon.png',
  'electron/ui/pickers/usb.html',
  'electron/ui/pickers/bluetooth.html',
  'electron/ui/pickers/picker-i18n.js',
  'index.html',
];
const errors = requiredAsar
  .filter((entry) => !entries.has(entry))
  .map((entry) => `Missing ASAR entry: ${entry}`);

for (const forbidden of ['electron/migration/', 'esp_ide_v2/', 'simulator_lite/', 'tests/', '.agents/', '.codex/']) {
  if ([...entries].some((entry) => entry.startsWith(forbidden))) {
    errors.push(`Forbidden ASAR content: ${forbidden}`);
  }
}

const resourcesRoot = path.dirname(asarPath);
for (const relativePath of [
  'esp_ide_v2/index.html',
  'esp_ide_v2/js/espide_ai_api.js',
  'simulator_lite/index.html',
  'simulator_lite/worker.js',
  'simulator_lite/vendor/micropython.mjs',
  'simulator_lite/vendor/micropython.wasm',
]) {
  if (!fs.existsSync(path.join(resourcesRoot, ...relativePath.split('/')))) {
    errors.push(`Missing packaged runtime file: ${relativePath}`);
  }
}

function findFiles(root) {
  const found = [];
  if (!fs.existsSync(root)) return found;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) found.push(...findFiles(target));
    else if (entry.isFile()) found.push(target);
  }
  return found;
}

for (const runtimeRoot of ['esp_ide_v2', 'simulator_lite']) {
  const developmentFiles = findFiles(path.join(resourcesRoot, runtimeRoot))
    .filter((filename) => /(?:^|[\\/])(?:tests?|node_modules)(?:[\\/]|$)|\.test\.[cm]?js$/i.test(filename));
  for (const filename of developmentFiles) {
    errors.push(`Development-only packaged runtime file: ${path.relative(resourcesRoot, filename)}`);
  }
}

if (errors.length) {
  for (const error of errors) process.stderr.write(`[package] ${error}\n`);
  process.exit(1);
}
process.stdout.write(`[package] Wrapper ASAR and runtime resources verified: ${asarPath}\n`);
