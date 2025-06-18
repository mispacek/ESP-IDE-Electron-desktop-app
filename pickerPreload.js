// pickerPreload.js  (v main process: contextIsolation=true)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('picker', {
  onPorts:  cb => ipcRenderer.on('ports', (_e, ports) => cb(ports)),
  choose:   id => ipcRenderer.send('port-chosen', id)
});
