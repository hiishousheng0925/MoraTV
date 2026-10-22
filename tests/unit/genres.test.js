import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'moratv-test-'));
process.env.MORA_HOME = home;

const { db } = await import('../../src/lib/server/db.js');
const G = await import('../../src/lib/genres.js');
const B = await import('../../src/lib/server/browse.js');

after(() => { B._setDeps(null); db().close(); rmSync(home, { recursive: true, force: true }); });
beforeEach(() => { db().prepare('DELETE FROM cache').run(); B._setDeps(null); });

test('题材表：实测的 keyword / genre id 原样；剧集 / 电影分别映射', () => {
  const kw = (id, t = 'tv') => G.genreParams(id, t).with_keywords;
  assert.equal(kw('guzhuang'), '195013|15060|295029|341424|347945');
  assert.equal(kw('wuxia'), '184656|779');
  assert.equal(kw('xianxia'), '234890|347944|340360|297031|326271');
  assert.equal(kw('gongdou'), '191599|8860|8754');
  assert.equal(kw('diezhan'), '5265|470');
  assert.equal(kw('chuanyue'), '4379');
  const g = (id, t) => G.genreParams(id, t)?.with_genres;
  assert.equal(g('xuanyi', 'tv'), '9648');
  assert.equal(g('fanzui', 'movie'), '80');
  assert.equal(g('aiqing', 'movie'), '10749');
  assert.equal(g('aiqing', 'tv'), undefined, '剧集没有爱情 genre，走关键词');
  assert.equal(g('dongzuo', 'tv'), '10759');
  assert.equal(g('dongzuo', 'movie'), '28');
  assert.equal(g('kehuan', 'tv', 'kr'), '10765');
  assert.equal(g('kehuan', 'movie'), '878');
  assert.equal(g('jingsong', 'movie'), '53|27');
  assert.match(kw('jingsong'), /^316362\|.*\b10349\b/, '剧集惊悚含逃生 / 生存关键词');
  assert.equal(g('zhanzheng', 'tv'), '10768');
  assert.equal(g('zhanzheng', 'movie'), '10752');
  assert.equal(g('jiating', 'tv'), '10751');
  assert.equal(g('juqing', 'movie'), '18');
  // 华语剧里的 10765 实为仙侠玄幻：内地 / 港 / 台剧集不出「科幻」
  for (const r of ['cn', 'hk', 'tw']) assert.equal(G.genreParams('kehuan', 'tv', r), null, r);
  assert.ok(G.genresFor('movie', 'cn').some((x) => x.id === 'kehuan'));
  assert.equal(G.genreParams('nope', 'tv'), null);
  // 题材 id 唯一
  assert.equal(new Set(G.GENRES.map((x) => x.id)).size, G.GENRES.length);
});

test('TVB 只对剧集 · 香港；年代区间', () => {
  assert.equal(G.networkFor('tvb', 'tv', 'hk').with_networks, '48');
  assert.equal(G.networkFor('tvb', 'tv', 'cn'), null);
  assert.equal(G.networkFor('tvb', 'movie', 'hk'), null);
  assert.deepEqual(G.decadeRange('2020s'), ['2020-01-01', '2029-12-31']);
  assert.deepEqual(G.decadeRange('2000s'), ['2000-01-01', '2009-12-31']);
  assert.deepEqual(G.decadeRange('old'), [null, '1999-12-31']);
  assert.equal(G.decadeRange('1990'), null);
  assert.equal(G.decadeRange(''), null);
});

test('parseQuery：不认识 / 不适用的值丢掉', () => {
  const q = (s) => B.parseQuery(new URLSearchParams(s));
  assert.deepEqual(q(''), { kind: 'tv', region: '', g: '', net: '', sort: '', dec: '', page: 1, src: null });
  const a = q('kind=tv&region=hk&g=wuxia&net=tvb&sort=new&dec=2010s&p=3&src=7');
  assert.deepEqual(a, { kind: 'tv', region: 'hk', g: 'wuxia', net: 'tvb', sort: 'new', dec: '2010s', page: 3, src: 7 });
  assert.equal(q('kind=tv&region=cn&net=tvb').net, '', 'TVB 只在香港');
  assert.equal(q('kind=tv&region=cn&g=kehuan').g, '', '华语剧没有科幻');
  assert.equal(q('kind=variety&g=xiju').g, '', '综艺不叠题材');
  assert.equal(q('kind=xx&region=mars&sort=hot&dec=1990s&p=-4').kind, 'tv');
  assert.deepEqual(Object.values(q('region=mars&sort=hot&dec=1990s&p=999')).slice(1, 7), ['', '', '', '', '', 500]);
});

test('browseTmdb：题材 + TVB + 年代 + 排序传给 discover；动画类卡片字段', async () => {
  let got;
  B._setDeps({ discover: async (type, o) => { got = { type, ...o }; return Object.assign([{ type: 'tv', id: 1, name: '射雕', region: 'HK', year: 1983 }], { totalPages: 4 }); } });
  const r = await B.browseTmdb({ kind: 'tv', region: 'hk', g: 'wuxia', net: 'tvb', sort: 'score', dec: '2000s', page: 2 });
  assert.equal(got.type, 'tv');
  assert.deepEqual(got.filter, { with_keywords: '184656|779', with_networks: '48' });
  assert.deepEqual(got.range, ['2000-01-01', '2009-12-31']);
  assert.equal(got.sort, 'score');
  assert.equal(got.page, 2);
  assert.deepEqual(r, { items: [{ key: 'tv-1', name: '射雕', poster: undefined, year: 1983, region: 'hk', kind: 'tv', available: null }], totalPages: 4 });
  await B.browseTmdb({ kind: 'variety', region: '', g: '', net: '', sort: '', dec: '', page: 1 });
  assert.equal(got.filter, undefined);
  assert.equal(got.range, null);
});

test('genreCounts：只留有内容的题材、按表顺序、整组缓存；部分失败时失败的照样显示且短缓存', async () => {
  let calls = 0;
  const zero = new Set(['184656|779', '10765']);
  B._setDeps({ discoverCount: async (type, o) => { calls++; const f = o.filter; return zero.has(f.with_keywords || f.with_genres) ? 0 : 5; } });
  const a = await B.genreCounts({ kind: 'tv', region: 'kr', net: '' });
  assert.ok(!a.some((x) => x.id === 'wuxia'));
  assert.ok(!a.some((x) => x.id === 'kehuan'));
  assert.equal(a[0].id, 'guzhuang');
  const n = calls;
  await B.genreCounts({ kind: 'tv', region: 'kr', net: '' });
  assert.equal(calls, n, '第二次走缓存');
  // TVB 叠加：计数时带 with_networks
  const seen = [];
  B._setDeps({ discoverCount: async (type, o) => { seen.push(o.filter.with_networks); if (o.filter.with_genres === '80') throw new Error('x'); return 1; } });
  const t = await B.genreCounts({ kind: 'tv', region: 'hk', net: 'tvb' });
  assert.ok(seen.every((x) => x === '48'));
  assert.ok(t.some((x) => x.id === 'fanzui'), '计数失败的当作有内容');
  const e = db().prepare("SELECT expires_at e FROM cache WHERE k LIKE 'browse:genres:%hk:tvb'").get().e;
  assert.ok(e - Date.now() / 1000 <= 605 && e - Date.now() / 1000 > 0);
  // 全部失败：抛错
  B._setDeps({ discoverCount: async () => { throw new Error('down'); } });
  await assert.rejects(() => B.genreCounts({ kind: 'movie', region: 'jp', net: '' }));
  assert.deepEqual(await B.genreCounts({ kind: 'doc', region: '', net: '' }), []);
});

/* ---------- 没 key：资源站分类 ---------- */

const m3u8 = (n) => `第1集$https://v.example/${n}/index.m3u8`;
const vod = (id, name, type_name, extra = {}) => ({ vod_id: id, vod_name: name, vod_year: '2020', type_name, vod_pic: `https://img.example/${id}.jpg`,
  vod_remarks: '全30集', vod_time: `2026-10-${String(10 + (id % 10)).padStart(2, '0')} 10:00:00`, vod_play_from: 'm3u8', vod_play_url: m3u8(id), ...extra });
const CATS = [
  { id: 1, name: '电影片', pid: 0 }, { id: 2, name: '连续剧', pid: 0 }, { id: 3, name: '综艺片', pid: 0 }, { id: 4, name: '动漫片', pid: 0 },
  { id: 6, name: '动作片', pid: 1 }, { id: 7, name: '喜剧片', pid: 1 }, { id: 34, name: '伦理片', pid: 1 },
  { id: 13, name: '国产剧', pid: 2 }, { id: 14, name: '香港剧', pid: 2 }, { id: 23, name: '海外剧', pid: 2 },
  { id: 26, name: '港台综艺', pid: 3 }, { id: 25, name: '大陆综艺', pid: 3 }, { id: 29, name: '国产动漫', pid: 4 }, { id: 36, name: '短剧', pid: 2 },
];
// 有的站不给 type_pid：大类靠名字认
const CATS_NOPID = CATS.map(({ id, name }) => ({ id, name, pid: null }));

test('pickCategories：对上的类目只取一个；「全部」取末级类目；没有对应类目取地区不明的本地筛', () => {
  for (const cats of [CATS, CATS_NOPID]) {
    assert.deepEqual(B.pickCategories(cats, 'tv', 'hk'), { ids: [14], localRegion: false });
    assert.deepEqual(B.pickCategories(cats, 'tv', ''), { ids: [13, 14, 23], localRegion: false }, '不含大类「连续剧」和短剧');
    assert.deepEqual(B.pickCategories(cats, 'movie', ''), { ids: [6, 7], localRegion: false }, '不含伦理');
    assert.deepEqual(B.pickCategories(cats, 'movie', 'hk'), { ids: [6, 7], localRegion: true });
    assert.deepEqual(B.pickCategories(cats, 'variety', 'hk'), { ids: [26], localRegion: true }, '港台综艺地区不明');
    assert.deepEqual(B.pickCategories(cats, 'tv', 'kr'), { ids: [23], localRegion: true });
  }
  assert.deepEqual(B.pickCategories([{ id: 20, name: '纪录片', pid: 1 }], 'doc', ''), { ids: [20], localRegion: false });
  assert.equal(B.perCategory(1, false), 20);
  assert.equal(B.perCategory(3, false), 10);
  assert.equal(B.perCategory(8, false), 5);
  assert.equal(B.perCategory(12, false), 4);
  assert.equal(B.perCategory(14, false), 2);
  assert.equal(B.perCategory(8, true), 20);
});

function fakeSites(sites, pages) {
  const asked = [];
  B._setDeps({
    listSites: () => sites,
    listCategories: async (s) => (s.down ? [] : CATS),
    recordResult: () => {},
    cmsGet: async (s, q) => { asked.push([s.id, q]); if (s.down) return null; return pages(q); },
  });
  return { asked };
}

test('browseSites：有对应类目按 t= 翻页；丢掉动画 / 没 m3u8；cms 卡片', async () => {
  const { asked } = fakeSites([{ id: 1, api: 'http://a/1', fail_streak: 0 }], () => ({ code: 1, total: 507, pagecount: 26, list: [
    vod(1, '新闻女王', '香港剧'), vod(2, '某动画', '港台动漫'), vod(3, '网页线路', '香港剧', { vod_play_from: 'web', vod_play_url: '第1集$https://v.example/x.html' }),
  ] }));
  const r = await B.browseSites({ kind: 'tv', region: 'hk', page: 2, src: null });
  assert.deepEqual(asked, [[1, { ac: 'videolist', t: 14, pg: 2 }]]);
  assert.equal(r.totalPages, 26);
  assert.equal(r.site, 1);
  assert.deepEqual(r.items, [{ key: 'cms-1-1', name: '新闻女王', poster: 'https://img.example/1.jpg', year: 2020, region: 'hk', kind: 'tv', sub: '全30集', available: true }]);
  await B.browseSites({ kind: 'tv', region: 'hk', page: 2, src: null });
  assert.equal(asked.length, 1, '同一页 30 分钟内走缓存');
});

test('browseSites：cms 卡片显示名去掉版本后缀和 $ 串', async () => {
  fakeSites([{ id: 1, api: 'http://a/1', fail_streak: 0 }], () => ({ code: 1, total: 2, pagecount: 1, list: [
    vod(1, '新闻女王粤语版', '香港剧'), vod(2, '庆余年，废物太子$庆余年之大凉太子爷', '香港剧'),
  ] }));
  const r = await B.browseSites({ kind: 'tv', region: 'hk', page: 1, src: null });
  assert.deepEqual(Object.fromEntries(r.items.map((i) => [i.key, i.name])), { 'cms-1-1': '新闻女王', 'cms-1-2': '庆余年，废物太子' });
});

// 每个类目 40 条：id = 类目*100 + 序号
const catList = (q) => {
  const name = CATS.find((c) => c.id === q.t).name;
  const area = q.t === 26 ? (i) => (i % 2 ? '香港' : '台湾') : () => '';
  return { code: 1, total: 40, pagecount: 2, list: Array.from({ length: q.pg > 2 ? 0 : 20 }, (_, i) => vod(q.t * 100 + (q.pg - 1) * 20 + i, `${name}${(q.pg - 1) * 20 + i}`, name, { vod_area: area(i) })) };
};

test('browseSites：「全部」地区每个类目各出几条合成一页（翻页不漏不重）；地区不明的按 vod_area 筛', async () => {
  const { asked } = fakeSites([{ id: 1, api: 'http://a/2', fail_streak: 0 }], catList);
  const pages = [];
  for (let p = 1; p <= 5; p++) pages.push(await B.browseSites({ kind: 'tv', region: '', page: p, src: null }));
  assert.deepEqual(pages.map((r) => r.items.length), [30, 30, 30, 30, 0], '3 个类目 × 每页 10 条');
  assert.equal(pages[0].totalPages, 4);
  const keys = pages.flatMap((r) => r.items.map((x) => x.key));
  assert.equal(new Set(keys).size, 120, '翻 4 页正好取完 3 × 40 条');
  assert.ok(asked.every(([, q]) => [13, 14, 23].includes(q.t)));
  const va = await B.browseSites({ kind: 'variety', region: 'hk', page: 1, src: null });
  assert.equal(va.items.length, 10);
  assert.ok(va.items.every((x) => x.region === 'hk'));
});

test('browseSites：翻页优先用 src 那个站；没回应换下一个；全挂抛 noSiteAnswered', async () => {
  const sites = [{ id: 1, api: 'http://a/3', fail_streak: 0 }, { id: 2, api: 'http://a/4', fail_streak: 0, down: true }, { id: 3, api: 'http://a/5', fail_streak: 1 }];
  const { asked } = fakeSites(sites, () => ({ code: 1, pagecount: 1, list: [vod(1, '剧', '国产剧')] }));
  const r = await B.browseSites({ kind: 'tv', region: 'cn', page: 1, src: 3 });
  assert.equal(r.site, 3);
  assert.deepEqual(asked.map(([id]) => id), [3]);
  const r2 = await B.browseSites({ kind: 'tv', region: 'cn', page: 1, src: 2 });
  assert.equal(r2.site, 1, 'src 那个站挂了换健康的');
  fakeSites(sites.map((s) => ({ ...s, down: true, api: s.api + 'x' })), () => null);
  await assert.rejects(() => B.browseSites({ kind: 'tv', region: 'cn', page: 1, src: null }), (e) => e.noSiteAnswered === true);
});

test('genreCounts：选了年代按年代计数（缓存分开）', async () => {
  const ranges = [];
  B._setDeps({ discoverCount: async (type, o) => { ranges.push(o.range); return o.range ? (o.filter.with_keywords === '4379' ? 0 : 1) : 1; } });
  const all = await B.genreCounts({ kind: 'tv', region: 'cn', net: '', dec: '' });
  const old = await B.genreCounts({ kind: 'tv', region: 'cn', net: '', dec: 'old' });
  assert.ok(all.some((x) => x.id === 'chuanyue'));
  assert.ok(!old.some((x) => x.id === 'chuanyue'));
  assert.ok(ranges.some((r) => r && r[1] === '1999-12-31'));
});
