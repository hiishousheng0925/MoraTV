<script>
  /**
   * 设置页的一组（2026-10 UI 大改，Apple 设置式）：组标题在卡片外，每组一张卡，卡内各行之间 1px 分隔。
   * 行自己写 px-4 py-3（或用 ROW 常量）；分隔线由这里的 divide-y 统一画，行里不用再写 border。
   *   id      锚点（左侧目录 / IntersectionObserver 用）
   *   title   组标题
   *   extra   标题右侧的附加（snippet，如 InfoTip）
   */
  let { id, title, extra, children } = $props();
</script>

<section {id} data-sec class="scroll-mt-20">
  <h2 class="mb-2 flex items-center gap-1.5 px-1 text-[13px] font-semibold text-ink-400">{title}{@render extra?.()}</h2>
  <div class="card divide-y divide-ink-700 rounded-2xl">{@render children()}</div>
</section>
