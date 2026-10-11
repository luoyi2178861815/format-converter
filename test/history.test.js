'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const H = require('../src/main/history');

function useTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc_hist_'));
  process.env.FC_HISTORY_DIR = dir;
  H._resetForTests();
  return dir;
}

function rec(over = {}) {
  return {
    input: over.input || 'C:/in/a.json',
    output: over.output || 'C:/out/a.csv',
    from: 'json', to: 'csv', category: 'data',
    converterId: 'data.structured', status: 'ok', ...over,
  };
}

test('新增记录后可列出，含文件存在性标记', () => {
  const dir = useTmpDir();
  const input = path.join(dir, 'in.json');
  const output = path.join(dir, 'out.csv');
  fs.writeFileSync(input, '{}');
  fs.writeFileSync(output, 'a,b\n');
  H.add(rec({ input, output }));

  const list = H.list();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].status, 'ok');
  assert.strictEqual(list[0].inputExists, true);
  assert.strictEqual(list[0].outputExists, true);
  assert.ok(list[0].id);
});

test('输出文件被删后 outputExists 为 false', () => {
  const dir = useTmpDir();
  const output = path.join(dir, 'gone.csv');
  fs.writeFileSync(output, 'x');
  H.add(rec({ input: path.join(dir, 'nope.json'), output }));
  fs.rmSync(output);

  const r = H.list()[0];
  assert.strictEqual(r.outputExists, false);
  assert.strictEqual(r.inputExists, false);
});

test('新记录排在最前', () => {
  useTmpDir();
  H.add(rec({ output: 'first.csv' }));
  H.add(rec({ output: 'second.csv' }));
  const list = H.list();
  assert.strictEqual(list[0].output, 'second.csv');
  assert.strictEqual(list[1].output, 'first.csv');
});

test('超过上限 500 会丢弃最旧记录', () => {
  useTmpDir();
  const many = Array.from({ length: H.MAX_RECORDS + 10 }, (_, i) => rec({ output: `o${i}.csv` }));
  H.addMany(many);
  const list = H.list();
  assert.strictEqual(list.length, H.MAX_RECORDS);
  // 最新的 o509 在前面，最早的 o0..o9 被丢弃
  assert.strictEqual(list[0].output, `o${many.length - 1}.csv`);
  assert.ok(!list.some((r) => r.output === 'o0.csv'));
});

test('removeRecord 只移除指定记录', () => {
  useTmpDir();
  const a = H.add(rec({ output: 'a.csv' }));
  H.add(rec({ output: 'b.csv' }));
  assert.strictEqual(H.removeRecord(a.id), true);
  const list = H.list();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].output, 'b.csv');
  assert.strictEqual(H.removeRecord('不存在'), false);
});

test('clear 清空全部记录', () => {
  useTmpDir();
  H.addMany([rec(), rec(), rec()]);
  H.clear();
  assert.strictEqual(H.list().length, 0);
});

test('持久化为合法 JSON 且不留 .tmp', () => {
  const dir = useTmpDir();
  H.add(rec({ output: 'x.csv', status: 'failed', error: '需要先安装：ffmpeg' }));
  const p = H.filePath();
  assert.ok(fs.existsSync(p));
  assert.ok(!fs.existsSync(`${p}.tmp`));
  const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.strictEqual(parsed.schemaVersion, 1);
  assert.strictEqual(parsed.records[0].error, '需要先安装：ffmpeg');
  assert.strictEqual(parsed.records[0].status, 'failed');
});

test('失败记录不会被误标为成功', () => {
  useTmpDir();
  H.add(rec({ status: 'failed' }));
  assert.strictEqual(H.list()[0].status, 'failed');
  H.add(rec({ status: 'ok' }));
  assert.strictEqual(H.list()[0].status, 'ok');
});

test('getRecord 按 id 取回记录', () => {
  useTmpDir();
  const a = H.add(rec({ output: 'a.csv' }));
  assert.strictEqual(H.getRecord(a.id).output, 'a.csv');
  assert.strictEqual(H.getRecord('nope'), null);
});
