import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidates, candLabel, candParts, sameEp } from '../../src/lib/lines.js';
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

test('candLabel：不显示线路代号，显示「站点 · 线路 N」；条目显示名和作品名不同才带上；语言标签在最后', () => {
  // 服务端 decorate 给的：name 原名、title 显示名、lang 语言标签
  const [c] = candidates([{ ...src(1, 1, 'a', '繁花[沪语版]', [{ name: '360zy', episodes: eps(2) }]), title: '繁花', lang: '沪语' }]);
  assert.equal(candLabel(c, '繁花'), '站1 · 线路 1 · 沪语');
  assert.deepEqual(candParts(c, '繁花'), { text: '站1 · 线路 1', lang: '沪语' });
  assert.equal(c.line, '360zy', '线路偏好仍按内部线路名记');
  const [d] = candidates([{ ...src(1, 1, 'a', '繁花 第二季', [{ name: 'x', episodes: eps(2) }]), title: '繁花 第二季' }]);
  assert.equal(candLabel(d, '繁花'), '站1 · 线路 1 · 繁花 第二季');
  assert.equal(candLabel({ ...d, vodName: '繁 花' }, '繁花'), '站1 · 线路 1', '只差空白 / 标点不算不同');
});

test('candidates：线路 N 按条目里的线路顺序，和排序 / 偏好无关；线路名里的语言优先于条目名的', () => {
  const s = [src(1, 1, 'a', '无间道', [{ name: 'l1', episodes: eps(1) }, { name: 'l2', lang: '粤语', episodes: eps(3) }])];
  s[0].lang = '国语';
  const list = candidates(s, { siteId: 1, line: 'l1' });
  assert.deepEqual(list.map((c) => [c.line, c.lineNo, c.lang]), [['l1', 1, '国语'], ['l2', 2, '粤语']]);
  assert.deepEqual(candidates(s).map((c) => c.lineNo), [2, 1]);
});

test('candidates：降权的站（weight < 0）排最后，哪怕集数最全；手动选过的仍排第一', () => {
  const s = [
    { ...src(9, 50, 'a', '繁花', [{ name: '360zy', episodes: eps(30) }]), weight: -10 },
    src(1, 800, 'b', '繁花', [{ name: 'L1', episodes: eps(20) }]),
  ];
  assert.deepEqual(candidates(s).map((c) => c.siteId), [1, 9]);
  assert.deepEqual(candidates(s, { siteId: 9, line: '360zy' }).map((c) => c.siteId), [9, 1]);
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
