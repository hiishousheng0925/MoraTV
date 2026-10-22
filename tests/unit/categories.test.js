import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapCategory } from '../../src/lib/server/cms/categories.js';

const cases = [
  ['国产剧', 'tv', 'cn'], ['大陆剧', 'tv', 'cn'], ['香港剧', 'tv', 'hk'], ['港剧', 'tv', 'hk'],
  ['台湾剧', 'tv', 'tw'], ['韩国剧', 'tv', 'kr'], ['日本剧', 'tv', 'jp'], ['泰国剧', 'tv', 'th'],
  ['欧美剧', 'tv', 'west'], ['美剧', 'tv', 'west'],
  ['大陆综艺', 'variety', 'cn'], ['综艺', 'variety', null], ['纪录片', 'doc', null],
  ['短剧', 'short', null], ['动漫', 'drop', null], ['国产动漫', 'drop', null],
  ['动作片', 'movie', null], ['喜剧片', 'movie', null], ['电影', 'movie', null],
  ['未知xx', 'other', null],
  ['连续剧', 'tv', null], ['电视剧', 'tv', null], ['港澳剧', 'tv', 'hk'], ['泰剧', 'tv', 'th'], ['马泰剧', 'tv', 'th'],
  ['内地剧', 'tv', 'cn'], ['美国剧', 'tv', 'west'], ['日韩综艺', 'variety', 'other'], ['港台综艺', 'variety', null],
  ['短剧大全', 'short', null], ['古装仙侠', 'short', null], ['预告片', 'drop', null], ['电影解说', 'drop', null],
  ['福利', 'drop', null], ['写真', 'drop', null], ['两性', 'drop', null], ['里番', 'drop', null], ['AI漫剧', 'drop', null], ['漫剧', 'drop', null], ['动态漫', 'drop', null],
  ['写真热舞', 'drop', null], ['两性课堂', 'drop', null],
  ['爽剧', 'short', null], ['女频', 'short', null], ['男频', 'short', null], ['甜宠短剧', 'short', null], ['年代穿越', 'short', null], ['脑洞悬疑', 'short', null], ['现代言情', 'short', null], ['女恋总裁', 'short', null], ['反转爽文', 'short', null], ['擦边短剧', 'drop', null], ['言情片', 'movie', null], ['女频恋爱', 'short', null],
  ['体育赛事', 'drop', null], ['伦理片', 'drop', null], ['记录片', 'doc', null], ['剧情片', 'movie', null],
];
for (const [name, kind, region] of cases) {
  test(`mapCategory(${name})`, () => assert.deepEqual(mapCategory(name), { kind, region }));
}
