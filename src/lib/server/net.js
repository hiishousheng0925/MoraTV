/**
 * 出站网络的公共零件：内网拦截、带超时的 fetch（逐跳校验重定向）、响应体大小上限、并发限制。
 * 所有向「用户可配置 / 远端给出的地址」发请求的地方都要走 fetchWithTimeout / assertPublic。
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function httpError(status, message) {
  const e = new Error(message);
  /** @type {any} */ (e).status = status;
  return e;
}

let allowPrivate = false;
/** 仅供单元测试：放行回环地址（连本地 http 测试服务）。生产代码不读环境变量，不可被外部开关关掉拦截。 */
export function _setAllowPrivate(v) { allowPrivate = !!v; }

/** @param {string} ip */
function isPrivateV4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

/** IPv6 文本 -> 8 个 16 位组；解析失败返回 null。支持 :: 压缩和结尾的点分 IPv4。 */
function parseV6(ip) {
  let s = ip.toLowerCase().split('%')[0];
  const dot = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dot) {
    const o = dot[2].split('.').map(Number);
    if (o.some((n) => !(n >= 0 && n <= 255))) return null;
    s = dot[1] + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16);
  }
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
  const parts = [...head, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...tail];
  const g = parts.map((p) => (/^[0-9a-f]{1,4}$/.test(p) ? parseInt(p, 16) : NaN));
  return g.length === 8 && g.every((n) => !Number.isNaN(n)) ? g : null;
}

const v4of = (hi, lo) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/** @param {string} ip */
function isPrivate(ip) {
  const v = isIP(ip);
  if (v === 4) return isPrivateV4(ip);
  if (v !== 6) return true;
  const g = parseV6(ip);
  if (!g) return true;
  const zero5 = g.slice(0, 5).every((x) => x === 0);
  if (g.slice(0, 7).every((x) => x === 0)) return true; // :: 和 ::1
  if (zero5 && (g[5] === 0xffff || g[5] === 0)) return isPrivateV4(v4of(g[6], g[7])); // ::ffff:a.b.c.d / ::a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isPrivateV4(v4of(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return isPrivateV4(v4of(g[1], g[2])); // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10
  if ((g[0] & 0xff00) === 0xff00) return true; // 多播
  return false;
}

/** 解析 DNS，任何一个解析结果落在 loopback / 私网 / CGNAT(100.64/10) / link-local 就拒绝（status=403）。 */
export async function assertPublic(url) {
  if (allowPrivate) return;
  let u;
  try { u = new URL(url); } catch { throw httpError(400, '地址无效'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw httpError(403, '只允许 http / https');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host.toLowerCase() === 'localhost' || host.toLowerCase().endsWith('.localhost')) throw httpError(403, '禁止访问内网地址');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => { throw httpError(502, '域名解析失败'); });
  if (!addrs.length || addrs.some((a) => isPrivate(a.address))) throw httpError(403, '禁止访问内网地址');
}

const MAX_HOPS = 5;
const CRED_HEADERS = ['authorization', 'cookie', 'proxy-authorization'];

/** 下一跳的请求选项（对齐 WHATWG Fetch）：跨源去掉凭据头；303 或 POST 遇 301/302 改 GET 并丢 body。 */
function redirectOpts(o, status, crossOrigin) {
  const out = { ...o };
  if (crossOrigin && out.headers) {
    const h = new Headers(out.headers);
    for (const k of CRED_HEADERS) h.delete(k);
    out.headers = h;
  }
  const method = String(out.method || 'GET').toUpperCase();
  if (status === 303 ? method !== 'HEAD' : (status === 301 || status === 302) && method === 'POST') {
    out.method = 'GET';
    delete out.body;
    if (out.headers) {
      const h = new Headers(out.headers);
      h.delete('content-type'); h.delete('content-length');
      out.headers = h;
    }
  }
  return out;
}

/** fetch + 总超时（毫秒，含所有跳）；手动跟随重定向，每一跳都过 assertPublic，最多 5 跳。 */
export async function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const signal = AbortSignal.timeout(ms);
  let cur = String(url);
  let o = { ...opts };
  for (let hop = 0; ; hop++) {
    await assertPublic(cur);
    const res = await fetch(cur, { ...o, signal, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      res.body?.cancel?.().catch(() => {});
      if (hop >= MAX_HOPS) throw httpError(502, '重定向过多');
      const next = new URL(res.headers.get('location'), cur);
      o = redirectOpts(o, res.status, new URL(cur).origin !== next.origin);
      cur = next.href;
      continue;
    }
    return res;
  }
}

export const MAX_BODY = 5 * 1024 * 1024;

/** 读响应文本，超过 maxBytes 抛错（不把超大响应读进内存）。 */
export async function readTextCapped(res, maxBytes = MAX_BODY) {
  const len = Number(res.headers.get('content-length'));
  if (len > maxBytes) { res.body?.cancel?.().catch(() => {}); throw httpError(413, '响应过大'); }
  if (!res.body) return '';
  const chunks = [];
  let n = 0;
  for await (const c of res.body) {
    n += c.length;
    if (n > maxBytes) { res.body.cancel?.().catch(() => {}); throw httpError(413, '响应过大'); }
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
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
