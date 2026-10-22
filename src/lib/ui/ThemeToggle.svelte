<script module>
  /**
   * 当前主题放在模块级，侧栏的小按钮和设置页的分段控件读同一份 ——
   * 原来各自一个 $state：在设置页点侧栏的月亮，设置页那颗还写着旧主题。
   */
  const cur = $state({ theme: 'dark' });
</script>

<script>
  /**
   * 亮 / 暗主题切换。
   *   compact  侧栏底部的单个图标按钮：点一下在亮 / 暗之间切换
   *   缺省     设置页的分段控件「暗色 | 亮色」，选中的那段高亮。
   *            （原来设置页也是单个按钮、写着「☾ 暗色」—— 分不清那是「现在是暗色」还是「点了变暗色」）
   */
  import { readTheme, applyTheme } from '$lib/theme.js';
  let { compact = false } = $props();

  $effect(() => { cur.theme = readTheme(); });

  const next = $derived(cur.theme === 'dark' ? 'light' : 'dark');
  const label = $derived(next === 'light' ? '切换到亮色' : '切换到暗色');
  const set = (t) => { cur.theme = applyTheme(t); };
</script>

{#snippet moon()}
  <svg viewBox="0 0 20 20" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.6"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M16.5 12.4A7 7 0 0 1 7.6 3.5a7 7 0 1 0 8.9 8.9z" />
  </svg>
{/snippet}
{#snippet sun()}
  <svg viewBox="0 0 20 20" class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.6"
       stroke-linecap="round" aria-hidden="true">
    <circle cx="10" cy="10" r="3.6" />
    <path d="M10 2.2v1.6M10 16.2v1.6M2.2 10h1.6M16.2 10h1.6M4.5 4.5l1.1 1.1M14.4 14.4l1.1 1.1M15.5 4.5l-1.1 1.1M5.6 14.4l-1.1 1.1" />
  </svg>
{/snippet}

{#if compact}
  <button onclick={() => set(next)} title={label} aria-label={label}
          class="flex h-9 w-9 items-center justify-center rounded-lg border border-ink-700 bg-ink-900 text-ink-200 transition
                 hover:border-ink-400 active:scale-95">
    <!-- 暗色时显示月亮，亮色时显示太阳 -->
    {#if cur.theme === 'dark'}{@render moon()}{:else}{@render sun()}{/if}
  </button>
{:else}
  <div role="radiogroup" aria-label="主题" class="flex shrink-0 rounded-lg border border-ink-700 bg-ink-950 p-0.5">
    {#each [['dark', '暗色', moon], ['light', '亮色', sun]] as [t, txt, icon] (t)}
      {@const on = cur.theme === t}
      <button type="button" role="radio" aria-checked={on} onclick={() => set(t)}
              class="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] transition
                     {on ? 'bg-ink-900 font-medium text-ink-100 shadow-sm ring-1 ring-ink-700' : 'text-ink-400 hover:text-ink-200'}">
        {@render icon()}{txt}
      </button>
    {/each}
  </div>
{/if}
