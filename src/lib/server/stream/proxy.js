/**
 * m3u8 播放列表代理（设计文档 §6.3）。
 *
 * 只代理【列表】和【密钥】：服务端拉下来、去广告、把地址改写好交给 hls.js；
 * 分片（几百 MB 的视频流量）由浏览器直连对方 CDN，不经过本机服务。
 *   · master：子 playlist（含 #EXT-X-MEDIA / I-FRAME 的 URI）改成 /api/stream?u=<绝对地址>
 *   · media：filterAds 后，相对分片地址 / #EXT-X-MAP 改成绝对地址；#EXT-X-KEY 的 URI 改成 /api/stream?u=…&kind=key
 * 每一次出站请求（含每一跳重定向、密钥地址）都过 assertPublic：内网地址 403。
 */
import { fetchWithTimeout, readTextCapped } from '../net.js';
import { filterAds } from './adfilter.js';

const TIMEOUT_MS = 12_000;
const MAX_PLAYLIST = 5 * 1024 * 1024;
const MAX_KEY = 64 * 1024;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

function httpError(status, message) {
  const e = new Error(message);
  /** @type {any} */ (e).status = status;
  return e;
}

const viaProxy = (abs, kind) => `/api/stream?u=${encodeURIComponent(abs)}${kind ? `&kind=${kind}` : ''}`;

async function upstream(url) {
  const res = await fetchWithTimeout(url, { headers: { 'user-agent': UA, accept: '*/*' } }, TIMEOUT_MS);
  if (!res.ok) { res.body?.cancel?.().catch(() => {}); throw httpError(502, `上游 HTTP ${res.status}`); }
  return res;
}

/** 改写 playlist 里的地址。master：子列表走代理；media：分片 / MAP 转绝对地址，KEY 走代理 */
function rewrite(text, base) {
  const master = /#EXT-X-STREAM-INF/i.test(text);
  const abs = (x) => { try { return new URL(x, base).href; } catch { return x; } };
  const attr = (line, fn) => line.replace(/URI="([^"]*)"/i, (_, x) => `URI="${fn(x)}"`);
  return text.split(/(\r?\n)/).map((line) => {
    const t = line.trim();
    if (!t || line === '\n' || line === '\r\n') return line;
    if (t.startsWith('#')) {
      if (/^#EXT-X-(?:SESSION-)?KEY:/i.test(t)) {
        // METHOD=NONE 没有 URI；skd: / data: 之类不是 http 的保持原样
        return attr(line, (x) => (/^(?:skd|data):/i.test(x) ? x : viaProxy(abs(x), 'key')));
      }
      if (master && /^#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF):/i.test(t)) return attr(line, (x) => viaProxy(abs(x)));
      if (/^#EXT-X-MAP:/i.test(t)) return attr(line, abs);
      return line;
    }
    return master ? viaProxy(abs(t)) : abs(t);
  }).join('');
}

/** 拉取并改写 playlist；media playlist 先去广告。 @returns {Promise<{text: string, removed: {groups: number, seconds: number}}>} */
export async function loadPlaylist(url) {
  const res = await upstream(url);
  const finalUrl = res.url || url; // 手动跟随重定向：最后一跳的地址就是相对路径的基准
  const raw = (await readTextCapped(res, MAX_PLAYLIST)).replace(/^﻿/, '');
  if (!raw.trimStart().startsWith('#EXTM3U')) throw httpError(502, '不是 m3u8');
  const { text, removed } = filterAds(raw);
  return { text: rewrite(text, finalUrl), removed };
}

/** @returns {Promise<string>} 改写后的 playlist 文本 */
export async function proxyPlaylist(url) {
  return (await loadPlaylist(url)).text;
}

/** 拉密钥（二进制，不做文本解码）。 */
export async function proxyKey(url) {
  const res = await upstream(url);
  const len = Number(res.headers.get('content-length'));
  if (len > MAX_KEY) { res.body?.cancel?.().catch(() => {}); throw httpError(502, '密钥过大'); }
  const chunks = [];
  let n = 0;
  for await (const c of res.body || []) {
    n += c.length;
    if (n > MAX_KEY) { res.body.cancel?.().catch(() => {}); throw httpError(502, '密钥过大'); }
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

/**
 * GET /api/stream?u=<url>[&kind=key] 的实现（路由文件只是薄封装，方便单元测试）。
 * 内网 403；地址无效 400；上游失败 / 超时 / 不是 m3u8 -> 502。
 * @param {URLSearchParams} params
 */
export async function handleStream(params) {
  const u = params.get('u');
  const plain = (status, msg) => new Response(msg, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  if (!u) return plain(400, '缺少 u');
  try {
    if (params.get('kind') === 'key') {
      const body = await proxyKey(u);
      return new Response(body, { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' } });
    }
    const { text, removed } = await loadPlaylist(u);
    return new Response(text, {
      headers: { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store', 'x-ads-removed': String(removed.groups) },
    });
  } catch (e) {
    const status = /** @type {any} */ (e)?.status;
    if (status === 403 || status === 400) return plain(status, String(e.message));
    return plain(502, String(e?.message || '上游失败'));
  }
}
