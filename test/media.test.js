'use strict';

const test = require('node:test');
const assert = require('node:assert');

const media = require('../src/main/convert/media');
const { parseEncoders, resolveHwEncoder, crfToQuality, h264Args, shouldRemux, remuxBsFilter } = media;

// 展开 media 数组不会把纯函数当成 converter
test('media 导出仍只有一个 converter', () => {
  const converters = [...media];
  assert.strictEqual(converters.length, 1);
  assert.strictEqual(converters[0].id, 'media.ffmpeg');
});

test('parseEncoders 认出三种硬件编码器', () => {
  const text = ' V..... h264_nvenc  NVIDIA NVENC H.264 encoder\n V..... h264_qsv  H.264 (Intel Quick Sync)\n V..... h264_amf  AMD AMF H.264';
  assert.deepStrictEqual(parseEncoders(text), { nvenc: true, qsv: true, amf: true });
});

test('parseEncoders 对无关文本全 false', () => {
  assert.deepStrictEqual(parseEncoders('libx264 libx265 aac'), { nvenc: false, qsv: false, amf: false });
  assert.deepStrictEqual(parseEncoders(''), { nvenc: false, qsv: false, amf: false });
});

test('resolveHwEncoder：auto 按 nvenc>qsv>amf', () => {
  assert.strictEqual(resolveHwEncoder('auto', { nvenc: false, qsv: true, amf: true }), 'h264_qsv');
  assert.strictEqual(resolveHwEncoder('auto', { nvenc: true, qsv: true, amf: true }), 'h264_nvenc');
  assert.strictEqual(resolveHwEncoder('auto', { nvenc: false, qsv: false, amf: true }), 'h264_amf');
  assert.strictEqual(resolveHwEncoder('auto', {}), 'libx264');
});

test('resolveHwEncoder：off 与显式选择', () => {
  assert.strictEqual(resolveHwEncoder('off', { nvenc: true }), 'libx264');
  assert.strictEqual(resolveHwEncoder('nvenc', { nvenc: true }), 'h264_nvenc');
  assert.strictEqual(resolveHwEncoder('nvenc', { nvenc: false }), 'libx264');
  assert.strictEqual(resolveHwEncoder('qsv', { qsv: true }), 'h264_qsv');
});

test('crfToQuality 默认值与钳制', () => {
  assert.strictEqual(crfToQuality(undefined, 'libx264'), 23);
  assert.strictEqual(crfToQuality(20, 'libx264'), 20);
  assert.strictEqual(crfToQuality(-5, 'libx264'), 0);
  assert.strictEqual(crfToQuality(999, 'libx264'), 51);
  assert.strictEqual(crfToQuality(0, 'h264_qsv'), 1); // qsv 下限 1
  assert.strictEqual(crfToQuality(18, 'h264_nvenc'), 18);
});

test('h264Args 精确 flag 串', () => {
  assert.deepStrictEqual(h264Args({ crf: 23 }, 'libx264'),
    ['-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p']);
  assert.deepStrictEqual(h264Args({ crf: 20 }, 'h264_nvenc'),
    ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '20', '-b:v', '0', '-pix_fmt', 'yuv420p']);
  assert.deepStrictEqual(h264Args({ crf: 20 }, 'h264_qsv'),
    ['-c:v', 'h264_qsv', '-preset', 'medium', '-global_quality', '20', '-pix_fmt', 'nv12']);
  assert.deepStrictEqual(h264Args({ crf: 20 }, 'h264_amf'),
    ['-c:v', 'h264_amf', '-rc', 'cqp', '-qp_i', '20', '-qp_p', '20', '-qp_b', '20', '-quality', 'balanced']);
});

test('shouldRemux：白名单配对且无覆盖项时为真', () => {
  assert.strictEqual(shouldRemux('mp4', 'mkv', {}), true);
  assert.strictEqual(shouldRemux('mkv', 'mp4', { remux: true }), true);
  assert.strictEqual(shouldRemux('mov', 'ts', {}), true);
});

test('shouldRemux：设了重编码覆盖项则为假', () => {
  for (const key of ['crf', 'bitrate', 'scale', 'fps']) {
    assert.strictEqual(shouldRemux('mp4', 'mkv', { [key]: 1 }), false, `${key} 应阻止 remux`);
  }
});

test('shouldRemux：非白名单配对与显式关闭为假', () => {
  assert.strictEqual(shouldRemux('mp4', 'avi', {}), false);
  assert.strictEqual(shouldRemux('webm', 'mp4', {}), false);
  assert.strictEqual(shouldRemux('mp4', 'mp4', {}), false);
  assert.strictEqual(shouldRemux('mp4', 'mkv', { remux: false }), false);
});

test('remuxBsFilter 码流过滤器', () => {
  assert.deepStrictEqual(remuxBsFilter('mp4', 'ts'), ['-bsf:v', 'h264_mp4toannexb']);
  assert.deepStrictEqual(remuxBsFilter('ts', 'mp4'), ['-bsf:a', 'aac_adtstoasc']);
  assert.deepStrictEqual(remuxBsFilter('mp4', 'mkv'), []);
});
