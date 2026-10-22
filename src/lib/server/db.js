/**
 * SQLite 单例（node:sqlite）。首次调用时建目录、开库、WAL、跑迁移。
 * 库路径只来自 paths.js。
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { DATA_DIR, DB_PATH } from './paths.js';
import { migrate } from './migrate.js';

let inst = null;

/** @returns {DatabaseSync} */
export function db() {
  if (inst) return inst;
  mkdirSync(DATA_DIR, { recursive: true });
  const d = new DatabaseSync(DB_PATH);
  d.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;');
  migrate(d);
  inst = d;
  return d;
}
