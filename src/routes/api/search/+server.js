import { json } from '@sveltejs/kit';
import { searchTitles, searchActor, searchActorQuick } from '$lib/server/search/aggregate.js';
import { hasKey, searchPerson } from '$lib/server/tmdb.js';
import { searchPlot } from '$lib/server/search/plot.js';
import { saveTitle, loadTitle } from '$lib/server/library.js';
import { cached } from '$lib/server/cache.js';

/** 搜索结果顺手存进 title 表（作品详情取不到时的兜底），并把片源预热进详情页的片源缓存 */
function remember(works) {
  for (const w of works || []) {
    try {
      if (!loadTitle(w.key)) { const { sources, available, ...rest } = w; saveTitle(rest); }
      if (w.sources?.length) cached(`src:${w.key}:`, 30 * 60, async () => w.sources).catch(() => {});
    } catch { /* 缓存失败不影响搜索 */ }
  }
}

/**
 * GET /api/search?q=&mode=title|actor|plot|auto[&person=<tmdbPersonId>][&full=1]
 * -> { works: Work[], persons?: Person[], person?: number }
 * auto = 片名搜索；结果为空且 TMDB 有同名演员时附上演员结果（设计文档 §6.1）。
 * 演员模式缺省不逐部查片源（available 为 null，页面用 /api/available 懒加载）；full=1 才查。
 */
export async function GET({ url }) {
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const mode = url.searchParams.get('mode') || 'title';
  const headers = { 'cache-control': 'no-store' };
  if (!q) return json({ works: [] }, { headers });
  try {
    if (mode === 'actor') {
      const personId = Number(url.searchParams.get('person')) || undefined;
      const r = url.searchParams.get('full') ? await searchActor(q, { personId }) : await searchActorQuick(q, { personId });
      remember(r.works);
      return json(r, { headers });
    }
    if (mode === 'plot') { const r = await searchPlot(q); remember(r.works); return json(r, { headers }); }
    const works = await searchTitles(q);
    if (mode === 'auto' && !works.length && hasKey()) {
      const persons = await searchPerson(q).catch(() => []);
      if (persons.length) { const r = await searchActorQuick(q); remember(r.works); return json(r, { headers }); }
    }
    remember(works);
    return json({ works }, { headers });
  } catch (e) {
    if (e?.code === 'NO_LLM_KEY') return json({ works: [], error: 'NO_LLM_KEY' }, { status: 400, headers });
    console.error('[search]', e?.message || e);
    return json({ works: [], error: '搜索失败' }, { status: 500, headers });
  }
}
