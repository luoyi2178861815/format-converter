'use strict';
/**
 * 生成 test-data/ 下的样例文件，覆盖四大类输入格式，用于手工测试。
 * 运行：node scripts/gen-testdata.js
 *
 * 依赖外部工具 ffmpeg / soffice（由 src/main/tools/detect 探测），
 * 用于生成真实的视频、音频与办公文档；纯 JS 部分用 sharp / xlsx / js-yaml。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const sharp = require('sharp');
const bmp = require('bmp-js');
const XLSX = require('xlsx');
const yaml = require('js-yaml');

const { detectAll } = require('../src/main/tools/detect');

const TOOLS = {};
for (const t of detectAll()) if (t.found) TOOLS[t.id] = t.exePath;
const FFMPEG = TOOLS.ffmpeg;
const SOFFICE = TOOLS.soffice;

const ROOT = path.join(__dirname, '..', 'test-data');
const IMG = path.join(ROOT, 'images');
const MED = path.join(ROOT, 'media');
const DOC = path.join(ROOT, 'documents');
const DATA = path.join(ROOT, 'data');
[IMG, MED, DOC, DATA].forEach((d) => fs.mkdirSync(d, { recursive: true }));

const log = [];
function ok(f) { log.push(['OK  ', path.relative(ROOT, f)]); }
function fail(name, e) { log.push(['FAIL', `${name}  (${e.message.split('\n')[0].slice(0, 80)})`]); }

async function step(name, fn) {
  try { await fn(); } catch (e) { fail(name, e); }
}

// ---------- 图片 ----------
async function genImages() {
  const grad = await sharp({
    create: { width: 320, height: 240, channels: 3, background: { r: 60, g: 120, b: 200 } },
  })
    .composite([{
      input: Buffer.from(
        `<svg width="320" height="240"><rect x="40" y="40" width="120" height="80" fill="#e05555"/>` +
        `<circle cx="230" cy="140" r="60" fill="#f0c040"/><text x="16" y="224" font-size="20" fill="#fff">测试图片</text></svg>`
      ),
      top: 0, left: 0,
    }])
    .png()
    .toBuffer();

  const targets = [
    ['photo.png', 'png', {}],
    ['photo.jpg', 'jpeg', { quality: 85 }],
    ['photo.webp', 'webp', { quality: 80 }],
    ['photo.avif', 'avif', { quality: 60 }],
    ['photo.tiff', 'tiff', {}],
  ];
  for (const [name, fmt, opts] of targets) {
    await step(name, async () => {
      const f = path.join(IMG, name);
      await sharp(grad)[fmt](opts).toFile(f);
      ok(f);
    });
  }

  await step('transparent.png', async () => {
    const f = path.join(IMG, 'transparent.png');
    await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 30, g: 200, b: 120, alpha: 0.5 } } })
      .png().toFile(f);
    ok(f);
  });

  // BMP（bmp-js 需要原始像素）
  await step('photo.bmp', async () => {
    const { data, info } = await sharp(grad).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const buf = bmp.encode({ data, width: info.width, height: info.height });
    const f = path.join(IMG, 'photo.bmp');
    fs.writeFileSync(f, buf.data);
    ok(f);
  });

  await step('vector.svg', async () => {
    const f = path.join(IMG, 'vector.svg');
    fs.writeFileSync(f,
      `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="180" viewBox="0 0 240 180">` +
      `<rect width="240" height="180" fill="#1f6feb"/>` +
      `<polygon points="120,24 216,156 24,156" fill="#ffd43b"/>` +
      `<text x="120" y="140" font-size="22" text-anchor="middle" fill="#111">SVG 矢量</text></svg>`);
    ok(f);
  });

  // 动图 GIF
  await step('anim.gif', async () => {
    const f = path.join(IMG, 'anim.gif');
    execFileSync(FFMPEG, ['-hide_banner', '-y', '-f', 'lavfi',
      '-i', 'testsrc=size=160x120:rate=10', '-t', '2', '-loop', '0', f], { stdio: 'ignore' });
    ok(f);
  });
  // 注：不生成 .ico —— sharp/libvips 无法解码 ICO，应用只支持“输出为 ico”，不支持以 ico 作为输入。
}

// ---------- 音视频 ----------
function ffmpegGen(out, args, name) {
  try {
    execFileSync(FFMPEG, ['-hide_banner', '-nostdin', '-y', ...args, out], { stdio: 'ignore' });
    ok(out);
  } catch (e) { fail(name, e); }
}

function genMedia() {
  const VIN = ['-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15'];
  const AIN = ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100'];
  const T = ['-t', '2'];

  ffmpegGen(path.join(MED, 'clip.mp4'),
    [...VIN, ...AIN, ...T, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest'], 'clip.mp4');
  ffmpegGen(path.join(MED, 'clip.mkv'),
    [...VIN, ...AIN, ...T, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest'], 'clip.mkv');
  ffmpegGen(path.join(MED, 'clip.webm'),
    [...VIN, ...AIN, ...T, '-c:v', 'libvpx-vp9', '-b:v', '300k', '-c:a', 'libopus', '-shortest'], 'clip.webm');
  ffmpegGen(path.join(MED, 'clip.avi'),
    [...VIN, ...T, '-c:v', 'mpeg4', '-q:v', '5', '-an'], 'clip.avi');
  ffmpegGen(path.join(MED, 'clip.mov'),
    [...VIN, ...AIN, ...T, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest'], 'clip.mov');
  ffmpegGen(path.join(MED, 'clip.flv'),
    [...VIN, ...AIN, ...T, '-c:v', 'flv1', '-c:a', 'libmp3lame', '-ar', '44100', '-shortest'], 'clip.flv');
  ffmpegGen(path.join(MED, 'clip.wmv'),
    [...VIN, ...AIN, ...T, '-c:v', 'msmpeg4', '-c:a', 'wmav2', '-shortest'], 'clip.wmv');
  ffmpegGen(path.join(MED, 'clip.ts'),
    [...VIN, ...AIN, ...T, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest'], 'clip.ts');

  const audio = [
    ['sound.mp3', ['-c:a', 'libmp3lame', '-b:a', '192k']],
    ['sound.wav', ['-c:a', 'pcm_s16le']],
    ['sound.flac', ['-c:a', 'flac']],
    ['sound.m4a', ['-c:a', 'aac', '-b:a', '128k']],
    ['sound.ogg', ['-c:a', 'libvorbis', '-q:a', '4']],
    ['sound.opus', ['-c:a', 'libopus', '-b:a', '96k']],
    ['sound.wma', ['-c:a', 'wmav2']],
    ['sound.ac3', ['-c:a', 'ac3']],
  ];
  for (const [name, enc] of audio) {
    ffmpegGen(path.join(MED, name), [...AIN, ...T, ...enc], name);
  }
}

// ---------- 文档（借助 LibreOffice 生成真实二进制文档） ----------
function soffice(fromPath, to, outDir, name, renameBase) {
  const profile = path.join(os.tmpdir(), 'fc_gen_profile');
  fs.mkdirSync(profile, { recursive: true });
  try {
    execFileSync(SOFFICE, [
      '--headless', '--norestore', '--invisible', '--nolockcheck', '--nodefault',
      `-env:UserInstallation=${require('url').pathToFileURL(profile).href}`,
      '--convert-to', to, '--outdir', outDir, fromPath,
    ], { stdio: 'ignore', timeout: 90000 });
    const base = path.basename(fromPath, path.extname(fromPath));
    const ext = to.split(':')[0];
    let produced = path.join(outDir, `${base}.${ext}`);
    if (!fs.existsSync(produced)) throw new Error('未生成输出');
    if (renameBase) {
      const target = path.join(outDir, `${renameBase}.${ext}`);
      fs.renameSync(produced, target);
      produced = target;
    }
    ok(produced); return produced;
  } catch (e) { fail(name, e); return null; }
}

async function genDocuments() {
  const src = path.join(DOC, '_src.txt');
  fs.writeFileSync(src,
    '格式转换工具 测试文档\n\n' +
    '第一段：这是一段用于测试的纯文本内容。\n' +
    '第二段：The quick brown fox jumps over the lazy dog.\n' +
    '第三段：数字 0123456789，符号 !@#$%^&*()。\n');

  const txt = path.join(DOC, 'note.txt');
  fs.copyFileSync(src, txt); ok(txt);

  const md = path.join(DOC, 'readme.md');
  fs.writeFileSync(md,
    '# 标题一\n\n这是 **Markdown** 测试。\n\n' +
    '## 列表\n\n- 项目 A\n- 项目 B\n\n' +
    '| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 3 |\n| 香蕉 | 5 |\n\n' +
    '```js\nconsole.log("hello");\n```\n');
  ok(md);

  const html = path.join(DOC, 'page.html');
  fs.writeFileSync(html,
    '<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>测试页</title></head>' +
    '<body><h1>HTML 测试页</h1><p>这是一个用于测试的 <b>HTML</b> 文件。</p>' +
    '<ul><li>条目一</li><li>条目二</li></ul></body></html>');
  ok(html);

  // 由 txt 派生的办公文档
  soffice(txt, 'docx', DOC, 'report.docx', 'report');
  soffice(txt, 'odt', DOC, 'report.odt', 'report');
  soffice(txt, 'rtf', DOC, 'report.rtf', 'report');
  soffice(txt, 'doc', DOC, 'legacy.doc', 'legacy');
  soffice(txt, 'pdf', DOC, 'report.pdf', 'report');

  // 表格类：先造 xlsx，再派生 ods / xls
  const rows = [
    ['姓名', '部门', '工资', '入职日期'],
    ['张三', '研发', 18500, '2021-03-01'],
    ['李四', '市场', 15200, '2022-07-15'],
    ['王五', '财务', 16800, '2020-11-20'],
    ['赵六', '研发', 21000, '2019-05-06'],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '员工');
  XLSX.writeFile(wb, path.join(DOC, 'sheet.xlsx'));
  ok(path.join(DOC, 'sheet.xlsx'));

  const xlsx = path.join(DOC, 'sheet.xlsx');
  soffice(xlsx, 'ods', DOC, 'sheet.ods', 'sheet');
  soffice(xlsx, 'xls', DOC, 'legacy.xls', 'legacy');

  // 演示文稿：手写最小 flat ODP，再由 soffice 转出 pptx / odp
  const fodp = path.join(DOC, '_src.fodp');
  fs.writeFileSync(fodp,
    `<?xml version="1.0" encoding="UTF-8"?>
<office:document xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
 xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
 xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"
 xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"
 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
 xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"
 xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
 office:version="1.2" office:mimetype="application/vnd.oasis.opendocument.presentation">
 <office:body><office:presentation>
  <draw:page draw:name="page1" draw:master-page-name="Default">
   <draw:frame presentation:style-name="pr1" draw:layer="layout" svg:width="24cm" svg:height="4cm" svg:x="2cm" svg:y="3cm">
    <draw:text-box><text:p>格式转换工具 测试幻灯片</text:p></draw:text-box>
   </draw:frame>
   <draw:frame presentation:style-name="pr1" draw:layer="layout" svg:width="24cm" svg:height="3cm" svg:x="2cm" svg:y="8cm">
    <draw:text-box><text:p>第二行内容 · Slide 2 bullet</text:p></draw:text-box>
   </draw:frame>
  </draw:page>
 </office:presentation></office:body>
</office:document>`);
  const pptx = soffice(fodp, 'pptx', DOC, 'slides.pptx', 'slides');
  if (pptx) soffice(fodp, 'odp', DOC, 'slides.odp', 'slides');

  for (const f of [src, fodp]) { try { fs.rmSync(f); } catch {} }
}

// ---------- 数据文件 ----------
function genData() {
  const people = [
    { id: 1, name: '张三', dept: '研发', salary: 18500, active: true },
    { id: 2, name: '李四', dept: '市场', salary: 15200, active: false },
    { id: 3, name: '王五', dept: '财务', salary: 16800, active: true },
  ];

  const json = path.join(DATA, 'data.json');
  fs.writeFileSync(json, JSON.stringify(people, null, 2)); ok(json);

  const objJson = path.join(DATA, 'config.json');
  fs.writeFileSync(objJson, JSON.stringify({ app: '格式转换工具', version: '1.0.0', debug: false, themes: ['dark', 'light'] }, null, 2));
  ok(objJson);

  const yml = path.join(DATA, 'data.yaml');
  fs.writeFileSync(yml, yaml.dump({ people, note: 'YAML 测试数据' })); ok(yml);

  const xml = path.join(DATA, 'data.xml');
  fs.writeFileSync(xml,
    '<?xml version="1.0" encoding="UTF-8"?>\n<people>\n' +
    people.map((p) => `  <person><id>${p.id}</id><name>${p.name}</name><dept>${p.dept}</dept><salary>${p.salary}</salary></person>`).join('\n') +
    '\n</people>\n'); ok(xml);

  const csv = path.join(DATA, 'data.csv');
  fs.writeFileSync(csv, '﻿' + XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(people))); ok(csv);

  const tsv = path.join(DATA, 'data.tsv');
  fs.writeFileSync(tsv, XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(people), { FS: '\t' })); ok(tsv);

  const xlsx = path.join(DATA, 'data.xlsx');
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(people), 'people');
  XLSX.writeFile(wb, xlsx); ok(xlsx);
}

(async () => {
  await genImages();
  genMedia();
  await genDocuments();
  genData();

  console.log('工具:', Object.keys(TOOLS).join(', '));
  console.log('\n结果:');
  for (const [s, f] of log) console.log(`  ${s} ${f}`);

  console.log('\n目录统计:');
  for (const [label, dir] of [['images', IMG], ['media', MED], ['documents', DOC], ['data', DATA]]) {
    const files = fs.readdirSync(dir);
    console.log(`  ${label}/ (${files.length}): ${files.join(', ')}`);
  }
})();
