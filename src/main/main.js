'use strict';

const path = require('path');
const { app, BrowserWindow, Menu, shell } = require('electron');

if (app.isPackaged) process.env.APP_PACKAGED = '1';

const isDev = !app.isPackaged;
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: '#1b1d22',
    show: false,
    autoHideMenuBar: true,
    title: '格式转换工具',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());

  // printToPDF 用的常驻隐藏窗口需一并销毁，否则会阻止应用退出
  mainWindow.on('closed', () => {
    try { require('./util/htmlpdf').dispose(); } catch {}
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('console-message', (e) => {
    if (isDev) console.log(`[renderer:${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`);
  });

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    require('./ipc').register();
    createWindow();
    require('./updater').init();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

module.exports = { getMainWindow: () => mainWindow };
