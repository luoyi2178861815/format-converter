'use strict';

const bridge = window.api;

const state = {
  files: [],        // {id,path,name,ext,size,category,targets,target,status,progress,output,error}
  outputDir: null,
  converting: false,
  tools: [],
  info: null,
  history: [],
  historyFilter: 'all',
  historyQuery: '',
  unseen: 0,
  customName: false,
  catTab: 'all',
  dominant: null,
  presets: [],
  hwEnc: null,
  updateState: null,
};

// 高级选项：字段 → 所属分类 / options 键（单一来源）
const FIELD_CAT = {
  optOutdir: 'common', optCustomName: 'common',
  optQuality: 'image', optWidth: 'image',
  optBitrate: 'media', optCrf: 'media', optFps: 'media', optHwaccel: 'media', optRemux: 'media',
  optEncoding: 'data', optCsvBom: 'data',
};
const FIELD_KEY = {
  optQuality: 'quality', optWidth: 'width',
  optBitrate: 'bitrate', optCrf: 'crf', optFps: 'fps', optHwaccel: 'hwaccel', optRemux: 'remux',
  optEncoding: 'inputEncoding', optCsvBom: 'csvBom',
};
const CAT_LABEL = { all: '全部', image: '图片', media: '音视频', document: '文档', data: '数据' };

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

let seq = 0;
const uid = () => `f${++seq}`;

// ---------------- 主题 ----------------
function initTheme() {
  const saved = localStorage.getItem('theme') || 'dark';
  document.documentElement.dataset.theme = saved;
  $('btnTheme').onclick = () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('theme', next);
  };
}

// ---------------- 日志 ----------------
function log(msg) {
  const box = $('log');
  const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  box.appendChild(document.createTextNode(`[${t}] ${msg}\n`));
  box.scrollTop = box.scrollHeight;
}

function toggleLog(force) {
  const box = $('log');
  const show = force != null ? force : !box.classList.contains('show');
  box.classList.toggle('show', show);
  $('logToggle').textContent = show ? '收起 ▴' : '展开 ▾';
}

// ---------------- 文件 ----------------
async function addPaths(paths) {
  if (!paths || !paths.length) return;
  const infos = await bridge.statInfo(paths);
  let added = 0;
  for (const info of infos) {
    if (!info || !info.isFile) continue;
    if (state.files.some((f) => f.path === info.path)) continue;
    state.files.push({
      id: uid(),
      path: info.path,
      name: info.name,
      customName: info.name.replace(/\.[^.]+$/, ''),
      ext: info.ext,
      size: info.size,
      targets: [],
      target: '',
      status: 'idle',
      progress: 0,
    });
    added++;
  }
  if (added) log(`已添加 ${added} 个文件`);
  await loadTargets();
  render();
}

async function loadTargets() {
  for (const f of state.files) {
    if (f.targets.length) continue;
    try {
      f.targets = await bridge.capabilities(f.ext);
    } catch {
      f.targets = [];
    }
    f.category = f.targets[0]?.label || '';
    f.catKey = (state.info && state.info.extCategory && state.info.extCategory[f.ext]) || '';
  }
}

function fmtSize(n) {
  if (n == null) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

function render() {
  syncCatTab();
  const list = $('list');
  const dz = $('dropzone');
  list.innerHTML = '';
  const has = state.files.length > 0;
  dz.style.display = has ? 'none' : 'block';
  list.classList.toggle('active', has);

  for (const f of state.files) {
    const row = el('div', 'row');
    row.dataset.id = f.id;

    const left = el('div');
    if (state.customName) {
      const rename = el('div', 'rename');
      const inp = el('input', 'nameinput');
      inp.type = 'text';
      inp.value = f.customName || '';
      inp.disabled = state.converting;
      inp.oninput = () => { f.customName = inp.value; };
      rename.appendChild(inp);
      rename.appendChild(el('span', 'nameext', `.${f.target || f.ext}`));
      left.appendChild(rename);
    } else {
      left.appendChild(el('div', 'fname', f.name));
    }
    const meta = el('div', 'fmeta');
    meta.appendChild(el('span', 'badge', f.category || f.ext || '未知'));
    meta.appendChild(el('span', null, `.${f.ext}`));
    meta.appendChild(el('span', null, fmtSize(f.size)));
    left.appendChild(meta);
    row.appendChild(left);

    // 目标格式选择（缺工具的也允许选，转换前会统一提示安装）
    const sel = el('select');
    const ph = el('option', null, f.targets.length ? '转为…' : '无可用转换');
    ph.value = '';
    sel.appendChild(ph);
    for (const t of f.targets) {
      const o = el('option', null, `.${t.to}${t.available ? '' : '（需安装 ' + t.requires.join('/') + '）'}`);
      o.value = t.to;
      if (f.target === t.to) o.selected = true;
      sel.appendChild(o);
    }
    sel.disabled = state.converting || !f.targets.length;
    sel.onchange = () => {
      f.target = sel.value;
      const ext = row.querySelector('.nameext');
      if (ext) ext.textContent = `.${f.target || f.ext}`;
      updateConvertButton();
    };
    row.appendChild(sel);

    const arrow = el('span', 'arrow', '→');
    row.appendChild(arrow);

    const rm = el('button', 'danger', '✕');
    rm.title = '移除';
    rm.disabled = state.converting;
    rm.onclick = () => removeFile(f.id);
    row.appendChild(rm);

    // 进度
    const prog = el('div', 'progress');
    prog.appendChild(el('i'));
    row.appendChild(prog);

    const status = el('div', 'status-line');
    row.appendChild(status);

    if (f.status !== 'idle') {
      prog.classList.add('show');
      prog.classList.toggle('done', f.status === 'done');
      prog.classList.toggle('error', f.status === 'error');
      prog.querySelector('i').style.width = `${Math.round((f.progress || 0) * 100)}%`;

      status.classList.add('show');
      if (f.status === 'running') status.textContent = `转换中… ${Math.round((f.progress || 0) * 100)}%`;
      else if (f.status === 'done') { status.classList.add('ok'); status.textContent = `完成 → ${f.output}`; }
      else if (f.status === 'error') { status.classList.add('err'); status.textContent = `失败：${f.error}`; }
    }

    list.appendChild(row);
  }

  refreshGlobalTargets();
  updateConvertButton();
}

function removeFile(id) {
  state.files = state.files.filter((f) => f.id !== id);
  render();
}

// ---------------- 全局目标 ----------------
function refreshGlobalTargets() {
  const sel = $('globalTarget');
  const prev = sel.value;
  const set = new Set();
  for (const f of state.files) for (const t of f.targets) set.add(t.to);
  sel.innerHTML = '';
  const ph = el('option', null, '—');
  ph.value = '';
  sel.appendChild(ph);
  for (const to of [...set].sort()) {
    const o = el('option', null, `.${to}`);
    o.value = to;
    sel.appendChild(o);
  }
  if (prev && set.has(prev)) sel.value = prev;

  sel.onchange = () => {
    const to = sel.value;
    if (!to) return;
    for (const f of state.files) {
      if (f.targets.some((t) => t.to === to)) f.target = to;
    }
    render();
  };
}

function gatherOptions() {
  const num = (id) => {
    const v = $(id).value.trim();
    return v === '' ? undefined : Number(v);
  };
  const str = (id) => $(id).value.trim() || undefined;
  return {
    quality: num('optQuality'),
    width: num('optWidth'),
    bitrate: str('optBitrate'),
    crf: num('optCrf'),
    fps: num('optFps'),
    inputEncoding: $('optEncoding').value || undefined,
    csvBom: $('optCsvBom').checked,
    remux: $('optRemux').checked,
    hwaccel: $('optHwaccel').value || 'auto',
  };
}

// ---------------- 高级选项：分类标签 / 自动聚焦 / 方案 ----------------
function setCatTab(cat) {
  state.catTab = cat;
  for (const btn of $('optTabs').querySelectorAll('button[role="tab"]')) {
    btn.setAttribute('aria-selected', String(btn.dataset.cat === cat));
  }
  for (const f of $('optFields').querySelectorAll('[data-cat]')) {
    const dc = f.dataset.cat;
    if (f.classList.contains('opt-empty')) f.hidden = cat !== dc;
    else f.hidden = !(cat === 'all' || dc === 'common' || dc === cat);
  }
  const canPreset = cat !== 'all';
  $('btnPresetSave').disabled = !canPreset;
  $('btnPresetDel').disabled = !canPreset || !$('presetSelect').value;
  renderPresetOptions();
}

/** 按当前待转换文件统计众数分类；并列时保留上次，空列表→null */
function computeDominant() {
  const counts = {};
  let best = null;
  let bestN = 0;
  for (const f of state.files) {
    const k = f.catKey;
    if (!k) continue;
    counts[k] = (counts[k] || 0) + 1;
  }
  const keys = Object.keys(counts);
  if (!keys.length) return null;
  let max = Math.max(...keys.map((k) => counts[k]));
  const tops = keys.filter((k) => counts[k] === max);
  if (tops.length === 1) return tops[0];
  return tops.includes(state.dominant) ? state.dominant : tops[0];
}

function syncCatTab() {
  const d = computeDominant();
  if (d !== state.dominant) {
    state.dominant = d;
    setCatTab(d || 'all');
  }
}

function renderPresetOptions() {
  const sel = $('presetSelect');
  const prev = sel.value;
  sel.innerHTML = '';
  const ph = el('option', null, '— 方案 —');
  ph.value = '';
  sel.appendChild(ph);
  const cat = state.catTab;
  const list = state.presets.filter((p) => cat === 'all' || p.category === cat);
  for (const p of list) {
    const o = el('option', null, p.name);
    o.value = p.id;
    sel.appendChild(o);
  }
  if (prev && list.some((p) => p.id === prev)) sel.value = prev;
  if (state.catTab !== 'all' && !sel.value) $('btnPresetDel').disabled = true;
}

function applyPreset(p) {
  if (!p) return;
  const opts = p.options || {};
  for (const [id, key] of Object.entries(FIELD_KEY)) {
    if (FIELD_CAT[id] !== p.category) continue;
    const node = $(id);
    if (!node) continue;
    if (node.type === 'checkbox') { if (key in opts) node.checked = !!opts[key]; }
    else node.value = opts[key] == null ? '' : opts[key];
  }
  log(`已套用方案「${p.name}」`);
}

async function loadPresets() {
  try {
    state.presets = (await bridge.presetsList()) || [];
  } catch {
    state.presets = [];
  }
  renderPresetOptions();
}

async function savePreset() {
  if (state.catTab === 'all') return;
  const name = await askText({ title: '保存为方案', label: `把当前「${CAT_LABEL[state.catTab] || ''}」设置保存为方案`, placeholder: '方案名称' });
  if (!name) return;
  const options = {};
  for (const [id, key] of Object.entries(FIELD_KEY)) {
    if (FIELD_CAT[id] !== state.catTab) continue;
    const node = $(id);
    if (!node) continue;
    if (node.type === 'checkbox') options[key] = node.checked;
    else {
      const v = node.value.trim();
      options[key] = v === '' ? undefined : v;
    }
  }
  const res = await bridge.presetsSave({ category: state.catTab, name, options });
  if (!res.ok) { log(`✘ 保存方案失败：${res.error}`); return; }
  log(`已保存方案「${name}」`);
  await loadPresets();
  $('presetSelect').value = res.preset.id;
  $('btnPresetDel').disabled = false;
}

async function deletePreset() {
  const id = $('presetSelect').value;
  const p = state.presets.find((x) => x.id === id);
  if (!p) return;
  const ok = await askConfirm({
    title: '删除方案？',
    message: `删除方案「${p.name}」，不影响已转换的文件。`,
    confirmText: '删除',
    danger: true,
  });
  if (!ok) return;
  await bridge.presetsRemove(id);
  log(`已删除方案「${p.name}」`);
  await loadPresets();
  $('btnPresetDel').disabled = true;
}

async function initHwEncoders() {
  const sel = $('optHwaccel');
  let avail = {};
  try {
    avail = await bridge.hwEncoders();
  } catch {
    avail = {};
  }
  state.hwEnc = avail;
  const map = { nvenc: 'NVIDIA NVENC', qsv: 'Intel QSV', amf: 'AMD AMF' };
  for (const opt of sel.options) {
    if (!map[opt.value]) continue;
    const ok = !!avail[opt.value];
    opt.disabled = !ok;
    opt.textContent = ok ? map[opt.value] : `${map[opt.value]}（不可用）`;
  }
}

// ---------------- 自动更新 ----------------
function renderUpdateState(ev) {
  state.updateState = ev || { state: 'idle' };
  const st = state.updateState.state;
  const btn = $('btnUpdate');
  const msg = $('updateMsg');
  btn.hidden = true;
  btn.disabled = false;
  btn.onclick = null;
  msg.textContent = '';
  switch (st) {
    case 'dev':
      msg.textContent = '开发模式，不检查更新。';
      break;
    case 'unsupported':
      msg.textContent = '便携版不支持自动更新，请手动下载新版本。';
      break;
    case 'checking':
      btn.hidden = false; btn.disabled = true; btn.textContent = '检查中…';
      break;
    case 'available':
      btn.hidden = false; btn.textContent = `有新版本 v${ev.version}，点击下载`;
      btn.onclick = () => bridge.updateDownload();
      break;
    case 'downloading':
      btn.hidden = false; btn.disabled = true;
      btn.textContent = `下载中 ${Math.round(ev.percent || 0)}%`;
      break;
    case 'downloaded':
      btn.hidden = false; btn.textContent = `重启并安装 v${ev.version}`;
      btn.onclick = installUpdate;
      break;
    case 'none':
      msg.textContent = '已是最新版本。';
      break;
    case 'error':
      msg.textContent = `检查更新失败：${ev.message || '未知错误'}`;
      break;
  }
}

async function installUpdate() {
  const res = await bridge.updateInstall({ converting: state.converting });
  if (!res.ok) { log(`✘ 无法安装更新：${res.error}`); return; }
  log('正在重启以安装更新…');
}

function initUpdate() {
  bridge.onUpdateEvent(renderUpdateState);
  bridge.updateStatus().then(renderUpdateState).catch(() => {});
  $('btnCheckUpdate').onclick = () => {
    $('updateMsg').textContent = '正在检查…';
    bridge.updateCheck();
  };
}

/** 文本输入弹窗（Electron 渲染器不支持 window.prompt） */
function askText({ title, label, value = '', placeholder = '' }) {
  return new Promise((resolve) => {
    const mask = $('presetModal');
    const input = $('presetName');
    $('presetTitle').textContent = title || '输入';
    $('presetMsg').textContent = label || '';
    input.value = value;
    input.placeholder = placeholder;
    mask.classList.add('show');

    const done = (val) => {
      mask.classList.remove('show');
      $('presetOk').onclick = null;
      $('presetCancel').onclick = null;
      mask.onclick = null;
      input.onkeydown = null;
      resolve(val);
    };
    $('presetOk').onclick = () => done(input.value.trim());
    $('presetCancel').onclick = () => done(null);
    mask.onclick = (e) => { if (e.target === mask) done(null); };
    input.onkeydown = (e) => {
      if (e.key === 'Enter') done(input.value.trim());
      else if (e.key === 'Escape') done(null);
    };
    setTimeout(() => { input.focus(); input.select(); }, 0);
  });
}

function updateConvertButton() {
  const n = state.files.filter((f) => f.target).length;
  const btn = $('btnConvert');
  btn.disabled = state.converting || n === 0;
  btn.textContent = state.converting ? '转换中…' : n ? `开始转换 (${n})` : '开始转换';
}

// ---------------- 转换 ----------------
async function startConvert() {
  const picked = state.files.filter((f) => f.target);
  if (!picked.length) return;

  // 预检：目标格式所需的外部工具是否齐全（用最新探测结果，避免用过期的 available 标记）
  state.tools = await bridge.detectTools();
  const available = new Set(state.tools.filter((t) => t.found).map((t) => t.id));
  const missing = new Set();
  for (const f of picked) {
    const cap = (f.targets || []).find((t) => t.to === f.target);
    const need = (cap && cap.requires) || [];
    if (need.length && !need.every((r) => available.has(r))) need.forEach((r) => missing.add(r));
  }
  if (missing.size) {
    showMissingTools([...missing]);
    log(`缺少外部工具：${[...missing].join('、')}，已暂停转换`);
    return;
  }

  const useCustom = state.customName;
  const jobs = picked.map((f) => ({
    id: f.id,
    input: f.path,
    to: f.target,
    name: useCustom && f.customName && f.customName.trim() ? f.customName.trim() : undefined,
    options: gatherOptions(),
  }));

  toggleLog(true);
  state.converting = true;
  for (const f of state.files) {
    if (f.target) { f.status = 'idle'; f.progress = 0; f.error = null; f.output = null; }
  }
  render();
  log(`开始转换 ${jobs.length} 个任务`);

  const res = await bridge.startConvert({
    jobs,
    outDir: state.outputDir,
    concurrency: 2,
  });

  if (!res.ok) {
    state.converting = false;
    log(`转换中断：${res.error}`);
    render();
  }
  // 正常结束由 run:done 事件统一收尾，保证日志顺序
}

function onConvertEvent(ev) {
  const f = state.files.find((x) => x.id === ev.id);
  if (ev.type === 'job:start') {
    if (f) { f.status = 'running'; f.progress = 0; }
    log(`▶ ${f ? f.name : ev.id} → .${ev.to}`);
  } else if (ev.type === 'job:progress') {
    if (f) { f.status = 'running'; f.progress = ev.progress; }
    updateRow(f);
    return;
  } else if (ev.type === 'job:log') {
    log(`   ${ev.message}`);
    return;
  } else if (ev.type === 'job:done') {
    if (f) { f.status = 'done'; f.progress = 1; f.output = ev.output; }
    log(`✔ 完成：${ev.output}`);
  } else if (ev.type === 'job:error') {
    if (f) { f.status = 'error'; f.error = ev.error; }
    log(`✘ 失败：${ev.error}`);
    const m = /需要先安装[：:]\s*(.+)$/.exec(ev.error || '');
    if (m) showMissingTools(m[1].split(/[、,，\s]+/).filter(Boolean));
  } else if (ev.type === 'run:done') {
    state.converting = false;
    const ok = ev.results.filter((r) => r.status === 'ok').length;
    log(`全部完成：成功 ${ok}，失败 ${ev.results.length - ok}`);
    // 本次涉及的条目（成功与失败）一律移出待转换列表，按钮随之禁用
    const doneIds = new Set(ev.results.map((r) => r.id));
    state.files = state.files.filter((f) => !doneIds.has(f.id));
    const n = ev.records ? ev.records.length : 0;
    log(`已存入仓库 ${n} 条`);
    if (!isDrawerOpen()) bumpUnseen(n);
    loadHistory();
    render();
    return;
  }
  render();
}

function updateRow(f) {
  if (!f) return;
  const row = document.querySelector(`.row[data-id="${f.id}"]`);
  if (!row) return;
  const prog = row.querySelector('.progress');
  prog.classList.add('show');
  prog.querySelector('i').style.width = `${Math.round((f.progress || 0) * 100)}%`;
  const st = row.querySelector('.status-line');
  st.classList.add('show');
  st.textContent = `转换中… ${Math.round((f.progress || 0) * 100)}%`;
}

// ---------------- 通用弹窗：确认 / 缺工具引导 ----------------
function askConfirm({ title, message, confirmText = '确定', danger = false }) {
  return new Promise((resolve) => {
    const mask = $('confirmModal');
    const ok = $('confirmOk');
    const cancel = $('confirmCancel');
    $('confirmTitle').textContent = title || '确认';
    $('confirmMsg').textContent = message || '';
    ok.textContent = confirmText;
    ok.classList.toggle('danger-solid', !!danger);
    mask.classList.add('show');

    const done = (val) => {
      mask.classList.remove('show');
      ok.onclick = null;
      cancel.onclick = null;
      mask.onclick = null;
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') done(false);
      else if (e.key === 'Enter') done(true);
    };
    ok.onclick = () => done(true);
    cancel.onclick = () => done(false);
    mask.onclick = (e) => { if (e.target === mask) done(false); };
    document.addEventListener('keydown', onKey);
    ok.focus();
  });
}

function toolMeta(id) {
  const t = (state.tools || []).find((x) => x.id === id);
  return t || { id, label: id, description: '' };
}

async function showMissingTools(ids) {
  if (!state.tools || !state.tools.length) {
    try { state.tools = await bridge.detectTools(); } catch {}
  }
  const list = $('missingList');
  list.innerHTML = '';
  for (const id of ids) {
    const t = toolMeta(id);
    const item = el('div', 'missing-item');
    item.appendChild(el('div', 'mi-name', t.label || id));
    if (t.description) item.appendChild(el('div', 'mi-desc', t.description));
    list.appendChild(item);
  }
  $('missingModal').classList.add('show');
}

// ---------------- 剪贴板粘贴 ----------------
async function pasteFromClipboard() {
  let res;
  try {
    res = await bridge.clipboardReadInputs();
  } catch {
    return;
  }
  const paths = (res && res.paths) || [];
  if (!paths.length) {
    log('剪贴板里没有可导入的文件或图片');
    return;
  }
  if (res.kind === 'image') log('已从剪贴板导入图片');
  await addPaths(paths);
}

// ---------------- 转换仓库（右侧抽屉） ----------------
function baseName(p) {
  return p ? p.split(/[\\/]/).pop() : '';
}

function relTime(ts) {
  if (!ts) return '';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return '刚刚';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

function stripExt(name) {
  return String(name).replace(/\.[^.]+$/, '');
}

/** 输出是否为带 BOM 的 UTF-8：仅 csv/tsv，且选项未显式关闭 */
function isBomOutput(r) {
  if (r.to !== 'csv' && r.to !== 'tsv') return false;
  return !(r.options && r.options.csvBom === false);
}

/** 文件名行：用了自定义名时显示「源名 → 输出名」 */
function nameLine(r) {
  const line = el('div', 'rec-name');
  const src = baseName(r.input);
  line.appendChild(document.createTextNode(src));
  const dst = r.output ? baseName(r.output) : '';
  const renamed = r.status === 'ok' && r.customName && dst && stripExt(dst) !== stripExt(src);
  if (renamed) {
    line.appendChild(el('span', 'rec-arrow', '→'));
    line.appendChild(el('span', 'rec-rename', dst));
  }
  line.title = renamed ? `${src} → ${dst}` : src;
  return line;
}

function isDrawerOpen() {
  return $('drawer').classList.contains('open');
}

function openDrawer() {
  $('drawer').classList.add('open');
  $('drawer').setAttribute('aria-hidden', 'false');
  $('drawerMask').classList.add('show');
  state.unseen = 0;
  updateWhCount();
  loadHistory();
}

function closeDrawer() {
  $('drawer').classList.remove('open');
  $('drawer').setAttribute('aria-hidden', 'true');
  $('drawerMask').classList.remove('show');
}

function bumpUnseen(n) {
  if (!n) return;
  state.unseen += n;
  updateWhCount();
}

function updateWhCount() {
  const badge = $('whCount');
  badge.hidden = state.unseen === 0;
  badge.textContent = state.unseen > 99 ? '99+' : String(state.unseen);
}

async function loadHistory() {
  try {
    state.history = await bridge.historyList();
  } catch {
    state.history = [];
  }
  renderHistory();
}

function recCard(r) {
  const card = el('div', `rec${r.status === 'failed' ? ' failed' : ''}`);
  card.dataset.id = r.id;

  const top = el('div', 'rec-top');
  const flow = el('div', 'rec-flow');
  flow.appendChild(el('span', 'chip-src', r.from || '?'));
  flow.appendChild(el('span', 'conn'));
  flow.appendChild(el('span', 'chip-dst', r.to || '?'));
  if (r.status === 'ok' && isBomOutput(r)) {
    const bom = el('span', 'chip-bom', 'BOM');
    bom.title = '输出为 UTF-8 带 BOM，Excel 打开中文不乱码';
    flow.appendChild(bom);
  }
  top.appendChild(flow);
  top.appendChild(el('span', 'rec-time', relTime(r.createdAt)));
  card.appendChild(top);

  card.appendChild(nameLine(r));

  const meta = el('div', 'rec-meta');
  if (r.status === 'failed') {
    meta.classList.add('err');
    meta.textContent = r.error || '转换失败';
  } else {
    meta.textContent = `${fmtSize(r.inputSize)} → ${fmtSize(r.outputSize)}`;
  }
  card.appendChild(meta);

  if (r.status === 'ok' && r.outputExists === false) {
    card.appendChild(el('div', 'rec-meta', '输出文件已不在原位置'));
  }
  if (r.inputExists === false) {
    card.appendChild(el('div', 'rec-meta', '源文件已不在原位置'));
  }

  const outOk = r.status === 'ok' && !!r.output && r.outputExists !== false;
  const revealPath = outOk ? r.output : r.inputExists !== false ? r.input : null;

  const acts = el('div', 'rec-acts');
  const mk = (label, cls, fn, disabled, title) => {
    const b = el('button', cls, label);
    b.disabled = !!disabled;
    if (title) b.title = title;
    b.onclick = fn;
    acts.appendChild(b);
  };
  mk('打开文件', '', () => bridge.openPath(r.output), !outOk);
  mk('打开位置', '', () => bridge.showItem(revealPath), !revealPath);
  mk('重新转换', '', () => reconvert(r.id), r.inputExists === false, r.inputExists === false ? '源文件已不在原位置' : '');
  mk('删除记录', 'danger', () => removeRecord(r.id));
  mk('删除文件', 'danger', () => trashOutput(r.id), !outOk, outOk ? '将输出文件送入回收站' : '没有可删除的输出文件');
  card.appendChild(acts);

  return card;
}

function renderHistory() {
  const body = $('whBody');
  body.innerHTML = '';

  const q = state.historyQuery.trim().toLowerCase();
  const list = state.history.filter((r) => {
    if (state.historyFilter !== 'all' && r.status !== state.historyFilter) return false;
    if (!q) return true;
    return `${r.input || ''} ${r.from || ''} ${r.to || ''}`.toLowerCase().includes(q);
  });

  if (!list.length) {
    const empty = el('div', 'dr-empty');
    if (state.history.length) {
      empty.appendChild(el('div', null, '没有匹配的记录'));
    } else {
      empty.appendChild(el('div', null, '还没有转换记录'));
      empty.appendChild(el('div', null, '转换完成后会自动收进这里'));
    }
    body.appendChild(empty);
  } else {
    for (const r of list) body.appendChild(recCard(r));
  }

  const total = state.history.length;
  const okN = state.history.filter((r) => r.status === 'ok').length;
  $('whStat').textContent = total ? `共 ${total} 条，成功 ${okN}，失败 ${total - okN}` : '';
}

async function reconvert(id) {
  const rec = state.history.find((r) => r.id === id);
  log(`重新转换：${baseName(rec && rec.input)}`);
  const res = await bridge.historyReconvert(id);
  if (res.ok) log(`✔ 已重新转换：${res.record.output}`);
  else log(`✘ 重新转换失败：${res.error}`);
  await loadHistory();
}

async function removeRecord(id) {
  const rec = state.history.find((r) => r.id === id);
  const ok = await askConfirm({
    title: '移除这条记录？',
    message: `只从仓库移除记录，磁盘上的文件不会动。\n${baseName(rec && rec.input)}`,
    confirmText: '移除记录',
  });
  if (!ok) return;
  await bridge.historyRemove(id);
  await loadHistory();
}

async function trashOutput(id) {
  const rec = state.history.find((r) => r.id === id);
  const ok = await askConfirm({
    title: '删除输出文件？',
    message: `文件会被送入回收站，可从回收站还原。\n${rec && rec.output ? baseName(rec.output) : ''}`,
    confirmText: '删除文件',
    danger: true,
  });
  if (!ok) return;
  const res = await bridge.historyTrashOutput(id);
  if (!res.ok) log(`✘ 删除输出文件失败：${res.error}`);
  else log('已把输出文件送入回收站');
  await loadHistory();
}

// ---------------- 工具页 ----------------
async function openTools() {
  $('toolsModal').classList.add('show');
  await refreshTools();
}

async function refreshTools() {
  state.tools = await bridge.detectTools();
  const body = $('toolsBody');
  body.innerHTML = '';
  for (const t of state.tools) {
    body.appendChild(renderTool(t));
  }
}

function renderTool(t) {
  const box = el('div', 'tool');
  box.dataset.tool = t.id;

  const head = el('div', 'thead');
  head.appendChild(el('div', 'tname', t.label));
  box.appendChild(head);
  box.appendChild(el('div', 'tdesc', t.description));

  const st = el('div', 'tstate');
  const dot = el('span', `dot ${t.found ? 'ok' : 'no'}`);
  st.appendChild(dot);
  st.appendChild(el('span', null, t.found ? `已就绪${t.version ? ' · v' + t.version : ''}` : '未安装'));
  box.appendChild(st);
  if (t.found) box.appendChild(el('div', 'pathline', t.exePath));

  const prog = el('div', 'tprog');
  prog.appendChild(el('i'));
  box.appendChild(prog);

  const acts = el('div', 'tactions');
  const installBtn = el('button', 'primary', t.found ? '重新安装 / 更新' : '下载并安装');
  acts.appendChild(installBtn);
  box.appendChild(acts);

  // PATH 开关
  if (t.found) {
    bridge.pathStatus(t.id).then(({ inUserPath }) => {
      const label = el('label', 'switch');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = inUserPath;
      cb.onchange = async () => {
        if (cb.checked) await bridge.addToPath(t.id);
        else await bridge.removeFromPath(t.id);
        log(`${cb.checked ? '已加入' : '已移出'}用户 PATH：${t.label}`);
      };
      label.appendChild(cb);
      label.appendChild(document.createTextNode('加入用户 PATH'));
      acts.appendChild(label);
    });
  }

  installBtn.onclick = () => doInstall(t.id, box, installBtn);
  return box;
}

async function doInstall(toolId, box, btn) {
  btn.disabled = true;
  const prog = box.querySelector('.tprog');
  const bar = prog.querySelector('i');
  prog.classList.add('show');
  bar.style.width = '0%';
  log(`开始安装 ${toolId}…`);

  const unsub = bridge.onToolProgress((p) => {
    if (p.toolId !== toolId) return;
    if (p.phase === 'download' && p.frac != null) {
      bar.style.width = `${Math.round(p.frac * 100)}%`;
    } else if (p.phase === 'log') {
      log(`   ${p.message}`);
    }
  });

  const res = await bridge.installTool(toolId);
  unsub();
  btn.disabled = false;

  if (res.ok) {
    bar.style.width = '100%';
    log(`✔ ${toolId} 安装完成`);
    await refreshTools();
  } else {
    log(`✘ ${toolId} 安装失败：${res.error}`);
    prog.classList.remove('show');
    alert(`安装失败：${res.error}`);
  }
}

// ---------------- 拖拽 ----------------
function initDnd() {
  const dz = $('dropzone');
  const body = document.body;

  dz.onclick = async () => addPaths(await bridge.pickFiles());

  body.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
  body.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null) dz.classList.remove('over');
  });
  body.addEventListener('drop', (e) => {
    e.preventDefault();
    dz.classList.remove('over');
    const paths = [];
    for (const f of e.dataTransfer.files) {
      try { const p = bridge.getPathForFile(f); if (p) paths.push(p); } catch {}
    }
    addPaths(paths);
  });
}

// ---------------- 交互绑定 ----------------
function init() {
  initTheme();
  initDnd();

  $('btnAdd').onclick = async () => addPaths(await bridge.pickFiles());
  $('btnConvert').onclick = startConvert;
  $('btnClear').onclick = () => { state.files = []; render(); };
  $('btnTools').onclick = openTools;
  $('logHead').onclick = () => toggleLog();
  $('btnAdvanced').onclick = () => $('advanced').classList.toggle('show');
  $('optCustomName').onchange = () => {
    state.customName = $('optCustomName').checked;
    render();
  };

  // 高级选项分类标签
  $('optTabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[role="tab"]');
    if (!btn) return;
    setCatTab(btn.dataset.cat);
  });
  $('presetSelect').onchange = () => {
    const p = state.presets.find((x) => x.id === $('presetSelect').value);
    $('btnPresetDel').disabled = !p;
    if (p) applyPreset(p);
  };
  $('btnPresetSave').onclick = savePreset;
  $('btnPresetDel').onclick = deletePreset;

  // 缺工具引导
  $('missingCancel').onclick = () => $('missingModal').classList.remove('show');
  $('missingGo').onclick = () => {
    $('missingModal').classList.remove('show');
    openTools();
  };
  $('missingModal').onclick = (e) => {
    if (e.target === $('missingModal')) $('missingModal').classList.remove('show');
  };

  // Ctrl+V 粘贴导入（输入框内不拦截）
  document.addEventListener('paste', (e) => {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    pasteFromClipboard();
  });

  // 转换仓库
  $('btnWarehouse').onclick = openDrawer;
  $('drawerClose').onclick = closeDrawer;
  $('drawerMask').onclick = closeDrawer;
  $('whSearch').oninput = () => { state.historyQuery = $('whSearch').value; renderHistory(); };
  $('whFilters').onclick = (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.historyFilter = chip.dataset.filter;
    for (const c of $('whFilters').children) c.classList.toggle('active', c === chip);
    renderHistory();
  };
  $('whClear').onclick = async () => {
    const ok = await askConfirm({
      title: '清空转换仓库？',
      message: '将移除全部记录，磁盘上的文件不受影响。',
      confirmText: '清空',
      danger: true,
    });
    if (!ok) return;
    await bridge.historyClear();
    state.unseen = 0;
    updateWhCount();
    await loadHistory();
    log('已清空转换仓库');
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isDrawerOpen()) closeDrawer();
  });

  $('toolsModal').onclick = (e) => {
    if (e.target === $('toolsModal')) $('toolsModal').classList.remove('show');
  };

  bridge.onConvertEvent(onConvertEvent);

  bridge.info().then((info) => {
    state.info = info;
    state.outputDir = null;
    $('appVer').textContent = 'v' + info.version;
    $('aboutVer').textContent = 'v' + info.version;
    $('outdirLabel').textContent = '输出目录：默认（下载文件夹）';
    $('optOutdir').value = '';
    $('optOutdir').placeholder = info.defaultOutputDir;
    for (const f of state.files) {
      f.catKey = (info.extCategory && info.extCategory[f.ext]) || '';
    }
    syncCatTab();
  });

  loadPresets();
  initHwEncoders();
  initUpdate();

  log('就绪。拖入文件或点击「选择文件」。');
}

// 输出目录选择（点击高级选项里的输入框）
function initOutdir() {
  $('optOutdir').addEventListener('click', async () => {
    const dir = await bridge.pickDir();
    if (dir) {
      state.outputDir = dir;
      $('optOutdir').value = dir;
      $('outdirLabel').textContent = '输出目录：' + dir;
    }
  });
}

init();
initOutdir();
