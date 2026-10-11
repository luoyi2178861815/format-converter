'use strict';

const fs = require('fs');
const path = require('path');

// 串行化 + 复用单个隐藏窗口：避免反复创建窗口导致 printToPDF 不稳定
let chain = Promise.resolve();
let win = null;

const BASE_CSS = `
  html,body{margin:0;padding:0;}
  body{font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;font-size:14px;line-height:1.7;color:#111;padding:24px 28px;}
  pre{white-space:pre-wrap;word-wrap:break-word;font-family:Consolas,"Courier New",monospace;font-size:13px;}
  img{max-width:100%;}
  table{border-collapse:collapse;}
  th,td{border:1px solid #ccc;padding:4px 8px;}
  code{background:#f2f2f2;padding:1px 4px;border-radius:3px;}
  pre code{background:none;padding:0;}
  h1,h2,h3{line-height:1.3;}
`;

function wrapHtml(bodyHtml) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body>${bodyHtml}</body></html>`;
}

function getWindow() {
  const { BrowserWindow } = require('electron');
  if (!win || win.isDestroyed()) {
    win = new BrowserWindow({
      show: false,
      width: 1024,
      height: 1400,
      webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false },
    });
  }
  return win;
}

async function doHtmlToPdf(html, outPath, opts) {
  const full = opts.standalone === false ? html : wrapHtml(html);
  const url = 'data:text/html;charset=utf-8;base64,' + Buffer.from(full, 'utf8').toString('base64');
  const w = getWindow();
  await w.loadURL(url);
  await new Promise((r) => setTimeout(r, 120));
  const pdf = await w.webContents.printToPDF({
    printBackground: true,
    pageSize: opts.pageSize || 'A4',
    margins: { marginType: 'custom', top: 0.6, bottom: 0.6, left: 0.7, right: 0.7 },
  });
  fs.writeFileSync(outPath, pdf);
  return outPath;
}

/** 用 Electron 隐藏窗口把 HTML 渲染成 PDF（无需外部工具） */
function htmlToPdf(html, outPath, opts = {}) {
  const run = () => doHtmlToPdf(html, outPath, opts);
  const result = chain.then(run, run);
  chain = result.catch(() => {});
  return result;
}

function dispose() {
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}

module.exports = { htmlToPdf, wrapHtml, dispose, BASE_CSS };
