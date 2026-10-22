/**
 * 顺序迁移：schema_version 记已经跑过的步骤，启动时（db() 首次调用）只补没跑过的。
 * 第 1 步 = schema.sql 的完整建表。以后改表结构：在 STEPS 末尾追加一步，version 递增，不要改已发布的步骤。
 *
 * schema.sql 的读法：vite 构建时靠 `?raw` 打进产物（adapter-node 产物里没有源码目录）；
 * 直接用 node 跑（单元测试）时 `?raw` 解析不了，退回按相对路径读文件。
 */
import { readFileSync } from 'node:fs';

async function loadSchema() {
  try { return (await import('./schema.sql?raw')).default; }
  catch (e) {
    // 只吞「node 直接跑时 ?raw 解析不了」这一种；其它错误（schema.sql 里的语法问题、构建产物损坏）照常抛出
    if (e?.code !== 'ERR_MODULE_NOT_FOUND' && e?.code !== 'ERR_UNKNOWN_FILE_EXTENSION') throw e;
    return readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  }
}

const SCHEMA = await loadSchema();

/** version 必须从 1 连续递增 */
export const STEPS = [
  { version: 1, sql: SCHEMA },
  // 0.1.2：season 非空 = 该 cms 作品是 TMDB 多季剧里的这一季（并进来时 cms 进度的季号改成它）；cms-<站>-<id> 作品匹配到 TMDB 作品后登记别名，进度 / 想看 / 线路偏好跨 key 合并（见 library.js registerAlias）
  { version: 2, sql: `CREATE TABLE IF NOT EXISTS key_alias (
      alias TEXT PRIMARY KEY,
      key   TEXT NOT NULL,
      season INTEGER
    );
    CREATE INDEX IF NOT EXISTS key_alias_key ON key_alias (key);` }
];

export function migrate(d) {
  d.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const done = new Set(d.prepare('SELECT version FROM schema_version').all().map((r) => r.version));
  for (const s of STEPS) {
    if (done.has(s.version)) continue;
    d.exec('BEGIN');
    try {
      d.exec(s.sql);
      d.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(s.version, Date.now());
      d.exec('COMMIT');
    } catch (e) { d.exec('ROLLBACK'); throw e; }
  }
}
