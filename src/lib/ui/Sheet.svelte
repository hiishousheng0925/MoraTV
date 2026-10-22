<script>
  /**
   * 手机底部抽屉（bottom sheet）。贴底、顶部圆角 20px、拖动条；背后压暗 + 轻微模糊。
   * 关闭方式：点遮罩 / Esc / 把拖动条（或标题行）往下拖过 80px 或快速下甩 / 右上角「完成」（传了 done 时）。
   * 打开时锁背景滚动、焦点移进抽屉（Tab 在抽屉内循环），关闭后焦点还给打开前的元素。
   * 节点挂到 <body> 下（避免被带 transform / backdrop-filter 的祖先困住 fixed 定位）。
   *
   * props
   *   open      是否打开（可 bind:open）                                          默认 false
   *   onclose   关闭时回调（点遮罩 / Esc / 下拉 / 完成都会调；同时把 open 置 false）
   *   title     标题行文字；不传就只有拖动条                                      默认 null
   *   done      标题行右侧的完成键文字（如「完成」），点了等同关闭；不传不显示        默认 null
   *   label     无 title 时给读屏的名字                                           默认 title
   *   maxh      最大高度（CSS 值），内容超出在抽屉内滚动                              默认 '80dvh'
   *   children  内容
   *
   * 「手机用 Sheet、桌面用原来的弹层」：
   *   import { media } from '$lib/media.svelte.js';
   *   {#if media.mobile}<Sheet bind:open title="题材" done="完成">{@render body()}</Sheet>
   *   {:else if open}<div class="absolute …">{@render body()}</div>{/if}
   *   （body 写成一个 snippet，两边共用；实例见 Confirm.svelte）
   */
  import { fly, fade } from 'svelte/transition';
  import { cubicOut } from 'svelte/easing';
  import { media } from '$lib/media.svelte.js';

  let { open = $bindable(false), onclose, title = null, done = null, label = null,
        maxh = '80dvh', children } = $props();

  let panel = $state(null);
  let dragY = $state(0);
  let dragging = $state(false);
  const dur = $derived(media.reducedMotion ? 0 : 260);

  function close() {
    if (!open) return;
    open = false;
    onclose?.();
  }

  // 挂到 body：抽屉是全局浮层，不该受所在组件的祖先样式影响
  function portal(node) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }

  // 锁背景滚动 + 焦点进出
  $effect(() => {
    if (!open) return;
    const prevFocus = document.activeElement;
    const html = document.documentElement;
    const prevOverflow = html.style.overflow;
    html.style.overflow = 'hidden';
    queueMicrotask(() => {
      const first = panel?.querySelector('[autofocus], button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      (first ?? panel)?.focus({ preventScroll: true });
    });
    return () => {
      html.style.overflow = prevOverflow;
      if (prevFocus instanceof HTMLElement && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true });
    };
  });

  function onkeydown(e) {
    if (!open) return;
    if (e.key === 'Escape') { e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab' || !panel) return;
    // 焦点圈在抽屉里
    const f = [...panel.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((el) => !el.disabled && el.offsetParent !== null);
    if (!f.length) { e.preventDefault(); return; }
    const [a, z] = [f[0], f[f.length - 1]];
    if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
    else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  }

  // 下拉关闭：只在拖动条 / 标题行上起手，不和内容滚动抢手势
  let startY = 0, startT = 0;
  function down(e) {
    if (e.button !== 0) return;
    dragging = true; startY = e.clientY; startT = performance.now(); dragY = 0;
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function move(e) { if (dragging) dragY = Math.max(0, e.clientY - startY); }
  function up() {
    if (!dragging) return;
    dragging = false;
    const v = dragY / Math.max(1, performance.now() - startT);   // px/ms
    if (dragY > 80 || (dragY > 24 && v > 0.6)) close();
    dragY = 0;
  }
</script>

<svelte:window onkeydown={onkeydown} />

{#if open}
  <div use:portal class="fixed inset-0 z-[96]">
    <div class="absolute inset-0 bg-black/55 backdrop-blur-[2px]" role="presentation"
         transition:fade={{ duration: dur * 0.8 }} onclick={close}></div>
    <div bind:this={panel} role="dialog" aria-modal="true" aria-label={label ?? title} tabindex="-1"
         transition:fly={{ y: 480, duration: dur, easing: cubicOut, opacity: 1 }}
         style="max-height: {maxh}; transform: translateY({dragY}px)"
         class="absolute inset-x-0 bottom-0 flex flex-col rounded-t-[20px] border-t border-ink-600 bg-ink-800
                shadow-[0_-20px_50px_rgb(0_0_0/0.45)] outline-none
                {dragging ? '' : 'transition-transform duration-200'}">
      <div class="shrink-0 touch-none select-none px-4 pt-2 {title ? 'pb-1' : 'pb-2'}"
           onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}>
        <div class="mx-auto h-1 w-10 rounded-full bg-ink-600"></div>
        {#if title || done}
          <div class="mt-2.5 flex min-h-9 items-center justify-between gap-3">
            <div class="text-[16px] font-semibold">{title ?? ''}</div>
            {#if done}<button type="button" onclick={close} onpointerdown={(e) => e.stopPropagation()}
                              class="tap -mr-2 rounded-lg px-2 text-[14px] font-medium text-accent">{done}</button>{/if}
          </div>
        {/if}
      </div>
      <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {@render children?.()}
      </div>
    </div>
  </div>
{/if}
