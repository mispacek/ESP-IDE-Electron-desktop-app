const BUILTIN_FACTORIES = Object.freeze({
  led: (scene, definition) => scene._createLed(definition),
  button: (scene, definition) => scene._createButton(definition),
  'analog-input': (scene, definition) => scene._createAdc(definition),
  servo: (scene, definition) => scene._createServo(definition),
  'dc-motor': (scene, definition) => scene._createMotor(definition),
  'rotary-encoder': (scene, definition) => scene._createEncoder(definition),
  neopixel: (scene, definition) => scene._createNeoPixel(definition),
  'oled-ssd1306': (scene, definition) => scene._createOled(definition),
  joystick: (scene, definition) => scene._createJoystick(definition),
  dht22: (scene, definition) => scene._createDht22(definition),
});

export class ComponentRegistry {
  constructor(entries = Object.entries(BUILTIN_FACTORIES)) {
    this.factories = new Map();
    for (const [type, factory] of entries) this.register(type, factory);
  }

  register(type, factory) {
    const key = String(type || '').trim();
    if (!key) throw new TypeError('Typ komponenty musí být neprázdný text.');
    if (typeof factory !== 'function') throw new TypeError(`Factory komponenty ${key} musí být funkce.`);
    this.factories.set(key, factory);
    return this;
  }

  has(type) {
    return this.factories.has(type);
  }

  create(scene, definition) {
    const factory = this.factories.get(definition?.type);
    return factory ? factory(scene, definition) : null;
  }

  types() {
    return [...this.factories.keys()];
  }
}

export function createDefaultComponentRegistry() {
  return new ComponentRegistry();
}

export { BUILTIN_FACTORIES };
