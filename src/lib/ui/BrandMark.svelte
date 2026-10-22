<script>
  /**
   * 品牌标：圆角方块里一台小电视（两根天线 + 屏幕里一枚播放键）。青 → 蓝渐变，
   * 和 desktop/icon.svg（客户端图标）、static/icon.svg（favicon）是同一个造型。
   *   size  边长 px   默认 24
   */
  let { size = 24 } = $props();
  // 一页里可能有好几个品牌标，渐变 id 不能重
  const uid = $props.id();
</script>

<svg aria-hidden="true" viewBox="0 0 192 192" width={size} height={size} class="mark"
     style:border-radius="{Math.round(size * 0.25)}px">
  <defs>
    <linearGradient id="g-{uid}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2dd4bf" /><stop offset="1" stop-color="#3b82f6" />
    </linearGradient>
    <linearGradient id="h-{uid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity=".22" /><stop offset=".5" stop-color="#fff" stop-opacity="0" />
    </linearGradient>
  </defs>
  <rect width="192" height="192" rx="48" fill="url(#g-{uid})" />
  <rect width="192" height="192" rx="48" fill="url(#h-{uid})" />
  <path d="M96 62 72 38M96 62 120 38" stroke="#fff" stroke-width="8" stroke-linecap="round" fill="none" />
  <rect x="34" y="62" width="124" height="86" rx="20" fill="#fff" />
  <rect x="47" y="75" width="98" height="60" rx="11" fill="url(#g-{uid})" />
  <path d="M88 90 L88 120 L113 105Z" fill="#fff" stroke="#fff" stroke-width="6" stroke-linejoin="round" />
</svg>

<style>
  .mark { display: inline-block; flex-shrink: 0; box-shadow: 0 2px 10px -2px rgb(45 212 191 / 50%); }
</style>
