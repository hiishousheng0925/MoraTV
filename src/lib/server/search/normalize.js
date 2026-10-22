/**
 * 片名规范化（设计文档 §6.1）：用于把各资源站 / TMDB 的同一部作品聚到一起。
 * normTitle：繁转简、去括号注记、去「第X季 / 第X部 / SX / Season X / 空格分隔的年份 / 国语版 / 粤语版」、去空格标点、小写。
 * seasonOf：从片名里读季号（「第二季」→2、「庆余年2」→2）；读不出返回 null（调用方按第 1 季处理）。
 */
import * as OpenCC from 'opencc-js';

const t2s = OpenCC.Converter({ from: 'hk', to: 'cn' });

export const toSimplified = (s) => t2s(String(s ?? ''));

const CN_DIGIT = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 「十二」「二十」「12」→ 数字；解析不了返回 null */
function parseNum(s) {
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  if (!/^[零〇一二两三四五六七八九十]+$/.test(s)) return null;
  const i = s.indexOf('十');
  if (i < 0) return s.length === 1 ? CN_DIGIT[s] : null;
  const tens = i === 0 ? 1 : CN_DIGIT[s.slice(0, i)];
  const ones = i === s.length - 1 ? 0 : CN_DIGIT[s.slice(i + 1)];
  return tens == null || ones == null ? null : tens * 10 + ones;
}

const BRACKETS = /[(（[【《<〈][^)）\]】》>〉]*[)）\]】》>〉]/g;
const VERSION = /(?:国粤双语|国粤|国语|粤语|普通话|台配|原声|双语|中字|日语|韩语|英语)版?$|(?:特别|未删减|无删减|完整|加长|精编|导演剪辑)版$/;
const SEASON_EN = /(^|[^a-z])s(?:eason)?\s*(\d{1,2})$/; // 作用在保留空格的小写串上（「mars2」不算）
const YEAR_TAIL = /\s+(?:19|20)\d\d$/;
const PUNCT = /[^\p{L}\p{N}]+/gu;
const CJK = /[㐀-鿿]/;
const NUM_TAIL = /^(.*?)(\d{1,2})$/;

/** 去掉括号注记；整串都在括号里时保留括号里的内容 */
function stripBrackets(s) {
  const r = s.replace(BRACKETS, ' ').trim();
  return r || s.replace(/[(（[【《<〈)）\]】》>〉]/g, ' ').trim();
}

/**
 * 逐步剥掉末尾的「版本 / 季 / 年份」注记，返回 { base, season }。
 * base 仍带空格（调用方再去标点），season 为读到的季号或 null。
 */
function peel(input) {
  let s = stripBrackets(toSimplified(normRoman(input)).toLowerCase()).replace(PUNCT, ' ').trim();
  let season = null;
  for (let guard = 0; guard < 6; guard++) {
    const before = s;
    const compact = s.replace(/\s+/g, '');
    let m;
    if (VERSION.test(compact)) {
      s = s.replace(/\s*(?:(?:国粤双语|国粤|国语|粤语|普通话|台配|原声|双语|中字|日语|韩语|英语)\s*版?|(?:特别|未删减|无删减|完整|加长|精编|导演剪辑)\s*版)\s*$/, '').trim();
    } else if ((m = s.match(/第\s*([零〇一二两三四五六七八九十\d]+)\s*[季部]$/)) && parseNum(m[1]) != null) {
      season ??= parseNum(m[1]);
      s = s.slice(0, m.index).trim();
    } else if ((m = s.match(SEASON_EN))) {
      season ??= parseInt(m[2], 10);
      s = s.slice(0, m.index + m[1].length).trim();
    } else if (YEAR_TAIL.test(s)) {
      s = s.replace(YEAR_TAIL, '').trim();
    }
    if (s === before || !s) { if (!s) s = before; break; }
  }
  // 「庆余年2」：中文后面紧跟 1–2 位数字视为季号（「请回答1988」「2046」不算）
  const compact = s.replace(PUNCT, '');
  const m = compact.match(NUM_TAIL);
  if (m && m[1] && CJK.test(m[1].slice(-1))) {
    const n = parseInt(m[2], 10);
    if (n >= 1 && n <= 30) return { base: m[1], season: season ?? n };
  }
  return { base: compact, season };
}

const LATIN_ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };

/**
 * 罗马数字 -> 阿拉伯数字：Ⅰ–Ⅻ / ⅰ–ⅻ 一律转；拉丁字母写的 II / III / IV…只在中文片名里、紧跟汉字（可隔空格）且后面是结尾 / 空白 / 标点 / 数字时转（「我的I人」不动）
 * （「無間道III: 終極無間」→「無間道3: 終極無間」；「Rocky II」「VIP」不动）。
 * @param {string} s
 */
export function normRoman(s) {
  let t = String(s ?? '').replace(/[Ⅰ-Ⅻⅰ-ⅻ]/g, (c) => String(((c.charCodeAt(0) - 0x2160) % 16) + 1));
  if (CJK.test(t)) t = t.replace(/(?<=[㐀-鿿]\s*)(VIII|VII|VI|IV|IX|III|II|X|V|I)(?=$|[\s\p{P}\d])/gu, (m) => String(LATIN_ROMAN[m]));
  return t;
}

const PART_NUM = /^(.*?\D)\s*(?:第\s*([零〇一二两三四五六七八九十\d]+)\s*[部季]|(\d{1,2}))$/;
const PART_SEP = /^(.+?)\s*(?:[:：\-—–·|]|(?<=[㐀-鿿\d])之)\s*(.+)$/;

/**
 * 「片名N：副标题」「片名 第N部：副标题」「片名之副标题」「HIStory3-圈套」-> { base: 片名, part: N|null }；没有副标题返回 null。
 * base 已转简体、罗马数字已转；只给剧集匹配用（电影的「无间道3：终极无间」是独立作品，不能拆）。
 * @param {string} s
 */
export function stripPartSubtitle(s) {
  const t = normRoman(toSimplified(String(s ?? ''))).trim();
  const m = t.match(PART_SEP);
  if (!m) return null;
  let head = m[1].trim();
  let part = null;
  const n = head.match(PART_NUM);
  if (n) {
    const v = n[2] != null ? parseNum(n[2]) : parseInt(n[3], 10);
    if (v != null && v >= 1 && v <= 30) { head = n[1].trim(); part = v; }
  }
  if (head.replace(PUNCT, '').length < 2) return null;
  return { base: head, part };
}

/** 只去空白和标点、保留数字的片名键（区分「流浪地球」和「流浪地球2」） */
export const rawKey = (s) => String(s || '').replace(/[\s\p{P}]/gu, '').toLowerCase();

/** @param {string} s */
export function normTitle(s) {
  if (!String(s ?? '').trim()) return '';
  return peel(s).base;
}

/** @param {string} s @returns {number|null} */
export function seasonOf(s) {
  if (!String(s ?? '').trim()) return null;
  return peel(s).season;
}

const AREA = [
  ['hk', /香港|港/],
  ['tw', /台湾|台/],
  ['cn', /大陆|内地|中国|国产/],
  ['kr', /韩/],
  ['jp', /日本/],
  ['th', /泰/],
  ['west', /美国|英国|欧美|法国|德国|加拿大|澳大利亚|意大利|西班牙|欧洲/],
];

/** 资源站 vod_area -> 地区码；空 / 认不出返回 null */
export function regionOfArea(area) {
  const a = toSimplified(area).trim();
  if (!a) return null;
  return AREA.find(([, re]) => re.test(a))?.[0] ?? null;
}

/** 资源站 vod_area 里出现的全部地区码（「中国大陆 / 美国」-> [cn, west]；「中国香港」不算大陆）；空 / 认不出返回 [] */
export function regionsOfArea(area) {
  const a = toSimplified(area).replace(/中国(?=香港|台湾|澳门)/g, '').trim();
  if (!a) return [];
  return AREA.filter(([, re]) => re.test(a)).map(([r]) => r);
}

const COUNTRY = { CN: 'cn', HK: 'hk', TW: 'tw', MO: 'hk', KR: 'kr', JP: 'jp', TH: 'th' };
const WEST = new Set(['US', 'GB', 'CA', 'AU', 'NZ', 'IE', 'FR', 'DE', 'IT', 'ES', 'NL', 'BE', 'SE', 'NO', 'DK', 'FI', 'PL', 'AT', 'CH', 'PT']);

/** TMDB origin_country（ISO）-> 地区码 */
export function regionOfCountry(c) {
  if (!c) return null;
  const k = String(c).toUpperCase();
  return COUNTRY[k] || (WEST.has(k) ? 'west' : 'other');
}
