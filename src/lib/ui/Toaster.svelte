<script>
  /**
   * toast 的唯一渲染处，挂在根布局。见 $lib/ui/toast.svelte.js（调用方只用 toast.ok / toast.error）。
   *
   * 桌面：右下角，从右侧滑入。手机（<640px）：底部居中宽条（左右 16px、避开 safe-area），从下方滑入，
   * 并浮在手机底部标签栏之上 —— 标签栏高度由框架在 :root 上设 --tabbar-h（app.css 里默认 0）。
   * 外观：卡片底（bg-ink-900 + 边框，不直接用 .card —— 它在 @layer 外，会压掉这里的投影和红描边）+ 明显投影，左侧图标（成功 CheckCircle / 错误 WarningCircle）；错误只用 danger 色描边和图标，
   * 不整块涂红（红底白字在亮色主题里太刺眼，暗色下又和正文抢）。
   */
  import { fly } from 'svelte/transition';
  import CheckCircle from 'phosphor-svelte/lib/CheckCircle';
  import WarningCircle from 'phosphor-svelte/lib/WarningCircle';
  import { toast, dismiss } from '$lib/ui/toast.svelte.js';
  import { media } from '$lib/media.svelte.js';
  const motion = $derived(media.mobile ? { y: 16 } : { x: 24 });
</script>

{#if toast.items.length}
  <div class="pointer-events-none fixed z-[100] flex flex-col gap-2
              bottom-[calc(1rem+var(--tabbar-h)+env(safe-area-inset-bottom))] inset-x-4 items-stretch
              md:inset-x-auto md:bottom-4 md:right-4 md:items-end"
       role="status" aria-live="polite">
    {#each toast.items as t (t.id)}
      <!-- 带 action 的整条是链接（「去设置 →」），否则是点了就关的按钮 -->
      <svelte:element this={t.action ? 'a' : 'button'} href={t.action?.href} role={t.action ? 'link' : 'button'} tabindex="0" onclick={() => dismiss(t.id)}
              in:fly={{ ...motion, duration: 180 }} out:fly={{ ...motion, duration: 140 }}
              class="pointer-events-auto flex items-start gap-2.5 rounded-xl border bg-ink-900 px-3.5 py-3 text-left text-[13.5px] leading-snug
                     shadow-[0_12px_32px_-8px_rgb(0_0_0/0.45),0_2px_6px_rgb(0_0_0/0.18)] sm:max-w-[22rem]
                     {t.tone === 'error' ? 'border-danger/60' : 'border-ink-700'}">
        {#if t.tone === 'error'}
          <WarningCircle size={18} weight="fill" class="mt-px shrink-0 text-danger" aria-hidden="true" />
        {:else}
          <CheckCircle size={18} weight="fill" class="mt-px shrink-0 text-live-ink" aria-hidden="true" />
        {/if}
        <span class="min-w-0">{t.text}</span>
        {#if t.action}<span class="ml-1 shrink-0 font-medium text-accent-ink">{t.action.label} →</span>{/if}
      </svelte:element>
    {/each}
  </div>
{/if}
