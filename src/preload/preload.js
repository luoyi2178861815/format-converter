'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

function on(channel, cb) {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('api', {
  info: () => ipcRenderer.invoke('app:info'),

  detectTools: () => ipcRenderer.invoke('tools:detect'),
  installTool: (id) => ipcRenderer.invoke('tools:install', id),
  cancelInstall: () => ipcRenderer.invoke('tools:installCancel'),
  pathStatus: (id) => ipcRenderer.invoke('tools:pathStatus', id),
  addToPath: (id) => ipcRenderer.invoke('tools:addToPath', id),
  removeFromPath: (id) => ipcRenderer.invoke('tools:removeFromPath', id),
  onToolProgress: (cb) => on('tools:progress', cb),

  capabilities: (ext) => ipcRenderer.invoke('convert:capabilities', ext),
  startConvert: (payload) => ipcRenderer.invoke('convert:start', payload),
  cancelConvert: () => ipcRenderer.invoke('convert:cancel'),
  onConvertEvent: (cb) => on('convert:event', cb),

  hwEncoders: () => ipcRenderer.invoke('media:hwencoders'),
  presetsList: () => ipcRenderer.invoke('presets:list'),
  presetsSave: (payload) => ipcRenderer.invoke('presets:save', payload),
  presetsRemove: (id) => ipcRenderer.invoke('presets:remove', id),

  updateStatus: () => ipcRenderer.invoke('update:status'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateDownload: () => ipcRenderer.invoke('update:download'),
  updateInstall: (payload) => ipcRenderer.invoke('update:install', payload),
  onUpdateEvent: (cb) => on('update:event', cb),

  historyList: () => ipcRenderer.invoke('history:list'),
  historyRemove: (id) => ipcRenderer.invoke('history:remove', id),
  historyClear: () => ipcRenderer.invoke('history:clear'),
  historyTrashOutput: (id) => ipcRenderer.invoke('history:trashOutput', id),
  historyReconvert: (id) => ipcRenderer.invoke('history:reconvert', id),

  pickFiles: () => ipcRenderer.invoke('dialog:pickFiles'),
  pickDir: () => ipcRenderer.invoke('dialog:pickDir'),
  statInfo: (paths) => ipcRenderer.invoke('path:statInfo', paths),
  clipboardReadInputs: () => ipcRenderer.invoke('clipboard:readInputs'),
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return null; }
  },
  showItem: (p) => ipcRenderer.invoke('shell:showItem', p),
  openPath: (p) => ipcRenderer.invoke('shell:openPath', p),
});
