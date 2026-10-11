'use strict';

const { ipcMain, dialog, shell, app, clipboard } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { detectAll } = require('./tools/detect');
const { installTool } = require('./tools/install');
const { isInUserPath, addToUserPath, removeFromUserPath } = require('./tools/env');
const { TOOLS, managedBinDir } = require('./tools/registry');
const { defaultOutputDir } = require('./util/paths');
const conv = require('./convert');
const history = require('./history');
const presets = require('./presets');
const updater = require('./updater');

let convertAbort = null;
let installAbort = null;

function availableToolIds() {
  return new Set(detectAll().filter((t) => t.found).map((t) => t.id));
}

/** 收集可用工具的 exe 路径，供转换器调用 */
function toolPaths() {
  const map = {};
  for (const t of detectAll()) {
    if (t.found) map[t.id] = t.exePath;
  }
  if (map.ffmpeg && !map.ffprobe) {
    map.ffprobe = map.ffmpeg.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
  }
  return map;
}

function fileSize(p) {
  try { return fs.statSync(p).size; } catch { return null; }
}

/** 解析 Windows 剪贴板 CF_HDROP（DROPFILES 结构）得到文件路径列表 */
function parseHDrop(buf) {
  const offset = buf.readUInt32LE(0);
  const wide = buf.length >= 20 && buf.readUInt32LE(16) !== 0;
  const body = buf.subarray(offset);
  const text = wide ? body.toString('utf16le') : body.toString('latin1');
  return text.split(/\0+/).map((s) => s.trim()).filter(Boolean);
}

/** 读取「在资源管理器里复制的文件」路径 */
function readClipboardFilePaths() {
  const formats = clipboard.availableFormats() || [];
  if (!formats.some((f) => /CF_HDROP|FileName/i.test(f))) return [];

  try {
    const buf = clipboard.readBuffer('CF_HDROP');
    if (buf && buf.length) {
      const list = parseHDrop(buf).filter((p) => fs.existsSync(p));
      if (list.length) return list;
    }
  } catch {}

  try {
    const bufW = clipboard.readBuffer('FileNameW');
    if (bufW && bufW.length) {
      const list = bufW
        .toString('utf16le')
        .split(/\0+/)
        .map((s) => s.trim())
        .filter((s) => s && fs.existsSync(s));
      if (list.length) return list;
    }
  } catch {}

  return [];
}

/** 构造一条仓库记录（批量转换与重新转换共用） */
function makeRecord(input, output, to, meta, status, converterId, error, durationMs) {
  const ok = status === 'ok';
  const from = conv.extOf(input || '');
  return {
    input,
    inputSize: fileSize(input),
    output: ok ? output : null,
    outputSize: ok ? fileSize(output) : null,
    from,
    to,
    category: (meta && meta.category) || conv.categoryOf(from),
    converterId,
    options: (meta && meta.options) || null,
    customName: (meta && meta.customName) || null,
    status,
    error,
    durationMs,
  };
}

/** 把 runJobs 的结果转成仓库记录 */
function toHistoryRecords(results, jobs) {
  const byId = new Map(jobs.map((j) => [j.id, j]));
  return results.map((r) => {
    const job = byId.get(r.id) || {};
    return makeRecord(
      job.input,
      r.output,
      job.to,
      { options: job.options, category: job.category, customName: job.name || null },
      r.status === 'ok' ? 'ok' : 'failed',
      r.converterId || null,
      r.status === 'ok' ? null : r.error || '未知错误',
      r.durationMs ?? null
    );
  });
}

function register() {
  ipcMain.handle('app:info', () => {
    const extCategory = {};
    for (const e of conv.knownInputExts()) extCategory[e] = conv.categoryOf(e);
    return {
      version: app.getVersion(),
      defaultOutputDir: defaultOutputDir(),
      platform: process.platform,
      knownInputExts: conv.knownInputExts(),
      extCategory,
    };
  });

  ipcMain.handle('tools:detect', () => detectAll());

  ipcMain.handle('tools:pathStatus', (_e, toolId) => {
    const tool = TOOLS[toolId];
    return { inUserPath: isInUserPath(managedBinDir(tool)) };
  });

  ipcMain.handle('tools:addToPath', (_e, toolId) => {
    const tool = TOOLS[toolId];
    return addToUserPath(managedBinDir(tool));
  });

  ipcMain.handle('tools:removeFromPath', (_e, toolId) => {
    const tool = TOOLS[toolId];
    return removeFromUserPath(managedBinDir(tool));
  });

  ipcMain.handle('tools:install', async (e, toolId) => {
    installAbort = new AbortController();
    const send = (payload) => e.sender.send('tools:progress', { toolId, ...payload });
    try {
      const r = await installTool(toolId, {
        signal: installAbort.signal,
        log: (message) => send({ phase: 'log', message }),
        onProgress: (frac, received, total) => send({ phase: 'download', frac, received, total }),
      });
      send({ phase: 'done', ...r });
      return { ok: true, ...r };
    } catch (err) {
      send({ phase: 'error', message: err.message });
      return { ok: false, error: err.message };
    } finally {
      installAbort = null;
    }
  });

  ipcMain.handle('tools:installCancel', () => {
    if (installAbort) installAbort.abort();
    return true;
  });

  ipcMain.handle('convert:capabilities', (_e, ext) => {
    return conv.capabilities(ext, availableToolIds());
  });

  ipcMain.handle('convert:start', async (e, payload) => {
    const { jobs, outDir, concurrency } = payload;
    convertAbort = new AbortController();
    const send = (ev) => e.sender.send('convert:event', ev);
    try {
      const results = await conv.runJobs(jobs, {
        outDir: outDir || defaultOutputDir(),
        concurrency: concurrency || 2,
        signal: convertAbort.signal,
        availableTools: availableToolIds(),
        tools: toolPaths(),
        onEvent: send,
      });
      const records = history.addMany(toHistoryRecords(results, jobs));
      send({ type: 'run:done', results, records });
      return { ok: true, results, records };
    } catch (err) {
      return { ok: false, error: err.message };
    } finally {
      convertAbort = null;
    }
  });

  ipcMain.handle('convert:cancel', () => {
    if (convertAbort) convertAbort.abort();
    return true;
  });

  ipcMain.handle('media:hwencoders', () => conv.probeEncoders(toolPaths().ffmpeg));

  ipcMain.handle('presets:list', () => presets.list());

  ipcMain.handle('presets:save', (_e, payload) => {
    try {
      return { ok: true, preset: presets.save(payload || {}) };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('presets:remove', (_e, id) => ({ ok: presets.remove(id) }));

  ipcMain.handle('update:status', () => updater.status());
  ipcMain.handle('update:check', () => updater.check());
  ipcMain.handle('update:download', () => updater.download());
  ipcMain.handle('update:install', (_e, payload) =>
    updater.install({ converting: !!convertAbort || !!((payload || {}).converting) }));

  ipcMain.handle('history:list', () => history.list());

  ipcMain.handle('history:remove', (_e, id) => ({ ok: history.removeRecord(id) }));

  ipcMain.handle('history:clear', () => {
    history.clear();
    return { ok: true };
  });

  ipcMain.handle('history:trashOutput', async (_e, id) => {
    const rec = history.getRecord(id);
    if (!rec || !rec.output) return { ok: false, error: '记录不存在' };
    if (!fs.existsSync(rec.output)) return { ok: false, error: '输出文件已不存在' };
    try {
      await shell.trashItem(rec.output); // 送回收站，非永久删除
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('history:reconvert', async (_e, id) => {
    const rec = history.getRecord(id);
    if (!rec) return { ok: false, error: '记录不存在' };
    if (!rec.input || !fs.existsSync(rec.input)) return { ok: false, error: '源文件已不存在，无法重新转换' };
    convertAbort = new AbortController();
    const outDir = rec.output ? path.dirname(rec.output) : defaultOutputDir();
    const t0 = Date.now();
    try {
      conv._resetReservations();
      const r = await conv.runJob(
        { id: `re:${rec.id}`, input: rec.input, to: rec.to, options: rec.options || {}, name: rec.customName || undefined },
        {
          outDir,
          signal: convertAbort.signal,
          availableTools: availableToolIds(),
          tools: toolPaths(),
          onEvent: () => {},
        }
      );
      const record = history.add(makeRecord(rec.input, r.output, rec.to, rec, 'ok', r.converterId, null, Date.now() - t0));
      return { ok: true, record };
    } catch (err) {
      const record = history.add(makeRecord(rec.input, null, rec.to, rec, 'failed', null, err.message, Date.now() - t0));
      return { ok: false, error: err.message, record };
    } finally {
      convertAbort = null;
    }
  });

  ipcMain.handle('dialog:pickFiles', async () => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      title: '选择要转换的文件',
    });
    return r.canceled ? [] : r.filePaths;
  });

  ipcMain.handle('dialog:pickDir', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'], title: '选择输出目录' });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('shell:showItem', (_e, p) => {
    if (p && fs.existsSync(p)) shell.showItemInFolder(p);
    return true;
  });

  ipcMain.handle('shell:openPath', async (_e, p) => {
    if (!p || !fs.existsSync(p)) return { ok: false, error: '文件已不存在' };
    const err = await shell.openPath(p);
    return err ? { ok: false, error: err } : { ok: true };
  });

  ipcMain.handle('path:statInfo', (_e, paths) => {
    return (paths || []).map((p) => {
      try {
        const st = fs.statSync(p);
        return {
          path: p,
          name: path.basename(p),
          ext: path.extname(p).replace(/^\./, '').toLowerCase(),
          size: st.size,
          isFile: st.isFile(),
        };
      } catch {
        return null;
      }
    }).filter(Boolean);
  });

  ipcMain.handle('path:basename', (_e, p) => path.basename(p));

  // 剪贴板导入：优先文件列表，其次位图（截图/复制图片）存为临时 PNG
  ipcMain.handle('clipboard:readInputs', () => {
    const files = readClipboardFilePaths();
    if (files.length) return { kind: 'files', paths: files };

    const img = clipboard.readImage();
    if (img && !img.isEmpty()) {
      const dir = path.join(os.tmpdir(), 'FormatConverter', 'paste');
      fs.mkdirSync(dir, { recursive: true });
      const p = path.join(dir, `paste-${Date.now()}.png`);
      fs.writeFileSync(p, img.toPNG());
      return { kind: 'image', paths: [p] };
    }
    return { kind: null, paths: [] };
  });
}

module.exports = { register };
