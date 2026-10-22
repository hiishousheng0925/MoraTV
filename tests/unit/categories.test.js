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
  ['内地剧', 'tv', 'cn'], ['美国剧', 'tv', 'west'], ['日韩综艺', 'variety', 'other'], ['港台综艺', 'variety', 'hk'],
  ['短剧大全', 'short', null], ['古装仙侠', 'short', null], ['预告片', 'drop', null], ['电影解说', 'drop', null],
  ['体育赛事', 'drop', null], ['伦理片', 'drop', null], ['记录片', 'doc', null], ['剧情片', 'movie', null],
];
for (const [name, kind, region] of cases) {
  test(`mapCategory(${name})`, () => assert.deepEqual(mapCategory(name), { kind, region }));
}
