/**
 * 浏览页的数据：
 *   有 TMDB key：discover（形态 × 地区 × 题材 / TVB × 排序 × 年代）+ 各题材在当前形态 × 地区下有没有内容（genreCounts）。
 *   没 key：资源站分类（形态 × 地区，按资源站 type_name 映射到各站自己的 type_id）。
 * 动画 / 擦边的排除规则不在这里另写：TMDB 走 tmdb.js 的 EXCLUDE_GENRES / recommendable，资源站走 categories.js 的 drop。
 */
import * as tmdb from './tmdb.js';
import { cached } from './cache.js';
import { pLimit } from './net.js';
import { listSites, recordResult } from './cms/sites.js';
import { cmsGet, toVods, listCategories } from './cms/client.js';
import { mapCategory } from './cms/categories.js';
import { cleanName } from './cms/parse.js';
import { byHealth } from './cms/latest.js';
import { regionOfArea, regionOfCountry } from './search/normalize.js';
import { genresFor, genreParams, networkFor, decadeRange, isSort, isDecade } from '../genres.js';

const DAY = 86400;
/** 形态 -> TMDB discover 的 type / kind */
export const KINDS = {
  tv: { type: 'tv', kind: 'tv' },
  movie: { type: 'movie', kind: 'movie' },
  variety: { type: 'tv', kind: 'variety' },
  doc: { type: 'tv', kind: 'doc' },
};
export const REGIONS = ['cn', 'hk', 'tw', 'kr', 'jp', 'th', 'west'];
/** 有题材筛选的形态（综艺 / 纪录片本身就是 genre 过滤，不叠题材） */
export const hasGenres = (kind) => kind === 'tv' || kind === 'movie';

const DEFAULT_DEPS = {
  discover: tmdb.discover, discoverCount: tmdb.discoverCount,
  listSites, recordResult, cmsGet, listCategories,
};
let deps = DEFAULT_DEPS;
/** 测试钩子：注入假的 discover / discoverCount / listSites / cmsGet / listCategories / recordResult；传 null 恢复。 */
export function _setDeps(d) { deps = d ? { ...DEFAULT_DEPS, ...d } : DEFAULT_DEPS; }

/** URL 查询 -> 规范化后的筛选（不认识的值丢掉） */
export function parseQuery(sp) {
  const kind = KINDS[sp.get('kind')] ? sp.get('kind') : 'tv';
  const region = REGIONS.includes(sp.get('region')) ? sp.get('region') : '';
  const type = KINDS[kind].type;
  const g = hasGenres(kind) && genreParams(sp.get('g') || '', type, region) ? sp.get('g') : '';
  const net = networkFor(sp.get('net') || '', kind, region) ? sp.get('net') : '';
  const sort = isSort(sp.get('sort')) ? sp.get('sort') : '';
  const dec = isDecade(sp.get('dec')) ? sp.get('dec') : '';
  const page = Math.min(500, Math.max(1, Math.floor(Number(sp.get('p'))) || 1));
  const src = /^\d+$/.test(sp.get('src') || '') ? Number(sp.get('src')) : null;
  return { kind, region, g, net, sort, dec, page, src };
}

/** 题材 + 电视台 -> discover 的 filter */
function filterOf(type, region, g, net) {
  const f = { ...(g ? genreParams(g, type, region) : {}) };
  const n = net ? networkFor(net, type === 'tv' ? 'tv' : 'movie', region) : null;
  if (n) f.with_networks = n.with_networks;
  return f;
}

/** TMDB 条目 -> 卡片字段（可用性由页面懒查） */
const slim = (kind) => (t) => ({
  key: `${t.type}-${t.id}`, name: t.name, poster: t.poster, year: t.year, region: regionOfCountry(t.region),
  kind: kind === 'variety' || kind === 'doc' ? kind : t.type, available: null,
});

/** 有 key：一页结果 { items, totalPages } */
export async function browseTmdb({ kind, region, g, net, sort, dec, page }) {
  const k = KINDS[kind];
  const list = await deps.discover(k.type, {
    region: region || undefined, kind: k.kind, page, sort,
    filter: hasGenres(kind) ? filterOf(k.type, region, g, net) : undefined, range: decadeRange(dec),
  });
  return { items: list.map(slim(kind)), totalPages: list.totalPages ?? (list.length >= 20 ? page + 1 : page) };
}

const COUNT_CONCURRENCY = 4;
const countLimit = pLimit(COUNT_CONCURRENCY); // 全局：来回切地区也不会一下子打出几十个请求

/**
 * 当前形态 × 地区（× TVB）下有内容的题材：[{id, label}]，按 genres.js 的顺序。
 * 每个题材一次 discover 计数（total_results；选了年代就按年代计，不看排序），整组缓存 2 天；有计数失败的那组只缓存 10 分钟（失败的当作有内容先显示）。
 */
export function genreCounts({ kind, region, net, dec = '' }) {
  if (!hasGenres(kind)) return Promise.resolve([]);
  const k = KINDS[kind];
  const key = `browse:genres:v1:${kind}:${region || 'all'}:${net || '-'}${dec ? ':' + dec : ''}`;
  return cached(key, 2 * DAY, async () => {
    let failed = 0;
    const list = await Promise.all(genresFor(k.type, region).map((gn) => countLimit(async () => {
      try {
        const n = await deps.discoverCount(k.type, { region: region || undefined, kind: k.kind, filter: filterOf(k.type, region, gn.id, net), range: decadeRange(dec) });
        return { id: gn.id, label: gn.label, n };
      } catch (e) {
        failed++;
        return { id: gn.id, label: gn.label, n: null };
      }
    })));
    if (failed === list.length) throw new Error('题材计数全部失败');
    return { partial: failed > 0, list: list.filter((x) => x.n !== 0).map(({ id, label }) => ({ id, label })) };
  }, (v) => (v.partial ? 600 : 2 * DAY)).then((v) => v.list);
}

/* ---------------- 没 key：资源站分类 ---------------- */

const MAX_TRIES = 4;
const SITE_PAGE = 20;   // 资源站一页的条数（苹果 CMS 缺省；pagesize 有的站不认，不传）
const PER_PAGE = 48;    // 多个类目合成一页时，一页最多约这么多张
const FETCH_CONCURRENCY = 4;
const TTL_PAGE = 30 * 60;

/** 站点分类树（1 天）。失败返回 null（不缓存）。 */
const categoriesOf = (site) => cached(`cms:cats:v2:${site.api}`, DAY, async () => {
  const c = await deps.listCategories(site);
  return c.length ? c : null;
});

/** 资源站条目在浏览里属于哪个地区：类目带地区就用类目的，否则看 vod_area */
const regionOfVod = (v) => (v.category.region && v.category.region !== 'other' ? v.category.region : regionOfArea(v.area));

/** 「电影」「连续剧」这类大类：苹果 CMS 的 t= 只认本类目、不含子类目，按大类取是空的 */
const GENERIC = /^(电影片?|电视剧|连续剧|剧集|综艺片?|动漫片?)$/;

/**
 * 这个站上「形态 × 地区」要取哪些类目：
 *   有地区且有正好对上的类目 → 只取它（[id]，localRegion false）；
 *   「全部」地区 → 这个形态的全部末级类目，每个类目各出几条合成一页；
 *   有地区但没有对应类目（按地区看电影、港台综艺）→ 这个形态里地区不明的末级类目，取回来按 vod_area 本地筛（localRegion true）。
 * 丢弃 / 短剧类目本来就不会映射成这几个形态。
 * @param {{id: number, name: string, pid?: number|null}[]} cats
 */
export function pickCategories(cats, kind, region) {
  const parents = new Set(cats.map((c) => c.pid).filter((p) => p));
  const ofKind = cats.filter((c) => mapCategory(c.name).kind === kind);
  const leaf = ofKind.filter((c) => !parents.has(c.id) && !(GENERIC.test(c.name) && ofKind.length > 1));
  if (!region) return { ids: leaf.map((c) => c.id), localRegion: false };
  const exact = leaf.find((c) => mapCategory(c.name).region === region);
  if (exact) return { ids: [exact.id], localRegion: false };
  const vague = leaf.filter((c) => { const r = mapCategory(c.name).region; return r == null || r === 'other'; });
  return { ids: vague.map((c) => c.id), localRegion: true };
}

/** 每个类目一页出几条：20 的约数（一页里的条目正好落在资源站同一页里），合起来不超过 PER_PAGE；要本地按地区筛的取整页 */
export const perCategory = (k, localRegion) => (localRegion || k <= 1 ? SITE_PAGE : [10, 5, 4, 2, 1].find((d) => d * k <= PER_PAGE) || 1);

// 显示名去掉版本后缀 / `$` 串（缓存里存的是资源站原始列表，名字每次现洗，不用改缓存键）
const toItem = (v) => ({
  key: `cms-${v.siteId}-${v.vodId}`, name: cleanName(v.name).title || v.name, poster: v.pic || null, year: v.year,
  region: regionOfVod(v), kind: v.category.kind, sub: (v.remarks || '').slice(0, 14), available: true,
});

/** 某类目的一页（30 分钟缓存；失败抛错，不缓存） */
const catPage = (site, t, pg) => cached(`cms:browse:v1:${site.api}:${t}:${pg}`, TTL_PAGE, async () => {
  const j = await deps.cmsGet(site, { ac: 'videolist', t, pg });
  if (!j) throw new Error('no answer');
  return { list: Array.isArray(j.list) ? j.list : [], total: Number(j.total) || 0, pagecount: Number(j.pagecount) || 1 };
});

/** 一个站的一页；站点没回应返回 null */
async function sitePage(site, { kind, region, page }) {
  const t0 = Date.now();
  const cats = await categoriesOf(site).catch(() => null);
  if (!cats) { deps.recordResult(site.id, false, Date.now() - t0); return null; }
  const { ids, localRegion } = pickCategories(cats, kind, region);
  if (!ids.length) return { items: [], totalPages: 0, site: site.id };
  const n = perCategory(ids.length, localRegion);
  const start = (page - 1) * n;              // 在每个类目里的起始序号
  const pg = Math.floor(start / SITE_PAGE) + 1;
  const off = start - (pg - 1) * SITE_PAGE;
  const limit = pLimit(FETCH_CONCURRENCY);
  const res = await Promise.all(ids.map((t) => limit(() => catPage(site, t, pg).catch(() => null))));
  if (!res.some(Boolean)) { deps.recordResult(site.id, false, Date.now() - t0); return null; }
  deps.recordResult(site.id, true, Date.now() - t0);
  const bad = res.filter((j) => !j).length;
  if (bad) console.warn(`[browse] 站点 ${site.id} 有 ${bad}/${ids.length} 个类目没回应，这一页会少一些`);
  const seen = new Set();
  const items = res.flatMap((j) => (j ? toVods({ list: j.list.slice(off, off + n) }, site.id) : []))
    .filter((v) => v.category.kind === kind && v.lines.length && (!localRegion || regionOfVod(v) === region))
    .sort((a, b) => (b.time || '').localeCompare(a.time || ''))
    .filter((v) => !seen.has(v.vodId) && seen.add(v.vodId))
    .map(toItem);
  const totalPages = Math.max(0, ...res.map((j) => (j ? Math.ceil((j.total || j.pagecount * SITE_PAGE) / n) : 0)));
  return { items, totalPages, site: site.id };
}

/**
 * 没 key：{ items, totalPages, site }。src = 上一页用的站（翻页时固定同一个站，各站类目和顺序不一样）；
 * 它没回应就按健康度换下一个。所有站都没回应抛错（带 noSiteAnswered）。
 */
export async function browseSites({ kind, region, page, src }) {
  if (!KINDS[kind]) throw new Error('bad kind');
  const all = byHealth(deps.listSites({ enabledOnly: true }));
  const pinned = all.find((s) => s.id === src);
  const cands = [...(pinned ? [pinned] : []), ...all.filter((s) => s !== pinned)].slice(0, MAX_TRIES);
  for (const s of cands) {
    const r = await sitePage(s, { kind, region, page }).catch(() => null);
    if (r) return r;
  }
  throw Object.assign(new Error('资源站都没有回应'), { noSiteAnswered: true });
}
