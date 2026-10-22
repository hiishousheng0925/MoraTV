/**
 * 响应式断点（2026-10 UI 大改，foundation）。组件要「手机一套、桌面一套」时从这里拿，别各自写 matchMedia。
 *
 *   import { media } from '$lib/media.svelte.js';
 *   {#if media.mobile}<Sheet …>…</Sheet>{:else}<原来的弹层 / 对话框>{/if}
 *
 * - media.mobile：视口 < 640px（和 Tailwind 的 max-sm 同一条线）
 * - media.wide：视口 ≥ 1024px（Tailwind 的 lg:）—— 根布局用它分「桌面侧栏 / 抽屉侧栏」
 * - media.reducedMotion：系统开了「减少动态效果」（JS 动画 / transition 参数用；CSS 那边 app.css 已全局处理）
 * 服务端渲染时一律按桌面 / 不减动效算（false），水合后立即按真实视口更新。
 * 只是「样式不同」就直接用 Tailwind 的 max-sm: / sm:，不需要这个 —— 这里是给「结构不同」（换组件）用的。
 */
import { MediaQuery } from 'svelte/reactivity';

const mobileQ = new MediaQuery('(max-width: 639px)', false);
const wideQ = new MediaQuery('(min-width: 1024px)', false);
const reducedQ = new MediaQuery('(prefers-reduced-motion: reduce)', false);

export const media = {
  get mobile() { return mobileQ.current; },
  get wide() { return wideQ.current; },
  get reducedMotion() { return reducedQ.current; }
};
