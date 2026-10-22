<script>
  /**
   * 搜索页 /search?q=&mode=auto|title|actor|plot[&person=]
   * 页面先出，结果在客户端取（聚合搜索要几秒）。片名结果先显示 12 部，「更多」展开；没片源的变灰排最后。
   * 演员：人和作品先出，作品的可用性再懒加载。剧情模式没配 AI 接口：toast 带「去设置」。
   */
  import { page } from '$app/state';
  import Page from '$lib/ui/Page.svelte';
  import Section from '$lib/ui/Section.svelte';
  import CardGrid from '$lib/ui/CardGrid.svelte';
  import EmptyState from '$lib/ui/EmptyState.svelte';
  import SearchForm from '$lib/ui/SearchForm.svelte';
  import { toast } from '$lib/ui/toast.svelte.js';
  import { toCard, posterUrl } from '$lib/work.js';
  import { avail, watchAvail } from '$lib/avail.svelte.js';
  import UserCircle from 'phosphor-svelte/lib/UserCircle';

  const FIRST = 12;

  const q = $derived((page.url.searchParams.get('q') ?? '').trim());
  const mode = $derived(page.url.searchParams.get('mode') || 'auto');
  const person = $derived(page.url.searchParams.get('person') || '');

  let loading = $state(false);
  let res = $state(null);   // { works, persons?, person? }
  let more = $state(false);
  let showShort = $state(false);

  $effect(() => {
    const qq = q, m = mode, p = person;
    res = null; more = false; showShort = false;
    if (!qq) { loading = false; return; }
    const ctl = new AbortController();
    loading = true;
    const params = new URLSearchParams({ q: qq, mode: m });
    if (p) params.set('person', p);
    fetch(`/api/search?${params}`, { signal: ctl.signal })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (j.error === 'NO_LLM_KEY') toast.error('先在设置里填写 AI 接口', { action: { label: '去设置', href: '/settings#ai' } });
        else if (!r.ok) toast.error(j.error || '搜索失败');
        res = { works: j.works ?? [], persons: j.persons ?? [], person: j.person ?? null, error: !r.ok };
      })
      .catch((e) => { if (e?.name !== 'AbortError') { toast.error('搜索失败'); res = { works: [], persons: [], error: true }; } })
      .finally(() => { if (!ctl.signal.aborted) loading = false; });
    return () => ctl.abort();
  });

  const isActor = $derived(!!res?.persons?.length);
  /** 演员作品的可用性是懒加载的，其余模式服务端已经给了 */
  const works = $derived((res?.works ?? []).map((w) => (w.available == null ? { ...w, available: avail.of(w.key) } : w)));
  /** 正剧 / 电影在前；短剧折成一组放最后 */
  const main = $derived(works.filter((w) => w.kind !== 'short'));
  const shorts = $derived(works.filter((w) => w.kind === 'short'));
  const shown = $derived(more ? main : main.slice(0, FIRST));
  const lazyKeys = $derived((res?.works ?? []).filter((w) => w.available == null).map((w) => w.key));
  const personHref = (id) => `/search?q=${encodeURIComponent(q)}&mode=actor&person=${id}`;
</script>

<Page>
  <div class="max-w-2xl">
    <SearchForm q={q} {mode} autofocus={!q} />
  </div>

  {#if loading}
    <div class="mt-8" aria-busy="true">
      <div class="grid grid-cols-3 gap-x-3.5 gap-y-5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
        {#each Array(8) as _, k (k)}
          <div><div class="aspect-2/3 animate-pulse rounded-xl bg-ink-800"></div><div class="mt-2 h-3 w-3/4 animate-pulse rounded bg-ink-800"></div></div>
        {/each}
      </div>
    </div>
  {:else if res}
    {#if isActor}
      <div class="mt-6 flex flex-wrap gap-2" data-persons>
        {#each res.persons.slice(0, 8) as p (p.id)}
          {@const on = p.id === res.person}
          <a href={personHref(p.id)} aria-current={on ? 'true' : undefined}
             class="tap flex items-center gap-2 rounded-full border py-1 pl-1 pr-3.5 text-[13px] transition
                    {on ? 'border-accent bg-accent/15 font-medium text-accent-ink' : 'border-ink-600 bg-ink-900 text-ink-200 hover:border-ink-400'}">
            {#if p.profile}<img src={posterUrl(p.profile, 'w185')} alt="" class="h-7 w-7 rounded-full object-cover" />
            {:else}<UserCircle size={28} class="text-ink-400" />{/if}
            {p.name}
          </a>
        {/each}
      </div>
    {/if}

    {#if works.length}
      <Section title={isActor ? '作品' : '结果'} count={works.length}>
        <div use:watchAvail={lazyKeys} data-results><CardGrid items={shown.map((w) => toCard(w))} eager /></div>
        {#if main.length > FIRST && !more}
          <div class="mt-5 flex justify-center">
            <button onclick={() => (more = true)}
                    class="tap rounded-full border border-ink-600 bg-ink-900 px-5 py-2 text-[13px] text-ink-200 transition hover:border-accent hover:text-accent-ink">
              更多 {main.length - FIRST}
            </button>
          </div>
        {/if}
        {#if shorts.length}
          <div class="mt-6" data-shorts>
            <button onclick={() => (showShort = !showShort)} aria-expanded={showShort}
                    class="tap rounded-full border border-ink-600 bg-ink-900 px-5 py-2 text-[13px] text-ink-200 transition hover:border-accent hover:text-accent-ink">
              短剧 {shorts.length} 部{showShort ? ' · 收起' : ''}
            </button>
            {#if showShort}
              <div class="mt-4"><CardGrid items={shorts.map((w) => toCard(w))} eager /></div>
            {/if}
          </div>
        {/if}
      </Section>
    {:else if !res.error}
      <div class="mt-8"><EmptyState title="没有找到「{q}」" /></div>
    {/if}
  {/if}
  <div class="h-6"></div>
</Page>
