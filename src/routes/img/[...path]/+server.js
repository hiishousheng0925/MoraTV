import { getImage } from '$lib/server/img.js';

/** /img/<size>/<file> -> image.tmdb.org/t/p/<size>/<file>，磁盘缓存。 */
export async function GET({ params }) {
  const [size, file, ...rest] = params.path.split('/');
  if (!size || !file || rest.length) return new Response('Not found', { status: 404 });
  const r = await getImage(size, file);
  if (r.status !== 200) return new Response(r.status === 404 ? 'Not found' : 'Bad gateway', { status: r.status });
  return new Response(r.body, { headers: { 'content-type': r.type, 'cache-control': 'public, max-age=31536000, immutable' } });
}
