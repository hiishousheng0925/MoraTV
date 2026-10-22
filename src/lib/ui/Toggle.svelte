<script>
  /** 开关。作为链接实现，所以状态存在 URL 里、能分享、能后退。
   *  用在筛选栏里，所以尺寸跟筛选胶囊同一份（BAR_BOX）。 */
  import { BAR_BOX } from './bar.js';
  let { on = false, href, label } = $props();
</script>

<a {href} role="switch" aria-checked={on}
   class="flex shrink-0 items-center gap-2 whitespace-nowrap px-3 {BAR_BOX}
          {on ? 'border-accent bg-accent/15 text-accent-ink'
              : 'border-ink-600 bg-ink-900 text-ink-400 hover:border-ink-400'}">
  <span class="relative h-4 w-7 rounded-full transition {on ? 'bg-accent' : 'bg-ink-600'}">
    <span class="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all
                 {on ? 'left-[14px]' : 'left-0.5'}"></span>
  </span>
  {label}
</a>
