import { continueList, favorites } from '$lib/server/library.js';
import * as tmdb from '$lib/server/tmdb.js';
import { recommendRows } from '$lib/server/works.js';
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
 * @param {(page: number) => Promise<any[]>} fetchPage
 */
function candidates(fetchPage) {
  const pages = Array.from({ length: PAGES }, (_, i) => fetchPage(i + 1));
  return pages[0].then(async (first) => {
    const rest = await Promise.all(pages.slice(1).map((p) => p.catch(() => [])));
    const seen = new Set();
    return [first, ...rest].flat().filter((t) => tmdb.recommendable(t)).map(slim).filter((t) => !seen.has(t.key) && seen.add(t.key));
  }).catch((e) => { pages.forEach((p) => p.catch(() => {})); console.warn('[home] TMDB', e?.message || e); return null; });
}

/** 「最近更新」三排（资源站，不需要 key）：共用一次请求；失败时三排都是 null */
function latest() {
  const p = latestRows().catch((e) => { console.warn('[home] 最近更新', e?.message || e); return null; });
  return [
    { id: 'new-tv', title: '最近更新 · 剧集', items: p.then((r) => r && r.tv) },
    { id: 'new-movie', title: '最近更新 · 电影', items: p.then((r) => r && r.movie) },
    { id: 'new-variety', title: '最近更新 · 综艺', items: p.then((r) => r && r.variety) },
  ];
}

export function load() {
  const hasKey = tmdb.hasKey();
  // 推荐排：只留有片源的、跨排去重；每排挑完就流式送出（前面的排先出）
  const rec = hasKey ? recommendRows([
    { id: 'trend', title: '本周热门', items: candidates((p) => tmdb.trending('all', p)) },
    { id: 'hk', title: '热门港剧', items: candidates((p) => tmdb.discover('tv', { region: 'hk', kind: 'tv', page: p })) },
    { id: 'cn', title: '热门陆剧', items: candidates((p) => tmdb.discover('tv', { region: 'cn', kind: 'tv', page: p })) },
    { id: 'kr', title: '热门韩剧', items: candidates((p) => tmdb.discover('tv', { region: 'kr', kind: 'tv', page: p })) },
    { id: 'west', title: '热门欧美剧', items: candidates((p) => tmdb.discover('tv', { region: 'west', kind: 'tv', page: p })) },
    { id: 'movie', title: '热门电影', items: candidates((p) => tmdb.trending('movie', p)) },
  ], { need: ROW, min: 6 }) : null;
  return {
    cont: continueList(20),
    favs: favorites().slice(0, 20),
    hasKey,
    // 推荐排是流式的：先出页面（搜索框可以马上用），排再陆续填上。
    // 有 key：TMDB 推荐在前，最近更新垫在后面（TMDB 挂了首页也不空）；没 key：只有最近更新。
    rows: [...(rec ? rec.rows : []), ...latest()],
    // 资源站全都没回应：推荐排不过滤，页面 toast 一次
    sitesDown: rec ? rec.sitesDown : false,
  };
}
