/**
 * 浏览页的题材 / 排序 / 年代（前后端共用，不碰服务端模块）。
 *
 * 题材 → TMDB discover 参数。剧集的 genre 很粗（没有爱情 / 惊悚 / 恐怖，「Sci-Fi & Fantasy」在华语剧里基本就是仙侠玄幻），
 * 华语题材靠 keyword；keyword id 和命中数是 2026-10 实测（/search/keyword + /discover），别凭名字猜。
 * `|` = 取并集。剧集 / 电影 genre id 不同的分开写；某形态不适用就不写（该形态下不出现）。
 * tvNot：这些地区的剧集不出现（华语剧的 10765 实为仙侠玄幻，有「仙侠」了，不再叫「科幻」）。
 */
const KW = (k) => ({ with_keywords: k });
const G = (g) => ({ with_genres: String(g) });
const both = (p) => ({ tv: p, movie: p });

/** @type {{id: string, label: string, tv?: Record<string,string>, movie?: Record<string,string>, tvNot?: string[]}[]} */
export const GENRES = [
  { id: 'guzhuang', label: '古装', ...both(KW('195013|15060|295029|341424|347945')) },
  { id: 'wuxia', label: '武侠', ...both(KW('184656|779')) },
  { id: 'xianxia', label: '仙侠', ...both(KW('234890|347944|340360|297031|326271')) },
  { id: 'gongdou', label: '宫斗', ...both(KW('191599|8860|8754')) },
  { id: 'chuanyue', label: '穿越', ...both(KW('4379')) },
  { id: 'diezhan', label: '谍战', ...both(KW('5265|470')) },
  { id: 'xuanyi', label: '悬疑', ...both(G(9648)) },
  { id: 'fanzui', label: '犯罪', ...both(G(80)) },
  { id: 'lvzheng', label: '律政', ...both(KW('222517|10909')) },
  { id: 'yiliao', label: '医疗', ...both(KW('208788|11612')) },
  // 剧集没有爱情 genre：用 romance / love / romantic comedy 关键词
  { id: 'aiqing', label: '爱情', tv: KW('9840|290366|212796'), movie: G(10749) },
  { id: 'xiju', label: '喜剧', ...both(G(35)) },
  { id: 'dongzuo', label: '动作', tv: G(10759), movie: G(28) },
  { id: 'kehuan', label: '科幻', tv: G(10765), movie: G(878), tvNot: ['cn', 'hk', 'tw'] },
  // 惊悚 / 恐怖 / 逃生：剧集没有这些 genre，用 thriller / horror / survival / escape room / zombie / prison escape 关键词并集
  { id: 'jingsong', label: '惊悚', tv: KW('316362|12565|288394|315058|50009|10349|240252|186565|9777'), movie: G('53|27') },
  { id: 'zhanzheng', label: '战争', tv: G(10768), movie: G(10752) },
  { id: 'jiating', label: '家庭', ...both(G(10751)) },
  { id: 'juqing', label: '剧情', ...both(G(18)) },
];

/** 电视台（只对「剧集 · 香港」出现，可以和题材叠加：TVB × 犯罪 = TVB 警匪剧）。TVB keyword 只有个位数，用 network 48（TVB Jade）。 */
export const NETWORKS = [{ id: 'tvb', label: 'TVB', with_networks: '48', kind: 'tv', region: 'hk' }];

/** @param {string} id */
export const genreById = (id) => GENRES.find((g) => g.id === id) || null;
/** @param {string} id */
export const networkById = (id) => NETWORKS.find((n) => n.id === id) || null;

/**
 * 某个题材在 type（tv / movie）× region 下的 discover 参数；不适用返回 null。
 * @param {string} id @param {'tv'|'movie'} type @param {string} [region]
 */
export function genreParams(id, type, region = '') {
  const g = genreById(id);
  const p = g?.[type];
  if (!p) return null;
  if (type === 'tv' && region && g.tvNot?.includes(region)) return null;
  return { ...p };
}

/** 这个形态 × 地区下理论上适用的题材（有没有内容由服务端按 discover 总数再筛） */
export const genresFor = (type, region = '') => GENRES.filter((g) => genreParams(g.id, type, region));

/** 网络（TVB）是否适用：只有 kind 和 region 都对上 */
export const networkFor = (id, kind, region) => {
  const n = networkById(id);
  return n && n.kind === kind && n.region === region ? n : null;
};

/** 排序：'' = 热门（缺省，不写进 URL） */
export const SORTS = [['', '最热'], ['new', '最新'], ['score', '评分最高']];
/** 年代：'' = 不限 */
export const DECADES = [['', '年代不限'], ['2020s', '2020s'], ['2010s', '2010s'], ['2000s', '2000s'], ['old', '更早']];

/** 年代 -> [起, 止]（YYYY-MM-DD，缺的一端为 null）；不认识的返回 null */
export function decadeRange(d) {
  if (d === 'old') return [null, '1999-12-31'];
  const m = /^(\d{3})0s$/.exec(String(d || ''));
  if (!m) return null;
  const y = Number(m[1]) * 10;
  return [`${y}-01-01`, `${y + 9}-12-31`];
}

export const isSort = (s) => SORTS.some(([v]) => v && v === s);
export const isDecade = (d) => DECADES.some(([v]) => v && v === d);
