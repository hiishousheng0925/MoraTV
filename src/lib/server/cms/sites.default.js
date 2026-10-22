/**
 * 内置资源站（苹果 CMS v10 JSON）。首次启动写入 site 表（builtin=1）。2026-10-22 逐个实测可用。
 * weight：站点排序 / 片源排序用，缺省 0；负数 = 降权（片源排最后）。改了某站的缺省权重，老用户那边要在 migrate.js 追加一步同步（只改 builtin 且仍是旧值的行）。
 */
/** 降权站点的权重 */
export const LOW_WEIGHT = -10;

export const DEFAULT_SITES = [
  { name: '量子资源', api: 'https://cj.lziapi.com/api.php/provide/vod' },
  { name: '非凡资源', api: 'https://cj.ffzyapi.com/api.php/provide/vod' },
  { name: '电影天堂资源', api: 'https://caiji.dyttzyapi.com/api.php/provide/vod' },
  { name: '暴风资源', api: 'https://bfzyapi.com/api.php/provide/vod' },
  { name: '红牛资源', api: 'https://www.hongniuzy2.com/api.php/provide/vod' },
  { name: '极速资源', api: 'https://jszyapi.com/api.php/provide/vod' },
  { name: '光速资源', api: 'https://api.guangsuapi.com/api.php/provide/vod' },
  { name: '最大资源', api: 'https://api.zuidapi.com/api.php/provide/vod' },
  // 画面里烧录了博彩广告字幕（m3u8 去广告管不了）：权重最低，片源排最后；用户可在设置里停用
  { name: '360资源', api: 'https://360zy.com/api.php/provide/vod', weight: LOW_WEIGHT },
];
