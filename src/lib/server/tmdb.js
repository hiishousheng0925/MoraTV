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
    voteCount: r.vote_count ?? 0,
    genreIds: r.genre_ids || (r.genres || []).map((g) => g.id).filter((g) => g != null),
  };
}

/**
 * 推荐 / 浏览不展示的 TMDB 类型：动画 16（动漫交给 MoraAnime）、少儿 10762、新闻 10763、脱口秀 10767。
 * 和 MIN_VOTES 一起是推荐 / 浏览候选的唯一规则：discover 在请求里带上（without_genres / vote_count.gte），
 * trending 不支持这些参数，拉回来用 recommendable() 本地按同规则过滤。
 */
export const EXCLUDE_GENRES = [16, 10762, 10763, 10767];
export const MIN_VOTES = 20;
/** 港 / 台剧在 TMDB 上评分人数普遍很少（HK 剧集 ≥20 票的只有个位数），门槛放低 */
export const MIN_VOTES_LOW = 5;
const LOW_VOTE_REGIONS = new Set(['HK', 'TW']);
/** 某个地区（cn/hk/tw/… 或 ISO 国家码；空 = 不限地区）的评分人数门槛 */
export const minVotesFor = (region) => (LOW_VOTE_REGIONS.has(String(region || '').toUpperCase()) ? MIN_VOTES_LOW : MIN_VOTES);

/**
 * 能不能进推荐 / 浏览：没有被排除的类型、评分人数够（太冷门 / 还没上映的片资源站基本没有）。
 * @param {{genreIds?: number[], voteCount?: number}} t mapItem 的结果
 * @param {{keep?: number[], minVotes?: number}} [opts] keep：这次明确要的类型不排除（浏览「综艺」要脱口秀）；
 *   minVotes：评分人数门槛，缺省 MIN_VOTES，按地区取用 minVotesFor(region)
 */
export function recommendable(t, { keep = [], minVotes = MIN_VOTES } = {}) {
  if ((t.genreIds || []).some((g) => EXCLUDE_GENRES.includes(g) && !keep.includes(g))) return false;
  return (t.voteCount ?? 0) >= minVotes;
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

const NON_DRAMA_GENRES = new Set([10767, 10764, 10763]); // Talk / Reality / News
// 「Self」「Herself - Nominee」「Self (archive footage)」「Host」「本人」；角色名里带 self 的（「Young Self」）不误伤
// host / presenter 只认单独成词或后面跟「- ( /」的（「Host Club Girl」这类角色名不误伤）
const SELF_CHARACTER = /^\s*(?:self|himself|herself|themselves|themself)\b|^\s*(?:host|presenter)s?\s*(?:$|[-–(/,])|\((?:self|himself|herself)\)|\bas (?:himself|herself)\b|^\s*(?:本人|自己|他自己|她自己|主持人?|嘉宾)/i;
const AWARD_TITLE = /颁奖|典礼|晚会|春晚|金像奖|金马奖|金钟奖|金鸡奖|百花奖|飞天奖|白玉兰奖|百想|\bawards?\b|\boscars?\b|golden globes?|\bemmys?\b|\bgala\b|ceremony/i;

/** 比较人名用：去空白 / 标点 / 连字符，小写（「Yoo Jae-suk」=「Yoo Jae Suk」） */
const nameKey = (s) => String(s || '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();

/**
 * 演员作品里只留「演戏」的：综艺 / 脱口秀 / 新闻（genre）、以本人身份出镜（character 是 Self / 本人 / 就是这个人的名字）、
 * 颁奖礼 / 晚会（片名）都不算。
 * @param {any} r TMDB combined_credits 的 cast 条目（原始字段）
 * @param {Iterable<string>} [selfNames] 这个人的名字（含别名），角色名等于它们之一 = 本人出镜
 */
export function isActingCredit(r, selfNames = []) {
  if ((r.genre_ids || []).some((g) => NON_DRAMA_GENRES.has(g))) return false;
  const ch = String(r.character || '');
  if (SELF_CHARACTER.test(ch)) return false;
  const ck = nameKey(ch);
  if (ck && [...selfNames].some((n) => nameKey(n) === ck)) return false;
  // 片名像颁奖礼 / 晚会：只在 TMDB 没给类型时才据此丢（片名带「典礼」的正经剧 / 电影有类型，不误伤）
  if ((r.genre_ids || []).length) return true;
  const titles = [r.name, r.title, r.original_name, r.original_title].filter(Boolean).join(' ');
  return !AWARD_TITLE.test(titles);
}

/** 人物作品（只取演戏的，去重，按热度）。人物详情和作品一次取回：要拿名字 / 别名认「本人出镜」。 */
export async function personCredits(id) {
  if (!hasKey() || !id) return [];
  const j = await get(`/person/${id}`, { append_to_response: 'combined_credits' }, TTL_DETAIL);
  const names = [j?.name, ...(j?.also_known_as || [])].filter(Boolean);
  const seen = new Set();
  return (j?.combined_credits?.cast || [])
    .filter((r) => (r.media_type === 'tv' || r.media_type === 'movie') && isActingCredit(r, names)
      && !seen.has(r.media_type + r.id) && seen.add(r.media_type + r.id))
    .map((r) => mapItem(r))
    .sort((a, b) => b.popularity - a.popularity);
}

const ZH_ORDER = ['CN', 'TW', 'HK', 'SG'];
const zhRank = (c) => { const i = ZH_ORDER.indexOf(c); return i < 0 ? ZH_ORDER.length : i; };
/** 已按 ZH_ORDER 排好的 zh translations 里第一个非空译名 */
const zhName = (zh) => zh.map((t) => String(t.data?.name || t.data?.title || '').trim()).find(Boolean) || '';

/** @param {'tv'|'movie'} type */
export async function details(type, id) {
  if (!hasKey() || (type !== 'tv' && type !== 'movie') || !id) return null;
  const d = await get(`/${type}/${id}`, { append_to_response: 'alternative_titles,credits,translations' }, TTL_DETAIL);
  if (!d) return null;
  // translations：各中文地区的译名（资源站常用台湾 / 香港译名，比如「弱美男英雄」只在 zh-TW / zh-HK 里），简介也能从这里回退
  const zh = (d.translations?.translations || []).filter((t) => t.iso_639_1 === 'zh')
    .sort((a, b) => zhRank(a.iso_3166_1) - zhRank(b.iso_3166_1));
  const own = new Set([d.name, d.title, d.original_name, d.original_title].filter(Boolean));
  const zhTitles = zh.map((t) => String(t.data?.name || t.data?.title || '').trim()).filter((n) => n && !own.has(n));
  let overview = d.overview || zh.find((t) => t.data?.overview)?.data.overview || '';
  if (!overview) {
    for (const lang of ['zh-TW', 'zh-HK', 'en-US']) {
      const f = await get(`/${type}/${id}`, {}, TTL_DETAIL, lang).catch(() => null);
      if (f?.overview) { overview = f.overview; break; }
    }
  }
  const alts = d.alternative_titles?.titles || d.alternative_titles?.results || [];
  const base = mapItem({ ...d, origin_country: d.origin_country?.length ? d.origin_country : d.production_countries?.map((c) => c.iso_3166_1) }, type);
  return {
    ...base,
    // 显示名：zh-CN 译名 → zh-TW / HK / SG 译名 → zh-CN 请求回来的名字（TMDB 没有简中时就是原名）。
    // 华语原作（original_language zh / cn）的简中译名常是空的，原名本身就是中文，排在繁中译名前面。
    name: zhName(zh.filter((t) => t.iso_3166_1 === 'CN'))
      || (d.original_language === 'zh' || d.original_language === 'cn' ? base.name : '') || zhName(zh) || base.name,
    overview,
    tagline: d.tagline || '',
    genres: (d.genres || []).map((g) => g.name),
    status: d.status || '',
    runtime: d.runtime ?? d.episode_run_time?.[0] ?? null,
    backdrop: d.backdrop_path || null,
    numberOfSeasons: d.number_of_seasons ?? null,
    numberOfEpisodes: d.number_of_episodes ?? null,
    alternativeTitles: [...new Set([...zhTitles, ...alts.map((t) => t.title)].filter(Boolean))],
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

/** 周榜（原样，不过滤；进推荐前用 recommendable() 过滤）。@param {'tv'|'movie'|'all'} [type] */
export async function trending(type = 'all', page = 1) {
  if (!hasKey()) return [];
  const t = type === 'tv' || type === 'movie' ? type : 'all';
  const j = await get(`/trending/${t}/week`, page > 1 ? { page } : {}, TTL_LIST);
  return mapList(j, t === 'all' ? undefined : t);
}

const REGION = { cn: 'CN', hk: 'HK', tw: 'TW', kr: 'KR', jp: 'JP', th: 'TH', west: 'US|GB' };

/**
 * @param {'tv'|'movie'} type
 * @param {{region?: string, page?: number, kind?: 'tv'|'movie'|'variety'|'doc'}} [opts]
 * region：cn/hk/tw/kr/jp/th/west(=US|GB)，也可直接给 ISO 国家码；kind：variety = 综艺（真人秀|脱口秀），doc = 纪录片，
 * tv = 剧集（排除综艺 / 纪录片），movie 不加类型过滤。
 * 一律排除 EXCLUDE_GENRES（综艺要脱口秀，留着 10767）并要求 vote_count ≥ MIN_VOTES；结果再过一遍 recommendable()。
 */
export async function discover(type, { region, page = 1, kind } = {}) {
  if (!hasKey() || (type !== 'tv' && type !== 'movie')) return [];
  const minVotes = minVotesFor(region);
  const params = { sort_by: 'popularity.desc', page, include_adult: 'false', 'vote_count.gte': minVotes };
  if (region) { const r = String(region); params.with_origin_country = REGION[r.toLowerCase()] || r.toUpperCase(); }
  const keep = kind === 'variety' && type === 'tv' ? [10767] : [];
  const without = new Set(EXCLUDE_GENRES.filter((g) => !keep.includes(g)));
  if (kind === 'variety' && type === 'tv') params.with_genres = '10764|10767';
  else if (kind === 'doc') params.with_genres = '99';
  else if (kind === 'tv' && type === 'tv') for (const g of [10764, 10767, 99]) without.add(g);
  params.without_genres = [...without].join(',');
  return mapList(await get(`/discover/${type}`, params, TTL_LIST), type).filter((t) => recommendable(t, { keep, minVotes }));
}
