/*
 * raceLogic：龟兔赛跑 纯逻辑（不依赖 DOM / React，便于 vitest 单测）
 *
 * 玩法：你控制兔子（快而娇气），AI 控制乌龟（慢而稳健）。
 *   - 按住奔跑键 = 兔子全速奔跑（消耗体力）；松手 = 慢走（恢复体力）。
 *   - 长时间慢走会积累睡意，睡意满 → 兔子原地睡着，需要快速连点唤醒——
 *     这正是寓言名场面，乌龟会趁机反超。
 *   - 乌龟 AI：匀速稳健爬行，偶尔缩壳滚行（落后时更爱滚）/ 路边吃草。
 *   - 道具：奔跑攒能量，可兑换
 *        胡萝卜冲刺（短暂超高速）/ 香蕉皮（让乌龟滑倒）/ 激将法（乌龟暴怒冲刺后疲惫）。
 *   - 赛道随机地形：下坡加速、泥泞减速、树荫催睡、胡萝卜地回体力。
 * 先到终点者胜；用时越短、名次越好，得分越高。
 */

export const TRACK_LEN = 120; // 赛道总长（米）
export const SEGMENT_LEN = 15; // 每段地形长度（米）
export const SEGMENT_COUNT = TRACK_LEN / SEGMENT_LEN; // 8 段

export const WAKE_TAPS = 6; // 睡着后需要连点的次数
export const MAX_ENERGY = 5; // 能量上限
export const ENERGY_PER_DIST = 12; // 每跑 12 米 +1 能量

export type TerrainKind = "plain" | "hill" | "mud" | "shade" | "carrot";

export interface TerrainSegment {
  from: number;
  to: number;
  kind: TerrainKind;
}

export type RabbitState = "running" | "walking" | "sleeping";
export type TurtleState = "crawl" | "roll" | "eat" | "anger" | "tired";

export type ItemId = "carrot" | "banana" | "provoke";

export interface Rabbit {
  x: number;
  /** 体力 0..100 */
  stamina: number;
  /** 睡意 0..100，满则睡 */
  drowsiness: number;
  state: RabbitState;
  /** 唤醒点击进度 */
  wakeTaps: number;
  /** 能量 0..MAX_ENERGY */
  energy: number;
  /** 胡萝卜冲刺剩余时间（s） */
  burst: number;
  /** 跑动动画相位 */
  phase: number;
}

export interface Turtle {
  x: number;
  state: TurtleState;
  /** 当前状态剩余时间（s） */
  stateT: number;
  /** 缩壳滚行冷却（s） */
  rollCd: number;
  /** 被激将次数 */
  provokedCount: number;
  /** 香蕉滑倒剩余时间（s） */
  slip: number;
  /** 是否正处于滑倒动画 */
  slipped: boolean;
  phase: number;
}

export interface Banana {
  /** 放置位置（米） */
  x: number;
}

export interface RaceSim {
  rabbit: Rabbit;
  turtle: Turtle;
  terrain: TerrainSegment[];
  banana: Banana | null;
  itemsUsed: Record<ItemId, number>;
  time: number;
  /** 已发放能量对应的里程标记数（每 12m 一个刻度） */
  energyMarks: number;
  running: boolean;
  over: boolean;
  /** 兔子是否获胜 */
  won: boolean;
  recorded: boolean;
  score: number;
}

export interface RaceInput {
  /** 按住奔跑键 */
  hold: boolean;
  /** 本帧点击（唤醒连击） */
  tap: boolean;
  /** 本帧请求使用的道具（null = 不使用） */
  item: ItemId | null;
}

export type RaceEvent =
  | { type: "sleep" }
  | { type: "wake" }
  | { type: "turtleRoll" }
  | { type: "turtleEat" }
  | { type: "banana"; slipped: boolean }
  | { type: "provoke"; ok: boolean }
  | { type: "burst" }
  | { type: "energy"; total: number }
  | { type: "terrain"; kind: TerrainKind }
  | { type: "finish"; winner: "rabbit" | "turtle" };

export const ITEM_COST: Record<ItemId, number> = {
  carrot: 3,
  banana: 2,
  provoke: 1,
};

const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));
const rand = (a: number, b: number): number => a + Math.random() * (b - a);

/** 地形权重：plain 35% / hill 15% / mud 18% / shade 17% / carrot 15% */
function pickKind(prev: TerrainKind): TerrainKind {
  const r = Math.random();
  let kind: TerrainKind;
  if (r < 0.35) kind = "plain";
  else if (r < 0.5) kind = "hill";
  else if (r < 0.68) kind = "mud";
  else if (r < 0.85) kind = "shade";
  else kind = "carrot";
  // 避免连续两段相同（plain 除外）
  if (kind === prev && kind !== "plain") kind = "plain";
  return kind;
}

/** 生成赛道地形：起跑段固定草地 */
export function makeTerrain(): TerrainSegment[] {
  const segs: TerrainSegment[] = [];
  let prev: TerrainKind = "plain";
  for (let i = 0; i < SEGMENT_COUNT; i++) {
    const kind: TerrainKind = i === 0 ? "plain" : pickKind(prev);
    segs.push({ from: i * SEGMENT_LEN, to: (i + 1) * SEGMENT_LEN, kind });
    prev = kind;
  }
  return segs;
}

/** 位置所在的地形段 */
export function terrainAt(terrain: TerrainSegment[], x: number): TerrainSegment {
  const t = terrain.find((s) => x >= s.from && x < s.to);
  return t || terrain[terrain.length - 1];
}

export function newSim(): RaceSim {
  return {
    rabbit: {
      x: 0,
      stamina: 100,
      drowsiness: 0,
      state: "walking",
      wakeTaps: 0,
      energy: 1,
      burst: 0,
      phase: 0,
    },
    turtle: {
      x: 0,
      state: "crawl",
      stateT: 0,
      rollCd: 2.5,
      provokedCount: 0,
      slip: 0,
      slipped: false,
      phase: 0,
    },
    terrain: makeTerrain(),
    banana: null,
    itemsUsed: { carrot: 0, banana: 0, provoke: 0 },
    time: 0,
    energyMarks: 0,
    running: false,
    over: false,
    won: false,
    recorded: false,
    score: 0,
  };
}

/* ------------------------------------------------------------------ */
/* 速度计算                                                             */
/* ------------------------------------------------------------------ */

/** 兔子奔跑速度：体力越足越快（3.0 ~ 6.6 m/s，体力耗尽也不至于太慢） */
export function rabbitRunSpeed(stamina: number): number {
  return 3.0 + 3.6 * (stamina / 100);
}

/** 地形对兔子速度的乘数 */
function rabbitTerrainMul(kind: TerrainKind): number {
  switch (kind) {
    case "hill":
      return 1.25;
    case "mud":
      return 0.68;
    default:
      return 1;
  }
}

/** 地形对乌龟速度的乘数（缩壳滚行无视泥泞） */
function turtleTerrainMul(kind: TerrainKind, rolling: boolean): number {
  if (kind === "mud" && !rolling) return 0.68;
  if (kind === "hill") return 1.25;
  return 1;
}

/* ------------------------------------------------------------------ */
/* 兔子更新                                                             */
/* ------------------------------------------------------------------ */

function updateRabbit(sim: RaceSim, input: RaceInput, dt: number): void {
  const r = sim.rabbit;
  const t = terrainAt(sim.terrain, r.x);
  r.phase += dt * (r.state === "running" ? 16 : 6);

  // 胡萝卜冲刺：固定超高速，不受地形与体力影响
  if (r.burst > 0) {
    r.burst = Math.max(0, r.burst - dt);
    r.x = Math.min(TRACK_LEN, r.x + 9.5 * dt);
    return;
  }

  if (r.state === "sleeping") {
    // 睡着：完全停下，缓慢回体力，等待连点唤醒
    r.stamina = Math.min(100, r.stamina + 8 * dt);
    if (input.tap) {
      r.wakeTaps += 1;
      if (r.wakeTaps >= WAKE_TAPS) {
        r.state = "walking";
        r.wakeTaps = 0;
        r.drowsiness = 0;
        r.stamina = Math.min(100, r.stamina + 25); // 睡醒精神饱满
      }
    }
    return;
  }

  if (input.hold) {
    r.state = "running";
    r.stamina = Math.max(0, r.stamina - 14 * dt);
    const speed = rabbitRunSpeed(r.stamina) * rabbitTerrainMul(t.kind);
    r.x = Math.min(TRACK_LEN, r.x + speed * dt);
    // 奔跑清醒；树荫下清醒得慢一些
    r.drowsiness = Math.max(0, r.drowsiness - (t.kind === "shade" ? 14 : 28) * dt);
    // 胡萝卜地：边跑边啃，回体力
    if (t.kind === "carrot") r.stamina = Math.min(100, r.stamina + 13 * dt);
  } else {
    r.state = "walking";
    r.stamina = Math.min(100, r.stamina + 26 * dt);
    const speed = 1.7 * rabbitTerrainMul(t.kind);
    r.x = Math.min(TRACK_LEN, r.x + speed * dt);
    // 慢走催睡；树荫下睡意翻倍
    r.drowsiness = Math.min(100, r.drowsiness + (t.kind === "shade" ? 34 : 17) * dt);
  }

  // 睡意满 → 睡着
  if (r.drowsiness >= 100) {
    r.state = "sleeping";
    r.wakeTaps = 0;
  }
}

/* ------------------------------------------------------------------ */
/* 乌龟 AI                                                             */
/* ------------------------------------------------------------------ */

const TURTLE_CRAWL = 3.3;

function updateTurtle(sim: RaceSim, dt: number): void {
  const u = sim.turtle;
  const r = sim.rabbit;
  const t = terrainAt(sim.terrain, u.x);
  u.phase += dt * (u.state === "roll" ? 26 : 5);
  u.rollCd = Math.max(0, u.rollCd - dt);

  // 香蕉滑倒：优先于其他状态
  if (u.slip > 0) {
    u.slip = Math.max(0, u.slip - dt);
    if (u.slip === 0) {
      u.slipped = false;
      u.state = "crawl";
    }
    return;
  }

  const behind = Math.max(0, r.x - u.x); // 乌龟落后距离

  switch (u.state) {
    case "crawl": {
      u.x = Math.min(TRACK_LEN, u.x + TURTLE_CRAWL * turtleTerrainMul(t.kind, false) * dt);
      // 落后越多越想缩壳滚（追赶本能）
      const rollProb = dt * (0.06 + behind * 0.003);
      const eatProb = dt * 0.02;
      if (u.rollCd <= 0 && Math.random() < rollProb) {
        u.state = "roll";
        u.stateT = 1.7;
      } else if (Math.random() < eatProb) {
        u.state = "eat";
        u.stateT = 1.6;
      }
      break;
    }
    case "roll": {
      u.x = Math.min(TRACK_LEN, u.x + 7.6 * dt); // 缩壳滚动无视泥泞
      u.stateT -= dt;
      if (u.stateT <= 0) {
        u.state = "crawl";
        u.rollCd = 6;
      }
      break;
    }
    case "eat": {
      // 停下来吃草，给兔子机会窗口
      u.stateT -= dt;
      if (u.stateT <= 0) u.state = "crawl";
      break;
    }
    case "anger": {
      u.x = Math.min(TRACK_LEN, u.x + 6.9 * turtleTerrainMul(t.kind, false) * dt);
      u.stateT -= dt;
      if (u.stateT <= 0) {
        u.state = "tired";
        u.stateT = 5;
      }
      break;
    }
    case "tired": {
      u.x = Math.min(TRACK_LEN, u.x + 1.5 * dt); // 筋疲力竭
      u.stateT -= dt;
      if (u.stateT <= 0) {
        u.state = "crawl";
        u.rollCd = 4;
      }
      break;
    }
  }
}

/* ------------------------------------------------------------------ */
/* 香蕉与道具                                                           */
/* ------------------------------------------------------------------ */

/** 放置香蕉：乌龟前方 1.2m（接近终点则放脚下） */
function placeBanana(sim: RaceSim): void {
  const u = sim.turtle;
  if (sim.banana) return;
  sim.banana = { x: Math.min(TRACK_LEN - 0.5, u.x + 1.2) };
}

/** 检查香蕉是否被踩到 / 失效 */
function checkBanana(sim: RaceSim, events: RaceEvent[]): void {
  const u = sim.turtle;
  if (!sim.banana) return;
  // 乌龟已路过 → 香蕉失效
  if (u.x > sim.banana.x + 0.7) {
    sim.banana = null;
    return;
  }
  if (Math.abs(u.x - sim.banana.x) < 0.7) {
    if (u.state === "roll") {
      // 缩壳滚行免疫——滚过去了
      events.push({ type: "banana", slipped: false });
    } else {
      u.slip = 1.6;
      u.slipped = true;
      u.state = "crawl";
      u.stateT = 0;
      u.rollCd = Math.max(u.rollCd, 3);
      events.push({ type: "banana", slipped: true });
    }
    sim.banana = null;
  }
}

function useItem(sim: RaceSim, item: ItemId, events: RaceEvent[]): void {
  const r = sim.rabbit;
  const u = sim.turtle;
  const cost = ITEM_COST[item];
  // 能量不足、睡着了，或乌龟已在暴怒/疲惫时激将——都无法使用
  if (r.energy < cost || r.state === "sleeping") {
    if (item === "provoke") events.push({ type: "provoke", ok: false });
    return;
  }
  switch (item) {
    case "carrot": {
      r.energy -= cost;
      r.burst = 2;
      sim.itemsUsed.carrot += 1;
      events.push({ type: "burst" });
      break;
    }
    case "banana": {
      r.energy -= cost;
      sim.itemsUsed.banana += 1;
      placeBanana(sim);
      break;
    }
    case "provoke": {
      if (u.state === "anger" || u.state === "tired") {
        events.push({ type: "provoke", ok: false });
        return;
      }
      r.energy -= cost;
      u.provokedCount += 1;
      sim.itemsUsed.provoke += 1;
      u.state = "anger";
      u.stateT = 2.5;
      u.slip = 0;
      u.slipped = false;
      events.push({ type: "provoke", ok: true });
      break;
    }
  }
}

/* ------------------------------------------------------------------ */
/* 主推进                                                               */
/* ------------------------------------------------------------------ */

/**
 * 推进一帧模拟。
 * @returns 本帧产生的事件列表（组件据此播放音效 / 生成粒子与浮字）
 */
export function stepSim(sim: RaceSim, dt: number, input: RaceInput): RaceEvent[] {
  const events: RaceEvent[] = [];
  if (sim.over) return events;

  const prevRabbitState = sim.rabbit.state;
  const prevTurtleState = sim.turtle.state;
  const prevSegKind = terrainAt(sim.terrain, sim.rabbit.x).kind;

  sim.time += dt;

  if (input.item) useItem(sim, input.item, events);

  updateRabbit(sim, input, dt);

  // 能量积累：每跑满 12 米 +1
  const marks = Math.floor(sim.rabbit.x / ENERGY_PER_DIST);
  if (marks > sim.energyMarks) {
    const gain = Math.min(MAX_ENERGY - sim.rabbit.energy, marks - sim.energyMarks);
    sim.energyMarks = marks;
    if (gain > 0) {
      sim.rabbit.energy += gain;
      events.push({ type: "energy", total: sim.rabbit.energy });
    }
  }

  updateTurtle(sim, dt);

  // 边沿事件
  if (sim.rabbit.state === "sleeping" && prevRabbitState !== "sleeping") {
    events.push({ type: "sleep" });
  }
  if (sim.rabbit.state !== "sleeping" && prevRabbitState === "sleeping") {
    events.push({ type: "wake" });
  }
  if (sim.turtle.state === "roll" && prevTurtleState !== "roll") {
    events.push({ type: "turtleRoll" });
  }
  if (sim.turtle.state === "eat" && prevTurtleState !== "eat") {
    events.push({ type: "turtleEat" });
  }
  const nowSegKind = terrainAt(sim.terrain, sim.rabbit.x).kind;
  if (nowSegKind !== prevSegKind) {
    events.push({ type: "terrain", kind: nowSegKind });
  }

  // 香蕉被动触发
  if (sim.banana) checkBanana(sim, events);

  // 胜负判定
  if (sim.rabbit.x >= TRACK_LEN || sim.turtle.x >= TRACK_LEN) {
    sim.over = true;
    sim.won = sim.rabbit.x >= sim.turtle.x;
    sim.score = computeScore(sim.time, sim.won);
    events.push({ type: "finish", winner: sim.won ? "rabbit" : "turtle" });
  }

  return events;
}

/** 计分：兔子赢 2000 + 时间奖励；输 安慰分（时间越短分越高） */
export function computeScore(time: number, won: boolean): number {
  const t = Math.ceil(time);
  if (won) return 2000 + Math.max(0, 3000 - t * 40);
  return Math.max(100, 1000 - t * 20);
}

/** 兔子领先乌龟的米数（负 = 落后） */
export function leadMeters(sim: RaceSim): number {
  return sim.rabbit.x - sim.turtle.x;
}

/** 兔子奔跑平均速度估算（组件提示用） */
export function estimateRabbitSpeed(sim: RaceSim): number {
  const r = sim.rabbit;
  if (r.burst > 0) return 9.5;
  if (r.state === "running") return rabbitRunSpeed(r.stamina);
  if (r.state === "walking") return 1.7;
  return 0;
}
