import { json } from '@sveltejs/kit';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { getSetting, setSetting } from '$lib/server/settings.js';
import { db } from '$lib/server/db.js';
import { CACHE_DIR } from '$lib/server/paths.js';
import * as tmdb from '$lib/server/tmdb.js';

const headers = { 'cache-control': 'no-store' };
const KEYS = ['tmdb_key', 'llm_base', 'llm_key', 'llm_model'];

const snapshot = () => Object.fromEntries(KEYS.map((k) => [k, getSetting(k) ?? '']));

export const GET = () => json(snapshot(), { headers });

/**
 * POST /api/settings
 *   {tmdb_key?, llm_base?, llm_key?, llm_model?}  空串 = 删除（回到缺省）。改了 TMDB key 会试拉一次周榜，回 tmdbOk。
 *   {action: 'clearCache'}  清空响应缓存和图片缓存
 */
export async function POST({ request }) {
  const b = await request.json().catch(() => ({}));
  if (b.action === 'clearCache') {
    db().prepare('DELETE FROM cache').run();
    try { rmSync(join(CACHE_DIR, 'img'), { recursive: true, force: true }); } catch { /* 被占用的文件下次再清 */ }
    return json({ ok: true }, { headers });
  }
  for (const k of KEYS) {
    if (!(k in b)) continue;
    const v = String(b[k] ?? '').trim().slice(0, 500);
    setSetting(k, v || null);
  }
  let tmdbOk = null;
  if ('tmdb_key' in b && tmdb.hasKey()) {
    try { await tmdb.trending('tv'); tmdbOk = true; } catch { tmdbOk = false; }
  }
  return json({ ok: true, tmdbOk, ...snapshot() }, { headers });
}
