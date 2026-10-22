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
