const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('btPicker', {
  onDevices: (cb) => ipcRenderer.on('ble-devices', (_e, list) => cb(list)),
  choose: (id) => ipcRenderer.send('ble-picker-choose', id),
  cancel: () => ipcRenderer.send('ble-picker-cancel')
});