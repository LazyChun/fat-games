/*
 * orangeLogic：剥橘子游戏纯逻辑（不依赖 DOM，便于 vitest 单测）
 *
 * 橘子几何：
 *   - 俯视圆形橘子，中心 (cx, cy)，外半径 R_OUT、果肉半径 R_IN
 *   - 橘皮由 SLICES 个扇形瓣 × 每瓣 SEGS 段径向皮块拼成（共 PEEL_TOTAL 块）
 *   - 皮块索引 idx = slice * SEGS + seg（slice：瓣，seg：段，0 为最外圈）
 */

export const SLICES = 8; // 瓣数
export const SEGS = 3; // 每瓣径向段数
export const PEEL_TOTAL = SLICES * SEGS; // 皮块总数
export const R_IN = 78; // 果肉半径（中心果脐区不可剥）
export const R_OUT = 128; // 橘子外半径
/** 径向分段边界（外 → 内） */
export const SEG_EDGES = [128, 112, 96, 78];
export const START_ANGLE = -90; // 第一瓣起始角（度，指向正上方）
export const SLICE_ANGLE = 360 / SLICES; // 每瓣角宽（度）
export const CENTER = 150; // 默认中心坐标（viewBox 0 0 300 300）

export interface PeelBlock {
  idx: number;
  slice: number;
  seg: number;
}

/** 角度归一化到 [0, 360) */
export function normAngle(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** 极坐标 → 直角坐标（SVG 坐标，y 向下） */
export function polar(
  cx: number,
  cy: number,
  r: number,
  deg: number,
): [number, number] {
  const rad = (normAngle(deg) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)];
}

/** 单块皮块的扇形环段 path（外弧 → 内弧闭合） */
export function blockPath(idx: number, cx = CENTER, cy = CENTER): string {
  const slice = Math.floor(idx / SEGS);
  const seg = idx % SEGS;
  const r0 = SEG_EDGES[seg + 1]; // 内半径
  const r1 = SEG_EDGES[seg]; // 外半径
  const a0 = START_ANGLE + slice * SLICE_ANGLE;
  const a1 = a0 + SLICE_ANGLE;
  const [x0, y0] = polar(cx, cy, r1, a0);
  const [x1, y1] = polar(cx, cy, r1, a1);
  const [x2, y2] = polar(cx, cy, r0, a1);
  const [x3, y3] = polar(cx, cy, r0, a0);
  return (
    `M ${x0.toFixed(2)} ${y0.toFixed(2)} ` +
    `A ${r1} ${r1} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} ` +
    `L ${x2.toFixed(2)} ${y2.toFixed(2)} ` +
    `A ${r0} ${r0} 0 0 0 ${x3.toFixed(2)} ${y3.toFixed(2)} Z`
  );
}

/** 整瓣（含所有段）path，用于白络层 / 果肉层 */
export function slicePath(slice: number, cx = CENTER, cy = CENTER): string {
  const a0 = START_ANGLE + slice * SLICE_ANGLE;
  const a1 = a0 + SLICE_ANGLE;
  const [x0, y0] = polar(cx, cy, R_OUT, a0);
  const [x1, y1] = polar(cx, cy, R_OUT, a1);
  const [x2, y2] = polar(cx, cy, R_IN, a1);
  const [x3, y3] = polar(cx, cy, R_IN, a0);
  return (
    `M ${x0.toFixed(2)} ${y0.toFixed(2)} ` +
    `A ${R_OUT} ${R_OUT} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)} ` +
    `L ${x2.toFixed(2)} ${y2.toFixed(2)} ` +
    `A ${R_IN} ${R_IN} 0 0 0 ${x3.toFixed(2)} ${y3.toFixed(2)} Z`
  );
}

/** 瓣内径向分界弧线 path（果肉瓣粒纹理用） */
export function segArc(slice: number, seg: number, cx = CENTER, cy = CENTER): string {
  const r = SEG_EDGES[seg]; // 该段外边界半径
  const a0 = START_ANGLE + slice * SLICE_ANGLE;
  const a1 = a0 + SLICE_ANGLE;
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

/**
 * 命中测试：SVG 坐标 → 皮块。落在果脐区 / 橘子外 / 已剥区域之外返回 null。
 * 判定顺序：半径是否在皮环带内 → 径向段 → 按角度算瓣。
 */
export function hitTest(
  x: number,
  y: number,
  cx = CENTER,
  cy = CENTER,
): PeelBlock | null {
  const dx = x - cx;
  const dy = y - cy;
  const r = Math.hypot(dx, dy);
  if (r > R_OUT + 4 || r < R_IN - 4) return null;
  let seg = -1;
  for (let s = 0; s < SEGS; s++) {
    if (r >= SEG_EDGES[s + 1] - 0.01 && r <= SEG_EDGES[s] + 0.01) {
      seg = s;
      break;
    }
  }
  if (seg < 0) return null;
  const ang = normAngle((Math.atan2(dy, dx) * 180) / Math.PI - START_ANGLE);
  const slice = Math.min(SLICES - 1, Math.floor(ang / SLICE_ANGLE));
  return { idx: slice * SEGS + seg, slice, seg };
}

/** 是否整瓣剥完 */
export function sliceComplete(slice: number, peeled: ReadonlySet<number>): boolean {
  for (let s = 0; s < SEGS; s++) {
    if (!peeled.has(slice * SEGS + s)) return false;
  }
  return true;
}

export type Rating = "S" | "A" | "B" | "C";

/** 结算评级：S 完整无划伤；A 完整但有划伤；B 剥下 ≥60%；C 其他 */
export function ratingFor(
  peeledCount: number,
  cuts: number,
  total: number = PEEL_TOTAL,
): Rating {
  if (peeledCount >= total) return cuts === 0 ? "S" : "A";
  if (peeledCount / total >= 0.6) return "B";
  return "C";
}

/** 连击倍率：1 连击 ×1，每多 1 连击 +0.5，封顶 ×5 */
export function comboMultiplier(combo: number): number {
  return Math.min(5, 1 + Math.max(0, combo - 1) * 0.5);
}

/** 单块得分：普通撕皮 10 × 倍率；划伤固定 2 分 */
export function blockGain(combo: number, cut: boolean): number {
  return cut ? 2 : Math.round(10 * comboMultiplier(combo));
}
