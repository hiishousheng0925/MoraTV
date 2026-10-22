<script>
  /**
   * 选集（观看页右侧 / 详情页）。每集一个数字格；当前集 accent 实心，看过的集文字淡一点。
   * 当前集换了就把它滚进列表可见范围（只在列表自己能滚时）。
   *
   * props
   *   eps       [{ name, url }]，按播放顺序；集号 = ep.n ?? 下标 + 1
   *   roads     线路 [{ name }]；只有 1 条时不显示选择器                    默认 []
   *   road      当前线路下标                                              默认 0
   *   onroad    选线路回调 (下标)
   *   curI      当前集下标（高亮）；没有就 null
   *   watched   已看过的集号集合（Set<number> 或数组）                     默认 []
   *   loading   还在取剧集：画 8 行骨架
   *   onplay    点某一集 (下标)
   *   wide      整行宽（播放页剧场模式放在播放器下面）：格子按宽度自动排，不拉成 5 列大长条   默认 false
   */
  import Select from './Select.svelte';
  let { eps = [], roads = [], road = 0, onroad, curI = null, watched = [], loading = false, onplay, wide = false } = $props();

  const seen = $derived(new Set(watched));
  const epNo = (ep, i) => ep.n ?? i + 1;

  let list = $state(null);
  $effect(() => {
    const i = curI, el = list;
    if (i == null || !el || el.scrollHeight <= el.clientHeight + 1) return;
    const row = el.querySelector(`[data-i="${i}"]`);
    if (!row) return;
    const top = row.offsetTop - el.offsetTop, h = el.clientHeight;
    if (top < el.scrollTop + 8 || top + row.offsetHeight > el.scrollTop + h - 48) el.scrollTo({ top: Math.max(0, top - h / 3), behavior: 'smooth' });
  });
</script>

<div class="flex items-center gap-2 px-0.5">
  <h2 class="text-[15px] font-semibold text-ink-100">选集</h2>
  {#if eps.length}<span class="text-[12px] tabular-nums text-ink-400">{eps.length}</span>{/if}
  {#if roads.length > 1}
    <div class="ml-auto">
      <Select opts={roads.map((rd, i) => [i, rd.name])} value={road} label="线路" w="8rem" onpick={(v) => onroad?.(+v)} />
    </div>
  {/if}
</div>
{#if loading && !eps.length}
  <div class="mt-2 flex flex-col gap-1" aria-hidden="true">
    {#each Array(8) as _, k (k)}
      <div class="flex items-center gap-2.5 px-2.5 py-2">
        <span class="h-3 w-5 shrink-0 animate-pulse rounded bg-ink-700"></span>
        <span class="h-3 animate-pulse rounded bg-ink-700" style="width:{[72, 58, 80, 64, 50, 76, 60, 68][k]}%"></span>
      </div>
    {/each}
  </div>
{:else if eps.length}
  <div bind:this={list} class="ep-list relative mt-1.5 grid min-h-0 flex-1 content-start gap-1.5 overflow-y-auto {wide ? 'grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))]' : 'grid-cols-5 sm:grid-cols-8 lg:grid-cols-5'}">
    {#each eps as ep, i (ep.url)}
      {@const n = epNo(ep, i)}
      {@const on = curI === i}
      <button type="button" onclick={() => onplay?.(i)} data-i={i} data-ep={n} title={ep.name} aria-current={on ? 'true' : undefined}
              class="tap grid h-9 place-items-center rounded-lg text-[13px] font-medium tabular-nums transition
                     {on ? 'bg-accent text-on-accent' : `bg-ink-800/70 hover:bg-ink-700 ${seen.has(n) ? 'text-ink-400' : 'text-ink-200'}`}">{n}</button>
    {/each}
  </div>
{/if}

<style>
  /* 底部渐隐：最后几行淡出，暗示还能往下滚（留出底边让最后一集滚到底时能完整露出来） */
  @media (min-width: 1024px) {
    .ep-list {
      padding-bottom: 1.5rem;
      -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 2.5rem), transparent);
      mask-image: linear-gradient(to bottom, #000 calc(100% - 2.5rem), transparent);
    }
  }
</style>
