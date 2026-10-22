/** 响应缓存（cache 表）。ttl 最长 180 天（TMDB 条款：不超过 6 个月）。同一 key 并发调用合并成一次请求；失败不入缓存。 */
import { db } from './db.js';

export const MAX_TTL_SEC = 180 * 86400;
const inflight = new Map();
const NEG_TTL_SEC = 600;
let purged = false;

const clampTtl = (s) => Math.max(1, Math.min(Math.floor(s), MAX_TTL_SEC));

function write(key, val, ttlSec) {
  db().prepare('INSERT INTO cache (k, v, expires_at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, expires_at = excluded.expires_at')
    .run(key, JSON.stringify(val), Math.floor(Date.now() / 1000) + clampTtl(ttlSec));
}

/**
 * @template T
 * @param {string} key @param {number} ttlSec @param {() => Promise<T>} fn
 * @param {(val: T) => number} [ttlFor] 按结果定 TTL（秒），比如「无片源」比「有片源」缓存得短
 * @returns {Promise<T>}
 */
export function cached(key, ttlSec, fn, ttlFor) {
  if (!purged) { purged = true; try { purgeExpired(); } catch { /* 清理失败不影响取数 */ } }
  const now = Math.floor(Date.now() / 1000);
  const row = db().prepare('SELECT v, expires_at FROM cache WHERE k = ?').get(key);
  if (row && row.expires_at > now) {
    try { return Promise.resolve(JSON.parse(row.v)); } catch { /* 坏数据当作未命中 */ }
  }
  if (inflight.has(key)) return inflight.get(key);
  const ttl = clampTtl(ttlSec);
  const p = (async () => {
    const val = (await fn()) ?? null;
    write(key, val, val === null ? Math.min(ttl, NEG_TTL_SEC) : ttlFor ? ttlFor(val) : ttl);
    return val;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** 直接写一条（覆盖已有的，不管过没过期）。 */
export function putCache(key, val, ttlSec) {
  write(key, val ?? null, ttlSec);
}

/** 读一条没过期的；没有返回 undefined。 */
export function peekCache(key) {
  const row = db().prepare('SELECT v, expires_at FROM cache WHERE k = ?').get(key);
  if (!row || row.expires_at <= Math.floor(Date.now() / 1000)) return undefined;
  try { return JSON.parse(row.v); } catch { return undefined; }
}

/** 清掉过期行（可在启动时调用）。 */
export function purgeExpired() {
  db().prepare('DELETE FROM cache WHERE expires_at <= ?').run(Math.floor(Date.now() / 1000));
}
