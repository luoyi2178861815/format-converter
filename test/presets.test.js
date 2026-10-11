'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const P = require('../src/main/presets');

function useTmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc_preset_'));
  process.env.FC_PRESETS_DIR = dir;
  P._resetForTests();
  return dir;
}

test('保存方案后可列出', () => {
  useTmpDir();
  const p = P.save({ category: 'media', name: '微信压缩', options: { crf: 28, bitrate: '128k' } });
  assert.ok(p.id);
  const list = P.list();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].category, 'media');
  assert.strictEqual(list[0].name, '微信压缩');
  assert.strictEqual(list[0].options.crf, 28);
});

test('同名同类覆盖，不新增', () => {
  useTmpDir();
  P.save({ category: 'image', name: '网页用', options: { quality: 70 } });
  P.save({ category: 'image', name: '网页用', options: { quality: 90 } });
  const list = P.list();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].options.quality, 90);
});

test('不同分类允许同名', () => {
  useTmpDir();
  P.save({ category: 'image', name: '快速', options: { quality: 60 } });
  P.save({ category: 'media', name: '快速', options: { crf: 30 } });
  assert.strictEqual(P.list().length, 2);
});

test('空方案名抛错', () => {
  useTmpDir();
  assert.throws(() => P.save({ category: 'media', name: '   ', options: {} }), /方案名不能为空/);
});

test('新方案排在最前', () => {
  useTmpDir();
  P.save({ category: 'data', name: 'first', options: {} });
  P.save({ category: 'data', name: 'second', options: {} });
  const list = P.list();
  assert.strictEqual(list[0].name, 'second');
  assert.strictEqual(list[1].name, 'first');
});

test('remove 只移除指定方案', () => {
  useTmpDir();
  const a = P.save({ category: 'media', name: 'a', options: {} });
  P.save({ category: 'media', name: 'b', options: {} });
  assert.strictEqual(P.remove(a.id), true);
  const list = P.list();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].name, 'b');
  assert.strictEqual(P.remove('不存在'), false);
});

test('clear 清空全部方案', () => {
  useTmpDir();
  P.save({ category: 'media', name: 'a', options: {} });
  P.save({ category: 'image', name: 'b', options: {} });
  P.clear();
  assert.strictEqual(P.list().length, 0);
});

test('持久化为合法 JSON 且不留 .tmp', () => {
  useTmpDir();
  P.save({ category: 'media', name: 'x', options: { remux: true } });
  const p = P.filePath();
  assert.ok(fs.existsSync(p));
  assert.ok(!fs.existsSync(`${p}.tmp`));
  const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
  assert.strictEqual(parsed.schemaVersion, 1);
  assert.strictEqual(parsed.presets[0].options.remux, true);
});

test('超过上限 200 会丢弃最旧方案', () => {
  useTmpDir();
  for (let i = 0; i < P.MAX_PRESETS + 5; i++) P.save({ category: 'media', name: `p${i}`, options: {} });
  assert.strictEqual(P.list().length, P.MAX_PRESETS);
});
