import { json } from '@sveltejs/kit';
import { listSites, addSite, updateSite, removeSite, testSite, recordResult } from '$lib/server/cms/sites.js';

const headers = { 'cache-control': 'no-store' };
const fail = (e) => json({ error: e?.message || '操作失败' }, { status: e?.status || 500, headers });

export const GET = () => json({ sites: listSites() }, { headers });

/**
 * POST /api/sites {name, api}           添加
 * POST /api/sites {action:'test', id}   测速（结果记进站点的延迟 / 失败次数）-> {ok, latencyMs, total}
 */
export async function POST({ request }) {
  const b = await request.json().catch(() => ({}));
  try {
    if (b.action === 'test') {
      const site = listSites().find((s) => s.id === Number(b.id));
      if (!site) return json({ error: '站点不存在' }, { status: 404, headers });
      const r = await testSite(site);
      recordResult(site.id, r.ok, r.latencyMs);
      return json(r, { headers });
    }
    const site = addSite({ name: b.name, api: b.api });
    return json({ site }, { headers });
  } catch (e) {
    if (/UNIQUE/i.test(e?.message || '')) return json({ error: '这个站点已经添加过了' }, { status: 409, headers });
    return fail(e);
  }
}

/** PATCH /api/sites {id, enabled?, name?, api?, weight?} */
export async function PATCH({ request }) {
  const b = await request.json().catch(() => ({}));
  const { id, ...patch } = b;
  if (!Number(id)) return json({ error: '参数无效' }, { status: 400, headers });
  try { return json({ site: updateSite(Number(id), patch) }, { headers }); } catch (e) { return fail(e); }
}

/** DELETE /api/sites?id= */
export function DELETE({ url }) {
  const id = Number(url.searchParams.get('id'));
  if (!id) return json({ error: '参数无效' }, { status: 400, headers });
  removeSite(id);
  return json({ ok: true }, { headers });
}
