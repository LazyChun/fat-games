/*
 * slingshotLogic（引力弹弓）单元测试
 *
 * 规则集 ruleset_id: slingshot-v1。全部使用确定性随机源 rand = () => 0.5，
 * 使 createWorld 的位置/质量抖动为 0，便于精确断言。
 */
import { describe, expect, it } from "vitest";
import {
  createRun,
  createShip,
  createWorld,
  NO_ENGINES,
  normalizeAngle,
  pickNextDest,
  planetById,
  shipSpeed,
  SLINGSHOT_PARAMS,
  stepSim,
  type EngineInput,
  type GameEvent,
  type RunState,
  type World,
} from "../src/games/slingshotLogic";

const P = SLINGSHOT_PARAMS;
const RAND = () => 0.5;

function makeRun(): { world: World; run: RunState } {
  const r = createRun(RAND);
  r.run.phase = "flying";
  return r;
}

function step(run: RunState, world: World, input: EngineInput, seconds: number, dt = 0.02): GameEvent[] {
  const events: GameEvent[] = [];
  const n = Math.max(1, Math.round(seconds / dt));
  for (let i = 0; i < n; i++) {
    stepSim(run, input, world, P, dt, events);
  }
  return events;
}

/** 弱引力单行星世界：用于补给 / 大气 / 陨石的确定性场景（引力几乎不干扰） */
function weakWorld(kind: "base" | "normal" = "normal", refuelR = 0): World {
  return {
    width: 2000,
    height: 2000,
    startBaseId: "w",
    planets: [
      {
        id: "w",
        name: "弱引力星",
        x: 1000,
        y: 1000,
        radius: 20,
        gm: 5e3,
        kind,
        hue: 150,
        atmosphereR: 25,
        wellR: 134,
        refuelR,
      },
    ],
  };
}

function weakRun(world: World, x: number, y: number): RunState {
  const { run } = createRun(RAND);
  run.phase = "flying";
  run.ship.x = x;
  run.ship.y = y;
  run.ship.vx = 0;
  run.ship.vy = 0;
  return run;
}

describe("重力（TEST-GRAVITY）", () => {
  it("静止飞船在行星旁一帧后速度指向行星中心，幅值 ≈ GM/r²×dt", () => {
    const { world, run } = makeRun();
    const base = planetById(world, "base-a")!; // (700,750) gm=3.5e6
    run.ship.x = base.x;
    run.ship.y = base.y + 100; // 正下方 100px
    run.ship.vx = 0;
    run.ship.vy = 0;
    step(run, world, NO_ENGINES, 0.1, 0.1); // 单帧 0.1s
    // a = 3.5e6 / 100² = 350 px/s² 朝上（-y），其余行星叠加少量向下引力
    expect(run.ship.vy).toBeLessThan(-30);
    expect(run.ship.vy).toBeGreaterThan(-36);
    expect(Math.abs(run.ship.vx)).toBeLessThan(2);
    // 下一帧继续靠近行星
    const y0 = run.ship.y;
    step(run, world, NO_ENGINES, 0.1, 0.1);
    expect(run.ship.y).toBeLessThan(y0);
  });
});

describe("引力弹弓（TEST-SLING-DEFLECT）", () => {
  it("以 800px/s、95px 净距掠过巨行星：转向 ≥40°、速度飙升、无碰撞，计数弹弓", () => {
    const { world, run } = makeRun();
    const giant = planetById(world, "giant")!; // (2760,1420) gm=2.4e7
    // 从左侧以 800px/s 向东飞，影响参数 b=95（从行星中心下方掠过）
    run.ship.x = giant.x - 500;
    run.ship.y = giant.y + 95;
    run.ship.vx = 800;
    run.ship.vy = 0;

    let entryAngle = 0;
    let entered = false;
    let maxSpeedInWell = 0;
    const events: GameEvent[] = [];
    let bounces = 0;

    for (let i = 0; i < 600; i++) {
      stepSim(run, NO_ENGINES, world, P, 0.02, events);
      const trk = run.inWell["giant"];
      if (!entered && trk && trk.inside) {
        entered = true;
        entryAngle = Math.atan2(run.ship.vy, run.ship.vx);
      }
      if (trk && trk.inside) {
        maxSpeedInWell = Math.max(maxSpeedInWell, shipSpeed(run.ship));
      }
      bounces += events.filter((e) => e.type === "bounce").length;
      if (run.ship.x > giant.x + 600) break;
    }

    const exitAngle = Math.atan2(run.ship.vy, run.ship.vx);
    const deflection = Math.abs(normalizeAngle(exitAngle - entryAngle));
    const slingEvents = events.filter((e) => e.type === "slingshot") as Array<{
      type: "slingshot";
      turnDeg: number;
    }>;

    expect(entered).toBe(true);
    expect(bounces).toBe(0); // 未触及行星核心
    expect(deflection).toBeGreaterThanOrEqual(0.7); // ≥ 40°
    expect(deflection).toBeLessThan(1.2); // 不会夸张到反向
    expect(maxSpeedInWell).toBeGreaterThan(1000); // 井内速度飙升（势能转化）
    expect(run.slingshots).toBeGreaterThanOrEqual(1);
    expect(slingEvents.length).toBeGreaterThanOrEqual(1);
    expect(slingEvents[0].turnDeg).toBeGreaterThanOrEqual(35);
  });

  it("远离行星直线飞行不会误计弹弓", () => {
    const { world, run } = makeRun();
    run.ship.x = 2600;
    run.ship.y = 1800;
    run.ship.vx = 500;
    run.ship.vy = 0;
    step(run, world, NO_ENGINES, 3);
    expect(run.slingshots).toBe(0);
  });
});

describe("能源（TEST-ENERGY）", () => {
  it("点火按速率消耗，滑行不消耗", () => {
    const { world, run } = makeRun();
    expect(run.ship.energy).toBeCloseTo(1);
    step(run, world, { main: true, retro: false, left: false, right: false }, 1);
    expect(run.ship.energy).toBeCloseTo(1 - P.burnMain, 3);
    const e = run.ship.energy;
    step(run, world, NO_ENGINES, 1);
    expect(run.ship.energy).toBeCloseTo(e, 5);
  });

  it("RCS 转向消耗更少能源且改变角速度", () => {
    const { world, run } = makeRun();
    run.ship.vx = 0;
    run.ship.vy = 0;
    const e0 = run.ship.energy;
    const a0 = run.ship.angle;
    step(run, world, { main: false, retro: false, left: true, right: false }, 0.5);
    expect(run.ship.angle).toBeLessThan(a0); // 逆时针（减小）
    expect(run.ship.energy).toBeCloseTo(e0 - P.burnRcs * 0.5, 4);
  });
});

describe("大气层（TEST-ATMO）", () => {
  it("进入大气层按 0.16/s 掉能并发告警；离开后停止", () => {
    const world = weakWorld();
    const run = weakRun(world, 1024, 1000); // d=24 < atmoR 25，> core 18.4
    const events: GameEvent[] = [];
    stepSim(run, NO_ENGINES, world, P, 0.05, events);
    expect(run.inAtmo).toBe(true);
    expect(events.some((e) => e.type === "atmo_enter")).toBe(true);
    expect(run.ship.energy).toBeCloseTo(1 - P.atmoDrain * 0.05, 4);

    // 移出大气层，不再掉能
    run.ship.x = 1100; // d=100，仍在引力带内但不触发大气层
    const e1 = run.ship.energy;
    step(run, world, NO_ENGINES, 0.5);
    expect(run.inAtmo).toBe(false);
    expect(run.ship.energy).toBeCloseTo(e1, 5);
  });
});

describe("基地补给（TEST-REFUEL）", () => {
  it("补给半径内能源回升并封顶 1.0；半径外不回升", () => {
    const world = weakWorld("base", 130);
    const run = weakRun(world, 1060, 1000); // d=60 < refuelR 130
    run.ship.energy = 0.5;
    step(run, world, NO_ENGINES, 0.5);
    expect(run.ship.energy).toBeCloseTo(0.5 + P.refuelRate * 0.5, 3);

    run.ship.energy = 0.95;
    step(run, world, NO_ENGINES, 1);
    expect(run.ship.energy).toBe(1); // 封顶

    run.ship.x = 1400; // 半径外
    run.ship.energy = 0.8;
    step(run, world, NO_ENGINES, 0.5);
    expect(run.ship.energy).toBeCloseTo(0.8, 5);
  });
});

describe("陨石（TEST-METEOR / TEST-METEOR-INVULN）", () => {
  it("碰撞：-0.3 能源、移除陨石、进入无敌、产生击退", () => {
    const world = weakWorld();
    const run = weakRun(world, 1200, 1000); // 远离行星，引力可忽略
    run.meteors.push({ x: run.ship.x + 5, y: run.ship.y, vx: 0, vy: 0, radius: 8 });
    const events: GameEvent[] = [];
    stepSim(run, NO_ENGINES, world, P, 0.05, events);
    expect(run.ship.energy).toBeCloseTo(1 - P.meteorHitLoss, 4);
    expect(run.ship.invuln).toBeCloseTo(P.invuln, 4);
    expect(run.meteors.length).toBe(0);
    expect(events.some((e) => e.type === "meteor_hit")).toBe(true);
    expect(run.ship.vx).toBeCloseTo(-P.knockback, 0); // 陨石在右，击退向左
  });

  it("无敌窗口内碰撞不扣能源、不重复击退", () => {
    const world = weakWorld();
    const run = weakRun(world, 1200, 1000);
    run.ship.invuln = 1.0;
    run.ship.energy = 0.7;
    run.meteors.push({ x: run.ship.x + 3, y: run.ship.y, vx: 0, vy: 0, radius: 8 });
    step(run, world, NO_ENGINES, 0.05);
    expect(run.ship.energy).toBeCloseTo(0.7, 5);
    expect(Math.abs(run.ship.vx)).toBeLessThan(0.5); // 无击退
    expect(run.meteors.length).toBe(0); // 陨石仍被清除
  });
});

describe("终局（TEST-OVER）", () => {
  it("能源归零 → 相位 OVER 且只结算一次", () => {
    const { world, run } = makeRun();
    run.ship.x = 2600;
    run.ship.y = 1800;
    run.ship.vx = 0;
    run.ship.vy = 0;
    run.ship.energy = 0.005;
    const events: GameEvent[] = [];
    stepSim(run, { main: true, retro: false, left: false, right: false }, world, P, 0.1, events);
    expect(run.ship.energy).toBe(0);
    expect(run.phase).toBe("over");
    expect(run.energyZeroFired).toBe(true);
    // 后续帧不再变化（只结算一次）
    step(run, world, NO_ENGINES, 0.5);
    expect(run.phase).toBe("over");
    expect(run.distancePx).toBeGreaterThanOrEqual(0); // 无异常
  });
});

describe("下一站（TEST-DEST）", () => {
  it("初始下一站 = 距出发基地最远者；抵达后按最久未抵达轮转", () => {
    const { world, run } = makeRun();
    expect(run.nextDestId).toBe("base-b"); // 距 base-a 最远

    // 直接抵达 base-c 补给区
    const c = planetById(world, "base-c")!;
    run.ship.x = c.x + 60;
    run.ship.y = c.y;
    run.ship.vx = 0;
    run.ship.vy = 0;
    step(run, world, NO_ENGINES, 0.05);
    expect(run.baseReached).toBe(1);
    expect(run.visitedOrder[run.visitedOrder.length - 1]).toBe("base-c");
    expect(run.nextDestId).toBe("base-b"); // c 之后最久未访问的是 b

    // 再抵达 base-b → 下一站回到 base-a
    const b = planetById(world, "base-b")!;
    run.ship.x = b.x + 60;
    run.ship.y = b.y;
    run.ship.vx = 0;
    run.ship.vy = 0;
    step(run, world, NO_ENGINES, 0.05);
    expect(run.baseReached).toBe(2);
    expect(run.nextDestId).toBe("base-a");

    // pickNextDest 轮转断言：b 未访问时优先 b；访问后回 a；再回 c，形成 a→c→b→a 循环
    expect(pickNextDest(world, ["base-a"])).toBe("base-b");
    expect(pickNextDest(world, ["base-a", "base-c"])).toBe("base-b");
    expect(pickNextDest(world, ["base-a", "base-c", "base-b"])).toBe("base-a");
    expect(pickNextDest(world, ["base-a", "base-c", "base-b", "base-a"])).toBe("base-c");
  });
});

describe("距离与得分（TEST-DISTANCE）", () => {
  it("距离按速度×时间累积（1px = 1km）", () => {
    const { world, run } = makeRun();
    run.ship.x = 2600; // 恒星无引力，附近行星影响极小
    run.ship.y = 1800;
    run.ship.vx = 600;
    run.ship.vy = 0;
    step(run, world, NO_ENGINES, 2);
    expect(run.distancePx).toBeGreaterThan(1150);
    expect(run.distancePx).toBeLessThan(1250);
  });
});

describe("重开（TEST-RESTART）", () => {
  it("重新生成一局：相位 idle、距离/统计清零、能源回满", () => {
    const { world, run } = makeRun();
    run.distancePx = 123456;
    run.slingshots = 9;
    run.baseReached = 4;
    run.ship.energy = 0.2;
    const fresh = createRun(RAND);
    expect(fresh.run.phase).toBe("idle");
    expect(fresh.run.distancePx).toBe(0);
    expect(fresh.run.slingshots).toBe(0);
    expect(fresh.run.baseReached).toBe(0);
    expect(fresh.run.ship.energy).toBe(1);
    expect(fresh.run.meteors.length).toBe(0);
    expect(fresh.world.planets.length).toBe(world.planets.length);
    expect(fresh.run.nextDestId).toBe("base-b");
  });

  it("createShip 初始位置在出发基地外、携带向东初速", () => {
    const world = createWorld(RAND);
    const ship = createShip(world, P, RAND);
    const base = planetById(world, world.startBaseId)!;
    expect(ship.x).toBeCloseTo(base.x + 210);
    expect(ship.vx).toBe(260);
  });
});
