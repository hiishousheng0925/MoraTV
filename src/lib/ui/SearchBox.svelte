<script>
  /**
   * 搜索框。清空按钮和提交逻辑统一在这里。
   *
   * 清空按钮做成 type="button"（不是 submit）——放在 form 里的 <button> 缺省是
   * submit，点了会把空词提交上去、顺带跳一次导航。这里要的是「先清掉再由用户决定」，
   * 所以点它只清输入框并把焦点还回去；真正要清掉搜索结果按回车或点「搜索」。
   *
   * 高度和筛选胶囊同一份（BAR_H：桌面 40 / 手机 44）、圆角 12px、框内左侧放大镜：视觉重心在输入框本身，不在提交键上 ——
   * 提交键做成中性描边，手机上直接藏掉（软键盘的「搜索」键 = enterkeyhint）。
   */
  import MagnifyingGlass from 'phosphor-svelte/lib/MagnifyingGlass';
  import { BAR_H } from './bar.js';
  let { value = '', placeholder = '', onsubmit } = $props();

  let el = $state(null);
  let q = $state(value);
  // 导航后（比如点了重置）输入框要跟着 URL 走
  $effect(() => { q = value; });
</script>

<form role="search" onsubmit={(e) => { e.preventDefault(); el?.blur(); onsubmit(q); }} class="mt-3 flex gap-2">
  <div class="relative min-w-0 flex-1">
    <MagnifyingGlass size={18} weight="bold" aria-hidden="true"
                     class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-400" />
    <input bind:this={el} bind:value={q} {placeholder} enterkeyhint="search" aria-label="搜索"
           autocomplete="off" spellcheck="false"
           class="{BAR_H} w-full rounded-xl border border-ink-600 bg-ink-900 pl-10 pr-10 text-base text-ink-100
                  outline-none transition placeholder:text-ink-400 hover:border-ink-400
                  focus:border-accent focus:ring-2 focus:ring-accent/25 sm:text-sm" />
    {#if q}
      <button type="button" aria-label="清空" title="清空"
              onclick={() => { q = ''; el?.focus(); }}
              class="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center
                     rounded-full text-ink-400 transition hover:bg-ink-700 hover:text-ink-200">
        <svg viewBox="0 0 14 14" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="1.8"
             stroke-linecap="round" aria-hidden="true"><path d="M3 3l8 8M11 3l-8 8" /></svg>
      </button>
    {/if}
  </div>
  <button class="{BAR_H} shrink-0 rounded-xl border border-ink-600 bg-ink-900 px-5 text-sm font-medium text-ink-200
                 transition hover:border-accent hover:text-accent-ink max-sm:hidden">搜索</button>
</form>
