'use strict';

function collectLocalStorage(storage) {
  const values = {};
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key !== null) values[key] = storage.getItem(key);
  }
  return values;
}

module.exports = { collectLocalStorage };

if (process.type === 'renderer') {
  const { ipcRenderer } = require('electron');
  try {
    // Preloads run before document scripts. Export immediately so the hidden
    // legacy window can be destroyed before the old application boots.
    ipcRenderer.send('espide:legacy-storage-export', collectLocalStorage(window.localStorage));
  } catch (_) {
    // A failed legacy read is intentionally non-fatal; the normal app still starts.
  }
}
