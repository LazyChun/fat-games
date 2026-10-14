/*
 * archeryLogic：反弹神射（射箭小游戏）纯逻辑
 *
 * 核心玩法：在射手处拖弓蓄力发射箭矢，重力 + 随机风力影响弹道；
 * 箭矢碰到砖墙/冰面会反弹（每次反弹 +50% 命中得分），可借反弹绕过
 * 障碍命中目标；木箱一碰即碎、炸药桶引爆清障；苹果头靶高风险高回报。
 * 每关 5 支箭，达到目标分晋级，风力随关卡增强；连击（2.2s 内连续命中）
 * 提供最高 ×4 的得分倍率。
 *
 * 本模块不依赖 DOM / React，全部逻辑可用 vitest 确定性单测。
 */

export interface Vec2 {
  x: number;
  y: number;
}

export const ARC = {
  /** 画布尺寸与地面线 */
  W: 760,
  H: 460,
  GROUND: 384,
  /** 射手（弓心）位置 */
  ARCHER: { x: 88, y: 340 } as Vec2,
  /** 重力加速度 px/s^2 */
  gravity: 980,
  /** 发射速度下限 / 上限 px/s */
  minPower: 140,
  maxPower: 560,
  /** 拖弓最大有效距离 px */
  dragMax: 210,
  /** 每箭最大反弹次数，之后钉住 */
  bounceMax: 3,
  /** 每次反弹的得分加成 */
  bounceBonusPer: 0.5,
  /** 砖墙 / 冰面 恢复系数 */
  restBrick: 0.52,
  restIce: 0.9,
  /** 命中后钉住箭保留时长 ms */
  stuckLifeMs: 5000,
  /** 靶环半径（由内到外）与分值 */
  ringRadii: [6, 13, 20, 27, 34],
  ringScores: [50, 30, 20, 10, 5],
  /** 靶心命中半径（视觉/命中判定） */
  bullseyeR: 34,
  /** 苹果头靶：苹果半径与 NPC 身体半径 */
  appleR: 9,
  npcR: 28,
  /** 苹果命中基础分 */
  appleScore: 15,
  /** 误伤 NPC 的扣分（绝对值） */
  npcPenalty: 20,
  /** 炸药桶 */
  barrelR: 24,
  barrelBlast: 76,
  barrelKillScore: 25,
  /** 爆炸本身的基础奖励（× 当前连击，≥1） */
  barrelFlatScore: 10,
  /** 连击窗口 ms 与倍率上限 */
  comboWindowMs: 2200,
  comboCap: 4,
  /** 风力：每关最大风速 = windBase + (level-1)*windPerLevel，封顶 windCap */
  windBase: 110,
  windPerLevel: 130,
  windCap: 430,
  /** 每关箭数与目标分 */
  arrowsPerLevel: 5,
  maxLevel: 8,
} as const;

export function goalForLevel(level: number): number {
  return 40 + 35 * level;
}

export type ObKind = "brick" | "ice" | "crate" | "barrel";

export interface Obstacle {
  id: number;
  kind: ObKind;
  x: number;
  y: number;
  w: number;
  h: number;
  alive: boolean;
}

export type TargetKind = "bullseye" | "apple";

export interface Target {
  id: number;
  kind: TargetKind;
  x: number;
  y: number;
  alive: boolean;
  /** 移动靶：上下往返 */
  moving: boolean;
  minY: number;
  maxY: number;
  speed: number;
  dir: 1 | -1;
}

export interface Arrow {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  bounces: number;
  /** 钉住（障碍/地面）后不再移动 */
  stuck: boolean;
  stuckAt: number;
  removed: boolean;
}

export interface Effect {
  kind: "text" | "burst" | "boom" | "smoke" | "ring";
  x: number;
  y: number;
  text?: string;
  color?: string;
  t: number;
  life: number;
}

export type GameEvent =
  | { type: "shot"; x: number; y: number }
  | { type: "bounce"; x: number; y: number; kind: ObKind }
  | { type: "thud"; x: number; y: number }
  | { type: "land"; x: number; y: number }
  | { type: "crate"; x: number; y: number }
  | { type: "boom"; x: number; y: number }
  | { type: "hit"; x: number; y: number; points: number; ring: number }
  | { type: "bullseye"; x: number; y: number; points: number }
  | { type: "apple"; x: number; y: number; points: number }
  | { type: "npc"; x: number; y: number; points: number }
  | { type: "arrowout"; x: number; y: number }
  | { type: "levelup"; level: number }
  | { type: "over"; score: number }
  | { type: "won"; score: number };

export type Phase = "idle" | "flying" | "levelup" | "over" | "won";

export interface World {
  level: number;
  phase: Phase;
  arrowsLeft: number;
  /** 累计总分（跨关） */
  score: number;
  /** 本关得分 */
  levelScore: number;
  goal: number;
  combo: number;
  comboTimer: number;
  /** 本箭风力（水平加速度 px/s^2，正=向右） */
  wind: number;
  windMax: number;
  time: number;
  arrows: Arrow[];
  obstacles: Obstacle[];
  targets: Target[];
  effects: Effect[];
  events: GameEvent[];
  /** 关卡结算只触发一次 */
  settled: boolean;
}

/* ── 确定性随机数（mulberry32）────────────────────────────── */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ── 关卡生成 ─────────────────────────────────────────────── */

let obstacleSeq = 0;
let targetSeq = 0;

/** 生成第 level 关的世界（确定性：同 level + seed 生成同一布局） */
export function createWorld(level: number, seed = 1000 + level * 7919): World {
  const rng = mulberry32(seed);
  const world: World = {
    level,
    phase: "idle",
    arrowsLeft: ARC.arrowsPerLevel,
    score: 0,
    levelScore: 0,
    goal: goalForLevel(level),
    combo: 0,
    comboTimer: 0,
    wind: 0,
    windMax: Math.min(ARC.windBase + (level - 1) * ARC.windPerLevel, ARC.windCap),
    time: 0,
    arrows: [],
    obstacles: [],
    targets: [],
    effects: [],
    events: [],
    settled: false,
  };

  // ── 障碍 ──
  const ob = (
    kind: ObKind,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void => {
    world.obstacles.push({ id: ++obstacleSeq, kind, x, y, w, h, alive: true });
  };

  // ── 障碍（布局按弹道包络设计：maxPower=560、g=980 时最远落点约 x≈408，
  //     再加风力漂移；因此靶与障碍全部落在 x∈[240,485]、y∈[215,355] 的可及区）──
  // 低墙：封住平射低弹道，逼玩家中高抛越顶；高抛砸在墙顶还会向上反弹（弹道加成）
  ob("brick", 310 + rng() * 10, 300, 12, 80);
  // 木箱堆（L2 起，低处遮挡），最多 2 个
  const crates = Math.min(1 + Math.floor((level - 1) / 2), 2);
  for (let c = 0; c < crates; c++) {
    ob("crate", 450 + c * 52 + rng() * 6, ARC.GROUND - 36, 50, 36);
  }
  // 炸药桶（L4 起），紧贴首箱左侧：轰碎木箱为弹道开路，也可炸掉近旁的远靶
  if (level >= 4) ob("barrel", 440 + rng() * 6, ARC.GROUND - 24, 24, 24);

  // ── 靶 ──
  const addTarget = (t: Omit<Target, "id">): void => {
    world.targets.push({ id: ++targetSeq, ...t });
  };
  const nBull = Math.min(2 + Math.floor(level / 2), 4);
  const bullY: [number, number][] = [
    [230, 250], // 近高靶：热身，中高抛直接可中
    [310, 335], // 低靶：在低墙之后，需 36°+ 抛越矮墙（风向微调）
    [260, 290], // 远中靶（3 靶起）：需借风力漂移抵达
    [330, 350], // 远低靶（4 靶起）：风 + 冰面/桶可及
  ];
  const bullX: [number, number][] = [
    [250, 268],
    [360, 376],
    [446, 460],
    [470, 484],
  ];
  for (let i = 0; i < nBull; i++) {
    const x = bullX[i][0] + rng() * (bullX[i][1] - bullX[i][0]);
    const y = bullY[i][0] + rng() * (bullY[i][1] - bullY[i][0]);
    const moving = level >= 2 && rng() < 0.28 + level * 0.05;
    addTarget({
      kind: "bullseye",
      x,
      y,
      alive: true,
      moving,
      minY: Math.max(96, y - 56),
      maxY: Math.min(352, y + 56),
      speed: 34 + level * 5,
      dir: rng() < 0.5 ? 1 : -1,
    });
  }
  // 苹果头靶（威廉·泰尔），站在矮墙与冰面之间的空档：中高抛 + 风力即可中
  addTarget({
    kind: "apple",
    x: 395 + rng() * 10,
    y: ARC.GROUND - 34,
    alive: true,
    moving: false,
    minY: 0,
    maxY: 0,
    speed: 0,
    dir: 1,
  });

  return world;
}

/** 本关是否还有“在飞”的箭（决定是否进入结算判定） */
export function hasFlyingArrow(world: World): boolean {
  return world.arrows.some((a) => !a.stuck && !a.removed);
}

/* ── 瞄准与发射 ───────────────────────────────────────────── */

/**
 * 拖弓蓄力 → 发射初速度。
 * 玩家在弓手处按住并向外拖：箭头将沿「弓手 → 反方向」飞出，
 * 即拖向弓手左/下方则射向右侧上方（拉弦手感的经典映射）。
 */
export function computeLaunch(
  archer: Vec2,
  pointer: Vec2,
): { vx: number; vy: number; power: number } {
  const dx = archer.x - pointer.x;
  const dy = archer.y - pointer.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) {
    // 兜底：正对目标方向的最小力度
    return { vx: ARC.minPower, vy: 0, power: ARC.minPower };
  }
  const t = Math.min(dist, ARC.dragMax) / ARC.dragMax;
  const power = ARC.minPower + (ARC.maxPower - ARC.minPower) * t;
  const k = power / dist;
  return { vx: dx * k, vy: dy * k, power };
}

/** 发射（消耗一支箭，按 launch 初速度出膛）；返回本箭风力，供 HUD 展示 */
export function startShot(
  world: World,
  launch: { vx: number; vy: number },
  rand: () => number = Math.random,
): number {
  if (world.phase !== "idle" && world.phase !== "flying") return world.wind;
  if (world.arrowsLeft <= 0 || hasFlyingArrow(world)) return world.wind;
  world.wind = (rand() * 2 - 1) * world.windMax;
  world.arrowsLeft -= 1;
  const a: Arrow = {
    x: ARC.ARCHER.x + 18,
    y: ARC.ARCHER.y - 4,
    vx: launch.vx,
    vy: launch.vy,
    rot: Math.atan2(launch.vy, launch.vx),
    bounces: 0,
    stuck: false,
    stuckAt: 0,
    removed: false,
  };
  world.arrows.push(a);
  world.events.push({ type: "shot", x: a.x, y: a.y });
  return world.wind;
}

/** 预测弹道（用于拖弓时的虚线预览），碰到首个障碍/地面/边界即停 */
export function previewPath(
  world: World,
  launch: { vx: number; vy: number },
  maxSteps = 340,
  dt = 1 / 60,
): Vec2[] {
  const pts: Vec2[] = [];
  let x = ARC.ARCHER.x + 18;
  let y = ARC.ARCHER.y - 4;
  let vx = launch.vx;
  let vy = launch.vy;
  for (let i = 0; i < maxSteps; i++) {
    x += vx * dt;
    y += vy * dt;
    vy += ARC.gravity * dt;
    vx += world.wind * dt;
    if (i % 3 === 0) pts.push({ x, y });
    if (y >= ARC.GROUND - 2) break;
    if (x < 0 || x > ARC.W || y < 0) break;
    if (hitObstacle(world, x, y)) break;
  }
  return pts;
}

/* ── 物理与碰撞 ───────────────────────────────────────────── */

function hitObstacle(world: World, x: number, y: number): Obstacle | null {
  for (const o of world.obstacles) {
    if (!o.alive) continue;
    if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h) return o;
  }
  return null;
}

function bounceOff(
  arrow: Arrow,
  o: Obstacle,
  rest: number,
): void {
  // 取穿透最小的那条边作为反弹面
  const left = arrow.x - o.x;
  const right = o.x + o.w - arrow.x;
  const top = arrow.y - o.y;
  const bottom = o.y + o.h - arrow.y;
  const m = Math.min(left, right, top, bottom);
  if (m === left) {
    arrow.x = o.x - 2;
    arrow.vx = -arrow.vx * rest;
  } else if (m === right) {
    arrow.x = o.x + o.w + 2;
    arrow.vx = -arrow.vx * rest;
  } else if (m === top) {
    arrow.y = o.y - 2;
    arrow.vy = -arrow.vy * rest;
  } else {
    arrow.y = o.y + o.h + 2;
    arrow.vy = -arrow.vy * rest;
  }
}

/** 判定箭矢当前点命中的靶；命中则置目标不可用并返回计分信息 */
function checkTargets(
  world: World,
  a: Arrow,
): { points: number; kind: "bullseye" | "apple"; ring: number; x: number; y: number; npcHit?: boolean } | null {
  for (const t of world.targets) {
    if (!t.alive) continue;
    if (t.kind === "bullseye") {
      const d = Math.hypot(a.x - t.x, a.y - t.y);
      if (d <= ARC.bullseyeR) {
        t.alive = false;
        let ring = ARC.ringRadii.length - 1;
        for (let i = 0; i < ARC.ringRadii.length; i++) {
          if (d <= ARC.ringRadii[i]) {
            ring = i;
            break;
          }
        }
        return { points: ARC.ringScores[ring], kind: "bullseye", ring, x: t.x, y: t.y };
      }
    } else {
      // 苹果头靶：苹果在头顶 (x, y-30)，身体半径 npcR
      const apple = { x: t.x, y: t.y - 30 };
      const dApple = Math.hypot(a.x - apple.x, a.y - apple.y);
      if (dApple <= ARC.appleR) {
        t.alive = false;
        return { points: ARC.appleScore, kind: "apple", ring: 0, x: apple.x, y: apple.y };
      }
      const dNpc = Math.hypot(a.x - t.x, a.y - t.y);
      if (dNpc <= ARC.npcR) {
        t.alive = false;
        return { points: ARC.npcPenalty, kind: "apple", ring: 0, x: t.x, y: t.y, npcHit: true };
      }
    }
  }
  return null;
}

/* ── 关卡结算 ─────────────────────────────────────────────── */

function settleLevel(world: World): void {
  if (world.settled) return;
  world.settled = true;
  if (world.levelScore >= world.goal) {
    if (world.level >= ARC.maxLevel) {
      world.phase = "won";
      world.events.push({ type: "won", score: world.score });
    } else {
      world.phase = "levelup";
      world.events.push({ type: "levelup", level: world.level });
    }
  } else {
    world.phase = "over";
    world.events.push({ type: "over", score: world.score });
  }
}

/** 进入下一关（保留累计分） */
export function advanceLevel(world: World, seed?: number): World {
  const next = createWorld(world.level + 1, seed);
  next.score = world.score;
  next.phase = "flying";
  return next;
}

/* ── 主推进 ───────────────────────────────────────────────── */

/** 推进世界一帧。dtMs 为毫秒；返回本帧事件（供 UI 播放音效/飘字） */
export function stepWorld(world: World, dtMs: number): GameEvent[] {
  const dt = Math.min(dtMs, 50) / 1000;
  world.time += dtMs;
  world.events.length = 0;

  // 连击窗口衰减
  if (world.comboTimer > 0) {
    world.comboTimer -= dtMs;
    if (world.comboTimer <= 0) world.combo = 0;
  }

  // 移动靶
  for (const t of world.targets) {
    if (!t.alive || !t.moving) continue;
    t.y += t.dir * t.speed * dt;
    if (t.y <= t.minY) {
      t.y = t.minY;
      t.dir = 1;
    } else if (t.y >= t.maxY) {
      t.y = t.maxY;
      t.dir = -1;
    }
  }

  // 箭矢
  for (const a of world.arrows) {
    if (a.removed) continue;
    if (a.stuck) {
      if (world.time - a.stuckAt > ARC.stuckLifeMs) a.removed = true;
      continue;
    }
    const sub = 4;
    const sdt = dt / sub;
    let dead = false;
    for (let s = 0; s < sub && !dead; s++) {
      a.x += a.vx * sdt;
      a.y += a.vy * sdt;
      a.vy += ARC.gravity * sdt;
      a.vx += world.wind * sdt;
      a.rot = Math.atan2(a.vy, a.vx);

      // 边界 / 落地
      if (a.y >= ARC.GROUND - 2) {
        a.y = ARC.GROUND - 2;
        a.stuck = true;
        a.stuckAt = world.time;
        a.removed = a.vx > 900; // 高速撞地直接消失
        world.events.push({ type: "land", x: a.x, y: a.y });
        dead = true;
        break;
      }
      if (a.x < -30 || a.x > ARC.W + 30 || a.y < -40) {
        a.removed = true;
        world.events.push({ type: "arrowout", x: a.x, y: a.y });
        dead = true;
        break;
      }

      // 目标命中
      const hit = checkTargets(world, a);
      if (hit) {
        if (hit.npcHit) {
          world.combo = 0;
          world.comboTimer = 0;
          world.score = Math.max(0, world.score - ARC.npcPenalty);
          world.levelScore = Math.max(0, world.levelScore - ARC.npcPenalty);
          world.events.push({ type: "npc", x: hit.x, y: hit.y, points: -ARC.npcPenalty });
        } else {
          world.combo = Math.min(world.combo + 1, ARC.comboCap);
          world.comboTimer = ARC.comboWindowMs;
          const bounceBonus = 1 + ARC.bounceBonusPer * a.bounces;
          const points = Math.round(hit.points * world.combo * bounceBonus);
          world.score += points;
          world.levelScore += points;
          if (hit.kind === "apple") {
            world.events.push({ type: "apple", x: hit.x, y: hit.y, points });
          } else if (hit.ring === 0) {
            world.events.push({ type: "bullseye", x: hit.x, y: hit.y, points });
          } else {
            world.events.push({ type: "hit", x: hit.x, y: hit.y, points, ring: hit.ring });
          }
        }
        a.stuck = true;
        a.stuckAt = world.time;
        dead = true;
        break;
      }

      // 障碍
      const o = hitObstacle(world, a.x, a.y);
      if (o) {
        if (o.kind === "brick" || o.kind === "ice") {
          if (a.bounces < ARC.bounceMax) {
            a.bounces += 1;
            bounceOff(a, o, o.kind === "ice" ? ARC.restIce : ARC.restBrick);
            world.events.push({ type: "bounce", x: a.x, y: a.y, kind: o.kind });
          } else {
            a.stuck = true;
            a.stuckAt = world.time;
            world.events.push({ type: "thud", x: a.x, y: a.y });
            dead = true;
            break;
          }
        } else if (o.kind === "crate") {
          o.alive = false;
          a.vx *= 0.7;
          a.vy *= 0.7;
          world.events.push({ type: "crate", x: o.x + o.w / 2, y: o.y + o.h / 2 });
        } else if (o.kind === "barrel") {
          o.alive = false;
          // 引爆：基础奖励分、清碎周边木箱、清掉范围内靶、推开附近箭
          const flat = ARC.barrelFlatScore * Math.max(world.combo, 1);
          world.score += flat;
          world.levelScore += flat;
          for (const ob of world.obstacles) {
            if (!ob.alive || ob.kind !== "crate") continue;
            if (Math.hypot(ob.x + ob.w / 2 - (o.x + o.w / 2), ob.y + ob.h / 2 - (o.y + o.h / 2)) <= ARC.barrelBlast + 40) {
              ob.alive = false;
            }
          }
          for (const t of world.targets) {
            if (!t.alive || t.kind !== "bullseye") continue;
            if (Math.hypot(t.x - (o.x + o.w / 2), t.y - (o.y + o.h / 2)) <= ARC.barrelBlast) {
              t.alive = false;
              world.combo = Math.min(world.combo + 1, ARC.comboCap);
              world.comboTimer = ARC.comboWindowMs;
              const points = Math.round(ARC.barrelKillScore * world.combo);
              world.score += points;
              world.levelScore += points;
              world.events.push({ type: "hit", x: t.x, y: t.y, points, ring: 4 });
            }
          }
          for (const ar of world.arrows) {
            if (ar.removed) continue;
            if (Math.hypot(ar.x - (o.x + o.w / 2), ar.y - (o.y + o.h / 2)) <= ARC.barrelBlast + 20) {
              ar.stuck = false;
              ar.vx *= 0.5;
              ar.vy = -Math.abs(ar.vy) * 0.5 - 60;
            }
          }
          world.events.push({ type: "boom", x: o.x + o.w / 2, y: o.y + o.h / 2 });
          a.vx *= 0.4;
          a.vy *= 0.4;
        }
      }
    }
    if (dead) continue;
  }

  // 箭尽且无飞行箭 → 结算
  if (
    world.arrowsLeft <= 0 &&
    !hasFlyingArrow(world) &&
    (world.phase === "flying" || world.phase === "idle")
  ) {
    settleLevel(world);
  }

  return world.events;
}

/** 直接命中计分（供测试/预览复用的纯函数） */
export function ringIndex(distance: number): number {
  for (let i = 0; i < ARC.ringRadii.length; i++) {
    if (distance <= ARC.ringRadii[i]) return i;
  }
  return ARC.ringRadii.length - 1;
}
