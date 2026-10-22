import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'moratv-test-'));
process.env.MORA_HOME = home;
delete process.env.TMDB_KEY;

const { db } = await import('../../src/lib/server/db.js');
const works = await import('../../src/lib/server/works.js');
const { homeRecommend, _reset } = await import('../../src/lib/server/home.js');

after(() => { works._setDeps(null); try { db().close(); } catch { /* 已关 */ } rmSync(home, { recursive: true, force: true }); });

const vod = { siteId: 1, vodId: '9', name: 'x', year: 2023, remarks: '', lines: [{ name: 'm3u8', episodes: [{ name: '第1集', url: 'https://x.test/1.m3u8' }] }] };
const list = (items, anyAnswered) => Object.assign([...items], { anyAnswered });
let down = false;
works._setDeps({
  getWork: async (key) => ({ key, type: 'tv', name: `详情名${key}`, poster: null, seasons: [] }),
  listSites: () => [{ id: 1, name: '站A', latency_ms: 1 }],
  findSources: async () => (down ? list([], false) : list([vod], true)),
});

const DEFS = [{ id: 'a', title: '甲排' }, { id: 'b', title: '乙排' }];
let gen = 0;
let calls = 0;
/** 每「代」候选不同（模拟 TMDB 榜单变了），记调用次数 */
const cands = (id) => { calls++; return Promise.resolve(Array.from({ length: 3 }, (_, i) => ({ key: `tv-${gen}${id === 'a' ? 1 : 2}${i}`, name: 'n', available: null }))); };
const ageStore = (ms) => db().prepare("UPDATE cache SET v = json_set(v, '$.at', ?) WHERE k = 'home:rows:v1'").run(Date.now() - ms);
const resolveAll = (rows) => Promise.all(rows.map((r) => r.items));

beforeEach(() => { _reset(); calls = 0; down = false; });

test('没有存货：逐排 promise；同时打开的两次共用一次计算；算完存起来', async () => {
  gen = 1;
  const x = homeRecommend(DEFS, cands, { need: 3, min: 1 });
  const y = homeRecommend(DEFS, cands, { need: 3, min: 1 });
  assert.equal(x.fresh, null);
  assert.ok(x.rows[0].items instanceof Promise);
  assert.equal(x.rows[0].items, y.rows[0].items, '单飞');
  assert.equal(calls, 2, '每排只拉一次候选');
  const [la, lb] = await resolveAll(x.rows);
  assert.deepEqual(la.map((t) => t.key), ['tv-110', 'tv-111', 'tv-112']);
  assert.equal(lb.length, 3);
  await x.sitesDown;
  await new Promise((r) => setImmediate(r));
  assert.ok(db().prepare("SELECT 1 FROM cache WHERE k = 'home:rows:v1'").get(), '存进 cache 表');
});

test('有新鲜存货（10 分钟内）：直接给数组，不重算', () => {
  const r = homeRecommend(DEFS, cands, { need: 3, min: 1 });
  assert.equal(r.fresh, null);
  assert.ok(Array.isArray(r.rows[0].items));
  assert.equal(r.rows[0].items[0].key, 'tv-110');
  assert.equal(r.rows[1].title, '乙排');
  assert.equal(calls, 0);
});

test('存货旧了：立刻给旧的，后台重算（并发共用一次），fresh 给新的并覆盖存货', async () => {
  ageStore(3600 * 1000);
  gen = 2;
  const x = homeRecommend(DEFS, cands, { need: 3, min: 1 });
  const y = homeRecommend(DEFS, cands, { need: 3, min: 1 });
  assert.equal(x.rows[0].items[0].key, 'tv-110', '先出旧的');
  assert.ok(Array.isArray(x.rows[1].items));
  assert.equal(x.fresh, y.fresh, '单飞');
  assert.equal(calls, 2);
  const f = await x.fresh;
  assert.deepEqual(f.a.map((t) => t.key), ['tv-210', 'tv-211', 'tv-212']);
  const z = homeRecommend(DEFS, cands, { need: 3, min: 1 });
  assert.equal(z.rows[0].items[0].key, 'tv-210', '下次打开就是新的');
  assert.equal(z.fresh, null);
});

test('资源站全都没回应：重算结果不存，存货保持原样', async () => {
  ageStore(3600 * 1000);
  gen = 3;
  down = true;
  const x = homeRecommend(DEFS, cands, { need: 3, min: 1 });
  assert.equal(x.rows[0].items[0].key, 'tv-210');
  assert.equal(await x.fresh, null);
  assert.equal(await x.sitesDown, true);
  _reset();
  down = false;
  const y = homeRecommend(DEFS, cands, { need: 3, min: 1 });
  assert.equal(y.rows[0].items[0].key, 'tv-210', '没被没过滤的结果覆盖');
  await y.fresh;
});
