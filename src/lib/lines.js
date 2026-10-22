/**
 * 片源 -> 可播线路（详情页 / 播放页共用）。
 * 一条候选 = 某站某条目的某条线路；缺省顺序：降权的站（weight < 0，画面烧了广告）排最后 → 集数最全 → 测得延迟最低；
 * 用户手动选过的（line_pref，按内部线路名 vod_play_from 记）排第一。
 */

/**
 * @param {{siteId:number, siteName:string, latency:number|null, weight?:number, vodId:string, name:string, title?:string, lang?:string|null,
 *          lines:{name:string, lang?:string|null, episodes:{name:string,url:string}[]}[]}[]} sources
 * @param {{siteId:number, line:string}|null} [pref]
 */
export function candidates(sources, pref) {
  const list = [];
  for (const s of sources || []) {
    (s.lines || []).forEach((l, k) => {
      if (!l.episodes?.length) return;
      list.push({ id: `${s.siteId}:${s.vodId}:${l.name}`, siteId: s.siteId, siteName: s.siteName, latency: s.latency ?? null,
        low: (s.weight ?? 0) < 0, vodName: s.title || s.name, lang: l.lang || s.lang || null,
        vodId: String(s.vodId), lineIdx: k, line: l.name, episodes: l.episodes });
    });
  }
  // 线路 N：这个站给这部作品的第几条线路——按（条目 id，条目里的线路顺序）编号，不随片源排序 / 偏好变；
  // siteLines：这个站一共几条，只有一条时不显示「线路 N」
  const bySite = new Map();
  for (const c of list) {
    if (!bySite.has(c.siteId)) bySite.set(c.siteId, []);
    bySite.get(c.siteId).push(c);
  }
  for (const group of bySite.values()) {
    [...group].sort((a, b) => a.vodId.localeCompare(b.vodId, 'en', { numeric: true }) || (a.lineIdx - b.lineIdx))
      .forEach((c, n) => { c.lineNo = n + 1; c.siteLines = group.length; });
  }
  list.sort((a, b) => (a.low - b.low) || (b.episodes.length - a.episodes.length) || ((a.latency ?? 1e9) - (b.latency ?? 1e9)));
  if (pref) {
    const i = list.findIndex((c) => c.siteId === pref.siteId && c.line === pref.line);
    if (i > 0) list.unshift(list.splice(i, 1)[0]);
  }
  return list;
}

const nameKey = (s) => String(s || '').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();

/**
 * 片源行的显示：「站点」；这个站有两条以上线路时「站点 · 线路 N」。条目名（已去版本后缀）和作品名不同时带上，
 * 区分同站的不同条目；lang 是「国语 / 粤语」小标签。不显示 lzm3u8 / jsm3u8 这类线路代号。
 * @returns {{text: string, lang: string|null}}
 */
export function candParts(c, workName = '') {
  const parts = [c.siteName];
  if ((c.siteLines ?? 1) > 1) parts.push(`线路 ${c.lineNo}`);
  if (c.vodName && nameKey(c.vodName) !== nameKey(workName)) parts.push(c.vodName);
  return { text: parts.join(' · '), lang: c.lang || null };
}

/** 纯文本版（播放页线路菜单 / 当前线路 / toast）：「站点 · 线路 N · 国语」 */
export const candLabel = (c, workName = '') => {
  const p = candParts(c, workName);
  return p.lang ? `${p.text} · ${p.lang}` : p.text;
};

/** 换线路时找同一集：先按集名，找不到按下标；都没有返回 -1 */
export function sameEp(eps, name, i) {
  const k = name ? eps.findIndex((e) => e.name === name) : -1;
  if (k >= 0) return k;
  return i >= 0 && i < eps.length ? i : -1;
}
