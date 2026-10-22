<script>
  /**
   * 详情页（设计文档 §6.2）：海报、片名、原名、年份 / 地区 / 类型、评分、简介、主演前 6；
   * 「播放 / 继续第 N 集 mm:ss」、「想看」开关；多季用季 tab，每季单独找片源；
   * 片源面板按「站点 · 线路」列出集数和延迟（缺省：集数最全 + 最快；手动选过的按作品记住）；选集网格标出看过的集。
   */
  import { goto } from '$app/navigation';
  import Page from '$lib/ui/Page.svelte';
  import Section from '$lib/ui/Section.svelte';
  import EpisodePicker from '$lib/ui/EpisodePicker.svelte';
  import EmptyState from '$lib/ui/EmptyState.svelte';
  import { toast } from '$lib/ui/toast.svelte.js';
  import { posterUrl, REGION_CN, KIND_CN, clock } from '$lib/work.js';
  import { candidates, candLabel } from '$lib/lines.js';
  import Play from 'phosphor-svelte/lib/Play';
  import Heart from 'phosphor-svelte/lib/Heart';
  import FilmSlate from 'phosphor-svelte/lib/FilmSlate';
  import UserCircle from 'phosphor-svelte/lib/UserCircle';

  let { data } = $props();
  const w = $derived(data.work);
  const isMovie = $derived(w.type === 'movie');
  const seasons = $derived(w.seasons ?? []);
  const multi = $derived(seasons.length > 1);
  const last = $derived(data.progress.last);

  /** 当前季：上次看到的那一季，否则第一季 */
  let season = $state(1);
  $effect(() => {
    const s = data.progress.last?.season;
    season = multi ? (seasons.some((x) => x.season === s) ? s : seasons[0].season) : (isMovie ? 0 : 1);
  });

  let fav = $state(false);
  $effect(() => { fav = data.fav; });

  let loading = $state(true);
  let cands = $state([]);
  let pick = $state(0);
  $effect(() => {
    const key = w.key, s = season;
    loading = true; cands = []; pick = 0;
    const ctl = new AbortController();
    fetch(`/api/sources?key=${encodeURIComponent(key)}&season=${s}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((j) => {
        if (j.error) toast.error(j.error);
        const l = data.progress.last;
        cands = candidates(j.sources, j.pref ?? (l && l.season === s && l.siteId ? { siteId: l.siteId, line: l.line } : null));
      })
      .catch((e) => { if (e?.name !== 'AbortError') toast.error('片源加载失败'); })
      .finally(() => { if (!ctl.signal.aborted) loading = false; });
    return () => ctl.abort();
  });
  const cur = $derived(cands[pick] ?? null);

  function choose(i) {
    pick = i;
    const c = cands[i];
    fetch('/api/sources', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: w.key, siteId: c.siteId, line: c.line }) }).catch(() => {});
  }

  const watched = $derived(data.progress.episodes.filter((p) => p.season === season && p.finished).map((p) => p.episode));
  const curI = $derived(last && last.season === season ? last.episode - 1 : null);
  const watchHref = (s, e) => `/title/${encodeURIComponent(w.key)}/watch?s=${s}&e=${e}`;

  /** 主按钮：没看过 → 播放；看到一半 → 继续第 N 集 mm:ss；上一集看完 → 继续下一集 */
  const main = $derived.by(() => {
    if (!last) return { label: '播放', href: watchHref(season, 1) };
    if (last.finished) {
      if (isMovie) return { label: '重新播放', href: watchHref(last.season, 1) };
      return { label: `继续第 ${last.episode + 1} 集`, href: watchHref(last.season, last.episode + 1) };
    }
    return { label: `${isMovie ? '继续播放' : `继续第 ${last.episode} 集`} ${clock(last.position)}`, href: watchHref(last.season, last.episode) };
  });

  async function toggleFav() {
    try {
      const r = await fetch('/api/favorite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: w.key }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || '操作失败');
      fav = j.on;
      toast.ok(fav ? '已加入想看' : '已移出想看');
    } catch (e) { toast.error(e); }
  }

  const meta = $derived([...new Set([w.year, REGION_CN[w.region], KIND_CN[w.kind], ...(w.genres ?? []).slice(0, 3)].filter(Boolean))]);
  let sumOpen = $state(false);
</script>

<Page>
  <div class="flex gap-5 sm:gap-8">
    <div class="w-28 shrink-0 sm:w-52">
      <div class="aspect-2/3 overflow-hidden rounded-2xl bg-ink-800 shadow-hero">
        {#if w.poster}<img src={posterUrl(w.poster, 'w500')} alt={w.name} class="h-full w-full object-cover" />{/if}
      </div>
    </div>
    <div class="min-w-0 flex-1 sm:pt-2">
      <h1 class="text-[21px] font-bold leading-tight tracking-tight text-ink-100 sm:text-[32px]">{w.name}</h1>
      {#if w.originalName && w.originalName !== w.name}<div class="mt-1 text-[13px] text-ink-200 sm:text-[15px]">{w.originalName}</div>{/if}
      <div class="mt-2.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] text-ink-200 sm:text-[13px]">
        {#each meta as m, i (i)}{#if i}<span aria-hidden="true">·</span>{/if}<span>{m}</span>{/each}
      </div>
      {#if w.voteAverage > 0}
        <div class="mt-3 flex items-baseline gap-2">
          <b class="text-[28px] font-bold leading-none text-warm sm:text-[34px]">{w.voteAverage.toFixed(1)}</b>
          <span class="text-[12px] text-ink-400">TMDB</span>
        </div>
      {/if}
      <div class="mt-5 flex flex-wrap items-center gap-3">
        {#if !loading && !cands.length}
          <span class="inline-flex items-center gap-2 rounded-xl bg-ink-800 px-5 py-2.5 text-[15px] text-ink-400">暂无片源</span>
        {:else}
          <a href={main.href} data-play class="cta inline-flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-[15px] font-semibold text-on-accent transition hover:brightness-110 active:scale-95">
            <Play size={18} weight="fill" />{main.label}
          </a>
        {/if}
        <button onclick={toggleFav} aria-pressed={fav} data-fav
                class="inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-[14px] transition
                       {fav ? 'border-accent bg-accent/15 text-accent-ink' : 'border-ink-600 bg-ink-900 text-ink-200 hover:border-ink-400'}">
          <Heart size={18} weight={fav ? 'fill' : 'regular'} />想看
        </button>
      </div>
    </div>
  </div>

  {#if w.overview}
    <Section title="简介">
      <p class="whitespace-pre-line text-[15px] leading-[1.85] text-ink-200 {sumOpen ? '' : 'line-clamp-4'}">{w.overview}</p>
      {#if w.overview.length > 160}
        <button onclick={() => (sumOpen = !sumOpen)} class="mt-1 text-[13px] font-medium text-accent hover:underline">{sumOpen ? '收起' : '展开'}</button>
      {/if}
    </Section>
  {/if}

  {#if w.cast?.length}
    <Section title="主演">
      <div class="flex flex-wrap gap-x-5 gap-y-3">
        {#each w.cast as c, i (i)}
          <a href="/search?q={encodeURIComponent(c.name)}&mode=actor" class="group flex items-center gap-2.5">
            {#if c.profile}<img src={posterUrl(c.profile, 'w185')} alt="" class="h-10 w-10 rounded-full object-cover" loading="lazy" />
            {:else}<UserCircle size={40} class="text-ink-600" />{/if}
            <span class="text-[13px] leading-tight">
              <span class="block text-ink-100 group-hover:text-accent">{c.name}</span>
              {#if c.character}<span class="block text-[12px] text-ink-400">{c.character}</span>{/if}
            </span>
          </a>
        {/each}
      </div>
    </Section>
  {/if}

  {#if multi}
    <div role="tablist" class="mt-9 flex gap-1 overflow-x-auto no-scrollbar" aria-label="季">
      {#each seasons as s (s.season)}
        <button role="tab" aria-selected={season === s.season} onclick={() => (season = s.season)}
                class="tap shrink-0 rounded-lg px-3.5 py-1.5 text-[13px] transition
                       {season === s.season ? 'bg-accent/15 font-medium text-accent-ink' : 'text-ink-400 hover:bg-ink-800 hover:text-ink-100'}">第 {s.season} 季</button>
      {/each}
    </div>
  {/if}

  <!-- 窄窗：选集在上；宽窗：片源在左（行宽），选集在右（数字格不至于被拉得很宽） -->
  <div class="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
    <section class="min-w-0 rounded-2xl border border-ink-700 bg-ink-900/60 p-3 lg:col-start-2 lg:row-start-1 lg:self-start">
      {#if loading || cands.length}
        <EpisodePicker eps={cur?.episodes ?? []} {loading} {curI} {watched}
                       onplay={(i) => goto(watchHref(season, i + 1))} />
      {:else}
        <EmptyState title="暂无片源" icon={FilmSlate} bare />
      {/if}
    </section>
    <section class="min-w-0 lg:col-start-1 lg:row-start-1" data-sources>
      <h2 class="px-0.5 text-[15px] font-semibold text-ink-100">片源 {#if cands.length}<span class="ml-1 text-[12px] font-normal text-ink-400">{cands.length}</span>{/if}</h2>
      {#if loading}
        <div class="mt-2 space-y-1.5" aria-hidden="true">{#each Array(4) as _, k (k)}<div class="h-11 animate-pulse rounded-xl bg-ink-800"></div>{/each}</div>
      {:else}
        <div class="mt-2 flex max-h-[26rem] flex-col gap-1.5 overflow-y-auto">
          {#each cands as c, i (c.id)}
            <button onclick={() => choose(i)} aria-pressed={pick === i}
                    class="flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left text-[13px] transition
                           {pick === i ? 'border-accent bg-accent/10' : 'border-ink-700 bg-ink-900 hover:border-ink-400'}">
              <span class="min-w-0 flex-1 truncate {pick === i ? 'font-medium text-accent-ink' : 'text-ink-100'}">{candLabel(c, w.name)}</span>
              <span class="shrink-0 tabular-nums text-ink-400">{c.episodes.length} 集</span>
              {#if c.latency != null}<span class="w-16 shrink-0 text-right tabular-nums text-ink-400">{c.latency} ms</span>{/if}
            </button>
          {/each}
        </div>
      {/if}
    </section>
  </div>
  <div class="h-6"></div>
</Page>

<style>
  .cta { box-shadow: 0 8px 24px -8px color-mix(in srgb, var(--c-accent) 70%, transparent); }
</style>
