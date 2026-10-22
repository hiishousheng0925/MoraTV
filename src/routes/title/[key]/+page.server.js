import { error, redirect } from '@sveltejs/kit';
import { getWork } from '$lib/server/works.js';
import { getProgress, isFavorite, resolveKey } from '$lib/server/library.js';

export async function load({ params, url }) {
  // cms 作品已经匹配到 TMDB 作品：统一到 TMDB 那一份（进度 / 想看 / 线路偏好都在那边）
  const rk = resolveKey(params.key);
  if (rk !== params.key) redirect(307, `/title/${rk}${url.search}`);
  const work = await getWork(params.key);
  if (!work) error(404, '作品信息加载失败');
  const { vod, ...w } = work;   // 资源站详情里的播放串不下发（片源由 /api/sources 给）
  return { work: w, progress: getProgress(params.key), fav: isFavorite(params.key) };
}
