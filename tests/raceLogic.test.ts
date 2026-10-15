/*
 * raceLogic 单元测试：赛道生成 / 兔子状态机 / 乌龟 AI / 道具 / 计分
 */
import { describe, expect, it } from "vitest";
import {
  ITEM_COST,
  MAX_ENERGY,
  SEGMENT_COUNT,
  SEGMENT_LEN,
  TRACK_LEN,
  WAKE_TAPS,
  computeScore,
  leadMeters,
  makeTerrain,
  newSim,
  rabbitRunSpeed,
  stepSim,
  terrainAt,
  type RaceInput,
  type RaceSim,
} from "../src/games/raceLogic";

/** 一帧步进 helper */
function tick(
  sim: RaceSim,
  input: Partial<RaceInput> = {},
  dt = 0.02,
): ReturnType<typeof stepSim> {
  return stepSim(sim, dt, {
    hold: false,
    tap: false,
    item: null,
    ...input,
  });
}

/** 让兔子全速跑 n 秒（不被睡意打断的短时间） */
function runSeconds(sim: RaceSim, n: number, dt = 0.05): void {
  for (let i = 0; i < n / dt; i++) tick(sim, { hold: true }, dt);
}

describe("赛道地形生成", () => {
  it("共 8 段、首段固定草地、总长 120 米", () => {
    const segs = makeTerrain();
    expect(segs.length).toBe(SEGMENT_COUNT);
    expect(segs[0].kind).toBe("plain");
    expect(segs[0].from).toBe(0);
    expect(segs[segs.length - 1].to).toBe(TRACK_LEN);
    expect(segs.every((s) => s.to - s.from === SEGMENT_LEN)).toBe(true);
  });

  it("不含相邻重复段（plain 除外）", () => {
    for (let k = 0; k < 20; k++) {
      const segs = makeTerrain();
      for (let i = 1; i < segs.length; i++) {
        if (segs[i].kind !== "plain") {
          expect(segs[i].kind).not.toBe(segs[i - 1].kind);
        }
      }
    }
  });

  it("terrainAt 能定位任意位置所在段", () => {
    const segs = makeTerrain();
    expect(terrainAt(segs, 0).from).toBe(0);
    expect(terrainAt(segs, TRACK_LEN - 0.1).to).toBe(TRACK_LEN);
    expect(terrainAt(segs, 14.9).kind).toBe("plain");
  });
});

describe("newSim 初始局面", () => {
  it("兔子体力/能量、乌龟爬行状态、比赛未开始", () => {
    const sim = newSim();
    expect(sim.rabbit.x).toBe(0);
    expect(sim.rabbit.stamina).toBe(100);
    expect(sim.rabbit.drowsiness).toBe(0);
    expect(sim.rabbit.energy).toBe(1);
    expect(sim.rabbit.state).toBe("walking");
    expect(sim.turtle.state).toBe("crawl");
    expect(sim.turtle.x).toBe(0);
    expect(sim.over).toBe(false);
    expect(sim.banana).toBeNull();
  });
});

describe("兔子奔跑 / 体力 / 睡意", () => {
  it("按住奔跑：前进、体力下降、速度随体力降低", () => {
    const sim = newSim();
    const vFull = rabbitRunSpeed(100);
    expect(vFull).toBeCloseTo(6.6);
    const x0 = sim.rabbit.x;
    runSeconds(sim, 1);
    expect(sim.rabbit.x).toBeGreaterThan(x0 + 5);
    expect(sim.rabbit.stamina).toBeLessThan(100);
    expect(sim.rabbit.state).toBe("running");
  });

  it("松手慢走：体力恢复、睡意积累", () => {
    const sim = newSim();
    runSeconds(sim, 0.6); // 消耗一部分体力
    const staminaAfter = sim.rabbit.stamina;
    tick(sim, {}, 0.5);
    expect(sim.rabbit.stamina).toBeGreaterThan(staminaAfter);
    expect(sim.rabbit.drowsiness).toBeGreaterThan(0);
  });

  it("奔跑能快速清除睡意", () => {
    const sim = newSim();
    sim.rabbit.drowsiness = 50;
    tick(sim, { hold: true }, 1);
    tick(sim, { hold: true }, 1);
    expect(sim.rabbit.drowsiness).toBe(0);
  });

  it("睡意满 100 会睡着，连点 WAKE_TAPS 次唤醒", () => {
    const sim = newSim();
    // 强制睡意拉满并走一帧触发状态切换
    sim.rabbit.drowsiness = 100;
    tick(sim, { hold: true }); // hold 会清睡意，改用不 hold
    sim.rabbit.drowsiness = 100;
    const events = tick(sim, { hold: false }, 0.1);
    expect(sim.rabbit.state).toBe("sleeping");
    expect(events.some((e) => e.type === "sleep")).toBe(true);

    // 睡着时按住奔跑键无效（站住不动）
    const x0 = sim.rabbit.x;
    tick(sim, { hold: true }, 1);
    expect(sim.rabbit.x).toBe(x0);

    // 连点唤醒
    for (let i = 0; i < WAKE_TAPS; i++) {
      tick(sim, { tap: true }, 0.02);
    }
    expect(sim.rabbit.state).not.toBe("sleeping");
    expect(sim.rabbit.drowsiness).toBe(0);
  });
});

describe("乌龟 AI", () => {
  it("爬行匀速前进，速度约 3.3 m/s", () => {
    const sim = newSim();
    const x0 = sim.turtle.x;
    tick(sim, {}, 1);
    const moved = sim.turtle.x - x0;
    expect(moved).toBeGreaterThan(2.5);
    expect(moved).toBeLessThan(4.2); // 可能被 hill 加速 / mud 减速干扰，但大体在区间
  });

  it("缩壳滚行时移动明显更快", () => {
    const sim = newSim();
    sim.turtle.state = "roll";
    sim.turtle.stateT = 1.5;
    sim.rabbit.x = 60; // 让兔子领先，避免边界
    const x0 = sim.turtle.x;
    tick(sim, {}, 0.5);
    expect(sim.turtle.x - x0).toBeGreaterThan(3); // 7.6 * 0.5 ≈ 3.8
  });

  it("吃草时原地停留", () => {
    const sim = newSim();
    sim.turtle.state = "eat";
    sim.turtle.stateT = 1.5;
    const x0 = sim.turtle.x;
    tick(sim, {}, 0.5);
    expect(sim.turtle.x).toBe(x0);
  });
});

describe("道具", () => {
  it("胡萝卜冲刺：消耗 3 能量，速度固定 9.5 m/s", () => {
    const sim = newSim();
    sim.rabbit.energy = 3;
    const events = tick(sim, { item: "carrot" }, 0.02);
    expect(events.some((e) => e.type === "burst")).toBe(true);
    expect(sim.rabbit.energy).toBe(0);
    const x0 = sim.rabbit.x;
    tick(sim, { hold: false }, 1);
    expect(sim.rabbit.x - x0).toBeCloseTo(9.5, 0);
  });

  it("香蕉皮：放置后乌龟踩到会滑倒 1.6 秒", () => {
    const sim = newSim();
    sim.rabbit.energy = 2;
    sim.turtle.rollCd = 999; // 屏蔽随机滚行
    tick(sim, { item: "banana" }, 0.02);
    expect(sim.banana).not.toBeNull();
    expect(sim.banana!.x).toBeGreaterThan(sim.turtle.x);

    // 把乌龟挪到香蕉位置触发踩到
    sim.turtle.x = sim.banana!.x;
    const events = tick(sim, {}, 0.02);
    const hit = events.find((e) => e.type === "banana");
    expect(hit).toBeTruthy();
    expect(sim.turtle.slipped).toBe(true);
    expect(sim.turtle.slip).toBeCloseTo(1.6);
    expect(sim.banana).toBeNull();

    // 滑倒期间不动
    const x0 = sim.turtle.x;
    tick(sim, {}, 0.5);
    expect(sim.turtle.x).toBe(x0);
  });

  it("缩壳滚行时香蕉无效（滚过去了）", () => {
    const sim = newSim();
    sim.rabbit.energy = 2;
    sim.turtle.rollCd = 999;
    tick(sim, { item: "banana" }, 0.02);
    sim.turtle.state = "roll";
    sim.turtle.stateT = 2;
    sim.turtle.x = sim.banana!.x;
    const events = tick(sim, {}, 0.02);
    const hit = events.find((e) => e.type === "banana");
    expect(hit).toBeTruthy();
    expect((hit as { slipped: boolean }).slipped).toBe(false);
    expect(sim.turtle.slipped).toBe(false);
  });

  it("激将法：乌龟暴怒冲刺后转入疲惫", () => {
    const sim = newSim();
    sim.rabbit.energy = 1;
    sim.turtle.rollCd = 999;
    const events = tick(sim, { item: "provoke" }, 0.02);
    expect(events.some((e) => e.type === "provoke" && e.ok)).toBe(true);
    expect(sim.turtle.state).toBe("anger");
    expect(sim.rabbit.energy).toBe(0);

    // 愤怒 2.5s 后疲惫
    for (let i = 0; i < 60; i++) tick(sim, {}, 0.05);
    expect(sim.turtle.state).toBe("tired");
    const tiredX = sim.turtle.x;
    tick(sim, {}, 0.5);
    expect(sim.turtle.x - tiredX).toBeLessThan(1); // 疲惫速度 1.5
  });

  it("能量不足时道具不生效且不消耗能量", () => {
    const sim = newSim();
    sim.rabbit.energy = 0;
    const events = tick(sim, { item: "provoke" }, 0.02);
    expect(events.some((e) => e.type === "provoke" && !e.ok)).toBe(true);
    expect(sim.rabbit.energy).toBe(0);
    expect(sim.turtle.state).toBe("crawl");
  });
});

describe("能量积累", () => {
  it("每跑 12 米 +1 能量，上限 5", () => {
    const sim = newSim();
    sim.rabbit.energy = 0;
    // 已跑过 12 / 24 / 36 三个里程碑（起始能量为 0）
    sim.rabbit.x = 36.5;
    tick(sim, { hold: true }, 0.01);
    expect(sim.rabbit.energy).toBe(3);

    // 跑到终点附近能量应封顶 5
    sim.rabbit.x = TRACK_LEN - 1;
    sim.rabbit.energy = MAX_ENERGY;
    tick(sim, { hold: true }, 0.01);
    expect(sim.rabbit.energy).toBe(MAX_ENERGY);
  });
});

describe("计分与胜负", () => {
  it("computeScore：赢比输高，时间越短越高", () => {
    expect(computeScore(20, true)).toBeGreaterThan(computeScore(20, false));
    expect(computeScore(20, true)).toBeGreaterThan(computeScore(60, true));
    expect(computeScore(60, false)).toBeGreaterThanOrEqual(100);
  });

  it("全程按住奔跑：比赛在 45 秒内结束（不会陷入僵局）", () => {
    const sim = newSim();
    sim.rabbit.energy = 0;
    let guard = 0;
    while (!sim.over && guard < 3000) {
      tick(sim, { hold: true }, 0.02);
      guard += 1;
    }
    expect(sim.over).toBe(true);
    expect(sim.time).toBeLessThan(45);
    expect(sim.score).toBeGreaterThan(0);
  });

  it("先到终点者胜：兔子贴近终点时先冲线判胜", () => {
    const sim = newSim();
    sim.rabbit.x = TRACK_LEN - 1;
    sim.turtle.x = TRACK_LEN - 8;
    for (let i = 0; i < 40; i++) tick(sim, { hold: true }, 0.02);
    expect(sim.over).toBe(true);
    expect(sim.won).toBe(true);

    // 反之，乌龟先到则兔子失败
    const sim2 = newSim();
    sim2.rabbit.x = TRACK_LEN - 8;
    sim2.turtle.x = TRACK_LEN - 1;
    for (let i = 0; i < 40; i++) tick(sim2, { hold: false }, 0.02);
    expect(sim2.over).toBe(true);
    expect(sim2.won).toBe(false);
  });

  it("乌龟先到终点则兔子失败", () => {
    const sim = newSim();
    // 手动让乌龟接近终点，兔子原地不动
    sim.turtle.x = TRACK_LEN - 0.01;
    sim.rabbit.x = 0;
    for (let i = 0; i < 10; i++) tick(sim, { hold: false }, 0.02);
    expect(sim.over).toBe(true);
    expect(sim.won).toBe(false);
  });

  it("leadMeters 反映领先/落后", () => {
    const sim = newSim();
    sim.rabbit.x = 10;
    sim.turtle.x = 5;
    expect(leadMeters(sim)).toBe(5);
  });
});

describe("道具消耗记录", () => {
  it("使用过的道具计入 itemsUsed", () => {
    const sim = newSim();
    sim.rabbit.energy = 3;
    tick(sim, { item: "carrot" }, 0.02);
    expect(sim.itemsUsed.carrot).toBe(1);
    expect(ITEM_COST.carrot).toBe(3);
  });
});
