<script>
  /**
   * 封面网格（海报墙）。列数在 ui/grid.js 里定义一次。
   *
   * props
   *   items      作品数组（字段见 PosterCard）                      必填
   *   variant    'grid'（默认）| 'row'（一行横向滑动，窗口窄时用）
   *   empty      items 为空时显示的 EmptyState 标题；不传则什么都不渲染
   *   emptyIcon  EmptyState 的图标组件（phosphor-svelte）
   *   eager      前 8 张封面立即加载
   * 例：<CardGrid items={rows} empty="没有找到相关作品" />
   */
  import PosterCard from './PosterCard.svelte';
  import EmptyState from './EmptyState.svelte';
  import { CARD_GRID } from './grid.js';
  let { items = [], variant = 'grid', eager = false, empty = null, emptyIcon = undefined } = $props();
</script>

{#if items.length}
  <div class="grid gap-x-3.5 gap-y-5 {CARD_GRID}
              {variant === 'row' ? 'max-sm:-mx-4 max-sm:flex max-sm:snap-x max-sm:snap-mandatory max-sm:gap-3 max-sm:overflow-x-auto max-sm:scroll-px-4 max-sm:px-4 max-sm:pb-1 no-scrollbar' : ''}">
    {#each items as it, i (it.key)}
      {#if variant === 'row'}
        <div class="min-w-0 max-sm:w-[118px] max-sm:shrink-0 max-sm:snap-start">
          <PosterCard item={it} gray={it.gray} eager={eager && i < 8} />
        </div>
      {:else}
        <PosterCard item={it} gray={it.gray} eager={eager && i < 8} />
      {/if}
    {/each}
  </div>
{:else if empty}
  <EmptyState title={empty} icon={emptyIcon} />
{/if}
