import { json } from '@sveltejs/kit';
import { availability } from '$lib/server/works.js';

/** GET /api/available?key= -> {available: true|false|null}（null = 这次没查出来）。结果在服务端缓存 1 天。 */
export async function GET({ url }) {
  const key = url.searchParams.get('key');
  const headers = { 'cache-control': 'no-store' };
  if (!key) return json({ available: null }, { status: 400, headers });
  try { return json({ available: await availability(key) }, { headers }); }
  catch { return json({ available: null }, { headers }); }
}
