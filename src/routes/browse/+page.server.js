import * as tmdb from '$lib/server/tmdb.js';
import { parseQuery, browseTmdb, browseSites, genreCounts, hasGenres } from '$lib/server/browse.js';

export async function load({ url }) {
  const q = parseQuery(url.searchParams);
  if (!tmdb.hasKey()) {
    // 没 key：资源站分类（形态 × 地区）；没有题材 / 排序 / 年代
    try {
      const r = await browseSites(q);
      return { ...q, hasKey: false, items: r.items, totalPages: r.totalPages, site: r.site, genres: [], error: null };
    } catch (e) {
      console.warn('[browse] 资源站', e?.message || e);
      return { ...q, hasKey: false, items: [], totalPages: 0, site: null, genres: [], error: e?.noSiteAnswered ? 'sites' : 'other' };
    }
  }
  // 题材有没有内容：流式给页面（首次算要十几个计数请求，不挡结果）；失败为 null
  const genres = hasGenres(q.kind)
    ? genreCounts(q).catch((e) => { console.warn('[browse] 题材计数', e?.message || e); return null; })
    : [];
  try {
    const r = await browseTmdb(q);
    return { ...q, hasKey: true, items: r.items, totalPages: r.totalPages, site: null, genres, error: null };
  } catch (e) {
    console.warn('[browse] TMDB', e?.message || e);
    return { ...q, hasKey: true, items: [], totalPages: 0, site: null, genres, error: 'tmdb' };
  }
}
