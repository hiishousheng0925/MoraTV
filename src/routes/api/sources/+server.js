import { json } from '@sveltejs/kit';
import { getWork, sourcesFor } from '$lib/server/works.js';
import { getLinePref, setLinePref } from '$lib/server/library.js';

const headers = { 'cache-control': 'no-store' };

/**
 * GET /api/sources?key=&season= -> { sources: [{siteId, siteName, latency, vodId, name, year, remarks, lines}], pref }
 * 慢（要并发搜各资源站），所以详情页 / 播放页先出页面再懒加载它。
 */
export async function GET({ url }) {
  const key = url.searchParams.get('key');
  if (!key) return json({ error: '缺少 key' }, { status: 400, headers });
  try {
    const work = await getWork(key);
    if (!work) return json({ sources: [], pref: null, error: '作品信息加载失败' }, { status: 404, headers });
    const sources = await sourcesFor(work, url.searchParams.get('season'), { link: true });
    return json({ sources, pref: getLinePref(key) }, { headers });
  } catch (e) {
    console.error('[sources]', e?.message || e);
    return json({ sources: [], pref: null, error: e?.status === 502 ? e.message : '片源加载失败' }, { status: e?.status === 502 ? 502 : 500, headers });
  }
}

/** POST /api/sources {key, siteId, line}：记住用户手动选的线路 */
export async function POST({ request }) {
  const b = await request.json().catch(() => ({}));
  if (!b.key || !Number(b.siteId) || !b.line) return json({ error: '参数无效' }, { status: 400, headers });
  setLinePref(String(b.key), Number(b.siteId), String(b.line));
  return json({ ok: true }, { headers });
}
