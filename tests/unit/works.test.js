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
