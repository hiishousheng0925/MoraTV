import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { filterAds } from '../../src/lib/server/stream/adfilter.js';

const fx = (name) => readFileSync(join(import.meta.dirname, '..', 'fixtures', 'm3u8', name), 'utf8');
const segs = (t) => t.split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
const discs = (t) => t.split(/\r?\n/).filter((l) => l.trim() === '#EXT-X-DISCONTINUITY').length;
const lastLine = (t) => t.trim().split(/\r?\n/).at(-1);

/** 按组拼一个媒体 playlist：groups = [[dur, uri][]]；opts.between 插在 DISCONTINUITY 后（例如 KEY） */
function build(groups, { head = [] } = {}) {
  const L = ['#EXTM3U', '#EXT-X-VERSION:3', '#EXT-X-TARGETDURATION:8', ...head];
  groups.forEach((g, i) => {
    if (i > 0) L.push('#EXT-X-DISCONTINUITY');
    for (const s of g) {
      if (typeof s === 'string') { L.push(s); continue; }
      L.push(`#EXTINF:${s[0]},`, s[1]);
    }
  });
  L.push('#EXT-X-ENDLIST');
  return L.join('\n') + '\n';
}
const D24 = [4.166667, 3.541667, 5.208333, 2.916667, 4.583333, 6.25, 3.75, 4.958333];
let k = 0;
const main24 = (n, pre = '') => Array.from({ length: n }, () => { const i = k++; return [D24[i % D24.length], `${pre}m${i}.ts`]; });

test('片头广告组：≤90 秒、≤20 片、域名不同 -> 删 1 组，连同后面的 DISCONTINUITY 结构正确', () => {
  const src = fx('intro-ad.m3u8');
  const r = filterAds(src);
  assert.deepEqual(r.removed, { groups: 1, seconds: 15 });
  assert.equal(segs(r.text).length, 20);
  assert.ok(!r.text.includes('ad.example.net'));
  assert.equal(discs(r.text), 0);
  assert.equal(lastLine(r.text), '#EXT-X-ENDLIST');
  assert.ok(r.text.startsWith('#EXTM3U\n#EXT-X-VERSION:3'));
});

test('中插广告：URL 含 /adjump/ -> 删 1 组，删掉组前的 DISCONTINUITY', () => {
  const src = fx('url-ad.m3u8');
  assert.equal(discs(src), 2);
  const r = filterAds(src);
  assert.deepEqual(r.removed, { groups: 1, seconds: 15 });
  assert.equal(segs(r.text).length, 20);
  assert.ok(!/adjump/.test(r.text));
  assert.equal(discs(r.text), 1);
  assert.equal(lastLine(r.text), '#EXT-X-ENDLIST');
  // 第 10 片后面紧跟着 DISCONTINUITY 再接第 11 片
  const ls = r.text.split('\n');
  const at = ls.indexOf('seg00009.ts');
  assert.equal(ls[at + 1], '#EXT-X-DISCONTINUITY');
  assert.equal(ls[at + 3], 'seg00010.ts');
});

test('无 DISCONTINUITY 的干净列表原样返回', () => {
  const src = fx('clean.m3u8');
  const r = filterAds(src);
  assert.equal(r.text, src);
  assert.deepEqual(r.removed, { groups: 0, seconds: 0 });
});

test('正片多段拼接（每段 > 10 分钟、同前缀）不误删', () => {
  const src = fx('multi-part.m3u8');
  const r = filterAds(src);
  assert.equal(r.text, src);
  assert.equal(r.removed.groups, 0);
});

test('master playlist 原样返回', () => {
  const src = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000,RESOLUTION=1920x1080\nhls/index.m3u8\n';
  assert.deepEqual(filterAds(src), { text: src, removed: { groups: 0, seconds: 0 } });
});

test('URL 规则命中 advert / ads 目录', () => {
  const src = build([main24(30), [[5, 'https://cdn.example.com/ads/1.ts'], [5, 'https://cdn.example.com/ads/2.ts']], main24(30),
    [[3, 'https://x.example.com/advert/9.ts']], main24(30)]);
  const r = filterAds(src);
  assert.equal(r.removed.groups, 2);
  assert.equal(segs(r.text).length, 90);
  assert.equal(discs(r.text), 2);
});

test('规则 C：中间 ≤60 秒的组，路径前缀和主体不同 -> 删', () => {
  const ad = Array.from({ length: 7 }, (_, i) => [i < 6 ? 4 : 1.76, `/20261003/84_x/2000k/hls/ad00${i}.ts`]);
  const src = build([main24(75), ad, main24(400), ad, main24(200)]);
  const r = filterAds(src);
  assert.equal(r.removed.groups, 2);
  assert.equal(r.removed.seconds, 51.5);
  assert.equal(segs(r.text).length, 675);
  assert.ok(!/ad00/.test(r.text));
});

test('规则 C：同目录但帧率网格不同（25fps 时长混在 24fps 正片里）-> 删', () => {
  const ad = Array.from({ length: 7 }, (_, i) => [i < 6 ? 4 : 1.76, `ffad${8371869 + i}.ts`]);
  const src = build([main24(10), main24(10), ad, main24(10), main24(10)]);
  const r = filterAds(src);
  assert.equal(r.removed.groups, 1);
  assert.equal(segs(r.text).length, 40);
});

test('规则 C：哈希文件名、30fps 中插混在 24fps 正片里 -> 删；正片自己的短组不删', () => {
  const d30 = [4.866667, 3.333333, 6.366667, 2.1, 2.966667];
  const ad = d30.map((d, i) => [d, `${'a'.repeat(31)}${i}.ts`]);
  const tail = [[2, 'x1.ts'], [4.791667, 'x2.ts'], [4.458333, 'x3.ts']]; // 正片短尾巴（24fps）
  const src = build([main24(9), main24(10), tail, ad, main24(9), main24(10), main24(10)]);
  const r = filterAds(src);
  assert.equal(r.removed.groups, 1);
  assert.equal(segs(r.text).length, 9 + 10 + 3 + 9 + 10 + 10);
  assert.ok(r.text.includes('x2.ts'));
});

test('规则 C：广告里有一片恰好也落在正片网格上（6.666667 = 160/24）仍然删', () => {
  const ad = [6.666667, 2.133333, 3.233333, 3.733333].map((d, i) => [d, `${'b'.repeat(31)}${i}.ts`]);
  const src = build([main24(10), main24(10), ad, main24(10), main24(10)]);
  assert.equal(filterAds(src).removed.groups, 1);
});

test('正片短组里只有个别片时长不在网格上 -> 不删', () => {
  const odd = [...main24(9), [3.217, 'odd.ts']];
  const src = build([main24(10), main24(10), odd, main24(10), main24(10)]);
  assert.equal(filterAds(src).removed.groups, 0);
});

test('正片本身就是很多 ≤60 秒的小组（同目录同帧率）不误删', () => {
  const groups = Array.from({ length: 40 }, () => main24(10));
  const src = build(groups);
  assert.equal(filterAds(src).removed.groups, 0);
});

test('首组是正片（同前缀同帧率、很短）不删', () => {
  const src = build([main24(9), main24(10), main24(10), main24(500)]);
  assert.equal(filterAds(src).removed.groups, 0);
});

test('删掉的组里有 #EXT-X-KEY：后面没有自带 KEY 的组要继承它', () => {
  const key = '#EXT-X-KEY:METHOD=AES-128,URI="k2.key"';
  const src = build([main24(100), [key, [5, '/ads/a.ts'], [5, '/ads/b.ts']], main24(100)]);
  const r = filterAds(src);
  assert.equal(r.removed.groups, 1);
  const ls = r.text.split('\n');
  const i = ls.indexOf('#EXT-X-DISCONTINUITY');
  assert.equal(ls[i + 1], key);
});

test('不会把所有组都删光', () => {
  const src = build([[[5, '/ads/a.ts']], [[5, '/ads/b.ts']]]);
  const r = filterAds(src);
  assert.equal(r.removed.groups, 0);
  assert.equal(r.text, src);
});

test('CRLF 列表也能处理', () => {
  const src = fx('url-ad.m3u8').replace(/\n/g, '\r\n');
  const r = filterAds(src);
  assert.equal(r.removed.groups, 1);
  assert.equal(segs(r.text).length, 20);
});
