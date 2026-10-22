import { error } from '@sveltejs/kit';
import { getWork } from '$lib/server/works.js';
import { getProgress } from '$lib/server/library.js';

export async function load({ params }) {
  const work = await getWork(params.key);
  if (!work) error(404, '作品信息加载失败');
  const { vod, ...w } = work;
  return { work: w, progress: getProgress(params.key) };
}
