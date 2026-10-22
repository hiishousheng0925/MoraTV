import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'moratv-test-'));
process.env.MORA_HOME = home;
delete process.env.TMDB_KEY;

const { db } = await import('../../src/lib/server/db.js');
const { setSetting } = await import('../../src/lib/server/settings.js');
const { cached } = await import('../../src/lib/server/cache.js');
const tmdb = await import('../../src/lib/server/tmdb.js');
const { getImage } = await import('../../src/lib/server/img.js');
const { _setAllowPrivate } = await import('../../src/lib/server/net.js');
_setAllowPrivate(true);

const hits = [];
let srv;
const png = Buffer.from('89504e470d0a1a0a', 'hex');
const json = (res, o, code = 200) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };

before(async () => {
  srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    hits.push({ path: u.pathname, q: Object.fromEntries(u.searchParams) });
    const lang = u.searchParams.get('language');
    const p = u.pathname;
    if (p.startsWith('/t/p/')) {
      if (p.endsWith('/big.jpg')) { res.setHeader('content-type', 'image/jpeg'); return res.end(Buffer.alloc(11 * 1024 * 1024)); }
      if (p.endsWith('/gone.jpg')) { res.statusCode = 404; return res.end(); }
      res.setHeader('content-type', 'image/png');
      return res.end(png);
    }
    if (u.searchParams.get('api_key') !== 'k-test') return json(res, { status_message: 'Invalid API key' }, 401);
    if (p === '/3/discover/movie' && u.searchParams.get('certification') === 'III') {
      // 排除片单：分两页
      const pg = Number(u.searchParams.get('page'));
      return json(res, { total_pages: 2, results: pg === 1 ? [{ id: 221912 }] : [{ id: 45453 }] });
    }
    if (p === '/3/discover/movie' && u.searchParams.get('with_genres') === '53|27') {
      return json(res, { total_pages: 1, results: [
        { id: 221912, title: '强奸终极篇：最后羔羊', genre_ids: [53], vote_count: 22 },
        { id: 18747, title: '黑社会', genre_ids: [80, 53], vote_count: 300 },
        { id: 1598, title: '恐怖角', genre_ids: [53], vote_count: 2000 },
      ] });
    }
    if (p === '/3/search/multi' && u.searchParams.get('query') === '羔羊') {
      return json(res, { results: [{ media_type: 'movie', id: 221912, title: '强奸终极篇：最后羔羊' }, { media_type: 'movie', id: 1598, title: '恐怖角' }] });
    }
    if (p === '/3/search/multi') {
      return json(res, { results: [
        { media_type: 'tv', id: 106841, name: '繁花', original_name: '繁花', first_air_date: '2023-12-27', origin_country: ['CN'], poster_path: '/a.jpg', overview: '上海', popularity: 50.5, vote_average: 8.1 },
        { media_type: 'movie', id: 7, title: '花样年华', original_title: '花樣年華', release_date: '2000-09-29', poster_path: '/b.jpg', overview: '', popularity: 10, vote_average: 8 },
        { media_type: 'person', id: 9, name: '某人' },
      ] });
    }
    if (p === '/3/tv/1') {
      if (lang === 'zh-CN') {
        return json(res, {
          id: 1, name: '无简介', original_name: 'NoOv', first_air_date: '2020-01-01', origin_country: ['KR'], overview: '', number_of_seasons: 2,
          alternative_titles: { results: [{ title: 'Alt A' }, { title: 'Alt A' }, { title: 'Alt B' }] },
          credits: { cast: Array.from({ length: 9 }, (_, i) => ({ id: i, name: 'N' + i, character: 'C' + i })) },
          seasons: [{ season_number: 1, name: '第 1 季', episode_count: 12, air_date: '2020-01-01' }],
        });
      }
      if (lang === 'zh-TW' || lang === 'zh-HK') return json(res, { id: 1, overview: '' });
      return json(res, { id: 1, overview: 'English overview' });
    }
    if (p === '/3/tv/2') {
      return json(res, {
        id: 2, name: '弱小英雄', original_name: '약한영웅', first_air_date: '2022-11-18', origin_country: ['KR'], overview: '有简介',
        alternative_titles: { results: [{ title: 'Weak Hero' }, { title: '弱小英雄' }] },
        translations: { translations: [
          { iso_639_1: 'en', iso_3166_1: 'US', data: { name: 'Weak Hero Class 1', overview: 'x' } },
          { iso_639_1: 'zh', iso_3166_1: 'CN', data: { name: '弱小英雄', overview: '' } },
          { iso_639_1: 'zh', iso_3166_1: 'TW', data: { name: '弱美男英雄', overview: '台' } },
          { iso_639_1: 'zh', iso_3166_1: 'HK', data: { name: '弱美男英雄', overview: '' } },
          { iso_639_1: 'zh', iso_3166_1: 'SG', data: { name: '', overview: '' } },
        ] },
      });
    }
    if (p === '/3/tv/3') {
      return json(res, {
        id: 3, name: 'The Terminal List', original_name: 'The Terminal List', first_air_date: '2022-07-01', origin_country: ['US'], overview: 'x',
        translations: { translations: [
          { iso_639_1: 'en', iso_3166_1: 'US', data: { name: '', overview: 'x' } },
          { iso_639_1: 'zh', iso_3166_1: 'HK', data: { name: '末日名單', overview: '' } },
          { iso_639_1: 'zh', iso_3166_1: 'TW', data: { name: '終極名單', overview: '' } },
          { iso_639_1: 'zh', iso_3166_1: 'CN', data: { name: '', overview: '' } },
        ] },
      });
    }
    if (p === '/3/tv/4') {
      return json(res, {
        id: 4, name: '唐朝诡事录', original_name: '唐朝诡事录', original_language: 'zh', first_air_date: '2022-09-27', origin_country: ['CN'], overview: 'x',
        translations: { translations: [
          { iso_639_1: 'zh', iso_3166_1: 'CN', data: { name: '', overview: '' } },
          { iso_639_1: 'zh', iso_3166_1: 'TW', data: { name: '唐朝詭事錄', overview: '' } },
        ] },
      });
    }
    if (p === '/3/tv/404') return json(res, {}, 404);
    if (p === '/3/discover/tv' && u.searchParams.get('page') === '3') {
      return json(res, { results: [
        { id: 81, name: '正剧', genre_ids: [18], vote_count: 30 },
        { id: 82, name: '冷门', genre_ids: [18], vote_count: 3 },
        { id: 83, name: '国漫', genre_ids: [16, 18], vote_count: 300 },
      ] });
    }
    if (p === '/3/trending/all/week' && u.searchParams.get('page') === '2') {
      return json(res, { results: [
        { media_type: 'tv', id: 91, name: '药屋', genre_ids: [16, 18], vote_count: 900 },
        { media_type: 'movie', id: 92, title: '新片', genre_ids: [28], vote_count: 2 },
        { media_type: 'movie', id: 93, title: '热片', genre_ids: [28], vote_count: 200 },
      ] });
    }
    if (p === '/3/trending/tv/week') return json(res, { results: [{ id: 5, name: 'T', first_air_date: '2024-02-02', origin_country: ['HK'] }] });
    if (p === '/3/trending/all/week') return json(res, { results: [{ media_type: 'tv', id: 5, name: 'T' }, { media_type: 'person', id: 6 }] });
    if (p === '/3/discover/tv') return json(res, { results: [{ id: 8, name: 'D', origin_country: ['HK'], genre_ids: [18], vote_count: 50 }] });
    if (p === '/3/person/3') {
      return json(res, { name: 'P3', combined_credits: { cast: [{ media_type: 'tv', id: 1, name: 'a', popularity: 1 }, { media_type: 'tv', id: 1, name: 'a', popularity: 1 }, { media_type: 'movie', id: 2, title: 'b', popularity: 9 }] } });
    }
    if (p === '/3/person/4') {
      return json(res, { name: 'Yoo Jae-suk', also_known_as: ['유재석', '刘在石'], combined_credits: { cast: [
        { media_type: 'tv', id: 41, name: '正经剧', character: '李四', genre_ids: [18], popularity: 5 },
        { media_type: 'tv', id: 42, name: '某脱口秀', character: 'Guest', genre_ids: [10767], popularity: 50 },
        { media_type: 'tv', id: 43, name: '跑男', character: '', genre_ids: [10764], popularity: 40 },
        { media_type: 'tv', id: 44, name: '晚间新闻', character: '', genre_ids: [10763], popularity: 30 },
        { media_type: 'movie', id: 45, title: '纪录片', character: 'Herself', genre_ids: [99], popularity: 20 },
        { media_type: 'tv', id: 46, name: '第 60 届金马奖颁奖典礼', character: '', genre_ids: [], popularity: 10 },
        { media_type: 'tv', id: 47, name: '双重身份剧', character: 'Self - Guest', genre_ids: [18], popularity: 9 },
        { media_type: 'tv', id: 47, name: '双重身份剧', character: '王五', genre_ids: [18], popularity: 9 },
        { media_type: 'movie', id: 48, title: '穿越片', character: 'Young Self', genre_ids: [878], popularity: 8 },
        { media_type: 'tv', id: 49, name: '推理综艺', character: 'Yoo Jae Suk', genre_ids: [35, 9648], popularity: 7 },
        { media_type: 'tv', id: 50, name: '韩综', character: '유재석', genre_ids: [35], popularity: 6 },
      ] } });
    }
    return json(res, { results: [] });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  process.env.TMDB_BASE = `http://127.0.0.1:${port}/3`;
  process.env.TMDB_IMG_BASE = `http://127.0.0.1:${port}/t/p`;
});
after(() => { srv?.close(); db().close(); rmSync(home, { recursive: true, force: true }); });

test('无 key：全部返回空，不发请求、不抛', async () => {
  assert.equal(tmdb.hasKey(), false);
  assert.deepEqual(await tmdb.searchMulti('繁花'), []);
  assert.deepEqual(await tmdb.searchPerson('x'), []);
  assert.deepEqual(await tmdb.personCredits(1), []);
  assert.deepEqual(await tmdb.trending('tv'), []);
  assert.deepEqual(await tmdb.discover('tv', { region: 'HK' }), []);
  assert.equal(await tmdb.details('tv', 1), null);
  assert.equal(await tmdb.season(1, 1), null);
  assert.equal(hits.length, 0);
});

test('searchMulti：字段映射、过滤 person、第二次走缓存', async () => {
  setSetting('tmdb_key', 'k-test');
  assert.equal(tmdb.hasKey(), true);
  const r = await tmdb.searchMulti('繁花');
  assert.deepEqual(r[0], { type: 'tv', id: 106841, name: '繁花', originalName: '繁花', year: 2023, region: 'CN', poster: '/a.jpg', overview: '上海', popularity: 50.5, voteAverage: 8.1, voteCount: 0, genreIds: [] });
  assert.equal(r.length, 2);
  assert.equal(r[1].type, 'movie');
  assert.equal(r[1].name, '花样年华');
  assert.equal(r[1].originalName, '花樣年華');
  assert.equal(r[1].year, 2000);
  assert.equal(r[1].region, null);
  assert.equal(hits.at(-1).q.language, 'zh-CN');
  const n = hits.length;
  assert.deepEqual(await tmdb.searchMulti('繁花'), r);
  assert.equal(hits.length, n);
  assert.equal(db().prepare("SELECT COUNT(*) c FROM cache WHERE k LIKE '%k-test%'").get().c, 0); // api_key 不进缓存键
});

test('details：append_to_response、主演前 6、别名去重、简介回退 zh-TW -> zh-HK -> en-US', async () => {
  const d = await tmdb.details('tv', 1);
  const first = hits.find((h) => h.path === '/3/tv/1');
  assert.equal(first.q.append_to_response, 'alternative_titles,credits,translations');
  assert.equal(d.overview, 'English overview');
  assert.deepEqual(d.alternativeTitles, ['Alt A', 'Alt B']);
  assert.equal(d.cast.length, 6);
  assert.equal(d.region, 'KR');
  assert.deepEqual(d.seasons, [{ season: 1, name: '第 1 季', episodeCount: 12, airDate: '2020-01-01', poster: null }]);
  assert.deepEqual(hits.filter((h) => h.path === '/3/tv/1').map((h) => h.q.language), ['zh-CN', 'zh-TW', 'zh-HK', 'en-US']);
  const n = hits.length;
  await tmdb.details('tv', 1);
  assert.equal(hits.length, n);
});

test('details：translations 里的中文译名（zh-TW / zh-HK）并进别名，排在前面', async () => {
  const d = await tmdb.details('tv', 2);
  assert.deepEqual(d.alternativeTitles, ['弱美男英雄', 'Weak Hero', '弱小英雄']);
});

test('details 404 -> null；trending / discover / personCredits', async () => {
  assert.equal(await tmdb.details('tv', 404), null);
  assert.equal((await tmdb.trending('tv'))[0].type, 'tv');
  assert.equal(hits.some((h) => h.path === '/3/trending/tv/week'), true);
  const all = await tmdb.trending('all');
  assert.deepEqual(all.map((x) => x.id), [5]);
  const d = await tmdb.discover('tv', { region: 'hk', page: 2 });
  assert.equal(d[0].type, 'tv');
  const q = hits.findLast((h) => h.path === '/3/discover/tv').q;
  assert.equal(q.with_origin_country, 'HK');
  assert.equal(q.page, '2');
  assert.equal(q.sort_by, 'popularity.desc');
  const c = await tmdb.personCredits(3);
  assert.deepEqual(c.map((x) => x.id), [2, 1]);
});

test('personCredits：去掉综艺 / 脱口秀 / 新闻、本人出镜、颁奖礼；同一部有演戏的那条就留', async () => {
  const c = await tmdb.personCredits(4);
  assert.deepEqual(c.map((x) => x.id).sort(), [41, 47, 48]);
});

test('isActingCredit', () => {
  const ok = (r) => tmdb.isActingCredit(r);
  assert.equal(ok({ name: 'x', character: '许三多', genre_ids: [18] }), true);
  assert.equal(ok({ name: 'x', character: 'Young Self' }), true);
  for (const g of [10767, 10764, 10763]) assert.equal(ok({ name: 'x', character: 'A', genre_ids: [18, g] }), false);
  for (const c of ['Self', 'Himself', 'herself - Nominee', 'Self (archive footage)', 'Themselves', 'Host', '本人', '自己', '(himself)'])
    assert.equal(ok({ name: 'x', character: c }), false, c);
  for (const t of ['The 95th Academy Awards', 'Golden Globe Awards', '第 42 届香港电影金像奖颁奖典礼', '2024 春节联欢晚会'])
    assert.equal(ok({ name: t, character: '' }), false, t);
  // 不误伤：角色名以 Host 开头的角色、片名带「典礼 / Awards」但 TMDB 标了类型的正经作品
  assert.equal(ok({ name: 'x', character: 'Host Club Girl' }), true);
  assert.equal(ok({ name: 'x', character: 'Host - Season 2' }), false);
  assert.equal(ok({ name: '婚礼典礼', character: '新郎', genre_ids: [18, 35] }), true);
  assert.equal(ok({ title: 'The Awards Night', character: 'Jane', genre_ids: [18] }), true);
  // 角色名就是本人名字（含别名）= 本人出镜
  assert.equal(tmdb.isActingCredit({ name: 'x', character: 'Yoo Jae Suk' }, ['Yoo Jae-suk']), false);
  assert.equal(tmdb.isActingCredit({ name: 'x', character: 'Yoo Jae Suk' }, ['Someone Else']), true);
});

test('discover：kind / region 映射到出站查询参数', async () => {
  const last = () => hits.findLast((h) => h.path.startsWith('/3/discover/')).q;
  await tmdb.discover('tv', { region: 'west', kind: 'variety' });
  assert.equal(last().with_origin_country, 'US|GB');
  assert.equal(last().with_genres, '10764|10767');
  assert.equal(last().without_genres, '16,10762,10763'); // 综艺要脱口秀
  await tmdb.discover('tv', { region: 'kr', kind: 'doc' });
  assert.equal(last().with_origin_country, 'KR');
  assert.equal(last().with_genres, '99');
  assert.equal(last().without_genres, '16,10762,10763,10767');
  await tmdb.discover('tv', { region: 'th', kind: 'tv' });
  assert.equal(last().with_origin_country, 'TH');
  assert.equal(last().without_genres, '16,10762,10763,10767,10764,99');
  assert.equal(last()['vote_count.gte'], '20');
  assert.equal(last().with_genres, undefined);
  await tmdb.discover('movie', { region: 'jp', kind: 'movie' });
  assert.equal(last().with_genres, undefined);
  assert.equal(last().without_genres, '16,10762,10763,10767');
  assert.equal(last()['vote_count.gte'], '20');
});

test('recommendable：排除动画 / 少儿 / 新闻 / 脱口秀，评分人数 ≥ 20；keep 放行指定类型', () => {
  assert.deepEqual(tmdb.EXCLUDE_GENRES, [16, 10762, 10763, 10767]);
  assert.equal(tmdb.MIN_VOTES, 20);
  const ok = (genreIds, voteCount, opts) => tmdb.recommendable({ genreIds, voteCount }, opts);
  assert.equal(ok([18, 80], 20), true);
  assert.equal(ok([18], 19), false);
  assert.equal(ok([], undefined), false);
  for (const g of [16, 10762, 10763, 10767]) assert.equal(ok([18, g], 500), false, String(g));
  assert.equal(ok([10764, 10767], 50, { keep: [10767] }), true);
  assert.equal(ok([16, 10767], 50, { keep: [10767] }), false);
  assert.equal(ok([18], 5, { minVotes: tmdb.MIN_VOTES_LOW }), true);
  assert.equal(ok([18], 4, { minVotes: tmdb.MIN_VOTES_LOW }), false);
});

test('评分人数门槛按地区：港 / 台 ≥ 5，其余 ≥ 20；discover 出站参数跟着变', async () => {
  assert.equal(tmdb.MIN_VOTES_LOW, 5);
  for (const r of ['hk', 'HK', 'tw', 'TW']) assert.equal(tmdb.minVotesFor(r), 5, r);
  for (const r of ['cn', 'kr', 'west', 'US', '', undefined]) assert.equal(tmdb.minVotesFor(r), 20, String(r));
  const last = () => hits.findLast((h) => h.path.startsWith('/3/discover/')).q;
  await tmdb.discover('tv', { region: 'hk', kind: 'tv' });
  assert.equal(last()['vote_count.gte'], '5');
  await tmdb.discover('tv', { region: 'tw', kind: 'tv' });
  assert.equal(last()['vote_count.gte'], '5');
  await tmdb.discover('tv', { region: 'kr', kind: 'tv' });
  assert.equal(last()['vote_count.gte'], '20');
});

test('discover / trending：结果按推荐规则过滤；trending 原样返回、带页码', async () => {
  const d = await tmdb.discover('tv', { region: 'cn', kind: 'tv', page: 3 });
  assert.deepEqual(d.map((x) => x.id), [81]);
  const t = await tmdb.trending('all', 2);
  assert.equal(hits.findLast((h) => h.path === '/3/trending/all/week').q.page, '2');
  assert.deepEqual(t.map((x) => [x.id, tmdb.recommendable(x)]), [[91, false], [92, false], [93, true]]);
});

test('details：显示名 zh-CN 译名优先，没有就用 zh-TW / HK，再没有用原名', async () => {
  assert.equal((await tmdb.details('tv', 2)).name, '弱小英雄');
  assert.equal((await tmdb.details('tv', 3)).name, '終極名單');
  assert.equal((await tmdb.details('tv', 1)).name, '无简介');
  assert.equal((await tmdb.details('tv', 4)).name, '唐朝诡事录', '华语原作：简中译名空时用原名，不用繁中译名');
});

test('details：404 负缓存只留短 TTL', async () => {
  assert.equal(await tmdb.details('tv', 404), null);
  const e = db().prepare("SELECT expires_at e FROM cache WHERE k LIKE '%/tv/404%'").get().e;
  assert.ok(e - Date.now() / 1000 <= 605);
});

test('HTTP 错误会抛且不入缓存', async () => {
  setSetting('tmdb_key', 'bad');
  await assert.rejects(() => tmdb.searchMulti('错误'));
  assert.equal(db().prepare("SELECT COUNT(*) c FROM cache WHERE k LIKE '%错误%'").get().c, 0);
  setSetting('tmdb_key', 'k-test');
});

test('cached：命中不再调用、过期重取、并发合并、ttl 上限 180 天、失败不缓存', async () => {
  let n = 0;
  const f = async () => ++n;
  assert.equal(await cached('c1', 60, f), 1);
  assert.equal(await cached('c1', 60, f), 1);
  db().prepare("UPDATE cache SET expires_at = 1 WHERE k = 'c1'").run();
  assert.equal(await cached('c1', 60, f), 2);
  const [a, b] = await Promise.all([cached('c2', 60, f), cached('c2', 60, f)]);
  assert.equal(a, b);
  assert.equal(n, 3);
  await cached('c3', 10 * 365 * 86400, f);
  const exp = db().prepare("SELECT expires_at e FROM cache WHERE k = 'c3'").get().e;
  assert.ok(exp - Date.now() / 1000 <= 180 * 86400 + 5);
  await assert.rejects(() => cached('c4', 60, async () => { throw new Error('x'); }));
  assert.equal(db().prepare("SELECT COUNT(*) c FROM cache WHERE k = 'c4'").get().c, 0);
});

test('图片代理：白名单、落盘缓存、第二次不回源、超大拒绝、404', async () => {
  assert.equal((await getImage('w999', 'a.jpg')).status, 404);
  assert.equal((await getImage('w342', '../x.jpg')).status, 404);
  assert.equal((await getImage('w342', 'a.exe')).status, 404);
  const before = hits.length;
  const r = await getImage('w342', 'poster.png');
  assert.equal(r.status, 200);
  assert.equal(r.type, 'image/png');
  assert.deepEqual(r.body, png);
  assert.ok(existsSync(join(home, 'cache', 'img', 'w342', 'poster.png')));
  assert.equal(readdirSync(join(home, 'cache', 'img', 'w342')).some((f) => f.endsWith('.tmp')), false);
  assert.equal(hits.length, before + 1);
  assert.equal((await getImage('w342', 'poster.png')).status, 200);
  assert.equal(hits.length, before + 1);
  assert.equal((await getImage('w342', 'big.jpg')).status, 502);
  assert.equal(existsSync(join(home, 'cache', 'img', 'w342', 'big.jpg')), false);
  assert.equal((await getImage('w342', 'gone.jpg')).status, 404);
});

test('discoverParams：题材 / 电视台叠在剧集 / 电影上，综艺 / 纪录片不叠', () => {
  const p = (type, o) => tmdb.discoverParams(type, o).params;
  const a = p('tv', { region: 'cn', kind: 'tv', filter: { with_keywords: '4379' } });
  assert.equal(a.with_keywords, '4379');
  assert.equal(a['vote_count.gte'], tmdb.MIN_VOTES_LOW, '剧集按题材筛：评分人数门槛放低');
  assert.equal(a.without_keywords, tmdb.EXCLUDE_KEYWORDS.join(','), '情色关键词一律排除');
  assert.equal(p('tv', { region: 'cn', kind: 'tv' })['vote_count.gte'], tmdb.MIN_VOTES);
  assert.equal(p('movie', { region: 'cn', kind: 'movie', filter: { with_genres: '28' } })['vote_count.gte'], tmdb.MIN_VOTES, '电影不放低');
  assert.equal(a.without_genres, '16,10762,10763,10767,10764,99');
  const b = p('tv', { region: 'hk', kind: 'tv', filter: { with_genres: '80', with_networks: '48' } });
  assert.equal(b.with_genres, '80');
  assert.equal(b.with_networks, '48');
  const c = p('movie', { kind: 'movie', filter: { with_genres: '53|27' } });
  assert.equal(c.with_genres, '53|27');
  assert.equal(c.without_genres, '16,10762,10763,10767', '动画照样排除');
  const v = p('tv', { kind: 'variety', filter: { with_genres: '18', with_keywords: '1' } });
  assert.equal(v.with_genres, '10764|10767');
  assert.equal(v.with_keywords, undefined);
});

test('discoverParams：排序 / 年代', () => {
  const p = (type, o) => tmdb.discoverParams(type, o).params;
  const d0 = new Date();
  const today = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}-${String(d0.getDate()).padStart(2, '0')}`;
  const n = p('tv', { region: 'kr', kind: 'tv', sort: 'new' });
  assert.equal(n.sort_by, 'first_air_date.desc');
  assert.equal(n['first_air_date.lte'], today, '最新只看已经开播的');
  const m = p('movie', { kind: 'movie', sort: 'new', range: ['2010-01-01', '2019-12-31'] });
  assert.equal(m.sort_by, 'primary_release_date.desc');
  assert.equal(m['primary_release_date.gte'], '2010-01-01');
  assert.equal(m['primary_release_date.lte'], '2019-12-31');
  const s = p('tv', { region: 'cn', kind: 'tv', sort: 'score' });
  assert.equal(s.sort_by, 'vote_average.desc');
  assert.equal(s['vote_count.gte'], tmdb.SCORE_MIN_VOTES);
  assert.equal(p('tv', { region: 'hk', kind: 'tv', sort: 'score' })['vote_count.gte'], tmdb.SCORE_MIN_VOTES_LOW);
  assert.equal(p('tv', { region: 'cn', kind: 'tv', sort: 'score', filter: { with_keywords: '1' } })['vote_count.gte'], tmdb.SCORE_MIN_VOTES_LOW);
  const o = p('tv', { kind: 'tv', range: [null, '1999-12-31'] });
  assert.equal(o.sort_by, 'popularity.desc');
  assert.equal(o['first_air_date.gte'], undefined);
  assert.equal(o['first_air_date.lte'], '1999-12-31');
});

test('discover 带 totalPages；discoverCount 取 total_results 并缓存', async () => {
  const d = await tmdb.discover('tv', { region: 'cn', kind: 'tv', page: 3 });
  assert.equal(typeof d.totalPages, 'number');
  const before = hits.length;
  assert.equal(await tmdb.discoverCount('movie', { kind: 'movie', filter: { with_genres: '777' } }), 0);
  assert.equal(await tmdb.discoverCount('movie', { kind: 'movie', filter: { with_genres: '777' } }), 0);
  assert.equal(hits.length - before, 1, '第二次走缓存');
  assert.equal(hits.at(-1).q.with_genres, '777');
});

test('港产三级剥削片按 id 排除（分级 III ∩ 香港出品 ∩ 性暴力 / 情色关键词）；《黑社会》《恐怖角》不误伤', async () => {
  const d = await tmdb.discover('movie', { region: 'hk', kind: 'movie', filter: { with_genres: '53|27' } });
  assert.deepEqual(d.map((x) => x.id), [18747, 1598]);
  const q = hits.find((h) => h.q.certification === 'III').q;
  assert.equal(q.certification_country, 'HK');
  assert.equal(q.with_origin_country, 'HK');
  assert.ok(q.with_keywords.split('|').includes('41381'));
  assert.ok(hits.some((h) => h.q.certification === 'III' && h.q.page === '2'), '翻完所有页');
  assert.deepEqual([...(await tmdb.blockedMovieIds())].sort(), [221912, 45453].sort());
  const n = hits.filter((h) => h.q.certification === 'III').length;
  await tmdb.discover('movie', { region: 'hk', kind: 'movie', filter: { with_genres: '53|27' } });
  assert.equal(hits.filter((h) => h.q.certification === 'III').length, n, '片单走缓存');
  assert.deepEqual((await tmdb.searchMulti('羔羊')).map((x) => x.id), [1598], '搜索也去掉');
});

test('genreNames：zh-CN 下仍是英文的剧集类型按 id 换成中文，其余英文名不显示；zhCharacter：非中文角色名不显示', () => {
  assert.deepEqual(tmdb.genreNames([{ id: 18, name: '剧情' }, { id: 10765, name: 'Sci-Fi & Fantasy' }, { id: 99999, name: 'Weird' }, { id: 10768, name: 'War & Politics' }]),
    ['剧情', '科幻奇幻', '战争政治']);
  assert.deepEqual(tmdb.genreNames(undefined), []);
  assert.equal(tmdb.zhCharacter('Wei Rao'), '');
  assert.equal(tmdb.zhCharacter('Self'), '');
  assert.equal(tmdb.zhCharacter(' 魏娆 '), '魏娆');
  assert.equal(tmdb.zhCharacter(null), '');
});
