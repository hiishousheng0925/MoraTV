import { continueList, favorites } from '$lib/server/library.js';
import * as tmdb from '$lib/server/tmdb.js';
import { regionOfCountry } from '$lib/server/search/normalize.js';
import { latestRows } from '$lib/server/cms/latest.js';

const ROW = 16;

/** TMDB 列表条目 -> 卡片要的字段（available 由页面懒加载） */
const slim = (t) => ({ key: `${t.type}-${t.id}`, name: t.name, poster: t.poster, year: t.year, region: regionOfCountry(t.region),
  kind: t.type === 'movie' ? 'movie' : 'tv', available: null });

/** 推荐排：失败返回 null（页面 toast 一次），不让首页 500 */
const row = (p) => p.then((l) => l.slice(0, ROW).map(slim)).catch((e) => { console.warn('[home] TMDB', e?.message || e); return null; });

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
  return {
    cont: continueList(20),
    favs: favorites().slice(0, 20),
    hasKey,
    // 推荐排是流式的：先出页面（搜索框可以马上用），排再陆续填上。
    // 有 key：TMDB 推荐在前，最近更新垫在后面（TMDB 挂了首页也不空）；没 key：只有最近更新。
    rows: [
      ...(hasKey ? [
        { id: 'trend', title: '本周热门', items: row(tmdb.trending('all')) },
        { id: 'hk', title: '热门港剧', items: row(tmdb.discover('tv', { region: 'hk', kind: 'tv' })) },
        { id: 'cn', title: '热门陆剧', items: row(tmdb.discover('tv', { region: 'cn', kind: 'tv' })) },
        { id: 'kr', title: '热门韩剧', items: row(tmdb.discover('tv', { region: 'kr', kind: 'tv' })) },
        { id: 'west', title: '热门欧美剧', items: row(tmdb.discover('tv', { region: 'west', kind: 'tv' })) },
        { id: 'movie', title: '热门电影', items: row(tmdb.trending('movie')) },
      ] : []),
      ...latest(),
    ],
  };
}
