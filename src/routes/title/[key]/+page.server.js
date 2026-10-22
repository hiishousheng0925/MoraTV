import { error } from '@sveltejs/kit';
import { getWork } from '$lib/server/works.js';
import { getProgress, isFavorite } from '$lib/server/library.js';

export async function load({ params }) {
  const work = await getWork(params.key);
  if (!work) error(404, '作品信息加载失败');
  const { vod, ...w } = work;   // 资源站详情里的播放串不下发（片源由 /api/sources 给）
  return { work: w, progress: getProgress(params.key), fav: isFavorite(params.key) };
}
