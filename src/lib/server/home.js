/**
 * 首页推荐排的 stale-while-revalidate：
 * - 上一次算好的各排（recommendRows 的结果）存进 cache 表（最多 3 天）。
 * - 有存货：立刻返回存货（不等预查），后台重算（存货不到 10 分钟就不重算）；重算结果经 fresh 交给页面换上、并覆盖存货。
 * - 没存货（第一次用 / 存货过期）：返回 recommendRows 的逐排 promise，和以前一样逐排流式渲染，算完存起来。
 * - 单飞：同时打开的几次首页共用一次计算。
 * - 资源站全都没回应时算出来的是没过滤的排，不存；某排 TMDB 失败（null）就沿用存货里那一排。
 */
import { recommendRows } from './works.js';
import { peekCache, putCache } from './cache.js';

const KEY = 'home:rows:v1';
const TTL = 3 * 86400;
const REFRESH_AFTER = 10 * 60 * 1000;

let inflight = null;

/** 测试钩子：忘掉进行中的计算 */
export function _reset() { inflight = null; }

/**
 * @param {{id: string, title: string}[]} defs 各排（顺序 = 页面顺序 = 去重优先级）
 * @param {(id: string) => Promise<any[]|null>} candidates 某排的候选（只在要重算时调用：会发 TMDB 请求）
 * @param {{need?: number, min?: number}} [opts] 传给 recommendRows
 * @returns {{ rows: {id: string, title: string, items: any}[], sitesDown: Promise<boolean>|boolean, fresh: Promise<Record<string, any[]>|null>|null }}
 *   有存货时 items 是数组、fresh 是后台重算结果（排 id -> 列表；没算成为 null）；没存货时 items 是 promise、fresh 为 null
 */
export function homeRecommend(defs, candidates, opts) {
  const stored = peekCache(KEY);
  const has = !!stored?.rows;
  const staleRows = () => defs.map((d) => ({ id: d.id, title: d.title, items: stored.rows[d.id] ?? [] }));
  if (has && !inflight && Date.now() - (stored.at || 0) < REFRESH_AFTER) return { rows: staleRows(), sitesDown: false, fresh: null };
  const run = inflight || start(defs, candidates, opts, stored);
  if (has) return { rows: staleRows(), sitesDown: run.rec.sitesDown, fresh: run.done };
  return { rows: run.rec.rows, sitesDown: run.rec.sitesDown, fresh: null };
}

function start(defs, candidates, opts, stored) {
  const rec = recommendRows(defs.map((d) => ({ ...d, items: candidates(d.id) })), opts);
  const run = { rec, done: null };
  run.done = Promise.all(rec.rows.map((r) => r.items)).then(async (lists) => {
    if (await rec.sitesDown) return null;
    const rows = {};
    rec.rows.forEach((r, i) => { const l = lists[i] ?? stored?.rows?.[r.id]; if (l) rows[r.id] = l; });
    putCache(KEY, { at: Date.now(), rows }, TTL);
    return rows;
  }).catch((e) => { console.warn('[home] 推荐重算失败', e?.message || e); return null; })
    .finally(() => { if (inflight === run) inflight = null; });
  inflight = run;
  return run;
}
