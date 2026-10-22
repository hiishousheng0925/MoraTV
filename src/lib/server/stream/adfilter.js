/**
 * 媒体 playlist 去广告（设计文档 §6.4，按 LibreTV 的思路自写，没有用它的代码）。
 *
 * 资源站把广告当作独立的一段拼进 m3u8，前后用 #EXT-X-DISCONTINUITY 隔开。按 DISCONTINUITY 切组，
 * 判断哪一组是广告，删组时连同【该组前面的】DISCONTINUITY 一起删（只删标记不删分片会让时间戳跳），其余结构不动。
 *
 *   规则 A：第一组 ≤ 90 秒、≤ 20 片，且分片的路径前缀或帧率网格与主体不同 -> 片头广告
 *   规则 B：任意组里有分片 URL 命中 adjump / advert / ads 目录 -> 广告
 *   规则 C：中间某组（不含首尾）≤ 60 秒，且路径前缀或帧率网格与主体不同 -> 中插广告
 *
 * 「帧率网格」：每片时长 ≈ 整数帧 / 帧率。正片是 24fps 时长都是 1/24 秒的整数倍（4.166667、3.541667…），
 * 插进来的广告常是另一个帧率转出来的（30fps 的 4.866667、25fps 的 1.76）。整数秒（4.0）落在所有网格上，不参与判断；
 * 正片时长不落在任何网格上（可变帧率）时这一特征自动关闭。一组里「只落在别的网格上」的片不少于「落在主体网格上」的片才算不同。
 * 实测（2026-10-22，10 部 × 3 站 29 条 playlist）：规则 C 只看前缀只能抓到量子站一种；加上帧率网格后
 * 非凡 / 电影天堂的中插也能抓到，误删 0。抓不到的：广告和正片同帧率、同目录（例如 25fps 正片里的 25fps 广告）。
 * 安全阀：永远不会把所有组删光。
 */

const AD_URL = /adjump|advert|\/ads?\//i;
const INTRO_MAX_SEC = 90;
const INTRO_MAX_SEGS = 20;
const MID_MAX_SEC = 60;
const GRIDS = [24, 25, 30, 24000 / 1001, 30000 / 1001];
const BASIC = [0, 1, 2]; // 24 / 25 / 30：同时落在这三个网格上的时长（整数秒等）没有区分度
const BASE = 'https://base.invalid/__p__/';

/** 时长落在哪些帧率网格上（下标进 GRIDS） */
function gridsOf(d) {
  const out = [];
  if (!(d > 0)) return out;
  GRIDS.forEach((fps, i) => { const x = d * fps; if (Math.abs(x - Math.round(x)) <= 0.02) out.push(i); });
  return out;
}
const informative = (g) => g.length > 0 && !BASIC.every((i) => g.includes(i));

function prefixOf(uri) {
  try { const u = new URL(uri, BASE); return u.origin + u.pathname.slice(0, u.pathname.lastIndexOf('/') + 1); } catch { return uri; }
}

function majority(arr) {
  const m = new Map();
  for (const x of arr) m.set(x, (m.get(x) || 0) + 1);
  let best = null, n = -1;
  for (const [k, v] of m) if (v > n) { best = k; n = v; }
  return best;
}

/** 切成 header / groups / footer。group = { disc: 行|null, lines: 行[], segs: {dur, uri}[] } */
function parse(text) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.split(/\r?\n/);
  const header = [];
  const groups = [];
  let cur = null;
  let dur = 0;
  for (const line of lines) {
    const t = line.trim();
    const isDisc = t === '#EXT-X-DISCONTINUITY';
    const isUri = t && !t.startsWith('#');
    if (!cur) {
      if (!isDisc && !isUri && !t.startsWith('#EXTINF')) { header.push(line); continue; }
      cur = { disc: null, lines: [], segs: [] };
      groups.push(cur);
    }
    if (isDisc) {
      if (cur.segs.length || cur.lines.length) { cur = { disc: line, lines: [], segs: [] }; groups.push(cur); } else cur.disc = line;
      continue;
    }
    if (t.startsWith('#EXTINF:')) dur = parseFloat(t.slice(8)) || 0;
    cur.lines.push(line);
    if (isUri) { cur.segs.push({ dur, uri: t }); dur = 0; }
  }
  // 最后一个分片之后的行（#EXT-X-ENDLIST、空行）归 footer
  const footer = [];
  const last = groups.at(-1);
  if (last) {
    let i = last.lines.length;
    while (i > 0 && (!last.lines[i - 1].trim() || last.lines[i - 1].trim().startsWith('#'))) i--;
    footer.push(...last.lines.splice(i));
  }
  return { eol, header, groups, footer };
}

/**
 * @param {string} playlistText
 * @param {{ ruleC?: 'grid'|'prefix'|false }} [opts]  ruleC 只给实测对比用；缺省 'grid'（前缀或帧率网格不同都算）
 * @returns {{ text: string, removed: { groups: number, seconds: number } }}
 */
export function filterAds(playlistText, opts = {}) {
  const text = String(playlistText ?? '');
  const none = { text, removed: { groups: 0, seconds: 0 } };
  if (/#EXT-X-STREAM-INF/i.test(text)) return none; // master playlist
  const { eol, header, groups, footer } = parse(text);
  const real = groups.filter((g) => g.segs.length);
  if (real.length < 2) return none;
  const ruleC = opts.ruleC ?? 'grid';

  // 主体特征：分片数最多的路径前缀；有区分度的分片里占 ≥ 80% 的帧率网格
  const all = real.flatMap((g) => g.segs);
  const mainPrefix = majority(all.map((s) => prefixOf(s.uri)));
  const info = all.map((s) => gridsOf(s.dur)).filter(informative);
  let mainGrid = -1;
  if (info.length >= 10) {
    const counts = GRIDS.map((_, i) => info.filter((g) => g.includes(i)).length);
    const best = counts.indexOf(Math.max(...counts));
    if (counts[best] / info.length >= 0.8) mainGrid = best;
  }

  const sec = (g) => g.segs.reduce((a, s) => a + s.dur, 0);
  const prefixDiff = (g) => majority(g.segs.map((s) => prefixOf(s.uri))) !== mainPrefix;
  const gridDiff = (g) => {
    if (mainGrid < 0) return false;
    const gi = g.segs.map((s) => gridsOf(s.dur)).filter(informative);
    // 落在主体网格上的片 vs 只落在别的网格上的片；后者严格多于前者才算「时长特征不同」（平局不删，避免误删 1-of-1 / 1-of-2 的短正片组）
    const off = gi.filter((x) => !x.includes(mainGrid)).length;
    return off > 0 && off > gi.length - off;
  };

  const drop = new Set();
  real.forEach((g, i) => {
    if (g.segs.some((s) => AD_URL.test(s.uri))) { drop.add(g); return; } // B
    const d = sec(g);
    if (i === 0) { // A
      if (d <= INTRO_MAX_SEC && g.segs.length <= INTRO_MAX_SEGS && (prefixDiff(g) || gridDiff(g))) drop.add(g);
      return;
    }
    if (ruleC && i < real.length - 1 && d <= MID_MAX_SEC) { // C
      if (prefixDiff(g) || (ruleC === 'grid' && gridDiff(g))) drop.add(g);
    }
  });
  if (!drop.size || drop.size >= real.length) return none;

  const out = [...header];
  let carry = { key: null, map: null };
  let emitted = false;
  for (const g of groups) {
    if (drop.has(g)) {
      for (const l of g.lines) {
        if (/^#EXT-X-KEY/i.test(l.trim())) carry.key = l;
        else if (/^#EXT-X-MAP/i.test(l.trim())) carry.map = l;
      }
      continue;
    }
    if (g.disc && (emitted || groups.indexOf(g) === 0)) out.push(g.disc);
    const firstUri = g.lines.findIndex((l) => l.trim() && !l.trim().startsWith('#'));
    const before = firstUri < 0 ? g.lines : g.lines.slice(0, firstUri);
    if (carry.key && !before.some((l) => /^#EXT-X-KEY/i.test(l.trim()))) out.push(carry.key);
    if (carry.map && !before.some((l) => /^#EXT-X-MAP/i.test(l.trim()))) out.push(carry.map);
    carry = { key: null, map: null };
    out.push(...g.lines);
    if (g.segs.length) emitted = true;
  }
  out.push(...footer);
  const seconds = Math.round([...drop].reduce((a, g) => a + sec(g), 0) * 10) / 10;
  return { text: out.join(eol), removed: { groups: drop.size, seconds } };
}
