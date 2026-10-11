'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

/**
 * 外部工具(ffmpeg / libreoffice)的存放根目录。
 * 固定在 %LOCALAPPDATA%\FormatConverter\tools：
 * - 与安装位置无关，移动应用/项目目录也不失效
 * - 用户级可写，免管理员
 * - 不随漫游配置同步，避免大文件塞进 Roaming
 */
function toolsRoot() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'FormatConverter', 'tools');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function defaultOutputDir() {
  try {
    const { app } = require('electron');
    return app.getPath('downloads');
  } catch {
    return os.homedir();
  }
}

module.exports = { toolsRoot, ensureDir, defaultOutputDir };
