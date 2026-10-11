'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 1;
const MAX_PRESETS = 200;

let cache = null;

/**
 * 方案文件目录。默认 userData，FC_PRESETS_DIR 可覆盖（测试用）。
 */
function baseDir() {
  if (process.env.FC_PRESETS_DIR) return process.env.FC_PRESETS_DIR;
  try {
    const electron = require('electron');
    if (electron && electron.app && typeof electron.app.getPath === 'function') {
      return electron.app.getPath('userData');
    }
  } catch {
    /* 非 Electron 环境（单测） */
  }
  return path.join(os.homedir(), '.format-converter');
}

function filePath() {
  return path.join(baseDir(), 'presets.json');
}

function normalize(p) {
  return {
    id: p.id || crypto.randomUUID(),
    category: p.category || '',
    name: String(p.name || '').trim(),
    options: p.options && typeof p.options === 'object' ? p.options : {},
    createdAt: p.createdAt || Date.now(),
  };
}

function emptyState() {
  return { schemaVersion: SCHEMA_VERSION, presets: [] };
}

/** 原子写：先写 .tmp 再 rename 覆盖 */
function persist() {
  const p = filePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), 'utf8');
  fs.renameSync(tmp, p);
}

function load() {
  if (cache) return cache;
  const p = filePath();
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    cache = {
      schemaVersion: parsed.schemaVersion || SCHEMA_VERSION,
      presets: Array.isArray(parsed.presets)
        ? parsed.presets.map(normalize).slice(0, MAX_PRESETS)
        : [],
    };
  } catch (e) {
    if (e.code !== 'ENOENT') {
      try { fs.renameSync(p, `${p}.bak`); } catch {}
    }
    cache = emptyState();
  }
  return cache;
}

/** 新方案在前 */
function list() {
  return load().presets.slice();
}

/** 按 category + name 覆盖保存；空名抛错 */
function save({ category, name, options }) {
  const cat = String(category || '');
  const nm = String(name || '').trim();
  if (!nm) throw new Error('方案名不能为空');

  const data = load();
  const existing = data.presets.find((p) => p.category === cat && p.name === nm);
  if (existing) {
    existing.options = options && typeof options === 'object' ? options : {};
    existing.createdAt = Date.now();
    persist();
    return existing;
  }

  const rec = normalize({ category: cat, name: nm, options });
  data.presets.unshift(rec);
  if (data.presets.length > MAX_PRESETS) data.presets.length = MAX_PRESETS;
  persist();
  return rec;
}

function remove(id) {
  const data = load();
  const before = data.presets.length;
  data.presets = data.presets.filter((p) => p.id !== id);
  if (data.presets.length === before) return false;
  persist();
  return true;
}

function clear() {
  cache = emptyState();
  persist();
  return true;
}

/** 仅供单测：切换 FC_PRESETS_DIR 后清掉内存缓存 */
function _resetForTests() {
  cache = null;
}

module.exports = {
  list,
  save,
  remove,
  clear,
  filePath,
  MAX_PRESETS,
  _resetForTests,
};
