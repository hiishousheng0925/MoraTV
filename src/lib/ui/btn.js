/**
 * 设置页一类表单的按钮 / 行样式（2026-10 UI 大改）。设置页和它专用的几个卡片组件（账号 / 备份 / 白名单 / 观看站）共用。
 * 禁用态：主按钮改成二级底色 + 弱色字 —— 原来是半透明的 accent，看着像坏掉了而不是「现在不能点」。
 */
export const PRIMARY = `shrink-0 rounded-lg bg-accent px-3.5 py-1.5 text-[13px] font-medium text-on-accent transition
  hover:brightness-110 disabled:bg-ink-800 disabled:text-ink-400 disabled:hover:brightness-100`;
export const SECONDARY = `shrink-0 rounded-lg border border-ink-600 bg-ink-900 px-3 py-1.5 text-[13px] text-ink-200 transition
  hover:border-ink-400 disabled:text-ink-400 disabled:hover:border-ink-600`;
/** 卡片里的一行（分隔线由 Group 的 divide-y 画） */
export const ROW = 'flex items-center justify-between gap-4 px-4 py-3';
/** 输入框 */
export const INPUT = `min-w-0 flex-1 rounded-lg border border-ink-600 bg-ink-950 px-3 py-1.5 text-[13px] text-ink-100 outline-none transition
  focus:border-accent`;

/**
 * 空状态（EmptyState）里的出口按钮。原来六七种写法：目录 / 季度浏览是圆胶囊、排行 / 放送表是方角，
 * 放送表里两处悬停色还不一样（一处 text-accent，一处不变色）。
 *   EXIT  次级出口（「清空搜索」「全部类型」「← 周一 · 3 部」），可以并排好几个
 *   CTA   主出口（「去搜索」），一个空状态最多一个
 */
export const EXIT = `tap inline-flex items-center rounded-full border border-ink-600 bg-ink-900 px-3.5 py-1.5 text-[13px] text-ink-200
  transition hover:border-accent hover:text-accent-ink disabled:opacity-50 disabled:hover:border-ink-600 disabled:hover:text-ink-200`;
export const CTA = `tap inline-flex items-center rounded-xl bg-accent px-4 py-2 text-sm font-medium text-on-accent transition
  hover:brightness-110 active:scale-95`;
