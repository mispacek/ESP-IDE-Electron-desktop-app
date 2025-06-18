// --- preload.js -------------------------------------------------------
const { contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('webSerialOK', true);

contextBridge.exposeInMainWorld('webSerialAPI', {
  getPorts:  ()            => navigator.serial.getPorts(),
  requestPort: (filters)   => navigator.serial.requestPort(filters)
});
