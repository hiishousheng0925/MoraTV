# MoraTV MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 可用的 MoraTV Windows 客户端：多资源站聚合搜索（片名 / 演员 / 剧情）+ TMDB 元数据 + 去广告播放 + 本地进度 + 推荐。

**Architecture:** 新建仓库，复制改造 MoraAnime 的 Electron 外壳与通用 UI；SvelteKit(adapter-node) 子进程在 127.0.0.1 提供页面和 /api；数据层（node:sqlite、苹果 CMS、TMDB、m3u8 代理去广告、LLM 剧情搜索）全部重写。

**Tech Stack:** Node ≥22.15（本机 24.11）、SvelteKit ^2.20、Svelte 5 runes、Vite ^6、Tailwind ^4、hls.js ^1.7.3、phosphor-svelte 3.1.0、opencc-js（MIT）、Electron 44.9.3、electron-builder 26.15.3、`node --test`。

**Spec:** `docs/superpowers/specs/2026-10-22-moratv-design.md`（每个任务开始前先读相关章节）

## Global Constraints

- 只做 Windows；界面简体中文；预算 0（不引入付费服务）。
- 操作反馈只走 toast；不写教学式说明文字；不用 Windows 原生弹窗（`dialog.showMessageBox` 禁用）。
- 仓库不得含个人信息：真名、公司邮箱、`C:\Users\<名字>`、Tailscale IP（100.64–127.x）/ 域名、上游网站 GitHub 账号。参考代码里出现的本机路径一律改掉。
- 杀进程只按 PID；测试时 `MORA_HOME` 必须指向临时目录（路径含 tmp/temp/test）。
- 不复制 AGPL / CC BY-NC-SA 项目（LibreTV、zyfun、LunaTV）的代码，只按 spec 描述的思路自写。
- 数据路径只走 `src/lib/server/paths.js`；`+page.server.js` 只导出 `load` / `actions` 等 SvelteKit 认可的名字；从 `$props()` 派生的值用 `$derived`。
- **子代理不要执行 git commit / push**，由主会话统一提交。只改自己任务列出的文件，避免并行冲突。
- MoraAnime 源在 `D:\hiish\software\MoraAnime`，**只读**，不得修改。

## Review Focus

1. 资源站超时 / 返回 HTML 或非 JSON / `code!=1` → 该站静默跳过，整体搜索仍返回其他站结果（Task 2 测试）。
2. 同名不同作（韩剧《黑暗荣耀》2022 vs 同名国产短剧）→ 两张卡，不合并（Task 4 测试）。
3. 正片本身含多个 DISCONTINUITY（无广告）→ 一个分片都不删（Task 5 测试）。
4. 没填 TMDB key / LLM key → 搜索仍可用，首页无推荐排、剧情模式 toast 提示，不报 500（Task 3、6、7 测试）。
5. m3u8 代理收到内网 / 本机地址（127.0.0.1、10.x、192.168.x、100.64/10）→ 拒绝 403（Task 5 测试）。

---

### Task 1: 脚手架 + 桌面外壳 + 数据库

**Files:**
- Create: `package.json`、`svelte.config.js`、`vite.config.js`、`.gitignore`、`src/app.html`、`src/app.css`、`src/routes/+layout.svelte`、`src/routes/+page.svelte`（占位）、`src/routes/api/health/+server.js`
- Create: `src/lib/server/paths.js`、`src/lib/server/db.js`、`src/lib/server/schema.sql`、`src/lib/server/migrate.js`、`src/lib/server/settings.js`
- Copy+adapt from MoraAnime: `src/lib/ui/*`（spec §4 列出的通用组件 + toast / theme 相关 js）、`desktop/{main.js,guard.mjs,preload.cjs,build.js,update.html,release-notes.json,package.json,icon.svg}`、`tools/make-icon.js`
- Create: `CLAUDE.md`（给后续 agent 的说明：结构、启动顺序、规则；不含个人信息）
- Test: `tests/unit/db.test.js`

**Interfaces:**
- Produces:
  - `paths.js`: `export const HOME: string`（`MORA_HOME` 或 `%APPDATA%\MoraTV`）、`export const DATA_DIR`、`export const DB_PATH`（`<HOME>\data\moratv.db`）、`export const CACHE_DIR`（`<HOME>\cache`）
  - `db.js`: `export function db(): DatabaseSync`（单例，首次调用时跑 migrate，`PRAGMA journal_mode=WAL`）
  - `settings.js`: `getSetting(key: string, def?: string): string|undefined`、`setSetting(key: string, value: string|null): void`
  - `schema.sql`：spec §9 全部表。
  - UI：`import { toast } from '$lib/ui/toast.svelte.js'`（沿用 MoraAnime 的 API 名，若原名不同以原名为准并在 CLAUDE.md 记录）；`Player.svelte` props 保持 MoraAnime 原样并在 CLAUDE.md 记录。

- [ ] **Step 1:** 写 `tests/unit/db.test.js`：设 `MORA_HOME` 为临时目录，`db()` 后 `sqlite_master` 含 `setting site title progress last_watch favorite line_pref cache`；`setSetting('a','1')` 后 `getSetting('a')==='1'`；`setSetting('a',null)` 后为 `undefined`。
- [ ] **Step 2:** `node --test tests/unit/db.test.js` → FAIL。
- [ ] **Step 3:** 实现 paths / db / schema / migrate / settings。
- [ ] **Step 4:** 测试 PASS。
- [ ] **Step 5:** 复制改造 UI 组件和 desktop/：去掉 catalog、db-tasks、账号 bootstrap、cookie 注入、Anime4K、playwright；appId `com.mora.tv`、productName `MoraTV`、库路径改 `moratv.db`、环境变量前缀保持 `MORA_`；自动更新受 `MORA_UPDATE=1` 开关控制，缺省关闭；新图标配色（与 MoraAnime 不同）。布局：顶栏（品牌 MoraTV、首页 / 浏览 / 片库 / 设置、搜索入口、主题切换）+ Toaster。
- [ ] **Step 6:** 验证：`npm install && npm --prefix desktop install && node desktop/build.js`，再用 `MORA_HOME=<临时目录>` 运行打包产物或 `node desktop/build.js --run`，`/api/health` 返回 `{ok:true}`，窗口显示首页占位。贴出命令输出。
- [ ] **Step 7:** 个人信息自查：`git grep -nIiE "hiish|C:\\\\Users\\\\|100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.|snsoft|020925"` 无输出（主会话提交前也会再查）。

### Task 2: 苹果 CMS 资源站层

**Files:**
- Create: `src/lib/server/cms/parse.js`、`cms/categories.js`、`cms/sites.default.js`、`cms/client.js`、`cms/sites.js`、`src/lib/server/net.js`（`assertPublic`、带超时 fetch、并发限制，参考 MoraAnime `scrape.js` / `limit.js`）
- Test: `tests/unit/cms-parse.test.js`、`tests/unit/categories.test.js`、`tests/unit/cms-client.test.js`

**Interfaces:**
- Consumes: Task 1 `db()`。
- Produces:
  - `parse.js`: `parsePlay(from: string, url: string): Line[]`，`Line = { name: string, episodes: {name: string, url: string}[] }`，只保留 m3u8 线路；`normalizeVod(raw, siteId): Vod`，`Vod = { siteId, vodId, name, year: number|null, area, typeName, category: Category, pic, actors: string[], director, overview, remarks, lines: Line[] }`
  - `categories.js`: `mapCategory(typeName: string): Category`，`Category = { kind: 'tv'|'movie'|'variety'|'doc'|'short'|'drop'|'other', region: 'cn'|'hk'|'tw'|'kr'|'jp'|'th'|'west'|'other'|null }`
  - `client.js`: `searchSite(site, keyword, {timeoutMs=8000}): Promise<Vod[]>`（只取第 1 页）、`detailSite(site, ids: (string|number)[]): Promise<Vod[]>`、`listCategories(site)`
  - `sites.js`: `listSites({enabledOnly}): Site[]`、`addSite({name, api})`、`updateSite(id, patch)`、`removeSite(id)`、`recordResult(id, ok: boolean, latencyMs)`、`testSite(site): Promise<{ok, latencyMs, total}>`、`searchAll(keyword): Promise<Vod[]>`（并发全部启用站点，失败记 `fail_streak`，按 weight/fail_streak 排序）；首次启动把 `sites.default.js` 写入 `site` 表（`builtin=1`）
  - `net.js`: `assertPublic(url: string): Promise<void>`（解析 DNS，拒绝 loopback / 私网 / 100.64.0.0/10 / link-local，抛错带 `status=403`）、`fetchWithTimeout(url, opts, ms)`、`pLimit(n)`

- [ ] **Step 1:** 测试：`parsePlay('lzm3u8$$$lzyun', '第01集$https://a/1.m3u8#第02集$https://a/2.m3u8$$$第01集$https://b/share/x')` → 1 条线路 `lzm3u8`、2 集；集名缺失（`https://a/1.m3u8`）时集名为 `第1集`；尾部 `#` 空项被忽略。`mapCategory('国产剧')→{kind:'tv',region:'cn'}`、`'香港剧'→hk`、`'韩国剧'→kr`、`'欧美剧'→west`、`'动作片'→{kind:'movie'}`、`'大陆综艺'→variety`、`'短剧'→short`、`'动漫'→drop`、`'未知xx'→other`。`searchSite` 对本地 http 测试服务返回的 HTML / `code:0` / 超时 → 返回 `[]` 不抛；`searchAll` 一站失败另一站成功 → 返回成功站结果。
- [ ] **Step 2:** 跑测试 FAIL → 实现 → PASS。
- [ ] **Step 3:** 实测 `sites.default.js` 里每个站：用 `testSite` 跑一遍，只留能用的，表格贴出 名称 / 延迟 / 总量。至少保留 3 个。

### Task 3: TMDB 层 + 缓存 + 图片代理

**Files:**
- Create: `src/lib/server/cache.js`、`src/lib/server/tmdb.js`、`src/routes/img/[...path]/+server.js`
- Test: `tests/unit/tmdb.test.js`

**Interfaces:**
- Consumes: Task 1 `db()`、`getSetting('tmdb_key')`、`CACHE_DIR`；Task 2 `fetchWithTimeout`。
- Produces:
  - `cache.js`: `cached(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T>`（存 `cache` 表；ttl 上限 180 天）
  - `tmdb.js`（无 key 时所有函数返回 `null` / `[]`，不抛）: `hasKey(): boolean`、`searchMulti(q): Promise<TmdbItem[]>`、`searchPerson(q): Promise<Person[]>`、`personCredits(id): Promise<TmdbItem[]>`、`details(type:'tv'|'movie', id): Promise<TmdbDetail|null>`（含 `alternative_titles`、`credits` 主演前 6、`seasons`，`append_to_response` 一次取）、`season(id, n)`、`trending(type, )`、`discover(type, {region, page})`；`TmdbItem = { type, id, name, originalName, year, region, poster, overview, popularity, voteAverage }`；语言 zh-CN，简介为空回退 zh-TW→en-US。TTL：详情 7 天，榜单 12 小时。
  - `/img/<size>/<file>`：代理 `https://image.tmdb.org/t/p/<size>/<file>`，磁盘缓存到 `CACHE_DIR/img`，size 白名单 `w185 w342 w500 w780 original`。

- [ ] **Step 1:** 测试：无 key 时 `searchMulti('繁花')` 返回 `[]`；用本地假 TMDB 服务（`TMDB_BASE` 环境变量覆盖）验证字段映射、zh-TW 回退、`cached` 第二次不发请求。
- [ ] **Step 2:** FAIL → 实现 → PASS。
- [ ] **Step 3:** 若环境变量 `TMDB_KEY` 存在，实测 `searchMulti('繁花')` 首条 id 为 106841。没有 key 则跳过并说明。

### Task 4: 聚合搜索（片名 / 演员）

**Files:**
- Create: `src/lib/server/search/normalize.js`、`search/variants.js`、`search/aggregate.js`、`src/routes/api/search/+server.js`
- Test: `tests/unit/normalize.test.js`、`tests/unit/aggregate.test.js`

**Interfaces:**
- Consumes: Task 2 `searchAll`、`Vod`；Task 3 `searchMulti`、`details`、`searchPerson`、`personCredits`、`hasKey`。
- Produces:
  - `normalize.js`: `normTitle(s): string`（繁转简、去空格标点、去「第X季 / 第X部 / SX / 年份后缀 / 国语版 / 粤语版」，小写）、`seasonOf(s): number|null`（「第二季」→2、「庆余年2」→2）
  - `variants.js`: `variants(q): string[]`（原词 + 简体 + 繁体，去重；用 opencc-js）
  - `aggregate.js`: `searchTitles(q): Promise<Work[]>`、`searchActor(q): Promise<{persons: Person[], works: Work[]}>`、`findSources(work: Work, season?: number): Promise<Vod[]>`；`Work = { key: string /* tv-123 | movie-123 | cms-<siteId>-<vodId> */, type, name, originalName, year, region, kind, poster, overview, tmdb: TmdbItem|null, sources: Vod[], available: boolean }`。聚类：`normTitle` 相同且年份差 ≤1（任一方年份缺失时只靠标题 + 地区）；TMDB 匹配：标题或别名 `normTitle` 相同 + 年份差 ≤1，地区一致加分。
  - `GET /api/search?q=&mode=title|actor` → `{ works: Work[], persons?: Person[] }`

- [ ] **Step 1:** 测试：`normTitle('慶餘年 第二季')==='庆余年'`、`seasonOf('慶餘年 第二季')===2`、`seasonOf('庆余年2')===2`、`seasonOf('2046')===null`；`variants('溏心风暴')` 含 `溏心風暴`。aggregate 用注入的假 `searchAll` / tmdb（模块提供 `_setDeps` 测试钩子）：①同站不同年的《黑暗荣耀》（2022 韩国 / 2023 内地短剧）→ 2 个 Work；②两站同名同年 → 1 个 Work、`sources.length===2`；③TMDB 有、资源站无 → `available:false` 排最后；④一个 Work 被别名命中（TMDB 别名「家好月圆」）→ 二轮搜索被调用。
- [ ] **Step 2:** FAIL → 实现 → PASS。

### Task 5: m3u8 代理 + 去广告

**Files:**
- Create: `src/lib/server/stream/adfilter.js`、`stream/proxy.js`、`src/routes/api/stream/+server.js`
- Test: `tests/unit/adfilter.test.js`、`tests/unit/stream.test.js`、`tests/fixtures/m3u8/*.m3u8`

**Interfaces:**
- Consumes: Task 2 `assertPublic`、`fetchWithTimeout`。
- Produces:
  - `adfilter.js`: `filterAds(playlistText: string): { text: string, removed: { groups: number, seconds: number } }`（spec §6.4 规则 A/B/C；master playlist 原样返回）
  - `proxy.js`: `proxyPlaylist(url: string): Promise<string>`（拉取、master 则把子 playlist 改写为 `/api/stream?u=<encoded>`，media 则 `filterAds` 后把相对分片地址改成绝对地址，`#EXT-X-KEY` 的 URI 改写为经代理）；分片由浏览器直连。
  - `GET /api/stream?u=<url>` → `application/vnd.apple.mpegurl`；内网地址 403；上游失败 502。响应头 `X-Ads-Removed: <groups>`。

- [ ] **Step 1:** 测试 fixtures：`intro-ad.m3u8`（首组 15 秒 5 片、域名不同）→ 删 1 组；`url-ad.m3u8`（中间组 URL 含 `/adjump/`）→ 删 1 组；`clean.m3u8`（无 DISCONTINUITY）→ 不变；`multi-part.m3u8`（正片 3 组、每组 > 10 分钟、同前缀）→ 不删；删组后总分片数和 `#EXT-X-ENDLIST` 正确、删掉组前的 DISCONTINUITY 也删除。stream：`u=http://127.0.0.1/x.m3u8` → 403、`u=http://192.168.1.1/x` → 403、`u=http://100.100.1.1/x` → 403。
- [ ] **Step 2:** FAIL → 实现 → PASS。
- [ ] **Step 3:** 实测：从 Task 2 的缺省站搜 10 部热门剧，取第 1 集 m3u8 跑 `filterAds`，表格贴出 片名 / 站点 / 删除组数 / 删除秒数；人工抽看删掉的分片 URL 是否像广告，报告误删数。

### Task 6: 剧情搜索（LLM）

**Files:**
- Create: `src/lib/server/search/plot.js`；Modify: `src/routes/api/search/+server.js`（加 `mode=plot`）
- Test: `tests/unit/plot.test.js`

**Interfaces:**
- Consumes: `getSetting('llm_base'|'llm_key'|'llm_model')`（缺省 base `https://integrate.api.nvidia.com/v1`）；Task 3 `searchMulti`；Task 4 `searchTitles`。
- Produces: `searchPlot(desc: string): Promise<{ works: Work[], guesses: {name, year, region, reason}[] }>`；无 key 时抛 `{status: 400, code: 'NO_LLM_KEY'}`，API 返回 400 `{error:'NO_LLM_KEY'}`。LLM 要求只输出 JSON 数组（最多 5 项），解析失败时用正则抓第一个 `[...]`；候选逐个经 `searchTitles(name)` 取年份最接近的 Work。

- [ ] **Step 1:** 测试：注入假 LLM（返回带 markdown 围栏的 JSON）→ 正确解析；返回垃圾 → `works: []` 不抛；无 key → 抛 `NO_LLM_KEY`。
- [ ] **Step 2:** FAIL → 实现 → PASS。
- [ ] **Step 3:** 实测（环境变量 `LLM_KEY` 存在时，**不写进任何文件**）：在 NIM 上试 2–3 个模型，5 段剧情描述（如「一个律师被同事陷害后重生回到十年前复仇的韩剧」等，自拟，答案已知），表格贴出每个模型的第一候选命中数和平均耗时；把最好的模型写进缺省 `llm_model`。

### Task 7: 页面

**Files:**
- Create: `src/routes/+page.svelte` / `+page.server.js`（首页）、`src/routes/search/*`、`src/routes/title/[key]/*`、`src/routes/title/[key]/watch/*`、`src/routes/library/*`、`src/routes/browse/*`、`src/routes/settings/*`
- Create: `src/lib/server/library.js`、`src/lib/server/works.js`；API：`src/routes/api/progress/+server.js`、`api/favorite/+server.js`、`api/sources/+server.js`、`api/available/+server.js`、`api/settings/+server.js`、`api/sites/+server.js`
- Test: `tests/unit/library.test.js`

**Interfaces:**
- Consumes: Tasks 1–6 全部。
- Produces:
  - `library.js`: `saveProgress({key, season, episode, epName, position, duration, siteId, line})`、`getProgress(key)`（返回该作品所有集进度 + `last`）、`continueList(limit=20)`、`history({page})`、`removeHistory(key)`、`clearHistory()`、`isFinished(position, duration): boolean`（≥90% 或剩余 <180 秒）、`toggleFavorite(key, work)`、`favorites()`、`setLinePref(key, siteId, line)`、`getLinePref(key)`
  - `works.js`: `getWork(key): Promise<Work>`（tv-/movie- 走 TMDB 详情 + 写 `title` 表；cms- 走 `detailSite`）
- 页面行为按 spec §6、§8。搜索框首页自动聚焦、回车搜索、模式切换（自动 / 片名 / 演员 / 剧情）。剧情模式无 key → toast「先在设置里填写 AI 接口」并提供跳转。推荐卡片可用性用 `/api/available?key=`（懒加载，结果缓存 1 天），无片源变灰加角标。播放页：进度每 10 秒 + pause / 切集 / beforeunload 写入；自动续播 toast「已从 mm:ss 继续」；线路失败自动换下一条并 toast；看完自动下一集。

- [ ] **Step 1:** library 测试：`isFinished(2700,3000)===true`、`isFinished(1000,3000)===false`、`isFinished(2830,3000)===true`（剩余 170 秒）；`saveProgress` 后 `continueList()[0].key` 为该作品；同作品第二集写入后 `last.episode===2`；`removeHistory` 后不在列表。
- [ ] **Step 2:** FAIL → 实现 → PASS。
- [ ] **Step 3:** 实现页面与 API。
- [ ] **Step 4:** 构建运行（`MORA_HOME` 临时目录），用 Playwright 有界面 Chrome 走一遍：首页 → 搜「繁花」→ 详情 → 播放 30 秒 → 关闭重开 → 继续观看第一排出现且续播位置误差 ≤10 秒。截图存临时目录，贴路径。

### Task 8: 验收实测 + 打包

**Files:**
- Create: `tests/accept/search-hit.js`（20 部片单的命中率脚本）、`docs/accept-2026-10-22.md`（结果表）
- Modify: `desktop/release-notes.json`、`desktop/package.json`（version 0.1.0）

- [ ] **Step 1:** 跑 spec §11 的 5 项实测，结果写进 `docs/accept-*.md`（表格：项目 / 样本数 / 命中 / 耗时 / 备注）。
- [ ] **Step 2:** `node desktop/build.js --dist` 产出安装包和便携版；用便携版 + 临时 `MORA_HOME` 冒烟一遍（启动 → 搜索 → 播放）。
- [ ] **Step 3:** 个人信息自查 grep 无输出。

## 执行顺序

Task 1 → (Task 2 ∥ Task 3 ∥ Task 5) → (Task 4 → Task 6) → Task 7 → Task 8。并行任务各自只碰自己列出的文件。
