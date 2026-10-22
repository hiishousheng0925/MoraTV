<script>
  /**
   * 海报墙卡片（封面网格统一用它；一般经 CardGrid 用，不直接用）。
   *
   * props
   *   item   作品：key / title / poster（可空）/ year / region / kind / badge（右上角小标，如「暂无片源」）/
   *          progress（0–1，给「继续观看」的进度条）/ sub（海报下第二行，如「第 3 集 12:30」）
   *          key 决定链接：/title/<key>
   *   gray   整张变灰（没有片源的作品）                     默认 false
   *   eager  封面立即加载（首屏第一排用，其余懒加载）         默认 false
   * 例：<PosterCard item={{ key: 'tv-1399', title: '权力的游戏', poster: '/img?u=…', year: 2011, region: '欧美' }} />
   */
  let { item, gray = false, eager = false } = $props();

  let brokenSrc = $state(null);
  const broken = $derived(brokenSrc !== null && brokenSrc === item.poster);
  const first = $derived((item.title ?? '').replace(/^[\s\W]+/, '').slice(0, 2) || '?');
  // 分隔符显式拼：模板里 `{year}{#if} · …` 的前导空格会被 Svelte 吃掉
  const meta = $derived([item.year, item.region, item.kind].filter(Boolean).join(' · '));
</script>

<a href="/title/{item.key}" class="group block min-w-0 transition-transform duration-200 ease-out hover:-translate-y-0.5 {gray ? 'opacity-55 grayscale' : ''}">
  <div class="relative overflow-hidden rounded-xl bg-ink-800 shadow-md shadow-black/30 ring-1 ring-white/5
              transition-[box-shadow] duration-200 group-hover:shadow-lift group-hover:ring-accent/40">
    <div class="cover relative aspect-2/3 overflow-hidden">
      {#if item.poster && !broken}
        <img src={item.poster} alt={item.title} loading={eager ? 'eager' : 'lazy'} onerror={() => (brokenSrc = item.poster)}
             class="h-full w-full object-cover transition duration-300 group-hover:scale-105" />
      {:else}
        <div class="flex h-full w-full flex-col items-center justify-center gap-1 bg-ink-800 p-1 text-center">
          <span class="text-[15px] font-medium leading-tight text-ink-600">{first}</span>
        </div>
      {/if}
    </div>
    {#if item.badge}
      <span class="pointer-events-none absolute right-1.5 top-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[10.5px] text-white/90 backdrop-blur-sm">{item.badge}</span>
    {/if}
    {#if item.progress != null}
      <div class="pointer-events-none absolute inset-x-0 bottom-0 h-1 bg-black/50">
        <div class="h-full bg-accent" style="width:{Math.round(Math.min(1, Math.max(0, item.progress)) * 100)}%"></div>
      </div>
    {/if}
  </div>
  <div class="mt-2 px-0.5">
    <div class="line-clamp-2 text-[13.5px] font-medium leading-snug transition-colors group-hover:text-accent">{item.title}</div>
    {#if item.sub}<div class="mt-0.5 text-[11px] text-accent-ink">{item.sub}</div>{/if}
    {#if meta}<div class="mt-0.5 text-[11px] text-ink-400">{meta}</div>{/if}
  </div>
</a>
