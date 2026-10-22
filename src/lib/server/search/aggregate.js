/**
 * 聚合搜索（设计文档 §6.1）：资源站条目聚类成「作品」，再和 TMDB 结果对上。
 *
 * Work = { key, type, name, originalName, year, region, kind, poster, overview, tmdb: TmdbItem|null, sources: Vod[], available }
 *   key：tv-<id> / movie-<id>（有 TMDB 匹配）或 cms-<siteId>-<vodId>（代表条目）
 *   region：客户端地区码（cn/hk/tw/kr/jp/th/west/other/null）；kind：tv/movie/variety/doc/short/other
 *   poster：TMDB 的 poster_path（以 / 开头）或资源站图片完整 URL
 *
 * TMDB 只是锦上添花：没 key、超时、报错都降级为纯资源站结果。
 */
import { searchAll as cmsSearchAll } from '../cms/sites.js';
import * as tmdbApi from '../tmdb.js';
import { pLimit } from '../net.js';
import { normTitle, seasonOf, regionOfArea, regionOfCountry } from './normalize.js';
import { variants } from './variants.js';

const DEFAULT_DEPS = { searchAll: cmsSearchAll, tmdb: tmdbApi };
let deps = DEFAULT_DEPS;

/** 测试钩子：注入假的 searchAll / tmdb；传 null 恢复。 */
export function _setDeps(d) {
  deps = d ? { ...DEFAULT_DEPS, ...d, tmdb: { ...tmdbApi, ...(d.tmdb || {}) } } : DEFAULT_DEPS;
}

const ALT_DETAILS = 4;      // 取别名的 TMDB 条目数（按相关度）
const ROUND2_TERMS = 8;     // 二轮搜索最多关键词数
const ACTOR_WORKS = 24;     // 演员作品最多列多少部（按热度取，再按年份排）
const ACTOR_CONCURRENCY = 6;

/** TMDB 调用一律兜底 */
async function safe(p, fallback) {
  try { return (await p) ?? fallback; } catch { return fallback; }
}

const epCount = (v) => Math.max(0, ...v.lines.map((l) => l.episodes.length));
const usable = (v) => v && v.category?.kind !== 'drop' && Array.isArray(v.lines) && v.lines.length > 0;
const vodRegion = (v) => {
  const r = v.category?.region;
  return r && r !== 'other' ? r : regionOfArea(v.area);
};

const regionOk = (a, b) => !a || !b || a === 'other' || b === 'other' || a === b;
const kindOk = (a, b) => !a || !b || a === 'other' || b === 'other' || a === b;
const isSeries = (k) => k !== 'movie';

/** 多个关键词并发搜所有站点，按 (siteId, vodId) 去重并滤掉不可用条目 */
async function searchTerms(terms, seen = new Set()) {
  const lists = await Promise.all(terms.map((t) => deps.searchAll(t).catch(() => [])));
  const out = [];
  for (const v of lists.flat()) {
    const k = `${v.siteId}:${v.vodId}`;
    if (!usable(v) || seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

/** 条目的规范化片名；末尾紧贴的四位数等于条目年份时当年份后缀去掉（「大时代1992」，「请回答1988」不受影响） */
function ntOf(v) {
  const nt = normTitle(v.name);
  const m = nt.match(/^(.*\D)((?:19|20)\d\d)$/);
  return m && v.year != null && Number(m[2]) === v.year ? m[1] : nt;
}

/** 聚类：normTitle 相同 + 形态 / 地区兼容 + 年份 ±1（多季剧不比年份）。 */
function cluster(vods) {
  const clusters = [];
  for (const v of vods) {
    const nt = ntOf(v);
    if (!nt) continue;
    const season = seasonOf(v.name) ?? 1;
    const region = vodRegion(v);
    const kind = v.category?.kind || 'other';
    const c = clusters.find((c) => {
      if (c.nt !== nt || !regionOk(c.region, region) || !kindOk(c.kind, kind)) return false;
      if (season > 1) {
        // 续季：只限剧集，且不早于首季
        if (!isSeries(kind) || !isSeries(c.kind)) return false;
        return c.baseYear == null || v.year == null || v.year >= c.baseYear - 1;
      }
      if (c.baseYear != null && v.year != null) return Math.abs(c.baseYear - v.year) <= 1;
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
      if (!c.region || c.region === 'other') c.region = region || c.region;
      if (c.kind === 'other' && kind !== 'other') c.kind = kind;
      if (season === 1 && v.year != null && c.baseYear == null) c.baseYear = v.year;
      if (v.year != null) c.minYear = c.minYear == null ? v.year : Math.min(c.minYear, v.year);
    } else {
      clusters.push({
        nt, vods: [v], seasons: new Set([season]), region, kind,
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

/** 给聚类找 TMDB：标题或别名相同 + 年份 ±1（续季只要求不早于首播），地区冲突的不要；地区一致、热度高的优先。 */
function matchTmdb(c, items) {
  let best = null;
  let bestScore = -Infinity;
  for (const t of items) {
    if (!t._nts.includes(c.nt)) continue;
    const tr = regionOfCountry(t.region);
    if (c.region && tr && c.region !== 'other' && tr !== 'other' && c.region !== tr) continue;
    if (t.type === 'movie' && c.kind !== 'movie' && c.kind !== 'other') continue;
    if (t.type === 'tv' && c.kind === 'movie') continue;
    const y = c.baseYear ?? (c.seasons.has(1) ? c.minYear : null);
    if (t.year != null) {
      if (y != null) { if (Math.abs(y - t.year) > 1) continue; }
      else if (c.minYear != null && !(t.type === 'tv' && c.minYear >= t.year - 1)) continue;
    }
    const score = (tr && c.region === tr ? 1000 : 0) + (t.year != null && y === t.year ? 100 : 0) + Math.min(99, t.popularity || 0);
    if (score > bestScore) { best = t; bestScore = score; }
  }
  return best;
}

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
  const rep = [...sources].sort((a, b) => ((seasonOf(a.name) ?? 1) - (seasonOf(b.name) ?? 1)) || (!!b.pic - !!a.pic) || (epCount(b) - epCount(a)))[0];
  const kind = majorityKind(c.vods) || 'other';
  return {
    key: `cms-${rep.siteId}-${rep.vodId}`,
    type: kind === 'movie' ? 'movie' : 'tv',
    name: rep.name,
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

/** 拉 TMDB：搜索结果 + 相关度最高的几条的别名 */
async function tmdbCandidates(q, nq) {
  const { tmdb } = deps;
  if (!tmdb.hasKey()) return [];
  const qs = [...new Set([q, variants(q)[1]].filter(Boolean))];
  const lists = await Promise.all(qs.map((x) => safe(tmdb.searchMulti(x), [])));
  const seen = new Set();
  const items = lists.flat().filter((t) => t && (t.type === 'tv' || t.type === 'movie') && !seen.has(`${t.type}-${t.id}`) && seen.add(`${t.type}-${t.id}`));
  items.forEach((t) => { t._nts = tmdbTitles(t); t._sim = similarity(nq, t._nts); });
  const top = [...items].sort((a, b) => (b._sim - a._sim) || (b.popularity - a.popularity)).slice(0, ALT_DETAILS);
  await Promise.all(top.map(async (t) => {
    const d = await safe(tmdb.details(t.type, t.id), null);
    if (d?.alternativeTitles?.length) {
      t.alternativeTitles = d.alternativeTitles;
      t._nts = tmdbTitles(t);
      t._sim = similarity(nq, t._nts);
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

  let clusters = cluster(vods);
  let matched = new Map(); // tmdb key -> clusters
  const assign = () => {
    matched = new Map();
    for (const c of clusters) {
      const t = matchTmdb(c, relevant);
      c.tmdb = t;
      if (t) { const k = `${t.type}-${t.id}`; (matched.get(k) || matched.set(k, []).get(k)).push(c); }
    }
  };
  assign();

  // 二轮：TMDB 有但资源站没对上的，用中文名 / 原名 / 别名再搜
  const missing = relevant.filter((t) => !matched.has(`${t.type}-${t.id}`));
  if (missing.length) {
    const searched = new Set(terms.map((t) => t.toLowerCase()));
    const extra = [];
    for (const t of missing.sort((a, b) => (b._sim - a._sim) || (b.popularity - a.popularity))) {
      const cands = [t.name, t.originalName, ...(t.alternativeTitles || []).filter((a) => /[㐀-鿿]/.test(a))];
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
      for (const v of c.vods) ((seasonOf(v.name) ?? 1) === ts ? moved : keep).push(v);
      c.vods = keep;
    }
    if (moved.length) extra.set(`${t.type}-${t.id}`, moved);
  }

  const works = [];
  for (const t of relevant) {
    const k = `${t.type}-${t.id}`;
    const cs = matched.get(k) || [];
    const w = workFromTmdb(t, [...cs.flatMap((c) => c.vods), ...(extra.get(k) || [])]);
    w._sim = t._sim;
    w._pop = t.popularity || 0;
    works.push(w);
  }
  for (const c of clusters) {
    if (c.tmdb || c.round > 1 || !c.vods.length) continue; // 二轮搜到却没对上 TMDB 的是无关条目
    const w = workFromCluster(c);
    w._sim = similarity(nq, [c.nt]);
    w._pop = 0;
    works.push(w);
  }
  works.sort((a, b) => (b.available - a.available) || (b._sim - a._sim) || (b._pop - a._pop) || (b.sources.length - a.sources.length));
  return works.map(({ _sim, _pop, ...w }) => w);
}

/**
 * 给一个作品找片源（详情页 / 演员作品用）。season 不给 = 所有季。
 * @param {{name: string, originalName?: string, year?: number|null, region?: string|null, kind?: string, type?: string, tmdb?: any}} work
 * @param {number} [season]
 */
export async function findSources(work, season) {
  const names = [work.name, work.originalName, ...(work.tmdb?.alternativeTitles || [])].map((s) => String(s || '').trim()).filter(Boolean);
  const nts = new Set(names.map(normTitle).filter(Boolean));
  if (!nts.size) return [];
  const cjk = names.filter((n) => /[㐀-鿿]/.test(n));
  const base = cjk.length ? cjk.slice(0, 2) : names.slice(0, 1);
  const terms = [...new Set(base.flatMap(variants))];
  const vods = await searchTerms(terms);
  const isMovie = work.type === 'movie' || work.kind === 'movie';
  return sortSources(vods.filter((v) => {
    if (!nts.has(ntOf(v))) return false;
    if (!regionOk(work.region, vodRegion(v))) return false;
    const vk = v.category?.kind;
    if (isMovie ? vk !== 'movie' && vk !== 'other' : vk === 'movie') return false;
    const s = seasonOf(v.name) ?? 1;
    if (season != null && s !== season) return false;
    if (work.year == null || v.year == null) return true;
    if (s > 1) return v.year >= work.year - 1;
    return Math.abs(v.year - work.year) <= 1;
  }));
}

/**
 * 演员搜索：TMDB 找人，取第一位（或指定 personId）的作品，按年份倒序，并逐部查片源。
 * @param {string} q @param {{personId?: number}} [opts]
 */
export async function searchActor(q, { personId } = {}) {
  const query = String(q ?? '').trim();
  const { tmdb } = deps;
  if (!query || !tmdb.hasKey()) return { persons: [], works: [] };
  const persons = await safe(tmdb.searchPerson(query), []);
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
 * 演员搜索的快速版：只取人和作品列表（不逐部查片源，available 为 null），页面先渲染，可用性再懒加载。
 * @param {string} q @param {{personId?: number}} [opts]
 */
export async function searchActorQuick(q, { personId } = {}) {
  const query = String(q ?? '').trim();
  const { tmdb } = deps;
  if (!query || !tmdb.hasKey()) return { persons: [], works: [] };
  const persons = await safe(tmdb.searchPerson(query), []);
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
