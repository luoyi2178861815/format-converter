'use strict';

const path = require('path');
const { toolsRoot } = require('../util/paths');

/**
 * 外部工具注册表（插件式）。
 * 每个工具声明：如何探测、安装后落在哪、如何读取版本、常见安装路径。
 */
const TOOLS = {
  ffmpeg: {
    id: 'ffmpeg',
    label: 'FFmpeg',
    description: '音视频转换引擎（ffmpeg + ffprobe）',
    exe: 'ffmpeg.exe',
    // 需要一并存在才算可用的可执行文件
    requires: ['ffmpeg.exe', 'ffprobe.exe'],
    // 应用管理安装后的 bin 目录（相对 toolsRoot）
    managedBinDir: path.join('ffmpeg', 'bin'),
    versionArgs: ['-version'],
    versionRegex: /ffmpeg version (\S+)/i,
    commonDirs: [
      'C:\\ffmpeg\\bin',
      'C:\\Program Files\\ffmpeg\\bin',
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft\\WinGet\\Links'),
      path.join(process.env.USERPROFILE || '', 'scoop\\shims'),
      path.join(process.env.ProgramData || '', 'chocolatey\\bin'),
    ],
    install: {
      kind: 'zip',
      // 会解压出一个 bin 目录（含 ffmpeg.exe / ffprobe.exe）
      source: 'btbn',
      sizeHint: '约 80–110 MB',
    },
  },

  soffice: {
    id: 'soffice',
    label: 'LibreOffice',
    description: '办公文档转换内核',
    exe: 'soffice.exe',
    // Windows 上 soffice.exe 会脱离控制台，soffice.com 才能捕获输出，用它来运行
    runExe: 'soffice.com',
    requires: ['soffice.exe'],
    managedBinDir: path.join('libreoffice', 'program'),
    versionArgs: ['--version'],
    versionRegex: /LibreOffice\s+([\d.]+)/i,
    commonDirs: [
      'C:\\Program Files\\LibreOffice\\program',
      'C:\\Program Files (x86)\\LibreOffice\\program',
    ],
    install: {
      kind: 'msi',
      source: 'tdf',
      // msi 中 soffice.exe 所在子路径
      msiProgramSubPath: path.join('program'),
      sizeHint: '约 350 MB',
    },
  },
};

function managedBinDir(tool) {
  return path.join(toolsRoot(), tool.managedBinDir);
}

function managedExePath(tool) {
  return path.join(managedBinDir(tool), tool.exe);
}

module.exports = { TOOLS, managedBinDir, managedExePath };
