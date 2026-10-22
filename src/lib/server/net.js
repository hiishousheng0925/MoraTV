/**
 * 出站网络的公共零件：内网拦截、带超时的 fetch、并发限制。
 * 所有向「用户可配置 / 远端给出的地址」发请求的地方都要先过 assertPublic。
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function httpError(status, message) {
  const e = new Error(message);
  /** @type {any} */ (e).status = status;
  return e;
}

/** @param {string} ip */
function isPrivateV4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

/** @param {string} ip */
function isPrivate(ip) {
  const v = isIP(ip);
  if (v === 4) return isPrivateV4(ip);
  if (v === 6) {
    const s = ip.toLowerCase();
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateV4(mapped[1]);
    return s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s);
  }
  return true;
}

/** 解析 DNS，任何一个解析结果落在 loopback / 私网 / CGNAT(100.64/10) / link-local 就拒绝（status=403）。 */
export async function assertPublic(url) {
  // 仅供单元测试连本地 http 服务
  if (process.env.MORA_TEST_HOOKS === '1') return;
  let u;
  try { u = new URL(url); } catch { throw httpError(400, '地址无效'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw httpError(403, '只允许 http / https');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host.toLowerCase() === 'localhost' || host.toLowerCase().endsWith('.localhost')) throw httpError(403, '禁止访问内网地址');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => { throw httpError(502, '域名解析失败'); });
  if (!addrs.length || addrs.some((a) => isPrivate(a.address))) throw httpError(403, '禁止访问内网地址');
}

/** fetch + 超时（毫秒）；超时抛 AbortError / TimeoutError。 */
export function fetchWithTimeout(url, opts = {}, ms = 8000) {
  return fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
}

/** 并发限制：const limit = pLimit(4); await limit(() => task()) */
export function pLimit(n) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= n || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}
