/**
 * MoraTV 主进程：把本地服务（SvelteKit adapter-node 产物）包进一个桌面窗口。
 *
 * 启动顺序：
 *   1. 用户目录 MORA_HOME（缺省 %APPDATA%\MoraTV），库在 <它>\data\moratv.db；日志在 <它>\logs
 *   2. 子进程跑服务：ELECTRON_RUN_AS_NODE=1 + process.execPath（同一个 exe 当 Node 用），听 127.0.0.1 固定端口
 *      （首次随机取、记进 state.json，之后一直用它；被占了才换 —— 端口一变 origin 就变，localStorage 里的主题 / 倍速 / 音量全丢）
 *      建库和迁移由服务第一次打 /api/health 时完成（src/lib/server/db.js），不在主进程里另跑
 *   3. 等 /api/health 返回 ok → 开窗口加载首页
 *   4. 开窗口后：应用更新检查（默认关闭，见下）
 *
 * 环境变量（都可选，开发 / 测试用）：
 *   MORA_HOME        客户端用户目录，缺省 %APPDATA%\MoraTV（测试一律指到临时目录）
 *   MORA_UPDATE=1    才会检查应用更新。缺省关闭：仓库私有，electron-updater 读私有仓库要 token，不能塞进客户端
 *   MORA_UPDATE_URL  测试用：改从这个地址（generic 源）读 latest.yml（同样要 MORA_UPDATE=1）
 *   MORA_GITHUB_REPO 「owner/repo」。更新弹窗里「去网页下载」的链接用；打包时 build.js 也读它写更新源。都不设就没有网页下载入口
 *   MORA_SHOT=<png>  测试用：首页加载完把窗口画面存成 png（验证窗口真的画出来了）
 *   MORA_TEST_HOOKS=1  把几个内部量挂到 globalThis.__mora，供 electron.evaluate 读
 */
import { app, BrowserWindow, ipcMain, session, shell, Menu } from 'electron';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, renameSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(HERE, '..');
const BUILD = join(APP_DIR, 'build');

app.setName('MoraTV');
const HOME = process.env.MORA_HOME || join(app.getPath('appData'), 'MoraTV');
const DATA = join(HOME, 'data');
const LOGS = join(HOME, 'logs');
const STATE = join(HOME, 'state.json');
for (const d of [HOME, DATA, LOGS]) mkdirSync(d, { recursive: true });
// Chromium 自己的缓存 / cookie 也放进同一个用户目录（MORA_HOME 指到别处时整套隔离）
app.setPath('userData', HOME);

// ── 日志 / 状态 ─────────────────────────────────────────────
const logFile = join(LOGS, 'main.log');
const serverLog = join(LOGS, 'server.log');
// 启动时超过 5MB 就把旧的改名成 .1（只留一份），再从空文件开始。拿到单实例锁之后才调：第二个实例不能去改名第一个实例正在写的日志
function rotateLogs() {
  for (const f of [logFile, serverLog]) {
    try { if (statSync(f).size > 5 * 1048576) renameSync(f, f + '.1'); } catch { /* 没有文件 / 被占用：这次不轮转 */ }
  }
}
function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`;
  try { appendFileSync(logFile, line); } catch { /* 日志写不进不影响运行 */ }
  if (!app.isPackaged) process.stdout.write(line);
}
const readState = () => { try { return JSON.parse(readFileSync(STATE, 'utf8')); } catch { return {}; } };
// 写不进（磁盘满、杀毒软件锁着文件）只记日志：state.json 里都是「记住窗口位置」这类可有可无的东西
const writeState = (patch) => {
  try {
    const s = { ...readState(), ...patch };
    writeFileSync(STATE + '.part', JSON.stringify(s, null, 2)); renameSync(STATE + '.part', STATE);
  } catch (e) { log('写 state.json 失败（不影响使用）', String(e?.message || e)); }
};

/** 子进程（服务）的环境：只带客户端需要的，别的部署变量一概不继承 */
function childEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (/^(ORIGIN$|HOST$|PORT$)/.test(k)) delete env[k];
  return { ...env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production', MORA_HOME: HOME, ...extra };
}

// ── 启动画面 / 致命错误（都是客户端自己的窗口，不用系统弹窗）──────────────
let splash = null, splashReady = false;
const PAGE_CSS = `margin:0;font:14px system-ui,'Microsoft YaHei';color:#e8edf3;background:#0b0e13;display:flex;flex-direction:column;
  justify-content:center;padding:0 28px;height:100vh;box-sizing:border-box`;
function showSplash() {
  splash = new BrowserWindow({ width: 420, height: 160, frame: false, resizable: false, show: false, center: true,
    backgroundColor: '#0b0e13', webPreferences: { sandbox: true } });
  const html = `<!doctype html><meta charset="utf-8"><body style="${PAGE_CSS}">
    <div style="font-size:18px;font-weight:600;margin-bottom:10px">MoraTV</div><div id="m">正在启动</div>
    <div style="margin-top:12px;height:4px;background:#2e3744;border-radius:2px"><div id="b" style="height:4px;width:30%;background:#3dd6c0;border-radius:2px"></div></div></body>`;
  splash.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  splash.once('ready-to-show', () => { splashReady = true; splash?.show(); });
}
function splashMsg(msg, frac = null) {
  if (!splash || splash.isDestroyed() || !splashReady) return;
  splash.webContents.executeJavaScript(`document.getElementById('m').textContent=${JSON.stringify(msg)};` +
    (frac == null ? '' : `document.getElementById('b').style.width='${Math.round(frac * 100)}%';`)).catch(() => {});
}

/** 启动失败 / 服务反复退出：开一个客户端样式的小窗口显示原因，关掉就退出（不用 Windows 原生弹窗） */
function fatal(title, detail) {
  log(title, detail);
  splash?.destroy(); splash = null;
  const w = new BrowserWindow({ width: 520, height: 260, resizable: false, minimizable: false, maximizable: false, center: true,
    autoHideMenuBar: true, title: 'MoraTV', backgroundColor: '#0b0e13', webPreferences: { sandbox: true } });
  w.setMenu(null);
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const html = `<!doctype html><meta charset="utf-8"><body style="${PAGE_CSS}">
    <div style="font-size:18px;font-weight:600;margin-bottom:10px;color:#fca5a5">${esc(title)}</div>
    <div style="color:#c5cdd9;word-break:break-all;max-height:130px;overflow:auto;font-size:13px">${esc(detail)}</div></body>`;
  w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  w.on('closed', () => app.exit(1));
}

// ── 服务子进程 ─────────────────────────────────────────────
function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}
/** 只在 127.0.0.1 上试能不能 listen（服务也只听这个地址） */
function canListen(p) {
  return new Promise((resolve) => {
    const s = createServer();
    s.unref();
    s.once('error', () => resolve(false));
    s.listen(p, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}
async function pickPort() {
  const saved = Number(readState().port);
  if (Number.isInteger(saved) && saved > 1024 && saved < 65536 && await canListen(saved)) return saved;
  const p = await freePort();
  if (saved) log(`端口 ${saved} 被占用，改用 ${p}`);
  writeState({ port: p });
  return p;
}

let server = null, port = 0, origin = '', quitting = false;
const crashes = [];

function startServer() {
  origin = `http://127.0.0.1:${port}`;
  const env = childEnv({ HOST: '127.0.0.1', PORT: String(port), ORIGIN: origin, BODY_SIZE_LIMIT: '50M',
    MORA_DESKTOP: '1', MORA_APP_VERSION: app.getVersion() });
  // --import 的绝对路径必须写成 file:// URL（Windows 上 C:\… 会被当成协议名）
  server = spawn(process.execPath, ['--import', pathToFileURL(join(HERE, 'guard.mjs')).href, join(BUILD, 'index.js')],
    { cwd: APP_DIR, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const sink = (b) => { try { appendFileSync(serverLog, b); } catch { /* 忽略 */ } };
  server.stdout.on('data', sink); server.stderr.on('data', sink);
  log(`服务启动 pid=${server.pid} ${origin}`);
  const me = server;
  me.on('exit', (code, sig) => {
    log(`服务退出 pid=${me.pid} code=${code} sig=${sig}`);
    if (quitting || me !== server) return;
    // 崩了自动重启；一分钟内崩 5 次就不再硬撑
    const now = Date.now();
    crashes.push(now);
    while (crashes.length && now - crashes[0] > 60_000) crashes.shift();
    if (crashes.length > 5) { fatal('本地服务反复退出', `请查看日志：${serverLog}`); return; }
    setTimeout(async () => {
      if (quitting) return;
      // 端口被别的程序占了：原样重启会连崩 5 次。重启前先试，被占就换端口、主窗口跳到新地址
      // （换了端口 = 换了 origin，这次运行里 localStorage 的偏好在新 origin 下看不到，下次启动起就固定在新端口上）
      let moved = false;
      if (!(await canListen(port))) {
        const old = port;
        port = await freePort();
        writeState({ port });
        log(`重启服务：端口 ${old} 被占用，改用 ${port}`);
        moved = true;
      }
      if (quitting) return;
      startServer();
      if (!(await waitHealthy())) return;
      if (!mainWin || mainWin.isDestroyed()) return;
      if (moved) {
        let path = '/';
        try { const u = new URL(mainWin.webContents.getURL()); path = u.pathname + u.search + u.hash; } catch { /* 用首页 */ }
        mainWin.loadURL(origin + path).catch(() => {});
      } else mainWin.webContents.reload();
    }, 1000);
  });
}

async function waitHealthy(timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) return true;
    } catch { /* 还没起来 */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/**
 * 结束服务进程树。只按我们自己 spawn 出来的 PID 杀：
 * 子进程还没被回收（exitCode === null）时我们手里握着它的句柄，Windows 不会把这个 PID 分给别的进程，
 * 所以这个 PID 一定还是那个服务进程。绝不按进程名杀。
 */
function stopServer() {
  const s = server;
  server = null;
  if (!s || s.exitCode !== null || s.signalCode) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(s.pid), '/T', '/F'], { windowsHide: true });
  else s.kill('SIGTERM');
}

// ── 窗口 ───────────────────────────────────────────────────
let mainWin = null;

function windowBounds() {
  const st = readState().window;
  return st?.bounds ? st : { bounds: { width: 1360, height: 860 }, maximized: false };
}

function createWindow() {
  const ws = windowBounds();
  mainWin = new BrowserWindow({
    ...ws.bounds, minWidth: 900, minHeight: 600, show: false, title: 'MoraTV', backgroundColor: '#0b0e13',
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, spellcheck: false, preload: join(HERE, 'preload.cjs') }
  });
  if (ws.maximized) mainWin.maximize();
  // 读全局 origin（不是建窗口时的快照）：服务崩溃重启可能换了端口
  const isLocal = (u) => { try { return new URL(u).origin === origin; } catch { return false; } };
  // 外链（target=_blank 等）交给系统浏览器；窗口里永远不开别人的网页
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (!isLocal(url) && /^https?:/i.test(url)) shell.openExternal(url);
    else if (isLocal(url)) mainWin.loadURL(url);
    return { action: 'deny' };
  });
  mainWin.webContents.on('will-navigate', (e, url) => {
    if (!isLocal(url)) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
  // 没有菜单栏：常用快捷键自己接
  mainWin.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const wc = mainWin.webContents;
    if (input.key === 'F5' || (input.control && input.key.toLowerCase() === 'r')) { wc.reload(); e.preventDefault(); }
    else if (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i')) { wc.toggleDevTools(); e.preventDefault(); }
    else if (input.alt && input.key === 'ArrowLeft' && wc.navigationHistory.canGoBack()) { wc.navigationHistory.goBack(); e.preventDefault(); }
    else if (input.alt && input.key === 'ArrowRight' && wc.navigationHistory.canGoForward()) { wc.navigationHistory.goForward(); e.preventDefault(); }
    else if (input.key === 'F11') { mainWin.setFullScreen(!mainWin.isFullScreen()); e.preventDefault(); }
  });
  // 鼠标侧键前进 / 后退
  mainWin.on('app-command', (_e, cmd) => {
    const h = mainWin.webContents.navigationHistory;
    if (cmd === 'browser-backward' && h.canGoBack()) h.goBack();
    if (cmd === 'browser-forward' && h.canGoForward()) h.goForward();
  });
  const save = () => {
    if (!mainWin || mainWin.isDestroyed() || mainWin.isMinimized() || mainWin.isFullScreen()) return;
    writeState({ window: { bounds: mainWin.isMaximized() ? (readState().window?.bounds ?? mainWin.getNormalBounds()) : mainWin.getBounds(),
                           maximized: mainWin.isMaximized() } });
  };
  let t = null;
  const later = () => { clearTimeout(t); t = setTimeout(save, 500); };
  mainWin.on('resize', later); mainWin.on('move', later);
  mainWin.on('maximize', save); mainWin.on('unmaximize', save);
  mainWin.on('close', save);
  mainWin.once('ready-to-show', () => { mainWin.show(); splash?.destroy(); splash = null; });
  mainWin.on('page-title-updated', (e, title) => { e.preventDefault(); mainWin.setTitle(/MoraTV/.test(title) ? title : `${title} · MoraTV`); });
  return mainWin;
}

// ── 应用更新（electron-updater）──────────────────────────────
// 缺省关闭（见文件头 MORA_UPDATE）。代码保留：以后仓库公开或换了更新源，设 MORA_UPDATE=1 / 改缺省值即可。
// 开启后：每次启动查一次；有新版本就弹客户端样式的窗口（版本号 + 几行更新内容，desktop/release-notes.json 打包时写进 latest.yml）。
//   立即更新 → 下载（任务栏进度）→ 静默安装并自动重新打开
//   关闭     → 这次不更新；不在退出时偷偷装，下次打开照样再弹
// 便携版没法原地更新：「立即更新」打开下载链接。
const REPO = /^[\w.-]+\/[\w.-]+$/.test(process.env.MORA_GITHUB_REPO || '') ? process.env.MORA_GITHUB_REPO : null;
const DOWNLOAD = REPO ? `https://github.com/${REPO}/releases/latest/download/` : null;

/** latest.yml 里的 releaseNotes（字符串；拿不到时 GitHub 源会退回 release 正文的 HTML）→ 最多 6 行纯文本 */
function notesList(n) {
  if (Array.isArray(n)) n = n[0]?.note ?? '';
  return String(n ?? '').replace(/<br\s*\/?>|<\/(p|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
    .split(/\r?\n/).map((l) => l.replace(/^[•\-*]\s*/, '').trim()).filter(Boolean).slice(0, 6);
}

async function checkAppUpdate() {
  if (process.env.MORA_UPDATE !== '1') return;
  const feed = process.env.MORA_UPDATE_URL;
  if (!app.isPackaged && !feed) return;
  const portable = !!process.env.PORTABLE_EXECUTABLE_DIR;
  try {
    const { default: updater } = await import('electron-updater');
    const au = updater.autoUpdater;
    au.logger = { info: (m) => log('[updater]', String(m)), warn: (m) => log('[updater]', String(m)),
                  error: (m) => log('[updater]', String(m)), debug: () => {} };
    au.autoDownload = false;
    au.autoInstallOnAppQuit = false;
    if (feed) { au.forceDevUpdateConfig = true; au.setFeedURL({ provider: 'generic', url: feed }); }
    au.on('error', (e) => log('[updater] 出错', String(e?.message || e)));
    au.once('update-available', (info) => {
      pendingUpdate = { au, info, portable };
      if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('mora:update', info.version);
      promptUpdate(au, info, portable);
    });
    await au.checkForUpdates().catch((e) => log('[updater] 检查更新失败（静默）', String(e?.message || e)));
  } catch (e) {
    log('[updater] 不可用', String(e?.message || e));
  }
}

// 检查到的新版本（重新打开弹窗用）；关掉弹窗后它还在，直到更新
// updPercent：下载进度，重新打开弹窗时直接显示；updListening：au 的进度 / 完成监听只挂一次
let pendingUpdate = null, updDlg = null, updDownloading = false, updPercent = 0, updListening = false, updInstalling = false;
ipcMain.handle('mora:update-state', () => pendingUpdate?.info.version ?? null);
ipcMain.on('mora:open-update', () => { if (pendingUpdate) promptUpdate(pendingUpdate.au, pendingUpdate.info, pendingUpdate.portable); });

// 弹窗跟着客户端当前主题走：从主窗口读 --c-* 变量传给 update.html
const THEME_VARS = ['--c-bg', '--c-surface', '--c-surface-2', '--c-border', '--c-text', '--c-text-soft',
  '--c-muted', '--c-accent', '--c-on-accent', '--c-danger'];

/**
 * 客户端样式的更新弹窗（desktop/update.html）：透明窗口盖住主窗口 = 遮罩 + 居中卡片。不用 Windows 原生弹窗。
 * 页面按钮改 location.hash（#now / #later / #web），这里监听 did-navigate-in-page；进度用 executeJavaScript 推过去
 */
async function promptUpdate(au, info, portable) {
  const win = mainWin && !mainWin.isDestroyed() ? mainWin : null;
  if (!win) return;
  if (updDlg && !updDlg.isDestroyed()) { updDlg.focus(); return; }
  log(`[updater] 有新版本 ${info.version}，弹窗`);
  const theme = await win.webContents.executeJavaScript(
    `(() => { const s = getComputedStyle(document.documentElement);
       return Object.fromEntries(${JSON.stringify(THEME_VARS)}.map((k) => [k, s.getPropertyValue(k).trim()])); })()`)
    .catch(() => ({}));
  const b = win.getContentBounds();
  const dlg = new BrowserWindow({ parent: win, modal: true, frame: false, transparent: true, hasShadow: false,
    resizable: false, movable: false, minimizable: false, maximizable: false, skipTaskbar: true, show: false,
    x: b.x, y: b.y, width: b.width, height: b.height, title: 'MoraTV 更新',
    webPreferences: { sandbox: true, contextIsolation: true, spellcheck: false } });
  updDlg = dlg;
  // 下载中不让关（Alt+F4 也算）：electron-updater 的下载取消不了，只能下完再说；退出客户端（quitting）时放行
  dlg.on('close', (e) => { if (updDownloading && !quitting) e.preventDefault(); });
  dlg.on('closed', () => { if (updDlg === dlg) updDlg = null; });
  dlg.setMenu(null);
  dlg.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  dlg.webContents.on('will-navigate', (e) => e.preventDefault());
  const run = (js) => { if (!dlg.isDestroyed()) dlg.webContents.executeJavaScript(js).catch(() => {}); };
  // 进度 / 结果推给「当前」的弹窗：关掉再打开后是另一个窗口，推给闭包里的旧 dlg 新弹窗就不动了
  const runCur = (js) => { if (updDlg && !updDlg.isDestroyed()) updDlg.webContents.executeJavaScript(js).catch(() => {}); };
  const progressBar = (v) => { if (mainWin && !mainWin.isDestroyed()) mainWin.setProgressBar(v); };
  const link = DOWNLOAD ? DOWNLOAD + (portable ? 'MoraTV-portable.exe' : 'MoraTV-Setup.exe') : null;

  const download = () => {
    if (updDownloading || updInstalling) return;
    updDownloading = true;
    updPercent = 0;
    log('[updater] 用户选择立即更新，开始下载');
    runCur('progress(0)');
    // 监听只挂一次：每调一次 download() 多挂一组，下载失败后重试会 quitAndInstall 两次
    if (!updListening) {
      updListening = true;
      au.on('download-progress', (p) => {
        updPercent = p.percent;
        runCur(`progress(${p.percent})`);
        progressBar(p.percent / 100);
      });
      au.on('update-downloaded', () => {
        if (updInstalling || quitting) return;
        updInstalling = true;
        updDownloading = false;
        log('[updater] 下载完成，安装并重启');
        runCur('progress(100)');
        setTimeout(() => au.quitAndInstall(true, true), 800);
      });
    }
    au.downloadUpdate().catch((e) => {
      const msg = String(e?.message || e).slice(0, 200);
      log('[updater] 下载失败', msg);
      updDownloading = false;
      progressBar(-1);
      runCur(`failed(${JSON.stringify(msg)})`);
    });
  };
  dlg.webContents.on('did-navigate-in-page', (_e, url) => {
    const a = new URL(url).hash.slice(1).split('-')[0];
    if (a === 'later') { log('[updater] 用户关闭了更新弹窗，下次启动再提示'); dlg.close(); }
    else if (a === 'web') { if (link) shell.openExternal(link); dlg.close(); }
    else if (a === 'now') {
      if (portable) { log('[updater] 便携版：打开下载链接'); if (link) shell.openExternal(link); dlg.close(); }
      else download();
    }
  });
  await dlg.loadFile(join(HERE, 'update.html'));
  run(`init(${JSON.stringify({ version: info.version, current: app.getVersion(), notes: notesList(info.releaseNotes), theme })})`);
  // 正在下载 / 已下完待安装时重新打开（下载中关不掉，保险起见）：直接显示进度
  if (updDownloading || updInstalling) run(`progress(${updInstalling ? 100 : updPercent})`);
  dlg.show();
  dlg.focus();
}

// ── 主流程 ─────────────────────────────────────────────────
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  rotateLogs();
  // 启动画面期间（mainWin 还没建）双击图标：聚焦启动画面
  app.on('second-instance', () => {
    const w = mainWin && !mainWin.isDestroyed() ? mainWin : splash && !splash.isDestroyed() ? splash : null;
    if (!w) return;
    if (w.isMinimized()) w.restore();
    if (w !== splash || splashReady) w.show();
    w.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { quitting = true; stopServer(); });
  process.on('exit', stopServer);

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    const t0 = Date.now();
    showSplash();
    try {
      port = await pickPort();
      splashMsg('正在启动');
      startServer();
      if (!(await waitHealthy())) throw new Error(`本地服务没有起来，日志：${serverLog}`);
      // 桌面模式不注册 service worker；每次启动把这两类清掉（清了无害，旧 origin 的残留也一并清走）。
      // 只清这两类：localStorage（主题等偏好，固定端口后就靠它）不动
      await session.defaultSession.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] })
        .catch((e) => log('清理 service worker 缓存失败（不影响使用）', String(e?.message || e)));
      const win = createWindow();
      await win.loadURL(origin + '/');
      log(`启动完成 ${Date.now() - t0}ms`);
      writeState({ lastStartupMs: Date.now() - t0 });
      if (process.env.MORA_SHOT) {
        // 等首屏画完再截（水合 + 字体）
        setTimeout(async () => {
          try { writeFileSync(process.env.MORA_SHOT, (await win.webContents.capturePage()).toPNG()); log('已截图', process.env.MORA_SHOT); }
          catch (e) { log('截图失败', String(e?.message || e)); }
        }, 1500);
      }
      setTimeout(checkAppUpdate, 1500);
    } catch (e) {
      fatal('MoraTV 启动失败', String(e?.message || e));
    }
  });
}

// 测试钩子：MORA_TEST_HOOKS=1 时把几个内部量挂到 global，供 electron.evaluate 读
if (process.env.MORA_TEST_HOOKS === '1') {
  globalThis.__mora = { home: HOME, logs: LOGS, port: () => port, serverPid: () => server?.pid ?? null };
}
