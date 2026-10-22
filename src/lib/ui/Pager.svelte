<script>
  /**
   * 全站唯一的分页组件。浏览 / 片库 / 搜索结果都用它，
   * 各页只有「每页默认多少条」不一样。
   *
   * 三处返工的理由：
   *   ① 上一页/下一页原来只有边框没有底色，在浅色主题里和背景同色，按钮浮不起来；
   *   ② 655 页只能一页页点，得能直接输入页码；
   *   ③ 排行榜自己写了一排「1–30 / 31–60 …」的分段按钮，页数一多就铺满一行。
   *
   * param 是页码写进 URL 的参数名（目录用 p、时间线用 tl），
   * 所以同一个页面里可以有两处互不干扰的分页。
   */
  import { goto } from '$app/navigation';
  import { PER_OPTS } from '$lib/perOpts.js';
  import Select from './Select.svelte';

  let { page, pages, to, param = 'p', label = '',
        /** 翻页后不回到页面顶部。目录该回顶部（要看新的第一行）；
         *  时间线这类嵌在页面中段的列表，回顶部等于把人甩走。 */
        noScroll = false,
        /** 每页条数：不传就不显示这一组 */
        per = null, perIsDefault = true,
        /** 悬浮：这组控件浮在视口下方居中（position: sticky），滚到列表末尾就停在列表下面。手机上让开底部标签栏（--tabbar-h）。
         *  列表页开着 —— 每页 50、100 条时不用先滑到最底才能翻页。
         *  只给控件本身一块圆角底板，不做通栏底栏（主人要的是「组件悬浮」）；外层不接收点击，两边的卡片照样能点。
         *  ⚠️ sticky 只在父容器里生效：不能再包一层只装着 Pager 的 div */
        sticky = false } = $props();

  const BTN = 'tap inline-flex items-center rounded-lg border border-ink-600 bg-ink-900 px-3 py-1.5 text-[13px] text-ink-200 transition';
  const OFF = 'cursor-not-allowed border-ink-700 bg-ink-950 text-ink-400 opacity-60';

  let jump = $state(String(page));
  // 翻页后输入框要跟着走 —— 不然点了「下一页」，框里还留着旧页码
  $effect(() => { jump = String(page); });

  const go = (p) => {
    const n = Math.min(pages, Math.max(1, Math.round(+p) || 1));
    jump = String(n);
    if (n !== page) goto(to({ [param]: n === 1 ? null : n }), { noScroll, keepFocus: true });
  };
</script>

{#if pages > 1 || per}
  <!-- sticky 时 mt-auto：在 <Page fill> 里内容不满一屏也落到屏幕底部 -->
  <div class="flex justify-center {sticky ? 'pointer-events-none sticky mt-auto pt-4 bottom-[calc(0.75rem+var(--tabbar-h)+env(safe-area-inset-bottom))] z-20' : 'mt-4'}">
  <div class="flex flex-wrap items-center justify-center gap-x-2 gap-y-2 text-[13px]
              {sticky ? 'pointer-events-auto rounded-xl border border-ink-600 bg-ink-900/85 px-2.5 py-2 shadow-lg shadow-black/30 backdrop-blur' : ''}">
    {#if pages > 1}
      {#if page > 1}
        <a href={to({ [param]: page - 1 === 1 ? null : page - 1 })} data-sveltekit-noscroll={noScroll ? '' : undefined}
           class="{BTN} hover:border-ink-400 hover:bg-ink-800">←<span class="max-sm:hidden"> 上一页</span></a>
      {:else}
        <span class="{BTN} {OFF}">←<span class="max-sm:hidden"> 上一页</span></span>
      {/if}

      <span class="flex items-center gap-1.5 text-ink-400">
        {label}第
        <!-- 直接输入页码：655 页一页页点不现实 -->
        <input type="number" min="1" max={pages} bind:value={jump} aria-label="跳到第几页"
               onchange={() => go(jump)} onkeydown={(e) => e.key === 'Enter' && go(jump)}
               class="w-14 rounded-md border border-ink-600 bg-ink-900 px-1.5 py-1 text-center
                      tabular-nums text-ink-200 outline-none focus:border-accent" />
        / {pages} 页
      </span>

      {#if page < pages}
        <a href={to({ [param]: page + 1 })} data-sveltekit-noscroll={noScroll ? '' : undefined}
           class="{BTN} hover:border-ink-400 hover:bg-ink-800"><span class="max-sm:hidden">下一页 </span>→</a>
      {:else}
        <span class="{BTN} {OFF}"><span class="max-sm:hidden">下一页 </span>→</span>
      {/if}
    {/if}

    {#if per}
      <!-- 换每页条数要回第一页：留在第 7 页而每页改成 100，多半已经越界 -->
      <!-- 手机上只留箭头、藏掉「每页」两字，吸底时整条压成一行（两行 96px 占掉八分之一屏） -->
      <span class="ml-1 flex items-center gap-1.5 text-ink-400">
        <span class="max-sm:hidden">每页</span>
        <Select label="每页条数" w="7rem"
                value={perIsDefault ? '' : String(per)}
                opts={[['', '默认'], ...PER_OPTS.map((n) => [String(n), `${n} 条`])]}
                onpick={(v) => goto(to({ ps: v || null, [param]: null }), { noScroll })} />
      </span>
    {/if}
  </div>
  </div>
{/if}
