import { cloneOverlay, emptyOverlay, normaliseOverlay } from '../runtime/fs-overlay.js';

const DATABASE_NAME = 'esp-ide-simulator-lite';
const DATABASE_VERSION = 1;
const STORE_NAME = 'filesystem-overlays';

function requestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB požadavek selhal.'));
  });
}

function transactionPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transakce selhala.'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transakce byla zrušena.'));
  });
}

export class IndexedDbOverlayStore {
  constructor({
    indexedDB = globalThis.indexedDB,
    key = 'default',
    databaseName = DATABASE_NAME,
  } = {}) {
    this.indexedDB = indexedDB || null;
    this.key = String(key || 'default');
    this.databaseName = databaseName;
    this.databasePromise = null;
    this.writeChain = Promise.resolve();
  }

  get available() {
    return !!this.indexedDB;
  }

  async _open() {
    if (!this.available) return null;
    if (!this.databasePromise) {
      this.databasePromise = new Promise((resolve, reject) => {
        const request = this.indexedDB.open(this.databaseName, DATABASE_VERSION);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(STORE_NAME)) {
            request.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('IndexedDB nelze otevřít.'));
        request.onblocked = () => reject(new Error('IndexedDB upgrade je blokovaný jinou kartou.'));
      });
    }
    return this.databasePromise;
  }

  async load() {
    const database = await this._open();
    if (!database) return emptyOverlay();
    await this.flush();
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const completion = transactionPromise(transaction);
    const record = await requestPromise(transaction.objectStore(STORE_NAME).get(this.key));
    await completion;
    return record ? normaliseOverlay(record.overlay) : emptyOverlay();
  }

  save(value) {
    const overlay = cloneOverlay(value);
    this.writeChain = this.writeChain.catch(() => {}).then(async () => {
      const database = await this._open();
      if (!database) return;
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const completion = transactionPromise(transaction);
      transaction.objectStore(STORE_NAME).put({ key: this.key, overlay, updatedAt: Date.now() });
      await completion;
    });
    return this.writeChain;
  }

  clear() {
    this.writeChain = this.writeChain.catch(() => {}).then(async () => {
      const database = await this._open();
      if (!database) return;
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const completion = transactionPromise(transaction);
      transaction.objectStore(STORE_NAME).delete(this.key);
      await completion;
    });
    return this.writeChain;
  }

  flush() {
    return this.writeChain;
  }

  async close() {
    await this.flush().catch(() => {});
    const database = await this.databasePromise?.catch(() => null);
    database?.close();
    this.databasePromise = null;
  }
}
