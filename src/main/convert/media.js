'use strict';

const fs = require('fs');
const { spawn, execFile } = require('child_process');

const AUDIO = ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'opus', 'wma', 'ac3', 'aiff'];
const VIDEO = ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'wmv', 'm4v', 'ts', 'mpg', 'mpeg', '3gp', 'ogv', 'gif'];

const AUDIO_CODEC = {
  mp3: (o) => ['-c:a', 'libmp3lame', '-b:a', o.bitrate || '192k'],
  wav: () => ['-c:a', 'pcm_s16le'],
  flac: () => ['-c:a', 'flac'],
  aac: (o) => ['-c:a', 'aac', '-b:a', o.bitrate || '192k'],
  m4a: (o) => ['-c:a', 'aac', '-b:a', o.bitrate || '192k'],
  ogg: (o) => ['-c:a', 'libvorbis', '-b:a', o.bitrate || '192k'],
  opus: (o) => ['-c:a', 'libopus', '-b:a', o.bitrate || '128k'],
  wma: () => ['-c:a', 'wmav2'],
  ac3: () => ['-c:a', 'ac3'],
  aiff: () => ['-c:a', 'pcm_s16be'],
};

// ---------- 无损换容器（remux） ----------

/**
 * 只换容器不重编码的安全配对白名单（H.264/AAC 容器族）。
 * 键 = [a,b].sort().join('|')。仅这 5 种扩展之间成立。
 */
const REMUX_PAIRS = new Set([
  'm4v|mov', 'm4v|mp4', 'mov|mp4',
  'm4v|mkv', 'mkv|mov', 'mkv|mp4',
  'm4v|ts', 'mov|ts', 'mp4|ts', 'mkv|ts',
]);

function pairKey(a, b) {
  return [a, b].sort().join('|');
}

/** 是否走 -c copy：白名单配对，且用户没有要求重编码的覆盖项 */
function shouldRemux(from, to, options) {
  const o = options || {};
  if (o.remux === false) return false;
  if (from === to) return false;
  if (!REMUX_PAIRS.has(pairKey(from, to))) return false;
  if (o.crf != null || o.bitrate != null || o.scale != null || o.fps != null) return false;
  return true;
}

/** ts 与其他容器互转时的码流过滤器 */
function remuxBsFilter(from, to) {
  if (to === 'ts') return ['-bsf:v', 'h264_mp4toannexb'];
  if (from === 'ts') return ['-bsf:a', 'aac_adtstoasc'];
  return [];
}

// ---------- 硬件编码 ----------

/** 从 `ffmpeg -encoders` 输出里认出可用的 H.264 硬件编码器 */
function parseEncoders(text) {
  const t = String(text || '');
  return {
    nvenc: /\bh264_nvenc\b/.test(t),
    qsv: /\bh264_qsv\b/.test(t),
    amf: /\bh264_amf\b/.test(t),
  };
}

/** 选定编码器：off→软件；显式选择但不可用→软件；auto→按 nvenc>qsv>amf 取首个可用 */
function resolveHwEncoder(mode, avail) {
  const a = avail || {};
  if (mode === 'off') return 'libx264';
  if (mode === 'nvenc' || mode === 'qsv' || mode === 'amf') return a[mode] ? 'h264_' + mode : 'libx264';
  for (const k of ['nvenc', 'qsv', 'amf']) if (a[k]) return 'h264_' + k;
  return 'libx264';
}

/** CRF 映射到各编码器的质量参数（同 0–51 量级） */
function crfToQuality(crf, encoder) {
  const n = Number.isFinite(+crf) ? Math.round(+crf) : 23;
  if (encoder === 'h264_qsv') return Math.min(51, Math.max(1, n));
  return Math.min(51, Math.max(0, n));
}

/** H.264 输出参数（libx264 分支与既有行为逐字节一致） */
function h264Args(o, encoder) {
  const q = crfToQuality(o.crf, encoder);
  switch (encoder) {
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', String(q), '-b:v', '0', '-pix_fmt', 'yuv420p'];
    case 'h264_qsv':
      return ['-c:v', 'h264_qsv', '-preset', 'medium', '-global_quality', String(q), '-pix_fmt', 'nv12'];
    case 'h264_amf':
      return ['-c:v', 'h264_amf', '-rc', 'cqp', '-qp_i', String(q), '-qp_p', String(q), '-qp_b', String(q), '-quality', 'balanced'];
    default:
      return ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(q), '-pix_fmt', 'yuv420p'];
  }
}

function videoArgs(to, o, enc = 'libx264') {
  switch (to) {
    case 'webm':
      return ['-c:v', 'libvpx-vp9', '-crf', o.crf != null ? String(o.crf) : '32', '-b:v', '0', '-c:a', 'libopus'];
    case 'avi':
      return ['-c:v', 'mpeg4', '-q:v', '5', '-c:a', 'libmp3lame'];
    case 'wmv':
      return ['-c:v', 'wmv2', '-c:a', 'wmav2'];
    case 'flv':
      return ['-c:v', 'flv', '-c:a', 'libmp3lame'];
    case 'ogv':
      return ['-c:v', 'libtheora', '-c:a', 'libvorbis'];
    case 'ts':
      return [...h264Args(o, enc), '-c:a', 'aac', '-bsf:v', 'h264_mp4toannexb'];
    case 'gif':
      return [];
    default:
      return [...h264Args(o, enc), '-c:a', 'aac', '-b:a', o.bitrate || '192k'];
  }
}

// 进程内缓存一次编码器探测结果
let _encCache = null;

function probeEncoders(ffmpeg) {
  if (_encCache) return Promise.resolve(_encCache);
  return new Promise((resolve) => {
    if (!ffmpeg) return resolve((_encCache = { nvenc: false, qsv: false, amf: false }));
    execFile(
      ffmpeg,
      ['-hide_banner', '-encoders'],
      { timeout: 15000, windowsHide: true },
      (err, stdout, stderr) => resolve((_encCache = parseEncoders((stdout || '') + (stderr || ''))))
    );
  });
}

function probeDuration(ffprobe, input) {
  return new Promise((resolve) => {
    execFile(
      ffprobe,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', input],
      { timeout: 15000, windowsHide: true },
      (err, stdout) => {
        const d = parseFloat(String(stdout).trim());
        resolve(Number.isFinite(d) && d > 0 ? d : null);
      }
    );
  });
}

function hmsToSec(t) {
  const m = t.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return null;
  return (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]);
}

/** 跑一次 ffmpeg，解析进度，成功返回 {output} */
function runFfmpeg(ffmpeg, args, { output, duration, onProgress, signal }) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { windowsHide: true });
    const onAbort = () => { try { child.kill('SIGKILL'); } catch {} };
    if (signal) {
      if (signal.aborted) return onAbort(), reject(new Error('已取消'));
      signal.addEventListener('abort', onAbort, { once: true });
    }

    let stderrTail = '';
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrTail = (stderrTail + text).slice(-4000);
      if (duration) {
        const matches = text.match(/time=(\d+:\d+:\d+(?:\.\d+)?)/g);
        if (matches) {
          const t = hmsToSec(matches[matches.length - 1]);
          if (t != null) onProgress(Math.min(0.99, t / duration));
        }
      }
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (signal) signal.removeEventListener('abort', onAbort);
      if (code === 0 && fs.existsSync(output)) {
        onProgress(1);
        resolve({ output });
      } else {
        const tail = stderrTail.split('\n').filter(Boolean).slice(-6).join('\n');
        reject(new Error(`ffmpeg 退出码 ${code}\n${tail}`));
      }
    });
  });
}

async function convert(ctx) {
  const { input, output, from, to, options, tools, onProgress, log, signal } = ctx;
  const ffmpeg = tools.ffmpeg;
  if (!ffmpeg) throw new Error('未找到 FFmpeg，请先在「工具」页安装');

  const o = options || {};
  const isAudioOut = AUDIO.includes(to);
  const isVideoEncode = !isAudioOut && to !== 'gif';

  // 1) 优先无损换容器
  if (shouldRemux(from, to, o)) {
    const remuxArgs = ['-hide_banner', '-nostdin', '-y', '-i', input, '-map', '0', '-c', 'copy', ...remuxBsFilter(from, to), output];
    log('无损换容器：-c copy');
    try {
      return await runFfmpeg(ffmpeg, remuxArgs, { output, onProgress, signal, duration: null });
    } catch (e) {
      log(`无损换容器失败，回退为重新编码：${String(e.message).split('\n')[0]}`);
    }
  }

  // 2) 正常编码路径
  const requested = o.hwaccel || 'auto';
  const avail = isVideoEncode && requested !== 'off'
    ? await probeEncoders(ffmpeg)
    : { nvenc: false, qsv: false, amf: false };
  const enc = isVideoEncode ? resolveHwEncoder(requested, avail) : 'libx264';
  if (isVideoEncode) {
    if (enc !== 'libx264') log(`使用硬件编码：${enc}`);
    else if (requested !== 'auto' && requested !== 'off') log(`硬件编码 ${requested} 不可用，改用软件编码`);
  }

  const args = ['-hide_banner', '-nostdin', '-y'];
  if (isVideoEncode && enc !== 'libx264') args.push('-hwaccel', 'auto');
  args.push('-i', input);

  const duration = (await probeDuration(tools.ffprobe || ffmpeg.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1'), input)) || null;

  if (isAudioOut) {
    args.push('-vn');
    const codec = AUDIO_CODEC[to];
    if (codec) args.push(...codec(o));
  } else if (to === 'gif') {
    const fps = o.fps || 12;
    const scale = o.scale || 640;
    args.push('-vf', `fps=${fps},scale=${scale}:-1:flags=lanczos`, '-loop', '0');
  } else {
    if (o.scale) args.push('-vf', `scale=${o.scale}:-2`);
    args.push(...videoArgs(to, o, enc));
  }

  args.push(output);
  log(`ffmpeg ${args.join(' ')}`);
  return await runFfmpeg(ffmpeg, args, { output, onProgress, signal, duration });
}

module.exports = [
  {
    id: 'media.ffmpeg',
    category: 'media',
    label: '音视频',
    from: [...AUDIO, ...VIDEO],
    to: [...VIDEO, ...AUDIO],
    requires: ['ffmpeg'],
    convert,
  },
];

// 纯函数 / 探测函数挂在数组上（index.js 用展开运算符只取元素，不会误当 converter）
module.exports.shouldRemux = shouldRemux;
module.exports.remuxBsFilter = remuxBsFilter;
module.exports.parseEncoders = parseEncoders;
module.exports.resolveHwEncoder = resolveHwEncoder;
module.exports.crfToQuality = crfToQuality;
module.exports.h264Args = h264Args;
module.exports.probeEncoders = probeEncoders;
module.exports._resetEncoderCache = () => { _encCache = null; };
