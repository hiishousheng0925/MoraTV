import { test, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'moratv-test-'));
process.env.MORA_HOME = home;

const { db } = await import('../../src/lib/server/db.js');
const { latestBySite } = await import('../../src/lib/server/cms/client.js');
const latest = await import('../../src/lib/server/cms/latest.js');
const { _setAllowPrivate } = await import('../../src/lib/server/net.js');
_setAllowPrivate(true); // 允许连回环地址（本地假资源站）

const m3u8 = (n) => `第1集$https://v.example/${n}/index.m3u8`;
const vod = (id, name, type_name, time, extra = {}) => ({
  vod_id: id, vod_name: name, vod_year: '2026', type_name, vod_time: time, vod_pic: `//img.example/${id}.jpg`,
  vod_remarks: '更新至第3集', vod_play_from: 'm3u8', vod_play_url: m3u8(id), ...extra,
});

// 站 A：第 1 页剧集 / 综艺 / 动漫 / 无 m3u8，第 2 页电影
const A = [
  [vod(1, '庆余年', '国产剧', '2026-10-22 10:00:00'), vod(2, '跑男', '大陆综艺', '2026-10-22 09:00:00'),
    vod(3, '某动画', '国产动漫', '2026-10-22 08:00:00'), vod(4, '只有网页线路', '韩国剧', '2026-10-22 07:00:00', { vod_play_from: 'web', vod_play_url: '第1集$https://v.example/x.html' }),
    vod(5, '短剧甲', '短剧', '2026-10-22 06:00:00')],
  [vod(6, '流浪地球3', '科幻片', '2026-10-21 10:00:00')],
];
// 站 B：和 A 重复的「慶餘年」（繁体，同年）+ 一部港剧
const B = [[vod(11, '慶餘年', '国产剧', '2026-10-22 11:00:00'), vod(12, '新闻女王2', '香港剧', '2026-10-22 05:00:00')]];

// 站点正常回 JSON，但全是丢弃类目 / 没有 m3u8 的条目
const EMPTY = [[vod(21, '某动画', '国产动漫', '2026-10-22 10:00:00'), vod(22, '网页线路', '国产剧', '2026-10-22 09:00:00', { vod_play_from: 'web', vod_play_url: '第1集$https://v.example/y.html' })]];

// 站 Q：8 部国产剧 + 2 部韩剧 + 同名异站重复（年份缺失的也算同一部）
const Q = [[
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((i) => vod(100 + i, `国产${'甲乙丙丁戊己庚辛'[i - 1]}`, '国产剧', `2026-10-22 1${i}:00:00`)),
  vod(120, '韩剧甲', '韩国剧', '2026-10-22 09:00:00'), vod(121, '韩剧乙', '韩国剧', '2026-10-22 08:00:00'),
  vod(122, '国产辛', '国产剧', '2026-10-22 07:00:00', { vod_year: '' }),
  vod(130, '独家港剧', '香港剧', '2026-10-22 10:30:00'), vod(131, '独家港剧', '香港剧', '2026-10-22 06:30:00', { vod_year: '' }),
  vod(132, '独家台剧', '台湾剧', '2026-10-22 10:40:00', { vod_year: '' }), vod(133, '独家台剧', '台湾剧', '2026-10-22 06:40:00'),
  vod(123, '写真集', '写真', '2026-10-22 06:00:00'), vod(124, '侧耳倾听', 'AI漫剧', '2026-10-22 06:00:00'),
]];

const hits = [];
let srv; let base;
before(async () => {
  srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    hits.push(u.pathname + u.search);
    res.setHeader('content-type', 'application/json');
    const pages = { '/a': A, '/b': B, '/empty': EMPTY, '/q': Q }[u.pathname];
    if (!pages) { res.statusCode = 500; return res.end('{}'); }
    const pg = Number(u.searchParams.get('pg')) || 1;
    res.end(JSON.stringify({ code: 1, page: pg, pagecount: pages.length, limit: 20, total: pages.flat().length, list: pages[pg - 1] || [] }));
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => {
  latest._setDeps(null);
  _setAllowPrivate(false);
  srv.closeAllConnections?.(); srv.close();
  try { db().close(); } catch { /* 已关 */ }
  rmSync(home, { recursive: true, force: true });
});
beforeEach(() => { hits.length = 0; });

const recorded = [];
const useSites = (sites) => latest._setDeps({
  listSites: () => sites,
  recordResult: (id, ok) => recorded.push([id, ok]),
});

test('latestBySite：带 h / pg / pagesize，回 pagecount；站点坏了 pagecount 为 null', async () => {
  const l = await latestBySite({ id: 1, api: `${base}/a` }, { hours: 24, page: 1 });
  assert.equal(l.length, 5);
  assert.equal(l.pagecount, 2);
  const q = new URLSearchParams(hits[0].split('?')[1]);
  assert.equal(q.get('ac'), 'videolist'); assert.equal(q.get('h'), '24'); assert.equal(q.get('pg'), '1'); assert.equal(q.get('pagesize'), '100');
  const bad = await latestBySite({ id: 9, api: `${base}/broken` });
  assert.deepEqual([...bad], []); assert.equal(bad.pagecount, null);
});

test('byHealth：fail_streak 小优先，再按延迟（没测过的排后）', () => {
  const s = latest.byHealth([
    { id: 1, fail_streak: 2, latency_ms: 10 }, { id: 2, fail_streak: 0, latency_ms: null },
    { id: 3, fail_streak: 0, latency_ms: 300 }, { id: 4, fail_streak: 0, latency_ms: 80 },
  ]);
  assert.deepEqual(s.map((x) => x.id), [4, 3, 2, 1]);
});

test('collectLatest：分排、丢动漫 / 无 m3u8 / 短剧、跨站去重、坏站换下一个', async () => {
  recorded.length = 0;
  useSites([
    { id: 9, api: `${base}/broken`, fail_streak: 0, latency_ms: 5 }, // 最「健康」但这次没回应 -> 换下一个
    { id: 1, api: `${base}/a`, fail_streak: 0, latency_ms: 50 },
    { id: 2, api: `${base}/b`, fail_streak: 1, latency_ms: 20 },
  ]);
  const r = await latest.collectLatest();
  assert.deepEqual(Object.keys(r), ['tv', 'movie', 'variety']);
  // 「慶餘年」（站 B，更新时间更晚）和「庆余年」是同一部：只留一张
  assert.deepEqual(r.tv.map((x) => x.name), ['慶餘年', '新闻女王2']);
  assert.equal(r.tv[0].key, 'cms-2-11');
  assert.equal(r.tv[1].region, 'hk');
  assert.deepEqual(r.movie.map((x) => x.key), ['cms-1-6']); // 第 2 页的电影也拿到了
  assert.deepEqual(r.variety.map((x) => x.name), ['跑男']);
  const card = r.variety[0];
  assert.equal(card.poster, '//img.example/2.jpg');
  assert.equal(card.sub, '更新至第3集');
  assert.equal(card.available, true);
  assert.equal(card.kind, 'variety');
  assert.ok(recorded.some(([id, ok]) => id === 9 && ok === false));
  assert.ok(recorded.some(([id, ok]) => id === 1 && ok === true));
});

test('collectLatest：每排每个地区最多 4 张；年份缺失的同名视为同一部；擦边 / 漫剧不出现', async () => {
  useSites([{ id: 5, api: `${base}/q`, fail_streak: 0 }]);
  const r = await latest.collectLatest();
  assert.equal(r.tv.filter((x) => x.region === 'cn').length, 4);
  assert.equal(r.tv.filter((x) => x.region === 'kr').length, 2);
  // 配额之内（hk / tw 各只有 1 部）：只有「年份缺失视为同一部」这条能让重复条目消失
  assert.equal(r.tv.filter((x) => x.name === '独家港剧').length, 1);
  assert.equal(r.tv.filter((x) => x.name === '独家台剧').length, 1);
  assert.ok(!r.tv.some((x) => /写真|侧耳/.test(x.name)));
});

test('collectLatest：所有站都没回应 -> 抛错（不缓存成空）', async () => {
  useSites([{ id: 9, api: `${base}/broken`, fail_streak: 0 }]);
  await assert.rejects(latest.collectLatest());
  useSites([]);
  await assert.rejects(latest.collectLatest());
});

test('三排全空：抛错且不缓存（不让首页空 30 分钟）', async () => {
  useSites([{ id: 3, api: `${base}/empty`, fail_streak: 0 }]);
  await assert.rejects(latest.collectLatest(), /为空/);
  await assert.rejects(latest.latestRows());
  const n = hits.length;
  await assert.rejects(latest.latestRows());
  assert.ok(hits.length > n); // 第二次仍去请求资源站，没有缓存空结果
});

test('latestRows：缓存 30 分钟（第二次不再请求资源站）', async () => {
  useSites([{ id: 1, api: `${base}/a`, fail_streak: 0 }]);
  const a = await latest.latestRows();
  const n = hits.length;
  assert.ok(n > 0);
  const b = await latest.latestRows();
  assert.equal(hits.length, n);
  assert.deepEqual(a, b);
});
