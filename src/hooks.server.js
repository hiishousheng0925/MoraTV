import { json } from '@sveltejs/kit';
import { csrfReject } from '$lib/server/csrf.js';

/** 写接口的跨站防护，规则见 $lib/server/csrf.js */
export async function handle({ event, resolve }) {
  const { request, url } = event;
  const why = csrfReject({
    method: request.method, pathname: url.pathname, origin: request.headers.get('origin'),
    contentType: request.headers.get('content-type'), selfOrigin: url.origin,
  });
  if (why) return json({ error: why }, { status: 403 });
  return resolve(event);
}
