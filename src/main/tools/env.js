'use strict';

const { execFileSync } = require('child_process');

/**
 * 通过 PowerShell -EncodedCommand（base64/UTF-16LE）执行脚本。
 * 这样脚本内容与其中的中文路径都作为 base64 传输，彻底规避命令行 ANSI 代码页导致的乱码。
 */
function psRun(script, { utf8Out = false } = {}) {
  const prefix =
    "$ProgressPreference='SilentlyContinue';" +
    (utf8Out ? '[Console]::OutputEncoding=[Text.Encoding]::UTF8;' : '');
  const encoded = Buffer.from(prefix + script, 'utf16le').toString('base64');
  return execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
    { encoding: 'utf8', windowsHide: true, timeout: 20000 }
  );
}

function b64(value) {
  return Buffer.from(value, 'utf8').toString('base64');
}

/** 读取当前用户的 PATH（用户级，不需要管理员） */
function getUserPath() {
  try {
    return psRun("[Environment]::GetEnvironmentVariable('Path','User')", { utf8Out: true }).trim();
  } catch {
    return '';
  }
}

function setUserPath(value) {
  // 值同样以 base64 传入，在 PowerShell 内解码，避免任何引号/编码问题
  const script =
    `[Environment]::SetEnvironmentVariable('Path', ` +
    `[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64(value)}')), 'User')`;
  psRun(script);
}

function splitPath(value) {
  return value.split(';').map((s) => s.trim()).filter(Boolean);
}

function normalize(dir) {
  return dir.replace(/[\\/]+$/, '').toLowerCase();
}

function isInUserPath(dir) {
  return splitPath(getUserPath()).some((p) => normalize(p) === normalize(dir));
}

/** 幂等地把目录加入用户 PATH */
function addToUserPath(dir) {
  const parts = splitPath(getUserPath());
  if (parts.some((p) => normalize(p) === normalize(dir))) return { changed: false };
  parts.push(dir);
  setUserPath(parts.join(';'));
  broadcastChange();
  return { changed: true };
}

function removeFromUserPath(dir) {
  const parts = splitPath(getUserPath());
  const kept = parts.filter((p) => normalize(p) !== normalize(dir));
  if (kept.length === parts.length) return { changed: false };
  setUserPath(kept.join(';'));
  broadcastChange();
  return { changed: true };
}

/** 移除所有指向给定目录的条目（用于清理乱码残留） */
function removeMatchingUserPath(predicate) {
  const parts = splitPath(getUserPath());
  const kept = parts.filter((p) => !predicate(p));
  if (kept.length === parts.length) return { changed: false };
  setUserPath(kept.join(';'));
  broadcastChange();
  return { changed: true, removed: parts.length - kept.length };
}

/** 通知系统环境变量已变更（best-effort，失败不影响功能） */
function broadcastChange() {
  const script =
    '$sig=\'[DllImport("user32.dll",SetLastError=true,CharSet=CharSet.Auto)]' +
    'public static extern IntPtr SendMessageTimeout(IntPtr h,uint m,UIntPtr w,string l,uint f,uint t,out UIntPtr r);\'; ' +
    '$t=Add-Type -MemberDefinition $sig -Name W -Namespace FC -PassThru; ' +
    '$r=[UIntPtr]::Zero; ' +
    '$t::SendMessageTimeout([IntPtr]0xffff,0x1A,[UIntPtr]::Zero,\'Environment\',2,5000,[ref]$r) | Out-Null';
  try {
    psRun(script);
  } catch {
    /* 忽略 */
  }
}

module.exports = { getUserPath, isInUserPath, addToUserPath, removeFromUserPath, removeMatchingUserPath };
