<script>
  /**
   * 首页：大搜索框（自动聚焦）→ 继续观看 → 想看 → 推荐若干排（需要 TMDB key，流式加载）。
   * 推荐卡片进入视口后懒查片源可用性，没片源的变灰加角标。
   */
  import Page from '$lib/ui/Page.svelte';
  import Section from '$lib/ui/Section.svelte';
  import CardGrid from '$lib/ui/CardGrid.svelte';
  import SearchForm from '$lib/ui/SearchForm.svelte';
  import { toast } from '$lib/ui/toast.svelte.js';
  import { toCard, clock, epText } from '$lib/work.js';
  import { avail, watchAvail } from '$lib/avail.svelte.js';

  let { data } = $props();

  const cont = $derived(data.cont.map((c) => toCard({ key: c.key, ...c.title }, {
    href: `/title/${encodeURIComponent(c.key)}/watch`,
    progress: c.duration ? c.position / c.duration : null,
    sub: [epText(c.title.kind === 'movie' ? 'movie' : 'tv', c.episode, c.epName), c.finished ? '看完' : clock(c.position)].filter(Boolean).join(' · '),
  })));
  const favs = $derived(data.favs.map((f) => toCard({ key: f.key, ...f.title })));

  /** 推荐排的卡片：可用性查到 false 时变灰 */
  const cards = (items) => items.map((w) => toCard({ ...w, available: avail.of(w.key) }));

  // 推荐排有失败的：整个页面生命周期里只 toast 一次（invalidate 后 data 变了也不再弹）
  let warned = false;
  $effect(() => {
    for (const r of data.rows) Promise.resolve(r.items).then((v) => { if (v === null && !warned) { warned = true; toast.error('推荐加载失败'); } });
  });
</script>

<Page>
  <div class="mx-auto max-w-2xl pb-2 pt-6 sm:pt-12">
    <SearchForm autofocus big />
  </div>

  {#if cont.length}
    <Section title="继续观看" action="全部 →" actionHref="/library">
      <div data-row="continue"><CardGrid items={cont.slice(0, 16)} variant="row" eager /></div>
    </Section>
  {/if}

  {#if favs.length}
    <Section title="想看" action="全部 →" actionHref="/library?tab=fav">
      <CardGrid items={favs.slice(0, 16)} variant="row" />
    </Section>
  {/if}

  {#each data.rows as r (r.id)}
    {#await r.items}
      <Section title={r.title}>
        <div class="grid grid-cols-3 gap-x-3.5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8" aria-hidden="true">
          {#each Array(8) as _, k (k)}<div class="aspect-2/3 animate-pulse rounded-xl bg-ink-800 {k >= 3 ? 'max-sm:hidden' : ''} {k >= 4 ? 'max-md:hidden' : ''} {k >= 6 ? 'max-lg:hidden' : ''}"></div>{/each}
        </div>
      </Section>
    {:then items}
      {#if items?.length}
        <Section title={r.title}>
          <div use:watchAvail={items.map((w) => w.key)}><CardGrid items={cards(items)} variant="row" /></div>
        </Section>
      {/if}
    {/await}
  {/each}
  <div class="h-6"></div>
</Page>
