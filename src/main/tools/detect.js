'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { TOOLS, managedBinDir } = require('./registry');

function fileExists(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** 目录是否包含该工具所需的全部可执行文件 */
function dirIsComplete(tool, dir) {
  return tool.requires.every((f) => fileExists(path.join(dir, f)));
}

function readVersion(tool, exePath) {
  try {
    const out = execFileSync(exePath, tool.versionArgs, {
      encoding: 'utf8',
      timeout: 20000,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const m = out.match(tool.versionRegex);
    return m ? m[1] : out.split('\n')[0].trim().slice(0, 40);
  } catch (e) {
    // soffice --version 有时写到 stderr；尝试合并输出
    const text = `${e.stdout || ''}\n${e.stderr || ''}`;
    const m = text.match(tool.versionRegex);
    return m ? m[1] : null;
  }
}

/** 在 PATH 中查找目录 */
function pathDirs() {
  return (process.env.PATH || '')
    .split(path.delimiter)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 探测单个工具。顺序：应用管理目录 -> PATH -> 常见安装路径
 * @returns {{id:string,label:string,found:boolean,binDir:string|null,exePath:string|null,version:string|null,source:string|null}}
 */
function detectTool(tool) {
  const candidates = [];

  const managed = managedBinDir(tool);
  if (dirIsComplete(tool, managed)) {
    candidates.push({ dir: managed, source: 'app' });
  }

  for (const d of pathDirs()) {
    if (dirIsComplete(tool, d)) {
      candidates.push({ dir: d, source: 'path' });
      break;
    }
  }

  for (const d of tool.commonDirs) {
    if (d && dirIsComplete(tool, d)) {
      candidates.push({ dir: d, source: 'common' });
      break;
    }
  }

  if (candidates.length === 0) {
    return {
      id: tool.id,
      label: tool.label,
      description: tool.description,
      found: false,
      binDir: null,
      exePath: null,
      version: null,
      source: null,
    };
  }

  const best = candidates[0];
  // 优先用可捕获输出的运行入口（如 soffice.com），否则用主 exe
  let exePath = path.join(best.dir, tool.exe);
  if (tool.runExe) {
    const runPath = path.join(best.dir, tool.runExe);
    if (fileExists(runPath)) exePath = runPath;
  }
  return {
    id: tool.id,
    label: tool.label,
    description: tool.description,
    found: true,
    binDir: best.dir,
    exePath,
    version: readVersion(tool, exePath),
    source: best.source,
  };
}

function detectAll() {
  return Object.values(TOOLS).map(detectTool);
}

module.exports = { detectTool, detectAll, fileExists };
