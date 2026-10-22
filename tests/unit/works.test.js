import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'moratv-test-'));
process.env.MORA_HOME = home;
delete process.env.TMDB_KEY;

const { db } = await import('../../src/lib/server/db.js');
const works = await import('../../src/lib/server/works.js');

after(() => { works._setDeps(null); try { db().close(); } catch { /* 已关 */ } rmSync(home, { recursive: true, force: true }); });

const vod = { siteId: 1, vodId: '9', name: '繁花', year: 2023, remarks: '', lines: [{ name: 'm3u8', episodes: [{ name: '第1集', url: 'https://x.test/1.m3u8' }] }] };
function setup(results) {
  const calls = { find: 0 };
  works._setDeps({
    getWork: async (key) => ({ key, type: 'tv', name: '繁花', seasons: [] }),
    listSites: () => [{ id: 1, name: '站A', latency_ms: 120 }],
    findSources: async () => { const r = results[Math.min(calls.find, results.length - 1)]; calls.find++; return r; },
  });
  return calls;
}
const list = (items, anyAnswered) => Object.assign([...items], { anyAnswered });

test('所有资源站都没回应：availability 抛错且不缓存（下次还会再查）', async () => {
  const calls = setup([list([], false), list([], false)]);
  await assert.rejects(works.availability('tv-1'));
  await assert.rejects(works.availability('tv-1'));
  assert.equal(calls.find, 2, '负结果不能进缓存');
});

test('至少一个站回了「没有」：记成无片源并缓存', async () => {
  const calls = setup([list([], true)]);
  assert.equal(await works.availability('tv-2'), false);
  assert.equal(await works.availability('tv-2'), false);
  assert.equal(calls.find, 1, '第二次走缓存');
});

test('有片源：true；sourcesFor 带上站点名和延迟', async () => {
  setup([list([vod], true)]);
  assert.equal(await works.availability('tv-3'), true);
  const s = await works.sourcesFor({ key: 'tv-3', type: 'tv', name: '繁花', seasons: [] });
  assert.equal(s[0].siteName, '站A');
  assert.equal(s[0].latency, 120);
});

test('sourcesFor：全部站点没回应时抛 NoSiteAnswered', async () => {
  setup([list([], false)]);
  await assert.rejects(works.sourcesFor({ key: 'tv-4', type: 'tv', name: 'x', seasons: [] }), works.NoSiteAnswered);
});

test('无片源（有站回了「没有」）的可用性只缓存 6 小时', async () => {
  setup([list([], true)]);
  assert.equal(await works.availability('tv-5'), false);
  const row = db().prepare("SELECT expires_at FROM cache WHERE k LIKE 'avail%tv-5'").get();
  const left = row.expires_at - Math.floor(Date.now() / 1000);
  assert.ok(left > 5 * 3600 && left <= 6 * 3600, `剩 ${left} 秒`);
});

test('搜索说有 → 详情也有：rememberSearch 写进片源缓存，分季详情按季取，覆盖旧的「无片源」', async () => {
  const calls = setup([list([], true)]);
  assert.equal(await works.availability('tv-6'), false); // 修匹配之前的旧判定
  const s1 = { ...vod, vodId: '61', name: '创世纪1：地产风云国语', year: 1999 };
  const s2 = { ...vod, vodId: '62', name: '创世纪2：天地有情粤语', year: 2000 };
  works.rememberSearch([{ key: 'tv-6', type: 'tv', name: '创世纪', sources: [s1, s2], available: true }]);
  assert.equal(await works.availability('tv-6'), true);
  const w = { key: 'tv-6', type: 'tv', name: '创世纪', seasons: [{ season: 1 }, { season: 2 }] };
  assert.deepEqual((await works.sourcesFor(w, 2)).map((v) => v.vodId), ['62']);
  assert.deepEqual((await works.sourcesFor(w, 1)).map((v) => v.vodId), ['61']);
  assert.equal(calls.find, 3, "旧判定 1 次 + 两个季各查 1 次");
});

/** 推荐预查的假依赖：has 里的 key 有片源；down=true 时所有站都没回应 */
function setupRec({ has = [], down = false, names = {}, delay = 0 } = {}) {
  const calls = { find: [] };
  works._setDeps({
    getWork: async (key) => ({ key, type: 'tv', name: names[key] || `详情名${key}`, poster: `/p-${key}.jpg`, seasons: [] }),
    listSites: () => [{ id: 1, name: '站A', latency_ms: 120 }],
    findSources: async (w) => { calls.find.push(w.key); if (delay) await new Promise((r) => setTimeout(r, delay)); return down ? list([], false) : list(has.includes(w.key) ? [vod] : [], true); },
  });
  return calls;
}
const cand = (prefix, n) => Array.from({ length: n }, (_, i) => ({ key: `tv-${prefix}${i}`, name: `榜单名${i}`, poster: null, available: null }));
const keysOf = (l) => l && l.map((t) => t.key);

test('recommendRows：只留有片源的、名字换成详情名、凑满 need 就停、跨排去重', async () => {
  const a = cand(100, 12);
  const b = [a[1], a[3], ...cand(200, 8)];
  const has = [...a.filter((_, i) => i % 2), ...b].map((t) => t.key);
  const calls = setupRec({ has });
  const { rows, sitesDown } = works.recommendRows([{ id: 'a', items: Promise.resolve(a) }, { id: 'b', items: Promise.resolve(b) }], { need: 3, min: 2 });
  const ra = await rows[0].items;
  assert.deepEqual(keysOf(ra), ['tv-1001', 'tv-1003', 'tv-1005']);
  assert.equal(ra[0].name, '详情名tv-1001');
  assert.equal(ra[0].poster, '/p-tv-1001.jpg');
  assert.equal(ra[0].available, true);
  const rb = await rows[1].items;
  assert.equal(rb.some((t) => ra.some((x) => x.key === t.key)), false, '前一排出现过的不再出现');
  assert.equal(rb.length, 3);
  assert.equal(await sitesDown, false);
  assert.ok(calls.find.length < a.length + b.length, '凑满就不再往后查（只多查一窗预取）');
});

test('recommendRows：前面的排先查（后面的排的预查排在后面）', async () => {
  const a = cand(500, 8);
  const b = cand(510, 16);
  const calls = setupRec({ has: [...a, ...b].map((t) => t.key), delay: 20 });
  // 后一排的候选先到：它先占满空位（6 个），但排队中的让前一排插到前面
  const late = new Promise((r) => setTimeout(() => r(a), 5));
  const { rows } = works.recommendRows([{ id: 'a', items: late }, { id: 'b', items: Promise.resolve(b) }], { need: 16, min: 2 });
  await rows[1].items;
  assert.deepEqual(calls.find.slice(0, 6), keysOf(b.slice(0, 6)));
  assert.deepEqual(calls.find.slice(6, 14).sort(), keysOf(a).sort());
});

test('recommendRows：凑不满 min 张整排为 []；候选加载失败为 null', async () => {
  setupRec({ has: ['tv-3001'] });
  const { rows } = works.recommendRows([
    { id: 'x', items: Promise.resolve(cand(300, 8)) },
    { id: 'y', items: Promise.reject(new Error('TMDB 挂了')) },
  ], { need: 4, min: 2 });
  assert.deepEqual(await rows[0].items, []);
  assert.equal(await rows[1].items, null);
});

test('recommendRows：资源站全都没回应 → 推荐不过滤、sitesDown=true、不写负缓存', async () => {
  setupRec({ down: true });
  const a = cand(400, 6);
  const { rows, sitesDown } = works.recommendRows([{ id: 'a', items: Promise.resolve(a) }, { id: 'b', items: Promise.resolve([a[0], ...cand(410, 3)]) }], { need: 4, min: 2 });
  const ra = await rows[0].items;
  assert.deepEqual(keysOf(ra), keysOf(a.slice(0, 4)));
  assert.equal(ra.every((t) => t.available === null), true, '不判无');
  assert.deepEqual(keysOf(await rows[1].items), ['tv-4100', 'tv-4101', 'tv-4102'], '仍跨排去重');
  assert.equal(await sitesDown, true);
  assert.equal(db().prepare("SELECT COUNT(*) c FROM cache WHERE k LIKE 'avail%tv-40%' OR k LIKE 'src%tv-40%'").get().c, 0);
});

test('rememberSearch 只记通过片源判定的条目（同名同年的内地剧不进韩剧的片源缓存）', async () => {
  setup([list([], true)]);
  const kr = { ...vod, vodId: '71', name: '黑暗荣耀', year: 2022, area: '韩国', category: { kind: 'tv', region: 'kr' }, actors: ['宋慧乔'] };
  const cn = { ...vod, vodId: '72', name: '黑暗荣耀', year: 2022, area: '大陆', category: { kind: 'tv', region: 'cn' }, actors: ['某甲'] };
  works.rememberSearch([{ key: 'tv-7', type: 'tv', kind: 'tv', name: '黑暗荣耀', originalName: '더 글로리', year: 2022, region: 'kr', tmdb: { alternativeTitles: [] }, sources: [kr, cn], available: true }]);
  const s = await works.sourcesFor({ key: 'tv-7', type: 'tv', name: '黑暗荣耀', seasons: [] });
  assert.deepEqual(s.map((v) => v.vodId), ['71']);
});
