/**
 * 筛选栏控件的统一尺寸 —— 胶囊、搜索框、搜索键、重置、开关全用这一份。
 * 原来胶囊 36px、搜索框 44px、手机上重置 40px 而胶囊被触屏规则撑到 44px，同排三种高度（主人 2026-10-21 第 5 条）。
 * 桌面 40px；手机 44px（= app.css 里触屏 44px 命中区，按钮和链接都一样高，不再有的被撑高、有的没有）。
 */
export const BAR_H = 'h-10 max-sm:h-11';
export const BAR_BOX = `${BAR_H} rounded-xl border text-[13px] transition`;
