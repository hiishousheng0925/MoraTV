/**
 * TMDB 元数据层。没有 key 时所有函数返回 null / []，不抛；有 key 时网络 / HTTP 错误会抛（调用方自行降级，失败不入缓存）。
 * key 来自设置 tmdb_key（开发时可用环境变量 TMDB_KEY 兜底）；key 不进缓存键、不进日志。
 */
import { getSetting } from './settings.js';
import { cached } from './cache.js';
import { fetchWithTimeout, readTextCapped } from './net.js';

const DAY = 86400;
const TTL_DETAIL = 7 * DAY;
const TTL_LIST = 12 * 3600;

const base = () => (process.env.TMDB_BASE || 'https://api.themoviedb.org/3').replace(/\/+$/, '');
const key = () => (getSetting('tmdb_key') || process.env.TMDB_KEY || '').trim();

export const hasKey = () => !!key();

/** 原始请求（不缓存）。404 返回 null。 */
async function raw(path, params = {}, language = 'zh-CN') {
  const u = new URL(base() + path);
  u.searchParams.set('api_key', key());
  if (language) u.searchParams.set('language', language);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, String(v));
  const res = await fetchWithTimeout(u.href, { headers: { accept: 'application/json' } }, 10000);
  if (res.status === 404) { res.body?.cancel?.().catch(() => {}); return null; }
  const text = await readTextCapped(res);
  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return JSON.parse(text);
}

/** 校验当前 key（不走缓存：缓存键不含 key，换 key 后读缓存会误判）。无 key 返回 false；key 无效 / 连不上抛错。 */
export async function checkKey() {
  if (!hasKey()) return false;
  await raw('/configuration', {}, null);
  return true;
}

/** 带缓存的请求；缓存键不含 api_key。 */
function get(path, params, ttl, language = 'zh-CN') {
  const k = `tmdb:${language}:${path}?${new URLSearchParams(params || {}).toString()}`;
  return cached(k, ttl, () => raw(path, params, language));
}

const yearOf = (d) => { const y = parseInt(String(d || '').slice(0, 4), 10); return Number.isFinite(y) ? y : null; };

/** @param {any} r @param {string} [forceType] */
export function mapItem(r, forceType) {
  const type = forceType || r.media_type;
  const isTv = type === 'tv';
  return {
    type,
    id: r.id,
    name: (isTv ? r.name : r.title) || r.name || r.title || '',
    originalName: (isTv ? r.original_name : r.original_title) || r.original_name || r.original_title || '',
    year: yearOf(isTv ? r.first_air_date : r.release_date) ?? yearOf(r.first_air_date || r.release_date),
    region: r.origin_country?.[0] || null,
    poster: r.poster_path || null,
    overview: r.overview || '',
    popularity: r.popularity ?? 0,
    voteAverage: r.vote_average ?? 0,
  };
}

const mapList = (j, type) => (j?.results || [])
  .filter((r) => type || r.media_type === 'tv' || r.media_type === 'movie')
  .map((r) => mapItem(r, type));

export async function searchMulti(q, page = 1) {
  if (!hasKey() || !String(q || '').trim()) return [];
  return mapList(await get('/search/multi', { query: String(q).trim(), page, include_adult: 'false' }, TTL_LIST));
}

export async function searchPerson(q) {
  if (!hasKey() || !String(q || '').trim()) return [];
  const j = await get('/search/person', { query: String(q).trim(), include_adult: 'false' }, TTL_LIST);
  return (j?.results || []).map((p) => ({
    id: p.id, name: p.name || '', originalName: p.original_name || p.name || '', profile: p.profile_path || null,
    knownFor: p.known_for_department || '', popularity: p.popularity ?? 0,
    works: (p.known_for || []).filter((r) => r.media_type === 'tv' || r.media_type === 'movie').map((r) => mapItem(r)),
  }));
}

export async function personCredits(id) {
  if (!hasKey() || !id) return [];
  const j = await get(`/person/${id}/combined_credits`, {}, TTL_DETAIL);
  const seen = new Set();
  return (j?.cast || [])
    .filter((r) => (r.media_type === 'tv' || r.media_type === 'movie') && !seen.has(r.media_type + r.id) && seen.add(r.media_type + r.id))
    .map((r) => mapItem(r))
    .sort((a, b) => b.popularity - a.popularity);
}

/** @param {'tv'|'movie'} type */
export async function details(type, id) {
  if (!hasKey() || (type !== 'tv' && type !== 'movie') || !id) return null;
  const d = await get(`/${type}/${id}`, { append_to_response: 'alternative_titles,credits' }, TTL_DETAIL);
  if (!d) return null;
  let overview = d.overview || '';
  if (!overview) {
    for (const lang of ['zh-TW', 'zh-HK', 'en-US']) {
      const f = await get(`/${type}/${id}`, {}, TTL_DETAIL, lang).catch(() => null);
      if (f?.overview) { overview = f.overview; break; }
    }
  }
  const alts = d.alternative_titles?.titles || d.alternative_titles?.results || [];
  return {
    ...mapItem({ ...d, origin_country: d.origin_country?.length ? d.origin_country : d.production_countries?.map((c) => c.iso_3166_1) }, type),
    overview,
    tagline: d.tagline || '',
    genres: (d.genres || []).map((g) => g.name),
    status: d.status || '',
    runtime: d.runtime ?? d.episode_run_time?.[0] ?? null,
    backdrop: d.backdrop_path || null,
    numberOfSeasons: d.number_of_seasons ?? null,
    numberOfEpisodes: d.number_of_episodes ?? null,
    alternativeTitles: [...new Set(alts.map((t) => t.title).filter(Boolean))],
    cast: (d.credits?.cast || []).slice(0, 6).map((c) => ({ id: c.id, name: c.name, character: c.character || '', profile: c.profile_path || null })),
    seasons: (d.seasons || []).map((s) => ({
      season: s.season_number, name: s.name || '', episodeCount: s.episode_count ?? 0, airDate: s.air_date || null, poster: s.poster_path || null,
    })),
  };
}

export async function season(id, n) {
  if (!hasKey() || !id || n == null) return null;
  const s = await get(`/tv/${id}/season/${n}`, {}, TTL_DETAIL);
  if (!s) return null;
  return {
    season: s.season_number, name: s.name || '', overview: s.overview || '', airDate: s.air_date || null,
    episodes: (s.episodes || []).map((e) => ({
      episode: e.episode_number, name: e.name || '', overview: e.overview || '', airDate: e.air_date || null,
      runtime: e.runtime ?? null, still: e.still_path || null,
    })),
  };
}

/** 周榜。@param {'tv'|'movie'|'all'} [type] */
export async function trending(type = 'all') {
  if (!hasKey()) return [];
  const t = type === 'tv' || type === 'movie' ? type : 'all';
  const j = await get(`/trending/${t}/week`, {}, TTL_LIST);
  return mapList(j, t === 'all' ? undefined : t);
}

const REGION = { cn: 'CN', hk: 'HK', tw: 'TW', kr: 'KR', jp: 'JP', th: 'TH', west: 'US|GB' };

/**
 * @param {'tv'|'movie'} type
 * @param {{region?: string, page?: number, kind?: 'tv'|'movie'|'variety'|'doc'}} [opts]
 * region：cn/hk/tw/kr/jp/th/west(=US|GB)，也可直接给 ISO 国家码；kind：variety = 综艺（真人秀|脱口秀），doc = 纪录片，
 * tv = 剧集（排除综艺 / 纪录片），movie 不加类型过滤。
 */
export async function discover(type, { region, page = 1, kind } = {}) {
  if (!hasKey() || (type !== 'tv' && type !== 'movie')) return [];
  const params = { sort_by: 'popularity.desc', page, include_adult: 'false' };
  if (region) { const r = String(region); params.with_origin_country = REGION[r.toLowerCase()] || r.toUpperCase(); }
  if (kind === 'variety' && type === 'tv') params.with_genres = '10764|10767';
  else if (kind === 'doc') params.with_genres = '99';
  else if (kind === 'tv' && type === 'tv') params.without_genres = '10764,10767,99';
  return mapList(await get(`/discover/${type}`, params, TTL_LIST), type);
}
