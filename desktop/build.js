#!/usr/bin/env node
/**
 * 客户端构建 / 打包。
 *
 *   node desktop/build.js            组装 desktop/.stage/app（站点产物 + 主进程 + 生产依赖）
 *   node desktop/build.js --dist     组装后用 electron-builder 打 NSIS 安装包 + 便携版 -> desktop/dist/
 *   node desktop/build.js --run      组装后直接用开发依赖里的 Electron 跑起来
 *   --skip-vite                      复用上次的站点产物（只改了 desktop/ 时省一次构建）
 *
 * 组装出来的 app 目录：
 *   build/            vite build 的 adapter-node 产物（BUILD_OUT 指过来，不是仓库根的 build/）
 *   desktop/          主进程代码
 *   node_modules/     根 package.json 的 dependencies 里服务产物真正 import 到的那几个（版本钉成仓库根当前装的那一版）+ electron-updater
 *   package.json      生成的（main = desktop/main.js）
 *
 * 环境变量：MORA_GITHUB_REPO=owner/repo  打包时写进更新源（只在要启用自动更新时才设；缺省不写 = 没有更新源）
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const STAGE = join(HERE, '.stage', 'app');
const DIST = join(HERE, 'dist');
const args = process.argv.slice(2);
const has = (f) => args.includes(f);

const rootPkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const deskPkg = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8'));
const VERSION = deskPkg.version;
// 更新弹窗里显示的那几行（main.js 的 promptUpdate）：打包时写进 latest.yml 的 releaseNotes。每个版本都要写，没写就不让打包
const NOTES = JSON.parse(readFileSync(join(HERE, 'release-notes.json'), 'utf8'))[VERSION];
const t0 = Date.now();
const step = (m) => console.log(`\n▶ ${m}（${((Date.now() - t0) / 1000).toFixed(0)}s）`);

function run(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, { stdio: 'inherit', ...opts });
  if (r.status !== 0) { console.error(`✖ ${cmd} ${argv.join(' ')} 失败（exit ${r.status}）`); process.exit(1); }
}

// ── 1. 站点产物 ───────────────────────────────────────────
const BUILD = join(STAGE, 'build');
if (!has('--skip-vite') || !existsSync(join(BUILD, 'index.js'))) {
  step('vite build -> .stage/app/build');
  rmSync(STAGE, { recursive: true, force: true });
  mkdirSync(STAGE, { recursive: true });
  run(process.execPath, [join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), 'build'],
    { cwd: ROOT, env: { ...process.env, BUILD_OUT: BUILD } });
}

// ── 2. 主进程代码 ─────────────────────────────────────────
step('主进程代码 + package.json');
rmSync(join(STAGE, 'desktop'), { recursive: true, force: true });
mkdirSync(join(STAGE, 'desktop'), { recursive: true });
for (const f of ['main.js', 'guard.mjs', 'update.html', 'preload.cjs'])
  cpSync(join(HERE, f), join(STAGE, 'desktop', f));
cpSync(join(HERE, 'assets'), join(STAGE, 'desktop', 'assets'), { recursive: true });

// 运行时真正要装的依赖：服务端产物里实际 import 到的那几个。
// 已被 vite 打进前端包的（phosphor-svelte、hls.js 这类）服务产物里没有引用，装进去只是多出几千个文件、拖慢便携版每次启动的解包
const serverJs = [];
const walk = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) {
  const p = join(d, f.name);
  if (f.isDirectory()) walk(p); else if (f.name.endsWith('.js')) serverJs.push(readFileSync(p, 'utf8'));
} };
walk(join(BUILD, 'server')); for (const f of ['index.js', 'handler.js']) if (existsSync(join(BUILD, f))) serverJs.push(readFileSync(join(BUILD, f), 'utf8'));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const used = (dep) => {
  // import('x').Foo 是 JSDoc 里的类型标注，不算
  const re = new RegExp(`(?:from\\s*|import\\s*\\(\\s*)['"]${esc(dep)}(?:/[^'"]*)?['"](?!\\s*\\)\\s*\\.)`);
  return serverJs.some((t) => re.test(t));
};
const deps = rootPkg.dependencies ?? {};
const runtimeDeps = Object.keys(deps).filter(used);
console.log(`  运行时依赖：${runtimeDeps.join(', ') || '无'}；不装（已打进前端包 / 未用到）：${Object.keys(deps).filter((d) => !runtimeDeps.includes(d)).join(', ') || '无'}`);
// 版本钉成仓库根 node_modules 里实际装的那一版（和开发时测过的一致）
const pinned = Object.fromEntries(runtimeDeps.map((d) => {
  const p = join(ROOT, 'node_modules', d, 'package.json');
  return [d, existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')).version : deps[d]];
}));
const appPkg = {
  name: 'moratv', productName: 'MoraTV', version: VERSION,
  description: deskPkg.description, author: deskPkg.author, license: deskPkg.license,
  type: 'module', main: 'desktop/main.js',
  engines: rootPkg.engines,
  dependencies: { ...pinned, ...deskPkg.appDependencies }
};
writeFileSync(join(STAGE, 'package.json'), JSON.stringify(appPkg, null, 2));
// /api/health 读 cwd 下的 RELEASE.json 报版本
writeFileSync(join(STAGE, 'RELEASE.json'), JSON.stringify({ name: `MoraTV ${VERSION}` }));

// ── 3. 生产依赖 ───────────────────────────────────────────
const depKey = JSON.stringify(appPkg.dependencies);
const stampFile = join(STAGE, 'node_modules', '.mora-deps');
if (!existsSync(stampFile) || readFileSync(stampFile, 'utf8') !== depKey) {
  step('npm install --omit=dev（.stage/app）');
  // 直接跑 npm-cli.js：Windows 上 npm 是 .cmd，不经 shell 起不来，经 shell 又有参数拼接的告警
  const npmCli = process.env.npm_execpath?.endsWith('.js') ? process.env.npm_execpath
    : join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  run(process.execPath, [npmCli, 'install', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock'], { cwd: STAGE });
  writeFileSync(stampFile, depKey);
}

const sizeOf = (p) => { const s = statSync(p); return s.isDirectory() ? readdirSync(p).reduce((a, f) => a + sizeOf(join(p, f)), 0) : s.size; };
console.log(`✔ 组装完成：${STAGE}（${(sizeOf(STAGE) / 1048576).toFixed(0)} MB）`);

const ELECTRON = join(HERE, 'node_modules', 'electron', 'dist', 'electron.exe');
if (has('--run')) {
  step('启动 Electron');
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;   // 只要变量存在（哪怕是空串）Electron 就当 Node 跑
  run(ELECTRON, [STAGE], { env });
}

// ── 4. 打包 ───────────────────────────────────────────────
if (has('--dist')) {
  if (!Array.isArray(NOTES) || !NOTES.length) { console.error(`✖ desktop/release-notes.json 里没有 ${VERSION} 的更新内容`); process.exit(1); }
  step('electron-builder：NSIS 安装包 + 便携版');
  const { build, Platform, Arch } = await import('electron-builder');
  const electronVersion = JSON.parse(readFileSync(join(HERE, 'node_modules', 'electron', 'package.json'), 'utf8')).version;
  // 更新源：只有设了 MORA_GITHUB_REPO=owner/repo 才写（仓库私有时自动更新关闭，不写源）
  const [owner, repo] = (process.env.MORA_GITHUB_REPO || '').split('/');
  const publish = owner && repo ? [{ provider: 'github', owner, repo, releaseType: 'release' }] : undefined;
  await build({
    projectDir: HERE,
    targets: Platform.WINDOWS.createTarget(['nsis', 'portable'], Arch.x64),
    publish: 'never',
    config: {
      appId: 'com.mora.tv',
      productName: 'MoraTV',
      copyright: 'MoraTV',
      electronVersion,
      directories: { app: STAGE, output: DIST, buildResources: join(HERE, 'assets') },
      // 服务子进程（ELECTRON_RUN_AS_NODE）要用普通文件系统读 build/、node_modules/：asar 在那种模式下支持不完整
      asar: false,
      npmRebuild: false,
      // 只留中文 / 英文语言包，其余 Chromium 语言包能省几十 MB
      electronLanguages: ['zh-CN', 'zh-TW', 'en-US'],
      files: ['**/*', '!**/*.map', '!**/{README,CHANGELOG,HISTORY}*.md', '!**/{test,tests,__tests__,docs,example,examples}/**'],
      win: { icon: join(HERE, 'assets', 'icon.ico'), target: ['nsis', 'portable'], artifactName: '${productName}-${version}-${arch}.${ext}' },
      nsis: {
        oneClick: false, perMachine: false, allowToChangeInstallationDirectory: true,
        createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: 'MoraTV',
        artifactName: '${productName}-Setup-${version}.${ext}',
        // 卸载时不删用户数据（库在 %APPDATA%\MoraTV\data 里）
        deleteAppDataOnUninstall: false
      },
      portable: { artifactName: '${productName}-${version}-portable.${ext}' },
      ...(publish ? { publish } : {}),
      releaseInfo: { releaseNotes: NOTES.join('\n') }
    }
  });
  for (const f of readdirSync(DIST).filter((x) => /\.(exe|yml|blockmap)$/.test(x)))
    console.log(`  ${f}  ${(statSync(join(DIST, f)).size / 1048576).toFixed(1)} MB`);
  console.log(`✔ 打包完成（${((Date.now() - t0) / 1000).toFixed(0)}s）-> ${DIST}`);
}
