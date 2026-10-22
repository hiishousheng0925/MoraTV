<script>
  /**
   * 浏览：形态 × 地区 × 题材（TVB 可叠加）× 排序 × 年代，筛选全在 URL 查询里（前进 / 后退 / 刷新都保留）。
   * 有 key 走 TMDB discover，题材只显示当前形态 × 地区下有内容的（服务端流式给）；卡片进入视口后懒查片源可用性。
   * 没 key 走资源站分类（形态 × 地区），没有题材 / 排序 / 年代；翻页固定同一个站（src）。
   */
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import Page from '$lib/ui/Page.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import Select from '$lib/ui/Select.svelte';
  import CardGrid from '$lib/ui/CardGrid.svelte';
  import { EXIT } from '$lib/ui/btn.js';
  import { toast } from '$lib/ui/toast.svelte.js';
  import { toCard } from '$lib/work.js';
  import { avail, watchAvail } from '$lib/avail.svelte.js';
  import { genresFor, genreById, genreParams, networkFor, SORTS, DECADES } from '$lib/genres.js';
  import FilmSlate from 'phosphor-svelte/lib/FilmSlate';

  let { data } = $props();

  const KINDS = [['tv', '剧集'], ['movie', '电影'], ['variety', '综艺'], ['doc', '纪录片']];
  const REGIONS = [['', '全部'], ['cn', '内地'], ['hk', '香港'], ['tw', '台湾'], ['kr', '韩国'], ['jp', '日本'], ['th', '泰国'], ['west', '欧美']];

  /** 改哪些参数；没提到 p 的一律回第 1 页 */
  const href = (p) => {
    const u = new URL(page.url);
    for (const [k, v] of Object.entries(p)) (v ? u.searchParams.set(k, v) : u.searchParams.delete(k));
    if (!('p' in p)) { u.searchParams.delete('p'); u.searchParams.delete('src'); }
    return u.pathname + u.search;
  };
  const pageHref = (n) => href({ p: n > 1 ? String(n) : '', src: data.site && n > 1 ? String(data.site) : '' });

  const showGenres = $derived(data.hasKey && (data.kind === 'tv' || data.kind === 'movie'));
  const type = $derived(data.kind === 'movie' ? 'movie' : 'tv');
  const tvb = $derived(networkFor('tvb', data.kind, data.region));
  /** 计数失败（null）时退回这个形态 × 地区理论上适用的全部题材；选中的那个一定显示（好取消） */
  const shown = (list) => {
    const l = list ?? genresFor(type, data.region).map(({ id, label }) => ({ id, label }));
    const cur = data.g && !l.some((x) => x.id === data.g) ? [{ id: data.g, label: genreById(data.g)?.label }] : [];
    return [...cur, ...l];
  };

  const cards = $derived(data.items.map((w) => toCard({ ...w, available: avail.of(w.key) })));
  $effect(() => {
    if (data.error === 'tmdb') toast.error('TMDB 加载失败');
    else if (data.error === 'sites') toast.error('资源站暂时连不上');
    else if (data.error) toast.error('资源站加载失败');
  });
</script>

<Page>
  <div class="flex flex-wrap items-center gap-2">
    <div class="flex flex-wrap gap-2" aria-label="形态">
      {#each KINDS as [k, l] (k)}<Chip on={data.kind === k} href={href({ kind: k === 'tv' ? '' : k, g: '', net: '' })}>{l}</Chip>{/each}
    </div>
    {#if data.hasKey}
      <div class="ml-auto flex gap-2">
        <Select label="排序" opts={SORTS} value={data.sort} w="7rem" onpick={(v) => goto(href({ sort: v }))} />
        <Select label="年代" opts={DECADES} value={data.dec} w="7rem" onpick={(v) => goto(href({ dec: v }))} />
      </div>
    {/if}
  </div>
  <div class="mt-3 flex flex-wrap gap-2" aria-label="地区">
    {#each REGIONS as [k, l] (k)}<Chip on={data.region === k} href={href({ region: k, net: '', g: data.g && genreParams(data.g, type, k) ? data.g : '' })}>{l}</Chip>{/each}
  </div>

  {#if showGenres}
    <div class="mt-3 flex min-h-[34px] flex-wrap items-center gap-2" aria-label="题材">
      {#if tvb}
        <Chip on={data.net === 'tvb'} href={href({ net: data.net === 'tvb' ? '' : 'tvb' })}>{tvb.label}</Chip>
        <span class="mx-1 h-4 w-px bg-ink-700" aria-hidden="true"></span>
      {/if}
      <Chip on={!data.g} href={href({ g: '' })}>全部题材</Chip>
      {#await data.genres}
        {#if data.g}<Chip on href={href({ g: '' })}>{genreById(data.g)?.label}</Chip>{/if}
      {:then list}
        {#each shown(list) as x (x.id)}
          <Chip on={data.g === x.id} href={href({ g: data.g === x.id ? '' : x.id })}>{x.label}</Chip>
        {/each}
      {/await}
    </div>
  {/if}

  <div class="mt-6" use:watchAvail={data.items.map((w) => w.key)}>
    <CardGrid items={cards} eager empty={data.error ? null : '没有找到相关作品'} emptyIcon={FilmSlate} />
  </div>

  {#if data.items.length || data.page > 1}
    <div class="mt-8 flex items-center justify-center gap-3">
      {#if data.page > 1}<a class={EXIT} href={pageHref(data.page - 1)}>上一页</a>{/if}
      <span class="text-[13px] tabular-nums text-ink-400">第 {data.page} 页</span>
      {#if data.page < data.totalPages && data.page < 500}<a class={EXIT} href={pageHref(data.page + 1)}>下一页</a>{/if}
    </div>
  {/if}
  <div class="h-6"></div>
</Page>
