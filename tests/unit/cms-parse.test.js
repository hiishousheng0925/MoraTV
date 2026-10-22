import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlay, normalizeVod } from '../../src/lib/server/cms/parse.js';

test('parsePlay: 只保留 m3u8 线路，分集解析', () => {
  const r = parsePlay('lzm3u8$$$lzyun', '第01集$https://a/1.m3u8#第02集$https://a/2.m3u8$$$第01集$https://b/share/x');
  assert.equal(r.length, 1);
  assert.equal(r[0].name, 'lzm3u8');
  assert.deepEqual(r[0].episodes, [
    { name: '第01集', url: 'https://a/1.m3u8' },
    { name: '第02集', url: 'https://a/2.m3u8' },
  ]);
});

test('parsePlay: 集名缺失用第N集；尾部空项忽略', () => {
  const r = parsePlay('x', 'https://a/1.m3u8#https://a/2.m3u8#');
  assert.deepEqual(r[0].episodes.map((e) => e.name), ['第1集', '第2集']);
});

test('parsePlay: 线路名含 m3u8 即保留；带查询串的 .m3u8 也算；其余丢弃', () => {
  const r = parsePlay('abm3u8$$$ok$$$bad', '正片$https://a/play?id=1$$$正片$https://a/x.m3u8?t=1$$$正片$https://a/share');
  assert.deepEqual(r.map((l) => l.name), ['abm3u8', 'ok']);
});

test('parsePlay: 空输入', () => {
  assert.deepEqual(parsePlay('', ''), []);
  assert.deepEqual(parsePlay(undefined, undefined), []);
});

test('normalizeVod', () => {
  const v = normalizeVod({
    vod_id: 7, vod_name: ' 繁花 ', vod_year: '2023', vod_area: '中国大陆', type_name: '国产剧',
    vod_pic: 'http://p/1.jpg', vod_actor: '胡歌,马伊琍， 唐嫣', vod_director: '王家卫',
    vod_content: '<p>简介&nbsp;内容</p>', vod_remarks: '更新至30集',
    vod_play_from: 'lzm3u8', vod_play_url: '第01集$https://a/1.m3u8',
  }, 3);
  assert.equal(v.siteId, 3); assert.equal(v.vodId, '7'); assert.equal(v.name, '繁花');
  assert.equal(v.year, 2023);
  assert.deepEqual(v.category, { kind: 'tv', region: 'cn' });
  assert.deepEqual(v.actors, ['胡歌', '马伊琍', '唐嫣']);
  assert.equal(v.overview, '简介 内容');
  assert.equal(v.lines.length, 1);
  assert.equal(normalizeVod({ vod_id: 1, vod_name: 'a', vod_year: '' }, 1).year, null);
});
