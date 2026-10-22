/**
 * 写接口的跨站防护（hooks.server.js 用）。
 *
 * SvelteKit 自带的 origin 检查只拦表单类 content-type；跨站页面用 fetch(no-cors) 发一个不带 Content-Type 的 POST
 * 能绕过它，把 llm_base 改到别人的服务器、顺手把 llm_key 带走。本机服务虽然只听 127.0.0.1，但用户浏览器里任何网页都能打到。
 *
 * 规则（只管 /api/* 的非 GET / HEAD）：
 *   · 带 Origin：必须和本服务同源
 *   · 不带 Origin（非浏览器客户端）：POST / PUT / PATCH 必须是 application/json（跨站要发它就得先过 CORS 预检，而我们不回 CORS 头）
 *   · 有请求体的方法一律要求 application/json
 * @param {{method: string, pathname: string, origin: string|null, contentType: string|null, selfOrigin: string}} r
 * @returns {string|null} 拒绝原因；null = 放行
 */
export function csrfReject({ method, pathname, origin, contentType, selfOrigin }) {
  const m = String(method || 'GET').toUpperCase();
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return null;
  if (!pathname.startsWith('/api/')) return null;
  if (origin && origin !== selfOrigin) return '跨站请求';
  const json = /^application\/json\b/i.test(String(contentType || '').trim());
  if ((m === 'POST' || m === 'PUT' || m === 'PATCH') && !json) return '需要 application/json';
  return null;
}
