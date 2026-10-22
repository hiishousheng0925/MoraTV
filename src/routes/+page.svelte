<script>
  /**
   * 首页：大搜索框（自动聚焦）→ 继续观看 → 想看 → 推荐若干排（TMDB，需要 key）→ 最近更新（资源站，不需要 key）。都是流式加载。
   * TMDB 推荐排由服务端预查过片源（没片源的已移除、跨排去重）；最近更新的卡片本身就来自资源站，不用查。
   */
  import Page from '$lib/ui/Page.svelte';
  import Section from '$lib/ui/Section.svelte';
  import CardGrid from '$lib/ui/CardGrid.svelte';
  import SearchForm from '$lib/ui/SearchForm.svelte';
  import { toast } from '$lib/ui/toast.svelte.js';
  import { toCard, clock, epText } from '$lib/work.js';

  let { data } = $props();

  const cont = $derived(data.cont.map((c) => toCard({ key: c.key, ...c.title }, {
    href: `/title/${encodeURIComponent(c.key)}/watch`,
    progress: c.duration ? c.position / c.duration : null,
    sub: [epText(c.title.kind === 'movie' ? 'movie' : 'tv', c.episode, c.epName), c.finished ? '看完' : clock(c.position)].filter(Boolean).join(' · '),
  })));
  const favs = $derived(data.favs.map((f) => toCard({ key: f.key, ...f.title })));

  /** 最近更新的卡片带更新备注（「更新至第 N 集」） */
  const cards = (items) => items.map((w) => toCard(w, w.sub ? { sub: w.sub } : {}));

  // 整个页面生命周期里各只 toast 一次（invalidate 后 data 变了也不再弹）：
  // TMDB 推荐排失败 →「推荐加载失败」；资源站全都没回应（推荐排按 TMDB 原样显示、不判无）或最近更新拉不到 →「资源站暂时连不上」
  let warned = false;
  let downWarned = false;
  const warnSites = () => { if (!downWarned) { downWarned = true; toast.error('资源站暂时连不上'); } };
  $effect(() => {
    for (const r of data.rows) {
      Promise.resolve(r.items).then((v) => {
        if (v !== null) return;
        if (r.id.startsWith('new-')) warnSites();
        else if (!warned) { warned = true; toast.error('推荐加载失败'); }
      });
    }
    Promise.resolve(data.sitesDown).then((d) => { if (d) warnSites(); });
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
          <CardGrid items={cards(items)} variant="row" />
        </Section>
      {/if}
    {/await}
  {/each}
  <div class="h-6"></div>
</Page>
