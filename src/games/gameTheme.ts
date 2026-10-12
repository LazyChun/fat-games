/*
 * gameTheme：游戏视觉统一主题
 *
 * 所有游戏共用一套“游戏厅”设计语言：
 *   - 舞台（GameFrame）：渐变背景 + 圆角 + 内阴影 + 顶部标题栏
 *   - 统计胶囊（StatChip）：label + 数值，渐变底
 *   - 操作按钮（ActBtn / PrimaryBtn）：圆角渐变按钮
 * 颜色同时适配宿主 light / dark 主题（通过 CSS 变量取当前主题）。
 */

/* ------------------------------------------------------------------ */
/* 通用舞台                                                             */
/* ------------------------------------------------------------------ */

/** 舞台背景（light / dark） */
export const STAGE_BG_LIGHT =
  "radial-gradient(120% 140% at 20% 0%, #fdfbf7 0%, #f5f1ea 45%, #ede6da 100%)";
export const STAGE_BG_DARK =
  "radial-gradient(120% 140% at 20% 0%, #23272e 0%, #1b1e24 55%, #14161b 100%)";

/** 舞台边框 */
export const STAGE_BORDER_LIGHT = "rgba(120, 100, 70, 0.18)";
export const STAGE_BORDER_DARK = "rgba(255, 255, 255, 0.10)";

/** 舞台内阴影 */
export const STAGE_SHADOW =
  "inset 0 1px 0 rgba(255,255,255,0.65), 0 10px 30px rgba(90, 70, 40, 0.10)";

/** 副文本颜色（说明/帮助） */
export const MUTED_TEXT = "rgba(0,0,0,0.55)";
export const MUTED_TEXT_DARK = "rgba(255,255,255,0.55)";

/* ------------------------------------------------------------------ */
/* 统计胶囊                                                             */
/* ------------------------------------------------------------------ */

export interface ChipColors {
  bg: string;
  label: string;
  value: string;
}

export const CHIP_GOLD: ChipColors = {
  bg: "linear-gradient(135deg, #ffd86b 0%, #f6a821 100%)",
  label: "rgba(90, 55, 0, 0.75)",
  value: "#5a3400",
};

export const CHIP_GREEN: ChipColors = {
  bg: "linear-gradient(135deg, #7ee8a2 0%, #2e9e5b 100%)",
  label: "rgba(255,255,255,0.85)",
  value: "#ffffff",
};

export const CHIP_BLUE: ChipColors = {
  bg: "linear-gradient(135deg, #6bb6ff 0%, #2b7de9 100%)",
  label: "rgba(255,255,255,0.85)",
  value: "#ffffff",
};

export const CHIP_PURPLE: ChipColors = {
  bg: "linear-gradient(135deg, #b48bff 0%, #7b3ff2 100%)",
  label: "rgba(255,255,255,0.85)",
  value: "#ffffff",
};

export const CHIP_RED: ChipColors = {
  bg: "linear-gradient(135deg, #ff9a8b 0%, #f2554a 100%)",
  label: "rgba(255,255,255,0.9)",
  value: "#ffffff",
};

/* ------------------------------------------------------------------ */
/* 标题栏图标底色（菜单卡片用）                                          */
/* ------------------------------------------------------------------ */

export const CATEGORY_GRADIENTS: Record<string, string> = {
  休闲: "linear-gradient(135deg, #43e97b 0%, #38c172 100%)",
  益智: "linear-gradient(135deg, #4facfe 0%, #00c6fb 100%)",
  记录: "linear-gradient(135deg, #f6d365 0%, #fda085 100%)",
  Casual: "linear-gradient(135deg, #43e97b 0%, #38c172 100%)",
  Puzzle: "linear-gradient(135deg, #4facfe 0%, #00c6fb 100%)",
  Records: "linear-gradient(135deg, #f6d365 0%, #fda085 100%)",
};
