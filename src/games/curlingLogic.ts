/*
 * curlingLogic.ts - 冰壶（Curling）核心逻辑
 *
 * 纯函数 / 常量库：场地几何、线性摩擦、等质量弹性碰撞、
 * 有效性判定、局末计分与 AI 投掷决策。
 * 不依赖 DOM / React，便于 vitest 单测。
 */

export type Side = "player" | "ai";

export interface Stone {
  id: number;
  side: Side;
  x: number;
  y: number;
  vx: number;
  vy: number;
  active: boolean;
}

/* ------------------------------------------------------------------ */
/* 场地几何（逻辑坐标 = 渲染坐标）                                      */
/* ------------------------------------------------------------------ */

export const W = 520;
export const H = 460;
/** 冰壶半径 */
export const STONE_R = 13;
/** 大本营外环半径 */
export const HOUSE_R = 62;
/** 大本营圆心（tee） */
export const TEE_X = 120;
export const TEE_Y = 230;
/** 起手线（投掷点 x） */
export const THROW_X = 440;
/** 前掷线：最终停在右侧（未完全过线）的壶无效 */
export const HOG_X = 300;
/** 冰道边界（壶心允许范围） */
export const BOUND_LEFT = 10;
export const BOUND_RIGHT = 510;
export const BOUND_TOP = 38;
export const BOUND_BOTTOM = 422;

/* ------------------------------------------------------------------ */
/* 物理参数                                                            */
/* ------------------------------------------------------------------ */

/** 冰面线性摩擦减速 px/s² */
export const FRICTION = 430;
/** 投掷初速度范围 px/s */
export const MIN_POWER_V = 170;
export const MAX_POWER_V = 730;
/** 每局双方合计投掷次数（4 + 4） */
export const THROWS_PER_END = 8;
/** 总局数 */
export const TOTAL_ENDS = 8;
/** 蓄力充满所需时间 s */
export const CHARGE_TIME = 1.1;

/* ------------------------------------------------------------------ */
/* 基础工具                                                            */
/* ------------------------------------------------------------------ */

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function distToTee(x: number, y: number): number {
  return Math.hypot(x - TEE_X, y - TEE_Y);
}

export function distToTeeStone(s: Stone): number {
  return distToTee(s.x, s.y);
}

export function makeStone(id: number, side: Side, x: number, y: number, vx: number, vy: number): Stone {
  return { id, side, x, y, vx, vy, active: true };
}

/* ------------------------------------------------------------------ */
/* 物理步进：线性摩擦 + 碰撞                                           */
/* ------------------------------------------------------------------ */

/** 推进所有活动壶一个时间步（线性摩擦减速，随后处理碰撞） */
export function stepStones(stones: Stone[], dt: number): void {
  for (const s of stones) {
    if (!s.active) continue;
    const speed = Math.hypot(s.vx, s.vy);
    if (speed <= 0) continue;
    const dec = FRICTION * dt;
    if (speed <= dec) {
      s.vx = 0;
      s.vy = 0;
    } else {
      const k = (speed - dec) / speed;
      s.vx *= k;
      s.vy *= k;
    }
    s.x += s.vx * dt;
    s.y += s.vy * dt;
  }
  resolveCollisions(stones);
}

/** 等质量弹性碰撞：重叠分离 + 交换法向速度分量（只处理互相接近的壶） */
export function resolveCollisions(stones: Stone[]): void {
  for (let i = 0; i < stones.length; i++) {
    const a = stones[i];
    if (!a.active) continue;
    for (let j = i + 1; j < stones.length; j++) {
      const b = stones[j];
      if (!b.active) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      const minD = STONE_R * 2;
      if (dist <= 0 || dist >= minD) continue;
      // 分离到恰好相切
      const overlap = (minD - dist) / dist;
      const pushX = dx * overlap * 0.5;
      const pushY = dy * overlap * 0.5;
      a.x -= pushX;
      a.y -= pushY;
      b.x += pushX;
      b.y += pushY;
      // 交换法向速度（等质量完全弹性）
      const nx = dx / dist;
      const ny = dy / dist;
      const van = a.vx * nx + a.vy * ny;
      const vbn = b.vx * nx + b.vy * ny;
      if (van - vbn > 0) {
        a.vx += (vbn - van) * nx;
        a.vy += (vbn - van) * ny;
        b.vx += (van - vbn) * nx;
        b.vy += (van - vbn) * ny;
      }
    }
  }
}

/** 所有活动壶是否都已静止 */
export function allStopped(stones: Stone[]): boolean {
  return stones.every(
    (s) => !s.active || (Math.abs(s.vx) < 1 && Math.abs(s.vy) < 1),
  );
}

/* ------------------------------------------------------------------ */
/* 有效性判定：出界 / 未过前掷线                                       */
/* ------------------------------------------------------------------ */

export interface CullResult {
  /** 被移除的壶（含原因） */
  removed: Stone[];
  /** 未过前掷线数量 */
  short: number;
  /** 出界数量 */
  out: number;
}

/** 移除出界与未过前掷线的壶；返回移除统计 */
export function cullInvalid(stones: Stone[]): CullResult {
  const removed: Stone[] = [];
  let short = 0;
  let out = 0;
  for (const s of stones) {
    if (!s.active) continue;
    const inBounds =
      s.x >= BOUND_LEFT && s.x <= BOUND_RIGHT && s.y >= BOUND_TOP && s.y <= BOUND_BOTTOM;
    if (!inBounds) {
      s.active = false;
      removed.push(s);
      out += 1;
    } else if (s.x > HOG_X) {
      // 未完全越过前掷线（壶心仍在右侧）
      s.active = false;
      removed.push(s);
      short += 1;
    }
  }
  return { removed, short, out };
}

/* ------------------------------------------------------------------ */
/* 局末计分（标准规则简化版）                                          */
/* ------------------------------------------------------------------ */

/**
 * 计分：双方壶全部停定后，取「在大本营内」的壶，
 * 距圆心最近的一方得分——每有一个比对方最内壶更近的壶得 1 分。
 */
export function scoreEnd(stones: Stone[]): { player: number; ai: number } {
  const pDists = stones
    .filter((s) => s.side === "player" && s.active && distToTeeStone(s) <= HOUSE_R)
    .map(distToTeeStone);
  const aDists = stones
    .filter((s) => s.side === "ai" && s.active && distToTeeStone(s) <= HOUSE_R)
    .map(distToTeeStone);

  if (pDists.length === 0 && aDists.length === 0) return { player: 0, ai: 0 };
  if (aDists.length === 0) return { player: pDists.length, ai: 0 };
  if (pDists.length === 0) return { player: 0, ai: aDists.length };

  const pBest = Math.min(...pDists);
  const aBest = Math.min(...aDists);
  if (pBest < aBest) return { player: pDists.filter((d) => d < aBest).length, ai: 0 };
  return { player: 0, ai: aDists.filter((d) => d < pBest).length };
}

/* ------------------------------------------------------------------ */
/* 投掷顺序                                                            */
/* ------------------------------------------------------------------ */

/**
 * 当前轮到谁：throwsLeft 从 8 递减，偶数次为先手方，奇数次为后手方。
 */
export function whoseTurn(throwsLeft: number, first: Side): Side {
  if (throwsLeft <= 0) return first;
  const isFirst = throwsLeft % 2 === 0;
  if (isFirst) return first;
  return first === "player" ? "ai" : "player";
}

/* ------------------------------------------------------------------ */
/* AI 决策                                                             */
/* ------------------------------------------------------------------ */

export interface AiThrow {
  /** 起手点 y（x 固定为 THROW_X） */
  y: number;
  vx: number;
  vy: number;
}

function pickTarget(stones: Stone[]): { tx: number; ty: number } {
  const mine = stones.filter((s) => s.side === "ai" && s.active);
  const foes = stones.filter((s) => s.side === "player" && s.active);

  const myBest = mine.length
    ? Math.min(...mine.map(distToTeeStone))
    : Infinity;

  // 有敌壶比己方最内壶更接近圆心 → 视为威胁，优先撞开
  const threat = foes
    .filter((f) => distToTeeStone(f) < Math.min(myBest, HOUSE_R))
    .sort((a, b) => distToTeeStone(a) - distToTeeStone(b))[0];
  if (threat) return { tx: threat.x, ty: threat.y };

  // 己方最内壶已相当接近圆心 → 再补一壶到圆心附近加强
  if (myBest < HOUSE_R * 0.7) {
    return { tx: TEE_X + (Math.random() - 0.5) * 26, ty: TEE_Y + (Math.random() - 0.5) * 26 };
  }
  // 默认：瞄准圆心（带小扰动）
  return { tx: TEE_X + (Math.random() - 0.5) * 14, ty: TEE_Y + (Math.random() - 0.5) * 14 };
}

/**
 * AI 投壶决策：选起手点、目标与力度。
 * 力度按「直线滑行所需初速度」估算并加随机扰动，模拟真实手感误差。
 */
export function aiThrow(stones: Stone[]): AiThrow {
  const { tx, ty } = pickTarget(stones);
  const y = clamp(
    ty + (Math.random() - 0.5) * 14,
    BOUND_TOP + STONE_R + 4,
    BOUND_BOTTOM - STONE_R - 4,
  );
  const d = Math.hypot(THROW_X - tx, y - ty);
  const v = clamp(Math.sqrt(2 * FRICTION * d) * (0.94 + Math.random() * 0.16), MIN_POWER_V, MAX_POWER_V);
  const len = Math.hypot(tx - THROW_X, ty - y) || 1;
  return { y, vx: ((tx - THROW_X) / len) * v, vy: ((ty - y) / len) * v };
}
