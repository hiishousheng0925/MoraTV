<script>
  import MagnifyingGlass from 'phosphor-svelte/lib/MagnifyingGlass';
  import '../app.css';
  import { page, navigating, updated } from '$app/state';
  import { beforeNavigate, goto } from '$app/navigation';
  import ThemeToggle from '$lib/ui/ThemeToggle.svelte';
  import Toaster from '$lib/ui/Toaster.svelte';
  import BrandMark from '$lib/ui/BrandMark.svelte';
  import { NAV, isActive } from '$lib/nav.js';
  let { children } = $props();

  const cur = $derived(NAV.find((n) => isActive(n.href, page.url.pathname))?.label ?? '');

  /**
   * 发布后检测到新版本，就把下一次跳转降级成整页加载（不主动刷新，免得打断正在看的页面）：
   * 旧 app.js 的路由索引和新服务端对不上时，客户端跳转会装错页面。版本比对靠 svelte.config.js 的 version.pollInterval。
   */
  beforeNavigate(({ willUnload, to }) => {
    if (updated.current && !willUnload && to?.url) location.href = to.url.href;
  });

  // 顶栏搜索入口：回车跳 /search?q=…。首页和搜索页有自己的大搜索框，顶栏这个藏掉
  let q = $state('');
  let input = $state(null);
  $effect(() => { q = page.url.pathname === '/search' ? (page.url.searchParams.get('q') ?? '') : ''; });
  function submit(e) {
    e.preventDefault();
    const v = q.trim();
    if (!v) return;
    input?.blur();
    goto(`/search?q=${encodeURIComponent(v)}`);
  }
  const ownBox = $derived(page.url.pathname === '/' || page.url.pathname === '/search');
  /** 当前该聚焦的搜索框：首页 / 搜索页是正文里的大搜索框 */
  const box = () => (ownBox ? document.querySelector('main input[name=q]') : input);
  // Ctrl+K 或 / 聚焦搜索框（正在输入时不拦 /）
  function onkey(e) {
    const input = box();
    const typing = e.target?.closest?.('input, textarea, select, [contenteditable]');
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); input?.focus(); input?.select(); }
    else if (e.key === '/' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); input?.focus(); }
  }
</script>

<svelte:head>
  <title>{cur ? cur + ' · ' : ''}MoraTV</title>
</svelte:head>

<svelte:window onkeydown={onkey} />

<!-- 顶部加载条：只在客户端导航时出现 -->
{#if navigating.to}
  <div class="pointer-events-none fixed inset-x-0 top-0 z-[110] h-[3px] overflow-hidden bg-accent/20" role="status" aria-label="加载中">
    <div class="loadbar h-full w-1/4 bg-accent"></div>
  </div>
{/if}

<Toaster />

<!-- 跳到正文：平时藏着，Tab 第一下出现 -->
<a href="#main" class="sr-only rounded-lg bg-accent px-3 py-2 text-sm font-medium text-on-accent
                       focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[120]">跳到正文</a>

<header class="sticky top-0 z-40 flex h-[var(--hdr-h)] items-center gap-3 border-b border-ink-700 bg-ink-900/90 px-4 backdrop-blur-xl">
  <a href="/" class="flex shrink-0 items-center gap-2 rounded-lg py-1 pr-1 text-[15px] font-semibold tracking-tight">
    <BrandMark />MoraTV
  </a>

  <nav class="ml-2 flex items-center gap-0.5" aria-label="主导航">
    {#each NAV as n (n.href)}
      {@const on = isActive(n.href, page.url.pathname)}
      <a href={n.href} aria-current={on ? 'page' : undefined}
         class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13.5px] transition
                {on ? 'bg-accent/15 font-medium text-accent-ink' : 'text-ink-400 hover:bg-ink-800 hover:text-ink-100'}">
        <n.icon size={17} weight={on ? 'fill' : 'regular'} class="shrink-0" />{n.label}
      </a>
    {/each}
  </nav>

  <div class="ml-auto flex shrink-0 items-center gap-2">
    <form role="search" onsubmit={submit} class="relative {ownBox ? 'hidden' : ''}">
      <MagnifyingGlass size={16} weight="bold" aria-hidden="true"
                       class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
      <input bind:this={input} bind:value={q} placeholder="搜索片名 / 演员 / 剧情" aria-label="搜索"
             autocomplete="off" spellcheck="false" enterkeyhint="search"
             class="h-9 w-56 rounded-xl border border-ink-600 bg-ink-950 pl-9 pr-3 text-[13px] text-ink-100 outline-none transition
                    placeholder:text-ink-400 hover:border-ink-400 focus:w-72 focus:border-accent focus:ring-2 focus:ring-accent/25" />
    </form>
    <ThemeToggle compact />
  </div>
</header>

<main id="main" tabindex="-1" class="min-w-0 outline-none">
  {@render children()}
</main>
