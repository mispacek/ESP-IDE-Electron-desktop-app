'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const executable = path.resolve(
  process.argv[2] || path.join(projectRoot, '.runtime', 'build-verify-no-sign', 'win-unpacked', 'ESP IDE.exe'),
);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'espide-packaged-smoke-'));
const port = 48765;

function portIsOpen() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(500);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

function requestStatus() {
  return new Promise((resolve) => {
    const request = http.get(`http://127.0.0.1:${port}/esp_ide_v2/index.html`, (response) => {
      response.resume();
      response.once('end', () => resolve(response.statusCode));
    });
    request.setTimeout(750, () => request.destroy());
    request.once('error', () => resolve(null));
  });
}

async function waitForStatus(child, expected) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Packaged app exited early with code ${child.exitCode}.`);
    const status = await requestStatus();
    if (status === expected) return status;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Packaged app did not expose the protected local server on port ${port}.`);
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  const stopped = new Promise((resolve) => child.once('exit', resolve));
  child.kill();
  await Promise.race([stopped, new Promise((resolve) => setTimeout(resolve, 5000))]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function run() {
  assert.equal(process.platform, 'win32', 'This smoke test expects a Windows unpacked build.');
  assert.equal(fs.existsSync(executable), true, `Packaged executable is missing: ${executable}`);
  assert.equal(await portIsOpen(), false, `Port ${port} is already in use.`);

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(executable, [`--user-data-dir=${profile}`], {
    env,
    stdio: 'ignore',
    windowsHide: true,
  });
  try {
    const status = await waitForStatus(child, 403);
    process.stdout.write(`ESPIDE_PACKAGED_SMOKE server_status=${status} process_alive=${child.exitCode === null}\n`);
  } finally {
    await stopChild(child);
  }
}

run()
  .catch((error) => {
    process.stderr.write(`${error.stack || error}\n`);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(profile, { force: true, recursive: true, maxRetries: 3 });
  });
