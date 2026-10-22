/**
 * 「看完了没有」的唯一定义（服务端 library.js 和播放页共用）：
 * ≥90%，或剩余不到 3 分钟（剩余规则只在看过一半之后才算，免得几分钟的短剧一打开就算看完）。
 * @param {number} position @param {number} duration
 */
export function isFinished(position, duration) {
  const p = Number(position) || 0, d = Number(duration) || 0;
  if (d <= 0 || p <= 0) return false;
  if (p / d >= 0.9) return true;
  return d - p < 180 && p / d >= 0.5;
}
