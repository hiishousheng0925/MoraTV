/**
 * 作品的展示用小工具（前后端都能用，不碰服务端模块）。
 */
export const REGION_CN = { cn: '内地', hk: '香港', tw: '台湾', kr: '韩国', jp: '日本', th: '泰国', west: '欧美', other: '其他' };
export const KIND_CN = { tv: '剧集', movie: '电影', variety: '综艺', doc: '纪录片', short: '短剧' };

/**
 * 海报地址：TMDB 的 poster_path（以 / 开头）走本地图片代理；资源站给的完整 http(s) 地址原样用。
 * @param {string|null|undefined} p @param {string} [size]
 */
export function posterUrl(p, size = 'w342') {
  if (!p) return null;
  const s = String(p);
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('/')) return `/img/${size}${s}`;
  return null;
}

export const titleHref = (key) => `/title/${encodeURIComponent(key)}`;

/** Work / 列表条目 -> PosterCard 的 item。available === false 变灰加角标；null（还没查）照常显示 */
export function toCard(w, extra = {}) {
  return {
    key: w.key,
    title: w.name ?? w.title ?? '',
    poster: posterUrl(w.poster),
    year: w.year ?? null,
    region: REGION_CN[w.region] ?? null,
    kind: KIND_CN[w.kind] ?? null,
    badge: w.available === false ? '暂无片源' : null,
    gray: w.available === false,
    ...extra,
  };
}

/** 秒 -> 「m:ss」/「h:mm:ss」 */
export const clock = (s) => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(x).padStart(2, '0')}`;
};

/** 集的显示名：电影 / 单集不写；资源站的「第01集」原样，其余「第 N 集」 */
export function epText(type, episode, epName) {
  if (type === 'movie') return '';
  if (epName && /第.+[集期话]/.test(epName)) return epName;
  return `第 ${episode} 集`;
}
