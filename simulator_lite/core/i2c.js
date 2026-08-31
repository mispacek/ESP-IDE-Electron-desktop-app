function asPinNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : -1;
}

function asBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array(value || []);
}

export function i2cBusKey(id = -1, scl = -1, sda = -1) {
  const busId = Number(id);
  if (Number.isInteger(busId) && busId >= 0) return `id:${busId}`;
  return `soft:${asPinNumber(scl)}:${asPinNumber(sda)}`;
}

export class SSD1306Model {
  constructor({
    id = 'oled-ssd1306',
    address = 0x3c,
    width = 128,
    height = 64,
    onFrame = () => {},
  } = {}) {
    this.id = id;
    this.address = Number(address);
    this.width = Number(width);
    this.height = Number(height);
    this.pages = Math.ceil(this.height / 8);
    this.buffer = new Uint8Array(this.width * this.pages);
    this.onFrame = onFrame;
    this.page = 0;
    this.column = 0;
    this.displayOn = false;
    this.inverted = false;
    this.dirty = true;
  }

  _emit() {
    this.onFrame({
      componentId: this.id,
      width: this.width,
      height: this.height,
      displayOn: this.displayOn,
      inverted: this.inverted,
      data: this.buffer.slice(),
    });
    this.dirty = false;
  }

  flush() {
    if (this.dirty) this._emit();
  }

  _command(command) {
    const value = Number(command) & 0xff;
    if (value >= 0xb0 && value <= 0xb7) this.page = Math.min(this.pages - 1, value - 0xb0);
    else if (value <= 0x0f) this.column = (this.column & 0xf0) | value;
    else if (value >= 0x10 && value <= 0x1f) this.column = (this.column & 0x0f) | ((value & 0x0f) << 4);
    else if (value === 0xae || value === 0xaf) {
      this.displayOn = value === 0xaf;
      this.dirty = true;
    } else if (value === 0xa6 || value === 0xa7) {
      this.inverted = value === 0xa7;
      this.dirty = true;
    }
  }

  write(value) {
    const bytes = asBytes(value);
    if (!bytes.byteLength) return 0;
    const control = bytes[0];
    if (control === 0x40) {
      for (let index = 1; index < bytes.byteLength; index += 1) {
        if (this.page < this.pages && this.column < this.width) {
          this.buffer[this.page * this.width + this.column] = bytes[index];
        }
        this.column += 1;
      }
      this.dirty = true;
    } else if (control === 0x80) {
      if (bytes.byteLength > 1) this._command(bytes[1]);
    } else if (control === 0x00) {
      for (let index = 1; index < bytes.byteLength; index += 1) this._command(bytes[index]);
    }
    return bytes.byteLength;
  }

  read(length) {
    return new Uint8Array(Math.max(0, Number(length) || 0));
  }
}

export class I2cRegistry {
  constructor({ onFrame = () => {} } = {}) {
    this.onFrame = onFrame;
    this.buses = new Map();
  }

  clear() {
    this.buses.clear();
  }

  flush() {
    const flushed = new Set();
    for (const devices of this.buses.values()) {
      for (const device of devices.values()) {
        if (flushed.has(device)) continue;
        flushed.add(device);
        device.flush?.();
      }
    }
  }

  initialise(id, scl, sda) {
    const key = i2cBusKey(id, scl, sda);
    if (!this.buses.has(key)) this.buses.set(key, new Map());
    return key;
  }

  register(key, address, device) {
    if (!this.buses.has(key)) this.buses.set(key, new Map());
    this.buses.get(key).set(Number(address), device);
    return device;
  }

  configure(definitions = []) {
    this.clear();
    for (const definition of definitions) {
      if (definition?.type !== 'oled-ssd1306') continue;
      const connections = definition.connections || {};
      const appearance = definition.appearance || {};
      const busIds = Array.isArray(appearance.busIds)
        ? appearance.busIds
        : [appearance.busId ?? -1];
      const device = new SSD1306Model({
        id: definition.id,
        address: appearance.address ?? 0x3c,
        width: appearance.width ?? 128,
        height: appearance.height ?? 64,
        onFrame: this.onFrame,
      });
      for (const busId of busIds) {
        const key = this.initialise(busId, connections.scl, connections.sda);
        this.register(key, device.address, device);
      }
    }
  }

  scan(key) {
    return [...(this.buses.get(String(key))?.keys() || [])].sort((first, second) => first - second);
  }

  _device(key, address) {
    const device = this.buses.get(String(key))?.get(Number(address));
    if (!device) throw new Error(`I2C zařízení 0x${Number(address).toString(16)} na ${key} neodpovídá.`);
    return device;
  }

  writeto(key, address, value) {
    return this._device(key, address).write(asBytes(value));
  }

  readfrom(key, address, length) {
    return this._device(key, address).read(length);
  }

  writetoMem(key, address, memoryAddress, value, addressSize = 8) {
    const bytes = asBytes(value);
    const prefixLength = Math.max(1, Math.ceil((Number(addressSize) || 8) / 8));
    const packet = new Uint8Array(prefixLength + bytes.byteLength);
    for (let index = 0; index < prefixLength; index += 1) {
      packet[prefixLength - index - 1] = (Number(memoryAddress) >> (index * 8)) & 0xff;
    }
    packet.set(bytes, prefixLength);
    return this.writeto(key, address, packet);
  }

  readfromMem(key, address, memoryAddress, length, addressSize = 8) {
    this.writetoMem(key, address, memoryAddress, new Uint8Array(), addressSize);
    return this.readfrom(key, address, length);
  }
}
