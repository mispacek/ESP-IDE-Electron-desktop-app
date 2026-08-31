const APP_VERSION = new URL(import.meta.url).searchParams.get('v');
const moduleUrl = (path) => {
  const url = new URL(path, import.meta.url);
  if (APP_VERSION) url.searchParams.set('v', APP_VERSION);
  return url.href;
};
const [{ mountSimulatorLite }, { installFrameBridge }] = await Promise.all([
  import(moduleUrl('./embed.js')),
  import(moduleUrl('./frame-bridge.js')),
]);

const DEFAULT_CODE = `import utime
from machine import Pin, PWM, ADC
from servo import Servo
import dcmotorlib
import neopixel

led = Pin(2, Pin.OUT)
button = Pin(0, Pin.IN, Pin.PULL_UP)
adc = ADC(Pin(5))
servo = Servo(Pin(17))
motor = dcmotorlib.DCMotor(19, 20, 0)
pixels = neopixel.NeoPixel(Pin(23), 8)

def on_button(pin):
    print('IRQ tlačítka:', pin.value())

button.irq(on_button, Pin.IRQ_FALLING | Pin.IRQ_RISING)
print('ADC:', adc.read_u16())
led.on()
servo.write_angle(45)
motor.set_speed(55)
pixels.fill((12, 45, 180))
pixels[0] = (255, 30, 8)
pixels.write()
utime.sleep_ms(800)
motor.set_speed(-55)
servo.write_angle(135)
led.off()
print('Hotovo')
`;

let frameBridge = null;
const pageParams = new URLSearchParams(window.location.search);
const embedded = pageParams.get('embed') === '1';
document.documentElement.dataset.embed = embedded ? 'true' : 'false';
if (pageParams.get('theme') === 'dark') document.documentElement.dataset.theme = 'dark';
const simulator = mountSimulatorLite(document.querySelector('#simulator-root'), {
  initialCode: DEFAULT_CODE,
  compact: embedded,
  // The ESP IDE already owns the editor, terminal and run controls.  The
  // embedded document therefore exposes only the Wokwi-like scene; the
  // standalone URL keeps the full development shell for local testing.
  sceneOnly: embedded,
  factoryResetOnBoot: pageParams.get('factoryReset') === '1',
  onEvent(event) {
    if (event.type === 'ready') window.dispatchEvent(new CustomEvent('simulator-lite-ready'));
    frameBridge?.emit(event);
  },
});

frameBridge = installFrameBridge(simulator);

window.espSimulatorLite = simulator;
simulator.ready.catch((error) => {
  console.error('Simulator Lite:', error);
});
