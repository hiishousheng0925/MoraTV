<script>
  /**
   * 站内确认框。
   *
   * 替掉原生 confirm()：那个弹窗顶着「100.x.x.x:3000 says」这种浏览器自带的
   * 标题，样式不跟主题、按钮是英文的 OK/Cancel，在自己的站里看着像被别人接管了。
   * 用法：父组件拿一个 $state 存待确认的动作，确认后调它。
   *
   * 手机（<640px）改用底部抽屉 Sheet：按钮在拇指够得着的地方，整行宽；桌面仍是居中对话框。
   * 这也是「手机 Sheet / 桌面弹层」的参考写法：内容写成一个 snippet，两边共用。
   */
  import Sheet from './Sheet.svelte';
  import { media } from '$lib/media.svelte.js';
  let { open = false, title, body = null, confirmLabel = '确认',
        danger = false, onconfirm, oncancel } = $props();

  let btn = $state(null);
  // 打开时把焦点落到确认键：回车即确认、Esc 取消，和原生弹窗的键盘习惯一致
  $effect(() => { if (open && btn) btn.focus(); });
  const okCls = $derived(danger ? 'bg-danger-fill text-white' : 'bg-accent text-on-accent');
</script>

{#snippet content(mobile)}
  <div class="text-[15px] font-medium">{title}</div>
  {#if body}<div class="mt-1.5 text-[13px] text-ink-400">{body}</div>{/if}
  <div class={mobile ? 'mt-5 grid grid-cols-2 gap-2' : 'mt-4 flex justify-end gap-2'}>
    <button onclick={() => oncancel?.()}
            class="rounded-lg border border-ink-600 bg-ink-900 px-3.5 py-2 text-[13px] text-ink-200 {mobile ? 'h-11 text-[14px]' : ''}">取消</button>
    <button bind:this={btn} onclick={() => onconfirm?.()}
            class="rounded-lg px-3.5 py-2 text-[13px] font-medium {okCls} {mobile ? 'h-11 text-[14px]' : ''}">{confirmLabel}</button>
  </div>
{/snippet}

<svelte:window onkeydown={(e) => open && !media.mobile && e.key === 'Escape' && oncancel?.()} />

{#if media.mobile}
  <Sheet {open} label={title} onclose={() => oncancel?.()}>
    <div class="pt-1">{@render content(true)}</div>
  </Sheet>
{:else if open}
  <!-- 点遮罩=取消。stopPropagation 让面板内部的点击不冒泡到遮罩 -->
  <div class="fixed inset-0 z-[95] flex items-center justify-center bg-black/50 p-4"
       role="presentation" onclick={() => oncancel?.()}>
    <div role="dialog" aria-modal="true" aria-label={title}
         onclick={(e) => e.stopPropagation()}
         class="card w-full max-w-sm rounded-xl p-4">
      {@render content(false)}
    </div>
  </div>
{/if}
