/**
 * Host 头检查（hooks.server.js 用），防 DNS 重绑定：
 * 恶意网页把自己的域名重绑到 127.0.0.1 后会和本服务「同源」，能直接读 /api/settings 里的两个 key。
 * 这时请求的 Host 是对方域名，所以只放行回环名。
 *
 *   · 设了 ORIGIN（桌面端 / 生产）：Host 必须是 127.0.0.1:<端口> 或 localhost:<端口>，端口取自 ORIGIN
 *   · 没设（vite dev / 测试）：127.0.0.1 / localhost / [::1] 任意端口
 * @param {string|null|undefined} host 请求的 Host 头
 * @param {string|null|undefined} origin process.env.ORIGIN
 * @returns {string|null} 拒绝原因；null = 放行
 */
export function hostReject(host, origin) {
  const h = String(host || '').toLowerCase();
  const m = h.match(/^(127\.0\.0\.1|localhost|\[::1\])(?::(\d{1,5}))?$/);
  if (!m) return 'Host 不允许';
  if (!origin) return null;
  let u;
  try { u = new URL(origin); } catch { return null; }
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  return (m[2] || port) === port ? null : 'Host 不允许';
}
