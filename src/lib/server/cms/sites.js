/** 资源站管理（site 表）+ 并发聚合搜索。 */
import { db } from '../db.js';
import { pLimit } from '../net.js';
import { DEFAULT_SITES } from './sites.default.js';
import { cmsGet, toVods } from './client.js';

let seeded = false;
let version = 0;
/** 站点配置的版本号：增删改站点时加一（搜索结果缓存按它区分，换了站点不再拿旧结果） */
export const sitesVersion = () => version;
function seed() {
  if (seeded) return;
  const d = db();
  const ins = d.prepare('INSERT OR IGNORE INTO site (name, api, builtin) VALUES (?, ?, 1)');
  // 只在 site 表为空（首次启动）时写入，用户删掉内置站点后不再复活
  if (d.prepare('SELECT COUNT(*) AS n FROM site').get().n === 0) {
    DEFAULT_SITES.forEach((s) => ins.run(s.name, s.api));
  }
  seeded = true;
}

/** @param {{enabledOnly?: boolean}} [o] */
export function listSites({ enabledOnly = false } = {}) {
  seed();
  return db().prepare(`SELECT * FROM site ${enabledOnly ? 'WHERE enabled = 1' : ''} ORDER BY weight DESC, fail_streak ASC, id ASC`).all();
}

const byId = (id) => db().prepare('SELECT * FROM site WHERE id = ?').get(id);

export function addSite({ name, api }) {
  seed();
  const n = String(name ?? '').trim();
  const a = String(api ?? '').trim();
  let u;
  try { u = new URL(a); } catch { throw Object.assign(new Error('API 地址无效'), { status: 400 }); }
  if (!/^https?:$/.test(u.protocol)) throw Object.assign(new Error('API 地址无效'), { status: 400 });
  if (!n) throw Object.assign(new Error('名称不能为空'), { status: 400 });
  const r = db().prepare('INSERT INTO site (name, api) VALUES (?, ?)').run(n, a);
  version++;
  return byId(Number(r.lastInsertRowid));
}

const PATCHABLE = new Set(['name', 'api', 'enabled', 'weight']);
export function updateSite(id, patch) {
  seed();
  const keys = Object.keys(patch).filter((k) => PATCHABLE.has(k));
  if (!keys.length) return byId(id);
  const vals = keys.map((k) => (k === 'enabled' ? (patch[k] ? 1 : 0) : patch[k]));
  db().prepare(`UPDATE site SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...vals, id);
  version++;
  return byId(id);
}

export function removeSite(id) {
  seed();
  db().prepare('DELETE FROM site WHERE id = ?').run(id);
  version++;
}

/** 记一次请求结果：成功清 fail_streak，失败 +1 */
export function recordResult(id, ok, latencyMs) {
  const now = Date.now();
  if (ok) db().prepare('UPDATE site SET last_ok_at = ?, fail_streak = 0, latency_ms = ? WHERE id = ?').run(now, Math.round(latencyMs), id);
  else db().prepare('UPDATE site SET last_fail_at = ?, fail_streak = fail_streak + 1, latency_ms = ? WHERE id = ?').run(now, Math.round(latencyMs), id);
}

/** 测速：拉第 1 页列表，能解析且有 list 即算可用。不写库（调用方决定要不要 recordResult）。 */
export async function testSite(site, { timeoutMs = 8000 } = {}) {
  const t0 = Date.now();
  const j = await cmsGet(site, { ac: 'videolist', pg: 1 }, timeoutMs);
  const latencyMs = Date.now() - t0;
  if (!j || !Array.isArray(j.list)) return { ok: false, latencyMs, total: 0 };
  return { ok: true, latencyMs, total: Number(j.total) || j.list.length };
}

const SEARCH_CONCURRENCY = 8;

/**
 * 并发搜所有启用站点（每站取第 1 页，满页时再取第 2 页）；单站失败不影响整体，失败的记 fail_streak；排序：fail_streak 小、weight 大的站点结果在前。
 * 返回的数组带 answered（有几个站正常回了 JSON）：全都没回时「没结果」不能当真（调用方别把它缓存成「无片源」）。
 */
export async function searchAll(keyword, { timeoutMs = 8000 } = {}) {
  const list = listSites({ enabledOnly: true });
  const limit = pLimit(SEARCH_CONCURRENCY);
  const results = await Promise.all(list.map((s) => limit(async () => {
    const t0 = Date.now();
    const j = await cmsGet(s, { ac: 'videolist', wd: keyword, pg: 1 }, timeoutMs);
    recordResult(s.id, !!j, Date.now() - t0);
    const vods = toVods(j, s.id);
    // 第 1 页满页且不止一页：再取第 2 页（短片名「功夫」常被同名前缀的作品挤到后面）
    if (j && Number(j.pagecount) > 1 && j.list.length >= (Number(j.limit) || 20)) {
      const t1 = Date.now();
      const j2 = await cmsGet(s, { ac: 'videolist', wd: keyword, pg: 2 }, timeoutMs);
      if (!j2) recordResult(s.id, false, Date.now() - t1); // 第 2 页失败也算进 fail_streak（成功不覆盖第 1 页测得的延迟）
      const seen = new Set(vods.map((v) => v.vodId));
      vods.push(...toVods(j2, s.id).filter((v) => !seen.has(v.vodId)));
    }
    return { site: s, ok: !!j, vods };
  })));
  const out = results
    .sort((a, b) => (a.site.fail_streak - b.site.fail_streak) || (b.site.weight - a.site.weight) || (a.site.id - b.site.id))
    .flatMap((r) => r.vods);
  out.answered = results.filter((r) => r.ok).length;
  out.total = results.length;
  return out;
}
