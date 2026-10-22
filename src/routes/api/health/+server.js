import { json } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '$lib/server/db.js';

/**
 * GET /api/health —— 桌面主进程等服务起来时轮询它。
 * 真查一次库（首次调用同时完成建库 + 迁移），库打不开 / 被换成空库都会失败。
 * 失败返回 503，只回检查项名，不回路径。
 */
const RELEASE = (() => {
  try { return JSON.parse(readFileSync(join(process.cwd(), 'RELEASE.json'), 'utf8')).name || 'dev'; }
  catch { return 'dev'; }
})();

export async function GET() {
  const at = new Date().toISOString();
  try {
    db().prepare('SELECT 1 FROM setting LIMIT 1').get();
    return json({ ok: true, release: RELEASE, at }, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return json({ ok: false, release: RELEASE, error: `db: ${e?.code || 'ERROR'}`, at },
      { status: 503, headers: { 'cache-control': 'no-store' } });
  }
}
