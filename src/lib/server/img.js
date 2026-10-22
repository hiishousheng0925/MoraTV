/** TMDB 图片代理 + 磁盘缓存（CACHE_DIR/img/<size>/<file>）。路由 /img/<size>/<file> 薄封装这里。 */
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR } from './paths.js';
import { fetchWithTimeout } from './net.js';

export const SIZES = new Set(['w185', 'w342', 'w500', 'w780', 'original']);
export const MAX_IMG = 10 * 1024 * 1024;
const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const FILE_RE = /^[A-Za-z0-9_-]{1,80}\.(jpg|jpeg|png|webp)$/;
const imgBase = () => (process.env.TMDB_IMG_BASE || 'https://image.tmdb.org/t/p').replace(/\/+$/, '');

async function readCapped(res, max) {
  if (Number(res.headers.get('content-length')) > max) { res.body?.cancel?.().catch(() => {}); return null; }
  const chunks = [];
  let n = 0;
  for await (const c of res.body || []) {
    n += c.length;
    if (n > max) { res.body.cancel?.().catch(() => {}); return null; }
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

/** @returns {Promise<{status:number, body?:Buffer, type?:string}>} */
export async function getImage(size, file) {
  if (!SIZES.has(size) || !FILE_RE.test(file)) return { status: 404 };
  const type = TYPES[file.split('.').pop().toLowerCase()];
  const dir = join(CACHE_DIR, 'img', size);
  const path = join(dir, file);
  if (existsSync(path)) return { status: 200, body: readFileSync(path), type };
  let res;
  try { res = await fetchWithTimeout(`${imgBase()}/${size}/${file}`, {}, 15000); } catch { return { status: 502 }; }
  if (res.status === 404) { res.body?.cancel?.().catch(() => {}); return { status: 404 }; }
  if (!res.ok) { res.body?.cancel?.().catch(() => {}); return { status: 502 }; }
  const body = await readCapped(res, MAX_IMG).catch(() => null);
  if (!body || !body.length) return { status: 502 };
  mkdirSync(dir, { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try { writeFileSync(tmp, body); renameSync(tmp, path); } catch { rmSync(tmp, { force: true }); }
  return { status: 200, body, type };
}
