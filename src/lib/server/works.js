/**
 * 作品详情与片源（详情页 / 播放页 / 可用性角标共用）。
 *
 * getWork(key)：tv- / movie- 走 TMDB 详情，cms- 走资源站详情；都写进 title 表。
 * 网络失败时退回 title 表里上次存的那份；都没有返回 null。
 */
import * as tmdb from './tmdb.js';
import { listSites } from './cms/sites.js';
import { detailSite } from './cms/client.js';
import { findSources as realFindSources, seasonOfVod, acceptSources } from './search/aggregate.js';
import { regionOfCountry, regionOfArea } from './search/normalize.js';
import { cached, putCache, peekCache } from './cache.js';
import { saveTitle, loadTitle } from './library.js';

const SRC_TTL = 30 * 60;
// 缓存键带匹配逻辑版本：匹配规则改了，老用户缓存里的「无片源」立刻失效
const MATCH_V = 'v3';

/** 测试钩子：注入假的 findSources / getWork / listSites；传 null 恢复 */
const DEFAULT_DEPS = { findSources: realFindSources, getWork: null, listSites };
let deps = DEFAULT_DEPS;
export function _setDeps(d) { deps = d ? { ...DEFAULT_DEPS, ...d } : DEFAULT_DEPS; }

/** 所有资源站都没回应：空结果不可信，抛出去，谁都不缓存它 */
export class NoSiteAnswered extends Error { constructor() { super('资源站都没有回应'); this.status = 502; } }
const AVAIL_TTL = 86400;
const AVAIL_NEG_TTL = 6 * 3600; // 无片源只记 6 小时（资源站随时会补片）

/** TMDB 中文类型名 -> 形态 */
function kindOfGenres(type, genres = []) {
  if (type === 'movie') return 'movie';
  const g = genres.join(' ');
  if (/真人秀|脱口秀|Reality|Talk/i.test(g)) return 'variety';
  if (/纪录|Documentary/i.test(g)) return 'doc';
  return 'tv';
}

function workFromDetails(d, prev) {
  const seasons = (d.seasons || []).filter((s) => s.season > 0 && s.episodeCount > 0);
  return {
    key: `${d.type}-${d.id}`,
    type: d.type,
    name: d.name || prev?.name || '',
    originalName: d.originalName || '',
    year: d.year ?? prev?.year ?? null,
    region: regionOfCountry(d.region) ?? prev?.region ?? null,
    // 搜索阶段从资源站类目得出的形态（短剧 / 综艺）比 TMDB 类型更准，有就沿用
    kind: prev?.kind && prev.kind !== 'tv' && prev.kind !== 'movie' && prev.kind !== 'other' ? prev.kind : kindOfGenres(d.type, d.genres),
    poster: d.poster || prev?.poster || null,
    backdrop: d.backdrop || null,
    overview: d.overview || prev?.overview || '',
    genres: d.genres || [],
    voteAverage: d.voteAverage || 0,
    runtime: d.runtime ?? null,
    cast: d.cast || [],
    seasons,
    numberOfEpisodes: d.numberOfEpisodes ?? null,
    tmdb: { id: d.id, type: d.type, alternativeTitles: d.alternativeTitles || [], popularity: d.popularity || 0 },
  };
}

function workFromVod(v, prev) {
  const kind = v.category?.kind && v.category.kind !== 'drop' ? v.category.kind : (prev?.kind || 'other');
  return {
    key: `cms-${v.siteId}-${v.vodId}`,
    type: kind === 'movie' ? 'movie' : 'tv',
    name: v.name,
    originalName: '',
    year: v.year ?? prev?.year ?? null,
    region: (v.category?.region && v.category.region !== 'other' ? v.category.region : regionOfArea(v.area)) || prev?.region || null,
    kind,
    poster: v.pic || prev?.poster || null,
    backdrop: null,
    overview: v.overview || prev?.overview || '',
    genres: v.typeName ? [v.typeName] : [],
    voteAverage: 0,
    cast: v.actors.slice(0, 6).map((name) => ({ id: null, name, character: '', profile: null })),
    seasons: [],
    tmdb: null,
    vod: v,
  };
}

/** @returns {Promise<any|null>} Work（不含 sources） */
export async function getWork(key) {
  const k = String(key || '');
  const prev = loadTitle(k)?.work ?? null;
  const m = /^(tv|movie)-(\d+)$/.exec(k);
  if (m) {
    let d = null;
    try { d = await tmdb.details(m[1], Number(m[2])); } catch (e) { console.warn('[work] TMDB 详情失败', e?.message || e); }
    if (!d) return prev;
    const w = workFromDetails(d, prev);
    saveTitle(w);
    return w;
  }
  const c = /^cms-(\d+)-(.+)$/.exec(k);
  if (c) {
    const site = listSites().find((s) => s.id === Number(c[1]));
    const vod = site ? (await detailSite(site, [c[2]]).catch(() => []))[0] : null;
    if (!vod) return prev;
    const w = workFromVod(vod, prev);
    saveTitle(w);
    return w;
  }
  return null;
}

/** 片源加上站点名和测得的延迟 */
function decorate(vods) {
  const sites = new Map(deps.listSites().map((s) => [s.id, s]));
  return vods.filter((v) => sites.has(v.siteId)).map((v) => {
    const s = sites.get(v.siteId);
    return { siteId: v.siteId, siteName: s.name, latency: s.latency_ms ?? null, vodId: v.vodId, name: v.name, year: v.year,
      remarks: v.remarks || '', lines: v.lines };
  });
}

/** 该作品要不要按季找（TMDB 有两季以上才分季） */
export const seasonParam = (work, season) => (work?.seasons?.length > 1 && Number(season) > 0 ? Number(season) : undefined);

const vk = (v) => `${v.siteId}:${v.vodId}`;
const srcKey = (key, s) => `src:${MATCH_V}:${key}:${s ?? ''}`;
const availKey = (key) => `avail:${MATCH_V}:${key}`;
const searchKey = (key) => `srch:${MATCH_V}:${key}`;

/**
 * 某作品（某一季）的片源，缓存 30 分钟（空结果只缓存 10 分钟）。
 * 片名搜索刚给这部作品找到的片源（rememberSearch）也并进来，按季筛：「搜索说有、详情说没有」不再发生。
 * @returns {Promise<any[]>}
 */
export async function sourcesFor(work, season) {
  const s = seasonParam(work, season);
  const isMovie = work.type === 'movie' || work.kind === 'movie';
  const fromSearch = (peekCache(searchKey(work.key)) || []).filter((v) => s == null || seasonOfVod(v, isMovie) === s);
  let list;
  try {
    list = await cached(srcKey(work.key, s), SRC_TTL, async () => {
      const found = await deps.findSources(work, s);
      const own = work.vod && work.vod.lines?.length ? [work.vod] : [];
      const seen = new Set();
      const all = [...own, ...found].filter((v) => !seen.has(vk(v)) && seen.add(vk(v)));
      if (!all.length && found.anyAnswered === false) throw new NoSiteAnswered();
      return all.length ? all : null;
    });
  } catch (e) {
    if (!(e instanceof NoSiteAnswered) || !fromSearch.length) throw e;
  }
  const seen = new Set();
  return decorate([...(list || []), ...fromSearch].filter((v) => !seen.has(vk(v)) && seen.add(vk(v))));
}

/**
 * 推荐卡片的可用性：有没有至少一条片源。有片源缓存 1 天，无片源 6 小时。
 * 取不到作品、或所有资源站都没回应时抛（不缓存）—— 只有至少一个站正常回了「没有」才记成无片源。
 */
export async function availability(key) {
  const r = await cached(availKey(key), AVAIL_TTL, async () => {
    const work = await (deps.getWork || getWork)(key);
    if (!work) throw new Error('作品不存在');
    return { ok: (await sourcesFor(work)).length > 0 };
  }, (v) => (v?.ok ? AVAIL_TTL : AVAIL_NEG_TTL));
  return !!r?.ok;
}

const REC_CONCURRENCY = 6; // 推荐预查同时在查的作品数（全局；每部 findSources 还受 aggregate 的全局搜词并发限制）

/**
 * 带优先级的并发限制（数小的先跑，同级先来先跑）：推荐预查让前面的排先查完、先渲染。
 * 返回的 run(pri, fn) 给出 { promise, raise(pri) }，还在排队的任务可以提前。
 */
function priorityLimit(n) {
  let active = 0;
  let seq = 0;
  const queue = [];
  const next = () => {
    while (active < n && queue.length) {
      let bi = 0;
      for (let i = 1; i < queue.length; i++) if (queue[i].pri < queue[bi].pri || (queue[i].pri === queue[bi].pri && queue[i].seq < queue[bi].seq)) bi = i;
      const t = queue.splice(bi, 1)[0];
      active++;
      Promise.resolve().then(t.fn).then(t.resolve, t.reject).finally(() => { active--; next(); });
    }
  };
  return (pri, fn) => {
    const t = { pri, seq: seq++, fn, resolve: null, reject: null };
    const promise = new Promise((resolve, reject) => { t.resolve = resolve; t.reject = reject; queue.push(t); next(); });
    return { promise, raise: (p) => { if (p < t.pri) t.pri = p; } };
  };
}
const recLimit = priorityLimit(REC_CONCURRENCY);

/**
 * 推荐排只留「有片源」的（首页用）：
 * - rows：[{ id, title, items: Promise<候选[]|null> }]，候选是 { key, name, ... }，已按 tmdb.recommendable 过滤、通常拉了 ≥ 2 倍；
 * - 按排的顺序挑：前面排用过的作品后面排不再出现（跨排去重）；每排按候选顺序预查 availability（全局限并发、走 1 天缓存），
 *   有片源的留下（显示名 / 海报换成作品详情里的，zh-CN → zh-TW/HK → 原名），凑满 need 张就停；凑不满 min 张整排返回 []（页面不显示）；
 * - 资源站全都没回应（任何一次预查抛 NoSiteAnswered）：之后不再预查，各排按 TMDB 原样返回（available: null，不判无），
 *   sitesDown 解析为 true，页面 toast 一次；availability 本身不写负缓存。
 * 每排的 items 各自解析（前一排挑完、本排的预查结果到了就出），页面可以逐排渲染。
 * @returns {{ rows: any[], sitesDown: Promise<boolean> }}
 */
export function recommendRows(rows, { need = 16, min = 6 } = {}) {
  const checks = new Map();
  const taken = new Set();
  const warned = new Set();
  let down = false;
  let setDown;
  const sitesDown = new Promise((r) => { setDown = r; });
  /** @returns {Promise<any|null>} 有片源 → 作品（拿显示名）；没有 / 查不出来 → null */
  // pri = 排的序号：前面的排先查（同一部被前面的排要到时提前）
  const check = (key, pri) => {
    let c = checks.get(key);
    if (c) c.raise(pri);
    else {
      c = recLimit(pri, async () => {
        // 轮到它时已被前面的排挑走（后面的排预取的）：不用再查
        if (down || taken.has(key)) return null;
        try {
          if (!(await availability(key))) return null;
          return (await (deps.getWork || getWork)(key)) || { key };
        } catch (e) {
          if (e instanceof NoSiteAnswered) {
            if (!down) { down = true; setDown(true); console.warn('[home] 资源站都没有回应，推荐排不过滤'); }
          } else {
            // 其他错误（TMDB 详情取不到等）当作没片源跳过，但每种错误记一次，免得 TMDB 故障看起来像「没片源」
            const kind = String(e?.message || e);
            if (!warned.has(kind)) { warned.add(kind); console.warn('[home] 推荐预查失败，跳过', key, kind); }
          }
          return null;
        }
      });
      checks.set(key, c);
    }
    return c.promise;
  };
  let prev = Promise.resolve();
  const out = rows.map((r, ri) => {
    const cands = Promise.resolve(r.items).catch(() => null);
    // 先把本排前 need 个候选排进预查队列（按排的优先级），前面的排挑完时本排多半也查好了
    cands.then((l) => { if (l && !down) for (const t of l.slice(0, need)) check(t.key, ri); });
    const items = prev.then(async () => {
      const l = await cands;
      if (!l) return null;
      const pool = l.filter((t) => !taken.has(t.key));
      const picked = [];
      for (let i = 0; i < pool.length && picked.length < need && !down; i++) {
        for (const t of pool.slice(i, i + REC_CONCURRENCY)) check(t.key, ri); // 往后预取一窗
        const w = await check(pool[i].key, ri);
        if (w) picked.push({ ...pool[i], name: w.name || pool[i].name, poster: w.poster || pool[i].poster, available: true });
      }
      const list = down ? pool.slice(0, need).map((t) => ({ ...t, available: null })) : picked.length >= min ? picked : [];
      for (const t of list) taken.add(t.key);
      return list;
    });
    prev = items.catch(() => {});
    return { ...r, items };
  });
  prev.then(() => setDown(down));
  return { rows: out, sitesDown };
}

/**
 * 搜索结果顺手记下：作品存进 title 表（作品详情取不到时的兜底），片源记进该作品的片源缓存、可用性记成「有」
 * （覆盖之前缓存的「无片源」）。详情页 / 卡片角标随后走 sourcesFor / availability 都能看到。
 * @param {any[]} works searchTitles / searchActor 的 Work[]
 */
export function rememberSearch(works) {
  for (const w of works || []) {
    try {
      if (!w?.key) continue;
      if (!loadTitle(w.key)) { const { sources, available, ...rest } = w; saveTitle(rest); }
      // TMDB 作品：只记通过片源判定（和 findSources 同一套）的条目，搜索路径万一混进别的作品也带不进详情页
      const sources = /^(tv|movie)-/.test(w.key) ? acceptSources(w, w.sources || []) : (w.sources || []);
      if (!sources.length) continue;
      const slim = sources.map((v) => ({ siteId: v.siteId, vodId: v.vodId, name: v.name, year: v.year ?? null, remarks: v.remarks || '', lines: v.lines }));
      putCache(searchKey(w.key), slim, SRC_TTL);
      putCache(availKey(w.key), { ok: true }, AVAIL_TTL);
    } catch { /* 缓存失败不影响搜索 */ }
  }
}
