import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.MORA_HOME = mkdtempSync(join(tmpdir(), 'moratv-test-'));
delete process.env.TMDB_KEY;

const agg = await import('../../src/lib/server/search/aggregate.js');

const ep = (n = 1) => [{ name: '高清', episodes: Array.from({ length: n }, (_, i) => ({ name: `第${i + 1}集`, url: `https://x.test/${i}.m3u8` })) }];
const vod = (o) => ({
  siteId: 1, vodId: '1', name: '', year: null, area: '', typeName: '', category: { kind: 'tv', region: null },
  pic: '', actors: [], director: '', overview: '', remarks: '', lines: ep(), ...o,
});
const tm = (o) => ({ type: 'tv', id: 1, name: '', originalName: '', year: null, region: null, poster: null, overview: '', popularity: 1, voteAverage: 0, ...o });

let calls;
/** @param {Record<string, any[]>} cms @param {{multi?: any[], details?: Record<string, any>, persons?: any[], credits?: any[], key?: boolean, fail?: boolean}} t */
function deps(cms, t = {}) {
  calls = { searchAll: [], details: [], multi: [] };
  agg._setDeps({
    searchAll: async (kw) => { calls.searchAll.push(kw); return cms[kw] || []; },
    tmdb: {
      hasKey: () => t.key ?? true,
      searchMulti: async (q) => { calls.multi.push(q); if (t.fail) throw new Error('TMDB 500'); return t.multi || []; },
      details: async (type, id) => { calls.details.push(`${type}-${id}`); if (t.fail) throw new Error('TMDB 500'); return t.details?.[`${type}-${id}`] || null; },
      searchPerson: async () => { if (t.fail) throw new Error('TMDB 500'); return t.persons || []; },
      personCredits: async () => t.credits || [],
    },
  });
}

beforeEach(() => agg._setDeps(null));

test('① 同站不同年同名（韩剧 2022 / 内地短剧 2023）分成 2 个 Work', async () => {
  deps({ '黑暗荣耀': [
    vod({ siteId: 1, vodId: '10', name: '黑暗荣耀', year: 2022, area: '韩国', typeName: '韩国剧', category: { kind: 'tv', region: 'kr' }, lines: ep(16) }),
    vod({ siteId: 1, vodId: '11', name: '黑暗荣耀', year: 2023, area: '大陆', typeName: '短剧', category: { kind: 'short', region: null }, lines: ep(80) }),
  ] }, { key: false });
  const works = await agg.searchTitles('黑暗荣耀');
  assert.equal(works.length, 2);
  assert.deepEqual(works.map((w) => w.year).sort(), [2022, 2023]);
  assert.ok(works.every((w) => w.available && w.sources.length === 1 && w.tmdb === null));
  const kr = works.find((w) => w.year === 2022);
  assert.equal(kr.key, 'cms-1-10');
  assert.equal(kr.region, 'kr');
  assert.equal(works.find((w) => w.year === 2023).kind, 'short');
});

test('② 两站同名同年 → 1 个 Work、2 个片源；TMDB 匹配给出 tv-<id> 键', async () => {
  deps({ '繁花': [
    vod({ siteId: 1, vodId: '5', name: '繁花', year: 2023, area: '大陆', typeName: '国产剧', category: { kind: 'tv', region: 'cn' }, lines: ep(30) }),
    vod({ siteId: 2, vodId: '77', name: '繁花 国语版', year: 2024, area: '中国大陆', typeName: '大陆剧', category: { kind: 'tv', region: 'cn' }, lines: ep(30) }),
    vod({ siteId: 2, vodId: '78', name: '繁花解说', year: 2024, typeName: '影视解说', category: { kind: 'drop', region: null } }),
    vod({ siteId: 3, vodId: '9', name: '繁花', year: 2023, typeName: '国产剧', category: { kind: 'tv', region: 'cn' }, lines: [] }),
    vod({ siteId: 1, vodId: '5', name: '繁花', year: 2023, area: '大陆', typeName: '国产剧', category: { kind: 'tv', region: 'cn' }, lines: ep(30) }),
  ] }, { multi: [tm({ id: 106841, name: '繁花', originalName: '繁花', year: 2023, region: 'CN', popularity: 50 })] });
  const works = await agg.searchTitles('繁花');
  assert.equal(works.length, 1);
  const w = works[0];
  assert.equal(w.key, 'tv-106841');
  assert.equal(w.sources.length, 2);
  assert.ok(w.available);
  assert.equal(w.tmdb.id, 106841);
  assert.ok(calls.searchAll.includes('繁花'));
});

test('③ TMDB 有、资源站没有 → available:false 排最后', async () => {
  deps({ '大时代': [
    vod({ siteId: 1, vodId: '3', name: '大时代', year: 1992, area: '香港', typeName: '香港剧', category: { kind: 'tv', region: 'hk' }, lines: ep(40) }),
  ] }, { multi: [
    tm({ id: 900, name: '大时代之生死抉择', year: 2030, region: 'HK', popularity: 99 }),
    tm({ id: 901, name: '大时代', year: 1992, region: 'HK', popularity: 5 }),
  ] });
  const works = await agg.searchTitles('大时代');
  assert.equal(works.length, 2);
  assert.equal(works[0].key, 'tv-901');
  assert.equal(works[0].available, true);
  assert.equal(works[1].key, 'tv-900');
  assert.equal(works[1].available, false);
  assert.equal(works[1].sources.length, 0);
  // 没片源的作品用 TMDB 名再搜过一轮
  assert.ok(calls.searchAll.includes('大时代之生死抉择'));
});

test('④ 别名命中：TMDB 名对不上，别名「家好月圆」触发二轮搜索并匹配上', async () => {
  deps({
    '家好月圆': [vod({ siteId: 4, vodId: '42', name: '家好月圓', year: 2008, area: '香港', typeName: '港剧', category: { kind: 'tv', region: 'hk' }, lines: ep(20) })],
  }, {
    multi: [tm({ id: 555, name: 'Moonlight Resonance', originalName: 'Moonlight Resonance', year: 2008, region: 'HK' })],
    details: { 'tv-555': { alternativeTitles: ['家好月圆', 'Moonlight Resonance HK'] } },
  });
  const works = await agg.searchTitles('moonlight resonance');
  assert.ok(calls.searchAll.includes('家好月圆') || calls.searchAll.includes('家好月圓'), `二轮搜索没调：${calls.searchAll}`);
  assert.equal(works.length, 1);
  assert.equal(works[0].key, 'tv-555');
  assert.equal(works[0].available, true);
  assert.equal(works[0].sources[0].vodId, '42');
});

test('二轮搜到的无关条目不会混进结果', async () => {
  deps({
    '家好月圆': [
      vod({ siteId: 4, vodId: '42', name: '家好月圆', year: 2008, area: '香港', category: { kind: 'tv', region: 'hk' } }),
      vod({ siteId: 4, vodId: '43', name: '家好月圆之谁是凶手', year: 2019, area: '大陆', category: { kind: 'movie', region: null } }),
    ],
  }, {
    multi: [tm({ id: 555, name: 'Moonlight Resonance', year: 2008, region: 'HK' })],
    details: { 'tv-555': { alternativeTitles: ['家好月圆'] } },
  });
  const works = await agg.searchTitles('moonlight resonance');
  assert.deepEqual(works.map((w) => w.key), ['tv-555']);
});

test('多季：第二季（年份差大）并入同一个 TMDB 作品', async () => {
  deps({ '庆余年': [
    vod({ siteId: 1, vodId: '1', name: '庆余年', year: 2019, area: '大陆', category: { kind: 'tv', region: 'cn' } }),
    vod({ siteId: 1, vodId: '2', name: '庆余年第二季', year: 2024, area: '大陆', category: { kind: 'tv', region: 'cn' } }),
    vod({ siteId: 2, vodId: '8', name: '慶餘年2', year: 2024, area: '中国大陆', category: { kind: 'tv', region: 'cn' } }),
  ] }, { multi: [tm({ id: 90, name: '庆余年', year: 2019, region: 'CN' })] });
  const works = await agg.searchTitles('庆余年');
  assert.equal(works.length, 1);
  assert.equal(works[0].sources.length, 3);
});

test('TMDB 抛错时降级为纯资源站结果', async () => {
  deps({ '繁花': [vod({ siteId: 1, vodId: '5', name: '繁花', year: 2023, category: { kind: 'tv', region: 'cn' } })] }, { fail: true });
  const works = await agg.searchTitles('繁花');
  assert.equal(works.length, 1);
  assert.equal(works[0].key, 'cms-1-5');
  assert.equal(works[0].tmdb, null);
});

test('简繁变体都去资源站搜，按 (siteId, vodId) 去重', async () => {
  const v = vod({ siteId: 1, vodId: '5', name: '溏心风暴', year: 2007, area: '香港', category: { kind: 'tv', region: 'hk' } });
  deps({ '溏心风暴': [v], '溏心風暴': [v] }, { key: false });
  const works = await agg.searchTitles('溏心风暴');
  assert.ok(calls.searchAll.includes('溏心风暴') && calls.searchAll.includes('溏心風暴'));
  assert.equal(works.length, 1);
  assert.equal(works[0].sources.length, 1);
});

test('电影续集不因「数字后缀」并到一起', async () => {
  deps({ '叶问': [
    vod({ siteId: 1, vodId: '1', name: '叶问', year: 2008, area: '香港', category: { kind: 'movie', region: null } }),
    vod({ siteId: 1, vodId: '4', name: '叶问4', year: 2019, area: '香港', category: { kind: 'movie', region: null } }),
  ] }, { key: false });
  const works = await agg.searchTitles('叶问');
  assert.equal(works.length, 2);
});

test('searchActor：取第一位演员的作品，按年份倒序，并查片源', async () => {
  deps({ '花千骨': [vod({ siteId: 1, vodId: '7', name: '花千骨', year: 2015, area: '大陆', category: { kind: 'tv', region: 'cn' } })] }, {
    persons: [{ id: 1, name: '赵丽颖', works: [] }, { id: 2, name: '赵丽颖2', works: [] }],
    credits: [
      tm({ id: 11, name: '花千骨', year: 2015, region: 'CN', popularity: 10 }),
      tm({ id: 12, name: '风吹半夏', year: 2022, region: 'CN', popularity: 20 }),
    ],
  });
  const r = await agg.searchActor('赵丽颖');
  assert.equal(r.persons.length, 2);
  assert.deepEqual(r.works.map((w) => w.year), [2022, 2015]);
  assert.equal(r.works.find((w) => w.key === 'tv-11').available, true);
  assert.equal(r.works.find((w) => w.key === 'tv-12').available, false);
});

test('searchActorQuick：不查片源，available 为 null，可指定 personId', async () => {
  deps({}, {
    persons: [{ id: 1, name: '赵丽颖', works: [] }, { id: 2, name: '赵丽颖2', works: [] }],
    credits: [
      tm({ id: 11, name: '花千骨', year: 2015, region: 'CN', popularity: 10 }),
      tm({ id: 12, name: '风吹半夏', year: 2022, region: 'CN', popularity: 20 }),
    ],
  });
  const r = await agg.searchActorQuick('赵丽颖', { personId: 2 });
  assert.equal(r.person, 2);
  assert.deepEqual(r.works.map((w) => w.year), [2022, 2015]);
  assert.ok(r.works.every((w) => w.available === null));
  assert.equal(calls.searchAll.length, 0, '不应查资源站');
});

test('searchActor：没 key / 出错时返回空', async () => {
  deps({}, { key: false });
  assert.deepEqual(await agg.searchActor('赵丽颖'), { persons: [], works: [] });
  deps({}, { fail: true });
  assert.deepEqual(await agg.searchActor('赵丽颖'), { persons: [], works: [] });
});

test('findSources：按季过滤', async () => {
  deps({ '庆余年': [
    vod({ siteId: 1, vodId: '1', name: '庆余年', year: 2019, area: '大陆', category: { kind: 'tv', region: 'cn' } }),
    vod({ siteId: 1, vodId: '2', name: '庆余年第二季', year: 2024, area: '大陆', category: { kind: 'tv', region: 'cn' } }),
    vod({ siteId: 1, vodId: '3', name: '庆余年之帝王业', year: 2024, area: '大陆', category: { kind: 'tv', region: 'cn' } }),
  ] }, { key: false });
  const work = { key: 'tv-90', type: 'tv', name: '庆余年', originalName: '庆余年', year: 2019, region: 'cn', kind: 'tv', tmdb: null, sources: [] };
  assert.deepEqual((await agg.findSources(work, 2)).map((v) => v.vodId), ['2']);
  assert.deepEqual((await agg.findSources(work, 1)).map((v) => v.vodId), ['1']);
  assert.deepEqual((await agg.findSources(work)).map((v) => v.vodId).sort(), ['1', '2']);
});

test('片名末尾紧贴的年份等于条目年份时去掉（「大时代1992」并入「大时代」）', async () => {
  deps({ '大时代': [
    vod({ siteId: 1, vodId: '1', name: '大时代', year: 1992, area: '香港', category: { kind: 'tv', region: 'hk' } }),
    vod({ siteId: 2, vodId: '2', name: '大时代1992', year: 1992, area: '香港', category: { kind: 'tv', region: 'hk' } }),
    vod({ siteId: 2, vodId: '3', name: '大时代2018', year: 2018, area: '台湾', category: { kind: 'tv', region: 'tw' } }),
  ] }, { key: false });
  const works = await agg.searchTitles('大时代');
  assert.equal(works.length, 2);
  assert.equal(works.find((w) => w.year === 1992).sources.length, 2);
});

test('TMDB 把续季单列成一部（「溏心风暴3」）时，续季片源归它', async () => {
  deps({ '溏心风暴': [
    vod({ siteId: 1, vodId: '1', name: '溏心风暴', year: 2007, area: '香港', category: { kind: 'tv', region: 'hk' } }),
    vod({ siteId: 1, vodId: '3', name: '溏心风暴3', year: 2017, area: '香港', category: { kind: 'tv', region: 'hk' } }),
  ] }, { multi: [
    tm({ id: 5640, name: '溏心风暴', year: 2007, region: 'HK', popularity: 10 }),
    tm({ id: 242623, name: '溏心风暴3', year: 2017, region: 'HK', popularity: 5 }),
  ] });
  const works = await agg.searchTitles('溏心风暴');
  const s1 = works.find((w) => w.key === 'tv-5640');
  const s3 = works.find((w) => w.key === 'tv-242623');
  assert.deepEqual(s1.sources.map((v) => v.vodId), ['1']);
  assert.deepEqual(s3.sources.map((v) => v.vodId), ['3']);
  assert.ok(s3.available);
});

test('findSources：所有站点都没回应时 anyAnswered=false，有回应时为 true', async () => {
  agg._setDeps({ searchAll: async () => Object.assign([], { answered: 0 }), tmdb: { hasKey: () => false } });
  const none = await agg.findSources({ name: '繁花', year: 2023, type: 'tv' });
  assert.equal(none.length, 0);
  assert.equal(none.anyAnswered, false);
  agg._setDeps({ searchAll: async () => Object.assign([], { answered: 3 }), tmdb: { hasKey: () => false } });
  assert.equal((await agg.findSources({ name: '繁花', year: 2023, type: 'tv' })).anyAnswered, true);
});

test('电影续集（流浪地球2）和前作按年份分开、各站的续集聚成一个，精确同名排前面', async () => {
  const m = (o) => vod({ area: '大陆', typeName: '动作片', category: { kind: 'movie', region: 'cn' }, ...o });
  deps({ '流浪地球2': [
    m({ siteId: 1, vodId: '1', name: '流浪地球', year: 2019 }),
    m({ siteId: 1, vodId: '2', name: '流浪地球2', year: 2023 }),
    m({ siteId: 2, vodId: '3', name: '流浪地球2', year: 2023 }),
  ] }, { key: false });
  const works = await agg.searchTitles('流浪地球2');
  assert.equal(works.length, 2);
  assert.equal(works[0].name, '流浪地球2');
  assert.equal(works[0].sources.length, 2);
  assert.equal(works[1].name, '流浪地球');
});

test('演员搜索：同名人物按热度排，取最热的那位（TMDB 把无名同名者排在前面）', async () => {
  deps({}, {
    persons: [{ id: 9, name: '刘德华', popularity: 0.27, works: [] }, { id: 25246, name: '刘德华', popularity: 6.6, works: [] }],
    credits: [tm({ id: 5, name: '无间道', year: 2002, type: 'movie', popularity: 9 })],
  });
  const r = await agg.searchActor('刘德华');
  assert.deepEqual(r.persons.map((p) => p.id), [25246, 9]);
  assert.equal(r.works.length, 1);
  const q = await agg.searchActorQuick('刘德华');
  assert.equal(q.person, 25246);
});

test('findSources：电影不把续集（流浪地球2）当自己的季；剧集的 庆余年2 仍是第 2 季', async () => {
  const m = (o) => vod({ area: '大陆', typeName: '动作片', category: { kind: 'movie', region: 'cn' }, ...o });
  const tv = (o) => vod({ area: '大陆', typeName: '国产剧', category: { kind: 'tv', region: 'cn' }, ...o });
  const all = [
    m({ siteId: 1, vodId: '1', name: '流浪地球', year: 2019 }),
    m({ siteId: 1, vodId: '2', name: '流浪地球2', year: 2023 }),
    tv({ siteId: 2, vodId: '3', name: '庆余年', year: 2019 }),
    tv({ siteId: 2, vodId: '4', name: '庆余年2', year: 2024 }),
  ];
  agg._setDeps({ searchAll: async () => Object.assign([...all], { answered: 1 }), tmdb: { hasKey: () => false } });
  const a = await agg.findSources({ name: '流浪地球', year: 2019, type: 'movie', kind: 'movie', region: 'cn' });
  assert.deepEqual(a.map((v) => v.vodId), ['1']);
  const b = await agg.findSources({ name: '流浪地球2', year: 2023, type: 'movie', kind: 'movie', region: 'cn' });
  assert.deepEqual(b.map((v) => v.vodId), ['2']);
  const s2 = await agg.findSources({ name: '庆余年', year: 2019, type: 'tv', kind: 'tv', region: 'cn' }, 2);
  assert.deepEqual(s2.map((v) => v.vodId), ['4']);
});

test('电影续集（TMDB 命中路径）：流浪地球2 精确同名排第一，各站续集归到 TMDB 条目', async () => {
  const m = (o) => vod({ area: '大陆', typeName: '动作片', category: { kind: 'movie', region: 'cn' }, ...o });
  deps({ '流浪地球2': [
    m({ siteId: 1, vodId: '1', name: '流浪地球', year: 2019 }),
    m({ siteId: 1, vodId: '2', name: '流浪地球2', year: 2023 }),
    m({ siteId: 2, vodId: '3', name: '流浪地球2', year: 2023 }),
  ] }, { multi: [
    tm({ type: 'movie', id: 535167, name: '流浪地球', year: 2019, region: 'CN', popularity: 90 }),
    tm({ type: 'movie', id: 842675, name: '流浪地球2', year: 2023, region: 'CN', popularity: 40 }),
  ] });
  const works = await agg.searchTitles('流浪地球2');
  assert.equal(works[0].key, 'movie-842675');
  assert.equal(works[0].sources.length, 2);
  assert.equal(works.find((w) => w.key === 'movie-535167').sources.length, 1);
});

// ── 0.1.2 匹配回归（tests/fixtures/match-regression.json，条目池取自真实资源站） ──
import { readFileSync } from 'node:fs';
const { mapCategory } = await import('../../src/lib/server/cms/categories.js');
const { toSimplified } = await import('../../src/lib/server/search/normalize.js');
const FIX = JSON.parse(readFileSync(new URL('../fixtures/match-regression.json', import.meta.url), 'utf8'));
const poolVod = ([siteId, vodId, name, year, area, typeName, eps, actors]) => vod({
  siteId, vodId, name, year, area, typeName, category: mapCategory(typeName), actors: actors ? actors.split(',') : [], lines: ep(eps || 1),
});
const like = (s) => toSimplified(s).toLowerCase();
/** 假资源站：按「片名包含关键词」返回（苹果 CMS 的 wd 是 LIKE 搜索） */
function sitesFrom(pool, terms = []) {
  return async (kw) => { terms.push(kw); return Object.assign(pool.filter((v) => like(v.name).includes(like(kw))), { answered: 9 }); };
}
const keysOf = (list) => list.map((v) => `${v.siteId}:${v.vodId}`);
const caseOf = (id) => FIX.cases.find((c) => c.id === id);

for (const c of FIX.cases) {
  test(`回归 findSources · ${c.id}：${c.cause}`, async () => {
    const pool = c.pool.map(poolVod);
    const terms = [];
    agg._setDeps({ searchAll: sitesFrom(pool, terms), tmdb: { hasKey: () => false } });
    const found = await agg.findSources(c.work, c.season);
    const got = keysOf(found);
    const names = (ks) => ks.map((k) => `${k} ${pool.find((v) => `${v.siteId}:${v.vodId}` === k)?.name}`).join(' / ');
    if (c.only) {
      const want = new Set(c.only);
      const missing = c.only.filter((k) => !got.includes(k));
      const extra = got.filter((k) => !want.has(k));
      assert.deepEqual({ missing: names(missing), extra: names(extra) }, { missing: '', extra: '' }, `搜索词：${terms.join('|')}`);
    }
    const missing = (c.include || []).filter((k) => !got.includes(k));
    assert.equal(names(missing), '', `漏了（搜索词：${terms.join('|')}）`);
    const wrong = (c.exclude || []).filter((k) => got.includes(k));
    assert.equal(names(wrong), '', '混进了别的作品');
    assert.ok(new Set(terms).size <= 6, `搜索词太多：${terms.join('|')}`);
  });
}

/** 用 fixture 的条目池跑 searchTitles，TMDB 只给一条 */
async function searchCase(id, q, t) {
  const c = caseOf(id);
  const pool = c.pool.map(poolVod);
  agg._setDeps({
    searchAll: sitesFrom(pool),
    tmdb: { hasKey: () => true, searchMulti: async () => [tm(t)], details: async () => ({ alternativeTitles: c.work.tmdb.alternativeTitles }) },
  });
  const works = await agg.searchTitles(q);
  return { c, works, w: works.find((w) => w.key === `${t.type}-${t.id}`) };
}

test('回归 searchTitles · 长城：合拍片地区冲突仍对上 TMDB 条目', async () => {
  const { c, w } = await searchCase('长城', '长城', { type: 'movie', id: 311324, name: '长城', originalName: 'The Great Wall', year: 2016, region: 'US', popularity: 30 });
  assert.ok(w?.available);
  assert.deepEqual(keysOf(w.sources).sort(), [...c.only].sort());
});

test('回归 searchTitles · 创世纪：分部副标题的条目归到 TMDB 剧集', async () => {
  const { c, w } = await searchCase('创世纪', '创世纪', { type: 'tv', id: 1358, name: '创世纪', originalName: '創世紀', year: 1999, region: 'HK', popularity: 10 });
  assert.ok(w?.available);
  assert.deepEqual(keysOf(w.sources).sort(), [...c.only].sort());
});

test('回归 searchTitles · 性敢中环：TMDB 剧集 ↔ 资源站电影（没有剧集条目）也对上', async () => {
  const { c, works, w } = await searchCase('性敢中环', '性敢中环', { type: 'tv', id: 91491, name: '性敢中环', originalName: '性敢中環', year: 2019, region: 'HK', popularity: 3 });
  assert.ok(w?.available);
  assert.deepEqual(keysOf(w.sources).sort(), [...c.only].sort());
  assert.equal(works.length, 1);
});

test('回归 searchTitles · 奥德赛：2025 恐怖片不并进诺兰 2026', async () => {
  const { c, w } = await searchCase('奥德赛', '奥德赛', { type: 'movie', id: 1368337, name: '奥德赛', originalName: 'The Odyssey', year: 2026, region: 'US', popularity: 200 });
  assert.deepEqual(keysOf(w.sources).sort(), [...c.only].sort());
});

test('回归 searchTitles · 苍兰诀：动画版不并进真人剧', async () => {
  const { works, w } = await searchCase('苍兰诀', '苍兰诀', { type: 'tv', id: 134303, name: '苍兰诀', originalName: '苍兰诀', year: 2022, region: 'CN', popularity: 20 });
  assert.ok(w.sources.every((v) => !/动画/.test(v.name)));
  assert.ok(works.every((x) => x.sources.every((v) => !/动画/.test(v.name))), '动画版不该出现在任何结果里');
});

test('findSources：同一关键词在短时间内只搜一次（逐部查可用性时复用）', async () => {
  const c = caseOf('功夫');
  const terms = [];
  agg._setDeps({ searchAll: sitesFrom(c.pool.map(poolVod), terms), tmdb: { hasKey: () => false } });
  await agg.findSources(c.work);
  const n = terms.length;
  await agg.findSources(c.work);
  assert.equal(terms.length, n);
});

test('seasonOfVod：分部副标题 / 罗马数字也读出季号；电影恒为 1', () => {
  assert.equal(agg.seasonOfVod({ name: '创世纪2：天地有情粤语' }, false), 2);
  assert.equal(agg.seasonOfVod({ name: '少年包青天Ⅲ之天芒传奇' }, false), 3);
  assert.equal(agg.seasonOfVod({ name: '庆余年第二季' }, false), 2);
  assert.equal(agg.seasonOfVod({ name: '流浪地球2' }, true), 1);
});
