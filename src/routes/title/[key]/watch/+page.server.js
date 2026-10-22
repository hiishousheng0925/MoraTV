import { error, redirect } from '@sveltejs/kit';
import { getWork } from '$lib/server/works.js';
import { getProgress, resolveKey, aliasRedirectSearch } from '$lib/server/library.js';

export async function load({ params, url }) {
  const rk = resolveKey(params.key);
  if (rk !== params.key) redirect(307, `/title/${rk}/watch${aliasRedirectSearch(params.key, url.search)}`);
  const work = await getWork(params.key);
  if (!work) error(404, '作品信息加载失败');
  const { vod, ...w } = work;
  return { work: w, progress: getProgress(params.key) };
}
