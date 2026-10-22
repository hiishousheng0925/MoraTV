-- MoraTV 数据库（node:sqlite）。这是第 1 版的完整建表；以后的改动写成 migrate.js 里新的一步，不要改这里。

-- 设置：tmdb_key / llm_base / llm_key / llm_model 等
CREATE TABLE IF NOT EXISTS setting (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- 资源站（苹果 CMS）
CREATE TABLE IF NOT EXISTS site (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  api          TEXT NOT NULL UNIQUE,
  enabled      INTEGER NOT NULL DEFAULT 1,
  weight       INTEGER NOT NULL DEFAULT 0,
  last_ok_at   INTEGER,
  last_fail_at INTEGER,
  fail_streak  INTEGER NOT NULL DEFAULT 0,
  latency_ms   INTEGER,
  builtin      INTEGER NOT NULL DEFAULT 0
);

-- 作品缓存（TMDB 或资源站）。key = tv-<tmdbId> / movie-<tmdbId> / cms-<siteId>-<vodId>
CREATE TABLE IF NOT EXISTS title (
  key           TEXT PRIMARY KEY,
  tmdb_type     TEXT,
  tmdb_id       INTEGER,
  name          TEXT NOT NULL,
  original_name TEXT,
  year          INTEGER,
  region        TEXT,
  kind          TEXT,
  poster        TEXT,
  overview      TEXT,
  json          TEXT,
  fetched_at    INTEGER
);
CREATE INDEX IF NOT EXISTS title_tmdb ON title (tmdb_type, tmdb_id);

-- 观看进度（season / episode 电影填 0 / 1）
CREATE TABLE IF NOT EXISTS progress (
  title_key  TEXT NOT NULL,
  season     INTEGER NOT NULL,
  episode    INTEGER NOT NULL,
  ep_name    TEXT,
  position   REAL NOT NULL DEFAULT 0,
  duration   REAL NOT NULL DEFAULT 0,
  site_id    INTEGER,
  line       TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (title_key, season, episode)
);

-- 「继续观看」：每部作品最近看到哪一集
CREATE TABLE IF NOT EXISTS last_watch (
  title_key  TEXT PRIMARY KEY,
  season     INTEGER NOT NULL,
  episode    INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS last_watch_time ON last_watch (updated_at DESC);

-- 想看
CREATE TABLE IF NOT EXISTS favorite (
  title_key TEXT PRIMARY KEY,
  added_at  INTEGER NOT NULL
);

-- 用户手动选过的线路（按作品记住）
CREATE TABLE IF NOT EXISTS line_pref (
  title_key TEXT PRIMARY KEY,
  site_id   INTEGER NOT NULL,
  line      TEXT NOT NULL
);

-- TMDB / 资源站响应缓存
CREATE TABLE IF NOT EXISTS cache (
  k          TEXT PRIMARY KEY,
  v          TEXT,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cache_exp ON cache (expires_at);
