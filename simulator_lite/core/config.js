const SUPPORTED_SCHEMA_VERSION = 1;
const DEFAULT_GPIO_RANGE = Object.freeze([0, 48]);

const COMPONENT_RULES = Object.freeze({
  led: { connections: ['pin'], assets: [] },
  button: { connections: ['pin'], assets: [] },
  'analog-input': { connections: ['pin'], assets: [] },
  servo: { connections: ['pwm'], assets: ['servo/body.png', 'servo/moving.png'] },
  'dc-motor': { connections: ['in1', 'in2'], assets: ['motor/body.png', 'motor/moving.png'] },
  'rotary-encoder': { connections: ['aPin', 'bPin', 'buttonPin'], assets: ['encoder/body.png', 'encoder/moving.png'] },
  neopixel: { connections: ['pin'], assets: ['neopixel/body.png'] },
  'oled-ssd1306': { connections: ['scl', 'sda'], assets: ['oled/body.png'] },
  joystick: { connections: ['xPin', 'yPin', 'buttonPin'], assets: ['joystick/body.png', 'joystick/moving.png'] },
  dht22: { connections: ['pin'], assets: ['dht22/body.png'] },
});

export class SimulatorConfigError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = 'SimulatorConfigError';
    this.path = path;
  }
}

function fail(path, message) {
  throw new SimulatorConfigError(path, message);
}

function cloneConfig(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveNumber(value) {
  return Number.isFinite(value) && value > 0;
}

function assetAvailable(availableAssets, asset) {
  if (!availableAssets) return true;
  if (typeof availableAssets === 'function') return availableAssets(asset);
  if (availableAssets instanceof Set) return availableAssets.has(asset);
  return Array.isArray(availableAssets) && availableAssets.includes(asset);
}

function isSafeBitmapPath(value) {
  if (typeof value !== 'string' || !value.trim()) return false;
  const path = value.trim();
  const segments = path.split('/');
  return !path.startsWith('/')
    && !path.includes('\\')
    && !path.includes('%')
    && !/[?#]/.test(path)
    && !/^[a-z][a-z\d+.-]*:/i.test(path)
    && segments.every((segment) => segment && segment !== '.' && segment !== '..')
    && /\.(?:avif|gif|jpe?g|png|webp)$/i.test(path);
}

function sharingAllows(config, firstId, secondId, pin) {
  return (config.pinSharing || []).some((rule) => (
    rule.components.includes(firstId)
    && rule.components.includes(secondId)
    && rule.pins.includes(pin)
  ));
}

function validatePinSharing(config, ids, minPin, maxPin) {
  if (config.pinSharing === undefined) return;
  if (!Array.isArray(config.pinSharing)) fail('pinSharing', 'musí být pole pravidel.');
  for (const [index, rule] of config.pinSharing.entries()) {
    const path = `pinSharing[${index}]`;
    if (!isObject(rule)) fail(path, 'musí být objekt.');
    if (!Array.isArray(rule.components) || rule.components.length !== 2) {
      fail(`${path}.components`, 'musí obsahovat právě dvě komponenty.');
    }
    if (rule.components[0] === rule.components[1] || rule.components.some((id) => !ids.has(id))) {
      fail(`${path}.components`, 'musí odkazovat na dvě různé existující komponenty.');
    }
    if (!Array.isArray(rule.pins) || rule.pins.length === 0) {
      fail(`${path}.pins`, 'musí obsahovat alespoň jeden GPIO pin.');
    }
    for (const pin of rule.pins) {
      if (!Number.isInteger(pin) || pin < minPin || pin > maxPin) {
        fail(`${path}.pins`, `GPIO ${pin} je mimo rozsah ${minPin}..${maxPin}.`);
      }
    }
    if (typeof rule.reason !== 'string' || !rule.reason.trim()) {
      fail(`${path}.reason`, 'musí stručně vysvětlit záměrné sdílení.');
    }
  }
}

export function requiredAssetsForConfig(config) {
  const assets = (config.components || []).flatMap((component) => (
    COMPONENT_RULES[component.type]?.assets || []
  ));
  if (typeof config.canvas?.backgroundImage === 'string' && config.canvas.backgroundImage.trim()) {
    assets.push(config.canvas.backgroundImage.trim());
  }
  return [...new Set(assets)];
}

export function validateConfig(value, {
  availableAssets = null,
  gpioRange = DEFAULT_GPIO_RANGE,
} = {}) {
  if (!isObject(value)) fail('config', 'musí být objekt.');
  const config = cloneConfig(value);
  const [minPin, maxPin] = gpioRange;
  if (!Number.isInteger(minPin) || !Number.isInteger(maxPin) || minPin > maxPin) {
    throw new TypeError('gpioRange musí být dvojice celých čísel.');
  }

  if (config.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    fail('schemaVersion', `nepodporovaná verze ${config.schemaVersion}; podporována je ${SUPPORTED_SCHEMA_VERSION}.`);
  }
  if (typeof config.board !== 'string' || !config.board.trim()) fail('board', 'musí být neprázdný text.');
  if (!isObject(config.canvas)) fail('canvas', 'musí být objekt.');
  if (!Number.isInteger(config.canvas.width) || !isPositiveNumber(config.canvas.width)) {
    fail('canvas.width', 'musí být kladné celé číslo.');
  }
  if (!Number.isInteger(config.canvas.height) || !isPositiveNumber(config.canvas.height)) {
    fail('canvas.height', 'musí být kladné celé číslo.');
  }
  if (config.canvas.backgroundColor === undefined) {
    config.canvas.backgroundColor = 'transparent';
  } else if (typeof config.canvas.backgroundColor !== 'string' || !config.canvas.backgroundColor.trim()) {
    fail('canvas.backgroundColor', 'musí být neprázdný CSS zápis barvy nebo "transparent".');
  }
  if (config.canvas.backgroundImage !== undefined) {
    if (!isSafeBitmapPath(config.canvas.backgroundImage)) {
      fail('canvas.backgroundImage', 'musí být bezpečná relativní cesta k bitmapě v assets/components/.');
    }
    config.canvas.backgroundImage = config.canvas.backgroundImage.trim();
    if (!assetAvailable(availableAssets, config.canvas.backgroundImage)) {
      fail('canvas.backgroundImage', `chybí bitmapa ${config.canvas.backgroundImage}.`);
    }
  }
  if (config.canvas.backgroundSize === undefined) {
    config.canvas.backgroundSize = 'cover';
  } else if (!['auto', 'contain', 'cover'].includes(config.canvas.backgroundSize)) {
    fail('canvas.backgroundSize', 'musí být pouze "auto", "contain" nebo "cover".');
  }
  if (!Array.isArray(config.components) || config.components.length === 0) {
    fail('components', 'musí být neprázdné pole.');
  }

  const ids = new Set();
  const pinOwners = new Map();
  for (const [index, component] of config.components.entries()) {
    const path = `components[${index}]`;
    if (!isObject(component)) fail(path, 'musí být objekt.');
    if (typeof component.id !== 'string' || !component.id.trim()) fail(`${path}.id`, 'musí být neprázdný text.');
    if (ids.has(component.id)) fail(`${path}.id`, `duplicitní ID ${component.id}.`);
    ids.add(component.id);

    const rule = COMPONENT_RULES[component.type];
    if (!rule) fail(`${path}.type`, `neznámý typ ${component.type}.`);
    if (!isObject(component.connections)) fail(`${path}.connections`, 'musí být objekt.');
    for (const key of rule.connections) {
      if (!Object.prototype.hasOwnProperty.call(component.connections, key)) {
        fail(`${path}.connections.${key}`, 'povinné připojení chybí.');
      }
    }
    for (const [key, pin] of Object.entries(component.connections)) {
      if (!Number.isInteger(pin) || pin < minPin || pin > maxPin) {
        fail(`${path}.connections.${key}`, `GPIO ${pin} je mimo rozsah ${minPin}..${maxPin}.`);
      }
      const owner = pinOwners.get(pin);
      if (owner && !sharingAllows(config, owner.id, component.id, pin)) {
        fail(`${path}.connections.${key}`, `GPIO ${pin} už používá ${owner.id}. Sdílení musí být uvedeno v pinSharing.`);
      }
      if (!owner) pinOwners.set(pin, { id: component.id, key });
    }

    if (!isObject(component.layout)) fail(`${path}.layout`, 'musí být objekt.');
    for (const key of ['x', 'y', 'width', 'height']) {
      if (!Number.isInteger(component.layout[key])) fail(`${path}.layout.${key}`, 'musí být celé číslo.');
    }
    if (component.layout.x < 0 || component.layout.y < 0) fail(`${path}.layout`, 'poloha nesmí být záporná.');
    if (!isPositiveNumber(component.layout.width) || !isPositiveNumber(component.layout.height)) {
      fail(`${path}.layout`, 'šířka a výška musí být kladné.');
    }
    if (component.layout.x + component.layout.width > config.canvas.width) {
      fail(`${path}.layout`, `pravý okraj je mimo canvas.width ${config.canvas.width}.`);
    }
    if (component.layout.y + component.layout.height > config.canvas.height) {
      fail(`${path}.layout`, `spodní okraj je mimo canvas.height ${config.canvas.height}.`);
    }

    if (component.type === 'servo') {
      const mode = component.appearance?.mode;
      if (mode !== '180' && mode !== '360') fail(`${path}.appearance.mode`, 'musí být pouze "180" nebo "360".');
    }
    if (component.type === 'led') {
      const color = component.appearance?.color;
      if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) {
        fail(`${path}.appearance.color`, 'musí být barva ve formátu #RRGGBB.');
      }
    }
    if (component.type === 'neopixel') {
      const appearance = component.appearance || {};
      const count = appearance.count;
      if (!Number.isInteger(count) || count < 1 || count > 64) {
        fail(`${path}.appearance.count`, 'musí být celé číslo v rozsahu 1..64.');
      }
      const assetSize = appearance.assetSize;
      const centers = appearance.pixelCenters;
      if (!isObject(assetSize) || !isPositiveNumber(assetSize.width) || !isPositiveNumber(assetSize.height)) {
        fail(`${path}.appearance.assetSize`, 'musí obsahovat kladnou šířku a výšku podkladového obrázku.');
      }
      if (!Array.isArray(centers) || centers.length !== count) {
        fail(`${path}.appearance.pixelCenters`, `musí obsahovat právě ${count} středů LED.`);
      }
      for (const [centerIndex, center] of centers.entries()) {
        if (!isObject(center) || !Number.isFinite(center.x) || !Number.isFinite(center.y)
            || center.x < 0 || center.y < 0
            || center.x > assetSize.width || center.y > assetSize.height) {
          fail(`${path}.appearance.pixelCenters[${centerIndex}]`, 'musí ležet uvnitř podkladového obrázku.');
        }
      }
      if (!isPositiveNumber(appearance.pixelDiameter)) {
        fail(`${path}.appearance.pixelDiameter`, 'musí být kladné číslo.');
      }
    }
    if (component.type === 'oled-ssd1306') {
      const appearance = component.appearance || {};
      if (appearance.width !== 128 || appearance.height !== 64) {
        fail(`${path}.appearance`, 'OLED musí mít v této etapě rozlišení 128×64.');
      }
      if (!Number.isInteger(appearance.address) || appearance.address < 0x08 || appearance.address > 0x77) {
        fail(`${path}.appearance.address`, 'musí být platná 7bitová I2C adresa 0x08..0x77.');
      }
      if (!Number.isInteger(appearance.busId) || appearance.busId < -1) {
        fail(`${path}.appearance.busId`, 'musí být -1 pro SoftI2C nebo nezáporné ID hardwarové sběrnice.');
      }
      if (appearance.busIds !== undefined && (
        !Array.isArray(appearance.busIds)
        || appearance.busIds.length === 0
        || appearance.busIds.some((id) => !Number.isInteger(id) || id < -1)
      )) {
        fail(`${path}.appearance.busIds`, 'musí být neprázdné pole ID sběrnic od -1 výše.');
      }
      const assetSize = appearance.assetSize;
      const screenWindow = appearance.screenWindow;
      if (!isObject(assetSize) || !isPositiveNumber(assetSize.width) || !isPositiveNumber(assetSize.height)) {
        fail(`${path}.appearance.assetSize`, 'musí obsahovat kladnou šířku a výšku bitmapy.');
      }
      if (!isObject(screenWindow) || ['x', 'y', 'width', 'height'].some((key) => !Number.isFinite(screenWindow[key]))) {
        fail(`${path}.appearance.screenWindow`, 'musí obsahovat číselný obdélník x, y, width a height.');
      }
      if (screenWindow.x < 0 || screenWindow.y < 0 || !isPositiveNumber(screenWindow.width)
          || !isPositiveNumber(screenWindow.height)
          || screenWindow.x + screenWindow.width > assetSize.width
          || screenWindow.y + screenWindow.height > assetSize.height) {
        fail(`${path}.appearance.screenWindow`, 'musí ležet uvnitř bitmapy OLED.');
      }
    }
    if (component.type === 'dht22') {
      const temperature = Number(component.appearance?.initialTemperature);
      const humidity = Number(component.appearance?.initialHumidity);
      if (!Number.isFinite(temperature) || temperature < -40 || temperature > 80) {
        fail(`${path}.appearance.initialTemperature`, 'musí být číslo v rozsahu -40..80 °C.');
      }
      if (!Number.isFinite(humidity) || humidity < 0 || humidity > 100) {
        fail(`${path}.appearance.initialHumidity`, 'musí být číslo v rozsahu 0..100 %.');
      }
    }

    for (const asset of rule.assets) {
      if (!assetAvailable(availableAssets, asset)) fail(`${path}.assets`, `chybí bitmapa ${asset}.`);
    }
  }

  validatePinSharing(config, ids, minPin, maxPin);
  return config;
}

export { COMPONENT_RULES, DEFAULT_GPIO_RANGE, SUPPORTED_SCHEMA_VERSION };
