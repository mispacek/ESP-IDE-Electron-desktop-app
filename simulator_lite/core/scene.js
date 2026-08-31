import {
  clamp,
  continuousServoSpeed,
  integrateDegrees,
  servoAngle,
} from './angle.js';
import { encoderButtonLevel, RotaryEncoderModel } from './encoder.js';
import { createDefaultComponentRegistry } from './component-registry.js';

const MODULE_VERSION = new URL(import.meta.url).searchParams.get('v');

const COMPONENT_LABEL_KEYS = Object.freeze({
  led: 'componentLed',
  button: 'componentButton',
  adc: 'componentAdc',
  servo180: 'componentServo180',
  servo360: 'componentServo360',
  motor: 'componentMotor',
  encoder: 'componentEncoder',
  neopixel: 'componentNeoPixel',
  oled: 'componentOled',
  joystick: 'componentJoystick',
  dht22: 'componentDht22',
});

function hexRgb(value, fallback = [217, 239, 255]) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(value || ''));
  if (!match) return fallback;
  const number = Number.parseInt(match[1], 16);
  return [(number >> 16) & 0xff, (number >> 8) & 0xff, number & 0xff];
}

function assetUrl(assetBase, folder, file) {
  return assetPathUrl(assetBase, `${folder}/${file}`);
}

function assetPathUrl(assetBase, path) {
  const url = new URL(path, assetBase);
  if (MODULE_VERSION) url.searchParams.set('v', MODULE_VERSION);
  return url.href;
}

function layoutStyle(layout = {}) {
  const style = {
    left: `${Number(layout.x) || 0}px`,
    top: `${Number(layout.y) || 0}px`,
    width: `${Number(layout.width) || 120}px`,
    height: `${Number(layout.height) || 100}px`,
    zIndex: String(Number(layout.zIndex) || 1),
  };
  if (layout.rotation) style.transform = `rotate(${Number(layout.rotation)}deg)`;
  return style;
}

function applyStyles(element, styles) {
  for (const [name, value] of Object.entries(styles)) element.style[name] = value;
}

export function integerOledViewport(availableWidth, availableHeight, pixelWidth = 128, pixelHeight = 64) {
  const slotWidth = Math.max(0, Number(availableWidth) || 0);
  const slotHeight = Math.max(0, Number(availableHeight) || 0);
  const logicalWidth = Math.max(1, Number(pixelWidth) || 128);
  const logicalHeight = Math.max(1, Number(pixelHeight) || 64);
  const scale = Math.max(1, Math.floor(Math.min(
    slotWidth / logicalWidth,
    slotHeight / logicalHeight,
  )));
  const width = logicalWidth * scale;
  const height = logicalHeight * scale;
  return {
    scale,
    width,
    height,
    left: (slotWidth - width) / 2,
    top: (slotHeight - height) / 2,
  };
}

function signalRatio(signal) {
  if (!signal) return 0;
  return signal.kind === 'pwm' ? clamp(signal.duty / 65535, 0, 1) : signal.value ? 1 : 0;
}

function rounded(value) {
  const number = Math.round(Number(value) || 0);
  return Object.is(number, -0) ? 0 : number;
}

function pointerAngle(event, element) {
  const bounds = element.getBoundingClientRect();
  const x = event.clientX - (bounds.left + bounds.width / 2);
  const y = event.clientY - (bounds.top + bounds.height / 2);
  return Math.atan2(y, x) * 180 / Math.PI;
}

function shortestAngleDelta(current, previous) {
  let delta = current - previous;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}

export function joystickVector(x, y) {
  let dx = Number(x) || 0;
  let dy = Number(y) || 0;
  const distance = Math.hypot(dx, dy);
  if (distance > 1) {
    dx /= distance;
    dy /= distance;
  }
  return { x: clamp(dx, -1, 1), y: clamp(dy, -1, 1) };
}

export class Scene {
  constructor(root, config, {
    assetBase,
    setDigital = () => {},
    setAdc = () => {},
    setDht = () => {},
    labels = {},
    componentRegistry = createDefaultComponentRegistry(),
  } = {}) {
    this.root = root;
    this.config = config;
    this.assetBase = assetBase;
    this.setDigital = setDigital;
    this.setAdc = setAdc;
    this.setDht = setDht;
    this.labels = { ...labels };
    this.componentRegistry = componentRegistry;
    this.components = [];
    this.byPin = new Map();
    this.byId = new Map();
    this.pendingOutput = new Map();
    this.pendingNeoPixel = new Map();
    this.pendingOledFrames = new Map();
    this.lastFrame = performance.now();
    this.frame = 0;
    this._render();
  }

  _render() {
    this.root.replaceChildren();
    this.root.className = 'lite-scene';
    applyStyles(this.root, {
      width: `${this.config.canvas.width}px`,
      height: `${this.config.canvas.height}px`,
      backgroundColor: this.config.canvas.backgroundColor || 'transparent',
      backgroundImage: this.config.canvas.backgroundImage
        ? `url("${assetPathUrl(this.assetBase, this.config.canvas.backgroundImage)}")`
        : 'none',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
      backgroundSize: this.config.canvas.backgroundSize || 'cover',
    });

    for (const definition of this.config.components || []) {
      const component = this._createComponent(definition);
      this.components.push(component);
      this.byId.set(definition.id, component);
      for (const pin of Object.values(definition.connections || {})) {
        if (Number.isInteger(Number(pin))) {
          if (!this.byPin.has(Number(pin))) this.byPin.set(Number(pin), []);
          this.byPin.get(Number(pin)).push(component);
        }
      }
    }

    for (const component of this.components) component.initialiseInput?.();
    this.frame = requestAnimationFrame(() => this._tick());
  }

  resetInputs() {
    for (const component of this.components) component.initialiseInput?.();
  }

  setJoystickKeyboardState(state = {}) {
    for (const component of this.components) component.setKeyboardState?.(state);
  }

  _baseElement(definition, className = '') {
    const element = document.createElement('section');
    element.className = `lite-component ${className}`.trim();
    applyStyles(element, layoutStyle(definition.layout));
    element.dataset.componentId = definition.id;
    const label = document.createElement('div');
    label.className = 'lite-component-label';
    label.textContent = this._componentLabel(definition);
    element.append(label);
    this.root.append(element);
    return { element, label };
  }

  _label(key, fallback, variables = {}) {
    const template = this.labels[key] || fallback;
    return String(template).replace(/\{(\w+)\}/g, (_, name) => (
      Object.prototype.hasOwnProperty.call(variables, name) ? String(variables[name]) : `{${name}}`
    ));
  }

  _componentLabel(definition) {
    const connections = definition.connections || {};
    const appearance = definition.appearance || {};
    const variables = {
      pin: connections.pin ?? connections.pwm,
      a: connections.aPin,
      b: connections.bPin,
      sw: connections.buttonPin,
      in1: connections.in1,
      in2: connections.in2,
      scl: connections.scl,
      sda: connections.sda,
      count: appearance.count,
      x: connections.xPin,
      y: connections.yPin,
    };
    const translationKey = COMPONENT_LABEL_KEYS[definition.labelKey];
    if (translationKey) return this._label(translationKey, definition.label, variables);
    return definition.label || definition.type;
  }

  setLabels(labels = {}) {
    this.labels = { ...this.labels, ...labels };
    for (const component of this.components) {
      if (component.updateLabel) component.updateLabel();
      else if (component.label) component.label.textContent = this._componentLabel(component.definition);
      if (component.press) component.press.textContent = this._label('press', 'Stisk');
      if (component.pressButton) component.pressButton.textContent = this._label('press', 'Stisk');
      component.updateState?.();
    }
  }

  _createComponent(definition) {
    const component = this.componentRegistry.create(this, definition);
    if (component) return component;

    const type = definition.type;
    const base = this._baseElement(definition, 'lite-unsupported');
    base.element.append(document.createTextNode(this._label('unsupported', `Nepodporovaný typ: {type}`, { type })));
    return { definition, element: base.element, label: base.label };
  }

  _createLed(definition) {
    const base = this._baseElement(definition, 'lite-led');
    const control = document.createElement('label');
    control.className = 'lite-led-color-control';
    const dot = document.createElement('span');
    dot.className = 'lite-led-dot';
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.className = 'lite-led-color-picker';
    picker.value = definition.appearance?.color || '#43d17d';
    const applyColor = () => {
      definition.appearance.color = picker.value.toUpperCase();
      dot.style.setProperty('--led-color', picker.value);
    };
    picker.addEventListener('input', applyColor);
    control.append(dot, picker);
    base.element.append(control);
    const component = {
      definition,
      element: base.element,
      label: base.label,
      updateLabel: () => {
        const label = this._componentLabel(definition);
        base.label.textContent = label;
        picker.setAttribute('aria-label', this._label('ledColor', 'Změnit barvu {label}', { label }));
      },
      onOutput: (event) => {
        const pin = Number(definition.connections?.pin);
        if (Number(event.pin) !== pin) return;
        const brightness = event.kind === 'pwm' ? clamp(event.duty / 65535, 0, 1) : event.value ? 1 : 0;
        dot.style.opacity = String(0.16 + brightness * 0.84);
        dot.classList.toggle('is-on', brightness > 0.01);
      },
      destroy: () => picker.removeEventListener('input', applyColor),
    };
    applyColor();
    component.updateLabel();
    return component;
  }

  _createButton(definition) {
    const base = this._baseElement(definition, 'lite-button');
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = this._label('press', 'Stisk');
    base.element.append(button);
    const activeLow = definition.appearance?.activeLow !== false;
    const released = definition.appearance?.initial ?? (activeLow ? 1 : 0);
    const pressed = activeLow ? 0 : 1;
    const write = (value) => this.setDigital(Number(definition.connections?.pin), value);
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      button.setPointerCapture?.(event.pointerId);
      write(pressed);
      button.classList.add('is-pressed');
    });
    const release = () => {
      write(released);
      button.classList.remove('is-pressed');
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    return { definition, element: base.element, label: base.label, press: button, initialiseInput: () => write(released) };
  }

  _createAdc(definition) {
    const base = this._baseElement(definition, 'lite-adc');
    const value = document.createElement('output');
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '65535';
    slider.step = '1';
    slider.value = String(definition.appearance?.initial ?? 32768);
    const update = () => {
      value.value = slider.value;
      this.setAdc(Number(definition.connections?.pin), Number(slider.value));
    };
    slider.addEventListener('input', update);
    base.element.append(slider, value);
    return { definition, element: base.element, label: base.label, initialiseInput: update };
  }

  _layered(definition, folder, extraClass) {
    const base = this._baseElement(definition, `lite-layered ${extraClass}`);
    const layers = document.createElement('div');
    layers.className = 'lite-layered-art';
    const body = document.createElement('img');
    body.alt = '';
    body.draggable = false;
    body.src = assetUrl(this.assetBase, folder, 'body.png');
    const moving = document.createElement('img');
    moving.alt = '';
    moving.draggable = false;
    moving.src = assetUrl(this.assetBase, folder, 'moving.png');
    layers.append(body, moving);
    base.element.append(layers);
    return { ...base, layers, body, moving };
  }

  _stateElement(base) {
    const state = document.createElement('output');
    state.className = 'lite-component-state';
    base.element.append(state);
    return state;
  }

  _createServo(definition) {
    const base = this._layered(definition, 'servo', 'lite-servo');
    const state = this._stateElement(base);
    const maxRpm = Number(definition.appearance?.maxRpm) || 60;
    const modeButton = document.createElement('button');
    modeButton.type = 'button';
    modeButton.className = 'lite-servo-mode';
    base.element.append(modeButton);
    const component = {
      definition,
      element: base.element,
      moving: base.moving,
      mode: definition.appearance?.mode === '360' ? '360' : '180',
      maxRpm,
      angle: definition.appearance?.mode === '360' ? 0 : 90,
      speed: 0,
      signal: null,
      updateLabel: () => {
        const pin = definition.connections?.pwm;
        const key = component.mode === '180' ? 'componentServo180' : 'componentServo360';
        const fallback = component.mode === '180' ? 'Servo 180° GPIO {pin}' : 'Servo 360° GPIO {pin}';
        base.label.textContent = this._label(key, fallback, { pin });
        modeButton.textContent = `${component.mode}°`;
        const title = this._label('servoMode', 'Přepnout servo mezi 180° a 360°');
        modeButton.title = title;
        modeButton.setAttribute('aria-label', title);
      },
      updateState: () => {
        state.value = component.mode === '180'
          ? this._label('positionDegrees', '{value}°', { value: rounded(component.angle) })
          : this._label('speedPercent', '{value}%', {
            value: rounded(component.speed),
          });
      },
      onOutput: (event) => {
        if (Number(event.pin) !== Number(definition.connections?.pwm)) return;
        component.signal = event;
        if (component.mode === '180') component.angle = servoAngle(event.duty, event.frequency);
        else component.speed = continuousServoSpeed(event.duty, event.frequency);
        component.updateState();
      },
      tick: (elapsed) => {
        if (component.mode === '360') {
          component.angle = integrateDegrees(component.angle, component.speed, maxRpm, elapsed);
        }
        component.moving.style.transform = `rotate(${component.angle}deg)`;
      },
    };
    const toggleMode = () => {
      component.mode = component.mode === '180' ? '360' : '180';
      if (component.mode === '180') {
        component.speed = 0;
        component.angle = component.signal
          ? servoAngle(component.signal.duty, component.signal.frequency)
          : 90;
      } else {
        component.speed = component.signal
          ? continuousServoSpeed(component.signal.duty, component.signal.frequency)
          : 0;
      }
      component.updateLabel();
      component.updateState();
    };
    modeButton.addEventListener('click', toggleMode);
    component.label = base.label;
    component.destroy = () => modeButton.removeEventListener('click', toggleMode);
    component.updateLabel();
    component.updateState();
    return component;
  }

  _createMotor(definition) {
    const base = this._layered(definition, 'motor', 'lite-motor');
    const state = this._stateElement(base);
    const component = {
      definition,
      element: base.element,
      moving: base.moving,
      signals: new Map(),
      speed: 0,
      angle: 0,
      maxRpm: Number(definition.appearance?.maxRpm) || 120,
      updateState: () => {
        state.value = this._label('speedPercent', '{value}%', {
          value: rounded(component.speed),
        });
      },
      onOutput: (event) => {
        const connections = definition.connections || {};
        if (Number(event.pin) !== Number(connections.in1) && Number(event.pin) !== Number(connections.in2)) return;
        component.signals.set(Number(event.pin), event);
        const first = signalRatio(component.signals.get(Number(connections.in1)));
        const second = signalRatio(component.signals.get(Number(connections.in2)));
        component.speed = clamp((second - first) * 100, -100, 100);
        component.updateState();
      },
      tick: (elapsed) => {
        component.angle = integrateDegrees(component.angle, component.speed, component.maxRpm, elapsed);
        component.moving.style.transform = `rotate(${component.angle}deg)`;
      },
    };
    component.label = base.label;
    component.updateState();
    return component;
  }

  _createEncoder(definition) {
    const base = this._layered(definition, 'encoder', 'lite-encoder');
    const state = this._stateElement(base);
    const connections = definition.connections || {};
    const model = new RotaryEncoderModel({ stepAngle: definition.appearance?.stepAngle });
    const animationSpeedMultiplier = Math.max(
      1,
      Number(definition.appearance?.animationSpeedMultiplier) || 1,
    );
    const transitionIntervalMs = Math.max(
      1,
      Number(definition.appearance?.transitionIntervalMs) || (25 / animationSpeedMultiplier),
    );
    const component = {
      definition,
      element: base.element,
      moving: base.moving,
      model,
      timer: null,
      drag: null,
      updateState: () => {
        state.value = this._label('encoderPosition', '{steps} kroků · {angle}°', {
          steps: rounded(model.angle / model.stepAngle),
          angle: rounded(model.angle),
        });
      },
      step: (direction) => {
        model.step(direction);
        if (!component.timer) component._runTransition();
      },
      setPressed: (value) => {
        this.setDigital(Number(connections.buttonPin), encoderButtonLevel(value));
        component.pressButton?.classList.toggle('is-pressed', !!value);
      },
      initialiseInput: () => {
        model.reset();
        this.setDigital(Number(connections.aPin), 0);
        this.setDigital(Number(connections.bPin), 0);
        component.setPressed(false);
        component.updateState();
      },
      _runTransition: null,
    };
    component._runTransition = () => {
      const transition = model.advance();
      if (!transition) {
        component.timer = null;
        return;
      }
      this.setDigital(Number(connections.aPin), transition.a);
      this.setDigital(Number(connections.bPin), transition.b);
      component.moving.style.transform = `rotate(${transition.angle}deg)`;
      component.updateState();
      component.timer = setTimeout(component._runTransition, transitionIntervalMs);
    };
    const wheel = (event) => {
      event.preventDefault();
      component.step(event.deltaY < 0 ? 1 : -1);
    };
    base.layers.addEventListener('wheel', wheel, { passive: false });
    const dragStart = (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      base.layers.setPointerCapture?.(event.pointerId);
      component.drag = {
        pointerId: event.pointerId,
        angle: pointerAngle(event, base.layers),
        accumulated: 0,
      };
      base.layers.classList.add('is-dragging');
    };
    const dragMove = (event) => {
      if (!component.drag || component.drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      const nextAngle = pointerAngle(event, base.layers);
      component.drag.accumulated += shortestAngleDelta(nextAngle, component.drag.angle);
      component.drag.angle = nextAngle;
      const stepAngle = Math.max(1, Math.abs(model.stepAngle));
      while (Math.abs(component.drag.accumulated) >= stepAngle) {
        const direction = component.drag.accumulated > 0 ? 1 : -1;
        component.step(direction);
        component.drag.accumulated -= direction * stepAngle;
      }
    };
    const dragEnd = (event) => {
      if (!component.drag || (event.pointerId != null && component.drag.pointerId !== event.pointerId)) return;
      component.drag = null;
      base.layers.classList.remove('is-dragging');
    };
    base.layers.addEventListener('pointerdown', dragStart);
    base.layers.addEventListener('pointermove', dragMove);
    base.layers.addEventListener('pointerup', dragEnd);
    base.layers.addEventListener('pointercancel', dragEnd);
    base.layers.addEventListener('lostpointercapture', dragEnd);
    const controls = document.createElement('div');
    controls.className = 'lite-encoder-controls';
    const makeStepButton = (text, direction, title) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'lite-encoder-step';
      button.classList.add(direction < 0 ? 'is-minus' : 'is-plus');
      button.textContent = text;
      button.title = title;
      button.addEventListener('click', () => component.step(direction));
      return button;
    };
    controls.append(
      makeStepButton('−', -1, 'Otočit doleva'),
      makeStepButton('+', 1, 'Otočit doprava'),
    );
    const pressButton = document.createElement('button');
    pressButton.type = 'button';
    pressButton.className = 'lite-encoder-button';
    pressButton.textContent = this._label('press', 'Stisk');
    const pressDown = (event) => {
      event.preventDefault();
      pressButton.setPointerCapture?.(event.pointerId);
      component.setPressed(true);
    };
    const release = () => component.setPressed(false);
    pressButton.addEventListener('pointerdown', pressDown);
    pressButton.addEventListener('pointerup', release);
    pressButton.addEventListener('pointercancel', release);
    pressButton.addEventListener('lostpointercapture', release);
    base.element.append(controls, pressButton);
    component.label = base.label;
    component.pressButton = pressButton;
    component.destroy = () => {
      if (component.timer) clearTimeout(component.timer);
      component.timer = null;
      component.drag = null;
      model.reset();
      base.layers.removeEventListener('wheel', wheel);
      base.layers.removeEventListener('pointerdown', dragStart);
      base.layers.removeEventListener('pointermove', dragMove);
      base.layers.removeEventListener('pointerup', dragEnd);
      base.layers.removeEventListener('pointercancel', dragEnd);
      base.layers.removeEventListener('lostpointercapture', dragEnd);
      pressButton.removeEventListener('pointerdown', pressDown);
      pressButton.removeEventListener('pointerup', release);
      pressButton.removeEventListener('pointercancel', release);
      pressButton.removeEventListener('lostpointercapture', release);
    };
    return component;
  }

  _createNeoPixel(definition) {
    const base = this._baseElement(definition, 'lite-neopixel');
    const count = Math.max(1, Math.min(64, Number(definition.appearance?.count) || 8));
    const appearance = definition.appearance || {};
    const assetSize = appearance.assetSize || { width: 1, height: 1 };
    const assetWidth = Math.max(1, Number(assetSize.width) || 1);
    const assetHeight = Math.max(1, Number(assetSize.height) || 1);
    const centers = appearance.pixelCenters || [];
    const diameter = Math.max(1, Number(appearance.pixelDiameter) || 1);
    const cells = [];
    const art = document.createElement('div');
    art.className = 'lite-neopixel-art';
    art.style.aspectRatio = `${assetWidth} / ${assetHeight}`;
    const body = document.createElement('img');
    body.alt = '';
    body.draggable = false;
    body.src = assetUrl(this.assetBase, 'neopixel', appearance.bodyAsset || 'body.png');
    art.append(body);
    for (let index = 0; index < count; index += 1) {
      const cell = document.createElement('span');
      cell.className = 'lite-neopixel-cell';
      const center = centers[index];
      applyStyles(cell, {
        left: `${Number(center?.x) / assetWidth * 100}%`,
        top: `${Number(center?.y) / assetHeight * 100}%`,
        width: `${diameter / assetWidth * 100}%`,
      });
      art.append(cell);
      cells.push(cell);
    }
    base.element.append(art);
    return {
      definition,
      element: base.element,
      label: base.label,
      onNeoPixel: (event) => {
        if (Number(event.pin) !== Number(definition.connections?.pin)) return;
        for (let index = 0; index < cells.length; index += 1) {
          const color = event.pixels?.[index] || [0, 0, 0];
          cells[index].style.setProperty('--pixel-color', `rgb(${color[0]}, ${color[1]}, ${color[2]})`);
        }
      },
    };
  }

  handleOutput(event) {
    this.pendingOutput.set(Number(event.pin), event);
  }

  _createOled(definition) {
    const base = this._baseElement(definition, 'lite-oled');
    const appearance = definition.appearance || {};
    const width = Number(appearance.width) || 128;
    const height = Number(appearance.height) || 64;
    const litColor = hexRgb(appearance.litColor);
    const assetSize = appearance.assetSize || { width: 1, height: 1 };
    const screenWindow = appearance.screenWindow || {
      x: 0,
      y: 0,
      width: Number(assetSize.width) || 1,
      height: Number(assetSize.height) || 1,
    };
    const art = document.createElement('div');
    art.className = 'lite-oled-art';
    const body = document.createElement('img');
    body.alt = '';
    body.draggable = false;
    body.src = assetUrl(this.assetBase, 'oled', appearance.bodyAsset || 'body.png');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.setAttribute('aria-label', definition.label || 'OLED 128×64');
    const screenArea = document.createElement('div');
    screenArea.className = 'lite-oled-screen-area';
    const screenSlot = document.createElement('div');
    screenSlot.className = 'lite-oled-screen-slot';
    const screen = document.createElement('div');
    screen.className = 'lite-oled-screen';
    const assetWidth = Math.max(1, Number(assetSize.width) || 1);
    const assetHeight = Math.max(1, Number(assetSize.height) || 1);
    applyStyles(screenArea, {
      left: `${Number(screenWindow.x) / assetWidth * 100}%`,
      top: `${Number(screenWindow.y) / assetHeight * 100}%`,
      width: `${Number(screenWindow.width) / assetWidth * 100}%`,
      height: `${Number(screenWindow.height) / assetHeight * 100}%`,
    });
    screen.append(canvas);
    screenSlot.append(screen);
    screenArea.append(screenSlot);
    art.append(body, screenArea);
    base.element.append(art);
    const layoutCanvas = () => {
      const rect = screenArea.getBoundingClientRect();
      const viewport = integerOledViewport(rect.width, rect.height, width, height);
      const alignedLeft = Math.round(rect.left + viewport.left) - rect.left;
      const alignedTop = Math.round(rect.top + viewport.top) - rect.top;
      applyStyles(screen, {
        left: '0px',
        top: '0px',
        width: `${viewport.width}px`,
        height: `${viewport.height}px`,
      });
      applyStyles(screenSlot, {
        left: `${alignedLeft}px`,
        top: `${alignedTop}px`,
        width: `${viewport.width}px`,
        height: `${viewport.height}px`,
      });
      applyStyles(canvas, {
        left: '0px',
        top: '0px',
        width: `${viewport.width}px`,
        height: `${viewport.height}px`,
      });
    };
    layoutCanvas();
    const resizeObserver = typeof ResizeObserver === 'function'
      ? new ResizeObserver(layoutCanvas)
      : null;
    resizeObserver?.observe(screenArea);
    const context = canvas.getContext('2d');
    const image = context?.createImageData(width, height);
    const render = (event = {}) => {
      if (!context || !image) return;
      const bytes = event.data instanceof ArrayBuffer
        ? new Uint8Array(event.data)
        : new Uint8Array(event.data || width * Math.ceil(height / 8));
      const displayOn = event.displayOn !== false;
      const inverted = !!event.inverted;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const byte = bytes[(y >> 3) * width + x] || 0;
          const bit = ((byte >> (y & 7)) & 1) === 1;
          const lit = displayOn && bit !== inverted;
          const offset = (y * width + x) * 4;
          image.data[offset] = lit ? litColor[0] : 0;
          image.data[offset + 1] = lit ? litColor[1] : 0;
          image.data[offset + 2] = lit ? litColor[2] : 0;
          image.data[offset + 3] = 255;
        }
      }
      context.putImageData(image, 0, 0);
    };
    render({ displayOn: false });
    return {
      definition,
      element: base.element,
      label: base.label,
      onOledFrame: render,
      destroy: () => resizeObserver?.disconnect(),
    };
  }

  _createJoystick(definition) {
    const base = this._baseElement(definition, 'lite-joystick');
    const art = document.createElement('div');
    art.className = 'lite-joystick-art';
    const body = document.createElement('img');
    body.alt = '';
    body.draggable = false;
    body.src = assetUrl(this.assetBase, 'joystick', 'body.png');
    const knob = document.createElement('img');
    knob.alt = '';
    knob.draggable = false;
    knob.className = 'lite-joystick-knob';
    knob.src = assetUrl(this.assetBase, 'joystick', 'moving.png');
    const state = this._stateElement(base);
    const press = document.createElement('button');
    press.type = 'button';
    press.className = 'lite-joystick-button';
    press.textContent = this._label('press', 'Stisk');
    art.append(body, knob);
    base.element.append(art, press);

    const xPin = Number(definition.connections?.xPin);
    const yPin = Number(definition.connections?.yPin);
    const buttonPin = Number(definition.connections?.buttonPin);
    let activePointer = null;
    let pointerVector = null;
    let pointerPressed = false;
    let keyboardVector = { x: 0, y: 0 };
    let keyboardPressed = false;
    const writeVector = (vector) => {
      const xValue = Math.round((vector.x + 1) * 65535 / 2);
      const yValue = Math.round((1 - vector.y) * 65535 / 2);
      knob.style.left = `${50 + vector.x * 11}%`;
      knob.style.top = `${47 + vector.y * 11}%`;
      const xPercent = Math.round(xValue * 100 / 65535);
      const yPercent = Math.round(yValue * 100 / 65535);
      state.value = `X ${xPercent}% · Y ${yPercent}%`;
      this.setAdc(xPin, xValue);
      this.setAdc(yPin, yValue);
    };
    const renderVector = () => writeVector(pointerVector || keyboardVector);
    const updatePointer = (event) => {
      const rect = art.getBoundingClientRect();
      const radius = Math.max(1, Math.min(rect.width, rect.height) * 0.3);
      pointerVector = joystickVector(
        (event.clientX - (rect.left + rect.width / 2)) / radius,
        (event.clientY - (rect.top + rect.height * 0.47)) / radius,
      );
      renderVector();
    };
    const startDrag = (event) => {
      if (event.button !== 0 && event.pointerType !== 'touch') return;
      event.preventDefault();
      activePointer = event.pointerId;
      art.setPointerCapture?.(event.pointerId);
      art.classList.add('is-dragging');
      updatePointer(event);
    };
    const moveDrag = (event) => {
      if (event.pointerId !== activePointer) return;
      event.preventDefault();
      updatePointer(event);
    };
    const endDrag = (event) => {
      if (event.pointerId !== activePointer) return;
      activePointer = null;
      pointerVector = null;
      art.classList.remove('is-dragging');
      renderVector();
    };
    art.addEventListener('pointerdown', startDrag);
    art.addEventListener('pointermove', moveDrag);
    art.addEventListener('pointerup', endDrag);
    art.addEventListener('pointercancel', endDrag);
    art.addEventListener('lostpointercapture', endDrag);

    const writeButton = (pressed) => {
      this.setDigital(buttonPin, pressed ? 0 : 1);
      press.classList.toggle('is-pressed', pressed);
    };
    const renderButton = () => writeButton(pointerPressed || keyboardPressed);
    press.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      press.setPointerCapture?.(event.pointerId);
      pointerPressed = true;
      renderButton();
    });
    const releaseButton = () => {
      pointerPressed = false;
      renderButton();
    };
    press.addEventListener('pointerup', releaseButton);
    press.addEventListener('pointercancel', releaseButton);
    press.addEventListener('lostpointercapture', releaseButton);

    return {
      definition,
      element: base.element,
      label: base.label,
      pressButton: press,
      setKeyboardState: (keyboard = {}) => {
        keyboardVector = {
          x: clamp(Number(keyboard.x) || 0, -1, 1),
          y: clamp(Number(keyboard.y) || 0, -1, 1),
        };
        keyboardPressed = !!keyboard.pressed;
        if (pointerVector === null) renderVector();
        renderButton();
      },
      initialiseInput: () => {
        activePointer = null;
        pointerVector = null;
        pointerPressed = false;
        keyboardVector = { x: 0, y: 0 };
        keyboardPressed = false;
        art.classList.remove('is-dragging');
        renderVector();
        renderButton();
      },
    };
  }

  _createDht22(definition) {
    const base = this._baseElement(definition, 'lite-dht22');
    const body = document.createElement('img');
    body.alt = '';
    body.draggable = false;
    body.src = assetUrl(this.assetBase, 'dht22', 'body.png');
    const controls = document.createElement('div');
    controls.className = 'lite-dht22-controls';
    const temperature = document.createElement('input');
    temperature.type = 'range';
    temperature.min = '-40';
    temperature.max = '80';
    temperature.step = '0.1';
    temperature.value = String(definition.appearance?.initialTemperature ?? 22);
    const temperatureLabel = document.createElement('label');
    const temperatureText = document.createElement('span');
    const humidity = document.createElement('input');
    humidity.type = 'range';
    humidity.min = '0';
    humidity.max = '100';
    humidity.step = '0.1';
    humidity.value = String(definition.appearance?.initialHumidity ?? 50);
    const humidityLabel = document.createElement('label');
    const humidityText = document.createElement('span');
    const value = document.createElement('output');
    temperatureLabel.append(temperatureText, temperature);
    humidityLabel.append(humidityText, humidity);
    controls.append(temperatureLabel, humidityLabel, value);
    base.element.append(body, controls);
    const updateLabel = () => {
      base.label.textContent = this._componentLabel(definition);
      temperatureText.textContent = this._label('temperature', 'Teplota');
      humidityText.textContent = this._label('humidity', 'Vlhkost');
      temperature.setAttribute('aria-label', temperatureText.textContent);
      humidity.setAttribute('aria-label', humidityText.textContent);
    };
    const update = () => {
      const temperatureValue = Number(temperature.value);
      const humidityValue = Number(humidity.value);
      value.value = `${temperatureValue.toFixed(1)} °C · ${humidityValue.toFixed(1)} %`;
      this.setDht(Number(definition.connections?.pin), temperatureValue, humidityValue);
    };
    temperature.addEventListener('input', update);
    humidity.addEventListener('input', update);
    updateLabel();
    return {
      definition,
      element: base.element,
      label: base.label,
      initialiseInput: update,
      updateLabel,
    };
  }

  handleNeoPixel(event) {
    this.pendingNeoPixel.set(Number(event.pin), event);
  }

  handleOledFrame(event) {
    if (event?.componentId) this.pendingOledFrames.set(event.componentId, event);
  }

  _tick() {
    const now = performance.now();
    const elapsed = Math.min(100, Math.max(0, now - this.lastFrame));
    this.lastFrame = now;
    for (const event of this.pendingOutput.values()) {
      for (const component of this.byPin.get(Number(event.pin)) || []) component.onOutput?.(event);
    }
    for (const event of this.pendingNeoPixel.values()) {
      for (const component of this.byPin.get(Number(event.pin)) || []) component.onNeoPixel?.(event);
    }
    for (const [componentId, event] of this.pendingOledFrames) {
      this.byId.get(componentId)?.onOledFrame?.(event);
    }
    this.pendingOutput.clear();
    this.pendingNeoPixel.clear();
    this.pendingOledFrames.clear();
    for (const component of this.components) component.tick?.(elapsed);
    this.frame = requestAnimationFrame(() => this._tick());
  }

  suspend() {
    if (!this.frame) return;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  resume() {
    if (this.frame) return;
    this.lastFrame = performance.now();
    this.frame = requestAnimationFrame(() => this._tick());
  }

  destroy() {
    this.suspend();
    for (const component of this.components) {
      component.destroy?.();
      if (component.timer) clearTimeout(component.timer);
    }
    this.pendingOutput.clear();
    this.pendingNeoPixel.clear();
    this.pendingOledFrames.clear();
    this.byId.clear();
    this.root.replaceChildren();
  }
}
