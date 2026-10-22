#!/usr/bin/env node
/**
 * 把 desktop/icon.svg 渲染成客户端图标：desktop/assets/icon.ico（16–256 多尺寸）+ icon.png（256，给安装包 / 窗口用）。
 * 图标改了才需要重跑，产物进仓库。
 *
 *   node tools/make-icon.js
 *
 * 渲染用开发依赖里的 Electron（隐藏窗口截图），不依赖本机装了什么浏览器：
 * 用 node 跑时自己再起一个 Electron 进程执行本文件；在 Electron 里跑时才真正画图。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'desktop', 'assets');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

if (!process.versions.electron) {
  const exe = join(ROOT, 'desktop', 'node_modules', 'electron', 'dist', 'electron.exe');
  if (!existsSync(exe)) { console.error('先装桌面依赖：npm --prefix desktop install'); process.exit(1); }
  // 只要 ELECTRON_RUN_AS_NODE 存在（哪怕是空串）Electron 就当 Node 跑，所以是删掉而不是置空
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(exe, [fileURLToPath(import.meta.url)], { stdio: 'inherit', env });
  process.exit(r.status ?? 1);
}

const { app, BrowserWindow } = await import('electron');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => {});   // 每画完一个尺寸就销毁窗口，别让 Electron 因此退出
// 窗口固定 300：太小的窗口（16px）加载会失败
// 不能在模块顶层 await app.whenReady()：ESM 入口没求值完，Electron 不会进 ready，会互相等死
app.whenReady().then(render).catch((e) => { console.error(e); app.exit(1); });

async function render() {
  const svg = readFileSync(join(ROOT, 'desktop', 'icon.svg'), 'utf8');
  const pngs = [];
  for (const s of SIZES) {
    const win = new BrowserWindow({ width: 300, height: 300, useContentSize: true, show: false, frame: false, transparent: true,
      webPreferences: { sandbox: true } });
    const sized = svg.replace('<svg ', `<svg width="${s}" height="${s}" style="display:block" `);
    const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${sized}</body></html>`;
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise((r) => setTimeout(r, 300));
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: s, height: s });
    pngs.push(img.resize({ width: s, height: s }).toPNG());
    win.destroy();
  }

  // ICO：6 字节头 + 每张 16 字节目录项 + PNG 数据（Vista 起支持 PNG 编码的图标项）
  const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(SIZES.length, 4);
  const dir = Buffer.alloc(16 * SIZES.length);
  let off = 6 + dir.length;
  SIZES.forEach((s, i) => {
    const e = i * 16;
    dir.writeUInt8(s >= 256 ? 0 : s, e); dir.writeUInt8(s >= 256 ? 0 : s, e + 1);
    dir.writeUInt16LE(1, e + 4); dir.writeUInt16LE(32, e + 6);
    dir.writeUInt32LE(pngs[i].length, e + 8); dir.writeUInt32LE(off, e + 12);
    off += pngs[i].length;
  });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'icon.ico'), Buffer.concat([head, dir, ...pngs]));
  writeFileSync(join(OUT, 'icon.png'), pngs[pngs.length - 1]);
  console.log(`已生成 desktop/assets/icon.ico（${SIZES.join('/')}）和 icon.png`);
  app.quit();
}
