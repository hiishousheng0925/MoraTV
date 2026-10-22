/**
 * toast 队列的纯逻辑 —— 不依赖 runes，所以可以在 Node 里直接单元测试。
 * 状态本体在 toast.svelte.js。
 */

/** 同屏最多几条。连点筛选时实测能堆到 9 条，从右下角一直铺到页面顶部。 */
export const MAX_TOASTS = 5;

/**
 * 追加一条：只保留最新的 max 条（挤掉最旧的），并且【同文本同色去重】。
 *
 * 去重是必须的：主人对着同一个不合法的输入连点五次「添加」，屏上堆了五条
 * 一模一样的红条 —— 封顶只挡住了「铺满整页」，没挡住「同一句刷五遍」。
 * 命中重复时用新的那条替换旧的（换新 id → 换新的消失计时），
 * 顺带把它挪到最新位置；旧那条的计时器按 id 找不到东西，空转一次而已。
 */
export const pushCapped = (items, item, max = MAX_TOASTS) =>
  [...items.filter((x) => !(x.text === item.text && x.tone === item.tone)), item].slice(-max);
