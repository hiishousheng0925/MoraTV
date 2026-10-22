import { browser } from '$app/environment';

/** 只有亮/暗两态，默认暗色（不做「跟随系统」） */
const KEY = 'moratv.theme';
export const DEFAULT_THEME = 'dark';

export const readTheme = () => {
  if (!browser) return DEFAULT_THEME;
  const t = localStorage.getItem(KEY);
  return t === 'light' || t === 'dark' ? t : DEFAULT_THEME;
};

export function applyTheme(t) {
  if (!browser) return t;
  const v = t === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = v;
  localStorage.setItem(KEY, v);
  return v;
}
