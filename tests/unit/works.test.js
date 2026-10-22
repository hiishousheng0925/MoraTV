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

test('sourcesFor：带上显示名 / 语言标签 / 站点权重，原名和线路名不动（线路偏好按内部线路名记）', async () => {
  const v = { ...vod, vodId: 'w77', name: '繁花普通话版$繁花', lines: [{ name: 'lzm3u8', episodes: vod.lines[0].episodes }, { name: '粤语m3u8', episodes: vod.lines[0].episodes }] };
  works._setDeps({ listSites: () => [{ id: 1, name: '站A', latency_ms: 1, weight: -10 }], findSources: async () => list([v], true) });
  const [s] = await works.sourcesFor({ key: 'tv-9031', type: 'tv', name: '繁花', seasons: [] });
  assert.equal(s.name, '繁花普通话版$繁花');
  assert.equal(s.title, '繁花');
  assert.equal(s.lang, '国语');
  assert.equal(s.weight, -10);
  assert.deepEqual(s.lines.map((l) => [l.name, l.lang]), [['lzm3u8', null], ['粤语m3u8', '粤语']]);
});

test('genresOfType：资源站类目名只在像题材时才当类型', () => {
  assert.deepEqual(works.genresOfType('国产剧'), []);
  assert.deepEqual(works.genresOfType('香港剧'), []);
  assert.deepEqual(works.genresOfType('大陆综艺'), []);
  assert.deepEqual(works.genresOfType('欧美剧'), []);
  assert.deepEqual(works.genresOfType('动作片'), ['动作']);
  assert.deepEqual(works.genresOfType('古装剧'), ['古装']);
  assert.deepEqual(works.genresOfType(''), []);
  assert.deepEqual(works.genresOfType('港台综艺'), []);
  assert.deepEqual(works.genresOfType('国产动漫'), []);
  assert.deepEqual(works.genresOfType('纪录片'), []);
  assert.deepEqual(works.genresOfType('美食'), ['美食'], '只看整串，不按单字误伤');
  assert.deepEqual(works.genresOfType('舞台剧'), ['舞台']);
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
function setupRec({ has = [], down = false, names = {}, gate = null, onFind = null, downAfter = Infinity, workFails = [] } = {}) {
  const calls = { find: [] };
  works._setDeps({
    getWork: async (key) => {
      if (workFails.includes(key)) throw new Error('TMDB 503');
      return { key, type: 'tv', name: names[key] || `详情名${key}`, poster: `/p-${key}.jpg`, seasons: [] };
    },
    listSites: () => [{ id: 1, name: '站A', latency_ms: 120 }],
    findSources: async (w) => {
      calls.find.push(w.key);
      onFind?.(calls.find.length);
      if (gate) await gate;
      const isDown = down || calls.find.length > downAfter;
      return isDown ? list([], false) : list(has.includes(w.key) ? [vod] : [], true);
    },
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
  // 后一排的候选先到：它先占满空位（6 个，卡在 gate 上）；这时前一排的候选才到，排队中的让前一排插到前面
  let release;
  const gate = new Promise((r) => { release = r; });
  let arrive;
  const late = new Promise((r) => { arrive = r; });
  const calls = setupRec({ has: [...a, ...b].map((t) => t.key), gate, onFind: (n) => { if (n === 6) { arrive(a); setImmediate(release); } } });
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

test('recommendRows：一排查到一半资源站全挂 → 这排及后面的排都不过滤', async () => {
  const a = cand(600, 10);
  setupRec({ has: keysOf(a), downAfter: 3 });
  const { rows, sitesDown } = works.recommendRows([{ id: 'a', items: Promise.resolve(a) }, { id: 'b', items: Promise.resolve(cand(610, 5)) }], { need: 8, min: 2 });
  const ra = await rows[0].items;
  assert.deepEqual(keysOf(ra), keysOf(a.slice(0, 8)));
  assert.equal(ra.every((t) => t.available === null), true);
  assert.equal((await rows[1].items).length, 5);
  assert.equal(await sitesDown, true);
});

test('recommendRows：其他错误当作没片源跳过，每种错误只记一次日志', async () => {
  const a = cand(700, 8);
  setupRec({ has: keysOf(a), workFails: ['tv-7000', 'tv-7001', 'tv-7002'] });
  const warns = [];
  const orig = console.warn;
  console.warn = (...x) => warns.push(x.join(' '));
  try {
    const { rows } = works.recommendRows([{ id: 'a', items: Promise.resolve(a) }], { need: 8, min: 2 });
    assert.deepEqual(keysOf(await rows[0].items), keysOf(a.slice(3)));
  } finally { console.warn = orig; }
  assert.equal(warns.filter((w) => w.includes('TMDB 503')).length, 1);
});

test('rememberSearch 只记通过片源判定的条目（同名同年的内地剧不进韩剧的片源缓存）', async () => {
  setup([list([], true)]);
  const kr = { ...vod, vodId: '71', name: '黑暗荣耀', year: 2022, area: '韩国', category: { kind: 'tv', region: 'kr' }, actors: ['宋慧乔'] };
  const cn = { ...vod, vodId: '72', name: '黑暗荣耀', year: 2022, area: '大陆', category: { kind: 'tv', region: 'cn' }, actors: ['某甲'] };
  works.rememberSearch([{ key: 'tv-7', type: 'tv', kind: 'tv', name: '黑暗荣耀', originalName: '더 글로리', year: 2022, region: 'kr', tmdb: { alternativeTitles: [] }, sources: [kr, cn], available: true }]);
  const s = await works.sourcesFor({ key: 'tv-7', type: 'tv', name: '黑暗荣耀', seasons: [] });
  assert.deepEqual(s.map((v) => v.vodId), ['71']);
});

test('sourcesFor 把通过匹配的 cms 片源登记成别名：cms 下的进度并到 TMDB 作品', async () => {
  const lib = await import('../../src/lib/server/library.js');
  lib.saveProgress({ key: 'cms-1-30', season: 1, episode: 2, epName: '第2集', position: 321, duration: 2700, siteId: 1 });
  setup([list([{ ...vod, vodId: '30' }], true)]);
  const w = { key: 'tv-31', type: 'tv', name: '繁花', seasons: [] };
  lib.saveTitle(w);
  await works.sourcesFor(w, undefined, { link: true });
  assert.equal(lib.resolveKey('cms-1-30'), 'tv-31');
  assert.equal(lib.getProgress('tv-31').last.position, 321);
  assert.equal(lib.continueList().filter((x) => x.key === 'tv-31' || x.key === 'cms-1-30').length, 1);
});

test('多季剧按条目自己的季号登记别名；cms 作品自己的片源查询不登记', async () => {
  const lib = await import('../../src/lib/server/library.js');
  const v2 = { ...vod, vodId: '20', name: '某剧 第二季' };
  setup([list([v2], true)]);
  const w = { key: 'tv-32', type: 'tv', name: '某剧', seasons: [{ season: 1 }, { season: 2 }] };
  lib.saveTitle(w);
  lib.saveProgress({ key: 'cms-1-20', season: 1, episode: 1, position: 10, duration: 100 });
  await works.sourcesFor(w, 2, { link: true });
  assert.equal(lib.getProgress('tv-32').episodes[0].season, 2);

  const v3 = { ...vod, vodId: '21' };
  setup([list([], true)]);
  await works.sourcesFor({ key: 'cms-1-21', type: 'tv', name: '繁花', seasons: [], vod: v3 }, undefined, { link: true });
  assert.equal(lib.resolveKey('cms-1-21'), 'cms-1-21');
});

test('别名只在用户打开作品时登记：搜索（rememberSearch）和首页可用性预查不登记，即使 cms key 下有进度', async () => {
  const lib = await import('../../src/lib/server/library.js');
  const aliasRows = () => db().prepare('SELECT COUNT(*) AS n FROM key_alias').get().n;
  const before = aliasRows();
  lib.saveProgress({ key: 'cms-1-40', season: 1, episode: 1, position: 50, duration: 2700 });
  const v = { ...vod, vodId: '40', year: 2023 };
  // 搜索
  works.rememberSearch([{ key: 'tv-41', type: 'tv', kind: 'tv', name: '繁花', year: 2023, tmdb: { alternativeTitles: [] }, sources: [v], available: true }]);
  assert.equal(aliasRows(), before, '搜索不登记');
  // 首页后台可用性预查（走 sourcesFor，不带 link）
  setup([list([v], true)]);
  assert.equal(await works.availability('tv-42'), true);
  assert.equal(aliasRows(), before, '可用性预查不登记');
  assert.equal(lib.resolveKey('cms-1-40'), 'cms-1-40');
});

test('打开详情：只登记 cms key 下有片库记录的那条别名，其余片源不登记', async () => {
  const lib = await import('../../src/lib/server/library.js');
  const rows = () => db().prepare("SELECT alias, key FROM key_alias WHERE key = 'tv-43'").all().map((r) => ({ ...r }));
  lib.saveProgress({ key: 'cms-1-50', season: 1, episode: 3, position: 99, duration: 2700 });
  const a = { ...vod, vodId: '50' };
  const b = { ...vod, vodId: '51' };
  const c = { ...vod, siteId: 1, vodId: '52' };
  setup([list([a, b, c], true)]);
  const w = { key: 'tv-43', type: 'tv', name: '繁花', seasons: [] };
  lib.saveTitle(w);
  await works.sourcesFor(w, undefined, { link: true });
  assert.deepEqual(rows(), [{ alias: 'cms-1-50', key: 'tv-43' }]);
  assert.equal(lib.getProgress('tv-43').last.position, 99);
  assert.equal(lib.resolveKey('cms-1-51'), 'cms-1-51');
});