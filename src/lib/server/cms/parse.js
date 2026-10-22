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

/**
 * 语言 / 配音版本词 -> 显示用标签（片源行的小标签）。顺序有意义：「国粤双语」先于「国语」「粤语」。
 * 只放语言类；「导演剪辑版 / 未删减版」是另一种区分，留在名字里。
 */
const LANG_WORDS = [
  ['国粤双语', '双语'], ['中英双语', '双语'], ['国英双语', '双语'], ['粤英双语', '双语'], ['国粤', '双语'], ['双语', '双语'],
  ['普通话', '国语'], ['国语', '国语'], ['國語', '国语'], ['国配', '国语'], ['台配', '国语'],
  ['粤语', '粤语'], ['粵語', '粤语'], ['粤配', '粤语'],
  ['原声', '原声'], ['原聲', '原声'], ['沪语', '沪语'], ['闽南语', '闽南语'],
];
const LANG_ALT = LANG_WORDS.map(([w]) => w).join('|');
const LANG_TAG = Object.fromEntries(LANG_WORDS);
// 末尾的「[沪语版]」「（国语）」
const LANG_BRACKET = new RegExp(`[\\[(（【]\\s*(${LANG_ALT})\\s*版?\\s*[\\])）】]$`);
// 末尾的「普通话版」「粤语」「国语刘德华版」（语言词后面最多 4 个字的版本说明，必须以「版」结尾）
const LANG_TAIL = new RegExp(`(${LANG_ALT})(?:[\\u4e00-\\u9fff]{1,4}版|版)?$`);
// 首尾的分隔符；半角句点不算（「V.I.P.」）
const EDGE_PUNCT = /^[\s\-—–_·・,，。:：;；|/、]+|[\s\-—–_·・,，。:：;；|/、]+$/g;
const EMPTY_BRACKETS = /[\[(（【]\s*[\])）】]/g;

/**
 * 资源站条目名 -> 显示名 + 语言标签：去掉 `$` 及其后的串、末尾的语言版本后缀（作为 lang 另给）、首尾空白和多余标点。
 * 只用于显示：匹配仍用原名（normTitle 自己会剥版本后缀）。整串就是语言词时不剥。
 * @param {string} raw @returns {{title: string, lang: string|null}}
 */
export function cleanName(raw) {
  let s = String(raw ?? '');
  // 取 `$` 前面的那段；以 `$` 开头时取第一段非空的
  if (s.includes('$')) s = s.split('$').find((x) => x.trim()) ?? '';
  s = s.replace(EMPTY_BRACKETS, '').replace(/\s+/g, ' ').replace(EDGE_PUNCT, '');
  let lang = null;
  for (const re of [LANG_BRACKET, LANG_TAIL]) {
    const m = s.match(re);
    if (!m) continue;
    const head = s.slice(0, m.index).replace(EDGE_PUNCT, '');
    if (!head) continue;
    lang = LANG_TAG[m[1]];
    s = head;
    break;
  }
  return { title: s, lang };
}

/** 线路名 / 任意串里出现的语言词（「粤语m3u8」-> 粤语）；没有返回 null */
export function langOf(s) {
  const t = String(s ?? '');
  const w = LANG_WORDS.find(([k]) => t.includes(k));
  return w ? w[1] : null;
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
    time: String(raw.vod_time ?? '').trim(), // 资源站的更新时间「YYYY-MM-DD HH:mm:ss」，只用来排「最近更新」
    lines: parsePlay(raw.vod_play_from, raw.vod_play_url),
  };
}
