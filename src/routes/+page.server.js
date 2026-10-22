import { continueList, favorites } from '$lib/server/library.js';
import * as tmdb from '$lib/server/tmdb.js';
import { homeRecommend } from '$lib/server/home.js';
import { regionOfCountry } from '$lib/server/search/normalize.js';
import { latestRows } from '$lib/server/cms/latest.js';

const ROW = 16;
const PAGES = 2; // 每排拉 2 页候选（约 40 个，过滤后仍 ≥ 2 倍 ROW），预查后去掉没片源的

/** TMDB 列表条目 -> 卡片要的字段（available 由 recommendRows 预查填上） */
const slim = (t) => ({ key: `${t.type}-${t.id}`, name: t.name, poster: t.poster, year: t.year, region: regionOfCountry(t.region),
  kind: t.type === 'movie' ? 'movie' : 'tv', available: null });

/**
 * 一排的候选：前 PAGES 页合并、按推荐规则过滤（discover 在请求里已带同样条件，trending 靠这里）、排内去重。
 * 第 1 页失败返回 null（页面 toast 一次），后面的页失败就少些候选，不让首页 500。
 * @param {(page: number) => Promise<any[]>} fetchPage @param {string} [region] 定评分人数门槛（港台低）
 */
function candidates(fetchPage, region) {
  const minVotes = tmdb.minVotesFor(region);
  const pages = Array.from({ length: PAGES }, (_, i) => fetchPage(i + 1));
  return pages[0].then(async (first) => {
    const rest = await Promise.all(pages.slice(1).map((p) => p.catch(() => [])));
    const seen = new Set();
    return [first, ...rest].flat().filter((t) => tmdb.recommendable(t, { minVotes })).map(slim).filter((t) => !seen.has(t.key) && seen.add(t.key));
  }).catch((e) => { pages.forEach((p) => p.catch(() => {})); console.warn('[home] TMDB', e?.message || e); return null; });
}

/** 推荐排（顺序 = 页面顺序 = 跨排去重的优先级） */
const DEFS = [
  { id: 'trend', title: '本周热门', fetch: (p) => tmdb.trending('all', p) },
  { id: 'hk', title: '热门港剧', region: 'hk' },
  { id: 'cn', title: '热门陆剧', region: 'cn' },
  { id: 'kr', title: '热门韩剧', region: 'kr' },
  { id: 'west', title: '热门欧美剧', region: 'west' },
  { id: 'movie', title: '热门电影', fetch: (p) => tmdb.trending('movie', p) },
];
const rowCandidates = (id) => {
  const d = DEFS.find((x) => x.id === id);
  return candidates(d.fetch || ((p) => tmdb.discover('tv', { region: d.region, kind: 'tv', page: p })), d.region);
};

/**
 * 「最近更新」三排（资源站，不需要 key）：共用一次请求；失败时三排都是 null。
 * down：是不是所有资源站都没回应（只有这种情况才提示「资源站暂时连不上」）。
 */
function latest() {
  let down = false;
  const p = latestRows().catch((e) => { down = !!e?.noSiteAnswered; console.warn('[home] 最近更新', e?.message || e); return null; });
  return {
    down: p.then(() => down),
    rows: [
      { id: 'new-tv', title: '最近更新 · 剧集', items: p.then((r) => r && r.tv) },
      { id: 'new-movie', title: '最近更新 · 电影', items: p.then((r) => r && r.movie) },
      { id: 'new-variety', title: '最近更新 · 综艺', items: p.then((r) => r && r.variety) },
    ],
  };
}

/** 任一为 true 就 true；全为 false 才 false */
const anyTrue = (ps) => new Promise((res) => {
  let n = ps.length;
  const one = (v) => { if (v) res(true); else if (--n === 0) res(false); };
  for (const p of ps) Promise.resolve(p).then(one, () => one(false));
});

export function load() {
  const hasKey = tmdb.hasKey();
  // 推荐排：只留有片源的、跨排去重。有上次的结果就先出它、后台重算（fresh）；第一次用就逐排流式送出
  const rec = hasKey ? homeRecommend(DEFS.map(({ id, title }) => ({ id, title })), rowCandidates, { need: ROW, min: 6 }) : null;
  const lt = latest();
  return {
    cont: continueList(20),
    favs: favorites().slice(0, 20),
    hasKey,
    // 有 key：TMDB 推荐在前，最近更新垫在后面（TMDB 挂了首页也不空）；没 key：只有最近更新。
    rows: [...(rec ? rec.rows : []), ...lt.rows],
    fresh: rec ? rec.fresh : null,
    // 资源站全都没回应（推荐预查或最近更新）：页面 toast 一次
    sitesDown: anyTrue([rec ? rec.sitesDown : false, lt.down]),
  };
}
