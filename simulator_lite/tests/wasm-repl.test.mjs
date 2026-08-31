import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadMicroPython } from '../vendor/micropython.mjs';
import {
  CTRL_B,
  CTRL_D,
  parseRawReplResponse,
  RAW_REPL_ENTER_SEQUENCE,
} from '../runtime/repl-protocol.js';
import { I2cRegistry } from '../core/i2c.js';
import { pruneEmscriptenFilesystem } from '../runtime/fs-overlay.js';

let output = [];
const collect = (chunk) => output.push(...chunk);
const takeOutput = () => {
  const value = new TextDecoder().decode(new Uint8Array(output));
  output = [];
  return value;
};

const mp = await loadMicroPython({
  url: new URL('../vendor/micropython.wasm', import.meta.url).href,
  heapsize: 512 * 1024,
  linebuffer: false,
  stdout: collect,
  stderr: collect,
});
pruneEmscriptenFilesystem(mp.FS);
assert.ok(mp.FS.readdir('/').includes('dev'));
for (const name of ['home', 'proc', 'tmp']) assert.ok(!mp.FS.readdir('/').includes(name));
const send = async (value) => {
  for (const character of value) {
    await mp.replProcessCharWithAsyncify(character.codePointAt(0));
  }
};

mp.replInit();
assert.match(takeOutput(), /MicroPython[\s\S]*>>> $/);

await send('print("FRIENDLY_OK")\r');
assert.match(takeOutput(), /FRIENDLY_OK\r?\n>>> $/);

await send(RAW_REPL_ENTER_SEQUENCE);
assert.match(takeOutput(), /raw REPL; CTRL-B to exit[\s\S]*>$/);

await send(`print("RAW_OK")\r${CTRL_D}`);
const success = parseRawReplResponse(takeOutput());
assert.equal(success.complete, true);
assert.equal(success.stdout, 'RAW_OK\n');
assert.equal(success.stderr, '');

await send(`raise ValueError("RAW_ERROR")\r${CTRL_D}`);
const failure = parseRawReplResponse(takeOutput());
assert.equal(failure.complete, true);
assert.equal(failure.stdout, '');
assert.match(failure.stderr, /ValueError: RAW_ERROR/);

await send(`open("/raw-test.dat", "wb").write(bytes((0, 255, 4, 10)))\r${CTRL_D}`);
assert.equal(parseRawReplResponse(takeOutput()).complete, true);
assert.deepEqual(mp.FS.readFile('/raw-test.dat'), new Uint8Array([0, 255, 4, 10]));

await send(`\r${CTRL_B}`);
assert.match(takeOutput(), /MicroPython[\s\S]*>>> $/);

const fmSource = await readFile(new URL('../filesystem/fm_rpc.py', import.meta.url), 'utf8');
mp.FS.mkdirTree('/lib');
mp.FS.writeFile('/lib/fm_rpc.py', new TextEncoder().encode(fmSource));
const persistentBytes = new Uint8Array([0, 255, 4, 10, 128, 65, 66]);
mp.FS.writeFile('/persistent.dat', persistentBytes);
mp.runPython("import sys; sys.path.insert(0, '/lib'); import fm_rpc as F");
takeOutput();

mp.runPython("F.fm_list('/', 0)");
const listing = takeOutput();
assert.match(listing, /<<FMF>>LSTH\|[0-9A-F]{8}\|[0-9A-F]{8}/);
assert.match(listing, /persistent\.dat;7;F/);
assert.doesNotMatch(listing, /(?:^|[\r\n])dev;\d+;D/);
assert.match(listing, /<<FMF>>LSTD\|[0-9A-F]{8}\|[0-9A-F]{8}[\s\S]*OK/);

mp.runPython("F.fm_down('/persistent.dat', 3, 0)");
const download = takeOutput();
assert.match(download, /<<FMF>>DLH\|[0-9A-F]{8}\|[0-9A-F]{8}[\s\S]*\/persistent\.dat;7/);
const chunks = [...download.matchAll(
  /<<FMF>>DLC\|[0-9A-F]{8}\|[0-9A-F]{8}\r?\n([A-Za-z0-9+/=]*)\r?\n<<FMF_END>>/g,
)].map((match) => new Uint8Array(Buffer.from(match[1], 'base64')));
const downloaded = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
let offset = 0;
for (const chunk of chunks) {
  downloaded.set(chunk, offset);
  offset += chunk.byteLength;
}
assert.deepEqual(downloaded, persistentBytes);
assert.match(download, /<<FMF>>DLD\|[0-9A-F]{8}\|[0-9A-F]{8}[\s\S]*OK/);

const oledFrames = [];
const digitalPins = new Map();
const pinWrites = [];
const pwmWrites = [];
const adcInputs = new Map([[5, 49152]]);
const dhtInputs = new Map([[2, [23500, 56700]]]);
const i2c = new I2cRegistry({ onFrame: (frame) => oledFrames.push(frame) });
i2c.configure([{
  id: 'oled-wasm',
  type: 'oled-ssd1306',
  connections: { scl: 22, sda: 21 },
  appearance: { busId: -1, busIds: [-1, 0], address: 60, width: 128, height: 64 },
}]);
mp.registerJsModule('simhw', {
  pin_init(pin, mode, pull, value) {
    const number = Number(pin);
    if (value !== null && value !== undefined) digitalPins.set(number, value ? 1 : 0);
    else if (!digitalPins.has(number)) digitalPins.set(number, Number(pull) === 1 ? 1 : 0);
  },
  pin_read(pin) { return digitalPins.get(Number(pin)) || 0; },
  pin_write(pin, value) {
    const number = Number(pin);
    const level = value ? 1 : 0;
    digitalPins.set(number, level);
    pinWrites.push({ pin: number, value: level });
  },
  pin_irq() {},
  pwm_write(pin, duty, freq) {
    pwmWrites.push({ pin: Number(pin), duty: Number(duty), freq: Number(freq) });
  },
  adc_read(pin) { return adcInputs.get(Number(pin)) || 0; },
  dht_read(pin) { return dhtInputs.get(Number(pin)) || null; },
  http_request(method, url) {
    assert.equal(String(method), 'GET');
    assert.equal(String(url), 'http://example.test/data.txt');
    return [200, new TextEncoder().encode('HTTP_OK')];
  },
  poll_interrupt() { return false; },
  flush_stdout() { i2c.flush(); },
  neopixel_write() {},
  spi_write() {},
  i2c_init: (id, scl, sda) => i2c.initialise(id, scl, sda),
  i2c_scan: (key) => i2c.scan(key),
  i2c_writeto: (key, address, data) => i2c.writeto(key, address, data),
  i2c_readfrom: (key, address, length) => i2c.readfrom(key, address, length),
  i2c_writeto_mem: (key, address, memoryAddress, data, addressSize) => (
    i2c.writetoMem(key, address, memoryAddress, data, addressSize)
  ),
  i2c_readfrom_mem: (key, address, memoryAddress, length, addressSize) => (
    i2c.readfromMem(key, address, memoryAddress, length, addressSize)
  ),
});
const machineSource = await readFile(new URL('../runtime/machine.py', import.meta.url), 'utf8');
const networkSource = await readFile(new URL('../runtime/network.py', import.meta.url), 'utf8');
const ntptimeSource = await readFile(new URL('../runtime/ntptime.py', import.meta.url), 'utf8');
const dhtSource = await readFile(new URL('../runtime/dht.py', import.meta.url), 'utf8');
const urequestsSource = await readFile(new URL('../runtime/urequests.py', import.meta.url), 'utf8');
const oledSource = await readFile(new URL('../filesystem/oled.py', import.meta.url), 'utf8');
mp.FS.writeFile('/lib/machine.py', new TextEncoder().encode(machineSource));
mp.FS.writeFile('/lib/network.py', new TextEncoder().encode(networkSource));
mp.FS.writeFile('/lib/ntptime.py', new TextEncoder().encode(ntptimeSource));
mp.FS.writeFile('/lib/dht.py', new TextEncoder().encode(dhtSource));
mp.FS.writeFile('/lib/urequests.py', new TextEncoder().encode(urequestsSource));
mp.FS.writeFile('/lib/oled.py', new TextEncoder().encode(oledSource));
mp.runPython(`
import framebuf
import time
from machine import I2C, Pin, SoftI2C, disable_irq, enable_irq, _poll
from oled import OLED128x64

pull_up = Pin(30, Pin.IN, Pin.PULL_UP)
pull_down = Pin(31, Pin.IN, Pin.PULL_DOWN)
assert pull_up.value() == 1
assert pull_down.value() == 0
assert pull_up.mode() == Pin.IN
assert pull_up.pull() == Pin.PULL_UP
pull_up.drive(Pin.DRIVE_2)
assert pull_up.drive() == Pin.DRIVE_2

irq_events = []
pull_down.irq(
    trigger=Pin.IRQ_RISING | Pin.IRQ_FALLING,
    handler=lambda pin: irq_events.append(pin.value()),
    hard=False,
)
irq_state = disable_irq()
pull_down.value(1)
_poll()
assert irq_events == []
enable_irq(irq_state)
_poll()
pull_down.value(0)
_poll()
assert irq_events == [1, 0]

class EncoderWasm:
    _TRANS = (
        0, -1, 1, 0,
        1, 0, 0, -1,
        -1, 0, 0, 1,
        0, 1, -1, 0,
    )

    def __init__(self, pin_a, pin_b, steps_per_detent=4):
        self.pin_a = pin_a
        self.pin_b = pin_b
        self.steps_per_detent = steps_per_detent
        self._pos = 0
        self._delta = 0
        self._state = (pin_a.value() << 1) | pin_b.value()
        pin_a.irq(trigger=Pin.IRQ_RISING | Pin.IRQ_FALLING, handler=self._cb)
        pin_b.irq(trigger=Pin.IRQ_RISING | Pin.IRQ_FALLING, handler=self._cb)

    def _cb(self, _):
        state = (self.pin_a.value() << 1) | self.pin_b.value()
        self._state = ((self._state << 2) | state) & 0x0f
        self._delta += self._TRANS[self._state]
        if self._delta >= self.steps_per_detent:
            self._delta = 0
            self._pos += 1

encoder_a = Pin(10, Pin.IN)
encoder_b = Pin(11, Pin.IN)
encoder_wasm = EncoderWasm(encoder_a, encoder_b)
for encoder_state in ((1, 0), (1, 1), (0, 1), (0, 0)):
    encoder_a.value(encoder_state[0])
    encoder_b.value(encoder_state[1])
    _poll()
assert encoder_wasm._pos == 1

i2c_wasm = SoftI2C(scl=Pin(22), sda=Pin(21), freq=400000)
assert 60 in i2c_wasm.scan()
i2c_hw_wasm = I2C(0, scl=Pin(22), sda=Pin(21), freq=400000)
assert 60 in i2c_hw_wasm.scan()
buffer = bytearray(1024)
fbuf = framebuf.FrameBuffer(buffer, 128, 64, framebuf.MONO_VLSB)
display = OLED128x64(128, 64, i2c_wasm, buffer)
fbuf.pixel(0, 0, 1)
fbuf.pixel(127, 63, 1)
fbuf.text('abc', 0, 0, 1)
checkpoint_start = time.ticks_ms()
for _ in range(10):
    time.sleep_ms(0)
checkpoint_elapsed = time.ticks_diff(time.ticks_ms(), checkpoint_start)
show_start = time.ticks_ms()
display.show()
show_elapsed = time.ticks_diff(time.ticks_ms(), show_start)
`);
pinWrites.length = 0;
pwmWrites.length = 0;
mp.runPython(`
import machine
import network
import ntptime
import dht
import urequests
from machine import Pin, PWM, ADC, RTC

machine._reset_simulator_state()

def gpio_set(pin, value):
    if value >= 1:
        Pin(pin, Pin.OUT).on()
    else:
        Pin(pin, Pin.OUT).off()

for _ in range(1000):
    gpio_set(2, 1)
    gpio_set(2, 0)
gpio_pin_count = len(Pin._instances)
gpio_final = Pin(2).value()

adc5 = ADC(Pin(5))
pwm1 = PWM(Pin(1), freq=1000, duty_u16=0)
analogova_hodnota = adc5.read_u16()
pwm1.duty_u16(analogova_hodnota)
adc_value = analogova_hodnota
adc_uv_value = adc5.read_uv()
pwm_value = pwm1.duty_u16()
pin_instance_count_after_pwm = len(Pin._instances)

sta_if = network.WLAN(network.STA_IF)
sta_if.active(True)
sta_if.connect('MojeWiFi', 'MojeHeslo')
network_connected = sta_if.isconnected()
network_config = sta_if.ifconfig()

RTC().datetime((2000, 1, 1, 0, 1, 1, 1, 0))
rtc_manual_year = RTC().datetime()[0]
ntptime.settime()
rtc_ntp_year = RTC().datetime()[0]

dhts = dht.DHT22(Pin(2))
dhts.measure()
dht_temperature = dhts.temperature()
dht_humidity = dhts.humidity()

http_response = urequests.get('http://example.test/data.txt')
http_status = http_response.status_code
http_content = http_response.content.decode('utf-8')
`);
assert.equal(mp.globals.get('gpio_pin_count'), 1);
assert.equal(mp.globals.get('pin_instance_count_after_pwm'), 3);
assert.equal(mp.globals.get('gpio_final'), 0);
assert.deepEqual(pinWrites.slice(-2), [
  { pin: 2, value: 1 },
  { pin: 2, value: 0 },
]);
assert.equal(mp.globals.get('adc_value'), 49152);
assert.equal(mp.globals.get('adc_uv_value'), 2475000);
assert.equal(mp.globals.get('pwm_value'), 49152);
assert.equal(mp.globals.get('network_connected'), true);
assert.deepEqual(Array.from(mp.globals.get('network_config')), ['192.168.4.2', '255.255.255.0', '192.168.4.1', '8.8.8.8']);
assert.equal(mp.globals.get('rtc_manual_year'), 2000);
assert.ok(mp.globals.get('rtc_ntp_year') >= 2020);
assert.equal(mp.globals.get('dht_temperature'), 23.5);
assert.equal(mp.globals.get('dht_humidity'), 56.7);
assert.equal(mp.globals.get('http_status'), 200);
assert.equal(mp.globals.get('http_content'), 'HTTP_OK');
assert.deepEqual(pwmWrites.slice(-2), [
  { pin: 1, duty: 0, freq: 1000 },
  { pin: 1, duty: 49152, freq: 1000 },
]);
assert.ok(
  mp.globals.get('checkpoint_elapsed') >= 8,
  `Ten 1 ms checkpoints elapsed ${mp.globals.get('checkpoint_elapsed')} ms`,
);
assert.ok(
  mp.globals.get('show_elapsed') >= 9,
  `OLED show elapsed ${mp.globals.get('show_elapsed')} ms`,
);
assert.ok(oledFrames.length >= 8);
const oledFrame = oledFrames.at(-1);
assert.equal(oledFrame.displayOn, true);
assert.equal(oledFrame.data[0] & 0x01, 0x01);
assert.equal(oledFrame.data[(7 * 128) + 127] & 0x80, 0x80);
assert.ok(oledFrame.data.some((value) => value !== 0));

const previewSource = await readFile(new URL('../../esp_ide_v2/js/display_designer/live_preview.js', import.meta.url), 'utf8');
const previewWindow = { btoa };
(await import('node:vm')).runInNewContext(previewSource, { window: previewWindow, Uint8Array });
const preview = previewWindow.ESPIDE_DISPLAY_LIVE_PREVIEW;
for (const command of preview.buildPythonInitializerCommands(1024)) mp.runPython(command);
mp.runPython('_espide_preview_status()');
assert.match(takeOutput(), /@ESPIDE_PREVIEW:READY/);
const previewBytes = new Uint8Array(1024);
previewBytes[0] = 0x01;
previewBytes[1023] = 0x80;
for (const chunk of preview.changedChunks(previewBytes, null, 128)) {
  mp.runPython(preview.writeCommand(chunk.offset, chunk.bytes));
}
mp.runPython('_espide_preview_show()');
assert.match(takeOutput(), /@ESPIDE_PREVIEW:OK/);
assert.equal(oledFrames.at(-1).data[0] & 0x01, 0x01);
assert.equal(oledFrames.at(-1).data[1023] & 0x80, 0x80);

console.log('simulator_lite wasm-repl.test.mjs: OK');
