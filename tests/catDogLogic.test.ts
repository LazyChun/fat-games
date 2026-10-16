/*
 * catDogLogic 单元测试
 */
import { describe, expect, it } from "vitest";
import {
  CASTLE_X,
  CASTLE_DMG,
  CASTLE_HP,
  FISH_INIT,
  FISH_MAX,
  FISH_RATE,
  WIN_WAVE,
  UNIT_STATS,
  laneY,
  newSim,
  addCat,
  stepSim,
  isGameOver,
  planWave,
  pickDogKind,
  type Sim,
  type Unit,
  type CatKind,
  type DogKind,
} from "../src/games/catDogLogic";

/** 固定随机源：出狗固定中道、种类抽取取中间值 */
const rnd = () => 0.5;

/** 一帧步进 helper */
function tick(sim: Sim, dt = 0.02): ReturnType<typeof stepSim> {
  return stepSim(sim, dt, rnd);
}

function placeCat(sim: Sim, kind: CatKind, x: number, y: number, hp?: number): Unit {
  const st = UNIT_STATS[kind];
  const u: Unit = {
    id: sim.nextId++,
    kind,
    side: "cat",
    x,
    y,
    hp: hp ?? st.hp,
    maxHp: st.hp,
    atkCdT: 0,
  };
  sim.units.push(u);
  return u;
}

function placeDog(sim: Sim, kind: DogKind, x: number, y: number, hp?: number): Unit {
  const st = UNIT_STATS[kind];
  const u: Unit = {
    id: sim.nextId++,
    kind,
    side: "dog",
    x,
    y,
    hp: hp ?? st.hp,
    maxHp: st.hp,
    atkCdT: 0,
  };
  sim.units.push(u);
  return u;
}

describe("newSim 初始局面", () => {
  it("城堡满血、小鱼干初始、无单位、波次为 0", () => {
    const sim = newSim();
    expect(sim.castleHp).toBe(CASTLE_HP);
    expect(sim.fish).toBe(FISH_INIT);
    expect(sim.score).toBe(0);
    expect(sim.wave.wave).toBe(0);
    expect(sim.units).toHaveLength(0);
    expect(sim.projectiles).toHaveLength(0);
    expect(isGameOver(sim)).toBe(false);
  });
});

describe("addCat 召唤猫咪", () => {
  it("扣除小鱼干并在指定道出生", () => {
    const sim = newSim();
    const cost = UNIT_STATS.tabby.cost ?? 0;
    sim.fish = 120;
    const r = addCat(sim, "tabby", 1);
    expect(r.ok).toBe(true);
    expect(r.sim.fish).toBe(120 - cost);
    expect(r.sim.units).toHaveLength(1);
    const u = r.sim.units[0];
    expect(u.side).toBe("cat");
    expect(u.kind).toBe("tabby");
    expect(u.y).toBe(laneY(1));
    expect(u.x).toBeGreaterThan(0);
  });

  it("小鱼干不足时拒绝召唤", () => {
    const sim = newSim();
    sim.fish = 10;
    const r = addCat(sim, "orange", 0);
    expect(r.ok).toBe(false);
    expect(r.sim.units).toHaveLength(0);
    expect(r.sim.fish).toBe(10);
  });

  it("道下标越界时收敛到最近道", () => {
    const sim = newSim();
    const r = addCat(sim, "black", 5);
    expect(r.ok).toBe(true);
    expect(r.sim.units[0].y).toBe(laneY(2));
  });
});

describe("波次推进", () => {
  it("第一帧进入第 1 波并触发 waveStart", () => {
    const sim = newSim();
    const { events } = tick(sim);
    expect(sim.wave.wave).toBe(1);
    expect(sim.wave.spawning).toBe(true);
    expect(events.some((e) => e.type === "waveStart" && e.wave === 1)).toBe(true);
  });

  it("出狗间隔到点产生 spawnDog，且狗在随机道", () => {
    const sim = newSim();
    tick(sim, 0.5); // 进入第 1 波，spawnT 置 0.5
    const { events } = tick(sim, 0.51); // spawnT 归零 → 出第一只狗
    const spawns = events.filter((e) => e.type === "spawnDog");
    expect(spawns.length).toBeGreaterThan(0);
    expect(sim.units.filter((u) => u.side === "dog").length).toBeGreaterThan(0);
  });

  it("出狗完毕且场上无狗时清空本波并结算奖励", () => {
    const sim = newSim();
    const w = sim.wave;
    w.wave = 3;
    w.spawning = true;
    w.spawned = planWave(3).toSpawn;
    w.toSpawn = planWave(3).toSpawn;
    const { events } = tick(sim);
    const clear = events.find((e) => e.type === "waveClear");
    expect(clear).toBeDefined();
    if (clear && clear.type === "waveClear") {
      expect(clear.wave).toBe(3);
      expect(clear.bonus).toBe(40 + 3 * 10);
    }
    expect(sim.wave.spawning).toBe(false);
    expect(sim.wave.breakT).toBeGreaterThan(0);
    expect(sim.score).toBe(40 + 3 * 10);
  });

  it("第 20 波清空后触发通关（win / won）", () => {
    const sim = newSim();
    const w = sim.wave;
    w.wave = WIN_WAVE;
    w.spawning = true;
    w.spawned = planWave(WIN_WAVE).toSpawn;
    w.toSpawn = planWave(WIN_WAVE).toSpawn;
    const { events } = tick(sim);
    expect(events.some((e) => e.type === "win")).toBe(true);
    expect(sim.won).toBe(true);
  });

  it("波间休息结束自动进入下一波；第 5 波带 Boss", () => {
    const sim = newSim();
    sim.wave.wave = 4;
    sim.wave.spawning = false;
    sim.wave.breakT = 0.01;
    const { events } = tick(sim);
    expect(sim.wave.wave).toBe(5);
    expect(events.some((e) => e.type === "boss" && e.wave === 5)).toBe(true);
    expect(sim.units.some((u) => u.kind === "golden" && u.side === "dog")).toBe(true);
  });
});

describe("战斗结算", () => {
  it("近战双方按攻速互扣血量", () => {
    const sim = newSim();
    const cat = placeCat(sim, "tabby", 100, laneY(1));
    const dog = placeDog(sim, "shiba", 130, laneY(1)); // dx=30，双方都在射程内
    tick(sim);
    expect(dog.hp).toBe(UNIT_STATS.shiba.hp - UNIT_STATS.tabby.atk);
    expect(cat.hp).toBe(UNIT_STATS.tabby.hp - UNIT_STATS.shiba.atk);
  });

  it("击杀狗：得分与小鱼干入账、触发 kill 事件", () => {
    const sim = newSim();
    placeCat(sim, "tabby", 100, laneY(1));
    const dog = placeDog(sim, "shiba", 130, laneY(1), 5);
    const { events } = tick(sim);
    const kill = events.find((e) => e.type === "kill" && e.side === "dog");
    expect(kill).toBeDefined();
    expect(sim.score).toBe(UNIT_STATS.shiba.score);
    expect(sim.fish).toBeCloseTo(
      FISH_INIT + (UNIT_STATS.shiba.fish ?? 0) + FISH_RATE * 0.02,
      5,
    );
    expect(sim.units.some((u) => u.id === dog.id)).toBe(false);
  });

  it("猫被击杀：触发 kill 事件但不加分", () => {
    const sim = newSim();
    const cat = placeCat(sim, "tabby", 100, laneY(1), 5);
    placeDog(sim, "shiba", 130, laneY(1));
    const { events } = tick(sim);
    expect(events.some((e) => e.type === "kill" && e.side === "cat")).toBe(true);
    expect(sim.units.some((u) => u.id === cat.id)).toBe(false);
    expect(sim.score).toBe(0);
  });

  it("远程黑猫在射程内站定开火，投射物命中同道敌人", () => {
    const sim = newSim();
    const cat = placeCat(sim, "black", 100, laneY(1));
    const dog = placeDog(sim, "shiba", 116, laneY(1)); // 与弹着点同位
    const x0 = cat.x;
    const { sim: s2 } = tick(sim);
    expect(s2.units.find((u) => u.id === cat.id)?.x).toBe(x0); // 不前进
    const dog2 = s2.units.find((u) => u.id === dog.id);
    expect(dog2).toBeDefined();
    expect(dog2!.hp).toBe(UNIT_STATS.shiba.hp - (UNIT_STATS.black.projDmg ?? 0));
  });

  it("没有敌人时猫咪向前推进、狗向前突进", () => {
    const sim = newSim();
    const cat = placeCat(sim, "tabby", 100, laneY(1));
    const dog = placeDog(sim, "shiba", 300, laneY(1));
    const c0 = cat.x;
    const d0 = dog.x;
    tick(sim);
    expect(cat.x).toBeGreaterThan(c0);
    expect(dog.x).toBeLessThan(d0);
  });
});

describe("城堡防守", () => {
  it("狗抵达城堡触发 castleHit 并离场，城堡扣血", () => {
    const sim = newSim();
    placeDog(sim, "shiba", CASTLE_X, laneY(1));
    const { events } = tick(sim);
    expect(events.some((e) => e.type === "castleHit" && e.dmg === CASTLE_DMG)).toBe(true);
    expect(sim.castleHp).toBe(CASTLE_HP - CASTLE_DMG);
    expect(sim.units.filter((u) => u.side === "dog")).toHaveLength(0);
  });

  it("城堡血量归零时游戏结束", () => {
    const sim = newSim();
    sim.castleHp = CASTLE_DMG;
    placeDog(sim, "shiba", CASTLE_X, laneY(1));
    tick(sim);
    expect(isGameOver(sim)).toBe(true);
  });
});

describe("经济与难度曲线", () => {
  it("小鱼干随时间自动增长且有上限", () => {
    const sim = newSim();
    tick(sim, 1);
    expect(sim.fish).toBeCloseTo(FISH_INIT + FISH_RATE, 5);
    sim.fish = FISH_MAX - 1;
    tick(sim, 1);
    expect(sim.fish).toBe(FISH_MAX);
  });

  it("planWave：数量递增封顶、间隔递减、每 5 波出 Boss", () => {
    expect(planWave(1).toSpawn).toBe(5);
    expect(planWave(10).toSpawn).toBe(14);
    expect(planWave(20).toSpawn).toBe(14);
    expect(planWave(1).interval).toBeGreaterThan(planWave(10).interval);
    expect(planWave(5).hasBoss).toBe(true);
    expect(planWave(10).hasBoss).toBe(true);
    expect(planWave(4).hasBoss).toBe(false);
  });

  it("pickDogKind：前期只有柴犬，后期出现德牧", () => {
    expect(pickDogKind(1, () => 0.5)).toBe("shiba");
    expect(pickDogKind(3, () => 0.5)).toBe("shiba");
    expect(pickDogKind(5, () => 0.9)).toBe("shepherd");
    expect(pickDogKind(9, () => 0.9)).toBe("shepherd");
    expect(pickDogKind(9, () => 0.1)).toBe("shiba");
  });
});
