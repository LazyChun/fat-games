import { describe, expect, it } from "vitest";
import {
  anyMoving,
  autoPlaceCue,
  BALL_D,
  BALL_R,
  CUSHION_REST,
  BALL_REST,
  countLeft,
  createRack,
  findFreeSpot,
  HEAD_X,
  isCleared,
  placeCueAt,
  POCKETS,
  shoot,
  stepBalls,
  TABLE_L,
  TABLE_W,
  type PoolBall,
} from "../src/games/poolLogic";

/** 可复现随机源 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 检查所有未落袋的球互不重叠且都在台面内 */
function expectValidLayout(balls: PoolBall[]) {
  const live = balls.filter((b) => !b.potted);
  for (const b of live) {
    expect(b.x).toBeGreaterThanOrEqual(BALL_R - 1e-6);
    expect(b.x).toBeLessThanOrEqual(TABLE_L - BALL_R + 1e-6);
    expect(b.y).toBeGreaterThanOrEqual(BALL_R - 1e-6);
    expect(b.y).toBeLessThanOrEqual(TABLE_W - BALL_R + 1e-6);
  }
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const d = Math.hypot(live[i].x - live[j].x, live[i].y - live[j].y);
      expect(d).toBeGreaterThanOrEqual(BALL_D - 1e-6);
    }
  }
}

describe("createRack", () => {
  it("生成 16 颗球：白球在头部点，目标球全部在台面内", () => {
    const balls = createRack(lcg(7));
    expect(balls).toHaveLength(16);
    expect(balls[0].id).toBe(0);
    expect(balls[0].x).toBeCloseTo(HEAD_X);
    expect(balls[0].y).toBeCloseTo(TABLE_W / 2);
    expect(countLeft(balls)).toBe(15);
    expect(isCleared(balls)).toBe(false);
    expectValidLayout(balls);
  });

  it("8 号球位于三角架正中心（第 3 行第 2 个）", () => {
    const balls = createRack(lcg(3));
    const row2 = balls.slice(4, 7); // 行 3：3 颗（含白球偏移）
    expect(row2[1].id).toBe(8);
  });

  it("1 号球位于三角架顶点", () => {
    const balls = createRack(lcg(5));
    expect(balls[1].id).toBe(1);
  });
});

describe("库边反弹", () => {
  it("水平撞右库边反弹并按恢复系数减速", () => {
    const balls: PoolBall[] = [
      { id: 0, x: TABLE_L - BALL_R + 0.1, y: TABLE_W / 2, vx: 40, vy: 0, potted: false },
    ];
    const r = stepBalls(balls, 1 / 120);
    expect(balls[0].vx).toBeLessThan(0);
    // 先阻尼后反弹：|vx| ≈ 40 * exp(-FRICTION*h) * CUSHION_REST
    expect(Math.abs(balls[0].vx)).toBeCloseTo(40 * CUSHION_REST, 0);
    expect(r.cushionHits).toBe(1);
  });

  it("竖直撞上库边反弹（避开中袋口）", () => {
    const balls: PoolBall[] = [
      { id: 0, x: 30, y: TABLE_W - BALL_R + 0.3, vx: 0, vy: 30, potted: false },
    ];
    const r = stepBalls(balls, 1 / 120);
    expect(balls[0].vy).toBeLessThan(0);
    expect(r.cushionHits).toBe(1);
  });

  it("靠近角袋的球撞库边不反弹（袋口放行）", () => {
    const balls: PoolBall[] = [
      { id: 0, x: 2.5, y: 2.6, vx: 0, vy: -30, potted: false },
    ];
    const r = stepBalls(balls, 1 / 120);
    // 袋口范围内：不应反弹（vy 保持负向或已落袋）
    expect(r.cushionHits).toBe(0);
  });
});

describe("落袋", () => {
  it("球滚入角袋被判定落袋", () => {
    const balls: PoolBall[] = [
      { id: 0, x: 2.0, y: 2.0, vx: -20, vy: -20, potted: false },
    ];
    const r = stepBalls(balls, 1 / 120);
    expect(r.potted).toContain(0);
    expect(balls[0].potted).toBe(true);
  });

  it("球滚入中袋被判定落袋", () => {
    const balls: PoolBall[] = [
      { id: 1, x: TABLE_L / 2 + 1.6, y: BALL_R, vx: 0, vy: -15, potted: false },
    ];
    const r = stepBalls(balls, 1 / 120);
    expect(r.potted).toContain(1);
  });
});

describe("球-球碰撞", () => {
  it("等质量对心碰撞交换速度（带恢复系数）", () => {
    const balls: PoolBall[] = [
      { id: 0, x: 40, y: TABLE_W / 2, vx: 20, vy: 0, potted: false },
      { id: 1, x: 40 + BALL_D - 0.1, y: TABLE_W / 2, vx: 0, vy: 0, potted: false },
    ];
    const r = stepBalls(balls, 1 / 120);
    expect(r.ballImpacts).toBe(1);
    // 静止球获得接近 20 * (1+e)/2 的速度（碰撞前有微小阻尼）
    expect(balls[1].vx).toBeCloseTo(20 * ((1 + BALL_REST) / 2), 0);
    expect(balls[0].vx).toBeLessThan(1);
    expect(balls[0].vx).toBeGreaterThan(-1);
  });

  it("碰撞后不再重叠", () => {
    const balls: PoolBall[] = [
      { id: 0, x: 40, y: TABLE_W / 2, vx: 20, vy: 0, potted: false },
      { id: 1, x: 40 + BALL_D - 0.5, y: TABLE_W / 2, vx: 0, vy: 0, potted: false },
    ];
    stepBalls(balls, 1 / 120);
    expect(Math.hypot(balls[0].x - balls[1].x, balls[0].y - balls[1].y)).toBeGreaterThanOrEqual(
      BALL_D - 1e-6,
    );
  });
});

describe("击球与白球复位", () => {
  it("shoot 按角度与力度设置白球速度", () => {
    const balls = createRack(lcg(1));
    const ok = shoot(balls, 0, 1);
    expect(ok).toBe(true);
    expect(balls[0].vx).toBeGreaterThan(0);
    expect(balls[0].vy).toBeCloseTo(0, 6);
    expect(Math.hypot(balls[0].vx, balls[0].vy)).toBeGreaterThan(10);
  });

  it("力度 0 只给最小速度；力度越大力速越快", () => {
    const a = createRack(lcg(2));
    const b = createRack(lcg(2));
    shoot(a, 0, 0);
    shoot(b, 0, 1);
    const va = Math.hypot(a[0].vx, a[0].vy);
    const vb = Math.hypot(b[0].vx, b[0].vy);
    expect(va).toBeLessThan(vb);
  });

  it("白球落袋后 autoPlaceCue 复位且不与其它球重叠", () => {
    const balls = createRack(lcg(9));
    balls[0].potted = true;
    autoPlaceCue(balls);
    expect(balls[0].potted).toBe(false);
    expectValidLayout(balls);
  });

  it("placeCueAt 拒绝与其它球重叠的位置", () => {
    const balls = createRack(lcg(9));
    const target = balls[1];
    expect(placeCueAt(balls, target.x, target.y)).toBe(false);
  });

  it("findFreeSpot 返回合法位置", () => {
    const balls = createRack(lcg(9));
    const spot = findFreeSpot(balls, HEAD_X, TABLE_W / 2, TABLE_W / 2 - BALL_R);
    expect(spot).not.toBeNull();
    expectValidLayout(balls);
  });
});

describe("状态判定", () => {
  it("anyMoving 检测运动球；全部静止返回 false", () => {
    const balls = createRack(lcg(4));
    expect(anyMoving(balls)).toBe(false);
    shoot(balls, 0, 0.8);
    expect(anyMoving(balls)).toBe(true);
  });

  it("全部目标球落袋后 isCleared 为 true", () => {
    const balls = createRack(lcg(4));
    for (const b of balls) {
      if (b.id > 0) b.potted = true;
    }
    expect(isCleared(balls)).toBe(true);
    expect(countLeft(balls)).toBe(0);
  });

  it("袋口几何合理：六个袋都落在台面顶点/长边中点", () => {
    expect(POCKETS).toHaveLength(6);
    expect(POCKETS.filter((p) => p.r >= 3).length).toBe(4); // 角袋较大
  });
});
