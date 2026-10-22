import { continueList, favorites } from '$lib/server/library.js';
import * as tmdb from '$lib/server/tmdb.js';
import { regionOfCountry } from '$lib/server/search/normalize.js';

const ROW = 16;

/** TMDB 列表条目 -> 卡片要的字段（available 由页面懒加载） */
const slim = (t) => ({ key: `${t.type}-${t.id}`, name: t.name, poster: t.poster, year: t.year, region: regionOfCountry(t.region),
  kind: t.type === 'movie' ? 'movie' : 'tv', available: null });

/** 推荐排：失败返回 null（页面 toast 一次），不让首页 500 */
const row = (p) => p.then((l) => l.slice(0, ROW).map(slim)).catch((e) => { console.warn('[home] TMDB', e?.message || e); return null; });

export function load() {
  const hasKey = tmdb.hasKey();
  return {
    cont: continueList(20),
    favs: favorites().slice(0, 20),
    hasKey,
    // 推荐排是流式的：先出页面（搜索框可以马上用），排再陆续填上
    rows: hasKey ? [
      { id: 'trend', title: '本周热门', items: row(tmdb.trending('all')) },
      { id: 'hk', title: '热门港剧', items: row(tmdb.discover('tv', { region: 'hk', kind: 'tv' })) },
      { id: 'cn', title: '热门陆剧', items: row(tmdb.discover('tv', { region: 'cn', kind: 'tv' })) },
      { id: 'kr', title: '热门韩剧', items: row(tmdb.discover('tv', { region: 'kr', kind: 'tv' })) },
      { id: 'west', title: '热门欧美剧', items: row(tmdb.discover('tv', { region: 'west', kind: 'tv' })) },
      { id: 'movie', title: '热门电影', items: row(tmdb.trending('movie')) },
    ] : [],
  };
}
