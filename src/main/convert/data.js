'use strict';

const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const XLSX = require('xlsx');
const yaml = require('js-yaml');
const { XMLParser, XMLBuilder } = require('fast-xml-parser');
const { decodeText, encodeText } = require('../util/text');

const TABULAR = ['csv', 'tsv', 'xlsx'];

const XML_OPTS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  format: true,
  suppressEmptyNode: true,
};

/** 解析任意结构化文本 -> JS 结构 */
function parseData(input, ext, options = {}) {
  const read = () => options._buf || fs.readFileSync(input);
  switch (ext) {
    case 'json': {
      const t = decodeText(read(), options.inputEncoding).text;
      if (t.trim() === '') return null;
      return JSON.parse(t);
    }
    case 'yaml':
    case 'yml':
      return yaml.load(decodeText(read(), options.inputEncoding).text);
    case 'csv':
    case 'tsv': {
      const text = decodeText(read(), options.inputEncoding).text;
      const res = Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: true,
        delimiter: ext === 'tsv' ? '\t' : undefined,
      });
      if (res.errors && res.errors.length && !res.data.length) {
        throw new Error(res.errors[0].message);
      }
      return res.data;
    }
    case 'xlsx':
    case 'xls': {
      const wb = XLSX.readFile(input);
      const sheet = wb.Sheets[wb.SheetNames[0]];
      return XLSX.utils.sheet_to_json(sheet, { defval: null });
    }
    case 'xml': {
      const parser = new XMLParser(XML_OPTS);
      return parser.parse(decodeText(read(), options.inputEncoding).text);
    }
    default:
      throw new Error(`不确定的数据格式: .${ext}`);
  }
}

/** 把任意结构规整成「记录数组」（用于表格类输出） */
function asRecords(data) {
  if (Array.isArray(data)) {
    return data.map((r) =>
      r && typeof r === 'object' && !Array.isArray(r) ? r : { value: r }
    );
  }
  if (data && typeof data === 'object') {
    for (const v of Object.values(data)) {
      if (Array.isArray(v) && v.length && typeof v[0] === 'object') return v;
    }
    return [data];
  }
  return [{ value: data }];
}

/** JS 结构 -> 目标格式内容（返回 Buffer 或 string） */
function serializeData(data, ext, options = {}) {
  switch (ext) {
    case 'json':
      return options.minify
        ? JSON.stringify(data)
        : JSON.stringify(data, null, 2);
    case 'yaml':
    case 'yml':
      return yaml.dump(data, { lineWidth: -1, noRefs: true });
    case 'csv':
    case 'tsv': {
      const recs = asRecords(data);
      return Papa.unparse(recs, { delimiter: ext === 'tsv' ? '\t' : ',' });
    }
    case 'xml': {
      const builder = new XMLBuilder(XML_OPTS);
      const root = Array.isArray(data) ? { root: { item: data } } : data;
      return '<?xml version="1.0" encoding="UTF-8"?>\n' + builder.build(root);
    }
    case 'xlsx': {
      const recs = asRecords(data);
      const ws = XLSX.utils.json_to_sheet(recs);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    }
    default:
      throw new Error(`不支持输出为 .${ext}`);
  }
}

const TEXT_EXTS = ['json', 'yaml', 'yml', 'csv', 'tsv', 'xml'];

async function convert(ctx) {
  const { input, output, from, to, options, onProgress, log } = ctx;
  log(`读取 ${path.basename(input)} (.${from})`);
  onProgress(0.2);

  let data;
  if (TEXT_EXTS.includes(from)) {
    const buf = fs.readFileSync(input);
    const { encoding } = decodeText(buf, options.inputEncoding);
    if (encoding !== 'utf8') log(`   输入编码检测为 ${encoding}`);
    data = parseData(input, from, { ...options, _buf: buf });
  } else {
    data = parseData(input, from, options);
  }

  onProgress(0.6);
  log(`转换为 .${to}`);
  const out = serializeData(data, to, options);
  const buf = typeof out === 'string'
    ? encodeText(out, { bom: (to === 'csv' || to === 'tsv') && options.csvBom !== false })
    : out;
  fs.writeFileSync(output, buf);
  onProgress(1);
  return { output };
}

const DATA_EXTS = ['json', 'yaml', 'yml', 'csv', 'tsv', 'xlsx', 'xls', 'xml'];

module.exports = [
  {
    id: 'data.structured',
    category: 'data',
    label: '数据文件',
    from: DATA_EXTS,
    to: ['json', 'yaml', 'csv', 'tsv', 'xlsx', 'xml'],
    requires: [],
    convert,
  },
];

module.exports.TABULAR = TABULAR;
module.exports.parseData = parseData;
module.exports.serializeData = serializeData;
