import { test } from 'node:test';
import assert from 'node:assert/strict';

const { normTitle, seasonOf, regionOfArea, regionOfCountry } = await import('../../src/lib/server/search/normalize.js');
const { variants } = await import('../../src/lib/server/search/variants.js');

test('normTitle：繁转简、去季、去空格标点、小写', () => {
  assert.equal(normTitle('慶餘年 第二季'), '庆余年');
  assert.equal(normTitle('庆余年第2季'), '庆余年');
  assert.equal(normTitle('庆余年2'), '庆余年');
  assert.equal(normTitle('庆余年 S2'), '庆余年');
  assert.equal(normTitle('请回答1988'), '请回答1988');
  assert.equal(normTitle('繁花（2023）'), '繁花');
  assert.equal(normTitle('繁花 2023'), '繁花');
  assert.equal(normTitle('溏心風暴 粤语版'), '溏心风暴');
  assert.equal(normTitle('新闻女王[国语版]'), '新闻女王');
  assert.equal(normTitle('黑暗·荣耀：第一部'), '黑暗荣耀');
  assert.equal(normTitle('The Glory Season 2'), 'theglory');
  assert.equal(normTitle('2046'), '2046');
  assert.equal(normTitle('庆余年第一季 特别版'), '庆余年');
  assert.equal(seasonOf('庆余年第一季 特别版'), 1);
  assert.equal(normTitle(''), '');
});

test('seasonOf', () => {
  assert.equal(seasonOf('慶餘年 第二季'), 2);
  assert.equal(seasonOf('庆余年2'), 2);
  assert.equal(seasonOf('庆余年 第十二季'), 12);
  assert.equal(seasonOf('鱿鱼游戏 S3'), 3);
  assert.equal(seasonOf('The Glory Season 2'), 2);
  assert.equal(seasonOf('2046'), null);
  assert.equal(seasonOf('请回答1988'), null);
  assert.equal(seasonOf('繁花2023'), null);
  assert.equal(seasonOf('繁花'), null);
});

test('地区映射', () => {
  assert.equal(regionOfArea('韩国'), 'kr');
  assert.equal(regionOfArea('中国大陆'), 'cn');
  assert.equal(regionOfArea('大陆'), 'cn');
  assert.equal(regionOfArea('中国香港'), 'hk');
  assert.equal(regionOfArea('美国'), 'west');
  assert.equal(regionOfArea(''), null);
  assert.equal(regionOfCountry('KR'), 'kr');
  assert.equal(regionOfCountry('GB'), 'west');
  assert.equal(regionOfCountry('IN'), 'other');
  assert.equal(regionOfCountry(null), null);
});

test('variants：原词 + 简体 + 繁体，去重', () => {
  const v = variants('溏心风暴');
  assert.ok(v.includes('溏心风暴'));
  assert.ok(v.includes('溏心風暴'));
  assert.equal(new Set(v).size, v.length);
  const t = variants('慶餘年');
  assert.ok(t.includes('庆余年'));
  assert.deepEqual(variants('  abc '), ['abc']);
  assert.deepEqual(variants(''), []);
});

const norm = await import('../../src/lib/server/search/normalize.js');

test('normRoman：Ⅰ–Ⅹ 和中文片名里的 II / III 转阿拉伯数字；纯英文片名不动', () => {
  assert.equal(norm.normRoman('无间道Ⅲ：终极无间'), '无间道3：终极无间');
  assert.equal(norm.normRoman('無間道III: 終極無間'), '無間道3: 終極無間');
  assert.equal(norm.normRoman('无间道 III - 终极无间'), '无间道 3 - 终极无间');
  assert.equal(norm.normRoman('少年包青天Ⅲ之天芒传奇'), '少年包青天3之天芒传奇');
  assert.equal(norm.normRoman('无间道ⅲ'), '无间道3');
  assert.equal(norm.normRoman('Rocky II'), 'Rocky II');
  assert.equal(norm.normRoman('VIP'), 'VIP');
});

test('normTitle / seasonOf 认罗马数字', () => {
  assert.equal(normTitle('无间道Ⅲ：终极无间'), normTitle('无间道3：终极无间'));
  assert.equal(seasonOf('少年包青天Ⅲ'), 3);
  assert.equal(normTitle('少年包青天Ⅲ'), '少年包青天');
});

test('stripPartSubtitle：「片名N：副标题」「片名之副标题」→ 片名 + 分部号', () => {
  assert.deepEqual(norm.stripPartSubtitle('创世纪1：地产风云国语'), { base: '创世纪', part: 1 });
  assert.deepEqual(norm.stripPartSubtitle('創世紀2：天地有情'), { base: '创世纪', part: 2 });
  assert.deepEqual(norm.stripPartSubtitle('HIStory3-圈套'), { base: 'HIStory', part: 3 });
  assert.deepEqual(norm.stripPartSubtitle('HIStory5: 遇见未来的你'), { base: 'HIStory', part: 5 });
  assert.deepEqual(norm.stripPartSubtitle('少年包青天Ⅲ之天芒传奇'), { base: '少年包青天', part: 3 });
  assert.deepEqual(norm.stripPartSubtitle('少年包青天 第三部：天芒传奇'), { base: '少年包青天', part: 3 });
  assert.deepEqual(norm.stripPartSubtitle('大军师司马懿之军师联盟'), { base: '大军师司马懿', part: null });
  assert.deepEqual(norm.stripPartSubtitle('终结者：创世纪'), { base: '终结者', part: null });
  assert.equal(norm.stripPartSubtitle('繁花'), null);
  assert.equal(norm.stripPartSubtitle('之后'), null);
});

test('regionsOfArea：多地区全收；「中国香港」不算大陆', () => {
  assert.deepEqual(norm.regionsOfArea('中国大陆 / 美国'), ['cn', 'west']);
  assert.deepEqual(norm.regionsOfArea('中国台湾 / 中国大陆'), ['tw', 'cn']);
  assert.deepEqual(norm.regionsOfArea('中国香港'), ['hk']);
  assert.deepEqual(norm.regionsOfArea(''), []);
});
