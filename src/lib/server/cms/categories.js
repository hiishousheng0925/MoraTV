/**
 * 资源站分类名 -> 客户端自己的分类（设计文档 §7）。
 * 各站 type_id 不统一（「国产剧」多数是 13，暴风是 31），所以只按 type_name 关键字映射。
 *
 * Category = { kind: 'tv'|'movie'|'variety'|'doc'|'short'|'drop'|'other', region: 'cn'|'hk'|'tw'|'kr'|'jp'|'th'|'west'|'other'|null }
 * region 为 null = 类目名里没带地区（如「动作片」「综艺」）。
 */

const KINDS = [
  // 动漫不做；体育 / 资讯 / 预告 / 解说 / 伦理等不是剧也不是电影，一并丢弃
  ['drop', /动漫|动画|漫画|伦理|三级|里番|理论|福利|写真|热舞|两性|擦边|漫剧|动态漫|预告|解说|演唱会|资讯|新闻|公告|头条|演员|体育|赛事|足球|篮球|网球|台球|斯诺克|NBA/i],
  ['short', /短剧|古装仙侠|现代都市|穿越年代|年代穿越|言情总裁|重生民国|爽剧|女频|男频|甜宠|脑洞|逆袭|闪婚|现代言情|女恋|总裁|爽文/],
  ['variety', /综艺|真人秀|脱口秀/],
  ['doc', /纪录|记录/],
  ['movie', /电影|片$/],
  ['tv', /剧/],
];

const REGIONS = [
  ['other', /日韩/], // 日韩混合类目，国别不明
  ['kr', /韩/],
  ['jp', /日本|日剧/],
  ['th', /泰/],
  ['hk', /香港|港/],
  ['tw', /台湾|台剧|台/],
  ['west', /欧美|美国|美剧|英剧|英国|欧洲|法国|西方/],
  ['cn', /国产|大陆|内地|中国|^国剧/],
];

/** @param {string} typeName */
export function mapCategory(typeName) {
  const n = String(typeName ?? '').trim();
  const kind = KINDS.find(([, re]) => re.test(n))?.[0];
  if (!kind) return { kind: 'other', region: null };
  if (kind === 'drop') return { kind, region: null };
  // 「港台综艺」这类名字里港、台并列：地区不明，交给调用方用 vod_area 判
  if (/港/.test(n) && /台/.test(n)) return { kind, region: null };
  const region = REGIONS.find(([, re]) => re.test(n))?.[0] ?? null;
  return { kind, region };
}
