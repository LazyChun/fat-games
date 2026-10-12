/*
 * rocketLogic 单元测试
 */
import { describe, expect, it } from "vitest";
import {
  applyWorldBounds,
  defaultWorld,
  evaluateLanding,
  landingScore,
  normalizeAngle,
  NO_ENGINES,
  ROCKET_PARAMS,
  spawnRocket,
  stepRocket,
  tailSpeed,
  tailWorld,
  waveParams,
  type RocketState,
  type RocketWorld,
} from "../src/games/rocketLogic";

const WORLD: RocketWorld = defaultWorld();
const P = ROCKET_PARAMS;

function rocket(partial: Partial<RocketState> = {}): RocketState {
  return {
    x: 280,
    y: 200,
    vx: 0,
    vy: 0,
    angle: 0,
    spin: 0,
    fuel: 1,
    ...partial,
  };
}

describe("normalizeAngle", () => {
  it("把角度归一化到 (-π, π]", () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(Math.PI * 2)).toBeCloseTo(0);
    expect(normalizeAngle(-Math.PI * 3)).toBeCloseTo(-Math.PI);
    expect(normalizeAngle(Math.PI + 0.1)).toBeCloseTo(-Math.PI + 0.1);
    expect(normalizeAngle(2.5)).toBeCloseTo(2.5);
  });
});

describe("stepRocket 物理", () => {
  it("不点火时在重力作用下加速下落", () => {
    const s = rocket({ vy: 0 });
    stepRocket(s, NO_ENGINES, WORLD, P, 0.1);
    // 半隐式欧拉：vy 先更新再用于位移
    expect(s.vy).toBeCloseTo(P.gravity * 0.1);
    expect(s.y).toBeCloseTo(200 + P.gravity * 0.1 * 0.1);
    expect(s.fuel).toBe(1);
  });

  it("点火下喷口（尾喷口）能抵消重力并向上加速", () => {
    const s = rocket();
    stepRocket(s, { up: false, down: true, left: false, right: false }, WORLD, P, 0.1);
    // 净加速度 = thrustDown - gravity，方向向上（屏幕 y 向下，故 vy 为负）
    expect(s.vy).toBeCloseTo(-(P.thrustDown - P.gravity) * 0.1);
    expect(s.fuel).toBeLessThan(1);
    expect(s.fuel).toBeGreaterThan(0.9);
  });

  it("点火左喷口：纯转向 RCS，机头朝上时顺时针旋转且不产生平移", () => {
    const s = rocket({ angle: 0 });
    stepRocket(s, { up: false, down: false, left: true, right: false }, WORLD, P, 0.1);
    expect(s.angle).toBeGreaterThan(0); // 顺时针（机头向右摆，牛顿反作用力）
    expect(s.spin).toBeGreaterThan(0);
    expect(s.vx).toBeCloseTo(0); // 侧喷口不产生横向平移
  });

  it("点火右喷口：机头朝上时逆时针旋转且不产生平移", () => {
    const s = rocket({ angle: 0 });
    stepRocket(s, { up: false, down: false, left: false, right: true }, WORLD, P, 0.1);
    expect(s.angle).toBeLessThan(0);
    expect(s.spin).toBeLessThan(0);
    expect(s.vx).toBeCloseTo(0);
  });

  it("燃料耗尽后喷口无法点火", () => {
    const s = rocket({ fuel: 0.001 });
    stepRocket(s, { up: false, down: true, left: false, right: false }, WORLD, P, 0.1);
    // 0.001 - 0.16*0.1 < 0 → 燃料耗尽，后续帧熄火
    expect(s.fuel).toBe(0);
    const beforeVy = s.vy;
    stepRocket(s, { up: false, down: true, left: false, right: false }, WORLD, P, 0.1);
    // 熄火后只受重力
    expect(s.vy).toBeCloseTo(beforeVy + P.gravity * 0.1);
  });

  it("左右墙体反弹，不穿墙", () => {
    const s = rocket({ x: 5, vx: -200 });
    applyWorldBounds(s, WORLD, P);
    expect(s.x).toBeGreaterThanOrEqual(0);
    expect(s.vx).toBeGreaterThanOrEqual(0);
  });
});

describe("evaluateLanding 落地判定", () => {
  it("尚未触地时返回 air", () => {
    const s = rocket({ y: 200 });
    expect(evaluateLanding(s, WORLD, P).result).toBe("air");
  });

  it("尾端对准着陆点、低速且姿态正 → 着陆成功", () => {
    const s = rocket({
      y: WORLD.groundY - P.halfLen,
      vx: 0,
      vy: -60, // 尾端向下运动 60px/s
      angle: 0,
      spin: 0,
    });
    const v = evaluateLanding(s, WORLD, P);
    expect(v.result).toBe("landed");
  });

  it("速度过快 → 坠毁（fast）", () => {
    const s = rocket({
      y: WORLD.groundY - P.halfLen,
      vy: -500,
      angle: 0,
    });
    const v = evaluateLanding(s, WORLD, P);
    expect(v.result).toBe("crashed");
    expect(v.reason).toBe("fast");
  });

  it("姿态倾斜过大 → 坠毁（tilt）", () => {
    // 尾端刚好触地（机尾仍是最低点），但倾斜 1.2 rad 超标
    const s = rocket({
      y: WORLD.groundY - P.halfLen * Math.cos(1.2),
      vy: -60,
      angle: 1.2,
    });
    const v = evaluateLanding(s, WORLD, P);
    expect(v.result).toBe("crashed");
    expect(v.reason).toBe("tilt");
  });

  it("落在着陆点外 → 坠毁（off-pad）", () => {
    const s = rocket({
      x: WORLD.padX + WORLD.padHalfWidth + 40,
      y: WORLD.groundY - P.halfLen,
      vy: -60,
      angle: 0,
    });
    const v = evaluateLanding(s, WORLD, P);
    expect(v.result).toBe("crashed");
    expect(v.reason).toBe("off-pad");
  });

  it("机头先触地 → 坠毁（wrong-part）", () => {
    const s = rocket({
      y: WORLD.groundY - P.halfLen,
      vy: 60,
      angle: Math.PI, // 倒扣：机头朝下
    });
    const v = evaluateLanding(s, WORLD, P);
    expect(v.result).toBe("crashed");
    expect(v.reason).toBe("wrong-part");
  });

  it("角速度过大 → 坠毁（spin）", () => {
    const s = rocket({
      y: WORLD.groundY - P.halfLen,
      vy: -60,
      angle: 0,
      spin: 3,
    });
    const v = evaluateLanding(s, WORLD, P);
    expect(v.result).toBe("crashed");
    expect(v.reason).toBe("spin");
  });
});

describe("波次与得分", () => {
  it("越靠后初始下落越快、燃料越少", () => {
    const w1 = waveParams(1);
    const w5 = waveParams(5);
    expect(w5.vy0).toBeGreaterThan(w1.vy0);
    expect(w5.fuel).toBeLessThan(w1.fuel);
    expect(w1.fuel).toBe(1);
  });

  it("燃料有下限，不会出现负燃料", () => {
    expect(waveParams(99).fuel).toBeGreaterThanOrEqual(0.3);
    expect(waveParams(99).vy0).toBeLessThanOrEqual(260);
  });

  it("spawnRocket 生成在场地内且携带波次参数", () => {
    const s = spawnRocket(1, WORLD, () => 0.5);
    expect(s.x).toBeGreaterThanOrEqual(0);
    expect(s.x).toBeLessThanOrEqual(WORLD.width);
    expect(s.y).toBe(120);
    expect(s.vy).toBe(waveParams(1).vy0);
    expect(s.fuel).toBe(1);
  });

  it("着陆得分：精准低速高分，越偏越快越低分", () => {
    const good = landingScore(1, 0, WORLD.padX, WORLD.padX, WORLD.padHalfWidth, P.maxLandingSpeed);
    const bad = landingScore(0.3, 130, WORLD.padX + WORLD.padHalfWidth, WORLD.padX, WORLD.padHalfWidth, P.maxLandingSpeed);
    expect(good).toBeGreaterThan(bad);
    expect(good).toBe(100 + 100 + 60 + 40); // 满分情形（零触地速度）
  });
});

describe("tailWorld / tailSpeed", () => {
  it("机头朝上时尾端位于质心正下方", () => {
    const s = rocket({ x: 100, y: 200 });
    const t = tailWorld(s, P);
    expect(t.x).toBeCloseTo(100);
    expect(t.y).toBeCloseTo(200 + P.halfLen);
  });

  it("旋转 180° 后尾端位于质心正上方（倒扣）", () => {
    const s = rocket({ x: 100, y: 200, angle: Math.PI });
    const t = tailWorld(s, P);
    expect(t.x).toBeCloseTo(100);
    expect(t.y).toBeCloseTo(200 - P.halfLen);
  });

  it("尾端合速度包含角速度贡献", () => {
    const s = rocket({ vy: -100, spin: 0 });
    expect(tailSpeed(s, P)).toBeCloseTo(100);
    const s2 = rocket({ vy: -100, spin: 2, angle: 0 });
    // 角速度贡献沿尾端圆周方向
    expect(tailSpeed(s2, P)).not.toBeCloseTo(100);
  });
});
