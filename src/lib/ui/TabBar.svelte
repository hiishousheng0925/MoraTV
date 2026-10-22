<script>
  /**
   * 页内标签切换（片库的「观看历史 / 想看」之类）。横排胶囊，当前项 accent 淡底。
   *
   * props
   *   tabs    [{ key, label, count? }]    count 是跟在文字后的弱色小数字
   *   value   当前项的 key
   *   onpick  点标签的回调 (key)
   *   label   给读屏的名字                 默认 '标签'
   * 例：<TabBar tabs={[{ key: 'history', label: '观看历史' }, { key: 'fav', label: '想看', count: 3 }]} value={tab} onpick={(k) => (tab = k)} />
   */
  let { tabs = [], value = '', onpick, label = '标签' } = $props();
</script>

<div role="tablist" aria-label={label} class="flex gap-1 border-b border-ink-700">
  {#each tabs as t (t.key)}
    {@const on = t.key === value}
    <button type="button" role="tab" aria-selected={on} onclick={() => onpick?.(t.key)}
            class="relative -mb-px flex items-center gap-1.5 border-b-2 px-3.5 py-2 text-[14px] transition
                   {on ? 'border-accent font-semibold text-ink-100' : 'border-transparent text-ink-400 hover:text-ink-200'}">
      {t.label}
      {#if t.count != null}<span class="text-[12px] font-normal text-ink-400">{t.count}</span>{/if}
    </button>
  {/each}
</div>
