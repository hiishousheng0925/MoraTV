/**
 * 验收实测脚本（设计文档 §11）：片名命中率 / 演员 / 剧情 / 去广告。直接调用服务端函数，不起 HTTP 服务。
 *
 *   node tests/accept/search-hit.js titles|actors|plot|ads|all [输出 JSON 路径]
 *
 * 密钥只从环境变量读，不落盘、不进日志：
 *   TMDB_KEY   TMDB v3 key
 *   LLM_KEY    OpenAI 兼容接口的 key（剧情搜索）；可选 LLM_BASE / LLM_MODEL
 * 数据目录一律指到临时目录（MORA_HOME 没设就自己建一个）。
 */
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';

if (!process.env.MORA_HOME) process.env.MORA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'moratv-accept-test-'));

const { searchTitles, searchActor, findSources } = await import('../../src/lib/server/search/aggregate.js');
const plot = await import('../../src/lib/server/search/plot.js');
const { proxyPlaylist } = await import('../../src/lib/server/stream/proxy.js');
const { filterAds } = await import('../../src/lib/server/stream/adfilter.js');
const { normTitle } = await import('../../src/lib/server/search/normalize.js');
const { listSites } = await import('../../src/lib/server/cms/sites.js');
const siteNames = new Map(listSites().map((x) => [x.id, x.name]));
const siteName = (src) => siteNames.get(src.siteId) || String(src.siteId);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/** 片单（§11 第 1 项）：[分类, 片名, 首播 / 上映年份] */
export const TITLES = [
  ['陆剧', '繁花', 2023], ['陆剧', '庆余年', 2019], ['陆剧', '狂飙', 2023], ['陆剧', '漫长的季节', 2023],
  ['陆剧', '隐秘的角落', 2020], ['陆剧', '冰雨火', 2021], ['陆剧', '西出玉门', 2024],
  ['港剧', '溏心风暴', 2007], ['港剧', '大时代', 1992], ['港剧', '新闻女王', 2022], ['港剧', '使徒行者', 2014],
  ['台剧', '想见你', 2019],
  ['韩剧', '黑暗荣耀', 2022], ['韩剧', '请回答1988', 2015], ['韩剧', '鱿鱼游戏', 2021],
  ['美剧', '绝命毒师', 2008],
  ['电影', '肖申克的救赎', 1994], ['电影', '流浪地球2', 2023], ['电影', '霸王别姬', 1993], ['电影', '无间道', 2002],
];

export const ACTORS = [
  ['赵丽颖', ['知否知否应是绿肥红瘦', '楚乔传', '花千骨', '陆贞传奇', '有翡', '风吹半夏']],
  ['刘德华', ['无间道', '天下无贼', '失孤', '拆弹专家', '大人物', '投名状']],
  ['宋慧乔', ['黑暗荣耀', '太阳的后裔', '那年冬天，风在吹', '秋天里的童话', '现在，分手中', '浪漫的体质']],
];

export const PLOTS = [
  ['现代女白领意外穿越到清朝康熙年间，卷入九子夺嫡的宫廷争斗，爱上了其中几位阿哥', '步步惊心'],
  ['银行家被冤枉杀害妻子和情人，关进监狱后用一把小锤子偷偷挖了将近二十年的隧道越狱', '肖申克的救赎'],
  ['一个冤死将军的儿子隐姓埋名多年，化身江左盟宗主回到京城，为七万赤焰军翻案', '琅琊榜'],
  ['一个外地青年在上海滩一路打拼，成了黑帮大亨，最后在码头被仇人枪杀，主题曲很有名', '上海滩'],
  ['地球环境恶化，一位前宇航员驾驶飞船穿过虫洞去找新家园，他留在地球的女儿后来靠手表的指针解开了引力方程', '星际穿越'],
];

const sec = (n) => Math.round(n);
const ms = (t0) => Math.round(performance.now() - t0);

async function timed(fn) {
  const t0 = performance.now();
  try { return { value: await fn(), ms: ms(t0) }; } catch (e) { return { error: String(e?.message || e), ms: ms(t0) }; }
}

/** 解开 master：取第一条子列表（proxyPlaylist 已把它改写成 /api/stream?u=…） */
async function mediaPlaylist(url) {
  let text = await proxyPlaylist(url);
  for (let hop = 0; hop < 3 && /#EXT-X-STREAM-INF/i.test(text); hop++) {
    const sub = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
    const u = sub && new URL(sub, 'http://x.invalid').searchParams.get('u');
    if (!u) throw new Error('master 里没有子列表');
    text = await proxyPlaylist(u);
  }
  return text;
}

const segmentsOf = (text) => text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

async function probeSegment(uri) {
  const res = await fetch(uri, { headers: { 'user-agent': UA, range: 'bytes=0-1023' }, signal: AbortSignal.timeout(10000) });
  const n = (await res.arrayBuffer()).byteLength;
  return (res.status === 200 || res.status === 206) && n > 0;
}

/** 依次试 work 的片源 / 线路的第 1 集，直到拿到有分片的 media playlist */
export async function playCheck(work, { maxLines = 8 } = {}) {
  let attempts = 0;
  const errors = [];
  for (const src of work.sources || []) {
    for (const line of src.lines || []) {
      const ep = line.episodes?.[0];
      if (!ep?.url) continue;
      if (++attempts > maxLines) return { ok: false, attempts: attempts - 1, errors };
      try {
        const text = await mediaPlaylist(ep.url);
        const segs = segmentsOf(text);
        if (!segs.length || !/#EXTINF/i.test(text)) { errors.push(`${siteName(src)}/${line.name}: 没有分片`); continue; }
        let segOk = false;
        try { segOk = await probeSegment(segs[0]); } catch { /* 记 false */ }
        return { ok: true, attempts, site: siteName(src), line: line.name, segments: segs.length, firstSegmentFetch: segOk, ep: ep.name };
      } catch (e) {
        errors.push(`${siteName(src)}/${line.name}: ${String(e?.message || e).slice(0, 60)}`);
      }
    }
  }
  return { ok: false, attempts, errors };
}

// 只去空白和标点、保留数字：「流浪地球」不算「流浪地球2」
const rawKey = (s) => String(s || '').replace(/[\s\p{P}]/gu, '').toLowerCase();
const titleMatch = (w, name) => !!w && rawKey(w.name) === rawKey(name);

export async function runTitles() {
  const rows = [];
  for (const [cat, name, year] of TITLES) {
    const t0 = performance.now();
    const r = await timed(() => searchTitles(name));
    const works = r.value || [];
    const searchMs = r.ms;
    const top = works[0] || null;
    const rank = works.findIndex((w) => titleMatch(w, name)) + 1; // 0 = 没出现
    const yearOk = !!top && (top.year == null || Math.abs(top.year - year) <= 1);
    let play = { ok: false, attempts: 0, errors: [] };
    const t1 = performance.now();
    if (top && titleMatch(top, name) && top.sources?.length) play = await playCheck(top);
    const playMs = ms(t1);
    rows.push({
      cat, name, expectYear: year, searchMs, playMs, totalMs: ms(t0), error: r.error || null,
      nWorks: works.length, top: top ? { name: top.name, year: top.year, key: top.key, region: top.region, kind: top.kind, nSources: top.sources.length } : null,
      rank, titleHit: rank === 1, yearOk,
      playOk: play.ok, site: play.site || null, line: play.line || null, segments: play.segments || 0, firstSegmentFetch: play.firstSegmentFetch ?? null, attempts: play.attempts, errors: play.errors || [],
      hit: rank === 1 && yearOk && play.ok,
    });
    console.error(`[titles] ${cat} ${name}: rank=${rank} hit=${rows.at(-1).hit} ${rows.at(-1).totalMs}ms`);
  }
  return rows;
}

export async function runActors() {
  const rows = [];
  for (const [name, known] of ACTORS) {
    const r = await timed(() => searchActor(name));
    const v = r.value || { persons: [], works: [] };
    const who = v.persons[0];
    const avail = v.works.filter((w) => w.available);
    const knownFound = known.filter((k) => v.works.some((w) => normTitle(w.name) === normTitle(k)));
    const playable = [];
    for (const w of avail.slice(0, 3)) {
      const p = await playCheck(w, { maxLines: 4 });
      playable.push({ name: w.name, year: w.year, ok: p.ok, site: p.site || null });
    }
    rows.push({
      name, ms: r.ms, error: r.error || null, person: who ? { name: who.name, id: who.id } : null,
      nWorks: v.works.length, nAvailable: avail.length, knownFound, knownExpected: known.length,
      works: v.works.map((w) => `${w.name}(${w.year ?? '?'})${w.available ? '' : '✗'}`), playable,
    });
    console.error(`[actors] ${name}: ${v.works.length} works, ${avail.length} available, ${r.ms}ms`);
  }
  return rows;
}

export async function runPlot() {
  const key = process.env.LLM_KEY;
  if (!key) throw new Error('缺 LLM_KEY 环境变量');
  const base = process.env.LLM_BASE || plot.DEFAULT_BASE;
  const model = process.env.LLM_MODEL || plot.DEFAULT_MODEL;
  plot._setDeps({ getSetting: (k) => ({ llm_key: key, llm_base: base, llm_model: model })[k] || null });
  const rows = [];
  for (const [desc, answer] of PLOTS) {
    const r = await timed(() => plot.searchPlot(desc));
    const works = r.value?.works || [];
    const guesses = r.value?.guesses || [];
    rows.push({
      desc, answer, ms: r.ms, error: r.error || null, model,
      guesses: guesses.map((g) => `${g.name}(${g.year ?? '?'})`),
      candidates: works.map((w) => `${w.name}(${w.year ?? '?'})`),
      top1: titleMatch(works[0], answer), inTop5: works.some((w) => titleMatch(w, answer)),
      llmTop1: guesses[0] ? normTitle(guesses[0].name) === normTitle(answer) : false,
    });
    console.error(`[plot] ${answer}: top1=${rows.at(-1).top1} ${r.ms}ms`);
  }
  plot._setDeps(null);
  return rows;
}

/** 解析 playlist：按 DISCONTINUITY 切组 */
function groupsOf(text) {
  const groups = [[]];
  let dur = 0;
  for (const raw of text.split(/\r?\n/)) {
    const t = raw.trim();
    if (t === '#EXT-X-DISCONTINUITY') { if (groups.at(-1).length) groups.push([]); continue; }
    const m = t.match(/^#EXTINF:([\d.]+)/);
    if (m) dur = Number(m[1]);
    else if (t && !t.startsWith('#')) { groups.at(-1).push({ uri: t, dur }); dur = 0; }
  }
  return groups.filter((g) => g.length);
}
const prefix = (u) => { try { const x = new URL(u); return x.origin + x.pathname.slice(0, x.pathname.lastIndexOf('/') + 1); } catch { return u.slice(0, u.lastIndexOf('/') + 1); } };
const total = (g) => g.reduce((a, s) => a + s.dur, 0);

async function rawPlaylist(url) {
  let u = url;
  for (let hop = 0; hop < 3; hop++) {
    const res = await fetch(u, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = (await res.text()).replace(/^﻿/, '');
    if (!/#EXT-X-STREAM-INF/i.test(text)) return { text, url: res.url || u };
    const sub = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
    u = new URL(sub, res.url || u).href;
  }
  throw new Error('master 嵌套过深');
}

const AD_URL = /adjump|advert|\/ads?\//i;

/** 去广告：每部取排名最前的 3 个线路（不同站点优先）的第 1 集，原始 playlist 过 filterAds，逐组核对 */
export async function runAds(titleNames = ['繁花', '庆余年', '狂飙', '漫长的季节', '隐秘的角落', '想见你', '黑暗荣耀', '绝命毒师', '流浪地球2', '无间道']) {
  const rows = [];
  for (const name of titleNames) {
    const works = await searchTitles(name);
    const w = works.find((x) => titleMatch(x, name)) || works[0];
    const lists = [];
    if (w) {
      const seen = new Set();
      for (const src of w.sources) {
        for (const line of src.lines) {
          const ep = line.episodes?.[0];
          if (!ep?.url || seen.has(src.siteId) || lists.length >= 3) continue;
          try {
            const { text, url } = await rawPlaylist(ep.url);
            if (!segmentsOf(text).length) continue;
            seen.add(src.siteId);
            const out = filterAds(text);
            const before = groupsOf(text);
            const after = groupsOf(out.text);
            // 按顺序对齐删前 / 删后的组（广告素材常常整段重复出现，不能按 URL 判断）
            const removedGroups = [];
            let j = 0;
            for (const g of before) {
              if (j < after.length && after[j].length === g.length && after[j][0].uri === g[0].uri) j++;
              else removedGroups.push(g);
            }
            // 主体：最长的一组
            const main = [...before].sort((a, b) => total(b) - total(a))[0];
            const mainPrefix = main ? prefix(new URL(main[0].uri, url).href) : '';
            const removed = removedGroups.map((g) => {
              const p = prefix(new URL(g[0].uri, url).href);
              return { segs: g.length, seconds: sec(total(g)), samePrefixAsMain: p === mainPrefix, urlLooksAd: g.some((s) => AD_URL.test(s.uri)), prefix: p.replace(/^https?:\/\//, '').slice(0, 60) };
            });
            // 残留：过滤后仍有多组且前缀不同于主体的短组（可能漏删）
            const mainAfter = [...after].sort((a, b) => total(b) - total(a))[0];
            const residual = after.filter((g) => g !== mainAfter).map((g) => ({ segs: g.length, seconds: sec(total(g)), prefixDiffers: prefix(new URL(g[0].uri, url).href) !== mainPrefix, urlLooksAd: g.some((x) => AD_URL.test(x.uri)) })).filter((r) => r.prefixDiffers || r.urlLooksAd);
            lists.push({
              site: siteName(src), line: line.name, groupsBefore: before.length, removedGroups: removed.length,
              reportedGroups: out.removed.groups, reportedSeconds: sec(out.removed.seconds),
              totalSeconds: sec(before.reduce((a, g) => a + total(g), 0)), removed, residual,
            });
          } catch { /* 这条线路不可用，换下一条 */ }
        }
      }
    }
    rows.push({ name, work: w ? `${w.name}(${w.year ?? '?'})` : null, lists });
    console.error(`[ads] ${name}: ${lists.length} playlists`);
  }
  return rows;
}

const mode = process.argv[2];
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]).replace(/\\/g, '/')) && mode) {
  const out = {};
  const want = (m) => mode === 'all' || mode === m;
  if (want('titles')) out.titles = await runTitles();
  if (want('actors')) out.actors = await runActors();
  if (want('plot')) out.plot = await runPlot();
  if (want('ads')) out.ads = await runAds();
  const json = JSON.stringify(out, null, 2);
  if (process.argv[3]) fs.writeFileSync(process.argv[3], json); else console.log(json);
  process.exit(0);
}
