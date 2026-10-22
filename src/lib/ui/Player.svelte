<script>
  /**
   * 观看页的播放器（自带控制条，替掉浏览器自带的）。
   *   · 控制条：上一集 / 播放 / 下一集 · 时间 · 倍速 · 音量 · 画中画 · 全屏；进度条带缓冲段、悬停显示时间
   *   · 手机 / 窄窗（<640px）：只留 播放 / 下一集 · 时间 · ⋯ · 全屏，上一集 / 倍速 / 静音收进「⋯」
   *   · 鼠标 3 秒不动、正在播放时自动隐藏控制条和光标；双击全屏
   *   · 快捷键：空格 / K 暂停，← → 5 秒，↑ ↓ 音量，F 全屏，M 静音，N / P 下一集 / 上一集
   *   · 触屏：点一下显示 / 隐藏控制条，双击左右两侧 ±10 秒
   *   · 播完倒数 5 秒自动下一集，可取消
   *   · 倍速和音量记在 localStorage（个人偏好，丢了也只是回到默认）
   *
   * m3u8 一律用 hls.js；原生 HLS 只给没有 MSE 的环境兜底。
   *
   * props
   *   src          播放地址（m3u8 / mp4）；没有时盖 pending 内容
   *   title        片名；epLabel 全屏时顶栏显示「片名 [第 N 集]」
   *   liked/onlike 右上角爱心（可选，不传不显示）
   *   onshot(blob|null, t)  右上角截图键（可选，不传不显示）
   *   onback       窄窗口左上角的返回；immersive 铺满时也留着并写片名
   *   hasPrev/hasNext/onprev/onnext   上一集 / 下一集
   *   onprogress(frac)  播放进度 0–1（timeupdate 时回调）
   *   onfail()     加载错误 / hls 致命错误
   *   onmeta(height)    元数据就绪时回调视频高度
   *   pending      还没有 src 时盖在画面上的内容（snippet）
   */
  import Play from 'phosphor-svelte/lib/Play';
  import Pause from 'phosphor-svelte/lib/Pause';
  import SkipBack from 'phosphor-svelte/lib/SkipBack';
  import SkipForward from 'phosphor-svelte/lib/SkipForward';
  import SpeakerHigh from 'phosphor-svelte/lib/SpeakerHigh';
  import SpeakerX from 'phosphor-svelte/lib/SpeakerX';
  import CornersOut from 'phosphor-svelte/lib/CornersOut';
  import CornersIn from 'phosphor-svelte/lib/CornersIn';
  import PictureInPicture from 'phosphor-svelte/lib/PictureInPicture';
  import Camera from 'phosphor-svelte/lib/Camera';
  import Heart from 'phosphor-svelte/lib/Heart';
  import DotsThree from 'phosphor-svelte/lib/DotsThree';
  import ArrowLeft from 'phosphor-svelte/lib/ArrowLeft';
  import { untrack } from 'svelte';
  import { media } from '$lib/media.svelte.js';
  import { toast } from './toast.svelte.js';
  import Toaster from './Toaster.svelte';
  import { store, fmt } from './playerUtil.js';

  let { src, title = '', epLabel = '', liked = false, onlike, onshot, onback = null, immersive = false,
        hasPrev = false, hasNext = false, onprev, onnext, onprogress, onfail, onmeta, pending } = $props();

  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

  let box = $state(), video = $state();
  let paused = $state(true), time = $state(0), dur = $state(0), buffered = $state(0), waiting = $state(false);
  let speed = $state(store.get('speed', 1)), volume = $state(store.get('volume', 1)), muted = $state(false);
  let full = $state(false), shown = $state(true), hover = $state(null);
  /** 打开的菜单：'speed'（桌面挂在自己的按钮上）| 'more'（窄窗的「⋯」，倍速也从这里进） */
  let menu = $state(null);
  let countdown = $state(0);
  let hideTimer, cdTimer, tapTimer = null;
  // 卸载时三个计时器一起清（2026-10-21 审核）：倒计时中离开观看页，1 秒后照样调 onnext，去解析下一集
  $effect(() => () => { clearTimeout(hideTimer); clearInterval(cdTimer); clearTimeout(tapTimer); });
  const bare = $derived(!(shown || paused));

  /** 画面就绪（第一帧已加载） */
  let ready = $state(false);

  // 换源：挂 hls.js 或直接给 src。先存下元素：换集时 <video> 先被卸载，bind:this 变 null
  let resumeAt = 0, lastEp = null;
  $effect(() => {
    const v = video, s = src;
    if (!v || !s) return;
    // 用 time（上一个地址最后的播放位置）而不是 v.currentTime：走到这里时旧地址已经被清理函数卸掉、归零了
    resumeAt = lastEp === src ? untrack(() => time) : 0; lastEp = src;
    time = 0; dur = 0; buffered = 0; ready = false;
    let hls, dead = false;
    countdown = 0; clearInterval(cdTimer);
    (async () => {
      if (!/\.m3u8/i.test(s)) { v.src = s; return; }
      const { default: Hls } = await import('hls.js');
      if (dead) return;
      if (!Hls.isSupported()) { if (v.canPlayType('application/vnd.apple.mpegurl')) v.src = s; else onfail?.(); return; }
      hls = new Hls();
      hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) { console.warn('[片源] hls 播放失败', d.type, d.details, d.response?.code ?? ''); onfail?.(); } });
      hls.loadSource(s);
      hls.attachMedia(v);
    })();
    return () => { dead = true; hls?.destroy(); v.removeAttribute('src'); v.load(); };
  });
  // 换源会把 playbackRate 重置成 defaultPlaybackRate（下一集回到 1x）—— 两个都设，loadedmetadata 时再补一次
  const applyRate = () => { if (video) { video.defaultPlaybackRate = speed; video.playbackRate = speed; } };
  $effect(() => { applyRate(); store.set('speed', speed); });
  $effect(() => { if (video) { video.volume = volume; video.muted = muted; store.set('volume', volume); } });

  function poke() {
    shown = true; clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { if (!paused && !menu) shown = false; }, 3000);
  }
  const toggle = () => { if (!video) return; video.paused ? video.play().catch(() => {}) : video.pause(); poke(); };
  const seek = (t) => { if (video && dur) { video.currentTime = Math.max(0, Math.min(dur - 0.5, t)); poke(); } };
  const toggleFull = () => (document.fullscreenElement ? document.exitFullscreen() : box?.requestFullscreen?.())?.catch?.(() => {});
  const pip = () => (document.pictureInPictureElement ? document.exitPictureInPicture() : video?.requestPictureInPicture?.())?.catch?.(() => {});
  const openMenu = (m) => { menu = menu === m ? null : m; poke(); };

  function ontime() {
    time = video.currentTime;
    if (video.buffered.length) buffered = video.buffered.end(video.buffered.length - 1);
    if (dur) onprogress?.(time / dur);
  }
  function onended() {
    if (!hasNext) return;
    countdown = 5; clearInterval(cdTimer);
    cdTimer = setInterval(() => { if (--countdown <= 0) { clearInterval(cdTimer); onnext?.(); } }, 1000);
  }
  const cancelNext = () => { clearInterval(cdTimer); countdown = 0; };

  function onkey(e) {
    if (e.key === 'Escape' && menu) { menu = null; return; }
    if (!video || e.target.closest?.('input, textarea, select, [contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    const act = {
      ' ': toggle, k: toggle, arrowleft: () => seek(time - 5), arrowright: () => seek(time + 5),
      arrowup: () => { volume = Math.min(1, +(volume + 0.1).toFixed(2)); muted = false; poke(); },
      arrowdown: () => { volume = Math.max(0, +(volume - 0.1).toFixed(2)); poke(); },
      f: toggleFull, m: () => { muted = !muted; poke(); },
      n: () => hasNext && onnext?.(), p: () => hasPrev && onprev?.()
    }[k];
    if (act) { e.preventDefault(); act(); }
  }

  /**
   * 点画面。单击等 250ms 看有没有第二下 —— 不等的话双击会先暂停再播放闪一下。
   *   鼠标：单击暂停 / 播放，双击全屏
   *   触屏：单击显隐控制条；双击左 / 右三分之一 ±10 秒，中间双击全屏
   * 开着菜单时点画面只关菜单
   */
  function onTap(e) {
    if (menu) { menu = null; poke(); return; }
    const r = box.getBoundingClientRect(), x = (e.clientX - r.left) / r.width, touch = e.pointerType !== 'mouse';
    if (tapTimer) {
      clearTimeout(tapTimer); tapTimer = null;
      if (touch && x < 0.33) seek(time - 10); else if (touch && x > 0.67) seek(time + 10); else toggleFull();
      return;
    }
    tapTimer = setTimeout(() => { tapTimer = null; if (touch) { shown ? (shown = false) : poke(); } else toggle(); }, 250);
  }
  function onBar(e) {
    const r = e.currentTarget.getBoundingClientRect();
    hover = { x: e.clientX - r.left, t: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur };
  }
  /**
   * 截当前画面（只截画面，不截控制条）：把 video 当前帧按原分辨率画到离屏 canvas。
   * 跨站且不带 CORS 的视频画上去会污染 canvas、导不出来，返回 null，由调用方决定怎么办
   */
  let shooting = $state(false), flash = $state(false);
  async function shoot() {
    if (!video || shooting || !onshot) return;
    shooting = true;
    const t = video.currentTime;
    try {
      let blob = null;
      try {
        const c = document.createElement('canvas');
        c.width = video.videoWidth; c.height = video.videoHeight;
        c.getContext('2d').drawImage(video, 0, 0);
        blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      } catch { blob = null; }   // SecurityError：canvas 被跨站视频污染
      flash = true; setTimeout(() => (flash = false), 180);
      const r = await onshot(blob, t);
      if (r) toast.ok('截图已保存'); else toast.error('截图没保存');
    } finally { shooting = false; }
  }

  const BTN = 'tap grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white/90 transition hover:bg-white/10 disabled:opacity-30';
  const POP = 'absolute bottom-full right-0 z-10 mb-2 overflow-hidden rounded-xl border border-white/15 bg-black/90 py-1 text-white shadow-2xl backdrop-blur';
  const ITEM = 'flex w-full items-center gap-3 whitespace-nowrap px-4 py-1.5 text-left text-[12px] hover:bg-white/10 disabled:opacity-30';
</script>

<svelte:window onkeydown={onkey} />
<svelte:document onfullscreenchange={() => (full = !!document.fullscreenElement)} />

{#snippet speedList()}
  {#each SPEEDS.toReversed() as s (s)}
    <button onclick={() => { speed = s; menu = null; }}
            class="{ITEM} tabular-nums {speed === s ? 'text-accent' : ''}">{s}x</button>
  {/each}
{/snippet}
<div bind:this={box} role="region" aria-label="播放器 {title}"
     class="group/p relative h-full w-full overflow-hidden bg-black {bare ? 'cursor-none' : ''}"
     onpointermove={poke}>
  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={video} autoplay playsinline class="h-full w-full"
         onplay={() => { paused = false; poke(); }} onpause={() => { paused = true; shown = true; }}
         onwaiting={() => (waiting = true)} onplaying={() => (waiting = false)} oncanplay={() => (waiting = false)}
         ontimeupdate={ontime} onloadedmetadata={() => { dur = video.duration; applyRate(); if (resumeAt) video.currentTime = resumeAt; onmeta?.(video.videoHeight); }}
         onloadeddata={() => (ready = true)}
         ondurationchange={() => (dur = video.duration)} onended={onended} onerror={() => onfail?.()}></video>

  <!-- 点画面：桌面单击暂停 / 双击全屏；手机单击显隐、双击左右快退快进 -->
  <button type="button" aria-label={paused ? '播放' : '暂停'} class="absolute inset-0 cursor-[inherit]"
          onpointerup={onTap}></button>

  {#if !src}
    <div class="pointer-events-none absolute inset-0">{@render pending?.()}</div>
  {:else if waiting || !ready}
    <div class="pointer-events-none absolute inset-0 grid place-items-center">
      <span class="h-10 w-10 animate-spin rounded-full border-[3px] border-white/20 border-t-white/90"></span>
    </div>
  {/if}

  <!-- 顶栏：和底部控制条一起显隐。全屏时左边写片名和集数（窗口模式页面上已经有标题，不重复）；手机左边是返回 -->
  <div class="absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/75 via-black/30 to-transparent px-2 pb-10 pt-1.5 text-white transition-opacity duration-200 sm:gap-3 sm:px-4 sm:pt-3
              {bare ? 'pointer-events-none opacity-0' : 'opacity-100'}">
    {#if onback && !full}<button class="{BTN} -ml-1 {immersive ? '' : 'sm:hidden'}" onclick={() => onback?.()} aria-label="返回详情"><ArrowLeft size={20} weight="bold" /></button>{/if}
    {#if full || immersive}
      <div class="min-w-0 truncate text-[15px] font-medium drop-shadow">{title}{#if epLabel}<span class="ml-2 text-white/80">[{epLabel}]</span>{/if}</div>
    {/if}
    <div class="ml-auto flex items-center gap-1">
      {#if onshot}
        <button class={BTN} onclick={shoot} disabled={shooting || !src} aria-label="截取当前画面" title="截取当前画面">
          <Camera size={20} weight={shooting ? 'fill' : 'regular'} />
        </button>
      {/if}
      {#if onlike}
        <button class={BTN} onclick={() => onlike?.()} aria-pressed={liked} aria-label={liked ? '在看（再点取消）' : '标记为在看'}
                title={liked ? '在看（再点取消）' : '标记为在看'}>
          <Heart size={20} weight={liked ? 'fill' : 'regular'} class={liked ? 'text-pink-400' : ''} />
        </button>
      {/if}
    </div>
  </div>
  {#if flash}<div class="pointer-events-none absolute inset-0 bg-white/40"></div>{/if}
  <!-- 全屏时只有全屏元素内的内容可见，根布局的 Toaster 被盖住：全屏期间在播放器里再挂一个，toast 仍是唯一的反馈通道 -->
  {#if full}<Toaster />{/if}
  {#if countdown}
    <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 text-white">
      <div class="text-sm">{countdown} 秒后播放下一集</div>
      <div class="flex gap-2">
        <button onclick={() => { cancelNext(); onnext?.(); }} class="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-on-accent">立即播放</button>
        <button onclick={cancelNext} class="rounded-lg border border-white/30 px-4 py-2 text-sm">取消</button>
      </div>
    </div>
  {/if}

  <!-- 控制条隐藏时（手机）底边留一道细进度线 -->
  <div class="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-white/15 transition-opacity duration-200 sm:hidden {bare ? '' : 'opacity-0'}">
    <div class="h-full bg-accent" style="width:{dur ? (time / dur) * 100 : 0}%"></div>
  </div>

  <!-- 底部：桌面「进度条 / 控制条」上下排；手机反过来，进度条贴底边 -->
  <div class="absolute inset-x-0 bottom-0 flex flex-col bg-gradient-to-t from-black/85 via-black/40 to-transparent px-1.5 pt-10 transition-opacity duration-200 sm:px-3 sm:pb-2
              {bare || !src ? 'pointer-events-none opacity-0' : 'opacity-100'}">
    <!-- 进度条：底下一层缓冲段，上面是 range（可拖、可键盘），悬停显示时间 -->
    <div class="relative h-4 max-sm:order-last max-sm:h-3.5" role="presentation" onpointermove={onBar} onpointerleave={() => (hover = null)}>
      <div class="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-white/20 max-sm:h-[3px]">
        <div class="absolute inset-y-0 left-0 rounded-full bg-white/30" style="width:{dur ? (buffered / dur) * 100 : 0}%"></div>
        <div class="absolute inset-y-0 left-0 rounded-full bg-accent" style="width:{dur ? (time / dur) * 100 : 0}%"></div>
      </div>
      <input type="range" min="0" max={dur || 0} step="0.1" value={time} aria-label="播放进度"
             oninput={(e) => seek(+e.currentTarget.value)} class="player-range absolute inset-0 h-full w-full cursor-pointer" />
      {#if hover && dur}
        <span class="pointer-events-none absolute -top-6 -translate-x-1/2 rounded bg-black/80 px-1.5 py-0.5 text-[11px] tabular-nums text-white"
              style="left:{hover.x}px">{fmt(hover.t)}</span>
      {/if}
    </div>

    <div class="flex items-center gap-0.5 whitespace-nowrap text-white sm:mt-1 sm:gap-1">
      <button class="{BTN} max-sm:hidden" onclick={() => onprev?.()} disabled={!hasPrev} aria-label="上一集"><SkipBack size={18} weight="fill" /></button>
      <button class={BTN} onclick={toggle} aria-label={paused ? '播放' : '暂停'}>
        {#if paused}<Play size={20} weight="fill" />{:else}<Pause size={20} weight="fill" />{/if}
      </button>
      <button class={BTN} onclick={() => onnext?.()} disabled={!hasNext} aria-label="下一集"><SkipForward size={18} weight="fill" /></button>
      <span data-time class="ml-1 whitespace-nowrap text-[12px] tabular-nums text-white/85">{fmt(time)} / {fmt(dur)}</span>

      <div class="ml-auto flex items-center gap-0.5 sm:gap-1">
        <div class="relative max-sm:hidden">
          <button onclick={() => openMenu('speed')} aria-expanded={menu === 'speed'} aria-label="倍速"
                  class="tap h-9 whitespace-nowrap rounded-lg px-2 text-[12px] font-medium tabular-nums hover:bg-white/10">{speed === 1 ? '倍速' : `${speed}x`}</button>
          {#if menu === 'speed' && !media.mobile}<div class={POP}>{@render speedList()}</div>{/if}
        </div>
        <button class="{BTN} max-sm:hidden" onclick={() => (muted = !muted)} aria-label={muted ? '取消静音' : '静音'}>
          {#if muted || volume === 0}<SpeakerX size={18} />{:else}<SpeakerHigh size={18} />{/if}
        </button>
        <input type="range" min="0" max="1" step="0.05" bind:value={volume} oninput={() => (muted = false)} aria-label="音量"
               class="player-range hidden w-20 sm:block" />
        <button class="{BTN} max-sm:hidden" onclick={pip} aria-label="画中画"><PictureInPicture size={18} /></button>

        <!-- 手机：上一集 / 倍速 / 静音都在「⋯」里（面板见下面，从播放器右侧盖上来） -->
        <div class="relative sm:hidden">
          <button class={BTN} onclick={() => openMenu('more')} aria-expanded={menu === 'more'} aria-label="更多播放选项"><DotsThree size={22} weight="bold" /></button>
        </div>
        <button class={BTN} onclick={toggleFull} aria-label={full ? '退出全屏' : '全屏'}>
          {#if full}<CornersIn size={18} />{:else}<CornersOut size={18} />{/if}
        </button>
      </div>
    </div>
  </div>
  <!-- 手机的「⋯」面板：盖在播放器右侧、跟着播放器高度自己滚 —— 竖屏播放器只有 220px 高，往上弹的菜单会被裁掉；
       放在播放器里面而不是底部抽屉，全屏时也看得见 -->
  {#if menu === 'more' && media.mobile}
    <div class="absolute inset-0 z-20 flex justify-end bg-black/45" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) menu = null; }}>
      <div class="h-full w-[min(17rem,78%)] overflow-y-auto border-l border-white/10 bg-black/85 py-1.5 text-white backdrop-blur-md" role="menu" aria-label="更多播放选项">
        <button class={ITEM} onclick={() => { menu = null; onprev?.(); }} disabled={!hasPrev}><SkipBack size={16} weight="fill" />上一集</button>
        <button class={ITEM} onclick={() => (muted = !muted)}>
          {#if muted}<SpeakerX size={16} />取消静音{:else}<SpeakerHigh size={16} />静音{/if}
        </button>
        <div class="px-4 pb-1 pt-2 text-[11px] text-white/60">倍速</div>
        <div class="grid grid-cols-4 gap-1 px-3">
          {#each SPEEDS as s (s)}
            <button onclick={() => { speed = s; menu = null; }}
                    class="rounded-lg py-1.5 text-[12px] tabular-nums {speed === s ? 'bg-accent font-semibold text-on-accent' : 'bg-white/10'}">{s}x</button>
          {/each}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  /* range 本身透明，只留拖动的圆点；进度和缓冲段由下面那几层 div 画 */
  .player-range { appearance: none; background: transparent; }
  .player-range::-webkit-slider-runnable-track { height: 4px; background: transparent; }
  .player-range::-webkit-slider-thumb { appearance: none; margin-top: -4px; height: 12px; width: 12px; border-radius: 9999px; background: #fff; }
  .player-range::-moz-range-thumb { height: 12px; width: 12px; border: 0; border-radius: 9999px; background: #fff; }
  .player-range[aria-label='音量'] { height: 1rem; }
  .player-range[aria-label='音量']::-webkit-slider-runnable-track { background: rgb(255 255 255 / 0.3); border-radius: 9999px; }
</style>
