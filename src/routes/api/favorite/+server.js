import { json } from '@sveltejs/kit';
import { toggleFavorite, loadTitle, favorites } from '$lib/server/library.js';

const headers = { 'cache-control': 'no-store' };

export const GET = () => json({ items: favorites() }, { headers });

/** POST /api/favorite {key} -> {on}（切换想看） */
export async function POST({ request }) {
  const b = await request.json().catch(() => ({}));
  const key = String(b.key || '');
  if (!key) return json({ error: '缺少 key' }, { status: 400, headers });
  return json({ on: toggleFavorite(key, loadTitle(key)?.work) }, { headers });
}
