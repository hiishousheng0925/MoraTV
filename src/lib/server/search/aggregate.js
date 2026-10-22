/**
 * 聚合搜索（设计文档 §6.1）：资源站条目聚类成「作品」，再和 TMDB 结果对上。
 *
 * Work = { key, type, name, originalName, year, region, kind, poster, overview, tmdb: TmdbItem|null, sources: Vod[], available }
 *   key：tv-<id> / movie-<id>（有 TMDB 匹配）或 cms-<siteId>-<vodId>（代表条目）
 *   region：客户端地区码（cn/hk/tw/kr/jp/th/west/other/null）；kind：tv/movie/variety/doc/short/other
 *   poster：TMDB 的 poster_path（以 / 开头）或资源站图片完整 URL
 *
 * TMDB 只是锦上添花：没 key、超时、报错都降级为纯资源站结果。
 *
 * 匹配规则（搜索聚类和 findSources 共用，0.1.2 起）：
 *   - 片名：normTitle 相同（罗马数字已转）；剧集另认「片名N：副标题」「片名之副标题」（N = 季）；电影比「规范名 + 续集号」（无间道 ≠ 无间道2）。
 *   - 地区只在年份对不上时才拒：年份齐全且同年（续季：首季已收下同地区的条目）时允许跨地区（合拍片 / 港台互标 / 类目写国产剧但 vod_area 写台湾）。
 *     vod 的地区 = 类目地区 ∪ vod_area 里的全部地区。短剧不跨地区。
 *   - 形态对不上（TMDB 剧集 ↔ 资源站电影）：没有形态相符的条目时，同名（主名 / 原名）同年的才兜底；电影只收 ≤ 2 集的剧集条目。
 *   - 电影年份差 1 的条目要和同年条目（或 TMDB 中文演员表）有演员交集，否则是同名不同作（诺兰《奥德赛》2026 vs 英国恐怖片 2025）。
 *   - 片名带「（动画版）」「[解说]」之类注记的条目和动画类目一样直接丢。
 */
import { searchAll as cmsSearchAll, sitesVersion } from '../cms/sites.js';
import * as tmdbApi from '../tmdb.js';
import { pLimit } from '../net.js';
import { normTitle, rawKey, seasonOf, regionOfArea, regionsOfArea, regionOfCountry, normRoman, stripPartSubtitle, toSimplified } from './normalize.js';
import { variants } from './variants.js';
import { cleanName } from '../cms/parse.js';

const DEFAULT_DEPS = { searchAll: cmsSearchAll, sitesVersion, tmdb: tmdbApi };
let deps = DEFAULT_DEPS;

const ALT_DETAILS = 4;      // 取别名的 TMDB 条目数（按相关度）
const ROUND2_TERMS = 8;     // 二轮搜索最多关键词数
const ACTOR_WORKS = 24;     // 演员作品最多列多少部（按热度取，再按年份排）
const ACTOR_CONCURRENCY = 6;
const SOURCE_TERMS = 6;     // findSources 最多搜几个关键词（每个词 = 每个资源站 1–2 个请求）
const TERM_CONCURRENCY = 12; // 同时在搜的关键词数（全局，跨请求）：一次片名搜索的二轮最多 8 个词 + 一轮 3 个，要能一波发完
const TERM_TTL_MS = 10 * 60 * 1000; // 同一关键词 10 分钟内复用结果（逐部查可用性时很多作品共用一个词）
const TERM_MEMO_MAX = 300;

let termLimit = pLimit(TERM_CONCURRENCY);
let termMemo = new Map();

/** 测试钩子：注入假的 searchAll / tmdb；传 null 恢复。会清掉关键词缓存。 */
export function _setDeps(d) {
  deps = d ? { ...DEFAULT_DEPS, ...d, tmdb: { ...tmdbApi, ...(d.tmdb || {}) } } : DEFAULT_DEPS;
  termLimit = pLimit(TERM_CONCURRENCY);
  termMemo = new Map();
}

/** TMDB 调用一律兜底 */
async function safe(p, fallback) {
  try { return (await p) ?? fallback; } catch { return fallback; }
}

const CJK = /[㐀-鿿]/;
const KANA_HANGUL = /[぀-ヿ가-힯]/;
// 片名里的注记说明它不是正片 / 不是真人剧（「苍兰诀（动画版）」挂在国产剧类目下）
const NOT_DRAMA_NAME = /[(（[【][^)）\]】]*(?:动画|动漫|漫画|漫剧|解说|预告)[^)）\]】]*[)）\]】]|(?:动画|动漫|漫画)版$/;

const epCount = (v) => Math.max(0, ...v.lines.map((l) => l.episodes.length));
const usable = (v) => v && v.category?.kind !== 'drop' && Array.isArray(v.lines) && v.lines.length > 0 && !NOT_DRAMA_NAME.test(toSimplified(v.name));
const vodRegion = (v) => {
  const r = v.category?.region;
  return r && r !== 'other' ? r : regionOfArea(v.area);
};
/** 条目的全部地区：类目地区 ∪ vod_area 里出现的地区（「国产剧」类目、vod_area「台湾」两个都算） */
const vodRegions = (v) => {
  const s = new Set(regionsOfArea(v.area));
  const r = v.category?.region;
  if (r && r !== 'other') s.add(r);
  return s;
};
/** 条目「自称」的地区：类目带地区就信类目（「欧美剧」类目、vod_area「美国 / 中国大陆」是美剧），否则 vod_area 里的全部地区 */
const primaryRegions = (v) => {
  const r = v.category?.region;
  return r && r !== 'other' ? [r] : regionsOfArea(v.area);
};
/** 地区相符：作品没地区 / 条目没地区 / 条目自称的地区里有它；不相符的走「跨地区」规则（同年 + 演员） */
const regionFits = (region, v) => {
  if (!region || region === 'other') return true;
  const rs = primaryRegions(v);
  return !rs.length || rs.includes(region);
};

const regionOk = (a, b) => !a || !b || a === 'other' || b === 'other' || a === b;
const kindOk = (a, b) => !a || !b || a === 'other' || b === 'other' || a === b;
const isSeries = (k) => k !== 'movie';

/** 比较演员用：繁转简、去间隔号 / 空白，小写 */
const actorKey = (s) => toSimplified(String(s || '')).replace(/[\s·•．.\-]/g, '').toLowerCase();

/** 一个关键词搜所有站（全局限并发；同一站点配置下 10 分钟内同词复用；有站没回应的结果不复用） */
function searchTerm(t) {
  const now = Date.now();
  const key = `${deps.sitesVersion?.() ?? 0}|${t}`;
  const hit = termMemo.get(key);
  if (hit && now - hit.at < TERM_TTL_MS) return hit.p;
  const p = termLimit(() => deps.searchAll(t)).catch(() => Object.assign([], { answered: 0 }));
  termMemo.set(key, { at: now, p });
  p.then((l) => {
    const partial = l.answered === 0 || (l.total != null && l.answered < l.total);
    if (partial && termMemo.get(key)?.p === p) termMemo.delete(key);
  });
  if (termMemo.size > TERM_MEMO_MAX) {
    for (const [k, v] of termMemo) if (now - v.at >= TERM_TTL_MS || termMemo.size > TERM_MEMO_MAX) termMemo.delete(k); else break;
  }
  return p;
}

/**
 * 多个关键词搜所有站点，按 (siteId, vodId) 去重并滤掉不可用条目（返回的是副本，可以随意打标记）。
 * 返回的数组带 anyAnswered：至少有一个站正常回应过（searchAll 不报 answered 时按「回应了」算）。
 */
async function searchTerms(terms, seen = new Set()) {
  const lists = await Promise.all(terms.map(searchTerm));
  const out = [];
  out.anyAnswered = lists.some((l) => l.answered == null || l.answered > 0);
  for (const v of lists.flat()) {
    const k = `${v.siteId}:${v.vodId}`;
    if (!usable(v) || seen.has(k)) continue;
    seen.add(k);
    out.push({ ...v });
  }
  return out;
}

/** 条目的规范化片名；末尾紧贴的四位数等于条目年份时当年份后缀去掉（「大时代1992」，「请回答1988」不受影响） */
function ntOf(v) {
  const nt = normTitle(v.name);
  const m = nt.match(/^(.*\D)((?:19|20)\d\d)$/);
  return m && v.year != null && Number(m[2]) === v.year ? m[1] : nt;
}

/** 电影片名键：规范名 + 续集号（「流浪地球2」≠「流浪地球」，「无间道Ⅲ：终极无间」=「无间道3：终极无间」） */
const movieKey = (name) => { const nt = normTitle(name); return nt ? `${nt}#${seasonOf(name) ?? 1}` : ''; };
const movieKeyOfVod = (v) => `${ntOf(v)}#${seasonOf(v.name) ?? 1}`;

/** 剧集条目可能的 [规范名, 季]：先按原名，再按「片名N：副标题 / 片名之副标题」拆出的片名 */
function seriesKeys(v) {
  const keys = [{ nt: ntOf(v), season: seasonOf(v.name) ?? 1 }];
  const p = stripPartSubtitle(v.name);
  if (p) {
    const nt = normTitle(p.base);
    if (nt && nt !== keys[0].nt) keys.push({ nt, season: p.part ?? seasonOf(p.base) ?? 1, sub: true, numbered: p.part != null });
  }
  return keys;
}

/**
 * 条目的季号（电影恒为 1）：「第二季」「庆余年2」「少年包青天Ⅲ之天芒传奇」「创世纪2：天地有情」都认。
 * @param {{name: string}} v @param {boolean} isMovie
 */
export function seasonOfVod(v, isMovie) {
  if (isMovie) return 1;
  const s = seasonOf(v.name);
  if (s != null) return s;
  return stripPartSubtitle(v.name)?.part ?? 1;
}

/** 聚类用的 [规范名, 季]：剧集条目片名带分部号（「创世纪1：地产风云」）时按拆出的片名聚 */
function clusterKey(v, kind) {
  if (kind === 'movie') return { nt: ntOf(v), season: 1, mk: movieKeyOfVod(v) };
  const nt = ntOf(v);
  const s = seasonOf(v.name);
  if (s == null) {
    const p = stripPartSubtitle(v.name);
    if (p?.part != null && normTitle(p.base)) return { nt: normTitle(p.base), season: p.part, mk: null };
  }
  return { nt, season: s ?? 1, mk: null };
}

const actorsOf = (vods) => new Set(vods.flatMap((v) => (v.actors || []).map(actorKey)).filter(Boolean));
const overlaps = (a, b) => { for (const x of a) if (b.has(x)) return true; return false; };

/** 聚类：规范名相同 + 形态 / 地区兼容 + 年份 ±1（多季剧不比年份；电影年份差 1 还要演员有交集）。 */
function cluster(vods) {
  const clusters = [];
  for (const v of vods) {
    const kind = v.category?.kind || 'other';
    // 电影片名末尾的数字是续集编号（流浪地球2），不是「第 N 季」：续集和前作按片名键分开
    const { nt, season, mk } = clusterKey(v, kind);
    if (!nt) continue;
    const region = vodRegion(v);
    const regions = vodRegions(v);
    const c = clusters.find((c) => {
      if (c.nt !== nt || !kindOk(c.kind, kind)) return false;
      // 地区不同：只有同年、且条目自称的地区有交集才并（「欧美剧 / 美国·中国大陆」的网飞三体不并进国产三体）
      if (!regionOk(c.region, region) && !(c.baseYear != null && v.year === c.baseYear && overlaps(new Set(primaryRegions(v)), c.strong))) return false;
      if (c.mk && mk && c.mk !== mk) return false;
      if (season > 1) {
        // 续季：只限剧集，且不早于首季
        if (!isSeries(kind) || !isSeries(c.kind)) return false;
        return c.baseYear == null || v.year == null || v.year >= c.baseYear - 1;
      }
      if (c.baseYear != null && v.year != null) {
        if (Math.abs(c.baseYear - v.year) > 1) return false;
        // 电影差一年：演员没交集的是同名不同作
        if (kind === 'movie' && c.baseYear !== v.year && v.actors?.length && c.actors.size && !overlaps(actorsOf([v]), c.actors)) return false;
        return true;
      }
      if (!c.seasons.has(1)) {
        // 聚类里只有续季：首季只限剧集，且不晚于最早一季
        if (!isSeries(kind) || !isSeries(c.kind)) return false;
        return c.minYear == null || v.year == null || v.year <= c.minYear + 1;
      }
      return true; // 任一方年份缺失：只靠标题 + 地区
    });
    if (c) {
      c.vods.push(v);
      c.seasons.add(season);
      for (const r of regions) c.regions.add(r);
      for (const r of primaryRegions(v)) c.strong.add(r);
      for (const a of actorsOf([v])) c.actors.add(a);
      if (!c.region || c.region === 'other') c.region = region || c.region;
      if (c.kind === 'other' && kind !== 'other') c.kind = kind;
      if (!c.mk && mk) c.mk = mk;
      if (season === 1 && v.year != null && c.baseYear == null) c.baseYear = v.year;
      if (v.year != null) c.minYear = c.minYear == null ? v.year : Math.min(c.minYear, v.year);
    } else {
      clusters.push({
        nt, mk, vods: [v], seasons: new Set([season]), region, regions: new Set(regions), strong: new Set(primaryRegions(v)), kind, actors: actorsOf([v]),
        baseYear: season === 1 ? v.year : null, minYear: v.year,
        round: v._round || 1,
      });
    }
  }
  for (const c of clusters) c.round = Math.min(...c.vods.map((v) => v._round || 1));
  return clusters;
}

/** TMDB 条目的所有可比标题（规范化后） */
function tmdbTitles(t) {
  return [...new Set([t.name, t.originalName, ...(t.alternativeTitles || [])].map(normTitle).filter(Boolean))];
}
function tmdbMovieKeys(t) {
  return new Set([t.name, t.originalName, ...(t.alternativeTitles || [])].map(movieKey).filter(Boolean));
}

const clusterYear = (c) => c.baseYear ?? (c.seasons.has(1) ? c.minYear : null);

/**
 * 给聚类找 TMDB：标题或别名相同 + 年份 ±1（续季只要求不早于首播）；地区不同只在同年时放行（分数低于地区一致的）；热度高的优先。
 * relaxKind：形态兜底（TMDB 剧集 ↔ 资源站电影），只认主名 / 原名同名且同年。
 */
function matchTmdb(c, items, { relaxKind = false } = {}) {
  let best = null;
  let bestScore = -Infinity;
  const y = clusterYear(c);
  for (const t of items) {
    if (!t._nts.includes(c.nt)) continue;
    if (t.type === 'movie' && c.kind === 'movie' && c.mk && !t._mks.has(c.mk)) continue;
    const kindMismatch = (t.type === 'movie' && c.kind !== 'movie' && c.kind !== 'other') || (t.type === 'tv' && c.kind === 'movie');
    if (kindMismatch) {
      if (!relaxKind || t.year == null || y !== t.year) continue;
      if (![t.name, t.originalName].map(normTitle).includes(c.nt)) continue;
      if (t.type === 'movie' && (c.kind === 'variety' || c.kind === 'doc' || c.vods.some((v) => epCount(v) > 2))) continue;
    } else if (relaxKind) continue;
    const tr = regionOfCountry(t.region);
    const regionMatch = !tr || tr === 'other' || !c.strong.size || c.strong.has(tr);
    if (!regionMatch && (c.kind === 'short' || t.year == null || y !== t.year)) continue;
    if (t.year != null) {
      if (y != null) { if (Math.abs(y - t.year) > 1) continue; }
      else if (c.minYear != null && !(t.type === 'tv' && c.minYear >= t.year - 1)) continue;
    }
    const score = (tr && c.strong.has(tr) ? 1000 : 0) + (regionMatch ? 500 : 0) + (t.year != null && y === t.year ? 100 : 0) + Math.min(99, t.popularity || 0);
    if (score > bestScore) { best = t; bestScore = score; }
  }
  return best;
}

/** TMDB 的人物搜索不按热度排（同名的无名摄影师可能排第一）：按热度降序，稳定排序 */
const rankPersons = (list) => [...list].sort((a, b) => (b.popularity || 0) - (a.popularity || 0));

/** 与查询的相似度：3 完全相同、2 前缀、1 包含、0 无关 */
function similarity(nq, nts) {
  let s = 0;
  for (const n of nts) {
    if (!n || !nq) continue;
    if (n === nq) return 3;
    if (n.startsWith(nq) || nq.startsWith(n)) s = Math.max(s, 2);
    else if (n.includes(nq) || nq.includes(n)) s = Math.max(s, 1);
  }
  return s;
}

const sortSources = (vods) => [...vods].sort((a, b) => epCount(b) - epCount(a));

function strip(v) {
  const { _round, ...rest } = v;
  return rest;
}

function tmdbOnly(t) {
  return Object.fromEntries(Object.entries(t).filter(([k]) => !k.startsWith('_')));
}

function majorityKind(vods) {
  const n = {};
  for (const v of vods) { const k = v.category?.kind; if (k && k !== 'other') n[k] = (n[k] || 0) + 1; }
  return Object.entries(n).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
}

/**
 * 电影：年份差 1 的条目要和同年条目的演员有交集（没有同年条目时和 TMDB 演员表里的中文名比），否则丢。
 * 两边任一没有演员信息时不判。
 * @template T @param {T[]} list @param {(x: T) => any} vodOf @param {number} year @param {{name: string}[]} [cast]
 */
function pruneNeighbours(list, vodOf, year, cast = []) {
  const ref = actorsOf(list.map(vodOf).filter((v) => v.year === year));
  if (!ref.size) for (const c of cast || []) if (CJK.test(c?.name || '')) ref.add(actorKey(c.name));
  if (!ref.size) return list;
  return list.filter((x) => {
    const v = vodOf(x);
    if (v.year == null || v.year === year || !v.actors?.length) return true;
    return overlaps(actorsOf([v]), ref);
  });
}

/** TMDB 条目当作品看（给 acceptSources 用；形态取资源站条目的多数，和详情页 getWork 沿用搜索形态一致） */
function tmdbWork(t, vods) {
  return { name: t.name, originalName: t.originalName, year: t.year, region: regionOfCountry(t.region), type: t.type,
    kind: majorityKind(vods) || t.type, tmdb: { alternativeTitles: t.alternativeTitles || [] } };
}

function workFromTmdb(t, vods) {
  const sources = sortSources(vods).map(strip);
  const rep = sources[0];
  return {
    key: `${t.type}-${t.id}`,
    type: t.type,
    name: t.name || rep?.name || '',
    originalName: t.originalName || '',
    year: t.year ?? rep?.year ?? null,
    region: regionOfCountry(t.region) ?? (rep ? vodRegion(rep) : null),
    kind: majorityKind(vods) || t.type,
    poster: t.poster || rep?.pic || null,
    overview: t.overview || rep?.overview || '',
    tmdb: tmdbOnly(t),
    sources,
    available: sources.length > 0,
  };
}

function workFromCluster(c) {
  const sources = sortSources(c.vods).map(strip);
  // 代表条目：首季、有图、集数多
  const rep = [...sources].sort((a, b) => (seasonOfVod(a, false) - seasonOfVod(b, false)) || (!!b.pic - !!a.pic) || (epCount(b) - epCount(a)))[0];
  const kind = majorityKind(c.vods) || 'other';
  return {
    key: `cms-${rep.siteId}-${rep.vodId}`,
    type: kind === 'movie' ? 'movie' : 'tv',
    name: cleanName(rep.name).title || rep.name, // 显示名；资源站原名留在 rawName，仍参与匹配
    rawName: rep.name,
    originalName: '',
    year: c.baseYear ?? c.minYear ?? null,
    region: c.region || null,
    kind,
    poster: rep.pic || null,
    overview: rep.overview || '',
    tmdb: null,
    sources,
    available: true,
  };
}

/** 拉 TMDB：搜索结果 + 相关度最高的几条的别名（含 translations 里的中文译名） */
async function tmdbCandidates(q, nq) {
  const { tmdb } = deps;
  if (!tmdb.hasKey()) return [];
  const qs = [...new Set([q, variants(q)[1]].filter(Boolean))];
  const lists = await Promise.all(qs.map((x) => safe(tmdb.searchMulti(x), [])));
  const seen = new Set();
  const items = lists.flat().filter((t) => t && (t.type === 'tv' || t.type === 'movie') && !seen.has(`${t.type}-${t.id}`) && seen.add(`${t.type}-${t.id}`));
  const titles = (t) => { t._nts = tmdbTitles(t); t._mks = tmdbMovieKeys(t); t._sim = similarity(nq, t._nts); };
  items.forEach(titles);
  const top = [...items].sort((a, b) => (b._sim - a._sim) || (b.popularity - a.popularity)).slice(0, ALT_DETAILS);
  await Promise.all(top.map(async (t) => {
    const d = await safe(tmdb.details(t.type, t.id), null);
    if (d?.alternativeTitles?.length) {
      t.alternativeTitles = d.alternativeTitles;
      titles(t);
    }
  }));
  return items;
}

/**
 * 片名搜索。
 * @param {string} q
 * @returns {Promise<any[]>} Work[]
 */
export async function searchTitles(q) {
  const query = String(q ?? '').trim();
  if (!query) return [];
  const nq = normTitle(query);
  const terms = variants(query);
  const seen = new Set();
  const [round1, items] = await Promise.all([searchTerms(terms, seen), tmdbCandidates(query, nq)]);
  round1.forEach((v) => { v._round = 1; });
  let vods = round1;

  // 只保留和查询相关的 TMDB 条目（标题 / 别名包含关系），其余是 TMDB 的模糊匹配噪音
  const relevant = items.filter((t) => t._sim > 0);
  const keyOf = (t) => `${t.type}-${t.id}`;

  let clusters = cluster(vods);
  let matched = new Map(); // tmdb key -> clusters
  const take = (c, t) => { c.tmdb = t; const k = keyOf(t); (matched.get(k) || matched.set(k, []).get(k)).push(c); };
  const assign = () => {
    matched = new Map();
    for (const c of clusters) { c.tmdb = null; const t = matchTmdb(c, relevant); if (t) take(c, t); }
    // 形态兜底：TMDB 剧集一个条目都没对上时，同名同年的电影聚类归它（反之亦然）
    for (const c of clusters) {
      if (c.tmdb) continue;
      const t = matchTmdb(c, relevant.filter((t) => !matched.has(keyOf(t))), { relaxKind: true });
      if (t) take(c, t);
    }
    // 电影：同一 TMDB 条目下，年份差 1 且和同年聚类演员没交集的聚类是同名不同作，退回去单独成作品
    for (const [k, cs] of matched) {
      const t = relevant.find((t) => keyOf(t) === k);
      if (t?.type !== 'movie' || t.year == null || cs.length < 2) continue;
      const keep = pruneNeighbours(cs, (c) => ({ year: clusterYear(c), actors: [...c.actors] }), t.year);
      for (const c of cs) if (!keep.includes(c)) c.tmdb = null;
      matched.set(k, keep);
    }
  };
  assign();

  // 二轮：TMDB 有但资源站没对上的，用中文名 / 原名 / 别名再搜
  const missing = relevant.filter((t) => !matched.has(keyOf(t)));
  if (missing.length) {
    const searched = new Set(terms.map((t) => t.toLowerCase()));
    const extra = [];
    for (const t of missing.sort((a, b) => (b._sim - a._sim) || (b.popularity - a.popularity))) {
      const cands = [t.name, t.originalName, ...(t.alternativeTitles || []).filter((a) => CJK.test(a))];
      for (const c of cands) {
        const s = String(c || '').trim();
        if (!s || searched.has(s.toLowerCase())) continue;
        searched.add(s.toLowerCase());
        extra.push(s);
      }
    }
    const round2 = await searchTerms(extra.slice(0, ROUND2_TERMS), seen);
    if (round2.length) {
      round2.forEach((v) => { v._round = 2; });
      vods = [...vods, ...round2];
      clusters = cluster(vods);
      assign();
    }
  }

  // TMDB 把续季单列成一部（「溏心风暴3」）：同名聚类里该季的条目归它
  const extra = new Map();
  for (const t of relevant) {
    const ts = seasonOf(t.name);
    if (!ts || ts < 2 || t.type !== 'tv') continue;
    const moved = [];
    for (const c of clusters) {
      if (!t._nts.includes(c.nt) || c.tmdb === t) continue;
      const keep = [];
      for (const v of c.vods) (seasonOfVod(v, false) === ts ? moved : keep).push(v);
      c.vods = keep;
    }
    if (moved.length) extra.set(keyOf(t), moved);
  }

  const works = [];
  for (const t of relevant) {
    const k = keyOf(t);
    const cs = matched.get(k) || [];
    const cand = [...cs.flatMap((c) => c.vods), ...(extra.get(k) || [])];
    // 和详情页用同一套判定：搜索卡片上的片源不能比详情页多（网飞《三体》不进腾讯版）
    const ok = new Set(acceptSources(tmdbWork(t, cand), cand));
    for (const c of cs) if (!c.vods.some((v) => ok.has(v))) c.tmdb = null; // 整簇都不是它的：退回去单独成作品
    const w = workFromTmdb(t, cand.filter((v) => ok.has(v)));
    w._sim = t._sim;
    w._exact = rawKey(w.name) === rawKey(query) ? 1 : 0;
    w._pop = t.popularity || 0;
    works.push(w);
  }
  for (const c of clusters) {
    if (c.tmdb || c.round > 1 || !c.vods.length) continue; // 二轮搜到却没对上 TMDB 的是无关条目
    const w = workFromCluster(c);
    w._sim = similarity(nq, [c.nt]);
    w._exact = rawKey(w.name) === rawKey(query) ? 1 : 0;
    w._pop = 0;
    works.push(w);
  }
  works.sort((a, b) => (b.available - a.available) || (b._sim - a._sim) || (b._exact - a._exact) || (b._pop - a._pop) || (b.sources.length - a.sources.length));
  return works.map(({ _sim, _pop, _exact, ...w }) => w);
}

/**
 * findSources 的搜索词：主名、原名、全部中文别名（tmdb.details 已把 translations 的 zh 译名排在别名最前），
 * 转简体、罗马数字转阿拉伯数字后去重；资源站按「包含」搜，所以能被更短的词搜到的长词不再单独搜。
 * 再补主名的繁体写法。最多 SOURCE_TERMS 个。
 */
function sourceTerms(work, names) {
  // 有中文名时不搜外文原名（资源站按中文片名索引，外文原名几乎搜不到，白占请求）；作品主名本身是外文（HIStory）才搜
  const usableName = (n) => !KANA_HANGUL.test(n);
  const cjk = names.filter((n) => CJK.test(n) && usableName(n));
  const pool = cjk.length ? [...(work.name && !CJK.test(work.name) && usableName(work.name) ? [work.name] : []), ...cjk] : names.slice(0, 1);
  const ownKey = rawKey(toSimplified(normRoman(work.name || '')));
  const terms = [];
  const keys = [];
  for (const n of pool) {
    const t = toSimplified(normRoman(n)).replace(/\s+/g, ' ').trim();
    const k = rawKey(t);
    if (!k) continue;
    const coverable = (short) => short.length >= 3 || short === ownKey; // 太短的别名搜出来全是噪音，不拿它代替长词
    if (keys.some((x) => x === k || (k !== ownKey && coverable(x) && k.includes(x)))) continue;
    for (let i = keys.length - 1; i >= 0; i--) {
      if (keys[i] !== ownKey && coverable(k) && keys[i].includes(k)) { keys.splice(i, 1); terms.splice(i, 1); }
    }
    keys.push(k);
    terms.push(t);
  }
  const out = terms.slice(0, SOURCE_TERMS - 1);
  const trad = variants(out[0] || '').find((v) => v !== out[0] && !out.includes(v));
  if (trad) out.push(trad);
  return out;
}

/**
 * 给一个作品找片源（详情页 / 演员作品用）。season 不给 = 所有季。
 * 返回的数组带 anyAnswered（false = 所有资源站都没回应，空结果不可信）。
 * @param {{name: string, originalName?: string, year?: number|null, region?: string|null, kind?: string, type?: string, tmdb?: any, cast?: {name: string}[]}} work
 * @param {number} [season]
 */
export async function findSources(work, season) {
  const names = workNames(work);
  if (!names.some((n) => normTitle(n))) return [];
  const vods = await searchTerms(sourceTerms(work, names));
  const found = acceptSources(work, vods, season);
  found.anyAnswered = vods.anyAnswered;
  return found;
}

const workNames = (work) => [work.name, work.originalName, work.rawName, ...(work.tmdb?.alternativeTitles || [])].map((s) => String(s || '').trim()).filter(Boolean);

/**
 * 片源判定（findSources、搜索结果的 TMDB 作品、rememberSearch 共用）：从候选条目里挑出属于这部作品（这一季）的，按集数排序。
 * 规则见文件头注释。
 * @param {{name: string, originalName?: string, year?: number|null, region?: string|null, kind?: string, type?: string, tmdb?: any, cast?: {name: string}[]}} work
 * @param {any[]} vods @param {number} [season]
 */
export function acceptSources(work, vods, season) {
  const names = workNames(work);
  const nts = new Set(names.map(normTitle).filter(Boolean));
  if (!nts.size) return [];
  const isMovie = work.type === 'movie' || work.kind === 'movie';
  const mkeys = new Set(names.map(movieKey).filter(Boolean));
  const own = new Set([work.name, work.originalName].map(normTitle).filter(Boolean)); // 形态兜底只认主名 / 原名
  const hits = [];
  for (const v of vods) {
    let nt;
    let s;
    if (isMovie) {
      if (!mkeys.has(movieKeyOfVod(v))) continue;
      nt = ntOf(v);
      s = 1;
    } else {
      const k = seriesKeys(v).find((k) => nts.has(k.nt));
      if (!k) continue;
      ({ nt, season: s } = k);
      // 靠拆副标题才对上的：要有年份、不是短剧；「片名之副标题」没有分部号的还得同年（「繁花之重生黄河路」「爱回家之八时入席」是别的剧）
      if (k.sub && (v.year == null || v.category?.kind === 'short' || (!k.numbered && v.year !== work.year))) continue;
    }
    const vk = v.category?.kind;
    const sameYear = work.year != null && v.year === work.year;
    // 形态对不上：剧集 ↔ 电影。资源站把多集剧放进电影类目（≥ 3 集）照收；其余只在同名同年时兜底
    let fallback = false;
    if (isMovie ? vk && vk !== 'movie' && vk !== 'other' : vk === 'movie' && epCount(v) < 3) {
      if (isMovie && (vk === 'variety' || vk === 'doc' || epCount(v) > 2)) continue;
      if (!sameYear || !own.has(nt)) continue;
      fallback = true;
    }
    if (work.year != null && v.year != null && (s > 1 ? v.year < work.year - 1 : Math.abs(v.year - work.year) > 1)) continue;
    // 地区对不上：年份齐全且同年（续季见下）才放行；短剧不跨地区
    const regions = vodRegions(v);
    const cross = !regionFits(work.region, v);
    if (cross && (work.year == null || v.year == null || (s === 1 && !sameYear) || (vk === 'short' && work.kind !== 'short'))) continue;
    hits.push({ v, s, cross, fallback, regions });
  }
  let ok = hits.filter((h) => !h.fallback);
  if (!ok.length) ok = hits;
  // 续季跨地区：首季（已收下的；资源站没有首季时看地区相符的条目）里要有同地区的条目，说明资源站就是这么标这部剧的
  let firstRegions = new Set(ok.filter((h) => h.s === 1).flatMap((h) => [...h.regions]));
  if (!firstRegions.size) firstRegions = new Set(ok.filter((h) => !h.cross).flatMap((h) => [...h.regions]));
  ok = ok.filter((h) => !(h.cross && h.s > 1) || [...h.regions].some((r) => firstRegions.has(r)));
  // 有地区相符的条目时，跨地区的要和它们有演员交集（同名同年的内地剧不能混进韩剧）
  const home = actorsOf(ok.filter((h) => !h.cross).map((h) => h.v));
  if (home.size) ok = ok.filter((h) => !h.cross || !h.v.actors?.length || overlaps(actorsOf([h.v]), home));
  if (isMovie && work.year != null) ok = pruneNeighbours(ok, (h) => h.v, work.year, work.cast);
  if (season != null) ok = ok.filter((h) => h.s === season);
  return sortSources(ok.map((h) => h.v));
}

/**
 * 演员搜索：TMDB 找人，取第一位（或指定 personId）的作品，按年份倒序，并逐部查片源。
 * @param {string} q @param {{personId?: number}} [opts]
 */
export async function searchActor(q, { personId } = {}) {
  const query = String(q ?? '').trim();
  const { tmdb } = deps;
  if (!query || !tmdb.hasKey()) return { persons: [], works: [] };
  const persons = rankPersons(await safe(tmdb.searchPerson(query), []));
  if (!persons.length) return { persons: [], works: [] };
  const who = persons.find((p) => p.id === personId) || persons[0];
  const credits = (await safe(tmdb.personCredits(who.id), []))
    .filter((t) => t.type === 'tv' || t.type === 'movie')
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
    .slice(0, ACTOR_WORKS);
  const limit = pLimit(ACTOR_CONCURRENCY);
  const works = await Promise.all(credits.map((t) => limit(async () => {
    const region = regionOfCountry(t.region);
    const sources = await findSources({ name: t.name, originalName: t.originalName, year: t.year, region, type: t.type, kind: t.type });
    return workFromTmdb(t, sources);
  })));
  works.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  return { persons, works };
}

/**
 * 没有 TMDB key（或 TMDB 查无此人）时的演员搜索：名字当关键词搜各资源站，只留 vod_actor 里有这个名字的条目（繁简 / 间隔号不敏感），
 * 再用聚类并成作品。资源站大多只按片名搜，演员名常搜不出东西，所以召回有限；条目的演员列表整个相等才算（「刘德华」不匹配「刘德华仔」）。
 * @param {string} q
 * @returns {Promise<{persons: never[], works: any[], bySites: true}>}
 */
export async function searchActorSites(q) {
  const query = String(q ?? '').trim();
  const who = actorKey(query);
  if (!who) return { persons: [], works: [], bySites: true };
  // 综艺 / 晚会不算演戏（TMDB 路线的 isActingCredit 同理）
  const vods = (await searchTerms(variants(query))).filter((v) => v.category?.kind !== 'variety' && (v.actors || []).some((a) => actorKey(a) === who));
  vods.forEach((v) => { v._round = 1; });
  const works = cluster(vods).filter((c) => c.vods.length).map((c) => workFromCluster(c));
  works.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  return { persons: [], works, bySites: true };
}

/** 自动模式里「这个关键词是个演员」的最低热度（TMDB person popularity）；无名同名者都在 1 以下 */
const ACTOR_CARD_MIN_POP = 2;

/**
 * 自动模式的演员入口：关键词恰好是 TMDB 某人的名字（中文名或原名，繁简 / 标点不敏感）且热度够，返回入口卡所需的信息；否则 null。
 * 同名取最热的一位；没 key / 出错 / 没有符合的都是 null（不影响片名搜索）。
 * @param {string} q @returns {Promise<{id: number, name: string, profile: string|null, popularity: number, workCount: number}|null>}
 */
export async function findActorEntry(q) {
  const query = String(q ?? '').trim();
  const { tmdb } = deps;
  const nq = actorKey(query);
  if (!nq || !tmdb.hasKey()) return null;
  const persons = rankPersons(await safe(tmdb.searchPerson(query), []));
  const p = persons.find((p) => (p.popularity || 0) >= ACTOR_CARD_MIN_POP && [p.name, p.originalName].some((n) => actorKey(n) === nq));
  if (!p) return null;
  const credits = await safe(tmdb.personCredits(p.id), []);
  // 入口卡写的是点进去能看到的部数：演员页最多列 ACTOR_WORKS 部
  const workCount = Math.min(ACTOR_WORKS, credits.filter((t) => t.type === 'tv' || t.type === 'movie').length);
  if (!workCount) return null;
  return { id: p.id, name: p.name, profile: p.profile || null, popularity: p.popularity || 0, workCount };
}

/**
 * 有同名作品、且明显就是用户要找的（片名完全相同，并且有片源或比这位演员更热）时不放演员入口。
 * @param {string} q @param {any[]} works searchTitles 的结果 @param {{popularity: number}} entry
 */
export function titleOutranksActor(q, works, entry) {
  const nq = rawKey(toSimplified(String(q ?? '')));
  return (works || []).some((w) => rawKey(toSimplified(w.name || '')) === nq
    && (w.tmdb ? (w.tmdb.popularity || 0) >= entry.popularity : w.available));
}

/**
 * 演员搜索的快速版：只取人和作品列表（不逐部查片源，available 为 null），页面先渲染，可用性再懒加载。
 * @param {string} q @param {{personId?: number}} [opts]
 */
export async function searchActorQuick(q, { personId } = {}) {
  const query = String(q ?? '').trim();
  const { tmdb } = deps;
  if (!query || !tmdb.hasKey()) return { persons: [], works: [] };
  const persons = rankPersons(await safe(tmdb.searchPerson(query), []));
  if (!persons.length) return { persons: [], works: [] };
  const who = persons.find((p) => p.id === personId) || persons[0];
  const works = (await safe(tmdb.personCredits(who.id), []))
    .filter((t) => t.type === 'tv' || t.type === 'movie')
    .sort((a, b) => (b.popularity || 0) - (a.popularity || 0))
    .slice(0, ACTOR_WORKS)
    .map((t) => ({ ...workFromTmdb(t, []), available: null }))
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  return { persons, person: who.id, works };
}
