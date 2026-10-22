/**
 * 作品详情与片源（详情页 / 播放页 / 可用性角标共用）。
 *
 * getWork(key)：tv- / movie- 走 TMDB 详情，cms- 走资源站详情；都写进 title 表。
 * 网络失败时退回 title 表里上次存的那份；都没有返回 null。
 */
import * as tmdb from './tmdb.js';
import { listSites } from './cms/sites.js';
import { detailSite } from './cms/client.js';
import { findSources as realFindSources, seasonOfVod } from './search/aggregate.js';
import { regionOfCountry, regionOfArea } from './search/normalize.js';
import { cached, putCache, peekCache } from './cache.js';
import { saveTitle, loadTitle } from './library.js';

const SRC_TTL = 30 * 60;
// 缓存键带匹配逻辑版本：匹配规则改了，老用户缓存里的「无片源」立刻失效
const MATCH_V = 'v2';

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
      if (!w.sources?.length) continue;
      const slim = w.sources.map((v) => ({ siteId: v.siteId, vodId: v.vodId, name: v.name, year: v.year ?? null, remarks: v.remarks || '', lines: v.lines }));
      putCache(searchKey(w.key), slim, SRC_TTL);
      putCache(availKey(w.key), { ok: true }, AVAIL_TTL);
    } catch { /* 缓存失败不影响搜索 */ }
  }
}
