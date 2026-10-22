/** 苹果 CMS v10 的 vod 记录 -> 客户端的 Vod。只保留 m3u8 线路（设计文档 §5.1）。 */
import { mapCategory } from './categories.js';

const M3U8_URL = /\.m3u8(?:[?#].*)?$/i;

/**
 * @param {string} from  vod_play_from（线路名，$$$ 分隔）
 * @param {string} url   vod_play_url（线路间 $$$，集间 #，每集 集名$URL）
 * @returns {{name: string, episodes: {name: string, url: string}[]}[]}
 */
export function parsePlay(from, url) {
  const names = String(from ?? '').split('$$$');
  const groups = String(url ?? '').split('$$$');
  const lines = [];
  groups.forEach((g, i) => {
    const lineName = (names[i] ?? '').trim();
    const eps = [];
    for (const raw of g.split('#')) {
      const s = raw.trim();
      if (!s) continue;
      const k = s.indexOf('$');
      const name = k >= 0 ? s.slice(0, k).trim() : '';
      const u = (k >= 0 ? s.slice(k + 1) : s).trim();
      if (!/^https?:\/\//i.test(u)) continue;
      eps.push({ name: name || `第${eps.length + 1}集`, url: u });
    }
    if (!eps.length) return;
    // 线路名含 m3u8，或该线路的地址都是 .m3u8
    if (/m3u8/i.test(lineName) || eps.every((e) => M3U8_URL.test(e.url))) {
      lines.push({ name: lineName || `线路${lines.length + 1}`, episodes: eps });
    }
  });
  return lines;
}

const clean = (s) => String(s ?? '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

/** @param {any} raw @param {number} siteId */
export function normalizeVod(raw, siteId) {
  const y = parseInt(String(raw.vod_year ?? ''), 10);
  const typeName = String(raw.type_name ?? '').trim();
  return {
    siteId,
    vodId: String(raw.vod_id),
    name: String(raw.vod_name ?? '').trim(),
    year: y >= 1900 && y <= 2100 ? y : null,
    area: String(raw.vod_area ?? '').trim(),
    typeName,
    category: mapCategory(typeName),
    pic: String(raw.vod_pic ?? '').trim(),
    actors: String(raw.vod_actor ?? '').split(/[,，、/\s]+/).map((s) => s.trim()).filter(Boolean),
    director: String(raw.vod_director ?? '').trim(),
    overview: clean(raw.vod_content ?? raw.vod_blurb),
    remarks: String(raw.vod_remarks ?? '').trim(),
    lines: parsePlay(raw.vod_play_from, raw.vod_play_url),
  };
}
