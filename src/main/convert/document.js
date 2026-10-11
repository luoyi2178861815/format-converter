'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const { htmlToPdf, wrapHtml } = require('../util/htmlpdf');
const { decodeText } = require('../util/text');

// ---------- LibreOffice ----------
const WRITER = ['doc', 'docx', 'odt', 'rtf', 'txt', 'fodt'];
const CALC = ['xls', 'xlsx', 'ods', 'csv', 'fods'];
const IMPRESS = ['ppt', 'pptx', 'odp', 'fodp'];
const OFFICE_FROM = [...new Set([...WRITER, ...CALC, ...IMPRESS])];
const OFFICE_TO = [...new Set(['pdf', 'docx', 'odt', 'rtf', 'txt', 'html', 'epub', 'xlsx', 'ods', 'csv', 'pptx', 'odp'])];

function sofficeFilter(ext) {
  if (ext === 'txt') return 'txt:Text (encoded):UTF8';
  if (ext === 'csv') return 'csv:Text - txt - csv (StarCalc):44,34,76,1';
  return ext;
}

function runSoffice(soffice, input, ext, outDir, log, signal) {
  const profile = path.join(os.tmpdir(), 'fc_lo_profile');
  fs.mkdirSync(profile, { recursive: true });
  const args = [
    '--headless', '--norestore', '--invisible', '--nolockcheck', '--nodefault',
    `-env:UserInstallation=${pathToFileURL(profile).href}`,
    '--convert-to', sofficeFilter(ext),
    '--outdir', outDir,
    input,
  ];
  log(`soffice --convert-to ${ext}`);
  return new Promise((resolve, reject) => {
    const child = spawn(soffice, args, { windowsHide: true });
    const kill = () => { try { child.kill('SIGKILL'); } catch {} };
    if (signal) {
      if (signal.aborted) return kill(), reject(new Error('已取消'));
      signal.addEventListener('abort', kill, { once: true });
    }
    let err = '';
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', kill);
      code === 0 ? resolve() : reject(new Error(`LibreOffice 退出码 ${code}\n${err.slice(-500)}`));
    });
  });
}

async function convertOffice(ctx) {
  const { input, output, to, tools, options, onProgress, log, signal } = ctx;
  const soffice = tools.soffice;
  if (!soffice) throw new Error('未找到 LibreOffice，请先在「工具」页安装');
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc_lo_out_'));
  onProgress(0.15);
  await runSoffice(soffice, input, to, outDir, log, signal);
  onProgress(0.9);
  const produced = fs.readdirSync(outDir).map((f) => path.join(outDir, f))[0];
  if (!produced) throw new Error('LibreOffice 未生成输出文件');
  if (to === 'csv' && options.csvBom !== false) {
    // soffice 输出的 csv 无 BOM，Excel 打开中文会乱码
    fs.writeFileSync(output, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), fs.readFileSync(produced)]));
  } else {
    fs.copyFileSync(produced, output);
  }
  fs.rm(outDir, { recursive: true, force: true }, () => {});
  onProgress(1);
  return { output };
}

// ---------- 纯 JS 文档转换 ----------
function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function convertMarkdown(ctx) {
  const { input, output, to, options, onProgress, log } = ctx;
  const md = require('marked');
  const text = decodeText(fs.readFileSync(input), options.inputEncoding).text;
  onProgress(0.3);
  const render = md.parse ? md.parse(text) : md(text);
  const body = typeof render === 'string' ? render : await render;
  if (to === 'html') {
    fs.writeFileSync(output, wrapHtml(body));
  } else if (to === 'pdf') {
    log('渲染 HTML → PDF');
    await htmlToPdf(body, output);
  }
  onProgress(1);
  return { output };
}

async function convertHtmlToMd(ctx) {
  const { input, output, to, options, onProgress } = ctx;
  const text = decodeText(fs.readFileSync(input), options.inputEncoding).text;
  if (to === 'txt') {
    const stripped = text.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    fs.writeFileSync(output, stripped);
  } else {
    const TurndownService = require('turndown');
    const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
    fs.writeFileSync(output, td.turndown(text));
  }
  onProgress(1);
  return { output };
}

async function convertDocx(ctx) {
  const { input, output, to, onProgress, log } = ctx;
  const mammoth = require('mammoth');
  onProgress(0.3);
  if (to === 'txt') {
    const { value } = await mammoth.extractRawText({ path: input });
    fs.writeFileSync(output, value);
  } else {
    const { value } = await mammoth.convertToHtml({ path: input });
    if (to === 'md') {
      const TurndownService = require('turndown');
      const td = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
      fs.writeFileSync(output, td.turndown(value));
    } else if (to === 'pdf') {
      log('渲染 HTML → PDF');
      await htmlToPdf(value, output);
    } else {
      fs.writeFileSync(output, wrapHtml(value));
    }
  }
  onProgress(1);
  return { output };
}

async function convertPdfToText(ctx) {
  const { input, output, onProgress } = ctx;
  const pdfParse = require('pdf-parse');
  const buf = fs.readFileSync(input);
  onProgress(0.4);
  const data = await pdfParse(buf);
  fs.writeFileSync(output, data.text || '');
  onProgress(1);
  return { output };
}

async function convertTextToPdf(ctx) {
  const { input, output, from, options, onProgress, log } = ctx;
  const text = decodeText(fs.readFileSync(input), options.inputEncoding).text;
  const isHtml = from === 'html' || from === 'htm';
  const body = isHtml ? text : `<pre>${escapeHtml(text)}</pre>`;
  log('渲染 HTML → PDF');
  onProgress(0.3);
  await htmlToPdf(body, output);
  onProgress(1);
  return { output };
}

async function convertImageToPdf(ctx) {
  const { input, output, from, onProgress } = ctx;
  const { PDFDocument } = require('pdf-lib');
  const sharp = require('sharp');
  onProgress(0.3);
  const pdf = await PDFDocument.create();
  const png = await sharp(input).png().toBuffer();
  const img = await pdf.embedPng(png);
  const page = pdf.addPage([img.width, img.height]);
  page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  fs.writeFileSync(output, await pdf.save());
  onProgress(1);
  return { output };
}

const IMG_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'tiff', 'tif', 'bmp', 'avif'];

module.exports = [
  {
    id: 'document.libreoffice',
    category: 'document',
    label: '办公文档 (LibreOffice)',
    from: OFFICE_FROM,
    to: OFFICE_TO,
    requires: ['soffice'],
    priority: 10,
    convert: convertOffice,
  },
  {
    id: 'document.docx',
    category: 'document',
    label: 'Word 文档',
    from: ['docx'],
    to: ['html', 'txt', 'md', 'pdf'],
    requires: [],
    priority: 50,
    convert: convertDocx,
  },
  {
    id: 'document.markdown',
    category: 'document',
    label: 'Markdown',
    from: ['md', 'markdown'],
    to: ['html', 'pdf'],
    requires: [],
    priority: 50,
    convert: convertMarkdown,
  },
  {
    id: 'document.html',
    category: 'document',
    label: 'HTML',
    from: ['html', 'htm'],
    to: ['md', 'txt', 'pdf'],
    requires: [],
    priority: 60,
    convert: (ctx) => (ctx.to === 'pdf' ? convertTextToPdf(ctx) : convertHtmlToMd(ctx)),
  },
  {
    id: 'document.txt',
    category: 'document',
    label: '纯文本',
    from: ['txt'],
    to: ['pdf'],
    requires: [],
    priority: 60,
    convert: convertTextToPdf,
  },
  {
    id: 'document.pdftext',
    category: 'document',
    label: 'PDF 提取文本',
    from: ['pdf'],
    to: ['txt'],
    requires: [],
    priority: 60,
    convert: convertPdfToText,
  },
  {
    id: 'document.imagetopdf',
    category: 'document',
    label: '图片转 PDF',
    from: IMG_EXTS,
    to: ['pdf'],
    requires: [],
    priority: 60,
    convert: convertImageToPdf,
  },
];

module.exports.IMG_EXTS = IMG_EXTS;
