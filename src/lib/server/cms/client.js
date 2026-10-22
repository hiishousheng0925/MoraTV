/** 苹果 CMS v10 JSON 接口客户端。任何失败（网络 / 超时 / HTML / code 非 1）都返回空，不抛。 */
import { fetchWithTimeout, readTextCapped } from '../net.js';
import { normalizeVod } from './parse.js';

/**
 * 请求并解析，返回 JSON 对象或 null（失败）。
 * @param {{api: string}} site @param {Record<string, string|number>} params
 */
export async function cmsGet(site, params, timeoutMs = 8000) {
  try {
    const u = new URL(site.api);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
    const res = await fetchWithTimeout(u.href, { headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 MoraTV' } }, timeoutMs);
    if (!res.ok) return null;
    const j = JSON.parse(await readTextCapped(res));
    // 苹果 CMS 成功时 code 为 1（个别站用 200）
    if (!j || (j.code !== 1 && j.code !== 200)) return null;
    return j;
  } catch {
    return null;
  }
}

/** 把接口返回的 list 规范化成 Vod[] */
export function toVods(j, siteId) {
  if (!j || !Array.isArray(j.list)) return [];
  return j.list.map((r) => normalizeVod(r, siteId)).filter((v) => v.name);
}

/** 只取第 1 页。 */
export async function searchSite(site, keyword, { timeoutMs = 8000 } = {}) {
  return toVods(await cmsGet(site, { ac: 'videolist', wd: keyword, pg: 1 }, timeoutMs), site.id);
}

/** @param {(string|number)[]} ids */
export async function detailSite(site, ids, { timeoutMs = 8000 } = {}) {
  if (!ids.length) return [];
  const j = await cmsGet(site, { ac: 'videolist', ids: ids.join(',') }, timeoutMs);
  if (!j || !Array.isArray(j.list)) return [];
  return j.list.map((r) => normalizeVod(r, site.id)).filter((v) => v.name);
}

/** 分类树：[{id, name}] */
export async function listCategories(site, { timeoutMs = 8000 } = {}) {
  const j = await cmsGet(site, { ac: 'list' }, timeoutMs);
  if (!j || !Array.isArray(j.class)) return [];
  return j.class.map((c) => ({ id: Number(c.type_id), name: String(c.type_name) }));
}
