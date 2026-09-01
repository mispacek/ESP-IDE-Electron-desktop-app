import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '..');
const manifestPath = path.join(projectRoot, 'runtime-source.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

const wrapperFiles = [
  'electron/main/main.js',
  'electron/main/local-server.js',
  'electron/main/protocol-handler.js',
  'electron/main/http-proxy.js',
  'electron/main/external-content.js',
  'electron/main/runtime-paths.js',
  'electron/migration/index.html',
  'electron/preload/main-preload.js',
  'electron/preload/legacy-storage-preload.js',
  'electron/preload/usb-picker-preload.js',
  'electron/preload/bluetooth-picker-preload.js',
  'electron/ui/splash/index.html',
  'electron/ui/splash/icon.png',
  'electron/ui/pickers/usb.html',
  'electron/ui/pickers/bluetooth.html',
  'electron/ui/pickers/picker-i18n.js',
  'packaging/windows/icon.ico',
  'packaging/macos/icon.png',
  'packaging/macos/entitlements.plist',
  'packaging/linux/icon.png',
  'packaging/linux/postinstall.sh',
  'packaging/linux/99-espide-serial.rules',
];

const required = {
  [manifest.espIde.path]: [
    'index.html',
    'sw.js',
    'manifest.webmanifest',
    'i18n/cs.json',
    'i18n/en.json',
    'i18n/de.json',
    'js/espide_ai_api.js',
    'js/repl_web_usb_serial.js',
    'js/repl_web_bluetooth_serial.js',
    'toolbox.xml',
  ],
  [manifest.simulatorLite.path]: [
    'index.html',
    'app.js',
    'embed.js',
    'ide-bridge.js',
    'worker.js',
    'filesystem/files.lst',
    'runtime/machine.py',
    'vendor/micropython.mjs',
    'vendor/micropython.wasm',
    'toolbox_Simulator.xml',
  ],
};

const errors = [];
for (const relativePath of wrapperFiles) {
  const target = path.join(projectRoot, ...relativePath.split('/'));
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    errors.push(`Required desktop file is missing: ${relativePath}`);
  }
}

for (const [rootName, files] of Object.entries(required)) {
  const root = path.resolve(projectRoot, rootName);
  if (path.dirname(root) !== projectRoot) {
    errors.push(`Runtime path must be a direct child of the project: ${rootName}`);
    continue;
  }
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    errors.push(`Runtime directory is missing: ${rootName}`);
    continue;
  }
  if (fs.existsSync(path.join(root, 'node_modules'))) {
    errors.push(`Runtime directory contains node_modules: ${rootName}`);
  }
  for (const relativePath of files) {
    const target = path.join(root, ...relativePath.split('/'));
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      errors.push(`Required runtime file is missing: ${rootName}/${relativePath}`);
    }
  }
}

const rulesPath = path.join(projectRoot, 'packaging', 'linux', '99-espide-serial.rules');
const postinstallPath = path.join(projectRoot, 'packaging', 'linux', 'postinstall.sh');
if (fs.existsSync(rulesPath) && fs.existsSync(postinstallPath)) {
  const ruleLines = (value) => value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('SUBSYSTEM=='));
  const standaloneRules = ruleLines(fs.readFileSync(rulesPath, 'utf8'));
  const embeddedRules = ruleLines(fs.readFileSync(postinstallPath, 'utf8'));
  if (JSON.stringify(standaloneRules) !== JSON.stringify(embeddedRules)) {
    errors.push('Linux postinstall rules differ from packaging/linux/99-espide-serial.rules');
  }
}

if (errors.length) {
  for (const error of errors) process.stderr.write(`[runtime] ${error}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('[runtime] esp_ide_v2 and simulator_lite are complete.\n');
}
