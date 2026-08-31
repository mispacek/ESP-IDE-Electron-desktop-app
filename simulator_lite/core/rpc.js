const DEFAULT_TIMEOUTS = Object.freeze({
  run: 5_000,
  exec: 10_000,
  repl: 10_000,
  stop: 3_000,
  'prepare-frame-restart': 2_000,
  restart: 20_000,
  'factory-reset-filesystem': 20_000,
  'preview-oled-frame': 3_000,
  'write-file': 15_000,
  'read-file': 10_000,
  'list-files': 5_000,
  'set-digital': 3_000,
  'set-adc': 3_000,
  default: 10_000,
});

export function rpcError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

/** Small transport-agnostic lifecycle for request/response RPC. */
export class RpcClient {
  constructor({ send, timeouts = DEFAULT_TIMEOUTS } = {}) {
    if (typeof send !== 'function') throw new TypeError('RpcClient vyžaduje funkci send.');
    this.send = send;
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...timeouts };
    this.pending = new Map();
    this.requestId = 0;
  }

  request(type, payload = {}, transfer = []) {
    const requestId = ++this.requestId;
    const timeout = Number(this.timeouts[type] ?? this.timeouts.default);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._settle(requestId, rpcError('RPC_TIMEOUT', `Požadavek ${type} neodpověděl včas.`), false);
      }, timeout);
      this.pending.set(requestId, { resolve, reject, timer, type });
      try {
        this.send({ type, requestId, ...payload }, transfer);
      } catch (error) {
        this._settle(requestId, error, false);
      }
    });
  }

  resolve(message) {
    if (message?.requestId == null) return false;
    if (!this.pending.has(message.requestId)) return false;
    if (message.ok === false) {
      this._settle(message.requestId, rpcError('RPC_REMOTE_ERROR', message.error || 'Vzdálený požadavek selhal.'), false);
    } else {
      this._settle(message.requestId, message, true);
    }
    return true;
  }

  reject(requestId, error) {
    return this._settle(requestId, error, false);
  }

  rejectAll(error) {
    const entries = [...this.pending.keys()];
    for (const requestId of entries) this._settle(requestId, error, false);
  }

  _settle(requestId, value, fulfilled) {
    const request = this.pending.get(requestId);
    if (!request) return false;
    this.pending.delete(requestId);
    clearTimeout(request.timer);
    if (fulfilled) request.resolve(value);
    else request.reject(value instanceof Error ? value : new Error(String(value)));
    return true;
  }

  get size() {
    return this.pending.size;
  }
}

export { DEFAULT_TIMEOUTS };
