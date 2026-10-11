'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

let bmpjs = null;
let pngToIco = null;
let icoTried = false;

function loadBmp() {
  if (!bmpjs) bmpjs = require('bmp-js');
  return bmpjs;
}

async function loadPngToIco() {
  if (pngToIco) return pngToIco;
  try {
    pngToIco = require('png-to-ico');
    if (pngToIco && pngToIco.default) pngToIco = pngToIco.default;
  } catch {
    const mod = await import('png-to-ico');
    pngToIco = mod.default || mod;
  }
  icoTried = true;
  return pngToIco;
}

const SHARP_IN = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'tiff', 'tif', 'gif', 'svg', 'heic', 'heif'];
const FROM = [...SHARP_IN, 'bmp'];
const TO = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'tiff', 'gif', 'bmp', 'ico'];

function rgbaBufferToBgra(buf) {
  const out = Buffer.alloc(buf.length);
  for (let i = 0; i < buf.length; i += 4) {
    out[i] = buf[i + 2];
    out[i + 1] = buf[i + 1];
    out[i + 2] = buf[i];
    out[i + 3] = buf[i + 3];
  }
  return out;
}

/** 生成一个 sharp 实例（统一入口，bmp 需要特殊解码） */
function open(input, ext) {
  if (ext === 'bmp') {
    const bmp = loadBmp().decode(fs.readFileSync(input));
    // bmp-js 输出 BGRA，转成 RGBA 交给 sharp
    const rgba = rgbaBufferToBgra(bmp.data); // BGRA->RGBA 同样是交换 R/B
    return sharp(rgba, {
      raw: { width: bmp.width, height: bmp.height, channels: 4 },
    });
  }
  const keepAnim = ext === 'gif';
  return sharp(input, keepAnim ? { animated: true } : {});
}

async function encodeToBuffer(pipeline, to, options) {
  const quality = options.quality != null ? Number(options.quality) : undefined;
  const q = quality != null && quality > 0 && quality <= 100 ? quality : undefined;

  switch (to) {
    case 'png':
      return pipeline.png({ quality: q }).toBuffer();
    case 'jpg':
    case 'jpeg':
      return pipeline.jpeg({ quality: q || 90 }).toBuffer();
    case 'webp':
      return pipeline.webp({ quality: q || 90 }).toBuffer();
    case 'avif':
      return pipeline.avif({ quality: q || 50 }).toBuffer();
    case 'tiff':
      return pipeline.tiff({ quality: q }).toBuffer();
    case 'gif':
      return pipeline.gif().toBuffer();
    case 'bmp': {
      const { data, info } = await pipeline
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const bgra = rgbaBufferToBgra(data);
      const out = loadBmp().encode({
        data: bgra,
        width: info.width,
        height: info.height,
      });
      return out.data;
    }
    case 'ico': {
      const fn = await loadPngToIco();
      const png = await pipeline
        .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();
      return fn(png);
    }
    default:
      throw new Error(`不支持图片输出为 .${to}`);
  }
}

async function convert(ctx) {
  const { input, output, from, to, options, onProgress, log } = ctx;
  log(`解码 ${path.basename(input)} (.${from})`);
  onProgress(0.15);

  let pipeline = open(input, from);
  if (from !== 'gif' || to !== 'gif') {
    // 非动图场景统一取首帧并保证有 alpha 合成
    pipeline = pipeline.rotate();
  }

  if (options.width || options.height) {
    const w = options.width ? Number(options.width) : null;
    const h = options.height ? Number(options.height) : null;
    pipeline = pipeline.resize(w, h, { fit: options.fit || 'inside', withoutEnlargement: false });
  }
  onProgress(0.45);
  log(`编码为 .${to}${options.quality ? ` (质量 ${options.quality})` : ''}`);

  const buf = await encodeToBuffer(pipeline, to, options || {});
  fs.writeFileSync(output, buf);
  onProgress(1);
  return { output };
}

module.exports = [
  {
    id: 'image.sharp',
    category: 'image',
    label: '图片',
    from: FROM,
    to: TO,
    requires: [],
    convert,
  },
];
