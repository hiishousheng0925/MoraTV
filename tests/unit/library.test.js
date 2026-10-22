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

/* ---------- 跨 key 别名 ---------- */

test('cms 下的进度，登记别名后在 tv key 下取得到；继续观看只有一条（TMDB 版信息）', () => {
  lib.clearHistory();
  lib.saveTitle({ ...work('cms-2-123', '繁花（资源站名）'), poster: '/cms.jpg' });
  lib.saveProgress({ key: 'cms-2-123', season: 1, episode: 3, epName: '第03集', position: 600, duration: 2700, siteId: 2, line: 'm3u8' });
  lib.toggleFavorite('cms-2-123', work('cms-2-123', '繁花（资源站名）'));
  lib.setLinePref('cms-2-123', 2, 'm3u8');
  assert.equal(lib.getProgress('tv-456').last, null);

  lib.saveTitle(work('tv-456', '繁花'));
  assert.equal(lib.registerAlias('cms-2-123', 'tv-456'), true);
  assert.equal(lib.registerAlias('cms-2-123', 'tv-456'), false, '重复登记不再动');

  const p = lib.getProgress('tv-456');
  assert.equal(p.last.episode, 3);
  assert.equal(p.last.position, 600);
  const list = lib.continueList();
  assert.equal(list.length, 1);
  assert.equal(list[0].key, 'tv-456');
  assert.equal(list[0].title.name, '繁花');
  assert.equal(list[0].position, 600);
  assert.equal(lib.getProgress('cms-2-123').last.episode, 3, 'cms key 读到的也是合并后的');

  assert.equal(lib.isFavorite('tv-456'), true);
  assert.deepEqual(lib.favorites().map((f) => f.key), ['tv-456']);
  assert.deepEqual(lib.getLinePref('tv-456'), { siteId: 2, line: 'm3u8' });
  assert.equal(lib.resolveKey('cms-2-123'), 'tv-456');
  assert.equal(lib.resolveKey('cms-9-9'), 'cms-9-9');

  // 页面没刷新、还在往 cms key 写：落到 tv key 上
  lib.saveProgress({ key: 'cms-2-123', season: 1, episode: 4, epName: '第04集', position: 5, duration: 2700 });
  assert.equal(lib.getProgress('tv-456').last.episode, 4);
  assert.equal(lib.continueList().length, 1);
  assert.equal(db().prepare("SELECT COUNT(*) AS n FROM progress WHERE title_key LIKE 'cms-%'").get().n, 0);
  lib.toggleFavorite('cms-2-123');
  assert.equal(lib.isFavorite('tv-456'), false, '别名上切换想看作用在 tv key');
});

test('两边同一集都有进度：留 updated_at 较新的；last_watch / 想看 / 线路偏好的取舍', () => {
  lib.clearHistory();
  const d = db();
  const ins = (k, ep, pos, t) => d.prepare('INSERT INTO progress (title_key, season, episode, ep_name, position, duration, updated_at) VALUES (?, 1, ?, ?, ?, 3000, ?)').run(k, ep, `E${ep}`, pos, t);
  const lw = (k, ep, t) => d.prepare('INSERT INTO last_watch (title_key, season, episode, updated_at) VALUES (?, 1, ?, ?)').run(k, ep, t);
  // 第 1 集：cms 更新；第 2 集：tv 更新；第 3 集只有 cms
  ins('cms-1-5', 1, 111, 2000); ins('tv-77', 1, 999, 1000);
  ins('cms-1-5', 2, 222, 1500); ins('tv-77', 2, 888, 3000);
  ins('cms-1-5', 3, 333, 1800);
  lw('cms-1-5', 3, 1800); lw('tv-77', 2, 3000);
  d.prepare('INSERT INTO favorite (title_key, added_at) VALUES (?, ?)').run('cms-1-5', 100);
  d.prepare('INSERT INTO favorite (title_key, added_at) VALUES (?, ?)').run('tv-77', 500);
  d.prepare('INSERT INTO line_pref (title_key, site_id, line) VALUES (?, ?, ?)').run('cms-1-5', 1, 'a');
  d.prepare('INSERT INTO line_pref (title_key, site_id, line) VALUES (?, ?, ?)').run('tv-77', 2, 'b');
  lib.saveTitle(work('tv-77', '某剧'));
  lib.registerAlias('cms-1-5', 'tv-77');

  const p = lib.getProgress('tv-77');
  const pos = Object.fromEntries(p.episodes.map((e) => [e.episode, e.position]));
  assert.deepEqual(pos, { 1: 111, 2: 888, 3: 333 });
  assert.equal(p.last.episode, 2, '较新的 last_watch 赢');
  assert.equal(d.prepare('SELECT added_at FROM favorite WHERE title_key = ?').get('tv-77').added_at, 100, '想看留较早的加入时间');
  assert.deepEqual(lib.getLinePref('tv-77'), { siteId: 2, line: 'b' }, 'tv 已有的线路偏好不被覆盖');
  assert.equal(lib.continueList().length, 1);
});

test('多季剧：cms 作品按登记的季号并进去（不串到第 1 季）', () => {
  lib.clearHistory();
  lib.saveProgress({ key: 'cms-3-8', season: 1, episode: 2, epName: 'E2', position: 70, duration: 2000 });
  lib.saveTitle(work('tv-88', '多季剧'));
  lib.registerAlias('cms-3-8', 'tv-88', 3);
  const p = lib.getProgress('tv-88');
  assert.deepEqual(p.episodes.map((e) => [e.season, e.episode]), [[3, 2]]);
  assert.equal(p.last.season, 3);
  lib.saveProgress({ key: 'cms-3-8', season: 1, episode: 5, position: 1, duration: 2000 });
  assert.deepEqual(lib.getProgress('tv-88').episodes.map((e) => [e.season, e.episode]), [[3, 2], [3, 5]]);
});

test('registerAlias 拒绝形态不对的参数', () => {
  assert.equal(lib.registerAlias('tv-1', 'tv-2'), false);
  assert.equal(lib.registerAlias('cms-1-2', 'cms-1-3'), false);
  assert.equal(lib.resolveKey('tv-1'), 'tv-1');
});

test('迁移：已有数据的 v1 库升到 v2 后数据不丢、重复迁移幂等', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { migrate, STEPS } = await import('../../src/lib/server/migrate.js');
  const d = new DatabaseSync(':memory:');
  d.exec('CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  d.exec(STEPS[0].sql);
  d.prepare('INSERT INTO schema_version VALUES (1, 0)').run();
  d.prepare("INSERT INTO progress (title_key, season, episode, position, duration, updated_at) VALUES ('cms-1-1', 1, 1, 50, 100, 7)").run();
  d.prepare("INSERT INTO favorite (title_key, added_at) VALUES ('tv-1', 9)").run();
  migrate(d); migrate(d);
  assert.equal(d.prepare('SELECT COUNT(*) AS n FROM progress').get().n, 1);
  assert.equal(d.prepare('SELECT added_at FROM favorite').get().added_at, 9);
  assert.equal(d.prepare('SELECT COUNT(*) AS n FROM key_alias').get().n, 0);
  assert.deepEqual(d.prepare('SELECT version FROM schema_version ORDER BY version').all().map((r) => r.version), [1, 2]);
  d.close();
});

test('cms 页面重定向的查询串：多季别名把 ?s= 改成登记的季，集号不动；无季别名原样', () => {
  lib.registerAlias('cms-4-1', 'tv-91', 2);
  lib.registerAlias('cms-4-2', 'tv-92');
  assert.equal(lib.aliasRedirectSearch('cms-4-1', '?s=1&e=5'), '?s=2&e=5');
  assert.equal(lib.aliasRedirectSearch('cms-4-1', '?e=5'), '?e=5', '没带 s 不加');
  assert.equal(lib.aliasRedirectSearch('cms-4-1', ''), '');
  assert.equal(lib.aliasRedirectSearch('cms-4-2', '?s=1&e=5'), '?s=1&e=5');
  assert.equal(lib.aliasRedirectSearch('tv-1', '?s=1'), '?s=1');
});
