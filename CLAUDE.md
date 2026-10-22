# MoraTV：给接手的 AI agent 看的定位卡

Windows 桌面影视客户端（看港 / 陆 / 台 / 韩 / 欧美剧和电影）。设计文档：`docs/superpowers/specs/2026-10-22-moratv-design.md`（先读 §1–§4、§8–§10）。

做法：Electron 主进程用自己的 exe（`ELECTRON_RUN_AS_NODE=1`）起一个子进程跑 SvelteKit（adapter-node）产物，听 `127.0.0.1` 上的固定端口，窗口加载它。数据在本机 SQLite（`node:sqlite`），没有登录、没有账号表（单用户）。

---

## 目录结构

```
src/lib/server/        服务端数据层（只在服务端 import）
  paths.js             数据目录的唯一来源：HOME / DATA_DIR / DB_PATH / CACHE_DIR
  db.js                db() 单例：首次调用建目录、开库、WAL、跑迁移
  schema.sql           第 1 版的完整建表（设计文档 §9）
  migrate.js           顺序迁移，schema_version 记步骤；改表结构 = 在 STEPS 末尾追加一步，别改 schema.sql
  settings.js          getSetting(key, def?) / setSetting(key, value|null)
src/lib/ui/            通用组件（见下）
src/lib/nav.js         顶栏导航的单一来源（首页 / 浏览 / 片库 / 设置）
src/lib/theme.js       亮 / 暗主题（localStorage 键 moratv.theme，缺省暗色）
src/lib/media.svelte.js  响应式断点（media.mobile / wide / reducedMotion）
src/routes/            页面 + /api（现在只有首页占位和 /api/health）
desktop/               桌面外壳：main.js guard.mjs preload.cjs build.js update.html release-notes.json package.json icon.svg
tools/make-icon.js     icon.svg -> desktop/assets/icon.ico + icon.png（用 desktop 依赖里的 Electron 渲染）
tests/unit/            node --test 的单元测试
```

## 启动顺序（desktop/main.js）

1. 用户目录 `MORA_HOME`（缺省 `%APPDATA%\MoraTV`）：库 `<家>\data\moratv.db`，日志 `<家>\logs`，窗口位置 / 端口 `<家>\state.json`。
2. 子进程跑 `build/index.js`（`--import guard.mjs` 兜住播放中途断开之类的 I/O 错误）：`HOST=127.0.0.1`、`PORT`、`ORIGIN`、`MORA_HOME`、`MORA_DESKTOP=1`。端口首次随机取、记进 state.json，之后固定复用（端口一变 origin 就变，localStorage 里的主题 / 倍速 / 音量全丢）。
3. 建库 + 迁移不在主进程里另跑：服务第一次打 `/api/health` 时 `db()` 完成。主进程轮询到 `{ok:true}` 才开窗口。
4. 窗口：外链交给系统浏览器、没有菜单栏（F5 刷新、F12 开发者工具、Alt+←/→、鼠标侧键、F11 全屏）、单实例。
5. 应用更新：**缺省关闭**。仓库私有，electron-updater 读私有仓库要 token，不能塞进客户端。`MORA_UPDATE=1` 才检查；更新弹窗是客户端自己的样式（`update.html`），不用 Windows 原生弹窗。

环境变量（开发 / 测试）：`MORA_HOME`、`MORA_UPDATE=1`、`MORA_UPDATE_URL`、`MORA_GITHUB_REPO=owner/repo`（更新源 / 网页下载链接，只在要启用更新时设）、`MORA_SHOT=<png>`（首页加载完截图，验证窗口真的画出来了）、`MORA_TEST_HOOKS=1`。

## 构建 / 运行 / 测试

```bash
npm install && npm --prefix desktop install
node desktop/build.js              # 组装 desktop/.stage/app（vite build + 主进程 + 生产依赖）
node desktop/build.js --run        # 组装并用开发依赖里的 Electron 跑起来（加 --skip-vite 复用上次产物）
node desktop/build.js --dist       # NSIS 安装包 + 便携版 -> desktop/dist/（要 release-notes.json 里有当前版本的更新内容）
npm test                           # node --test "tests/unit/*.test.js"
node tools/make-icon.js            # 图标改了才需要
```

- 不要裸跑 `npx vite build` 当发布产物：缺省输出是 `build.dev`，桌面端构建用 `desktop/build.js`（它显式给 `BUILD_OUT`）。
- 如果 `desktop/node_modules/electron/dist` 不存在（postinstall 被跳过）：`node desktop/node_modules/electron/install.js`。
- 启 Electron 时必须**删掉**环境变量 `ELECTRON_RUN_AS_NODE`（置空串没用，变量存在就当 Node 跑）；`build.js --run` 已处理。
- ESM 入口的 Electron 脚本不能在模块顶层 `await app.whenReady()`，会和入口求值互相等死（见 `tools/make-icon.js`）。

## 绝对不能做的事

1. **不把个人信息写进仓库**：真名、公司邮箱 / 域名、本机用户目录路径、内网 / Tailscale 地址和域名、上游项目的 GitHub 账号名。提交前用 `git grep` 自查（词表由维护者自己保管，不写进仓库）。
2. **数据路径只走 `src/lib/server/paths.js`**。不要靠 `import.meta.url` 推路径（adapter-node 把代码打进 `build/server/chunks/`，相对路径全错；`node:sqlite` 打不开时会静默新建空库）。
3. **测试一律用 `MORA_HOME` 指到临时目录**（路径里要带 tmp / temp / test），不碰真实用户目录。必须在 import 被测模块之前设（paths.js 加载时读它）。
4. **杀进程只按 PID**，绝不按进程名杀 node / electron / python（机器上还有别的服务）。主进程只杀自己 spawn 的服务进程树（`taskkill /PID <pid> /T /F`）。
5. **界面里不写教学式说明文字**；标题本身就是状态（「还没有观看记录」）。**界面语言简体中文。**
6. **操作反馈只走全局 toast；不用 Windows 原生弹窗**（alert / confirm / dialog.*）。需要确认用 `Confirm.svelte`；启动失败用 main.js 的 `fatal()`（客户端自己的小窗口）。
7. **界面里不出现任何网页 / 外链跳转 / 第三方广告可点区域。**
8. `+page.server.js` 只导出固定几个名字；从 `$props()` 派生的值用 `$derived`，不要用只算一次的 `const`（高亮不更新的根因）。

## UI 组件（`src/lib/ui/`）

来源：MoraAnime 的通用组件，已去掉番剧 / 账号 / Bangumi / 超分（Anime4K）相关。主题 token 在 `src/app.css`（`ink-*` / `accent` / `danger` 等语义色，亮暗两套；accent 是青绿色，和 MoraAnime 区分）。

**Toast**（唯一的反馈出口，渲染处只有根布局里的 `Toaster.svelte`）：

```js
import { toast } from '$lib/ui/toast.svelte.js';
toast.ok('已加入想看');          // 绿色勾，3.2 秒消失
toast.error('线路加载失败');     // 红色描边，6 秒消失；传 { cancelled: true } 不弹
```

（MoraAnime 里这个文件在 `$lib/toast.svelte.js`，API 名 `toast.ok` / `toast.error` / `dismiss` 不变，这里挪到了 `$lib/ui/`。同屏最多 5 条、同文本去重。）

**Player.svelte**（hls.js；m3u8 一律应该走本地 `/api/stream` 代理，后续任务实现）props，与 MoraAnime 一致，去掉了超分相关的 `srSrc` / `httpsUrl`：

| prop | 说明 |
|---|---|
| `src` | 播放地址（m3u8 / mp4）；没有时盖 `pending` |
| `title` / `epLabel` | 片名；全屏时顶栏显示「片名 [第 N 集]」 |
| `hasPrev` `hasNext` `onprev` `onnext` | 上一集 / 下一集（播完倒数 5 秒自动下一集，可取消） |
| `onprogress(frac)` | timeupdate 时回调，0–1 |
| `onfail()` | 加载错误 / hls 致命错误 |
| `onmeta(height)` | 元数据就绪，回调视频高度 |
| `pending` | snippet，没有 src 时盖在画面上的内容 |
| `onback` `immersive` | 窄窗口左上角返回；铺满时留着并写片名 |
| `onlike` `liked` | 可选。右上角爱心；不传不显示 |
| `onshot(blob\|null, t)` | 可选。右上角截图键；不传不显示 |

快捷键：空格 / K 暂停，← → 5 秒，↑ ↓ 音量，F 全屏，M 静音，N / P 下一集 / 上一集；倍速、音量记在 localStorage（`moratv.player.*`）。

其余组件：`Chip` `Select` `Sheet` `Confirm` `Pager` `CardGrid`（+ `PosterCard`，作品字段 `key/title/poster/year/region/kind/badge/progress/sub`，链接 `/title/<key>`）`EpisodePicker`（`eps/roads/road/onroad/curI/watched/onplay`）`TabBar`（页内标签）`SettingsGroup` `Toggle` `SearchBox` `EmptyState` `Section` `Page` `Progress` `ThemeToggle` `BrandMark`；样式常量 `btn.js` `bar.js` `grid.js`。

## 数据库

表（设计文档 §9）：`setting site title progress last_watch favorite line_pref cache`，外加 `schema_version`。迁移规则见 `migrate.js` 头注释。`schema.sql` 在 vite 构建时靠 `?raw` 打进产物，直接用 node 跑（单元测试）时退回读文件。

## 片名匹配（`src/lib/server/search/`，0.1.2 起）

- `normalize.js`：`normRoman(s)`（Ⅰ–Ⅻ / 中文片名里的 II、III → 阿拉伯数字）**已并进 `normTitle` / `seasonOf`**；`stripPartSubtitle(s)`（「片名N：副标题」「片名之副标题」「HIStory3-圈套」→ `{base, part}`）是**单独导出**，不并进 `normTitle`——电影「无间道3：终极无间」是独立作品，只有剧集匹配才拆；`regionsOfArea(area)` 返回 vod_area 里的全部地区。
- `aggregate.js` 的匹配规则写在文件头注释里（搜索聚类和 `findSources` 共用）：地区只在年份对不上时才拒；剧集 ↔ 电影形态冲突只在没有形态相符条目时按同名同年兜底；电影比「规范名 + 续集号」，年份差 1 要演员有交集；片名带「（动画版）」「[解说]」的条目直接丢。`findSources` 搜主名 + 原名 + 全部中文别名（`tmdb.details` 把 translations 的 zh 译名排在别名最前），最多 6 个词，同词 10 分钟内复用。
- 回归用例：`tests/fixtures/match-regression.json`（条目池取自真实资源站），改匹配逻辑先跑它。
- `works.js` 的缓存键带匹配版本（`src:v2:` / `avail:v2:` / `srch:v2:`），**改了匹配规则就把 `MATCH_V` 加一**，老用户缓存里的「无片源」立刻失效；无片源只缓存 6 小时。搜索结果经 `rememberSearch` 写进 `srch:` / `avail:`，详情页 `sourcesFor` 会按季并进来。
- 资源站搜索（`cms/sites.js` `searchAll`）第 1 页满页时再取第 2 页。
