import { json } from '@sveltejs/kit';
import { getProgress, saveProgress, removeHistory, clearHistory } from '$lib/server/library.js';

const headers = { 'cache-control': 'no-store' };

/** GET /api/progress?key= -> { episodes, last } */
export function GET({ url }) {
  const key = url.searchParams.get('key');
  if (!key) return json({ error: '缺少 key' }, { status: 400, headers });
  return json(getProgress(key), { headers });
}

/**
 * POST /api/progress  {key, season, episode, epName, position, duration, siteId, line}
 * 播放页每 10 秒 / 暂停 / 切集 / 关闭时调；关闭时用 sendBeacon（Blob 带 application/json，过得了 CSRF 钩子），仍按文本读再 parse。
 */
export async function POST({ request }) {
  let b;
  try { b = JSON.parse(await request.text()); } catch { return json({ error: '参数无效' }, { status: 400, headers }); }
  try { saveProgress(b); } catch (e) { return json({ error: e?.message || '保存失败' }, { status: e?.status || 500, headers }); }
  return json({ ok: true }, { headers });
}

/** DELETE /api/progress?key=  删一部的观看记录；?all=1 清空 */
export function DELETE({ url }) {
  if (url.searchParams.get('all')) clearHistory();
  else {
    const key = url.searchParams.get('key');
    if (!key) return json({ error: '缺少 key' }, { status: 400, headers });
    removeHistory(key);
  }
  return json({ ok: true }, { headers });
}
