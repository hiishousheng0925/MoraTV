/**
 * 全站导航的单一来源（顶栏用）。顺序：首页 · 浏览 · 片库 · 设置。
 * 图标用 Phosphor 一套（同一笔画粗细），当前页用 fill。
 */
import House from 'phosphor-svelte/lib/House';
import SquaresFour from 'phosphor-svelte/lib/SquaresFour';
import Books from 'phosphor-svelte/lib/Books';
import GearSix from 'phosphor-svelte/lib/GearSix';

export const NAV = [
  { href: '/',         icon: House,       label: '首页' },
  { href: '/browse',   icon: SquaresFour, label: '浏览' },
  { href: '/library',  icon: Books,       label: '片库' },
  { href: '/settings', icon: GearSix,     label: '设置' }
];

/** 当前页是不是这一项（首页只认 /，其余按前缀） */
export const isActive = (href, path) => (href === '/' ? path === '/' : path === href || path.startsWith(href + '/'));
