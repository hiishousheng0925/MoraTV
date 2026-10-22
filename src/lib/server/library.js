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

/* ---------- 跨 key 别名（cms-… → tv-/movie-…） ---------- */

/** 别名解析：cms- 作品已经匹配到 TMDB 作品时返回 TMDB 的 key，否则原样返回 */
export function resolveKey(key) {
  return aliasOf(key)?.key ?? String(key || '');
}

/**
 * cms 页面 307 到 TMDB 页面时的查询串：别名带季号（多季剧的某一季）时把 ?s= 改成那一季（集号不变）。
 * @param {string} search url.search（含 ?，可为空）
 * @returns {string}
 */
export function aliasRedirectSearch(key, search) {
  const al = aliasOf(key);
  const q = new URLSearchParams(search || '');
  if (al?.season != null && q.has('s')) q.set('s', String(al.season));
  const out = q.toString();
  return out ? '?' + out : '';
}

/** @returns {{key: string, season: number|null}|null} */
function aliasOf(key) {
  const k = String(key || '');
  if (!k.startsWith('cms-')) return null;
  return db().prepare('SELECT key, season FROM key_alias WHERE alias = ?').get(k) ?? null;
}

/**
 * 把 from 名下的进度 / 最近观看 / 想看 / 线路偏好并进 to，然后清掉 from 的这些行（title 缓存行保留）。
 * 同一集两边都有进度时留 updated_at 较新的；last_watch 同理；想看留较早的加入时间；线路偏好 to 已有则不动。幂等。
 * 调用方负责事务。
 */
function mergeKeys(from, to, season = null) {
  const d = db();
  for (const r of d.prepare('SELECT * FROM progress WHERE title_key = ?').all(from)) {
    const sn = season ?? r.season;
    const o = d.prepare('SELECT updated_at FROM progress WHERE title_key = ? AND season = ? AND episode = ?').get(to, sn, r.episode);
    if (o && o.updated_at >= r.updated_at) continue;
    d.prepare(`INSERT INTO progress (title_key, season, episode, ep_name, position, duration, site_id, line, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(title_key, season, episode) DO UPDATE SET ep_name = excluded.ep_name, position = excluded.position,
                 duration = excluded.duration, site_id = excluded.site_id, line = excluded.line, updated_at = excluded.updated_at`)
      .run(to, sn, r.episode, r.ep_name, r.position, r.duration, r.site_id, r.line, r.updated_at);
  }
  const lw = d.prepare('SELECT * FROM last_watch WHERE title_key = ?').get(from);
  if (lw) {
    const o = d.prepare('SELECT updated_at FROM last_watch WHERE title_key = ?').get(to);
    if (!o || o.updated_at < lw.updated_at) {
      d.prepare(`INSERT INTO last_watch (title_key, season, episode, updated_at) VALUES (?, ?, ?, ?)
                 ON CONFLICT(title_key) DO UPDATE SET season = excluded.season, episode = excluded.episode, updated_at = excluded.updated_at`)
        .run(to, season ?? lw.season, lw.episode, lw.updated_at);
    }
  }
  const fav = d.prepare('SELECT added_at FROM favorite WHERE title_key = ?').get(from);
  if (fav) {
    const o = d.prepare('SELECT added_at FROM favorite WHERE title_key = ?').get(to);
    if (!o) d.prepare('INSERT INTO favorite (title_key, added_at) VALUES (?, ?)').run(to, fav.added_at);
    else if (fav.added_at < o.added_at) d.prepare('UPDATE favorite SET added_at = ? WHERE title_key = ?').run(fav.added_at, to);
  }
  const lp = d.prepare('SELECT site_id, line FROM line_pref WHERE title_key = ?').get(from);
  if (lp) d.prepare('INSERT OR IGNORE INTO line_pref (title_key, site_id, line) VALUES (?, ?, ?)').run(to, lp.site_id, lp.line);
  for (const t of ['progress', 'last_watch', 'favorite', 'line_pref']) d.prepare(`DELETE FROM ${t} WHERE title_key = ?`).run(from);
}

/**
 * 登记「cms 作品 = TMDB 作品」并把已有的记录并过去。alias 必须是 cms-…，key 必须是 tv-/movie-…；已登记过的不改（先到先得）。
 * season：TMDB 多季剧里该 cms 作品对应的季（并进来时 cms 记录的季号改成它）；单季 / 电影不传。
 * @returns {boolean} 是否发生了新登记
 */
export function registerAlias(alias, key, season = null) {
  if (!/^cms-\d+-.+$/.test(alias || '') || !/^(tv|movie)-\d+$/.test(key || '')) return false;
  const d = db();
  if (d.prepare('SELECT 1 FROM key_alias WHERE alias = ?').get(alias)) return false;
  const sn = season == null ? null : Number(season);
  d.exec('BEGIN');
  try {
    d.prepare('INSERT INTO key_alias (alias, key, season) VALUES (?, ?, ?)').run(alias, key, sn);
    mergeKeys(alias, key, sn);
    d.exec('COMMIT');
  } catch (e) { d.exec('ROLLBACK'); throw e; }
  return true;
}

const brief = (r) => ({ name: r.name ?? '', poster: r.poster ?? null, year: r.year ?? null, region: r.region ?? null, kind: r.kind ?? null });

/* ---------- 进度 ---------- */

const mapProg = (r) => ({
  season: r.season, episode: r.episode, epName: r.ep_name ?? '', position: r.position, duration: r.duration,
  siteId: r.site_id ?? null, line: r.line ?? null, updatedAt: r.updated_at, finished: isFinished(r.position, r.duration),
});

/** 写一集的进度，同时把这部作品记成「最近看到这一集」 */
export function saveProgress({ key: rawKey, season = 1, episode, epName = '', position = 0, duration = 0, siteId = null, line = null }) {
  const al = aliasOf(rawKey);
  const key = al?.key ?? rawKey;
  if (al?.season != null) season = al.season;
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
export function getProgress(rawKey) {
  const d = db();
  const key = resolveKey(rawKey);
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

export function removeHistory(rawKey) {
  const key = resolveKey(rawKey);
  db().prepare('DELETE FROM progress WHERE title_key = ?').run(key);
  db().prepare('DELETE FROM last_watch WHERE title_key = ?').run(key);
}

export function clearHistory() {
  db().exec('DELETE FROM progress; DELETE FROM last_watch;');
}

/* ---------- 想看 ---------- */

export function isFavorite(rawKey) {
  const key = resolveKey(rawKey);
  return !!db().prepare('SELECT 1 FROM favorite WHERE title_key = ?').get(key);
}

/** 切换想看；传了 work 顺带写进 title 表（列表要用片名 / 海报）。@returns {boolean} 切换后的状态 */
export function toggleFavorite(rawKey, work) {
  const key = resolveKey(rawKey);
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

export function setLinePref(rawKey, siteId, line) {
  const key = resolveKey(rawKey);
  db().prepare(`INSERT INTO line_pref (title_key, site_id, line) VALUES (?, ?, ?)
                ON CONFLICT(title_key) DO UPDATE SET site_id = excluded.site_id, line = excluded.line`).run(key, Number(siteId), String(line));
}

/** @returns {{siteId: number, line: string}|null} */
export function getLinePref(rawKey) {
  const key = resolveKey(rawKey);
  const r = db().prepare('SELECT site_id, line FROM line_pref WHERE title_key = ?').get(key);
  return r ? { siteId: r.site_id, line: r.line } : null;
}
