const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('activity', {
  onUpdate: (cb) => {
    ipcRenderer.on('activity:update', (_e, session) => cb(session));
  },
  openMain: () => ipcRenderer.invoke('activity:open-main'),
  closePanel: () => ipcRenderer.invoke('activity:close-panel'),
  quitApp: () => ipcRenderer.invoke('activity:quit'),
  copyText: (text) => ipcRenderer.invoke('activity:copy', text),
  selectInstance: (id) => ipcRenderer.invoke('activity:select-instance', id),
  killInstance: (id) => ipcRenderer.invoke('activity:kill-instance', id)
});
