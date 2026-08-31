import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { RpcClient, rpcError } from '../core/rpc.js';

// Pending RPC calls must be rejected before a runtime/frame generation is replaced.
{
  const sent = [];
  const client = new RpcClient({ send: (message) => sent.push(message) });
  const run = client.request('run');
  const upload = client.request('write-file');
  assert.equal(client.size, 2);
  client.rejectAll(rpcError('RUNTIME_RESTARTED', 'Restarted before upload'));
  await assert.rejects(run, (error) => error.code === 'RUNTIME_RESTARTED');
  await assert.rejects(upload, (error) => error.code === 'RUNTIME_RESTARTED');
  assert.equal(client.size, 0);
  assert.equal(client.resolve({ requestId: sent[0].requestId, ok: true }), false);
}

// A local timeout also clears its pending slot; the host can then restart the runtime.
{
  const client = new RpcClient({ send: () => {}, timeouts: { run: 20 } });
  await assert.rejects(
    client.request('run'),
    (error) => error.code === 'RPC_TIMEOUT',
  );
  assert.equal(client.size, 0);
}

const ideBridge = await readFile(new URL('../ide-bridge.js', import.meta.url), 'utf8');
const frameBridge = await readFile(new URL('../frame-bridge.js', import.meta.url), 'utf8');
const app = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const embed = await readFile(new URL('../embed.js', import.meta.url), 'utf8');
const index = await readFile(new URL('../../esp_ide_v2/index.html', import.meta.url), 'utf8');

assert.match(ideBridge, /async restartRuntime\(\)[\s\S]*?await this\._request\('restart'\)[\s\S]*?catch[\s\S]*?_reloadFrame\(\)/);
assert.match(ideBridge, /async resetForUpload\(\)\s*{\s*return this\.restartRuntime\(\)/);
assert.match(ideBridge, /session: String\(this\.frameSession\)/);
assert.match(ideBridge, /message\.session !== String\(this\.frameSession\)/);
assert.match(ideBridge, /loadingScreen\.classList\.contains\('loading-hidden'\)/);
assert.match(ideBridge, /body\.espide-simulator-docked #editor_div/);
assert.match(ideBridge, /espide-simulator-layoutchange/);
assert.match(ideBridge, /_beginDockResize\(event\)/);
assert.match(ideBridge, /_beginFloatingDrag\(event\)/);
assert.match(frameBridge, /message\.session !== FRAME_SESSION/);
assert.match(frameBridge, /message\.type === 'restart'[\s\S]*?await controller\.restart\(\)/);
assert.match(embed, /async restart\(\)[\s\S]*?this\.ready = this\._startWorker\(\)/);
assert.match(embed, /cacheVersion: MODULE_VERSION/);
assert.match(embed, /event\.data\?\.type === 'bootstrap-ready'[\s\S]*?worker\.postMessage\(\{[\s\S]*?type: 'init'/);
assert.match(await readFile(new URL('../worker.js', import.meta.url), 'utf8'), /post\('bootstrap-ready'\)/);

const resetIndex = index.indexOf('await dev.resetForUpload()');
const backupIndex = index.indexOf('await uploadAutomaticBlocklyBackup(dev)', resetIndex);
const idecodeIndex = index.indexOf('await dev.sendFile("idecode"', resetIndex);
assert.ok(resetIndex >= 0 && resetIndex < backupIndex && backupIndex < idecodeIndex);

assert.match(app, /factoryResetOnBoot: pageParams\.get\('factoryReset'\) === '1'/);
assert.match(app, /document\.documentElement\.dataset\.embed = embedded/);
assert.match(embed, /root\.dataset\.theme = theme/);
assert.match(index, /terminalElement\.clientWidth \|\| getWidth\(\)/);
const clearIndex = embed.indexOf('await this.filesystemStore.clear()');
const loadIndex = embed.indexOf('await this.filesystemStore.load()', clearIndex);
assert.ok(clearIndex >= 0 && clearIndex < loadIndex);

for (const source of [ideBridge, frameBridge, app, embed]) {
  assert.doesNotMatch(source, /20\d\d-\d\d-\d\d-lite-\d+/);
}

console.log('simulator_lite rpc-stability.test.mjs: OK');
