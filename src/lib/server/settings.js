/** 设置（setting 表）：键值都是字符串；value 传 null = 删除。 */
import { db } from './db.js';

/** @param {string} key @param {string} [def] @returns {string|undefined} */
export function getSetting(key, def) {
  const r = db().prepare('SELECT value FROM setting WHERE key = ?').get(key);
  return r?.value ?? def;
}

/** @param {string} key @param {string|null} value */
export function setSetting(key, value) {
  if (value == null) db().prepare('DELETE FROM setting WHERE key = ?').run(key);
  else db().prepare('INSERT INTO setting (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}
