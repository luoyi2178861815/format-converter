'use strict';

const test = require('node:test');
const assert = require('node:assert');
const iconv = require('iconv-lite');

const { decodeText, encodeText } = require('../src/main/util/text');

test('自动识别 GBK/GB18030 中文', () => {
  const buf = iconv.encode('张三,研发,18500', 'gb18030');
  const { text, encoding } = decodeText(buf);
  assert.strictEqual(text, '张三,研发,18500');
  assert.strictEqual(encoding, 'gb18030');
});

test('无 BOM 的 UTF-8 判定为 utf8', () => {
  const { text, encoding } = decodeText(Buffer.from('中文 hello', 'utf8'));
  assert.strictEqual(text, '中文 hello');
  assert.strictEqual(encoding, 'utf8');
});

test('UTF-8 BOM 被剥除', () => {
  const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('标题', 'utf8')]);
  const { text, encoding } = decodeText(buf);
  assert.strictEqual(text, '标题');
  assert.strictEqual(encoding, 'utf8');
});

test('UTF-16LE BOM 被识别并剥除', () => {
  const buf = iconv.encode('中文文档', 'utf16-le', { addBOM: true });
  const { text, encoding } = decodeText(buf);
  assert.strictEqual(text, '中文文档');
  assert.strictEqual(encoding, 'utf16le');
});

test('forced 手动编码覆盖自动嗅探', () => {
  const buf = iconv.encode('手动指定', 'gb18030');
  const { text, encoding } = decodeText(buf, 'gbk');
  assert.strictEqual(text, '手动指定');
  assert.strictEqual(encoding, 'gb18030'); // gbk 归一为 gb18030
});

test('空内容不报错', () => {
  const { text, encoding } = decodeText(Buffer.alloc(0));
  assert.strictEqual(text, '');
  assert.strictEqual(encoding, 'utf8');
});

test('encodeText 默认不带 BOM', () => {
  const buf = encodeText('中文');
  assert.strictEqual(buf[0], 0xe4);
  assert.strictEqual(buf.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])), false);
});

test('encodeText bom:true 前置 UTF-8 BOM 且往返一致', () => {
  const buf = encodeText('姓名,部门', { bom: true });
  assert.ok(buf.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])));
  assert.strictEqual(decodeText(buf).text, '姓名,部门');
});
