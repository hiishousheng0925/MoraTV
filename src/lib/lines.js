/**
 * 片源 -> 可播线路（详情页 / 播放页共用）。
 * 一条候选 = 某站某条目的某条线路；缺省顺序：集数最全 → 测得延迟最低；用户手动选过的（line_pref）排第一。
 */

/**
 * @param {{siteId:number, siteName:string, latency:number|null, vodId:string, name:string, lines:{name:string, episodes:{name:string,url:string}[]}[]}[]} sources
 * @param {{siteId:number, line:string}|null} [pref]
 */
export function candidates(sources, pref) {
  const list = [];
  for (const s of sources || []) {
    for (const l of s.lines || []) {
      if (!l.episodes?.length) continue;
      list.push({ id: `${s.siteId}:${s.vodId}:${l.name}`, siteId: s.siteId, siteName: s.siteName, latency: s.latency ?? null,
        vodName: s.name, line: l.name, episodes: l.episodes });
    }
  }
  list.sort((a, b) => (b.episodes.length - a.episodes.length) || ((a.latency ?? 1e9) - (b.latency ?? 1e9)));
  if (pref) {
    const i = list.findIndex((c) => c.siteId === pref.siteId && c.line === pref.line);
    if (i > 0) list.unshift(list.splice(i, 1)[0]);
  }
  return list;
}

/** 「站点 · 线路」；资源站条目名和作品名不同（「繁花[沪语版]」）时带上条目名，区分同站的不同版本 */
export const candLabel = (c, workName = '') => `${c.siteName} · ${c.line}${c.vodName && c.vodName !== workName ? ` · ${c.vodName}` : ''}`;

/** 换线路时找同一集：先按集名，找不到按下标；都没有返回 -1 */
export function sameEp(eps, name, i) {
  const k = name ? eps.findIndex((e) => e.name === name) : -1;
  if (k >= 0) return k;
  return i >= 0 && i < eps.length ? i : -1;
}
