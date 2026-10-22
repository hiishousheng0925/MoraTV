import { json } from '@sveltejs/kit';
import { searchTitles, searchActor } from '$lib/server/search/aggregate.js';
import { hasKey, searchPerson } from '$lib/server/tmdb.js';

/**
 * GET /api/search?q=&mode=title|actor|auto[&person=<tmdbPersonId>]
 * -> { works: Work[], persons?: Person[] }
 * auto = 片名搜索；结果为空且 TMDB 有同名演员时附上演员结果（设计文档 §6.1）。
 */
export async function GET({ url }) {
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const mode = url.searchParams.get('mode') || 'title';
  const headers = { 'cache-control': 'no-store' };
  if (!q) return json({ works: [] }, { headers });
  try {
    if (mode === 'actor') {
      const personId = Number(url.searchParams.get('person')) || undefined;
      return json(await searchActor(q, { personId }), { headers });
    }
    const works = await searchTitles(q);
    if (mode === 'auto' && !works.length && hasKey()) {
      const persons = await searchPerson(q).catch(() => []);
      if (persons.length) return json(await searchActor(q), { headers });
    }
    return json({ works }, { headers });
  } catch (e) {
    console.error('[search]', e?.message || e);
    return json({ works: [], error: '搜索失败' }, { status: 500, headers });
  }
}
