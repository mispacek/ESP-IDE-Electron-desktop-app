import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { parseFilesList } from '../runtime/fs-loader.js';
import {
  requiredAssetsForConfig,
  validateConfig,
} from '../core/config.js';
import { RpcClient } from '../core/rpc.js';
import {
  continuousServoSpeed,
  integrateDegrees,
  servoAngle,
} from '../core/angle.js';
import { encoderButtonLevel, RotaryEncoderModel } from '../core/encoder.js';
import {
  combineJoystickKeyboardStates,
  isJoystickKeyboardCode,
  joystickKeyboardState,
} from '../core/joystick-keyboard.js';
import { ComponentRegistry, createDefaultComponentRegistry } from '../core/component-registry.js';
import { I2cRegistry, i2cBusKey, SSD1306Model } from '../core/i2c.js';
import { integerOledViewport, joystickVector } from '../core/scene.js';

const list = await readFile(new URL('../filesystem/files.lst', import.meta.url), 'utf8');
const entries = parseFilesList(list);
assert.ok(entries.length >= 20);
assert.deepEqual(entries[0], { source: 'boot.py', target: '/' });
assert.deepEqual(entries[1], { source: 'main.py', target: '/' });
for (const entry of entries) await stat(new URL(`../filesystem/${entry.source}`, import.meta.url));
assert.ok(entries.some((entry) => entry.source === 'servo.py' && entry.target === '/lib/'));
assert.ok(entries.some((entry) => entry.source === 'espide_monofont.py' && entry.target === '/lib/'));
assert.ok(entries.every((entry) => !('sha256' in entry)));

const frameBridge = await readFile(new URL('../frame-bridge.js', import.meta.url), 'utf8');
assert.match(frameBridge, /readFile\('\/idecode'\)/);
assert.match(frameBridge, /controller\.setJoystickKeyboardState\(message\.state/);

const worker = await readFile(new URL('../worker.js', import.meta.url), 'utf8');
assert.match(worker, /function decodeOutput/);
assert.match(worker, /linebuffer:\s*false/);
assert.match(worker, /import\(moduleUrl\('\.\/core\/i2c\.js'\)\)/);
assert.match(worker, /moduleUrl\('\.\/runtime\/machine\.py'\)/);
assert.match(worker, /moduleUrl\('\.\/runtime\/network\.py'\)/);
assert.match(worker, /moduleUrl\('\.\/runtime\/ntptime\.py'\)/);
assert.match(worker, /moduleUrl\('\.\/runtime\/dht\.py'\)/);
assert.match(worker, /moduleUrl\('\.\/runtime\/urequests\.py'\)/);
assert.match(worker, /url: moduleUrl\('\.\/vendor\/micropython\.wasm'\)/);
assert.match(worker, /mp\.replInit\(\)/);
assert.match(worker, /timer-only flush/);
assert.match(worker, /OUTPUT_INTERVAL_MS/);
assert.match(worker, /MAX_PENDING_OUTPUT_CHARS/);
assert.match(worker, /replMode === 'friendly'/);
assert.match(worker, /raw_repl:\s*true/);
assert.match(worker, /i2c:\s*'registry'/);
assert.match(worker, /oled_ssd1306:\s*true/);
assert.match(worker, /http_requests:\s*'fetch-proxy-get'/);
assert.match(worker, /vmQueue/);
assert.match(worker, /vmState = 'READY'/);
assert.doesNotMatch(worker, /quiesceVm|maintenanceLock/);
assert.match(worker, /responseError/);
assert.match(worker, /run-accepted/);
assert.match(worker, /BUSY/);
assert.match(worker, /protocolVersion: PROTOCOL_VERSION/);
assert.match(worker, /capabilities: CAPABILITIES/);
assert.match(worker, /HARDWARE_EVENT_INTERVAL_MS = 16/);
assert.match(worker, /flushHardwareEvents\(force = false\)/);
assert.match(worker, /i2cRegistry\?\.flush\(\)/);
assert.match(worker, /pendingHardwareOutputs/);
assert.match(worker, /pendingNeoPixels/);
assert.match(worker, /flush_stdout\(\)\s*\{[\s\S]{0,500}flushHardwareEvents\(\)/);
assert.match(await readFile(new URL('../core/scene.js', import.meta.url), 'utf8'), /pendingOutput/);
assert.match(await readFile(new URL('../core/scene.js', import.meta.url), 'utf8'), /suspend\(\)/);
assert.match(await readFile(new URL('../embed.js', import.meta.url), 'utf8'), /resume\(\)/);
const machine = await readFile(new URL('../runtime/machine.py', import.meta.url), 'utf8');
assert.match(machine, /def _reset_simulator_state\(\):/);
assert.match(machine, /Pin\._instances\.clear\(\)/);
assert.match(machine, /PWM\._instances\.clear\(\)/);
assert.equal((machine.match(/_hw\.poll_interrupt\(\)/g) || []).length, 1);
assert.match(worker, /isBlankPrimaryLine/);
assert.match(worker, /Emscripten REPL currently raises SyntaxError/);
assert.match(worker, /replPrompt/);
assert.match(worker, /repl-running/);
assert.match(worker, /repl-done/);
assert.match(worker, /restoreReplPrompt/);

const embed = await readFile(new URL('../embed.js', import.meta.url), 'utf8');
assert.match(embed, /sceneOnly/);
assert.match(embed, /lite-shell\$\{sceneOnly/);
assert.match(embed, /new URL\('\.\/http-proxy\.php'/);
assert.match(embed, /searchParams\.set\('url', target\.href\)/);
assert.match(embed, /window\.addEventListener\('keydown', this\._onJoystickKeyDown, true\)/);
assert.match(embed, /_resetJoystickKeyboard\(\)/);
const httpProxy = await readFile(new URL('../http-proxy.php', import.meta.url), 'utf8');
assert.match(httpProxy, /FILTER_FLAG_NO_PRIV_RANGE/);
assert.match(httpProxy, /CURLOPT_RESOLVE/);
assert.match(httpProxy, /MAX_RESPONSE_BYTES = 1048576/);

const ideIndex = await readFile(new URL('../../esp_ide_v2/index.html', import.meta.url), 'utf8');
assert.match(ideIndex, /Simulator:\s+"\.\.\/simulator_lite\/toolbox_Simulator\.xml"/);
assert.match(ideIndex, /const DEFAULT_PROCESSOR = "Generic";/);
assert.match(ideIndex, /<select id="processorDropdown"[\s\S]*?<option value="Generic">Generic<\/option>[\s\S]*?<option value="Simulator">Simulator<\/option>[\s\S]*?<option value="ESP32">ESP32<\/option>/);
assert.match(ideIndex, /procSelect\.value = \(userSettings && userSettings\.processor\) \|\| DEFAULT_PROCESSOR;/);
assert.match(ideIndex, /userSettings\.processor = DEFAULT_PROCESSOR;/);
assert.match(ideIndex, /ensureSimulatorBridge/);
assert.match(
  ideIndex,
  /if \(newProc === 'Simulator'\) \{\s*updateBleVisibility\(newProc\);[\s\S]{0,300}?\.activate\(\)/,
);
assert.match(
  ideIndex,
  /else \{\s*window\.ESPIDE_SIMULATOR\?\.deactivate\?\.\(\);[\s\S]{0,300}?updateBleVisibility\(newProc\);/,
);
assert.match(ideIndex, /session\.direct/);
assert.match(ideIndex, /session\.simulatorFrame/);
assert.match(ideIndex, /applySimulatorPreviewCommand/);
const ideBridge = await readFile(new URL('../ide-bridge.js', import.meta.url), 'utf8');
assert.match(ideBridge, /fmTakeAll\(\)/);
assert.match(ideBridge, /RAW_REPL_ENTER_SEQUENCE/);
assert.match(ideBridge, /type: 'joystick-keyboard'/);
assert.match(ideBridge, /document\.addEventListener\('keyup', this\._onDocumentKeyUp, true\)/);
assert.match(ideBridge, /parseRawReplResponse/);
assert.match(ideBridge, /frameReady/);
assert.match(ideBridge, /resetForUpload\(\)/);
assert.match(ideBridge, /frameSession/);
assert.doesNotMatch(ideBridge, /selector\?\.addEventListener\('change'/);
for (const method of [
  'sendCommand',
  'sendData',
  'enterRawREPL',
  'exitRawREPL',
  'execRawCommand',
  'splitIntoChunks',
  'sendFile',
  'fmEnable',
  'fmClear',
  'fmPeek',
  'fmTakeAll',
  'previewDisplayFrame',
  'restartRuntime',
  'resetForUpload',
]) {
  assert.match(ideBridge, new RegExp(`\\b${method}\\(`), `Bridge postrádá transportní metodu ${method}.`);
}
assert.match(frameBridge, /preview-oled-frame/);
assert.match(embed, /previewOledFrame\(value\)/);
assert.match(ideBridge, /data-simulator-factory-reset/);
assert.match(ideBridge, /DOCK_VIEW_STORAGE_KEY/);
assert.match(ideBridge, /_saveDockView\(\)/);
assert.match(ideBridge, /_restoreDockView\(\)/);
assert.match(ideBridge, /#espide-simulator-toggle \{[\s\S]{0,900}?writing-mode: vertical-rl;/);
assert.match(ideBridge, /#espide-simulator-toggle:active \{[\s\S]*?translateY\(calc\(-50% \+ 1px\)\);/);
assert.doesNotMatch(ideBridge, /#espide-simulator-toggle[\s\S]{0,700}?rotate\(180deg\)/);
assert.doesNotMatch(ideBridge, /#espide-simulator-toggle \{ right: 48px; \}/);
assert.doesNotMatch(ideBridge, /@media \(max-width: 920px\)[\s\S]*?#espide-simulator-toggle/);
assert.match(ideBridge, /compact === 'run_code\(\)'[\s\S]{0,160}_writeTerminal\(`\$\{compact\}\\n`/);
const simulatorToolbox = await readFile(new URL('../toolbox_Simulator.xml', import.meta.url), 'utf8');
const toolboxNumber = (blockType, valueName) => {
  const block = simulatorToolbox.match(new RegExp(`<block type="${blockType}"[\\s\\S]*?<\\/block>`))?.[0] || '';
  const value = block.match(new RegExp(`<value name="${valueName}"[\\s\\S]*?<field name="(?:PIN|NUM)">(\\d+)<\\/field>`));
  return value ? Number(value[1]) : null;
};
assert.equal(toolboxNumber('gpio_get', 'pin'), 17);
assert.equal(toolboxNumber('gpio_set', 'pin'), 1);
assert.equal(toolboxNumber('RP2040_adc', 'pin'), 10);
assert.equal(toolboxNumber('pwm_RP2040', 'pin'), 1);
assert.equal(toolboxNumber('oled_init', 'SDA_PIN'), 21);
assert.equal(toolboxNumber('oled_init', 'SCL_PIN'), 22);
assert.equal(toolboxNumber('dht_init', 'pin'), 9);
assert.equal(toolboxNumber('joystick_init', 'vrx'), 13);
assert.equal(toolboxNumber('joystick_init', 'vry'), 14);
assert.equal(toolboxNumber('joystick_init', 'sw'), 15);
assert.equal(toolboxNumber('encoder_init', 'A'), 18);
assert.equal(toolboxNumber('encoder_init', 'B'), 19);
assert.equal(toolboxNumber('servo_init', 'pin'), 23);
assert.equal(toolboxNumber('dc_motor_init', 'pin1'), 27);
assert.equal(toolboxNumber('dc_motor_init', 'pin2'), 28);
assert.equal(toolboxNumber('neopixel_init', 'pin'), 29);
assert.equal(toolboxNumber('neopixel_init', 'number'), 8);
const espIdeHtaccess = await readFile(new URL('../../esp_ide_v2/.htaccess', import.meta.url), 'utf8');
assert.match(espIdeHtaccess, /Cross-Origin-Opener-Policy\s+"same-origin"/);
assert.match(espIdeHtaccess, /Cross-Origin-Embedder-Policy\s+"credentialless"/);

const duty = (microseconds, frequency = 50) => Math.round(microseconds * frequency * 65535 / 1_000_000);
assert.ok(Math.abs(servoAngle(duty(1500), 50) - 90) < 0.1);
assert.ok(Math.abs(continuousServoSpeed(duty(1950), 50) - 50) < 0.2);
assert.equal(integrateDegrees(359, 100, 60, 1000), 719);

const config = JSON.parse(await readFile(new URL('../config/default.json', import.meta.url), 'utf8'));
assert.equal(config.board, 'Simulator');
assert.equal(config.canvas.backgroundColor, 'transparent');
assert.equal(config.components.find((component) => component.type === 'led').label, 'LED\nGPIO 1');
assert.ok(config.components.some((component) => component.type === 'dc-motor'));
assert.ok(config.components.some((component) => component.type === 'rotary-encoder'));
assert.equal(
  config.components.find((component) => component.type === 'rotary-encoder').appearance.animationSpeedMultiplier,
  3,
);
assert.ok(config.components.some((component) => component.type === 'servo' && component.appearance?.mode === '180'));
assert.ok(config.components.some((component) => component.type === 'servo' && component.appearance?.mode === '360'));
assert.ok(config.components.some((component) => component.type === 'oled-ssd1306'));
assert.ok(config.components.some((component) => component.type === 'joystick'));
assert.ok(config.components.some((component) => component.type === 'dht22'));
assert.deepEqual(
  config.components.find((component) => component.type === 'oled-ssd1306').appearance.screenWindow,
  { x: 50, y: 168, width: 704, height: 352 },
);
const oledMetadata = JSON.parse(await readFile(
  new URL('../assets/components/oled/component.json', import.meta.url),
  'utf8',
));
const oledAppearance = config.components.find((component) => component.type === 'oled-ssd1306').appearance;
assert.deepEqual(oledAppearance.assetSize, oledMetadata.canvas);
assert.deepEqual(oledAppearance.screenWindow, oledMetadata.layers.framebuffer.window);
const neopixelAppearance = config.components.find((component) => component.type === 'neopixel').appearance;
const neopixelPng = await readFile(new URL('../assets/components/neopixel/body.png', import.meta.url));
assert.equal(neopixelPng.subarray(1, 4).toString('ascii'), 'PNG');
assert.deepEqual(neopixelAppearance.assetSize, {
  width: neopixelPng.readUInt32BE(16),
  height: neopixelPng.readUInt32BE(20),
});
const availableAssets = new Set(requiredAssetsForConfig(config));
for (const asset of availableAssets) {
  await stat(new URL(`../assets/components/${asset}`, import.meta.url));
}
assert.doesNotThrow(() => validateConfig(config, { availableAssets }));

const transparentCanvas = structuredClone(config);
delete transparentCanvas.canvas.backgroundColor;
assert.equal(
  validateConfig(transparentCanvas, { availableAssets }).canvas.backgroundColor,
  'transparent',
);
const bitmapCanvas = structuredClone(config);
bitmapCanvas.canvas.backgroundImage = 'backgrounds/classroom.webp';
bitmapCanvas.canvas.backgroundSize = 'contain';
const bitmapAssets = new Set([...availableAssets, bitmapCanvas.canvas.backgroundImage]);
assert.ok(requiredAssetsForConfig(bitmapCanvas).includes(bitmapCanvas.canvas.backgroundImage));
assert.doesNotThrow(() => validateConfig(bitmapCanvas, { availableAssets: bitmapAssets }));

const clone = () => structuredClone(config);
const assertInvalid = (mutate, pattern) => {
  const invalid = clone();
  mutate(invalid);
  assert.throws(() => validateConfig(invalid, { availableAssets }), pattern);
};
assertInvalid((value) => { value.components[0].id = value.components[1].id; }, /components\[1\]\.id/);
assertInvalid((value) => { value.components[0].type = 'unknown'; }, /components\[0\]\.type/);
assertInvalid((value) => { value.components[0].layout.x = 999; }, /components\[0\]\.layout/);
assertInvalid((value) => { value.components[0].connections.pin = 49; }, /components\[0\]\.connections\.pin/);
assert.deepEqual(config.pinSharing, []);
assertInvalid((value) => { value.components[5].appearance.mode = '270'; }, /components\[5\]\.appearance\.mode/);
assertInvalid((value) => { value.components[0].appearance.color = 'red'; }, /components\[0\]\.appearance\.color/);
assertInvalid((value) => { value.components[10].appearance.count = 65; }, /components\[10\]\.appearance\.count/);
assertInvalid((value) => { value.components[10].appearance.pixelCenters.pop(); }, /components\[10\]\.appearance\.pixelCenters/);
assertInvalid((value) => { value.components[10].appearance.pixelCenters[0].x = 999; }, /components\[10\]\.appearance\.pixelCenters\[0\]/);
assertInvalid((value) => { value.components[11].appearance.width = 64; }, /components\[11\]\.appearance/);
assertInvalid((value) => { value.components[11].appearance.screenWindow.width = 2000; }, /components\[11\]\.appearance\.screenWindow/);
assertInvalid((value) => { value.canvas.backgroundColor = ''; }, /canvas\.backgroundColor/);
assertInvalid((value) => { value.canvas.backgroundImage = '../background.png'; }, /canvas\.backgroundImage/);
assertInvalid((value) => { value.canvas.backgroundImage = '%2e%2e/background.png'; }, /canvas\.backgroundImage/);
assertInvalid((value) => { value.canvas.backgroundImage = 'https://example.test/background.png'; }, /canvas\.backgroundImage/);
assertInvalid((value) => { value.canvas.backgroundSize = 'stretch'; }, /canvas\.backgroundSize/);
assertInvalid((value) => { value.canvas.backgroundImage = 'backgrounds/missing.png'; }, /canvas\.backgroundImage/);
assert.throws(() => validateConfig(config, { availableAssets: new Set(['motor/body.png']) }), /components\[5\]\.assets/);

const encoder = new RotaryEncoderModel({ stepAngle: 18 });
assert.deepEqual(integerOledViewport(140, 50), {
  scale: 1,
  width: 128,
  height: 64,
  left: 6,
  top: -7,
});
assert.deepEqual(integerOledViewport(250, 110), {
  scale: 1,
  width: 128,
  height: 64,
  left: 61,
  top: 23,
});
assert.deepEqual(integerOledViewport(300, 200), {
  scale: 2,
  width: 256,
  height: 128,
  left: 22,
  top: 36,
});
assert.deepEqual(integerOledViewport(80, 40).scale, 1);
assert.deepEqual(joystickVector(0, 0), { x: 0, y: 0 });
assert.deepEqual(joystickVector(2, 0), { x: 1, y: 0 });
assert.ok(Math.abs(joystickVector(1, 1).x - Math.SQRT1_2) < 1e-12);
assert.equal(isJoystickKeyboardCode('ArrowUp'), true);
assert.equal(isJoystickKeyboardCode('Enter'), false);
assert.deepEqual(joystickKeyboardState(['ArrowUp', 'ArrowRight']), {
  x: 1,
  y: -1,
  pressed: false,
});
assert.deepEqual(joystickKeyboardState(['ArrowLeft', 'ArrowRight', 'Space']), {
  x: 0,
  y: 0,
  pressed: true,
});
assert.deepEqual(combineJoystickKeyboardStates(
  { x: 1, y: 0, pressed: false },
  { x: 0, y: -1, pressed: true },
), { x: 1, y: -1, pressed: true });
encoder.step(1);
assert.deepEqual(
  Array.from({ length: 4 }, () => encoder.advance()).map(({ a, b }) => [a, b]),
  [[1, 0], [1, 1], [0, 1], [0, 0]],
);
assert.equal(encoder.angle, 18);
encoder.reset();
encoder.step(-1);
assert.deepEqual(
  Array.from({ length: 4 }, () => encoder.advance()).map(({ a, b }) => [a, b]),
  [[0, 1], [1, 1], [1, 0], [0, 0]],
);
encoder.reset();
for (let index = 0; index < 10; index += 1) encoder.step(1);
let transitions = 0;
while (encoder.advance()) transitions += 1;
assert.equal(transitions, 40);
assert.equal(encoder.angle, 180);
assert.equal(encoderButtonLevel(true), 0);
assert.equal(encoderButtonLevel(false), 1);
const sceneSource = await readFile(new URL('../core/scene.js', import.meta.url), 'utf8');
assert.match(sceneSource, /pointerAngle/);
assert.match(sceneSource, /setPointerCapture/);
assert.match(sceneSource, /encoderPosition/);
assert.match(sceneSource, /model\.step\(direction\);/);
assert.doesNotMatch(sceneSource, /model\.step\(direction,\s*animationSpeedMultiplier\)/);
assert.match(sceneSource, /lite-oled-art/);
assert.match(sceneSource, /integerOledViewport/);
assert.match(sceneSource, /lite-oled-screen-area/);
assert.match(sceneSource, /lite-oled-screen-slot/);
assert.match(sceneSource, /lite-oled-screen/);
assert.match(sceneSource, /Math\.round\(rect\.left \+ viewport\.left\)/);
assert.match(sceneSource, /pointerType !== 'touch'/);
assert.match(sceneSource, /pointerVector \|\| keyboardVector/);
assert.match(sceneSource, /pointerPressed \|\| keyboardPressed/);
assert.match(sceneSource, /setKeyboardState/);
assert.match(sceneSource, /vector\.x \* 11/);
assert.match(sceneSource, /X \$\{xPercent\}% · Y \$\{yPercent\}%/);
assert.match(sceneSource, /speedPercent/);
assert.doesNotMatch(sceneSource, /state\.value = this\._label\('motorSpeed'/);
assert.match(sceneSource, /temperatureText\.textContent/);
assert.match(sceneSource, /humidityText\.textContent/);
assert.match(sceneSource, /setDht/);
assert.match(sceneSource, /backgroundImage:/);
assert.match(sceneSource, /backgroundRepeat: 'no-repeat'/);
const stylesSource = await readFile(new URL('../core/styles.js', import.meta.url), 'utf8');
assert.match(stylesSource, /\.lite-oled-screen-area \{ position: absolute; overflow: visible; \}/);
assert.match(stylesSource, /\.lite-joystick-art[\s\S]*?touch-action: none;/);
assert.match(stylesSource, /\.lite-dht22-controls/);
assert.match(stylesSource, /\.lite-dht22-controls label/);
assert.match(stylesSource, /\.lite-servo \.lite-component-label,[\s\S]*?white-space: pre-line;/);
assert.match(stylesSource, /--sim-component-bg: var\(--ui-bg-elevated\)/);
assert.doesNotMatch(stylesSource, /\.lite-(?:layered|oled)\s*\{\s*background:/);
assert.match(stylesSource, /\.lite-led\s*\{[\s\S]*?justify-content: flex-start;[\s\S]*?padding-top: 10px;/);
assert.match(stylesSource, /\.lite-led-color-control[^\n]*width: 32px; height: 32px;/);
assert.match(stylesSource, /\.lite-led \.lite-component-label[^\n]*white-space: pre-line;/);

const sentRpcMessages = [];
const rpc = new RpcClient({
  send: (message) => sentRpcMessages.push(message),
  timeouts: { default: 25 },
});
const timedOut = rpc.request('unanswered');
await assert.rejects(timedOut, (error) => error.code === 'RPC_TIMEOUT');
assert.equal(rpc.size, 0);
const pendingRpc = rpc.request('exec');
assert.equal(sentRpcMessages.at(-1).requestId, 2);
rpc.rejectAll(new Error('RUNTIME_RESTARTED: test'));
await assert.rejects(pendingRpc, /RUNTIME_RESTARTED/);
assert.equal(rpc.size, 0);
assert.equal(rpc.resolve({ requestId: 2, ok: true }), false);
const nextRpc = rpc.request('exec');
const nextRequestId = sentRpcMessages.at(-1).requestId;
assert.equal(rpc.resolve({ requestId: nextRequestId, ok: true }), true);
await nextRpc;
assert.equal(rpc.size, 0);

const componentRegistry = createDefaultComponentRegistry();
assert.deepEqual(componentRegistry.types(), [
  'led',
  'button',
  'analog-input',
  'servo',
  'dc-motor',
  'rotary-encoder',
  'neopixel',
  'oled-ssd1306',
  'joystick',
  'dht22',
]);
const customRegistry = new ComponentRegistry([]);
const customComponent = { id: 'custom-result' };
customRegistry.register('custom', (scene, definition) => ({ ...customComponent, scene, definition }));
const customScene = {};
const customDefinition = { type: 'custom' };
assert.deepEqual(customRegistry.create(customScene, customDefinition), {
  ...customComponent,
  scene: customScene,
  definition: customDefinition,
});
assert.equal(customRegistry.create(customScene, { type: 'missing' }), null);
assert.throws(() => customRegistry.register('', () => {}), /neprázdný text/);
assert.throws(() => customRegistry.register('broken', null), /musí být funkce/);

assert.equal(i2cBusKey(-1, 22, 21), 'soft:22:21');
assert.equal(i2cBusKey(0, 22, 21), 'id:0');
const oledFrames = [];
const i2cRegistry = new I2cRegistry({ onFrame: (frame) => oledFrames.push(frame) });
i2cRegistry.configure([{
  id: 'oled-test',
  type: 'oled-ssd1306',
  connections: { scl: 22, sda: 21 },
  appearance: { busId: -1, busIds: [-1, 0], address: 0x3c, width: 128, height: 64 },
}]);
const oledBus = i2cRegistry.initialise(-1, 22, 21);
assert.deepEqual(i2cRegistry.scan(oledBus), [0x3c]);
assert.deepEqual(i2cRegistry.scan(i2cRegistry.initialise(0, 22, 21)), [0x3c]);
i2cRegistry.writeto(oledBus, 0x3c, new Uint8Array([0x80, 0xaf]));
i2cRegistry.writeto(oledBus, 0x3c, new Uint8Array([0x80, 0xb0]));
i2cRegistry.writeto(oledBus, 0x3c, new Uint8Array([0x80, 0x00]));
i2cRegistry.writeto(oledBus, 0x3c, new Uint8Array([0x80, 0x10]));
i2cRegistry.writeto(oledBus, 0x3c, new Uint8Array([0x40, 0x01, 0x80, 0xff]));
assert.equal(oledFrames.length, 0);
i2cRegistry.flush();
assert.equal(oledFrames.length, 1);
assert.equal(oledFrames.at(-1).displayOn, true);
assert.deepEqual(oledFrames.at(-1).data.slice(0, 3), new Uint8Array([0x01, 0x80, 0xff]));
i2cRegistry.flush();
assert.equal(oledFrames.length, 1);
assert.throws(() => i2cRegistry.writeto(oledBus, 0x20, new Uint8Array([0])), /neodpovídá/);
assert.ok(new SSD1306Model().buffer.byteLength === 1024);

console.log('simulator_lite logic.test.mjs: OK');
