/*
 * hawkLogic：老鹰抓小鸡 纯逻辑（不依赖 DOM / React，便于 vitest 单测）
 *
 * 玩法：玩家操控母鸡（hen）保护身后的小鸡队列（chicks）。
 * 老鹰（eagle）在天空盘旋，周期性俯冲抓取队尾小鸡；母鸡迎上去撞到老鹰
 * 可将其啄晕（stun），若老鹰正叼着小鸡则小鸡获救并回到队尾。
 * 拾取从天而降的金蛋可增加一只小鸡（上限 MAX_CHICKS）。
 * 坚持 WIN_SECONDS 秒且仍有小鸡存活 = 胜利；小鸡全部被抓光 = 失败。
 *
 * 计分：存活每秒 +2；救援 +50；金蛋 +30（队列已满 +10）；胜利额外
 * 剩余小鸡 ×20 + 100。
 */

export const W = 480;
export const H = 640;
export const HEN_R = 19;
export const CHICK_R = 11;
export const EAGLE_R = 22;
export const CHICK_SPACING = 34;
export const CHICK_FOLLOW_SPEED = 320;
export const HEN_SPEED = 340;
export const START_CHICKS = 6;
export const MAX_CHICKS = 8;
export const WIN_SECONDS = 60;

export type EagleState = "circle" | "dive" | "carry" | "stun";

export interface Vec {
  x: number;
  y: number;
}

export interface Chick extends Vec {}

export interface EggItem extends Vec {
  vy: number;
  r: number;
}

export interface Eagle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 盘旋基准高度 */
  homeY: number;
  /** 翅膀相位 / 正弦起伏相位 */
  phase: number;
  state: EagleState;
  /** 状态剩余时间（s） */
  stateT: number;
  /** 是否正叼着一只小鸡 */
  carryChick: boolean;
  /** 个体速度倍率 */
  speedMul: number;
}

export interface HawkSim {
  hen: Vec;
  /** 母鸡朝向：1 朝右，-1 朝左 */
  facing: number;
  /** 队首 → 队尾，chicks[0] 紧挨母鸡 */
  chicks: Chick[];
  eagles: Eagle[];
  eggs: EggItem[];
  score: number;
  /** 已存活秒数 */
  time: number;
  caught: number;
  rescued: number;
  /** 母鸡啄晕老鹰的冷却（避免连续触发） */
  peckCd: number;
  nextEagleIn: number;
  nextEggIn: number;
  /** 是否正在运行（由组件切换，逻辑本身不依赖） */
  running: boolean;
  over: boolean;
  won: boolean;
  recorded: boolean;
}

export interface MoveInput {
  dx: number;
  dy: number;
}

/** stepSim 每帧产生的事件（供组件播放音效 / 粒子 / 浮字） */
export type HawkEvent =
  | { type: "stun"; x: number; y: number }
  | { type: "rescue"; x: number; y: number; points: number }
  | { type: "catch"; x: number; y: number }
  | { type: "egg"; x: number; y: number; points: number }
  | { type: "eggFull"; x: number; y: number; points: number }
  | { type: "win"; x: number; y: number }
  | { type: "lose"; x: number; y: number };

const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

/** 生成一只从侧方进场的盘旋老鹰 */
function makeEagle(): Eagle {
  const fromLeft = Math.random() < 0.5;
  return {
    x: fromLeft ? 40 : W - 40,
    y: rand(30, 80),
    vx: (fromLeft ? 1 : -1) * rand(90, 130),
    vy: 0,
    homeY: rand(36, 80),
    phase: rand(0, Math.PI * 2),
    state: "circle",
    stateT: rand(1.5, 3.6),
    carryChick: false,
    speedMul: rand(0.88, 1.12),
  };
}

/** 初始局面：母鸡居中偏下，6 只小鸡跟在身后，1 只老鹰在天空盘旋 */
export function newSim(): HawkSim {
  const hen = { x: W / 2, y: H - 88 };
  const chicks: Chick[] = [];
  for (let i = 1; i <= START_CHICKS; i++) {
    chicks.push({
      x: hen.x - i * CHICK_SPACING,
      y: hen.y + (i % 2 === 0 ? 5 : -5),
    });
  }
  return {
    hen,
    facing: 1,
    chicks,
    eagles: [makeEagle()],
    eggs: [],
    score: 0,
    time: 0,
    caught: 0,
    rescued: 0,
    peckCd: 0,
    nextEagleIn: 16,
    nextEggIn: 6,
    running: false,
    over: false,
    won: false,
    recorded: false,
  };
}

export function chickCount(sim: HawkSim): number {
  return sim.chicks.length;
}

/** 母鸡移动（带边界） */
function moveHen(sim: HawkSim, input: MoveInput, dt: number): void {
  const len = Math.hypot(input.dx, input.dy);
  if (len > 0.001) {
    sim.hen.x += (input.dx / len) * HEN_SPEED * dt;
    sim.hen.y += (input.dy / len) * HEN_SPEED * dt;
    if (Math.abs(input.dx) > 0.001) sim.facing = input.dx > 0 ? 1 : -1;
  }
  sim.hen.x = clamp(sim.hen.x, 26, W - 26);
  sim.hen.y = clamp(sim.hen.y, H - 210, H - 62);
}

/** 小鸡队列跟随：每只小鸡保持与前一只的间距，平滑趋近目标点 */
function updateChicks(sim: HawkSim, dt: number): void {
  for (let i = 0; i < sim.chicks.length; i++) {
    const c = sim.chicks[i];
    const leader: Vec = i === 0 ? sim.hen : sim.chicks[i - 1];
    const dx = c.x - leader.x;
    const dy = c.y - leader.y;
    const dist = Math.hypot(dx, dy);
    if (dist > CHICK_SPACING) {
      const tx = leader.x + (dx / dist) * CHICK_SPACING;
      const ty = leader.y + (dy / dist) * CHICK_SPACING;
      const t = Math.min(1, (CHICK_FOLLOW_SPEED * dt) / dist);
      c.x += (tx - c.x) * t;
      c.y += (ty - c.y) * t;
    }
    c.x = clamp(c.x, 26, W - 26);
    c.y = clamp(c.y, H - 230, H - 56);
  }
}

/** 母鸡啄晕老鹰：若叼着小鸡则救回队尾 */
function peckEagle(sim: HawkSim, e: Eagle, events: HawkEvent[]): void {
  if (e.state === "stun" || sim.peckCd > 0) return;
  const d = Math.hypot(e.x - sim.hen.x, e.y - sim.hen.y);
  if (d < HEN_R + EAGLE_R + 2) {
    e.state = "stun";
    e.stateT = 2.6;
    sim.peckCd = 1.2;
    if (e.carryChick) {
      e.carryChick = false;
      sim.rescued += 1;
      sim.score += 50;
      const last = sim.chicks[sim.chicks.length - 1];
      sim.chicks.push({
        x: (last ? last.x : sim.hen.x) - CHICK_SPACING,
        y: (last ? last.y : sim.hen.y) + 10,
      });
      events.push({ type: "rescue", x: e.x, y: e.y, points: 50 });
    } else {
      events.push({ type: "stun", x: e.x, y: e.y });
    }
  }
}

/** 老鹰状态机 */
function updateEagles(sim: HawkSim, dt: number, events: HawkEvent[]): void {
  for (const e of sim.eagles) {
    e.phase += dt * 6;
    switch (e.state) {
      case "circle": {
        e.x += e.vx * dt;
        e.y = e.homeY + Math.sin(e.phase) * 18;
        if (e.x < 26) {
          e.x = 26;
          e.vx = Math.abs(e.vx);
        }
        if (e.x > W - 26) {
          e.x = W - 26;
          e.vx = -Math.abs(e.vx);
        }
        e.stateT -= dt;
        if (e.stateT <= 0 && sim.chicks.length > 0) {
          e.state = "dive";
          e.stateT = 999;
        }
        break;
      }
      case "dive": {
        const idx = sim.chicks.length - 1;
        if (idx < 0) {
          e.state = "circle";
          e.stateT = rand(1.5, 3);
          break;
        }
        const t = sim.chicks[idx];
        const dx = t.x - e.x;
        const dy = t.y - e.y;
        const dist = Math.hypot(dx, dy) || 1;
        const spd = Math.min(560, 340 + sim.time * 1.5) * e.speedMul;
        e.x += (dx / dist) * spd * dt;
        e.y += (dy / dist) * spd * dt;
        if (dist < CHICK_R + EAGLE_R + 4) {
          sim.chicks.splice(idx, 1);
          sim.caught += 1;
          e.carryChick = true;
          e.state = "carry";
          e.stateT = 6;
          events.push({ type: "catch", x: t.x, y: t.y });
        }
        break;
      }
      case "carry": {
        e.x += e.vx * dt;
        e.y -= (150 + sim.time * 0.8) * dt;
        e.stateT -= dt;
        if (e.y < -80 || e.stateT <= 0) e.y = -999; // 标记移除
        break;
      }
      case "stun": {
        e.x += Math.sin(e.phase * 2) * 26 * dt;
        e.y += 6 * dt;
        e.stateT -= dt;
        if (e.stateT <= 0) {
          e.state = "circle";
          e.vx = (e.x < W / 2 ? 1 : -1) * rand(90, 130);
          e.homeY = rand(36, 80);
          e.stateT = rand(1.5, 3.4);
        }
        break;
      }
    }
    peckEagle(sim, e, events);
  }
  sim.eagles = sim.eagles.filter((e) => e.y > -120);
}

/** 金蛋下落与拾取 */
function updateEggs(sim: HawkSim, dt: number, events: HawkEvent[]): void {
  for (const egg of sim.eggs) {
    egg.y += egg.vy * dt;
    const d = Math.hypot(egg.x - sim.hen.x, egg.y - sim.hen.y);
    if (d < HEN_R + egg.r + 2) {
      egg.y = H + 99; // 标记移除
      if (sim.chicks.length < MAX_CHICKS) {
        const last = sim.chicks[sim.chicks.length - 1];
        sim.chicks.push({
          x: (last ? last.x : sim.hen.x) - CHICK_SPACING,
          y: (last ? last.y : sim.hen.y) + 6,
        });
        sim.score += 30;
        events.push({ type: "egg", x: egg.x, y: egg.y, points: 30 });
      } else {
        sim.score += 10;
        events.push({ type: "eggFull", x: egg.x, y: egg.y, points: 10 });
      }
    }
  }
  sim.eggs = sim.eggs.filter((e) => e.y < H + 40);
}

/**
 * 推进一帧模拟。
 * @returns 本帧产生的事件列表（组件据此播放音效 / 生成粒子与浮字）
 */
export function stepSim(sim: HawkSim, dt: number, input: MoveInput): HawkEvent[] {
  const events: HawkEvent[] = [];
  if (sim.over) return events;

  sim.time += dt;
  sim.peckCd = Math.max(0, sim.peckCd - dt);
  sim.score += 2 * dt; // 存活计分

  moveHen(sim, input, dt);
  updateChicks(sim, dt);
  updateEagles(sim, dt, events);
  updateEggs(sim, dt, events);

  // 老鹰生成（随难度增加，最多 3 只）
  if (sim.nextEagleIn <= 0) {
    sim.nextEagleIn = rand(11, 17);
    const maxEagles = Math.min(3, 1 + Math.floor(sim.time / 25));
    if (sim.eagles.length < maxEagles) sim.eagles.push(makeEagle());
  } else {
    sim.nextEagleIn -= dt;
  }

  // 金蛋生成（天上最多 2 枚）
  if (sim.nextEggIn <= 0) {
    if (sim.eggs.length < 2) {
      sim.eggs.push({ x: rand(50, W - 50), y: -16, vy: 150, r: 9 });
      sim.nextEggIn = rand(8, 14);
    } else {
      sim.nextEggIn = 2;
    }
  } else {
    sim.nextEggIn -= dt;
  }

  // 胜负判定
  if (sim.chicks.length === 0) {
    sim.over = true;
    sim.won = false;
    events.push({ type: "lose", x: sim.hen.x, y: sim.hen.y });
  } else if (sim.time >= WIN_SECONDS) {
    sim.over = true;
    sim.won = true;
    sim.score += sim.chicks.length * 20 + 100;
    events.push({ type: "win", x: sim.hen.x, y: sim.hen.y });
  }

  return events;
}
