<script>
  /**
   * 内容区的统一外框 —— 宽度和左右留白只在这个文件里定义一次。
   *
   * 之前十个页面各写一遍 mx-auto max-w-* px-4 py-5，攒出 3xl / 5xl / 6xl / 7xl
   * 四种宽度：在侧栏点来点去时，内容区的左右边界跟着一起跳。
   *
   * narrow 给表单页（设置）用：输入框拉到 1280 px 宽没法看，正文另外收窄，
   * 但外框宽度和别的页一致，所以切页时框架不动。
   *
   * fill 给带浮动分页器（<Pager sticky>）的列表页用：外框至少一屏高（减顶栏 --hdr-h 和手机底部标签栏）、
   * 纵向 flex，分页器 mt-auto 落到屏幕底部。原来结果少（排行榜筛到 2027 只有 1 部）时分页器就跟在
   * 那一行下面、浮在屏幕中间 —— sticky 只会把它往上推到视口底，不会往下推（主人 2026-10-21）。
   */
  let { narrow = false, fill = false, cls = '', children } = $props();
</script>

<!-- fill 时底部留白 12px：和分页器浮动时离视口底的距离（Pager 的 bottom-[0.75rem…]）一致，短页长页停在同一处 -->
<div class="mx-auto w-full max-w-7xl px-4 pt-5 {fill ? 'pb-3' : 'pb-5'} {cls}
            {fill ? 'flex min-h-[calc(100dvh-var(--hdr-h)-var(--tabbar-h)-env(safe-area-inset-bottom))] flex-col' : ''}">
  {#if narrow}
    <div class="max-w-3xl">{@render children()}</div>
  {:else}
    {@render children()}
  {/if}
</div>
