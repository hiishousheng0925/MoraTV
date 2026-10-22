<script>
  /**
   * 大搜索框 + 模式分段（自动 / 片名 / 演员 / 剧情）。首页和搜索页共用。回车跳 /search?q=&mode=。
   *
   * props
   *   q          初始关键词                    默认 ''
   *   mode       初始模式 auto|title|actor|plot 默认 'auto'
   *   autofocus  挂载后聚焦（首页）             默认 false
   *   big        首页的大号样式                 默认 false
   */
  import MagnifyingGlass from 'phosphor-svelte/lib/MagnifyingGlass';
  import { goto } from '$app/navigation';

  let { q = '', mode = 'auto', autofocus = false, big = false } = $props();

  const MODES = [['auto', '自动'], ['title', '片名'], ['actor', '演员'], ['plot', '剧情']];
  const HOLDER = { auto: '片名 / 演员', title: '片名', actor: '演员名', plot: '记得的剧情片段' };

  // 初值直接取 props（服务端渲染时就对，不等水合后的 effect）；之后跟着 URL 走（在搜索页里换模式 / 后退）
  const initial = () => q;
  let text = $state(initial());
  $effect(() => { text = q; });
  /** 可写的 $derived：props 变了跟着变，点分段时临时改 */
  let cur = $derived(MODES.some(([k]) => k === mode) ? mode : 'auto');

  let el = $state(null);
  $effect(() => { if (autofocus && el) el.focus(); });

  function submit(e) {
    e?.preventDefault();
    const v = text.trim();
    if (!v) { el?.focus(); return; }
    goto(`/search?q=${encodeURIComponent(v)}${cur === 'auto' ? '' : `&mode=${cur}`}`);
  }
  /** 有词时切模式直接重搜 */
  function pick(k) {
    cur = k;
    if (text.trim()) submit(); else el?.focus();
  }
</script>

<form role="search" onsubmit={submit} class="w-full">
  <div class="relative">
    <MagnifyingGlass size={big ? 22 : 18} weight="bold" aria-hidden="true"
                     class="pointer-events-none absolute top-1/2 -translate-y-1/2 text-ink-400 {big ? 'left-4' : 'left-3.5'}" />
    <input bind:this={el} bind:value={text} placeholder={HOLDER[cur]} aria-label="搜索" name="q"
           autocomplete="off" spellcheck="false" enterkeyhint="search"
           class="w-full rounded-2xl border border-ink-600 bg-ink-900 text-ink-100 outline-none transition placeholder:text-ink-400
                  hover:border-ink-400 focus:border-accent focus:ring-4 focus:ring-accent/20
                  {big ? 'h-14 pl-12 pr-28 text-[17px]' : 'h-11 pl-10 pr-24 text-[14px]'}" />
    <button type="submit"
            class="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-xl bg-accent font-medium text-on-accent transition hover:brightness-110
                   {big ? 'px-5 py-2.5 text-[15px]' : 'px-4 py-1.5 text-[13px]'}">搜索</button>
  </div>
  <div class="mt-2.5 flex items-center gap-1" role="radiogroup" aria-label="搜索方式">
    {#each MODES as [k, l] (k)}
      <button type="button" role="radio" aria-checked={cur === k} data-mode={k} onclick={() => pick(k)}
              class="tap rounded-lg px-3 py-1 text-[13px] transition
                     {cur === k ? 'bg-accent/15 font-medium text-accent-ink' : 'text-ink-400 hover:bg-ink-800 hover:text-ink-100'}">{l}</button>
    {/each}
  </div>
</form>
