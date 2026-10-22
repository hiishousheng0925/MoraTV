/**
 * 全局 toast（唯一的操作反馈出口）。右下角，从右侧滑入，自动消失，同屏最多 5 条。
 *
 *   import { toast } from '$lib/ui/toast.svelte.js';
 *   toast.ok('已加入想看');  toast.error('线路加载失败');
 *
 * 界面里不弹 alert / confirm 等系统弹窗，反馈一律走这里。
 * 渲染处只有一个：根布局里的 Toaster.svelte。
 */
import { pushCapped } from './toastQueue.js';

let items = $state([]);
let seq = 0;

function push(text, tone) {
  const id = ++seq;
  // 挤掉最旧的：同一条提示连点会一直堆，实测堆到 9 条时从右下角铺到了页面顶部
  items = pushCapped(items, { id, text, tone });
  setTimeout(() => dismiss(id), tone === 'error' ? 6000 : 3200);
}

export const toast = {
  get items() { return items; },
  ok: (text) => push(text, 'ok'),
  // 调用方传 { cancelled: true } 表示用户自己取消了，不算出错，不弹
  error: (text) => { if (!text?.cancelled) push(String(text?.message ?? text), 'error'); }
};
export const dismiss = (id) => { items = items.filter((x) => x.id !== id); };
