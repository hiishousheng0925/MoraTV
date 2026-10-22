<script>
  /**
   * 进度条。
   *
   * props
   *   current / total  当前 / 总量；total 为空不渲染                     必填
   *   h                高度 class                                         默认 'h-1'
   *   variant          'default'（accent 实色，首页等现有用法）
   *                    | 'glow'（accent → 暖色的渐变 + 柔光）  默认 'default'
   *   extra            接在已完成那段后面的一小段（淡色），表示「这一批 / 待提交」   默认 0
   * 宽度变化 300ms 过渡（reduced-motion 时 app.css 全局关掉）。
   */
  let { current = 0, total = null, h = 'h-1', variant = 'default', extra = 0 } = $props();
  const pct = $derived(total ? Math.min(100, ((current ?? 0) / total) * 100) : 0);
  const extraPct = $derived(total ? Math.min(100 - pct, ((extra ?? 0) / total) * 100) : 0);
</script>

{#if total}
  {#if variant === 'glow'}
    <div class="{h} flex w-full overflow-hidden rounded-full bg-ink-700">
      <div class="h-full rounded-full bg-gradient-to-r from-accent to-brand-2 shadow-[0_0_10px_var(--c-accent)] transition-[width] duration-300"
           style="width:{pct}%"></div>
      {#if extraPct > 0}
        <div class="-ml-1 h-full rounded-r-full bg-brand-2/40 pl-1 transition-[width] duration-300"
             style="width:max(calc({extraPct}% + 0.25rem), 0.625rem)"></div>
      {/if}
    </div>
  {:else}
    <div class="{h} w-full overflow-hidden rounded bg-ink-700">
      <div class="h-full bg-accent transition-all" style="width:{pct}%"></div>
    </div>
  {/if}
{/if}
