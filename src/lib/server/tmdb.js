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

/**
 * 港产三级剥削片：TMDB 不标 adult，也没有「三级」关键词。用「香港出品 + 香港分级 III + 性暴力 / 情色关键词」三者同时满足圈出一份片单，
 * 按 id 排除（单靠分级会误伤《黑社会》这类 III 级正片，单靠 rapist 关键词会误伤《恐怖角》）。2026-10 实测 49 部。
 * 关键词：rapist / rape / date rape / teenage rape / marital rape / rape revenge / rape and revenge / gang rape / sexual violence /
 * sexual assault / sexploitation / pornography + EXCLUDE_KEYWORDS 的情色词。
 */
export const CAT3_KEYWORDS = [41381, 570, 171662, 15241, 164263, 196399, 184352, 12365, 11534, 190327, 10053, 445];
const BLOCK_TTL = 7 * DAY;
const BLOCK_MAX_PAGES = 10;
const BLOCK_RETRY_MS = 10 * 60 * 1000;
let blockFailedAt = 0;
const EMPTY_BLOCK = new Set();

/** 排除片单（电影 id 的 Set）。缓存 7 天；取失败当作空，10 分钟内不再试（不让每次列表请求都去撞）。没 key 为空。 */
export async function blockedMovieIds() {
  if (!hasKey() || Date.now() - blockFailedAt < BLOCK_RETRY_MS) return EMPTY_BLOCK;
  try {
    const ids = await cached('tmdb:blocked:v1', BLOCK_TTL, async () => {
      const params = { certification_country: 'HK', certification: 'III', with_origin_country: 'HK', include_adult: 'true',
        with_keywords: [...CAT3_KEYWORDS, ...EXCLUDE_KEYWORDS].join('|') };
      const out = [];
      for (let page = 1; page <= BLOCK_MAX_PAGES; page++) {
        const j = await raw('/discover/movie', { ...params, page });
        out.push(...(j?.results || []).map((r) => r.id));
        if (!j || page >= (Number(j.total_pages) || 1)) break;
      }
      return out;
    });
    return new Set(ids || []);
  } catch (e) {
    blockFailedAt = Date.now();
    console.warn('[tmdb] 排除片单', e?.message || e);
    return EMPTY_BLOCK;
  }
}

/** 去掉排除片单里的电影（mapItem 的结果） */
async function unblock(list) {
  const b = await blockedMovieIds();
  return b.size ? list.filter((t) => !(t.type === 'movie' && b.has(t.id))) : list;
}

export async function searchMulti(q, page = 1) {
  if (!hasKey() || !String(q || '').trim()) return [];
  return unblock(mapList(await get('/search/multi', { query: String(q).trim(), page, include_adult: 'false' }, TTL_LIST)));
}

export async function searchPerson(q) {
  if (!hasKey() || !String(q || '').trim()) return [];
  const j = await get('/search/person', { query: String(q).trim(), include_adult: 'false' }, TTL_LIST);
  const b = await blockedMovieIds();
  return (j?.results || []).map((p) => ({
    id: p.id, name: p.name || '', originalName: p.original_name || p.name || '', profile: p.profile_path || null,
    knownFor: p.known_for_department || '', popularity: p.popularity ?? 0,
    works: (p.known_for || []).filter((r) => r.media_type === 'tv' || r.media_type === 'movie').map((r) => mapItem(r))
      .filter((t) => !(t.type === 'movie' && b.has(t.id))),
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
  return unblock((j?.combined_credits?.cast || [])
    .filter((r) => (r.media_type === 'tv' || r.media_type === 'movie') && isActingCredit(r, names)
      && !seen.has(r.media_type + r.id) && seen.add(r.media_type + r.id))
    .map((r) => mapItem(r))
    .sort((a, b) => b.popularity - a.popularity));
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

/** 周榜（不按推荐规则过滤，进推荐前用 recommendable() 过滤；排除片单照样去掉）。@param {'tv'|'movie'|'all'} [type] */
export async function trending(type = 'all', page = 1) {
  if (!hasKey()) return [];
  const t = type === 'tv' || type === 'movie' ? type : 'all';
  const j = await get(`/trending/${t}/week`, page > 1 ? { page } : {}, TTL_LIST);
  return unblock(mapList(j, t === 'all' ? undefined : t));
}

const REGION = { cn: 'CN', hk: 'HK', tw: 'TW', kr: 'KR', jp: 'JP', th: 'TH', west: 'US|GB' };

/** 按评分排时的评分人数门槛（太少人评的高分没意义）：港 / 台放低 */
export const SCORE_MIN_VOTES = 50;
export const SCORE_MIN_VOTES_LOW = 10;
/**
 * TMDB 不标三级片：情色类关键词（erotic / softcore / erotica / sexploitation / erotic comedy / erotic romance / erotic theater /
 * erotic vignettes）一律排除，港片浏览「惊悚」里的聊斋艳谭、玉蒲团之类就是靠它挡掉的（2026-10 实测 id）。
 */
export const EXCLUDE_KEYWORDS = [256466, 155477, 325693, 10053, 302868, 298666, 352503, 155691];
/** 本地日期（UTC+8 早上 8 点前用 UTC 会把当天首播的算成「未来」） */
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/**
 * discover 的出站参数（不含 page / api_key）。规则见 discover()。
 * @param {'tv'|'movie'} type
 * @param {{region?: string, kind?: string, filter?: {with_genres?: string, with_keywords?: string, with_networks?: string},
 *   sort?: ''|'new'|'score', range?: [string|null, string|null]|null}} [opts]
 */
export function discoverParams(type, { region, kind, filter, sort = '', range = null } = {}) {
  let minVotes = minVotesFor(region);
  const hasFilter = !!(filter && (filter.with_genres || filter.with_keywords || filter.with_networks));
  // 剧集按题材筛：华语剧在 TMDB 上评分人数普遍少（内地谍战剧 ≥20 票的只有 1 部、≥5 票 8 部），门槛降到 MIN_VOTES_LOW
  if (hasFilter && type === 'tv' && kind !== 'variety' && kind !== 'doc') minVotes = Math.min(minVotes, MIN_VOTES_LOW);
  if (sort === 'score') minVotes = Math.max(minVotes, minVotes === MIN_VOTES_LOW ? SCORE_MIN_VOTES_LOW : SCORE_MIN_VOTES);
  const date = type === 'tv' ? 'first_air_date' : 'primary_release_date';
  const params = {
    sort_by: sort === 'new' ? `${date}.desc` : sort === 'score' ? 'vote_average.desc' : 'popularity.desc',
    include_adult: 'false', 'vote_count.gte': minVotes,
  };
  if (region) { const r = String(region); params.with_origin_country = REGION[r.toLowerCase()] || r.toUpperCase(); }
  const keep = kind === 'variety' && type === 'tv' ? [10767] : [];
  const without = new Set(EXCLUDE_GENRES.filter((g) => !keep.includes(g)));
  if (kind === 'variety' && type === 'tv') params.with_genres = '10764|10767';
  else if (kind === 'doc') params.with_genres = '99';
  else {
    if (kind === 'tv' && type === 'tv') for (const g of [10764, 10767, 99]) without.add(g);
    // 题材 / 电视台只在剧集 / 电影上叠加（综艺 / 纪录片本身就是 with_genres，不混）
    for (const k of ['with_genres', 'with_keywords', 'with_networks']) if (filter?.[k]) params[k] = String(filter[k]);
  }
  params.without_genres = [...without].join(',');
  params.without_keywords = EXCLUDE_KEYWORDS.join(',');
  // 年代；「最新」只看已经开播 / 上映的（TMDB 里有大量未来日期的占位条目）
  let [gte, lte] = range || [null, null];
  if (sort === 'new' && (!lte || lte > today())) lte = today();
  if (gte) params[`${date}.gte`] = gte;
  if (lte) params[`${date}.lte`] = lte;
  return { params, keep, minVotes };
}

/**
 * @param {'tv'|'movie'} type
 * @param {{region?: string, page?: number, kind?: 'tv'|'movie'|'variety'|'doc', filter?: object, sort?: ''|'new'|'score', range?: [string|null, string|null]|null}} [opts]
 * region：cn/hk/tw/kr/jp/th/west(=US|GB)，也可直接给 ISO 国家码；kind：variety = 综艺（真人秀|脱口秀），doc = 纪录片，
 * tv = 剧集（排除综艺 / 纪录片），movie 不加类型过滤。filter：题材 / 电视台（`$lib/genres.js`），只对剧集 / 电影生效。
 * sort：'' 热门 / new 最新（日期 ≤ 今天）/ score 评分（评分人数门槛抬高）；range：[起, 止] 日期（年代）。
 * 一律排除 EXCLUDE_GENRES（综艺要脱口秀，留着 10767）并要求 vote_count ≥ minVotesFor(region)；结果再过一遍 recommendable()。
 * 返回的数组带 totalPages / totalResults（TMDB 原样，最多 500 页）。
 */
export async function discover(type, opts = {}) {
  if (!hasKey() || (type !== 'tv' && type !== 'movie')) return [];
  const { params, keep, minVotes } = discoverParams(type, opts);
  const j = await get(`/discover/${type}`, { ...params, page: opts.page || 1 }, TTL_LIST);
  const out = (await unblock(mapList(j, type))).filter((t) => recommendable(t, { keep, minVotes }));
  out.totalPages = Math.min(500, Number(j?.total_pages) || 0);
  out.totalResults = Number(j?.total_results) || 0;
  return out;
}

const TTL_COUNT = 2 * DAY;
/**
 * 这组条件下有多少部（discover 的 total_results，只拿第 1 页）。浏览页据此隐藏没内容的题材。
 * 单独缓存 2 天（键只含参数），失败抛错不入缓存。没 key 返回 0。
 */
export async function discoverCount(type, opts = {}) {
  if (!hasKey() || (type !== 'tv' && type !== 'movie')) return 0;
  const { params } = discoverParams(type, opts);
  const q = new URLSearchParams({ ...params, page: '1' }).toString();
  return cached(`tmdb:count:${type}?${q}`, TTL_COUNT, async () => {
    const j = await raw(`/discover/${type}`, { ...params, page: 1 });
    return Number(j?.total_results) || 0;
  });
}
