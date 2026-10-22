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
  catch { return readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'); }
}

const SCHEMA = await loadSchema();

/** version 必须从 1 连续递增 */
export const STEPS = [
  { version: 1, sql: SCHEMA }
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
