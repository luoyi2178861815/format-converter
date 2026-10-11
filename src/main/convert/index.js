'use strict';

const path = require('path');
const fs = require('fs');

const imageConverters = require('./image');
const mediaConverters = require('./media');
const documentConverters = require('./document');
const dataConverters = require('./data');

const CONVERTERS = [
  ...imageConverters,
  ...mediaConverters,
  ...documentConverters,
  ...dataConverters,
];

function extOf(filePath) {
  return path.extname(filePath).replace(/^\./, '').toLowerCase();
}

/** 输入扩展名 -> 该文件可能的类别 */
function categoryOf(ext) {
  const cats = new Set();
  for (const c of CONVERTERS) if (c.from.includes(ext)) cats.add(c.category);
  return [...cats][0] || 'unknown';
}

/**
 * 给定输入扩展名，返回可转换的目标格式列表。
 * availableTools: 可用工具 id 集合
 */
function capabilities(fromExt, availableTools = new Set()) {
  const map = new Map(); // to -> {to, converterId, requires, available, label}
  for (const c of CONVERTERS) {
    if (!c.from.includes(fromExt)) continue;
    for (const to of c.to) {
      if (to === fromExt) continue;
      const available = (c.requires || []).every((r) => availableTools.has(r));
      const existing = map.get(to);
      const prio = c.priority ?? 50;
      if (
        !existing ||
        (available && !existing.available) ||
        (available === existing.available && prio < existing.priority)
      ) {
        map.set(to, {
          to,
          converterId: c.id,
          label: c.label,
          requires: c.requires || [],
          available,
          priority: prio,
        });
      }
    }
  }
  return [...map.values()]
    .sort((a, b) => Number(b.available) - Number(a.available) || a.to.localeCompare(b.to))
    .map(({ priority, ...rest }) => rest);
}

/** 为一次转换挑选合适的转换器 */
function findConverter(fromExt, toExt, availableTools = new Set()) {
  const candidates = CONVERTERS.filter(
    (c) => c.from.includes(fromExt) && c.to.includes(toExt)
  ).sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50));

  if (!candidates.length) return { converter: null, missing: [] };

  const ready = candidates.find((c) => (c.requires || []).every((r) => availableTools.has(r)));
  if (ready) return { converter: ready, missing: [] };

  const best = candidates[0];
  return { converter: null, missing: best.requires || [] };
}

const INVALID_NAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;

/** 清理自定义文件名：替换非法字符，去掉结尾的点与空格（Windows 不允许） */
function sanitizeName(name) {
  return String(name).replace(INVALID_NAME_CHARS, '_').replace(/[. ]+$/, '').trim();
}

/**
 * 本次运行内已预留的输出路径。
 * 并发任务会先各自算好路径再写盘，只靠 existsSync 会撞名，这里做进程内去重。
 */
const _reserved = new Set();

/** 取首个可用路径：被占用（磁盘已存在或本次已预留）时追加 (1)(2)… */
function uniquePath(target) {
  if (!fs.existsSync(target) && !_reserved.has(target)) return target;
  const dir = path.dirname(target);
  const ext = path.extname(target);
  const base = path.basename(target, ext);
  for (let i = 1; i < 1000; i++) {
    const alt = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(alt) && !_reserved.has(alt)) return alt;
  }
  return target;
}

function _resetReservations() {
  _reserved.clear();
}

/** 计算输出文件路径；自定义名与默认名都会被避让，不覆盖已有文件 */
function outputPathFor(job, outDir) {
  const custom = job.name ? sanitizeName(job.name) : '';
  const base = custom || path.basename(job.input, path.extname(job.input));
  const target = job.output || path.join(outDir, `${base}.${job.to}`);
  return uniquePath(target);
}

/**
 * 执行单个任务。
 * job: {id, input, output?, to, options?}
 * ctx 额外提供: tools(可用工具exe路径映射), onEvent, signal, outDir
 */
async function runJob(job, ctx) {
  const from = extOf(job.input);
  const to = job.to;
  const output = outputPathFor(job, ctx.outDir);
  _reserved.add(output); // 占位，避免同批任务算出同一个路径
  const availableTools = new Set(ctx.availableTools || []);
  const { converter, missing } = findConverter(from, to, availableTools);

  if (missing.length) {
    throw new Error(`需要先安装：${missing.join('、')}`);
  }
  if (!converter) {
    throw new Error(`不支持 .${from} → .${to}`);
  }

  if (!fs.existsSync(job.input)) throw new Error('输入文件不存在');
  fs.mkdirSync(path.dirname(output), { recursive: true });

  const emit = (pct) => ctx.onEvent && ctx.onEvent({ type: 'job:progress', id: job.id, progress: pct });
  await converter.convert({
    input: job.input,
    output,
    from,
    to,
    options: job.options || {},
    tools: ctx.tools || {},
    signal: ctx.signal,
    log: (m) => ctx.onEvent && ctx.onEvent({ type: 'job:log', id: job.id, message: m }),
    onProgress: emit,
  });
  return { id: job.id, output, converterId: converter.id };
}

/** 顺序/有限并发执行一批任务 */
async function runJobs(jobs, ctx) {
  const concurrency = Math.max(1, ctx.concurrency || 2);
  const results = [];
  let cursor = 0;
  _resetReservations();

  async function worker() {
    while (cursor < jobs.length) {
      if (ctx.signal && ctx.signal.aborted) return;
      const job = jobs[cursor++];
      ctx.onEvent && ctx.onEvent({ type: 'job:start', id: job.id, input: job.input, to: job.to });
      const t0 = Date.now();
      try {
        const r = await runJob(job, ctx);
        results.push({ status: 'ok', ...r, durationMs: Date.now() - t0 });
        ctx.onEvent && ctx.onEvent({ type: 'job:done', id: job.id, output: r.output });
      } catch (e) {
        results.push({ status: 'error', id: job.id, error: e.message, durationMs: Date.now() - t0 });
        ctx.onEvent && ctx.onEvent({ type: 'job:error', id: job.id, error: e.message });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return results;
}

/** 所有已知输入格式（供 UI 提示） */
function knownInputExts() {
  const s = new Set();
  for (const c of CONVERTERS) c.from.forEach((e) => s.add(e));
  return [...s].sort();
}

module.exports = {
  CONVERTERS,
  extOf,
  categoryOf,
  capabilities,
  findConverter,
  runJob,
  runJobs,
  outputPathFor,
  uniquePath,
  sanitizeName,
  knownInputExts,
  probeEncoders: mediaConverters.probeEncoders,
  _resetReservations,
};
