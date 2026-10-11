'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { net } = require('electron');

const { toolsRoot, ensureDir } = require('../util/paths');
const { TOOLS, managedBinDir } = require('./registry');

// -------------------- 官方下载源 --------------------
const FFMPEG_URL =
  'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';

/** GET 文本（走 Electron net，自动遵循系统代理） */
function httpGetText(url) {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, redirect: 'follow' });
    request.on('response', (res) => {
      let body = '';
      res.on('data', (c) => (body += c.toString()));
      res.on('end', () => resolve({ status: res.statusCode, body }));
      res.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  });
}

async function resolveLatestLibreOffice() {
  const index = 'https://download.documentfoundation.org/libreoffice/stable/';
  const { body: html } = await httpGetText(index);
  const vers = [...html.matchAll(/href="(\d+\.\d+\.\d+)\/"/g)].map((m) => m[1]);
  if (!vers.length) throw new Error('无法获取 LibreOffice 版本列表');
  vers.sort((a, b) => {
    const A = a.split('.').map(Number);
    const B = b.split('.').map(Number);
    for (let i = 0; i < 3; i++) if (A[i] !== B[i]) return B[i] - A[i];
    return 0;
  });
  const ver = vers[0];
  return {
    version: ver,
    url: `${index}${ver}/win/x86_64/LibreOffice_${ver}_Win_x86-64.msi`,
    filename: `LibreOffice_${ver}_Win_x86-64.msi`,
  };
}

// -------------------- 下载（走 Electron net，自动遵循系统代理） --------------------
function download(url, dest, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const request = net.request({ url, redirect: 'follow' });
    const file = fs.createWriteStream(dest);
    let received = 0;
    let total = 0;
    let done = false;

    const cleanup = () => {
      try { file.close(); } catch {}
    };
    if (signal) {
      signal.addEventListener('abort', () => {
        if (done) return;
        try { request.abort(); } catch {}
        cleanup();
        fs.rm(dest, { force: true }, () => {});
        reject(new Error('已取消'));
      }, { once: true });
    }

    request.on('response', (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400) {
        // net 已跟随重定向；若仍收到 3xx 视为失败
      } else if (response.statusCode !== 200) {
        cleanup();
        return reject(new Error(`下载失败 HTTP ${response.statusCode}`));
      }
      total = Number(response.headers['content-length'] || 0);
      response.on('data', (chunk) => {
        received += chunk.length;
        file.write(chunk);
        if (onProgress) onProgress(total ? received / total : null, received, total);
      });
      response.on('end', () => {
        done = true;
        file.end(() => resolve({ dest, size: received }));
      });
      response.on('error', (e) => { cleanup(); reject(e); });
    });
    request.on('error', (e) => { cleanup(); reject(e); });
    request.end();
  });
}

// -------------------- 解包 --------------------
function findFile(root, name, depth = 0) {
  if (depth > 6) return null;
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    const p = path.join(root, e.name);
    if (e.isFile() && e.name.toLowerCase() === name.toLowerCase()) return p;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      const found = findFile(path.join(root, e.name), name, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

async function extractFfmpeg(zipPath, log) {
  const extractZip = require('extract-zip');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fc_ff_'));
  log('解压 FFmpeg 压缩包…');
  await extractZip(zipPath, { dir: tmp });
  const ffmpegExe = findFile(tmp, 'ffmpeg.exe');
  const ffprobeExe = findFile(tmp, 'ffprobe.exe');
  if (!ffmpegExe || !ffprobeExe) throw new Error('压缩包中未找到 ffmpeg.exe / ffprobe.exe');
  const binDir = ensureDir(managedBinDir(TOOLS.ffmpeg));
  for (const src of [ffmpegExe, ffprobeExe]) {
    fs.copyFileSync(src, path.join(binDir, path.basename(src)));
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  return binDir;
}

async function extractLibreOffice(msiPath, log, signal) {
  const destRoot = ensureDir(path.join(toolsRoot(), 'libreoffice'));
  log('解包 LibreOffice（msiexec /a，免管理员）…');
  await new Promise((resolve, reject) => {
    const child = spawn(
      'msiexec',
      ['/a', msiPath, '/qn', '/norestart', `TARGETDIR=${destRoot}`],
      { windowsHide: true }
    );
    const kill = () => { try { child.kill('SIGKILL'); } catch {} };
    if (signal) {
      if (signal.aborted) return kill(), reject(new Error('已取消'));
      signal.addEventListener('abort', kill, { once: true });
    }
    child.on('error', reject);
    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', kill);
      code === 0 ? resolve() : reject(new Error(`msiexec 退出码 ${code}`));
    });
  });
  const soffice = findFile(destRoot, 'soffice.exe');
  if (!soffice) throw new Error('解包后未找到 soffice.exe');
  return path.dirname(soffice);
}

// -------------------- 安装入口 --------------------
/**
 * 安装工具到应用管理目录。
 * @param {string} toolId 'ffmpeg' | 'soffice'
 * @param {{onProgress?:Function, log?:Function, signal?:AbortSignal}} opts
 */
async function installTool(toolId, opts = {}) {
  const log = opts.log || (() => {});
  const onProgress = opts.onProgress || (() => {});
  const tool = TOOLS[toolId];
  if (!tool) throw new Error(`未知工具: ${toolId}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc_dl_'));
  let src;
  if (toolId === 'ffmpeg') {
    src = { url: FFMPEG_URL, filename: 'ffmpeg-master-latest-win64-gpl.zip', version: 'latest' };
  } else if (toolId === 'soffice') {
    log('查询 LibreOffice 最新稳定版…');
    src = await resolveLatestLibreOffice();
    log(`最新稳定版: ${src.version}`);
  }

  const destFile = path.join(tmpDir, src.filename);
  log(`下载 ${src.filename}`);
  onProgress(0, 0, 0);
  await download(src.url, destFile, (frac, recv, total) => onProgress(frac, recv, total), opts.signal);

  let binDir;
  if (tool.install.kind === 'zip') {
    binDir = await extractFfmpeg(destFile, log);
  } else {
    binDir = await extractLibreOffice(destFile, log, opts.signal);
  }
  fs.rmSync(tmpDir, { recursive: true, force: true });
  log(`安装完成: ${binDir}`);
  return { binDir, version: src.version };
}

module.exports = { installTool, resolveLatestLibreOffice, FFMPEG_URL };
