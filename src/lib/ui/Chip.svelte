<script>
  /**
   * 全站统一的 chip。
   *
   * ⚠️ 样式必须用 $derived 计算。
   * 早先版本写成 `const TONES = {...on...}` / `const cls = ...`，
   * const 只在组件初始化时求值一次，cls 会永久捕获首次的 on 值 ——
   * 表现为「点了筛选，URL 和内容都变了，只有高亮不变，刷新才对」。
   * 这是之前所有高亮问题的根因，别改回 const。
   *
   * tone='soft'：圆角胶囊、二级底色、无边框（详情页题材这类「去目录的链接」，不是筛选项）。
   */
  let { on = false, tone = 'accent', href = null, title = null, onclick = null, children } = $props();

  const TONE_CLS = $derived({
    accent: on ? 'border-accent bg-accent/15 text-accent-ink'
               : 'border-ink-600 bg-ink-900 text-ink-200 hover:border-ink-400',
    danger: on ? 'border-danger/60 bg-danger/10 text-danger'
               : 'border-ink-600 bg-ink-900 text-ink-400 hover:border-ink-400',
    soft:   on ? 'border-transparent bg-accent/15 text-accent-ink'
               : 'border-transparent bg-ink-800 text-ink-200 hover:bg-ink-700 hover:text-ink-100'
  }[tone]);

  const cls = $derived(
    `tap inline-flex shrink-0 items-center ${tone === 'soft' ? 'rounded-full' : 'rounded-lg'} border px-3 py-1.5 text-[13px] transition ${TONE_CLS}`
  );
</script>

{#if href}
  <a {href} {title} {onclick} class={cls} aria-current={on ? 'true' : undefined}>{@render children()}</a>
{:else}
  <button type="button" {title} {onclick} class={cls} aria-pressed={on}>{@render children()}</button>
{/if}
