<script>
  /**
   * 浏览：按「形态 × 地区」看 TMDB 热门（discover，分页）。卡片进入视口后懒查片源可用性。
   */
  import { page } from '$app/state';
  import Page from '$lib/ui/Page.svelte';
  import Chip from '$lib/ui/Chip.svelte';
  import CardGrid from '$lib/ui/CardGrid.svelte';
  import EmptyState from '$lib/ui/EmptyState.svelte';
  import { CTA, EXIT } from '$lib/ui/btn.js';
  import { toast } from '$lib/ui/toast.svelte.js';
  import { toCard } from '$lib/work.js';
  import { avail, watchAvail } from '$lib/avail.svelte.js';
  import Key from 'phosphor-svelte/lib/Key';
  import FilmSlate from 'phosphor-svelte/lib/FilmSlate';

  let { data } = $props();

  const KINDS = [['tv', '剧集'], ['movie', '电影'], ['variety', '综艺'], ['doc', '纪录片']];
  const REGIONS = [['', '全部'], ['cn', '内地'], ['hk', '香港'], ['tw', '台湾'], ['kr', '韩国'], ['jp', '日本'], ['th', '泰国'], ['west', '欧美']];

  const href = (p) => {
    const u = new URL(page.url);
    for (const [k, v] of Object.entries(p)) (v ? u.searchParams.set(k, v) : u.searchParams.delete(k));
    if (!('p' in p)) u.searchParams.delete('p');
    return u.pathname + u.search;
  };
  const cards = $derived(data.items.map((w) => toCard({ ...w, available: avail.of(w.key) })));
  $effect(() => { if (data.error) toast.error('TMDB 加载失败'); });
</script>

<Page>
  {#if !data.hasKey}
    <EmptyState title="未设置 TMDB 密钥" icon={Key}><a href="/settings" class={CTA}>去设置</a></EmptyState>
  {:else}
    <div class="flex flex-wrap gap-2" aria-label="形态">
      {#each KINDS as [k, l] (k)}<Chip on={data.kind === k} href={href({ kind: k === 'tv' ? '' : k })}>{l}</Chip>{/each}
    </div>
    <div class="mt-3 flex flex-wrap gap-2" aria-label="地区">
      {#each REGIONS as [k, l] (k)}<Chip on={data.region === k} href={href({ region: k })}>{l}</Chip>{/each}
    </div>

    <div class="mt-6" use:watchAvail={data.items.map((w) => w.key)}>
      <CardGrid items={cards} eager empty={data.error ? null : '没有找到相关作品'} emptyIcon={FilmSlate} />
    </div>

    {#if data.items.length || data.page > 1}
      <div class="mt-8 flex items-center justify-center gap-3">
        {#if data.page > 1}<a class={EXIT} href={href({ p: data.page - 1 > 1 ? String(data.page - 1) : '' })}>上一页</a>{/if}
        <span class="text-[13px] tabular-nums text-ink-400">第 {data.page} 页</span>
        {#if data.items.length >= 20 && data.page < 500}<a class={EXIT} href={href({ p: String(data.page + 1) })}>下一页</a>{/if}
      </div>
    {/if}
  {/if}
  <div class="h-6"></div>
</Page>
