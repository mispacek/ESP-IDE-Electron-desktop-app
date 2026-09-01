'use strict';

const path = require('node:path');

function createRuntimePaths({ app, mainDirectory, resourcesPath }) {
  if (!app || typeof app.isPackaged !== 'boolean') throw new TypeError('Electron app is required.');
  if (!mainDirectory) throw new TypeError('mainDirectory is required.');

  const projectRoot = path.resolve(mainDirectory, '..', '..');
  const appRoot = app.isPackaged ? app.getAppPath() : projectRoot;
  const runtimeRoot = app.isPackaged ? resourcesPath : projectRoot;
  const electronRoot = path.join(appRoot, 'electron');
  const preloadRoot = path.join(electronRoot, 'preload');
  const pickerRoot = path.join(electronRoot, 'ui', 'pickers');
  const splashRoot = path.join(electronRoot, 'ui', 'splash');

  return Object.freeze({
    appIcon: path.join(splashRoot, 'icon.png'),
    appRoot,
    bluetoothPickerHtml: path.join(pickerRoot, 'bluetooth.html'),
    bluetoothPickerPreload: path.join(preloadRoot, 'bluetooth-picker-preload.js'),
    electronRoot,
    ideRoot: path.join(runtimeRoot, 'esp_ide_v2'),
    legacyIndex: app.isPackaged
      ? path.join(appRoot, 'index.html')
      : path.join(electronRoot, 'migration', 'index.html'),
    legacyStoragePreload: path.join(preloadRoot, 'legacy-storage-preload.js'),
    mainPreload: path.join(preloadRoot, 'main-preload.js'),
    projectRoot,
    runtimeRoot,
    simulatorRoot: path.join(runtimeRoot, 'simulator_lite'),
    splashHtml: path.join(splashRoot, 'index.html'),
    usbPickerHtml: path.join(pickerRoot, 'usb.html'),
    usbPickerPreload: path.join(preloadRoot, 'usb-picker-preload.js'),
  });
}

module.exports = { createRuntimePaths };
