<script>
  /**
   * 片库：观看历史（按最近时间，可删单条 / 清空）、想看。tab 记在网址上（?tab=fav）。
   */
  import { goto, invalidateAll } from '$app/navigation';
  import { page } from '$app/state';
  import Page from '$lib/ui/Page.svelte';
  import TabBar from '$lib/ui/TabBar.svelte';
  import CardGrid from '$lib/ui/CardGrid.svelte';
  import EmptyState from '$lib/ui/EmptyState.svelte';
  import Confirm from '$lib/ui/Confirm.svelte';
  import Pager from '$lib/ui/Pager.svelte';
  import { toast } from '$lib/ui/toast.svelte.js';
  import { toCard, posterUrl, clock, epText, REGION_CN, KIND_CN } from '$lib/work.js';
  import ClockCounterClockwise from 'phosphor-svelte/lib/ClockCounterClockwise';
  import Heart from 'phosphor-svelte/lib/Heart';
  import X from 'phosphor-svelte/lib/X';
  import Play from 'phosphor-svelte/lib/Play';

  let { data } = $props();
  const tabs = $derived([
    { key: 'history', label: '观看历史', count: data.hist.total || null },
    { key: 'fav', label: '想看', count: data.favs.length || null },
  ]);
  const favCards = $derived(data.favs.map((f) => toCard({ key: f.key, ...f.title })));

  const pick = (k) => goto(k === 'fav' ? '/library?tab=fav' : '/library', { replaceState: true, noScroll: true, keepFocus: true });
  const to = (p) => { const u = new URL(page.url); for (const [k, v] of Object.entries(p)) v == null ? u.searchParams.delete(k) : u.searchParams.set(k, v); return u.pathname + u.search; };

  const ago = (t) => {
    const s = (Date.now() - t) / 1000;
    if (s < 60) return '刚刚';
    if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
    if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
    if (s < 86400 * 30) return `${Math.floor(s / 86400)} 天前`;
    return new Date(t).toLocaleDateString('zh-CN');
  };

  async function del(url, ok) {
    try {
      const r = await fetch(url, { method: 'DELETE' });
      if (!r.ok) throw new Error('删除失败');
      toast.ok(ok);
      await invalidateAll();
    } catch (e) { toast.error(e); }
  }
  let asking = $state(false);
  const remove = (h) => del(`/api/progress?key=${encodeURIComponent(h.key)}`, `已删除「${h.title.name || '观看记录'}」`);
  const clearAll = () => { asking = false; del('/api/progress?all=1', '观看历史已清空'); };
</script>

<Confirm open={asking} danger title="清空观看历史？" body="所有作品的观看进度一起删除" confirmLabel="清空"
         onconfirm={clearAll} oncancel={() => (asking = false)} />

<Page fill>
  <div class="flex items-center justify-between gap-3">
    <TabBar {tabs} value={data.tab} onpick={pick} label="片库" />
    {#if data.tab === 'history' && data.hist.total}
      <button onclick={() => (asking = true)} class="tap rounded-lg px-3 py-1.5 text-[13px] text-ink-400 transition hover:bg-ink-800 hover:text-danger">清空</button>
    {/if}
  </div>

  {#if data.tab === 'history'}
    {#if data.hist.items.length}
      <ul class="mt-5 divide-y divide-ink-700 overflow-hidden rounded-2xl border border-ink-700 bg-ink-900" data-history>
        {#each data.hist.items as h (h.key)}
          {@const isMovie = h.title.kind === 'movie'}
          <li class="group flex items-center gap-3.5 px-3 py-2.5 sm:px-4">
            <a href="/title/{encodeURIComponent(h.key)}" class="h-[72px] w-12 shrink-0 overflow-hidden rounded-lg bg-ink-800">
              {#if h.title.poster}<img src={posterUrl(h.title.poster, 'w185')} alt="" class="h-full w-full object-cover" loading="lazy" />{/if}
            </a>
            <div class="min-w-0 flex-1">
              <a href="/title/{encodeURIComponent(h.key)}" class="block truncate text-[14px] font-medium text-ink-100 hover:text-accent">{h.title.name || h.key}</a>
              <div class="mt-0.5 text-[12px] text-ink-400">
                {[h.title.year, REGION_CN[h.title.region], KIND_CN[h.title.kind]].filter(Boolean).join(' · ')}
              </div>
              <div class="mt-1 text-[12px] text-ink-200">
                {[epText(isMovie ? 'movie' : 'tv', h.episode, h.epName), h.finished ? '看完' : `${clock(h.position)} / ${clock(h.duration)}`, ago(h.updatedAt)].filter(Boolean).join(' · ')}
              </div>
            </div>
            <a href="/title/{encodeURIComponent(h.key)}/watch" aria-label="继续播放"
               class="tap grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent/15 text-accent-ink transition hover:bg-accent hover:text-on-accent">
              <Play size={16} weight="fill" />
            </a>
            <button onclick={() => remove(h)} aria-label="删除这条记录"
                    class="tap grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-400 transition hover:bg-ink-800 hover:text-danger">
              <X size={16} weight="bold" />
            </button>
          </li>
        {/each}
      </ul>
      {#if data.hist.pages > 1}<div class="mt-auto pt-6"><Pager page={data.hist.page} pages={data.hist.pages} {to} sticky /></div>{/if}
    {:else}
      <div class="mt-6"><EmptyState title="还没有观看记录" icon={ClockCounterClockwise} /></div>
    {/if}
  {:else}
    <div class="mt-5"><CardGrid items={favCards} empty="还没有想看的作品" emptyIcon={Heart} /></div>
  {/if}
</Page>
