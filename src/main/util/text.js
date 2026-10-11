'use strict';

const iconv = require('iconv-lite');

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
const UTF16LE_BOM = Buffer.from([0xff, 0xfe]);
const UTF16BE_BOM = Buffer.from([0xfe, 0xff]);

/** 用户可选编码的别名归一（GB2312/GBK 都是 GB18030 的子集） */
const ALIAS = {
  utf8: 'utf8',
  'utf-8': 'utf8',
  gb18030: 'gb18030',
  gbk: 'gb18030',
  gb2312: 'gb18030',
  big5: 'big5',
  utf16le: 'utf16le',
  'utf-16le': 'utf16le',
  utf16be: 'utf16be',
  'utf-16be': 'utf16be',
};

function startsWith(buf, sig) {
  return buf.length >= sig.length && buf.subarray(0, sig.length).equals(sig);
}

function stripBomChar(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/**
 * 把字节解码为文本。
 * 自动模式：BOM 嗅探 -> UTF-8 严格校验 -> 回退 GB18030。
 * forced 指定编码时以指定为准（用于自动判断失败后手动兜底）。
 * @returns {{text: string, encoding: string}}
 */
function decodeText(buf, forced) {
  const name = forced ? ALIAS[String(forced).toLowerCase()] : null;
  if (name) {
    const text = iconv.decode(buf, name === 'utf16le' ? 'utf16-le' : name === 'utf16be' ? 'utf16-be' : name);
    return { text: stripBomChar(text), encoding: name };
  }

  if (startsWith(buf, UTF8_BOM)) {
    return { text: stripBomChar(buf.subarray(3).toString('utf8')), encoding: 'utf8' };
  }
  if (startsWith(buf, UTF16LE_BOM)) {
    return { text: stripBomChar(iconv.decode(buf, 'utf16-le')), encoding: 'utf16le' };
  }
  if (startsWith(buf, UTF16BE_BOM)) {
    return { text: stripBomChar(iconv.decode(buf, 'utf16-be')), encoding: 'utf16be' };
  }

  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return { text, encoding: 'utf8' };
  } catch {
    return { text: iconv.decode(buf, 'gb18030'), encoding: 'gb18030' };
  }
}

/**
 * 把文本编码为字节。bom 为真时前置 UTF-8 BOM（便于 Excel 正确识别中文）。
 */
function encodeText(text, { bom = false } = {}) {
  const body = Buffer.from(text, 'utf8');
  return bom ? Buffer.concat([UTF8_BOM, body]) : body;
}

/** 供 UI/日志显示的编码名 */
const ENCODINGS = [
  { value: '', label: '自动' },
  { value: 'utf8', label: 'UTF-8' },
  { value: 'gb18030', label: 'GBK / GB18030' },
  { value: 'utf16le', label: 'UTF-16 LE' },
  { value: 'big5', label: 'Big5' },
];

module.exports = { decodeText, encodeText, ENCODINGS };
