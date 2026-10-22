<script>
  /**
   * 播放页 /title/[key]/watch?s=<季>&e=<集>（设计文档 §6.3）
   *   · 片源懒加载；线路缺省「用户选过的 → 集数最全 → 最快」；m3u8 一律走本地 /api/stream（去广告 + 内网拦截）
   *   · 没给 e：接着上次——上一集看完了从下一集开始，否则从上次的位置续播（toast「已从 mm:ss 继续」）
   *   · 进度：每 10 秒、暂停、切集 / 换线路、关闭 / 离开页面时写一次
   *   · 线路加载失败（播放器报错，或 15 秒没动静）：toast 并自动换同一集的下一条线路
   *   · 播完由播放器倒数 5 秒自动下一集
   *   · 窗口宽 ≥ 1800：剧场模式（按钮 / T 键，记在 localStorage moratv.player.theater）——播放器宽度跟窗口走（按窗口高度封顶），选集栏移到下面
   */
  import { untrack } from 'svelte';
  import { replaceState, goto } from '$app/navigation';
  import { page } from '$app/state';
  import Page from '$lib/ui/Page.svelte';
  import Player from '$lib/ui/Player.svelte';
  import EpisodePicker from '$lib/ui/EpisodePicker.svelte';
  import { toast } from '$lib/ui/toast.svelte.js';
  import { clock, epText } from '$lib/work.js';
  import { isFinished } from '$lib/progress.js';
  import { candidates, candLabel, sameEp } from '$lib/lines.js';
  import ArrowLeft from 'phosphor-svelte/lib/ArrowLeft';
  import { media } from '$lib/media.svelte.js';

  let { data } = $props();
  const w = $derived(data.work);
  const isMovie = $derived(w.type === 'movie');
  const STALL_MS = 15000;
  const SAVE_MS = 10000;

  let season = $state(1);
  let loading = $state(true);
  let cands = $state([]);
  let ci = $state(0);            // 当前线路（候选下标）
  let i = $state(-1);            // 当前集（下标）
  let src = $state(null);
  let start = $state(0);
  let dead = $state(false);      // 这一集所有线路都失败了
  let watched = $state([]);

  // 播放状态（不需要触发渲染的放普通变量）
  let pos = 0, dur = 0, savedPos = -1, lastTick = 0, loaded = false, started = false, paused = false;
  let failed = new Set();

  const cur = $derived(cands[ci] ?? null);
  const eps = $derived(cur?.episodes ?? []);
  const ep = $derived(eps[i] ?? null);
  const epLabel = $derived(isMovie && eps.length <= 1 ? '' : epText('tv', i + 1, ep?.name));

  /* ---------- 进度 ---------- */
  function body() {
    if (!cur || !ep || !(dur > 0) || !(pos > 0)) return null;
    return { key: w.key, season, episode: i + 1, epName: ep.name, position: Math.round(pos * 10) / 10, duration: Math.round(dur), siteId: cur.siteId, line: cur.line };
  }
  function save(beacon = false) {
    const b = body();
    if (!b || b.position === savedPos) return;
    savedPos = b.position;
    const json = JSON.stringify(b);
    try { if (beacon && navigator.sendBeacon?.('/api/progress', new Blob([json], { type: 'application/json' }))) return; } catch {}
    fetch('/api/progress', { method: 'POST', headers: { 'content-type': 'application/json' }, body: json, keepalive: true }).catch(() => {});
  }

  /* ---------- 播放 ---------- */
  function play(nci, ni, at = 0) {
    save();
    const c = cands[nci], e = c?.episodes[ni];
    if (!e) return;
    if (nci !== ci || ni !== i) dead = false;
    ci = nci; i = ni; start = at;
    pos = at; dur = 0; savedPos = -1; loaded = false; started = false; paused = false; lastTick = Date.now();
    src = `/api/stream?u=${encodeURIComponent(e.url)}`;
    try { replaceState(`?s=${season}&e=${ni + 1}`, {}); } catch { /* 路由还没就绪 */ }
  }
  /** 用户换集：失败记录清零 */
  function goEp(ni) { failed = new Set(); play(ci, ni, 0); }

  /** 当前线路失败：换同一集的下一条线路 */
  function fail() {
    if (!cur || dead) return;
    failed.add(cur.id);
    const name = ep?.name, at = pos || start;
    for (let k = 1; k < cands.length; k++) {
      const nci = (ci + k) % cands.length, c = cands[nci];
      if (failed.has(c.id)) continue;
      const ni = sameEp(c.episodes, name, i);
      if (ni < 0) continue;
      toast.error(`${candLabel(cur, w.name)} 加载失败，已换到 ${candLabel(c, w.name)}`);
      play(nci, ni, at);
      return;
    }
    toast.error('所有线路都加载失败');
    dead = true; src = null;
  }
  function retry() { failed = new Set(); dead = false; play(ci, i, pos || start); }

  function setLine(k) {
    if (k === ci) return;
    const c = cands[k];
    fetch('/api/sources', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: w.key, siteId: c.siteId, line: c.line }) }).catch(() => {});
    const ni = sameEp(c.episodes, ep?.name, i);
    play(k, ni < 0 ? 0 : ni, ni < 0 ? 0 : pos);
  }

  /* ---------- 进来时：取片源、定从哪一集哪一秒开始 ---------- */
  $effect(() => {
    const key = w.key;
    const s = untrack(() => {
      const prog = data.progress;
      const sp = Number(page.url.searchParams.get('s'));
      const multi = (w.seasons?.length ?? 0) > 1;
      const s = page.url.searchParams.has('s') && Number.isFinite(sp) ? sp
        : prog.last ? prog.last.season : multi ? w.seasons[0].season : (isMovie ? 0 : 1);
      season = s;
      watched = prog.episodes.filter((p) => p.season === s && p.finished).map((p) => p.episode);
      loading = true; cands = []; src = null; i = -1; ci = 0; dead = false; failed = new Set();
      return s;
    });
    const ctl = new AbortController();
    fetch(`/api/sources?key=${encodeURIComponent(key)}&season=${s}`, { signal: ctl.signal })
      .then((r) => r.json())
      .then((j) => {
        if (j.error) toast.error(j.error);
        const prog = data.progress;
        // 没手动选过线路时，沿用上次在这一季看的那条（同站常有普通话 / 方言两个版本，续播不能换版本）
        const lastRec = prog.last && prog.last.season === season && prog.last.siteId ? prog.last : null;
        cands = candidates(j.sources, j.pref ?? (lastRec ? { siteId: lastRec.siteId, line: lastRec.line } : null));
        loading = false;
        if (!cands.length) return;
        const askE = Number(page.url.searchParams.get('e')) || 0;
        let target = askE;
        if (!target) {
          const l = prog.last && prog.last.season === season ? prog.last : null;
          target = l ? (l.finished ? l.episode + 1 : l.episode) : 1;
        }
        const rec = prog.episodes.find((p) => p.season === season && p.episode === target);
        const at = rec && !rec.finished && rec.position > 5 ? rec.position : 0;
        // 第一条线路没有这一集：找有的那条；都没有就落到最后一集
        let nci = cands.findIndex((c) => c.episodes.length >= target);
        if (nci < 0) {
          nci = 0;
          // 自己推出来的「下一集」不存在 = 最后一集已经看完：从第 1 集重新放；地址里点名的集数越界就落到最后一集
          target = askE ? Math.min(target, cands[0].episodes.length) : 1;
        }
        play(nci, target - 1, at);
        if (at > 0) toast.ok(`已从 ${clock(at)} 继续`);
      })
      .catch((e) => { if (e?.name !== 'AbortError') { loading = false; toast.error('片源加载失败'); } });
    return () => ctl.abort();
  });

  // 卡住检测（进度在 ontime 里按 SAVE_MS 节流写，这里不写）
  $effect(() => {
    const t = setInterval(() => {
      if (!src) return;
      if (Date.now() - lastTick > STALL_MS && (!loaded || (started && !paused))) { fail(); return; }
    }, 1000);
    const flush = () => save(true);
    addEventListener('beforeunload', flush);
    addEventListener('pagehide', flush);
    return () => { clearInterval(t); removeEventListener('beforeunload', flush); removeEventListener('pagehide', flush); save(true); };
  });
  let lastSaveAt = 0;
  function ontime(t, d) {
    if (t !== pos) { lastTick = Date.now(); if (t > 0.5) started = true; }
    pos = t; dur = d || dur;
    if (isFinished(pos, dur) && !watched.includes(i + 1)) watched = [...watched, i + 1];
    if (Date.now() - lastSaveAt >= SAVE_MS) { lastSaveAt = Date.now(); save(); }
  }

  const hasPrev = $derived(i > 0);
  const hasNext = $derived(i >= 0 && i < eps.length - 1);
  const roads = $derived(cands.map((c) => ({ name: candLabel(c, w.name) })));

  /* ---------- 剧场模式（窗口宽 ≥ 1800 才有；开关记在 localStorage，丢了就是关） ---------- */
  const THEATER_KEY = 'moratv.player.theater';
  let theaterOn = $state(false);
  $effect(() => { try { theaterOn = localStorage.getItem(THEATER_KEY) === '1'; } catch { /* 读不到当关 */ } });
  const huge = $derived(media.huge);
  const theater = $derived(huge && theaterOn);
  function toggleTheater() {
    theaterOn = !theaterOn;
    try { localStorage.setItem(THEATER_KEY, theaterOn ? '1' : '0'); } catch { /* 记不住也只是下次回到默认 */ }
  }
</script>

{#snippet pending()}
  <div class="grid h-full place-items-center text-white/80">
    {#if loading}
      <span class="h-10 w-10 animate-spin rounded-full border-[3px] border-white/20 border-t-white/90"></span>
    {:else if dead}
      <button onclick={retry} class="rounded-lg border border-white/30 px-4 py-2 text-sm hover:bg-white/10" style="pointer-events:auto">重新加载</button>
    {:else if !cands.length}
      <span class="text-[15px]">暂无片源</span>
    {/if}
  </div>
{/snippet}

<Page unbounded={theater}>
  <!-- 剧场模式：外框不限 1280，播放器宽度跟着窗口（按窗口高度封顶，整个画面留在首屏），选集栏移到下面 -->
  <div class={theater ? 'theater mx-auto w-full' : ''} data-layout={theater ? 'theater' : 'normal'}>
  <div class="mb-4 max-sm:hidden">
    <a href="/title/{encodeURIComponent(w.key)}" class="inline-flex items-center gap-1.5 text-[13px] text-ink-400 transition hover:text-accent">
      <ArrowLeft size={15} weight="bold" />详情
    </a>
  </div>
  <div class={theater ? '' : 'lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-x-5'}>
    <div class="stage relative aspect-video overflow-hidden bg-black max-sm:-mx-4 sm:rounded-2xl lg:self-start">
      <Player {src} {start} hls title={w.name} {epLabel} {pending} {hasPrev} {hasNext}
              {theater} ontheater={huge ? toggleTheater : null}
              onprev={() => goEp(i - 1)} onnext={() => goEp(i + 1)}
              onback={() => (history.length > 1 ? history.back() : goto('/title/' + encodeURIComponent(w.key)))}
              {ontime} onfail={fail}
              onmeta={() => { loaded = true; lastTick = Date.now(); }}
              onpause={(t) => { paused = true; pos = t || pos; save(); }}
              onplay={() => { paused = false; lastTick = Date.now(); }} />
    </div>

    <div class="mt-4 min-w-0 sm:mt-5 lg:col-start-1">
      <h1 class="text-lg font-semibold leading-snug tracking-tight text-ink-100 sm:text-[22px]">{w.name}</h1>
      <p class="mt-1.5 text-[13px] text-ink-200" data-now>
        {#if (w.seasons?.length ?? 0) > 1}<span>第 {season} 季 · </span>{/if}{#if epLabel}<span class="font-medium text-ink-100">{epLabel}</span>{/if}{#if cur}<span class="text-ink-400">{epLabel ? ' · ' : ''}{candLabel(cur, w.name)}</span>{/if}
      </p>
    </div>

    <aside class="mt-6 flex min-h-0 flex-col rounded-2xl border border-ink-700 bg-ink-900/60 p-2.5
                  {theater ? '' : 'lg:col-start-2 lg:row-start-1 lg:mt-0 lg:h-0 lg:min-h-full'}">
      <EpisodePicker {eps} {roads} road={ci} wide={theater} onroad={setLine} curI={i >= 0 ? i : null} {watched} {loading} onplay={goEp} />
      {#if !loading && !cands.length}<p class="px-1.5 py-3 text-[12px] text-ink-400">暂无片源</p>{/if}
    </aside>
  </div>
  </div>
  <div class="h-6"></div>
</Page>

<style>
  /* 16:9 的播放器高度 = 窗口高 - 顶栏 - 5.5rem（Page 的 pt-5 20px + 「详情」返回行约 20px + 它的 mb-4 16px + 底部余量 32px）。
     返回行或 Page 上边距改了，这里跟着改 */
  .theater { max-width: calc((100dvh - var(--hdr-h, 3.25rem) - 5.5rem) * 16 / 9); }
  .stage { box-shadow: 0 28px 70px -24px rgb(0 0 0 / 0.75), 0 0 0 1px rgb(255 255 255 / 0.06); }
  :global(:root[data-theme='light']) .stage { box-shadow: 0 24px 56px -22px rgb(16 20 28 / 0.5), 0 0 0 1px rgb(16 20 28 / 0.06); }
</style>
