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

import { cleanName, langOf } from '../../src/lib/server/cms/parse.js';

test('cleanName：版本后缀变成 lang 标签，名字只留片名', () => {
  assert.deepEqual(cleanName('繁花普通话版'), { title: '繁花', lang: '国语' });
  assert.deepEqual(cleanName('繁花国语版'), { title: '繁花', lang: '国语' });
  assert.deepEqual(cleanName('使徒行者粤语版'), { title: '使徒行者', lang: '粤语' });
  assert.deepEqual(cleanName('使徒行者 粤语'), { title: '使徒行者', lang: '粤语' });
  assert.deepEqual(cleanName('繁花[沪语版]'), { title: '繁花', lang: '沪语' });
  assert.deepEqual(cleanName('无间道（国语）'), { title: '无间道', lang: '国语' });
  assert.deepEqual(cleanName('寄生虫原声版'), { title: '寄生虫', lang: '原声' });
  assert.deepEqual(cleanName('杨家将国语刘德华版'), { title: '杨家将', lang: '国语' });
  assert.deepEqual(cleanName('鹿鼎记国粤双语版'), { title: '鹿鼎记', lang: '双语' });
});

test('cleanName：去掉 $ 及其后的串、首尾空白和多余标点', () => {
  assert.deepEqual(cleanName('庆余年，全世界都以为我是废物太子$庆余年之大凉太子爷'), { title: '庆余年，全世界都以为我是废物太子', lang: null });
  assert.deepEqual(cleanName('  繁花 - '), { title: '繁花', lang: null });
  assert.deepEqual(cleanName('繁花（）'), { title: '繁花', lang: null });
  assert.deepEqual(cleanName('繁花  第二季'), { title: '繁花 第二季', lang: null });
});

test('cleanName：不该动的不动', () => {
  assert.deepEqual(cleanName('无间道3：终极无间'), { title: '无间道3：终极无间', lang: null });
  assert.deepEqual(cleanName('导演剪辑版'), { title: '导演剪辑版', lang: null });
  assert.deepEqual(cleanName('粤语'), { title: '粤语', lang: null }, '整串就是语言词：保留');
  assert.deepEqual(cleanName('刘德华版杨家将'), { title: '刘德华版杨家将', lang: null });
  assert.deepEqual(cleanName('苍兰诀（动画版）'), { title: '苍兰诀（动画版）', lang: null });
  assert.deepEqual(cleanName(''), { title: '', lang: null });
  assert.deepEqual(cleanName(undefined), { title: '', lang: null });
});

test('langOf：线路名里的语言词', () => {
  assert.equal(langOf('粤语m3u8'), '粤语');
  assert.equal(langOf('国语'), '国语');
  assert.equal(langOf('lzm3u8'), null);
  assert.equal(langOf(''), null);
});

test('cleanName：中英双语、$ 开头、半角句点', () => {
  assert.deepEqual(cleanName('某某 中英双语版'), { title: '某某', lang: '双语' });
  assert.deepEqual(cleanName('$繁花'), { title: '繁花', lang: null });
  assert.deepEqual(cleanName('V.I.P.'), { title: 'V.I.P.', lang: null });
  assert.deepEqual(cleanName('繁花。'), { title: '繁花', lang: null });
});
