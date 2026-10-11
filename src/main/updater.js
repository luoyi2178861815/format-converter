'use strict';

const { app, BrowserWindow } = require('electron');

let autoUpdater = null;
let lastState = { state: 'idle' };

function broadcast(payload) {
  lastState = payload;
  for (const w of BrowserWindow.getAllWindows()) {
    try { w.webContents.send('update:event', payload); } catch {}
  }
}

function status() {
  return lastState;
}

/** 应用就绪后调用一次。dev 与 portable 版都不参与更新。 */
function init() {
  if (!app.isPackaged) {
    lastState = { state: 'dev' };
    return;
  }
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    lastState = { state: 'unsupported', reason: 'portable' };
    return;
  }

  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch (err) {
    lastState = { state: 'error', message: `更新组件不可用：${err.message}` };
    return;
  }

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('checking-for-update', () => broadcast({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => broadcast({ state: 'available', version: info && info.version }));
  autoUpdater.on('update-not-available', () => broadcast({ state: 'none' }));
  autoUpdater.on('download-progress', (p) => broadcast({ state: 'downloading', percent: p && p.percent }));
  autoUpdater.on('update-downloaded', (info) => broadcast({ state: 'downloaded', version: info && info.version }));
  autoUpdater.on('error', (err) => broadcast({ state: 'error', message: (err && err.message) || String(err) }));

  setTimeout(() => { check(); }, 8000);
}

async function check() {
  if (!autoUpdater) return status();
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    broadcast({ state: 'error', message: err.message });
  }
  return status();
}

async function download() {
  if (!autoUpdater) return status();
  try {
    await autoUpdater.downloadUpdate();
  } catch (err) {
    broadcast({ state: 'error', message: err.message });
  }
  return status();
}

function install({ converting } = {}) {
  if (!autoUpdater) return { ok: false, error: '更新组件不可用' };
  if (lastState.state !== 'downloaded') return { ok: false, error: '还没有可安装的更新' };
  if (converting) return { ok: false, error: '有转换任务正在进行，请等待完成后再安装' };
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return { ok: true };
}

module.exports = { init, check, download, install, status, _broadcast: broadcast };
