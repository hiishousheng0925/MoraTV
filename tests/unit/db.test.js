import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// MORA_HOME 必须在 import 被测模块之前设好（paths.js 在模块加载时读它）；路径里带 test，满足「测试不碰真实用户目录」的检查
const home = mkdtempSync(join(tmpdir(), 'moratv-test-'));
process.env.MORA_HOME = home;

const { db } = await import('../../src/lib/server/db.js');
const { getSetting, setSetting } = await import('../../src/lib/server/settings.js');
const paths = await import('../../src/lib/server/paths.js');

after(() => { try { db().close(); } catch { /* 已关 */ } rmSync(home, { recursive: true, force: true }); });

test('paths 都落在 MORA_HOME 下', () => {
  assert.equal(paths.HOME, home);
  assert.equal(paths.DB_PATH, join(home, 'data', 'moratv.db'));
  assert.equal(paths.CACHE_DIR, join(home, 'cache'));
});

test('db() 首次调用建好全部表，并启用 WAL', () => {
  const names = db().prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
  for (const t of ['setting', 'site', 'title', 'progress', 'last_watch', 'favorite', 'line_pref', 'cache', 'schema_version'])
    assert.ok(names.includes(t), `缺表 ${t}`);
  assert.equal(db().prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  assert.equal(db(), db(), '单例');
});

test('重复迁移幂等，schema_version 不重复记', () => {
  const n = () => db().prepare('SELECT COUNT(*) AS n FROM schema_version').get().n;
  const before = n();
  return import('../../src/lib/server/migrate.js').then(({ migrate }) => { migrate(db()); migrate(db()); assert.equal(n(), before); });
});

test('setting 读写删', () => {
  assert.equal(getSetting('a'), undefined);
  assert.equal(getSetting('a', 'dflt'), 'dflt');
  setSetting('a', '1');
  assert.equal(getSetting('a'), '1');
  setSetting('a', '2');
  assert.equal(getSetting('a'), '2');
  setSetting('a', null);
  assert.equal(getSetting('a'), undefined);
});
