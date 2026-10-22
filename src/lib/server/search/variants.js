/** 搜索词的简繁变体（设计文档 §6.1 第 1 步）：原词 + 简体 + 繁体（台湾字形），去重。 */
import * as OpenCC from 'opencc-js';
import { toSimplified } from './normalize.js';

const s2t = OpenCC.Converter({ from: 'cn', to: 'tw' });

/** @param {string} q @returns {string[]} */
export function variants(q) {
  const o = String(q ?? '').trim();
  if (!o) return [];
  const s = toSimplified(o);
  return [...new Set([o, s, s2t(s)])];
}
