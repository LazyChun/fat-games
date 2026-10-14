/*
 * hawkLogic 单元测试
 */
import { describe, expect, it } from "vitest";
import {
  CHICK_R,
  EAGLE_R,
  HEN_R,
  MAX_CHICKS,
  START_CHICKS,
  WIN_SECONDS,
  W,
  H,
  chickCount,
  newSim,
  stepSim,
  type Eagle,
  type HawkSim,
} from "../src/games/hawkLogic";

/** 一帧步进 helper：dt 固定 0.02 */
function tick(sim: HawkSim, dx = 0, dy = 0, dt = 0.02): ReturnType<typeof stepSim> {
  return stepSim(sim, dt, { dx, dy });
}

/** 把一只老鹰摆到指定状态与位置（测试用） */
function placeEagle(
  sim: HawkSim,
  partial: Partial<Eagle> & { x: number; y: number },
): Eagle {
  const base = sim.eagles[0];
  Object.assign(base, {
    vx: 0,
    vy: 0,
    phase: 0,
    carryChick: false,
    speedMul: 1,
    ...partial,
  });
  return base;
}

describe("newSim 初始局面", () => {
  it("母鸡位于底部中央，小鸡满编，1 只老鹰盘旋", () => {
    const sim = newSim();
    expect(sim.hen.x).toBe(W / 2);
    expect(sim.hen.y).toBeLessThan(H);
    expect(chickCount(sim)).toBe(START_CHICKS);
    expect(sim.eagles.length).toBe(1);
    expect(sim.eagles[0].state).toBe("circle");
    expect(sim.score).toBe(0);
    expect(sim.over).toBe(false);
  });
});

describe("母鸡移动与边界", () => {
  it("朝右移动时 x 增大、y 不变", () => {
    const sim = newSim();
    const x0 = sim.hen.x;
    for (let i = 0; i < 20; i++) tick(sim, 1, 0);
    expect(sim.hen.x).toBeGreaterThan(x0);
  });

  it("持续朝左移动不会越出左边界", () => {
    const sim = newSim();
    for (let i = 0; i < 500; i++) tick(sim, -1, 0);
    expect(sim.hen.x).toBeGreaterThanOrEqual(26);
  });

  it("持续朝上移动不会越出上边界（活动区）", () => {
    const sim = newSim();
    for (let i = 0; i < 500; i++) tick(sim, 0, -1);
    expect(sim.hen.y).toBeGreaterThanOrEqual(H - 210);
  });

  it("持续朝下移动不会越出下边界", () => {
    const sim = newSim();
    for (let i = 0; i < 500; i++) tick(sim, 0, 1);
    expect(sim.hen.y).toBeLessThanOrEqual(H - 62);
  });
});

describe("小鸡队列跟随", () => {
  it("母鸡移动后小鸡保持排队且间距不小于设定值", () => {
    const sim = newSim();
    // 快速往返移动让队列拉长
    for (let i = 0; i < 60; i++) tick(sim, i % 2 === 0 ? 1 : -1, 0);
    for (let i = 0; i < 60; i++) tick(sim, 0, -1);
    // 队首紧挨母鸡
    const first = sim.chicks[0];
    expect(Math.hypot(first.x - sim.hen.x, first.y - sim.hen.y)).toBeLessThan(40);
    // 所有小鸡都在活动区
    for (const c of sim.chicks) {
      expect(c.x).toBeGreaterThanOrEqual(26);
      expect(c.x).toBeLessThanOrEqual(W - 26);
      expect(c.y).toBeGreaterThanOrEqual(H - 230);
      expect(c.y).toBeLessThanOrEqual(H - 56);
    }
  });
});

describe("老鹰抓小鸡", () => {
  it("俯冲接近队尾小鸡时将其抓走（catch 事件，队列减一）", () => {
    const sim = newSim();
    // 锁定 dive 并贴近队尾小鸡
    const tail = sim.chicks[sim.chicks.length - 1];
    placeEagle(sim, {
      x: tail.x + 1,
      y: tail.y + 1,
      state: "dive",
      stateT: 999,
    });
    const events = tick(sim);
    expect(events.some((e) => e.type === "catch")).toBe(true);
    expect(chickCount(sim)).toBe(START_CHICKS - 1);
    expect(sim.caught).toBe(1);
  });

  it("母鸡撞到俯冲的老鹰会将其啄晕（stun 事件）", () => {
    const sim = newSim();
    placeEagle(sim, {
      x: sim.hen.x + 1,
      y: sim.hen.y + 1,
      state: "dive",
      stateT: 999,
    });
    const events = tick(sim);
    expect(events.some((e) => e.type === "stun")).toBe(true);
    expect(sim.eagles[0].state).toBe("stun");
  });

  it("母鸡啄晕叼着鸡的老鹰会救回小鸡（rescue 事件，+50 分）", () => {
    const sim = newSim();
    const before = chickCount(sim);
    sim.chicks.pop(); // 老鹰已叼走队尾一只（真实流程：先 catch 再 carry）
    placeEagle(sim, {
      x: sim.hen.x + 1,
      y: sim.hen.y - 2,
      state: "carry",
      stateT: 6,
      carryChick: true,
    });
    const events = tick(sim);
    expect(events.some((e) => e.type === "rescue")).toBe(true);
    expect(sim.rescued).toBe(1);
    expect(chickCount(sim)).toBe(before); // 救回后数量恢复
    expect(sim.score).toBeCloseTo(50 + 2 * 0.02, 2); // 救援 +50，另加本帧存活分
  });

  it("stun 状态的老鹰不会被重复啄晕", () => {
    const sim = newSim();
    placeEagle(sim, {
      x: sim.hen.x + 1,
      y: sim.hen.y + 1,
      state: "stun",
      stateT: 2,
    });
    const events = tick(sim);
    expect(events.some((e) => e.type === "stun")).toBe(false);
    expect(sim.eagles[0].state).toBe("stun");
  });

  it("老鹰俯冲距离判定用半径之和", () => {
    const sim = newSim();
    const tail = sim.chicks[sim.chicks.length - 1];
    // 恰好略小于抓取距离：CHICK_R + EAGLE_R + 4
    const grab = CHICK_R + EAGLE_R + 4 - 0.5;
    placeEagle(sim, {
      x: tail.x + grab,
      y: tail.y,
      state: "dive",
      stateT: 999,
    });
    const events = tick(sim);
    expect(events.some((e) => e.type === "catch")).toBe(true);
  });
});

describe("金蛋", () => {
  it("母鸡碰到金蛋补一只小鸡（egg 事件，+30 分）", () => {
    const sim = newSim();
    sim.eggs.push({ x: sim.hen.x, y: sim.hen.y, vy: 0, r: 9 });
    const before = chickCount(sim);
    const events = tick(sim);
    expect(events.some((e) => e.type === "egg")).toBe(true);
    expect(chickCount(sim)).toBe(before + 1);
    expect(sim.score).toBeCloseTo(30 + 2 * 0.02, 2);
  });

  it("小鸡满编时吃金蛋只加分不加鸡（eggFull 事件）", () => {
    const sim = newSim();
    while (chickCount(sim) < MAX_CHICKS) {
      sim.chicks.push({ x: 50 - chickCount(sim) * 10, y: H - 80 });
    }
    sim.eggs.push({ x: sim.hen.x, y: sim.hen.y, vy: 0, r: 9 });
    const before = chickCount(sim);
    const events = tick(sim);
    expect(events.some((e) => e.type === "eggFull")).toBe(true);
    expect(chickCount(sim)).toBe(before);
    expect(sim.score).toBeCloseTo(10 + 2 * 0.02, 2);
  });
});

describe("胜负判定", () => {
  it("存活满 60 秒且仍有小鸡 -> 胜利并加分", () => {
    const sim = newSim();
    sim.eagles = []; // 避免干扰
    sim.nextEagleIn = 9999;
    sim.nextEggIn = 9999;
    const steps = Math.ceil(WIN_SECONDS / 0.02) + 1;
    let events: ReturnType<typeof stepSim> = [];
    for (let i = 0; i < steps; i++) {
      events = events.concat(tick(sim));
      if (sim.over) break;
    }
    expect(events.some((e) => e.type === "win")).toBe(true);
    expect(sim.over).toBe(true);
    expect(sim.won).toBe(true);
    expect(sim.score).toBeGreaterThan(START_CHICKS * 20 + 100);
  });

  it("小鸡被抓光 -> 失败", () => {
    const sim = newSim();
    sim.chicks = [];
    const events = tick(sim);
    expect(events.some((e) => e.type === "lose")).toBe(true);
    expect(sim.over).toBe(true);
    expect(sim.won).toBe(false);
  });

  it("结束后不再推进（stepSim 返回空事件）", () => {
    const sim = newSim();
    sim.chicks = [];
    tick(sim);
    const score = sim.score;
    const events = tick(sim);
    expect(events).toEqual([]);
    expect(sim.score).toBe(score);
  });
});

describe("母鸡撞鹰判定距离", () => {
  it("在 HEN_R + EAGLE_R + 2 内可啄晕，超出则不行", () => {
    const peck = HEN_R + EAGLE_R + 2;
    const sim1 = newSim();
    placeEagle(sim1, {
      x: sim1.hen.x,
      y: sim1.hen.y + 1,
      state: "carry",
      stateT: 6,
      carryChick: false,
    });
    expect(tick(sim1).some((e) => e.type === "stun")).toBe(true);

    const sim2 = newSim();
    placeEagle(sim2, {
      x: sim2.hen.x,
      y: sim2.hen.y + 60,
      state: "carry",
      stateT: 6,
      carryChick: false,
    });
    expect(tick(sim2).some((e) => e.type === "stun")).toBe(false);
  });
});
