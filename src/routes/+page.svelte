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

  // 推荐排先显示上次的结果时，后台重算好的换上来：只换「新旧都有内容」的排（排不增不减，页面不跳）；
  // 新算出来变空 / 新出现的排等下次打开首页再说
  let fresh = $state(null);
  $effect(() => {
    const p = data.fresh;
    fresh = null;
    if (p) Promise.resolve(p).then((m) => { if (data.fresh === p) fresh = m; });
  });
  const rows = $derived(data.rows.map((r) => {
    const f = fresh?.[r.id];
    return f?.length && Array.isArray(r.items) && r.items.length ? { ...r, items: f } : r;
  }));

  // 整个页面生命周期里各只 toast 一次（invalidate 后 data 变了也不再弹）：
  // 某排加载失败 →「推荐加载失败」；只有资源站真的全都没回应（推荐预查 / 最近更新）才 →「资源站暂时连不上」（那时最近更新的空排不再另报）
  let warned = false;
  let downWarned = false;
  $effect(() => {
    const down = Promise.resolve(data.sitesDown);
    for (const r of data.rows) {
      Promise.resolve(r.items).then(async (v) => {
        if (v !== null || (r.id.startsWith('new-') && (await down))) return;
        if (!warned) { warned = true; toast.error('推荐加载失败'); }
      });
    }
    down.then((d) => { if (d && !downWarned) { downWarned = true; toast.error('资源站暂时连不上'); } });
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

  {#each rows as r (r.id)}
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
