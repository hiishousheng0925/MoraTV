# MoraTV 设计文档

日期：2026-10-22　状态：用户已授权直接开发（「派子代理一起做，然后开始开发」）

## 1. 为什么做

Windows 桌面客户端，看香港 / 内地 / 台湾 / 韩国 / 欧美的电视剧和电影。用户的三个痛点（原话整理）：

1. **知道片名却搜不到能看的**（最重要）；有时只记得演员，或者只记得剧情。
2. 找到了也是一堆**跳转广告、容易误触**。
3. **忘了看过什么、看到哪一集哪一分钟**。

次要：不知道最近有什么好看的。用户发现好片的主要渠道是**抖音解说**，所以「刷到 → 马上搜到 → 直接看」这条路要最顺；首页推荐是补充。

成功的样子：打开就是搜索框，输片名 / 演员 / 一段剧情都能搜到并直接播放；界面里没有任何可以误点的广告；首页第一排就是「继续观看」。

## 2. 目标 / 非目标 / 反目标

- 目标：多资源站聚合搜索 + TMDB 元数据 + 本地观看进度 + 去片头插播广告 + 推荐。
- 非目标：手机 App、多用户、云同步、下载离线、字幕制作、超分（Anime4K 对真人无意义）。
- 反目标（技术上能跑也算失败）：
  - 界面里出现任何网页、外链跳转或第三方广告可点区域。
  - 搜索结果是一堆重名卡片要用户自己猜哪个是对的。
  - 界面里写教学式说明文字；用 Windows 原生弹窗。
  - 仓库里出现个人信息（真名、公司邮箱、`C:\Users\<名字>`、Tailscale IP / 域名、上游网站的 GitHub 账号）。

## 3. 约束（用户定的）

- 只做 Windows；预算 0。
- 仓库：`D:\hiish\software\MoraTV`，GitHub `hiishousheng0925/MoraTV`，**私有**。改代码走 PR，只有用户能合并；发正式版前要用户说 OK。
- 操作反馈只走 toast；弹窗用客户端自己的样式。
- 杀进程只按 PID，不按进程名杀 node / electron / python。
- 界面语言简体中文。

## 4. 架构（沿用 MoraAnime 的形态，新建项目，不做上游同步）

```
Electron 主进程 (desktop/main.js)
  └─ 用自己的 exe（ELECTRON_RUN_AS_NODE=1）起子进程跑 SvelteKit adapter-node 产物
       监听 127.0.0.1:<固定复用端口>，窗口加载它
SvelteKit (src/)
  ├─ src/lib/server/   数据层：SQLite(node:sqlite)、资源站、TMDB、去广告代理、剧情搜索
  ├─ src/routes/       页面 + /api
  └─ src/lib/ui/       从 MoraAnime 搬来的通用组件（Player、Toaster、主题、卡片…）
```

从 MoraAnime（`D:\hiish\software\MoraAnime`）**复制后改造**的部分：`desktop/`（去掉 catalog.js / db-tasks 的换库 / 账号 bootstrap）、`src/lib/ui/` 里的通用组件（Player.svelte、playerUtil.js、Toaster + toast、ThemeToggle + theme、Chip、Select、Sheet、Confirm、Pager、CardGrid、PosterCard 类、EpisodePicker、TabBar、SettingsGroup、Toggle、SearchBox、EmptyState、Section、Page）、`src/routes/api/stream`（m3u8 代理思路）、`scrape.js` 里的 `assertPublic` 内网拦截、`limit.js`。**不搬**：Bangumi / AOD / 番剧库导出下发 / 多账号 / 季度表 / 放送表 / triage / stats / Anime4K / playwright 嗅探。

和 MoraAnime 的差异：**没有登录、没有账号表**（单用户，直接用）。数据目录 `MORA_HOME`，缺省 `%APPDATA%\MoraTV`，库在 `<MORA_HOME>\data\moratv.db`。

参考的开源项目（**只借思路，不复制代码**——LibreTV / zyfun 是 AGPL，LunaTV 是 CC BY-NC-SA）：LibreTV 的苹果 CMS 聚合方式和 m3u8 去广告规则；zyfun 的桌面端形态。KVideo（MIT）、OuonnkiTV（Apache-2.0）的代码可以参考，引用时在文件头注明出处和许可证。

## 5. 数据源

### 5.1 片源：苹果 CMS v10 资源站

- 接口：`<api>?ac=videolist&wd=<关键词>&pg=<页>`（搜索）、`&ids=1,2`（详情）、`&t=<type_id>`（按分类）、`?ac=list`（分类树）。返回 `{code, page, pagecount, total, list:[vod]}`。
- `vod_play_from` 用 `$$$` 分隔线路；`vod_play_url` 同样 `$$$` 分隔线路，线路内 `#` 分集，每集 `集名$URL`。只保留 URL 以 `.m3u8` 结尾（或 `$$$` 对应线路名含 `m3u8`）的线路。
- 内置一份缺省站点列表（`src/lib/server/cms/sites.default.js`，2026-10-22 实测可用的：量子、非凡、电影天堂、暴风等），设置页可增删、启停、一键测速。站点记录：名称、API 地址、启用、最近一次成功时间、延迟。
- 并发搜所有启用站点，单站超时 8 秒，单站失败不影响整体；连续失败的站点自动降权排后。
- 各站 `type_id` 不统一，**按 `type_name` 映射**到客户端自己的分类（见 §7）。

### 5.2 元数据：TMDB

- 用户要在 TMDB 申请免费 API key（个人非商用），填到设置页。**没填 key 时客户端仍能用**：搜索直接展示资源站结果（用资源站自带的 `vod_pic` / `vod_content` / `vod_year` / `vod_area`），首页推荐那几排不显示。
- 用到的接口：`/search/multi`（片名）、`/search/person` + `/person/{id}/combined_credits`（演员）、`/tv/{id}`、`/movie/{id}`、`/tv/{id}/season/{n}`、`/{type}/{id}/alternative_titles`、`/trending/{type}/week`、`/discover/tv?with_origin_country=HK|CN|TW|KR|US|GB&sort_by=popularity.desc`、`/discover/movie`。语言 `zh-CN`，缺简介时回退 `zh-TW` / `zh-HK` / `en-US`。
- 本地缓存进 SQLite，TTL：详情 7 天、榜单 12 小时，最长不超过 6 个月（TMDB 条款）。设置页底部要有 TMDB logo + "This product uses the TMDB API but is not endorsed or certified by TMDB."（条款要求，属于署名不算教学文字）。
- 海报走 `image.tmdb.org`，客户端经本地 `/img` 代理并磁盘缓存。

### 5.3 剧情搜索：LLM

- 用户只记得剧情时，把描述发给 LLM，让它返回最多 5 个候选（片名、年份、地区、一句理由，JSON），再逐个拿去 TMDB 校验（查不到的丢掉），最后照常找片源。
- LLM 用 OpenAI 兼容接口，设置页填 Base URL / API Key / 模型。缺省值 NVIDIA NIM（`https://integrate.api.nvidia.com/v1`，免费额度），模型由实现者实测选一个中文好的。没填 key 时剧情搜索入口置灰并 toast 提示去设置。
- 开发实测可以临时用本机已有的 NIM key（从环境变量读），**不得写进仓库**。

## 6. 核心流程

### 6.1 搜索（首页顶部常驻搜索框 + `/search`）

模式：自动 / 片名 / 演员 / 剧情（搜索框旁的分段切换；「自动」= 片名搜索，结果为空且 TMDB 有同名演员时附上演员结果）。

片名搜索：
1. 关键词做**简繁双向转换**（`opencc-js`，MIT），得到 1–2 个变体。
2. 并发：各资源站搜每个变体 + TMDB `/search/multi`。
3. **合并成「作品」**：资源站条目按「规范化片名（去空格/标点/「第X季」/年份后缀，繁转简）+ 年份 ±1」聚类；每个聚类尝试匹配 TMDB 结果（片名或别名相同 + 年份 ±1 + 地区一致优先）。同名不同作（例如国产短剧《黑暗荣耀》vs 韩剧）必须分成两张卡，卡上显示年份 + 地区 + 形态以区分。
4. TMDB 有但资源站没有的作品：拿 TMDB 的 `zh-CN` / `zh-TW` / 原名 / alternative_titles 再搜一轮资源站；仍然没有就以「暂无片源」样式（变灰 + 角标）排在最后。
5. 排序：有片源的在前；同时按与关键词的相似度、TMDB 热度。

演员搜索：TMDB `/search/person` 取第一位（结果多于一位时让用户点选），列出其作品（按年份倒序），卡片点进去走正常详情流程。

### 6.2 详情页 `/title/[key]`

`key` = `tv-<tmdbId>` / `movie-<tmdbId>`，或没有 TMDB 匹配时 `cms-<siteId>-<vodId>`。

- 顶部：海报、片名、原名、年份、地区、类型、评分（TMDB）、简介、主演前 6。
- 按钮：「播放 / 继续第 N 集 mm:ss」、「想看」开关。
- 剧集有多季时用季 tab；每季去资源站找该季（「片名 第N季」/「片名N」等变体）。
- 片源面板：按「站点 · 线路」列出，显示集数和测得的延迟；缺省选「集数最全 + 最快」那条；用户手动选过的线路记住（按作品）。
- 选集网格（复用 EpisodePicker），看过的集打标记，当前进度高亮。

### 6.3 播放页 `/title/[key]/watch?s=<季>&e=<集>`

- 复用 MoraAnime 的 Player.svelte（hls.js）。m3u8 一律走本地代理 `/api/stream`，代理里做**去广告**和内网地址拦截（`assertPublic`）。
- 快捷键、倍速、音量、全屏沿用 MoraAnime。
- **进度**：每 10 秒和暂停 / 切集 / 关闭时写一次 `(作品, 季, 集, 位置, 时长, 站点, 线路)`；播放到 ≥ 90% 或剩余 < 3 分钟算看完，自动下一集。打开时自动跳到上次位置（toast「已从 mm:ss 继续」）。
- 当前线路播放失败（加载错误 / 15 秒卡住）：toast 提示并自动切到同一集的下一条线路。

### 6.4 去广告（`src/lib/server/stream/adfilter.js`，按 LibreTV 思路自写）

对媒体 playlist：
1. 按 `#EXT-X-DISCONTINUITY` 把分片切成若干组。
2. 规则 A：第一组时长 ≤ 90 秒且分片数 ≤ 20，并且该组的分片 URL 前缀 / 时长特征与其余组明显不同 → 删除该组。
3. 规则 B：任意组里分片 URL 命中 `/adjump|advert|\/ads?\//i` → 删除该组。
4. 规则 C（自加，实测后决定是否保留）：中间某组时长 ≤ 60 秒、分片 URL 的路径前缀与主体不同 → 删除。
5. **不能只删 DISCONTINUITY 标记**（时间戳会跳）；删组时连同该组前面的 DISCONTINUITY 一起删，保持其余结构不变。
6. 单元测试覆盖：有片头广告 / 中插广告 / 无广告 / 正片本身有多个 DISCONTINUITY（例如多段拼接）不误删。交付时要给实测数字：抽 N 部剧统计删掉的广告组数和误删数。

## 7. 分类体系（客户端自己的，固定）

- 形态：剧集 / 电影 / 综艺 / 纪录片 / 短剧（动漫不做，那是 MoraAnime 的事）。
- 地区：内地 / 香港 / 台湾 / 韩国 / 日本 / 泰国 / 欧美 / 其他。
- 资源站映射表（`cms/categories.js`）：按 `type_name` 关键字映射，例如「国产剧 / 大陆剧 / 内地剧」→ 剧集·内地，「香港剧 / 港剧」→ 剧集·香港，「韩国剧 / 韩剧」→ 剧集·韩国，「欧美剧 / 美剧 / 英剧」→ 剧集·欧美，「动作片 / 喜剧片 / …」→ 电影，「大陆综艺 / 综艺」→ 综艺，「短剧」→ 短剧，「动漫 / 动画」→ 丢弃。未知类目归「其他」。
- TMDB 映射：`origin_country` → 地区；`media_type` / genre「Reality / Talk」→ 综艺，「Documentary」→ 纪录片。

## 8. 页面

| 路由 | 内容 |
|---|---|
| `/` 首页 | 顶部大搜索框（自动聚焦）；「继续观看」一排；「想看」一排；推荐若干排：本周热门、热门港剧、热门陆剧、热门韩剧、热门欧美剧、热门电影（需 TMDB key）。推荐卡片懒加载片源可用性，没片源的变灰。 |
| `/search?q=&mode=` | 结果网格 + 模式切换 |
| `/title/[key]` | 详情（§6.2） |
| `/title/[key]/watch` | 播放（§6.3） |
| `/library` | tab：观看历史（按最近时间，可删单条 / 清空）、想看 |
| `/browse` | 按「形态 × 地区」浏览（TMDB discover，分页） |
| `/settings` | TMDB key、LLM 设置、资源站管理（增删 / 启停 / 测速）、主题、清缓存、版本号；底部 TMDB 署名 |

导航沿用 MoraAnime 的顶栏样式：首页 / 浏览 / 片库 / 设置 + 搜索。

## 9. 数据库（`schema.sql`，node:sqlite）

- `setting(key PRIMARY KEY, value)` — tmdb_key、llm_base、llm_key、llm_model 等
- `site(id INTEGER PK, name, api, enabled, weight, last_ok_at, last_fail_at, fail_streak, latency_ms, builtin)`
- `title(key PK, tmdb_type, tmdb_id, name, original_name, year, region, kind, poster, overview, json, fetched_at)` — 作品缓存（TMDB 或资源站）
- `progress(title_key, season, episode, ep_name, position, duration, site_id, line, updated_at, PRIMARY KEY(title_key, season, episode))`
- `last_watch(title_key PK, season, episode, updated_at)` — 用于「继续观看」
- `favorite(title_key PK, added_at)`
- `line_pref(title_key PK, site_id, line)`
- `cache(k PK, v, expires_at)` — TMDB / 资源站响应缓存
- 迁移：`schema_version` + 顺序迁移脚本，启动时执行。

## 10. 桌面端

- 从 MoraAnime `desktop/` 复制：main.js（进程管理、单实例、窗口状态、外链交给系统、端口复用、崩溃重启、按 PID 杀子进程树）、guard.mjs、preload.cjs、build.js、update.html、release-notes.json。
- 删除：catalog.js、catalog-tables.js、db-tasks 的 bootstrap/apply、cookie 注入。
- appId `com.mora.tv`，productName `MoraTV`，图标新做（`tools/make-icon.js` 改配色，别和 MoraAnime 一样）。
- **自动更新**：仓库是私有的，electron-updater 读私有仓库要 token，不能塞进客户端。所以先**关闭自动更新**（代码保留，配置开关），等以后仓库公开或换更新源再开。
- 打包：NSIS 安装包 + 便携版，同 MoraAnime。

## 11. 测试与验收

- 单元测试（`node --test`）：苹果 CMS 播放串解析、分类映射、片名规范化与聚类、简繁变体、去广告规则、进度「看完」判定、TMDB 匹配打分。
- 实测（交付时给数字，表格化）：
  1. 片名搜索命中率：抽 20 部（港 / 陆 / 台 / 韩 / 欧美剧 + 电影，含老剧和冷门网剧），统计「能搜到且至少一条线路能播」的比例和平均耗时。
  2. 演员搜索：3 个演员。
  3. 剧情搜索：5 段描述，统计第一候选命中率。
  4. 去广告：抽 10 部，统计删除的广告组数、误删数。
  5. 进度：播一半关掉重开，确认续播位置误差 ≤ 10 秒。
- 测试一律用 `MORA_HOME` 指向临时目录，不碰真实用户目录。
- 提交前自查个人信息（同 MoraAnime 的 grep 规则）。

## 12. 交给实现者自己决定的

- 具体 UI 细节、动画、卡片尺寸（以 MoraAnime 现有风格为准）。
- LLM 缺省模型选哪个（实测中文剧情识别效果后定）。
- 缺省资源站列表的具体成员（实测可用的留下）。
- 聚类 / 匹配阈值（以实测命中率为准）。

## 13. 我（Claude）替用户做的决定，用户可推翻

- 单用户免登录、记录只存本机、不做同步。
- 私有仓库下自动更新先关闭。
- 剧情搜索走 LLM，缺省 NVIDIA NIM 免费额度。
- 没有 TMDB key 也能用（降级为纯资源站结果）。
- 动漫类目丢弃（留给 MoraAnime）。

## 14. 法律

马来西亚 Copyright Act 43AA 针对分发具有播放能力的软件。用户已决定：先不公开（私有仓库、自用）。将来要公开或分发时重新评估。
