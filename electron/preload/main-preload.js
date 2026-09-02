// --- preload.js -------------------------------------------------------
'use strict';

function importLegacyStorageIfEmpty(storage, values) {
  if (!values || typeof values !== 'object' || storage.length !== 0) {
    return { success: true, imported: false, existing: storage.length !== 0 };
  }
  try {
    for (const [key, value] of Object.entries(values)) {
      if (typeof value === 'string') storage.setItem(key, value);
    }
    return { success: true, imported: true, existing: false };
  } catch (_) {
    return { success: false, imported: false, existing: false };
  }
}

function seedDefaultLanguage(storage) {
  let settings = {};
  try {
    const raw = storage.getItem('userSettings');
    const parsed = raw ? JSON.parse(raw) : {};
    settings = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {}
  const language = typeof settings.language === 'string' ? settings.language.trim() : '';
  // Electron owns only the missing-value default. Any language selected by
  // the shared web app, including a future locale, must remain persistent.
  if (language) return { changed: false, language };
  settings.language = 'en';
  try {
    storage.setItem('userSettings', JSON.stringify(settings));
    return { changed: true, language: 'en' };
  } catch (_) {
    return { changed: false, language: 'en' };
  }
}

function delegateFirmwareInstallerSerial(documentObject) {
  const frame = documentObject && documentObject.getElementById('fw_install_frame');
  if (!frame) return false;
  // Permissions Policy has two layers for cross-origin frames: the parent
  // response header and the iframe container policy. Keep the delegation
  // limited to the two trusted firmware origins.
  frame.setAttribute('allow', 'serial https://espide.eu https://www.espide.eu');
  return true;
}

module.exports = { delegateFirmwareInstallerSerial, importLegacyStorageIfEmpty, seedDefaultLanguage };

if (process.type === 'renderer') {
  const { contextBridge, ipcRenderer } = require('electron');

  // This runs before the document's scripts, so the shared web build sees the
  // migrated storage and Electron-only default language from its first read.
  let migration = { success: false, imported: false, existing: false };
  try {
    const legacyValues = ipcRenderer.sendSync('espide:legacy-storage-read');
    migration = importLegacyStorageIfEmpty(window.localStorage, legacyValues);
    seedDefaultLanguage(window.localStorage);
  } catch (_) {
    try { seedDefaultLanguage(window.localStorage); } catch (_) {}
  }
  if (migration.success) ipcRenderer.send('espide:legacy-storage-confirmed', migration);

  const installSerialDelegation = () => delegateFirmwareInstallerSerial(window.document);
  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', installSerialDelegation, { once: true });
  } else {
    installSerialDelegation();
  }

  contextBridge.exposeInMainWorld('webSerialOK', true);

  // Let the shared web UI disable integrations that must not run in the
  // packaged desktop application (for example Google Analytics).
  contextBridge.exposeInMainWorld('espideEnvironment', {
    runtime: 'electron',
  });

  contextBridge.exposeInMainWorld('webSerialAPI', {
    getPorts:  ()            => navigator.serial.getPorts(),
    requestPort: (filters)   => navigator.serial.requestPort(filters)
  });
}
