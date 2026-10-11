'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const C = require('../src/main/convert');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'fc_test_'));
}

async function convert(input, to, outDir) {
  return C.runJob(
    { id: 1, input, to },
    { outDir, availableTools: new Set(), tools: {}, onEvent: () => {} }
  );
}

test('json → csv 生成带表头的表格', async () => {
  const dir = tmpDir();
  const inp = path.join(dir, 'a.json');
  fs.writeFileSync(inp, JSON.stringify([{ name: '张三', age: 30 }, { name: 'Li', age: 25 }]));
  const r = await convert(inp, 'csv', dir);
  const csv = fs.readFileSync(r.output, 'utf8');
  assert.match(csv, /name,age/);
  assert.match(csv, /张三,30/);
  assert.match(csv, /Li,25/);
});

test('csv → json 得到对象数组', async () => {
  const dir = tmpDir();
  const inp = path.join(dir, 'a.csv');
  fs.writeFileSync(inp, 'a,b\n1,2\n3,4\n');
  const r = await convert(inp, 'json', dir);
  const data = JSON.parse(fs.readFileSync(r.output, 'utf8'));
  assert.deepStrictEqual(data, [{ a: 1, b: 2 }, { a: 3, b: 4 }]);
});

test('json → yaml → json 往返保持一致', async () => {
  const dir = tmpDir();
  const original = { name: 'x', list: [1, 2, 3], nested: { ok: true } };
  const inp = path.join(dir, 'a.json');
  fs.writeFileSync(inp, JSON.stringify(original));
  const y = await convert(inp, 'yaml', dir);
  const back = await convert(y.output, 'json', dir);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(back.output, 'utf8')), original);
});

test('json → xlsx → json 往返保持一致', async () => {
  const dir = tmpDir();
  const rows = [{ a: 1, b: 'x' }, { a: 2, b: 'y' }];
  const inp = path.join(dir, 'a.json');
  fs.writeFileSync(inp, JSON.stringify(rows));
  const x = await convert(inp, 'xlsx', dir);
  const back = await convert(x.output, 'json', dir);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(back.output, 'utf8')), rows);
});

test('json → xml 生成带根节点', async () => {
  const dir = tmpDir();
  const inp = path.join(dir, 'a.json');
  fs.writeFileSync(inp, JSON.stringify([{ id: 1 }, { id: 2 }]));
  const r = await convert(inp, 'xml', dir);
  const xml = fs.readFileSync(r.output, 'utf8');
  assert.match(xml, /<root>/);
  assert.match(xml, /<item>/);
});

test('json 压缩选项生效', async () => {
  const dir = tmpDir();
  const inp = path.join(dir, 'a.json');
  fs.writeFileSync(inp, JSON.stringify({ a: 1, b: [1, 2] }));
  const r = await C.runJob(
    { id: 1, input: inp, to: 'json', options: { minify: true } },
    { outDir: dir, availableTools: new Set(), tools: {}, onEvent: () => {} }
  );
  assert.strictEqual(fs.readFileSync(r.output, 'utf8'), '{"a":1,"b":[1,2]}');
});

test('不支持的方向会报错', async () => {
  const dir = tmpDir();
  const inp = path.join(dir, 'a.json');
  fs.writeFileSync(inp, '{}');
  await assert.rejects(
    () => C.runJob({ id: 1, input: inp, to: 'png' }, { outDir: dir, availableTools: new Set(), tools: {}, onEvent: () => {} }),
    /不支持/
  );
});
