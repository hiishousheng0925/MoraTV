import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// MORA_HOME 必须在 import 被测模块之前设好（paths.js 在模块加载时读它）
const home = mkdtempSync(join(tmpdir(), 'moratv-test-'));
process.env.MORA_HOME = home;

const { db } = await import('../../src/lib/server/db.js');
const lib = await import('../../src/lib/server/library.js');

after(() => { try { db().close(); } catch { /* 已关 */ } rmSync(home, { recursive: true, force: true }); });

const work = (key, name) => ({ key, type: 'tv', name, originalName: '', year: 2023, region: 'cn', kind: 'tv', poster: '/abc.jpg', overview: '' });

test('isFinished：≥90% 或剩余 <180 秒', () => {
  assert.equal(lib.isFinished(2700, 3000), true);
  assert.equal(lib.isFinished(1000, 3000), false);
  assert.equal(lib.isFinished(2830, 3000), true); // 剩余 170 秒
  assert.equal(lib.isFinished(0, 0), false);
  assert.equal(lib.isFinished(10, 120), false, '短片刚开始不算看完');
});

test('saveProgress 后 continueList()[0] 是该作品；同作品第二集后 last.episode===2', () => {
  lib.saveTitle(work('tv-1', '繁花'));
  lib.saveTitle(work('tv-2', '漫长的季节'));
  lib.saveProgress({ key: 'tv-2', season: 1, episode: 1, epName: '第01集', position: 50, duration: 2700, siteId: 1, line: 'm3u8' });
  lib.saveProgress({ key: 'tv-1', season: 1, episode: 1, epName: '第01集', position: 300, duration: 2700, siteId: 1, line: 'm3u8' });
  const list = lib.continueList();
  assert.equal(list[0].key, 'tv-1');
  assert.equal(list[0].title.name, '繁花');
  assert.equal(list[0].episode, 1);
  assert.equal(list[0].position, 300);

  lib.saveProgress({ key: 'tv-1', season: 1, episode: 2, epName: '第02集', position: 60, duration: 2700, siteId: 1, line: 'm3u8' });
  const p = lib.getProgress('tv-1');
  assert.equal(p.last.episode, 2);
  assert.equal(p.last.position, 60);
  assert.equal(p.episodes.length, 2);
  assert.equal(lib.continueList().filter((x) => x.key === 'tv-1').length, 1, '同一作品只出现一次');
});

test('history 分页，removeHistory 后不在列表，clearHistory 清空', () => {
  const h = lib.history({ page: 1 });
  assert.ok(h.total >= 2);
  assert.ok(h.items.some((x) => x.key === 'tv-2'));
  lib.removeHistory('tv-2');
  assert.ok(!lib.continueList().some((x) => x.key === 'tv-2'));
  assert.ok(!lib.history({ page: 1 }).items.some((x) => x.key === 'tv-2'));
  assert.equal(lib.getProgress('tv-2').last, null);
  lib.clearHistory();
  assert.equal(lib.continueList().length, 0);
});

test('想看开关与线路偏好', () => {
  assert.equal(lib.toggleFavorite('tv-9', work('tv-9', '黑暗荣耀')), true);
  assert.equal(lib.isFavorite('tv-9'), true);
  assert.equal(lib.favorites()[0].title.name, '黑暗荣耀');
  assert.equal(lib.toggleFavorite('tv-9'), false);
  assert.equal(lib.favorites().length, 0);

  assert.equal(lib.getLinePref('tv-9'), null);
  lib.setLinePref('tv-9', 3, 'ffm3u8');
  assert.deepEqual(lib.getLinePref('tv-9'), { siteId: 3, line: 'ffm3u8' });
});
