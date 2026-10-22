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

test('迁移第 3 步：老库里内置且仍是缺省权重的 360资源降权；用户加的 / 改过的不动', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { STEPS, migrate } = await import('../../src/lib/server/migrate.js');
  const d = new DatabaseSync(':memory:');
  d.exec('CREATE TABLE schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  for (const s of STEPS.filter((s) => s.version < 3)) { d.exec(s.sql); d.prepare('INSERT INTO schema_version VALUES (?, 0)').run(s.version); }
  const API = 'https://360zy.com/api.php/provide/vod';
  d.prepare('INSERT INTO site (name, api, builtin) VALUES (?, ?, 1)').run('360资源', API);
  d.prepare('INSERT INTO site (name, api, builtin) VALUES (?, ?, 1)').run('量子资源', 'https://a.test/api');
  d.prepare('INSERT INTO site (name, api, builtin) VALUES (?, ?, 0)').run('自己加的', 'https://b.test/api');
  migrate(d);
  const w = (api) => d.prepare('SELECT weight FROM site WHERE api = ?').get(api).weight;
  assert.equal(w(API), -10);
  assert.equal(w('https://a.test/api'), 0);
  assert.equal(w('https://b.test/api'), 0);
  // 用户改过权重的不覆盖（步骤只跑一次，这里直接重放 SQL 验证条件）
  d.prepare('UPDATE site SET weight = 5 WHERE api = ?').run(API);
  d.exec(STEPS.find((s) => s.version === 3).sql);
  assert.equal(w(API), 5);
});

test('首次启动写入的内置站点带缺省权重（360资源最低）', async () => {
  const { listSites } = await import('../../src/lib/server/cms/sites.js');
  const list = listSites();
  const s360 = list.find((s) => s.api.includes('360zy'));
  assert.ok(s360 && s360.weight < 0);
  assert.equal(list.at(-1).id, s360.id, '站点列表按权重排，360 在最后');
});
