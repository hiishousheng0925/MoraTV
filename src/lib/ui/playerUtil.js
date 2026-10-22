/**
 * Player.svelte 的纯工具（2026-10-21 从组件里拆出来：组件贴着 400 行上限）
 */

/** 倍速 / 音量 / 超分档位记在 localStorage（个人偏好，丢了也只是回到默认；隐私模式下读写都可能抛） */
export const store = {
  get: (k, d) => { try { const v = localStorage.getItem(`moratv.player.${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(`moratv.player.${k}`, JSON.stringify(v)); } catch { /* 隐私模式 */ } }
};

/** 秒 → 「m:ss」/「h:mm:ss」 */
export const fmt = (s) => {
  if (!Number.isFinite(s)) return '0:00';
  s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(x).padStart(2, '0')}`;
};
