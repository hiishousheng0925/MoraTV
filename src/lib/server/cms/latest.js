/**
 * 首页「最近更新」排：不需要 TMDB key，直接取资源站按更新时间倒序的列表。
 * 只用 1–2 个健康站点（fail_streak 小、延迟低的优先；没回应的换下一个），
 * 丢掉丢弃类目和没有 m3u8 线路的条目，按「规范化片名 + 年份」去重，结果缓存 30 分钟。
 *
 * latestRows() -> { tv: Item[], movie: Item[], variety: Item[] }
 *   Item = { key: 'cms-<siteId>-<vodId>', name, poster, year, region, kind, sub, available: true }
 * 所有候选站点都没回应时抛错（不入缓存，调用方降级）。
 */
import { cached } from '../cache.js';
import { listSites, recordResult } from './sites.js';
import { latestBySite } from './client.js';
import { normTitle, regionOfArea } from '../search/normalize.js';

export const LATEST_KINDS = ['tv', 'movie', 'variety'];
const TTL_SEC = 30 * 60;
const USE_SITES = 2;     // 取几个站
const MAX_TRIES = 4;     // 最多试几个站（前面的没回应就往后换）
const PAGES = 3;         // 每站最多翻几页（电影更新少，要多翻）
const ROW = 16;
const HOURS = 168;       // 只看最近一周内更新的

const DEFAULT_DEPS = { listSites, latestBySite, recordResult };
let deps = DEFAULT_DEPS;
/** 测试钩子：注入假的 listSites / latestBySite / recordResult；传 null 恢复。 */
export function _setDeps(d) { deps = d ? { ...DEFAULT_DEPS, ...d } : DEFAULT_DEPS; }

const latency = (s) => (s.latency_ms == null ? 1e9 : s.latency_ms);
/** 健康度排序：连续失败少的在前，再按测得延迟、权重 */
export const byHealth = (sites) => [...sites].sort((a, b) =>
  ((a.fail_streak || 0) - (b.fail_streak || 0)) || (latency(a) - latency(b)) || ((b.weight || 0) - (a.weight || 0)) || (a.id - b.id));

const usable = (v) => LATEST_KINDS.includes(v.category?.kind) && v.lines?.length > 0;

/** 一个站：翻页直到每排都够、或没有下一页。第 1 页没回应返回 null。 */
async function fromSite(site) {
  const out = [];
  for (let pg = 1; pg <= PAGES; pg++) {
    const t0 = Date.now();
    const list = await deps.latestBySite(site, { hours: HOURS, page: pg });
    if (pg === 1) {
      deps.recordResult(site.id, list.pagecount != null, Date.now() - t0);
      if (list.pagecount == null) return null;
    }
    out.push(...list.filter(usable));
    const enough = LATEST_KINDS.every((k) => out.filter((v) => v.category.kind === k).length >= ROW);
    if (enough || list.pagecount == null || pg >= list.pagecount || !list.length) break;
  }
  return out;
}

const toItem = (v) => {
  const r = v.category.region;
  return {
    key: `cms-${v.siteId}-${v.vodId}`,
    name: v.name,
    poster: v.pic || null,
    year: v.year,
    region: r && r !== 'other' ? r : regionOfArea(v.area),
    kind: v.category.kind,
    sub: (v.remarks || '').slice(0, 14),
    available: true,
  };
};

/** 不走缓存的版本（测试用；首页用 latestRows） */
export async function collectLatest() {
  const cands = byHealth(deps.listSites({ enabledOnly: true })).slice(0, MAX_TRIES);
  const got = [];
  let i = 0;
  while (got.length < USE_SITES && i < cands.length) {
    const batch = cands.slice(i, i + USE_SITES - got.length);
    i += batch.length;
    const res = await Promise.all(batch.map((s) => fromSite(s).catch(() => null)));
    res.forEach((r) => { if (r) got.push(r); });
  }
  if (!got.length) throw new Error('资源站都没有回应');
  // 各站合并后按更新时间倒序（同一格式的时间串直接比字符串），稳定排序保持站点健康度先后
  const all = got.flat().sort((a, b) => (b.time || '').localeCompare(a.time || ''));
  const rows = Object.fromEntries(LATEST_KINDS.map((k) => [k, []]));
  const seen = new Set();
  for (const v of all) {
    const id = `${normTitle(v.name) || v.name}|${v.year ?? ''}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const row = rows[v.category.kind];
    if (row.length < ROW) row.push(toItem(v));
  }
  return rows;
}

export function latestRows() {
  return cached('cms:latest:v1', TTL_SEC, collectLatest);
}
