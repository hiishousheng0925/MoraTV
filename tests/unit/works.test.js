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
  assert.ok(calls.find >= 1);
});
