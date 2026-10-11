'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 1;
const MAX_RECORDS = 500;

let cache = null;

/**
 * 仓库文件所在目录。
 * 默认落在 Electron 的 userData（可写、随用户漫游）；
 * FC_HISTORY_DIR 可覆盖，便于测试。
 */
function baseDir() {
  if (process.env.FC_HISTORY_DIR) return process.env.FC_HISTORY_DIR;
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
  return path.join(baseDir(), 'history.json');
}

function exists(p) {
  if (!p) return false;
  try { return fs.existsSync(p); } catch { return false; }
}

function normalize(rec) {
  return {
    id: rec.id || crypto.randomUUID(),
    createdAt: rec.createdAt || Date.now(),
    durationMs: rec.durationMs ?? null,
    input: rec.input || null,
    inputSize: rec.inputSize ?? null,
    output: rec.output ?? null,
    outputSize: rec.outputSize ?? null,
    from: rec.from ?? null,
    to: rec.to ?? null,
    category: rec.category ?? null,
    converterId: rec.converterId ?? null,
    options: rec.options ?? null,
    customName: rec.customName ?? null,
    status: rec.status === 'ok' ? 'ok' : 'failed',
    error: rec.error ?? null,
  };
}

function emptyState() {
  return { schemaVersion: SCHEMA_VERSION, records: [] };
}

/** 原子写：先写 .tmp 再 rename 覆盖，避免中途崩溃留下半个文件 */
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
      records: Array.isArray(parsed.records) ? parsed.records.slice(0, MAX_RECORDS) : [],
    };
  } catch (e) {
    if (e.code !== 'ENOENT') {
      // 文件损坏：留个 .bak 再从空开始，不静默丢数据
      try { fs.renameSync(p, `${p}.bak`); } catch {}
    }
    cache = emptyState();
  }
  return cache;
}

/** 记录列表（新记录在前），并附带文件是否仍存在 */
function list() {
  return load().records.map((r) => ({
    ...r,
    inputExists: exists(r.input),
    outputExists: exists(r.output),
  }));
}

function add(record) {
  return addMany([record])[0];
}

function addMany(records) {
  const data = load();
  const recs = records.map(normalize);
  // 新记录在前；批内后完成的排得更靠前
  data.records = recs.slice().reverse().concat(data.records);
  if (data.records.length > MAX_RECORDS) data.records.length = MAX_RECORDS;
  persist();
  return recs;
}

function getRecord(id) {
  return load().records.find((r) => r.id === id) || null;
}

function removeRecord(id) {
  const data = load();
  const before = data.records.length;
  data.records = data.records.filter((r) => r.id !== id);
  if (data.records.length === before) return false;
  persist();
  return true;
}

function clear() {
  cache = emptyState();
  persist();
  return true;
}

/** 仅供单测：切换 FC_HISTORY_DIR 后清掉内存缓存 */
function _resetForTests() {
  cache = null;
}

module.exports = {
  list,
  add,
  addMany,
  getRecord,
  removeRecord,
  clear,
  filePath,
  MAX_RECORDS,
  _resetForTests,
};
