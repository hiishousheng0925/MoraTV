import { json } from '@sveltejs/kit';
import { searchTitles, searchActor, searchActorQuick, searchActorSites, findActorEntry, titleOutranksActor } from '$lib/server/search/aggregate.js';
import { hasKey, searchPerson } from '$lib/server/tmdb.js';
import { searchPlot } from '$lib/server/search/plot.js';
import { rememberSearch as remember } from '$lib/server/works.js';

/**
 * GET /api/search?q=&mode=title|actor|plot|auto[&person=<tmdbPersonId>][&full=1]
 * -> { works: Work[], persons?: Person[], person?: number, bySites?: true, actorCard?: {id,name,profile,workCount} }
 * auto = 片名搜索；关键词恰好是热门演员名（且没有明显的同名作品）时附 actorCard；结果为空时改给演员结果（TMDB 或资源站 vod_actor）。
 * 演员模式没 key / TMDB 查无此人时用资源站（bySites）。
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
      let r = hasKey()
        ? (url.searchParams.get('full') ? await searchActor(q, { personId }) : await searchActorQuick(q, { personId }))
        : { persons: [], works: [] };
      // 没 key / TMDB 查无此人：用资源站的 vod_actor
      if (!r.persons?.length) r = await searchActorSites(q);
      remember(r.works);
      return json(r, { headers });
    }
    if (mode === 'plot') { const r = await searchPlot(q); remember(r.works); return json(r, { headers }); }
    // 自动模式：演员入口和片名搜索并行（人物查询有缓存，也不拖慢片名搜索）
    const entryP = mode === 'auto' && hasKey() ? findActorEntry(q).catch(() => null) : Promise.resolve(null);
    const [works, entry] = await Promise.all([searchTitles(q), entryP]);
    if (mode === 'auto' && !works.length) {
      // 没有同名作品：有同名演员就直接给演员结果；没 key 时按资源站的演员字段找
      if (hasKey()) {
        const persons = await searchPerson(q).catch(() => []);
        if (persons.length) { const r = await searchActorQuick(q); remember(r.works); return json(r, { headers }); }
      }
      const r = await searchActorSites(q);
      if (r.works.length) { remember(r.works); return json(r, { headers }); }
    }
    remember(works);
    const actorCard = entry && !titleOutranksActor(q, works, entry) ? entry : null;
    return json(actorCard ? { works, actorCard } : { works }, { headers });
  } catch (e) {
    if (e?.code === 'NO_LLM_KEY') return json({ works: [], error: 'NO_LLM_KEY' }, { status: 400, headers });
    console.error('[search]', e?.message || e);
    return json({ works: [], error: '搜索失败' }, { status: 500, headers });
  }
}
