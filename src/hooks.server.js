import { json } from '@sveltejs/kit';
import { csrfReject } from '$lib/server/csrf.js';
import { hostReject } from '$lib/server/hostguard.js';

/** Host 头白名单（防 DNS 重绑定，规则见 hostguard.js）+ 写接口的跨站防护（规则见 csrf.js） */
export async function handle({ event, resolve }) {
  const { request, url } = event;
  const bad = hostReject(request.headers.get('host'), process.env.ORIGIN);
  if (bad) return json({ error: bad }, { status: 403 });
  const why = csrfReject({
    method: request.method, pathname: url.pathname, origin: request.headers.get('origin'),
    contentType: request.headers.get('content-type'), selfOrigin: url.origin,
  });
  if (why) return json({ error: why }, { status: 403 });
  return resolve(event);
}
