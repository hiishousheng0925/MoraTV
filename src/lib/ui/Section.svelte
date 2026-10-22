<script>
  /**
   * 页面里的一个区块：标题行 + 内容。全站在用（首页 / 详情 / 统计……）。
   *
   * props
   *   title       标题（17px semibold 正文色）                                    必填
   *   count       跟在标题后的弱色小数字（不要再写「标题（5）」）；null 不显示       默认 null
   *   hint        标题下一行的极短附注（范围 / 口径），不写成句                       默认 null
   *   action      右侧文字动作，如「全部 →」；配 actionHref 是链接，否则是弱色文字    默认 null
   *   actionHref  action 的链接                                                     默认 null
   *   actions     右侧自定义动作区（snippet，优先于 action），放按钮 / 切换等
   *   first       去掉上外边距（页面的第一个区块 / 放在网格单元里不需要隔开时）       默认 false
   *   children    内容
   * 例：<Section title="我在追的" count={items.length} action="全部 →" actionHref="/mine?status=watching">…</Section>
   *     <Section title="推荐">{#snippet actions()}<button …>换一批</button>{/snippet}…</Section>
   */
  let { title, count = null, hint = null, action = null, actionHref = null, actions = null,
        first = false, children } = $props();
</script>

<section class={first ? '' : 'mt-8 sm:mt-9'}>
  <div class="flex min-h-7 items-center justify-between gap-3">
    <h2 class="flex min-w-0 items-baseline gap-2 text-[17px] font-semibold leading-tight">
      <span class="truncate">{title}</span>
      {#if count != null}<span class="shrink-0 text-[13px] font-normal text-ink-400">{count}</span>{/if}
    </h2>
    {#if actions}<div class="flex shrink-0 items-center gap-2">{@render actions()}</div>
    {:else if action && actionHref}<a href={actionHref} class="shrink-0 text-[13px] text-accent hover:underline">{action}</a>
    {:else if action}<span class="shrink-0 text-[13px] text-ink-400">{action}</span>{/if}
  </div>
  {#if hint}<p class="mt-1 text-[12px] text-ink-400">{hint}</p>{/if}
  <div class="mt-3">{@render children()}</div>
</section>
