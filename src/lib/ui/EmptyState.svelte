<script>
  /**
   * 空状态：居中卡片，大号弱色图标 + 标题 + 可选动作区。
   * 不带说明句 —— 标题本身就是状态（「没有找到「xxx」」「还没有观看记录」），见 CLAUDE.md。
   *
   * props
   *   title     标题（必填）
   *   icon      phosphor-svelte 的图标组件，如 `import Ghost from 'phosphor-svelte/lib/Ghost'`   默认 MagnifyingGlass
   *   bare      不要卡片底 / 边框（放在已经是卡片的容器里时用）                                默认 false
   *   children  动作区（snippet），如「清除筛选」「去目录」按钮；不传就没有
   * 例：<EmptyState title="没有找到「{q}」"><a href="/search" class="…">清除搜索</a></EmptyState>
   */
  import MagnifyingGlass from 'phosphor-svelte/lib/MagnifyingGlass';
  let { title, icon = MagnifyingGlass, bare = false, children } = $props();
  const Icon = $derived(icon ?? MagnifyingGlass);
</script>

<div class="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center sm:py-16
            {bare ? '' : 'card rounded-2xl'}" role="status">
  <Icon size={44} weight="duotone" class="text-ink-600" aria-hidden="true" />
  <div class="text-[15px] font-medium text-ink-200">{title}</div>
  {#if children}<div class="mt-1 flex flex-wrap items-center justify-center gap-2">{@render children()}</div>{/if}
</div>
