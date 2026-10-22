/**
 * 片库：观看进度、继续观看、观看历史、想看、线路偏好；外加作品缓存（title 表）的读写。
 * 纯数据库操作，不发网络请求。
 */
import { db } from './db.js';
import { isFinished } from '../progress.js';

/** 严格递增的毫秒时间戳：同一毫秒里连写两条时「最近」的顺序仍然确定 */
let lastStamp = 0;
const now = () => (lastStamp = Math.max(Date.now(), lastStamp + 1));

/** 看完判定的唯一定义在 $lib/progress.js（播放页也用），这里转出 */
export { isFinished };

/* ---------- 作品缓存（title 表） ---------- */

/** 把 Work 写进 title 表（json 存整份，列里存列表页要用的字段） */
export function saveTitle(work) {
  if (!work?.key || !work.name) return;
  const tmdbId = work.tmdb?.id ?? (/^(tv|movie)-(\d+)$/.exec(work.key)?.[2] ?? null);
  db().prepare(`INSERT INTO title (key, tmdb_type, tmdb_id, name, original_name, year, region, kind, poster, overview, json, fetched_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET tmdb_type = excluded.tmdb_type, tmdb_id = excluded.tmdb_id, name = excluded.name,
                  original_name = excluded.original_name, year = excluded.year, region = excluded.region, kind = excluded.kind,
                  poster = excluded.poster, overview = excluded.overview, json = excluded.json, fetched_at = excluded.fetched_at`)
    .run(work.key, work.tmdb ? work.type : null, tmdbId == null ? null : Number(tmdbId), work.name, work.originalName || null,
      work.year ?? null, work.region ?? null, work.kind ?? null, work.poster ?? null, work.overview || null,
      JSON.stringify(work), now());
}

/** @returns {{work: any, fetchedAt: number}|null} */
export function loadTitle(key) {
  const r = db().prepare('SELECT json, fetched_at FROM title WHERE key = ?').get(key);
  if (!r) return null;
  try { return { work: JSON.parse(r.json), fetchedAt: r.fetched_at }; } catch { return null; }
}

const brief = (r) => ({ name: r.name ?? '', poster: r.poster ?? null, year: r.year ?? null, region: r.region ?? null, kind: r.kind ?? null });

/* ---------- 进度 ---------- */

const mapProg = (r) => ({
  season: r.season, episode: r.episode, epName: r.ep_name ?? '', position: r.position, duration: r.duration,
  siteId: r.site_id ?? null, line: r.line ?? null, updatedAt: r.updated_at, finished: isFinished(r.position, r.duration),
});

/** 写一集的进度，同时把这部作品记成「最近看到这一集」 */
export function saveProgress({ key, season = 1, episode, epName = '', position = 0, duration = 0, siteId = null, line = null }) {
  if (!key || !Number.isFinite(+episode)) throw Object.assign(new Error('参数无效'), { status: 400 });
  const t = now(), s = Number(season) || 0, e = Number(episode);
  const d = db();
  d.exec('BEGIN');
  try {
  d.prepare(`INSERT INTO progress (title_key, season, episode, ep_name, position, duration, site_id, line, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(title_key, season, episode) DO UPDATE SET ep_name = excluded.ep_name, position = excluded.position,
               duration = excluded.duration, site_id = excluded.site_id, line = excluded.line, updated_at = excluded.updated_at`)
    .run(key, s, e, String(epName || ''), Math.max(0, +position || 0), Math.max(0, +duration || 0), siteId == null ? null : Number(siteId), line == null ? null : String(line), t);
  d.prepare(`INSERT INTO last_watch (title_key, season, episode, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(title_key) DO UPDATE SET season = excluded.season, episode = excluded.episode, updated_at = excluded.updated_at`)
    .run(key, s, e, t);
  d.exec('COMMIT');
  } catch (err) { d.exec('ROLLBACK'); throw err; }
}

/** 该作品所有集的进度 + 最近看的那一集（last，没有为 null） */
export function getProgress(key) {
  const d = db();
  const episodes = d.prepare('SELECT * FROM progress WHERE title_key = ? ORDER BY season, episode').all(key).map(mapProg);
  const lw = d.prepare('SELECT season, episode FROM last_watch WHERE title_key = ?').get(key);
  const last = lw ? episodes.find((p) => p.season === lw.season && p.episode === lw.episode) ?? null : null;
  return { episodes, last };
}

const WATCH_SQL = `SELECT lw.title_key AS key, lw.season, lw.episode, lw.updated_at, p.ep_name, p.position, p.duration,
                          t.name, t.poster, t.year, t.region, t.kind
                   FROM last_watch lw
                   LEFT JOIN progress p ON p.title_key = lw.title_key AND p.season = lw.season AND p.episode = lw.episode
                   LEFT JOIN title t ON t.key = lw.title_key
                   ORDER BY lw.updated_at DESC`;

const mapWatch = (r) => ({
  key: r.key, season: r.season, episode: r.episode, epName: r.ep_name ?? '', position: r.position ?? 0, duration: r.duration ?? 0,
  updatedAt: r.updated_at, finished: isFinished(r.position, r.duration), title: brief(r),
});

/** 「继续观看」：每部作品一条，按最近时间 */
export function continueList(limit = 20) {
  return db().prepare(`${WATCH_SQL} LIMIT ?`).all(limit).map(mapWatch);
}

/** 观看历史（分页） */
export function history({ page = 1, per = 30 } = {}) {
  const total = db().prepare('SELECT COUNT(*) AS n FROM last_watch').get().n;
  const pages = Math.max(1, Math.ceil(total / per));
  const p = Math.min(pages, Math.max(1, Math.floor(+page) || 1));
  const items = db().prepare(`${WATCH_SQL} LIMIT ? OFFSET ?`).all(per, (p - 1) * per).map(mapWatch);
  return { items, total, page: p, pages };
}

export function removeHistory(key) {
  db().prepare('DELETE FROM progress WHERE title_key = ?').run(key);
  db().prepare('DELETE FROM last_watch WHERE title_key = ?').run(key);
}

export function clearHistory() {
  db().exec('DELETE FROM progress; DELETE FROM last_watch;');
}

/* ---------- 想看 ---------- */

export function isFavorite(key) {
  return !!db().prepare('SELECT 1 FROM favorite WHERE title_key = ?').get(key);
}

/** 切换想看；传了 work 顺带写进 title 表（列表要用片名 / 海报）。@returns {boolean} 切换后的状态 */
export function toggleFavorite(key, work) {
  if (isFavorite(key)) {
    db().prepare('DELETE FROM favorite WHERE title_key = ?').run(key);
    return false;
  }
  if (work) saveTitle({ ...work, key });
  db().prepare('INSERT INTO favorite (title_key, added_at) VALUES (?, ?)').run(key, now());
  return true;
}

export function favorites() {
  return db().prepare(`SELECT f.title_key AS key, f.added_at, t.name, t.poster, t.year, t.region, t.kind
                       FROM favorite f LEFT JOIN title t ON t.key = f.title_key ORDER BY f.added_at DESC`).all()
    .map((r) => ({ key: r.key, addedAt: r.added_at, title: brief(r) }));
}

/* ---------- 线路偏好 ---------- */

export function setLinePref(key, siteId, line) {
  db().prepare(`INSERT INTO line_pref (title_key, site_id, line) VALUES (?, ?, ?)
                ON CONFLICT(title_key) DO UPDATE SET site_id = excluded.site_id, line = excluded.line`).run(key, Number(siteId), String(line));
}

/** @returns {{siteId: number, line: string}|null} */
export function getLinePref(key) {
  const r = db().prepare('SELECT site_id, line FROM line_pref WHERE title_key = ?').get(key);
  return r ? { siteId: r.site_id, line: r.line } : null;
}
