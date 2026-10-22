<script>
  /**
   * 下拉选择。用站内样式而不是原生 <select> —— 原生控件在两个主题下都跟不上
   * （箭头、字号、圆角都是系统给的），而且 e2e 第 19 条盯着不许出现原生 select。
   *
   * opts 是 [值, 显示文案][]；value 用空串表示「默认/不限」这类空值。
   */
  let { opts = [], value = '', label = '', w = '8rem', onpick } = $props();

  let open = $state(false);
  /** 往上展开：下方放不下菜单时（悬浮在视口底部的分页里的「每页」，原来展开到屏幕外） */
  let up = $state(false);
  let root;
  function toggle() {
    if (!open && root) {
      const r = root.getBoundingClientRect(), need = opts.length * 30 + 16;
      up = innerHeight - r.bottom < need && r.top > innerHeight - r.bottom;
    }
    open = !open;
  }
  const cur = $derived(opts.find(([v]) => String(v) === String(value))?.[1] ?? opts[0]?.[1] ?? '');
  function onDoc(e) { if (open && !root?.contains(e.target)) open = false; }
  const pick = (v) => { open = false; onpick?.(String(v)); };
</script>

<svelte:document onclick={onDoc} />
<svelte:window onkeydown={(e) => e.key === 'Escape' && (open = false)} />

<span bind:this={root} class="relative inline-flex">
  <button type="button" onclick={toggle} aria-haspopup="listbox" aria-expanded={open}
          aria-label={label}
          class="flex items-center gap-1.5 rounded-lg border border-ink-600 bg-ink-900 px-2.5 py-1.5
                 text-[13px] text-ink-200 transition hover:border-ink-400 hover:bg-ink-800">
    {cur}
    <svg viewBox="0 0 12 12" class="h-3 w-3 opacity-60" fill="none" stroke="currentColor" stroke-width="1.6">
      <path d="M3 4.5 6 7.5 9 4.5" />
    </svg>
  </button>

  {#if open}
    <div role="listbox" style="min-width:{w}"
         class="absolute right-0 z-50 overflow-hidden rounded-lg border border-ink-600 {up ? 'bottom-full mb-1' : 'top-full mt-1'}
                bg-ink-800 py-1 shadow-2xl">
      {#each opts as [v, l]}
        <button type="button" role="option" aria-selected={String(v) === String(value)}
                onclick={() => pick(v)}
                class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition
                       {String(v) === String(value) ? 'text-accent' : 'text-ink-200 hover:bg-ink-700'}">
          <span class="w-3 text-[11px]">{String(v) === String(value) ? '✓' : ''}</span>{l}
        </button>
      {/each}
    </div>
  {/if}
</span>
