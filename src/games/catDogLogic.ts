/*
 * catDogLogic：猫狗大战 纯逻辑（不依赖 DOM / React，便于 vitest 单测）
 *
 * 玩法：玩家在左侧守卫猫咪城堡，狗大军从右侧一波波进攻。
 * 玩家消耗「小鱼干」在三条道上召唤猫咪战士（近战 / 肉盾 / 远程射手），
 * 猫咪自动迎击同道的狗；狗突破防线啃咬城堡会扣血，城堡血量归零则游戏结束。
 * 波次难度逐步上升，每 5 波出现一只金毛 Boss；坚持到第 20 波通关（可继续无尽）。
 *
 * 计分：击杀狗得分（按类型）+ 波次清空奖励（40 + 波次 × 10）；
 * 击杀狗还会掉落小鱼干，形成「击杀 → 扩军」循环。
 */

export const W = 560;
export const H = 330;
export const LANE_COUNT = 3;

/** 城堡前沿 x：狗走到此处即啃咬城堡 */
export const CASTLE_X = 26;
/** 每次啃咬城堡的伤害 */
export const CASTLE_DMG = 10;
/** 城堡初始血量 */
export const CASTLE_HP = 100;
/** 猫咪出场位置 */
export const CAT_SPAWN_X = 46;
/** 狗出场位置（画布右缘外） */
export const DOG_SPAWN_X = W + 24;
/** 通关波次 */
export const WIN_WAVE = 20;

/** 小鱼干初始数量 / 每秒增长 / 上限 */
export const FISH_INIT = 100;
export const FISH_RATE = 12;
export const FISH_MAX = 300;

export type Side = "cat" | "dog";
export type CatKind = "tabby" | "orange" | "black";
export type DogKind = "shiba" | "bulldog" | "shepherd" | "golden";
export type UnitKind = CatKind | DogKind;

export interface UnitStats {
  hp: number;
  atk: number;
  /** 攻击间隔（秒） */
  atkCd: number;
  /** 移动速度 px/s */
  speed: number;
  /** 近战攻击距离 / 远程开火距离 */
  range: number;
  /** 猫：小鱼干费用 */
  cost?: number;
  /** 狗：击杀得分 */
  score?: number;
  /** 狗：击杀掉落小鱼干 */
  fish?: number;
  /** 远程单位 */
  ranged?: boolean;
  projSpeed?: number;
  projDmg?: number;
}

export const UNIT_STATS: Record<UnitKind, UnitStats> = {
  // 猫咪
  tabby: { hp: 70, atk: 14, atkCd: 0.9, speed: 95, range: 32, cost: 50 },
  orange: { hp: 200, atk: 24, atkCd: 1.1, speed: 60, range: 34, cost: 120 },
  black: {
    hp: 50,
    atk: 12,
    atkCd: 1.4,
    speed: 55,
    range: 170,
    cost: 90,
    ranged: true,
    projSpeed: 300,
    projDmg: 12,
  },
  // 狗狗
  shiba: { hp: 55, atk: 9, atkCd: 1.0, speed: 48, range: 30, score: 10, fish: 4 },
  bulldog: { hp: 50, atk: 7, atkCd: 0.75, speed: 100, range: 28, score: 15, fish: 5 },
  shepherd: { hp: 140, atk: 16, atkCd: 1.2, speed: 42, range: 32, score: 25, fish: 8 },
  golden: { hp: 450, atk: 32, atkCd: 1.4, speed: 36, range: 34, score: 120, fish: 30 },
};

export interface Unit {
  id: number;
  kind: UnitKind;
  side: Side;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** 攻击冷却剩余时间（秒） */
  atkCdT: number;
}

export interface Projectile {
  id: number;
  x: number;
  y: number;
  vx: number;
  dmg: number;
}

export interface WaveState {
  /** 当前波次（0 = 尚未开始） */
  wave: number;
  /** 是否正在出狗 */
  spawning: boolean;
  spawned: number;
  toSpawn: number;
  /** 距下次出狗剩余秒 */
  spawnT: number;
  /** 波间休息剩余秒 */
  breakT: number;
}

export interface Sim {
  units: Unit[];
  projectiles: Projectile[];
  wave: WaveState;
  castleHp: number;
  fish: number;
  score: number;
  /** 已进行秒数（展示用） */
  time: number;
  /** 是否已通关（≥ WIN_WAVE） */
  won: boolean;
  nextId: number;
}

export type SimEvent =
  | { type: "spawnDog"; kind: DogKind; x: number; y: number }
  | { type: "kill"; side: Side; kind: UnitKind; x: number; y: number; score: number; fish: number }
  | { type: "castleHit"; dmg: number }
  | { type: "waveStart"; wave: number }
  | { type: "waveClear"; wave: number; bonus: number }
  | { type: "boss"; wave: number }
  | { type: "win" };

/** 第 i 条道的中心 y（0 上 / 1 中 / 2 下） */
export function laneY(i: number): number {
  return H * (0.25 + 0.25 * i);
}

export function newSim(): Sim {
  return {
    units: [],
    projectiles: [],
    wave: { wave: 0, spawning: false, spawned: 0, toSpawn: 0, spawnT: 0, breakT: 0 },
    castleHp: CASTLE_HP,
    fish: FISH_INIT,
    score: 0,
    time: 0,
    won: false,
    nextId: 1,
  };
}

/** 波次规划：出狗总数 / 出狗间隔 / 是否带 Boss */
export function planWave(wave: number): { toSpawn: number; interval: number; hasBoss: boolean } {
  const toSpawn = Math.min(4 + wave, 14);
  const interval = Math.max(0.45, 1.25 - wave * 0.06);
  const hasBoss = wave % 5 === 0;
  return { toSpawn, interval, hasBoss };
}

/** 按波次权重抽取狗的种类 */
export function pickDogKind(wave: number, rnd: () => number = Math.random): DogKind {
  const r = rnd();
  if (wave >= 8) return r < 0.3 ? "shiba" : r < 0.6 ? "bulldog" : "shepherd";
  if (wave >= 6) return r < 0.35 ? "shiba" : r < 0.7 ? "bulldog" : "shepherd";
  if (wave >= 4) return r < 0.45 ? "shiba" : r < 0.8 ? "bulldog" : "shepherd";
  if (wave >= 2) return r < 0.6 ? "shiba" : "bulldog";
  return "shiba";
}

/** 召唤猫咪到指定道（扣除小鱼干）；费用不足时 ok=false */
export function addCat(sim: Sim, kind: CatKind, lane: number): { sim: Sim; ok: boolean } {
  const st = UNIT_STATS[kind];
  const cost = st.cost ?? Infinity;
  if (sim.fish < cost) return { sim, ok: false };
  const s: Sim = {
    ...sim,
    fish: sim.fish - cost,
    units: sim.units.map((u) => ({ ...u })),
  };
  s.units.push({
    id: s.nextId++,
    kind,
    side: "cat",
    x: CAT_SPAWN_X,
    y: laneY(Math.max(0, Math.min(LANE_COUNT - 1, lane))),
    hp: st.hp,
    maxHp: st.hp,
    atkCdT: 0,
  });
  return { sim: s, ok: true };
}

/** 同道内、位于 from 前方（x 更大）最近的存活敌人 */
function nearestAhead(units: Unit[], from: Unit): Unit | null {
  let best: Unit | null = null;
  let bestD = Infinity;
  for (const u of units) {
    if (u.hp <= 0) continue;
    if (Math.abs(u.y - from.y) >= 26) continue;
    const d = u.x - from.x;
    if (d > -8 && d < bestD) {
      best = u;
      bestD = d;
    }
  }
  return best;
}

/** 同道内、位于 from 左侧（x 更小）最近的存活敌人 */
function nearestBehind(units: Unit[], from: Unit): Unit | null {
  let best: Unit | null = null;
  let bestD = Infinity;
  for (const u of units) {
    if (u.hp <= 0) continue;
    if (Math.abs(u.y - from.y) >= 26) continue;
    const d = from.x - u.x;
    if (d > -8 && d < bestD) {
      best = u;
      bestD = d;
    }
  }
  return best;
}

function spawnDog(s: Sim, kind: DogKind, rnd: () => number): void {
  const st = UNIT_STATS[kind];
  const lane = Math.floor(rnd() * LANE_COUNT);
  s.units.push({
    id: s.nextId++,
    kind,
    side: "dog",
    x: DOG_SPAWN_X,
    y: laneY(lane),
    hp: st.hp,
    maxHp: st.hp,
    atkCdT: 0,
  });
}

function startWave(s: Sim, wave: number, events: SimEvent[], rnd: () => number): void {
  const w = s.wave;
  w.wave = wave;
  w.spawning = true;
  w.spawned = 0;
  const plan = planWave(wave);
  w.toSpawn = plan.toSpawn;
  w.spawnT = 0.5;
  events.push({ type: "waveStart", wave });
  if (plan.hasBoss) {
    spawnDog(s, "golden", rnd);
    events.push({ type: "boss", wave });
  }
}

/**
 * 步进一帧：原地推进 sim（与 hawkLogic 约定一致），推进波次、
 * 单位移动 / 攻击、投射物、死亡结算，并返回本帧事件列表。
 * 不依赖 DOM / React，随机性通过 rnd 注入，便于测试。
 */
export function stepSim(
  sim: Sim,
  dt: number,
  rnd: () => number = Math.random,
): { sim: Sim; events: SimEvent[] } {
  const events: SimEvent[] = [];
  sim.time += dt;
  sim.fish = Math.min(FISH_MAX, sim.fish + FISH_RATE * dt);
  for (const u of sim.units) u.atkCdT = Math.max(0, u.atkCdT - dt);

  // ---- 波次推进 ----
  const w = sim.wave;
  if (w.wave === 0) {
    startWave(sim, 1, events, rnd);
  } else if (w.spawning) {
    w.spawnT -= dt;
    if (w.spawnT <= 0 && w.spawned < w.toSpawn) {
      const kind = pickDogKind(w.wave, rnd);
      spawnDog(sim, kind, rnd);
      w.spawned += 1;
      w.spawnT = planWave(w.wave).interval;
      events.push({ type: "spawnDog", kind, x: DOG_SPAWN_X, y: laneY(Math.floor(rnd() * LANE_COUNT)) });
    }
    // 出狗完毕且场上无狗 → 清空本波
    if (w.spawned >= w.toSpawn && !sim.units.some((u) => u.side === "dog")) {
      w.spawning = false;
      const bonus = 40 + w.wave * 10;
      sim.score += bonus;
      events.push({ type: "waveClear", wave: w.wave, bonus });
      w.breakT = 2.6;
      if (w.wave >= WIN_WAVE && !sim.won) {
        sim.won = true;
        events.push({ type: "win" });
      }
    }
  } else if (w.breakT > 0) {
    w.breakT -= dt;
    if (w.breakT <= 0) startWave(sim, w.wave + 1, events, rnd);
  }

  // ---- 猫咪行动：前进 / 近战 / 远程开火 ----
  const dogs = sim.units.filter((u) => u.side === "dog");
  const cats = sim.units.filter((u) => u.side === "cat");

  for (const cat of cats) {
    const st = UNIT_STATS[cat.kind];
    const target = nearestAhead(dogs, cat);
    if (!target) {
      cat.x = Math.min(W - 30, cat.x + st.speed * dt);
      continue;
    }
    const dx = target.x - cat.x;
    if (dx <= st.range + 6) {
      if (cat.atkCdT <= 0) {
        if (st.ranged) {
          sim.projectiles.push({
            id: sim.nextId++,
            x: cat.x + 16,
            y: cat.y,
            vx: st.projSpeed ?? 300,
            dmg: st.projDmg ?? 12,
          });
        } else {
          target.hp -= st.atk;
        }
        cat.atkCdT = st.atkCd;
      }
    } else {
      cat.x += st.speed * dt;
    }
  }

  // ---- 狗狗行动：咬猫 / 啃城堡 / 前进 ----
  for (const dog of dogs) {
    if (dog.hp <= 0) continue;
    const st = UNIT_STATS[dog.kind];
    const target = nearestBehind(cats, dog);
    if (target && dog.x - target.x <= st.range + 6) {
      if (dog.atkCdT <= 0) {
        target.hp -= st.atk;
        dog.atkCdT = st.atkCd;
      }
    } else if (dog.x <= CASTLE_X) {
      sim.castleHp -= CASTLE_DMG;
      dog.hp = -9999; // 直接离场
      events.push({ type: "castleHit", dmg: CASTLE_DMG });
    } else {
      dog.x -= st.speed * dt;
    }
  }

  // ---- 投射物 ----
  for (const p of sim.projectiles) {
    p.x += p.vx * dt;
    const hit = dogs.find(
      (d) => d.hp > 0 && Math.abs(d.y - p.y) < 22 && Math.abs(d.x - p.x) < 16,
    );
    if (hit) {
      hit.hp -= p.dmg;
      p.dmg = -9999; // 标记已命中
    }
  }
  sim.projectiles = sim.projectiles.filter((p) => p.dmg > 0 && p.x < W + 40);

  // ---- 死亡结算 ----
  const dead = sim.units.filter((u) => u.hp <= 0);
  if (dead.length > 0) {
    for (const u of dead) {
      const st = UNIT_STATS[u.kind];
      const score = st.score ?? 0;
      const fish = st.fish ?? 0;
      sim.score += score;
      sim.fish = Math.min(FISH_MAX, sim.fish + fish);
      events.push({ type: "kill", side: u.side, kind: u.kind, x: u.x, y: u.y, score, fish });
    }
    sim.units = sim.units.filter((u) => u.hp > 0);
  }

  return { sim, events };
}

/** 游戏是否已结束（城堡被摧毁） */
export function isGameOver(sim: Sim): boolean {
  return sim.castleHp <= 0;
}
