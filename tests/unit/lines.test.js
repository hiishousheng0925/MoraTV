import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidates, candLabel, sameEp } from '../../src/lib/lines.js';
import { posterUrl } from '../../src/lib/work.js';
import { isFinished } from '../../src/lib/progress.js';

const eps = (n, p = '第') => Array.from({ length: n }, (_, i) => ({ name: `${p}${i + 1}集`, url: `https://x.test/${p}${i}.m3u8` }));
const src = (siteId, latency, vodId, name, lines) => ({ siteId, siteName: `站${siteId}`, latency, vodId, name, lines });

test('candidates：集数最全优先，同集数按延迟；手动选过的排第一；空线路丢掉', () => {
  const s = [
    src(1, 800, 'a', '繁花', [{ name: 'L1', episodes: eps(30) }]),
    src(2, 200, 'b', '繁花', [{ name: 'L2', episodes: eps(30) }, { name: 'empty', episodes: [] }]),
    src(3, 100, 'c', '繁花', [{ name: 'L3', episodes: eps(10) }]),
  ];
  assert.deepEqual(candidates(s).map((c) => c.line), ['L2', 'L1', 'L3']);
  assert.deepEqual(candidates(s, { siteId: 3, line: 'L3' }).map((c) => c.line), ['L3', 'L2', 'L1']);
  assert.deepEqual(candidates(s, { siteId: 9, line: 'x' }).map((c) => c.line), ['L2', 'L1', 'L3'], '偏好不存在时不影响');
});

test('candLabel：条目名和作品名不同才带上', () => {
  const [c] = candidates([src(1, 1, 'a', '繁花[沪语版]', [{ name: '360zy', episodes: eps(2) }])]);
  assert.equal(candLabel(c, '繁花'), '站1 · 360zy · 繁花[沪语版]');
  assert.equal(candLabel({ ...c, vodName: '繁花' }, '繁花'), '站1 · 360zy');
});

test('sameEp：先按集名，再按下标，越界 -1', () => {
  const list = [{ name: '预告' }, ...eps(3)];
  assert.equal(sameEp(list, '第2集', 0), 2);
  assert.equal(sameEp(list, '不存在', 1), 1);
  assert.equal(sameEp(list, '不存在', 9), -1);
});

test('posterUrl：TMDB 路径走本地代理，完整地址原样，协议相对补 https', () => {
  assert.equal(posterUrl('/abc.jpg'), '/img/w342/abc.jpg');
  assert.equal(posterUrl('http://img.x.com/a.jpg'), 'http://img.x.com/a.jpg');
  assert.equal(posterUrl('//img.x.com/a.jpg'), 'https://img.x.com/a.jpg');
  assert.equal(posterUrl(''), null);
});

test('isFinished（共用定义）', () => {
  assert.equal(isFinished(2830, 3000), true);
  assert.equal(isFinished(10, 120), false);
});
