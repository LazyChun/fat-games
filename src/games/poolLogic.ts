/*
 * poolLogic.ts - 3D 台球纯逻辑模块
 *
 * 台球物理全部收敛在这里（不依赖 DOM / React），便于 vitest 单测：
 *   - 台面几何（2:1 长宽比、六袋、库边袋口）
 *   - 摆球（15 球三角架 + 白球）
 *   - 逐子步长物理（阻尼、球-球弹性碰撞、库边反弹、落袋判定）
 *   - 击球、白球复位、清台判定
 *
 * 坐标系：x 沿台面长边（0..TABLE_L），y 沿台面短边（0..TABLE_W），
 * 单位与球半径一致（球直径 = 4.5，台面 96x48，与真实球台比例一致）。
 */
export type Vec2 = { x: number; y: number };

/** 球体：id 0 = 白球，1..15 = 目标球 */
export interface PoolBall {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  potted: boolean;
}

export const BALL_R = 2.25;
export const BALL_D = BALL_R * 2;
export const TABLE_L = 96;
export const TABLE_W = 48;

/** 每指数秒的速度阻尼系数（滚动摩擦近似） */
export const FRICTION = 0.42;
/** 库边反弹恢复系数 */
export const CUSHION_REST = 0.78;
/** 球-球碰撞恢复系数 */
export const BALL_REST = 0.95;
/** 击球速度区间 */
export const MIN_SHOT_SPEED = 7;
export const MAX_SHOT_SPEED = 42;
/** 低于此速度视为静止 */
export const STOP_EPS = 0.35;

/** 角袋 / 中袋半径 */
export const POCKET_R = 3.35;
export const SIDE_POCKET_R = 2.9;
/** 库边袋口宽度：角袋沿库边 4.6，中袋单侧 3.0（范围内不反弹，球可入袋；与视觉袋口尺寸匹配，避免洞口不齐） */
export const CORNER_MOUTH = 4.6;
export const SIDE_MOUTH = 3.0;

/** 摆球点：白球在头部点（1/4 长），三角架顶点在 72% 长处 */
export const HEAD_X = TABLE_L / 4;
export const FOOT_X = TABLE_L * 0.72;

export interface Pocket {
  x: number;
  y: number;
  r: number;
}

/** 六个袋口中心（两列角袋 + 两侧中袋） */
export const POCKETS: Pocket[] = [
  { x: 0, y: 0, r: POCKET_R },
  { x: TABLE_L, y: 0, r: POCKET_R },
  { x: 0, y: TABLE_W, r: POCKET_R },
  { x: TABLE_L, y: TABLE_W, r: POCKET_R },
  { x: TABLE_L / 2, y: 0, r: SIDE_POCKET_R },
  { x: TABLE_L / 2, y: TABLE_W, r: SIDE_POCKET_R },
];

/* ------------------------------------------------------------------ */
/* 基础数学                                                             */
/* ------------------------------------------------------------------ */

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function len2(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

/* ------------------------------------------------------------------ */
/* 球的颜色                                                             */
/* ------------------------------------------------------------------ */

/** 标准美式台球配色（1-7 实色，8 黑，9-15 花色复用 1-7 色） */
const BALL_COLORS: Record<number, string> = {
  1: "#f5c518",
  2: "#2a6de8",
  3: "#e03e3e",
  4: "#7d3ff2",
  5: "#f58a1f",
  6: "#1f9d55",
  7: "#9c3d54",
  8: "#22262e",
  9: "#f5c518",
  10: "#2a6de8",
  11: "#e03e3e",
  12: "#7d3ff2",
  13: "#f58a1f",
  14: "#1f9d55",
  15: "#9c3d54",
};

/** 球 id → 主体颜色（白球返回白色） */
export function ballColor(id: number): string {
  if (id === 0) return "#f2f3f6";
  return BALL_COLORS[id] || "#e8e8e8";
}

/** 是否为花色球（9-15） */
export function isStriped(id: number): boolean {
  return id > 8;
}

/* ------------------------------------------------------------------ */
/* 摆球                                                               */
/* ------------------------------------------------------------------ */

/** 洗牌（可传入随机源以便测试复现） */
function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/**
 * 生成一局：15 颗目标球摆成三角架（8 号球居中、1 号球在顶点），
 * 白球摆在头部点。rng 可传入确定性随机源（单测用）。
 */
export function createRack(rng: () => number = Math.random): PoolBall[] {
  const balls: PoolBall[] = [
    { id: 0, x: HEAD_X, y: TABLE_W / 2, vx: 0, vy: 0, potted: false },
  ];

  // 先放 8 号球到三角架正中心（第 3 行中间），其余随机填充，
  // 保证 8 号居中、1 号在顶点
  const rest = shuffle(
    [2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15],
    rng,
  );
  const ids = [1, ...rest.slice(0, 3), 8, ...rest.slice(3)];
  // ids[0]=1（顶点），ids[4]=8（第 3 行中间 = 整个三角架的中心）

  const rowStep = BALL_D * Math.sin(Math.PI / 3); // 行间距 ≈ 3.897
  let idx = 0;
  for (let row = 0; row < 5; row++) {
    const count = row + 1;
    const x = FOOT_X + row * rowStep;
    for (let k = 0; k < count; k++) {
      const y = TABLE_W / 2 + (k - (count - 1) / 2) * BALL_D;
      balls.push({
        id: ids[idx],
        x,
        y,
        vx: 0,
        vy: 0,
        potted: false,
      });
      idx += 1;
    }
  }
  return balls;
}

/* ------------------------------------------------------------------ */
/* 物理                                                               */
/* ------------------------------------------------------------------ */

/** 该球是否位于某条库边的袋口范围内（范围内不反弹） */
export function inPocketMouth(x: number, y: number, cushion: "top" | "bottom" | "left" | "right"): boolean {
  if (cushion === "top" || cushion === "bottom") {
    return (
      x < CORNER_MOUTH ||
      x > TABLE_L - CORNER_MOUTH ||
      Math.abs(x - TABLE_L / 2) < SIDE_MOUTH
    );
  }
  return (
    y < CORNER_MOUTH ||
    y > TABLE_W - CORNER_MOUTH
  );
}

export interface StepResult {
  /** 本步落袋的球 id */
  potted: number[];
  /** 本步发生的库边反弹次数 */
  cushionHits: number;
  /** 本步球-球碰撞次数 */
  ballImpacts: number;
}

/**
 * 推进一个固定步长 h 的物理：阻尼 → 位移 → 库边 → 球间碰撞 → 落袋。
 * 原地修改 balls。步长建议 ≤ 1/120 秒避免高速穿透。
 */
export function stepBalls(balls: PoolBall[], h: number): StepResult {
  const result: StepResult = { potted: [], cushionHits: 0, ballImpacts: 0 };
  const damp = Math.exp(-FRICTION * h);

  // 1. 阻尼 + 位移
  for (const b of balls) {
    if (b.potted) continue;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp < STOP_EPS) {
      b.vx = 0;
      b.vy = 0;
      continue;
    }
    b.vx *= damp;
    b.vy *= damp;
    b.x += b.vx * h;
    b.y += b.vy * h;
  }

  // 2. 库边反弹（袋口范围内放行）
  for (const b of balls) {
    if (b.potted) continue;
    if (b.y < BALL_R) {
      if (!inPocketMouth(b.x, b.y, "top")) {
        b.y = BALL_R;
        if (b.vy < 0) {
          b.vy = -b.vy * CUSHION_REST;
          result.cushionHits += 1;
        }
      }
    } else if (b.y > TABLE_W - BALL_R) {
      if (!inPocketMouth(b.x, b.y, "bottom")) {
        b.y = TABLE_W - BALL_R;
        if (b.vy > 0) {
          b.vy = -b.vy * CUSHION_REST;
          result.cushionHits += 1;
        }
      }
    }
    if (b.x < BALL_R) {
      if (!inPocketMouth(b.x, b.y, "left")) {
        b.x = BALL_R;
        if (b.vx < 0) {
          b.vx = -b.vx * CUSHION_REST;
          result.cushionHits += 1;
        }
      }
    } else if (b.x > TABLE_L - BALL_R) {
      if (!inPocketMouth(b.x, b.y, "right")) {
        b.x = TABLE_L - BALL_R;
        if (b.vx > 0) {
          b.vx = -b.vx * CUSHION_REST;
          result.cushionHits += 1;
        }
      }
    }
  }

  // 3. 球-球弹性碰撞（等质量，两两处理一次）
  for (let i = 0; i < balls.length; i++) {
    const a = balls[i];
    if (a.potted) continue;
    for (let j = i + 1; j < balls.length; j++) {
      const b = balls[j];
      if (b.potted) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist >= BALL_D || dist < 1e-9) continue;
      const nx = dx / dist;
      const ny = dy / dist;
      // 分离重叠
      const overlap = (BALL_D - dist) / 2;
      a.x -= nx * overlap;
      a.y -= ny * overlap;
      b.x += nx * overlap;
      b.y += ny * overlap;
      // 法向相对速度：接近才施力
      const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rv < 0) {
        const imp = (-(1 + BALL_REST) * rv) / 2;
        a.vx -= imp * nx;
        a.vy -= imp * ny;
        b.vx += imp * nx;
        b.vy += imp * ny;
        result.ballImpacts += 1;
      }
    }
  }

  // 4. 落袋判定
  for (const b of balls) {
    if (b.potted) continue;
    for (const p of POCKETS) {
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d < p.r) {
        b.potted = true;
        b.vx = 0;
        b.vy = 0;
        result.potted.push(b.id);
        break;
      }
    }
  }

  return result;
}

/** 是否还有球在运动（仅看未落袋的球） */
export function anyMoving(balls: PoolBall[]): boolean {
  for (const b of balls) {
    if (!b.potted && Math.hypot(b.vx, b.vy) >= STOP_EPS) return true;
  }
  return false;
}

/** 击球：白球沿 angle 方向（弧度，x 轴为 0）以 power01（0..1）力度运动 */
export function shoot(balls: PoolBall[], angle: number, power01: number): boolean {
  const cue = balls[0];
  if (cue.potted) return false;
  const speed = MIN_SHOT_SPEED + (MAX_SHOT_SPEED - MIN_SHOT_SPEED) * clamp(power01, 0, 1);
  cue.vx = Math.cos(angle) * speed;
  cue.vy = Math.sin(angle) * speed;
  return true;
}

/** 剩余目标球数量 */
export function countLeft(balls: PoolBall[]): number {
  let n = 0;
  for (const b of balls) {
    if (b.id > 0 && !b.potted) n += 1;
  }
  return n;
}

/** 是否清台（15 颗目标球全部落袋） */
export function isCleared(balls: PoolBall[]): boolean {
  return countLeft(balls) === 0;
}

/** 尝试把白球放到 (x, y)：校验台面边界与不与其它球重叠 */
export function placeCueAt(balls: PoolBall[], x: number, y: number): boolean {
  const cue = balls[0];
  const px = clamp(x, BALL_R, TABLE_L - BALL_R);
  const py = clamp(y, BALL_R, TABLE_W - BALL_R);
  for (const b of balls) {
    if (b.id === 0 || b.potted) continue;
    if (Math.hypot(b.x - px, b.y - py) < BALL_D - 0.01) return false;
  }
  cue.x = px;
  cue.y = py;
  cue.vx = 0;
  cue.vy = 0;
  cue.potted = false;
  return true;
}

/** 在目标点附近按网格扫描一个空闲位置（供白球复位） */
export function findFreeSpot(
  balls: PoolBall[],
  targetX: number,
  targetY: number,
  radius: number,
): { x: number; y: number } | null {
  for (let r = 0; r <= radius; r += BALL_D) {
    for (let dy = -r; dy <= r + 0.01; dy += BALL_D) {
      for (let dx = -r; dx <= r + 0.01; dx += BALL_D) {
        if (Math.hypot(dx, dy) > r + 0.01) continue;
        const x = clamp(targetX + dx, BALL_R, TABLE_L - BALL_R);
        const y = clamp(targetY + dy, BALL_R, TABLE_W - BALL_R);
        if (placeCueAt(balls, x, y)) return { x, y };
      }
    }
  }
  return null;
}

/** 自动复位白球：优先头部点，其次台面中心附近扫描；实在无空位则回中心 */
export function autoPlaceCue(balls: PoolBall[]): { x: number; y: number } {
  const head = findFreeSpot(balls, HEAD_X, TABLE_W / 2, TABLE_W / 2 - BALL_R);
  if (head) return head;
  const center = findFreeSpot(balls, TABLE_L / 2, TABLE_W / 2, TABLE_L / 4);
  if (center) return center;
  const cue = balls[0];
  cue.x = TABLE_L / 2;
  cue.y = TABLE_W / 2;
  cue.vx = 0;
  cue.vy = 0;
  cue.potted = false;
  return { x: cue.x, y: cue.y };
}
