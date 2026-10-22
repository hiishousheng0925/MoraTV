/**
 * 推荐 / 演员作品卡片的片源可用性：懒加载 /api/available?key=（服务端缓存 1 天）。
 * 整个页面共用一个队列（并发 2），同一部只查一次；查到 false 的变灰加角标。
 *
 *   import { avail, watchAvail } from '$lib/avail.svelte.js';
 *   <div use:watchAvail={keys}>…</div>   区块进入视口才开始查
 *   avail.of(key)  -> true | false | null（还没查 / 没查出来）
 */
const state = $state({});
const queue = [];
const asked = new Set();
let running = 0;
const CONCURRENCY = 2;

function pump() {
  while (running < CONCURRENCY && queue.length) {
    const key = queue.shift();
    running++;
    fetch(`/api/available?key=${encodeURIComponent(key)}`)
      .then((r) => r.json())
      .then((j) => { if (j.available != null) state[key] = j.available; })
      .catch(() => {})
      .finally(() => { running--; pump(); });
  }
}

/** @param {string[]} keys */
export function check(keys) {
  for (const k of keys) {
    if (!k || asked.has(k) || !/^(tv|movie)-\d+$/.test(k)) continue;
    asked.add(k);
    queue.push(k);
  }
  pump();
}

export const avail = { of: (key) => state[key] ?? null };

/** Svelte action：节点进入视口后查这一组 key */
export function watchAvail(node, keys) {
  let cur = keys || [];
  const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) check(cur); }, { rootMargin: '200px' });
  io.observe(node);
  return {
    update(k) { cur = k || []; const r = node.getBoundingClientRect(); if (r.top < innerHeight + 200 && r.bottom > -200) check(cur); },
    destroy() { io.disconnect(); },
  };
}
