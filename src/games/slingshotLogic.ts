/*
 * 引力弹弓（Gravity Slingshot）纯逻辑
 *
 * 不依赖 DOM / React，便于 vitest 单元测试。规则集 ruleset_id: slingshot-v1。
 *
 * 核心循环：
 *   飞船在星系中自由飞行，所有行星对其施加牛顿引力 a = GM/r²；
 *   玩家用喷口（主引擎 / 减速 / RCS 转向）点火消耗能源调整航向与速度；
 *   切入行星引力带（wellR）免费获得大幅偏转与加速 = 引力弹弓；
 *   人类基地行星（base）补给半径内自动充能，抵达即切换“下一站”；
 *   陨石随机漂移，撞击损失能源并击退；深潜大气层持续掉能，触及核心反弹；
 *   能源归零 → 相位 OVER，得分 = 累计航行距离（1px = 1km）。
 *
 * 坐标系：世界坐标，x 向右、y 向下；飞船角度 0 = 机头朝右（+x），
 * 正值顺时针。A/← 逆时针转向（spin 减小），D/→ 顺时针转向（spin 增大）。
 */

export type EngineId = "main" | "retro" | "left" | "right";

export type EngineInput = Record<EngineId, boolean>;

export const NO_ENGINES: EngineInput = {
  main: false,
  retro: false,
  left: false,
  right: false,
};

export type Phase = "idle" | "flying" | "paused" | "over";

export type PlanetKind = "star" | "giant" | "normal" | "base";

export interface Planet {
  id: string;
  /** 展示名（基地名 / 行星名） */
  name: string;
  x: number;
  y: number;
  /** 核心半径（px） */
  radius: number;
  /** 引力常数 × 质量（px^3/s^2） */
  gm: number;
  kind: PlanetKind;
  /** 渲染色相（0-360） */
  hue: number;
  /** 大气层（危险）半径 */
  atmosphereR: number;
  /** 引力带可视半径 */
  wellR: number;
  /** 补给半径（仅 base 有意义） */
  refuelR: number;
}

export interface World {
  width: number;
  height: number;
  planets: Planet[];
  startBaseId: string;
}

export interface Ship {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 机头朝向（rad），0 = 朝右 */
  angle: number;
  /** 角速度（rad/s），正值顺时针 */
  spin: number;
  /** 能源 0..1 */
  energy: number;
  /** 剩余无敌秒数 */
  invuln: number;
}

export interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
}

export type GameEvent =
  | { type: "refuel"; x: number; y: number; name: string }
  | { type: "base_arrived"; x: number; y: number; name: string }
  | { type: "meteor_hit"; x: number; y: number }
  | { type: "slingshot"; x: number; y: number; turnDeg: number }
  | { type: "atmo_enter"; x: number; y: number }
  | { type: "bounce"; x: number; y: number };

export interface RunState {
  phase: Phase;
  ship: Ship;
  meteors: Meteor[];
  /** 累计航行路径长度（px，即得分 km） */
  distancePx: number;
  /** 已飞行时间（s） */
  time: number;
  /** 下一站目的地行星 id */
  nextDestId: string;
  /** 补给站抵达顺序（最后一项为当前基地，用于轮转下一站） */
  visitedOrder: string[];
  /** 抵达补给站次数 */
  baseReached: number;
  /** 弹弓加速次数 */
  slingshots: number;
  /** 能源归零是否已结算（同帧只结算一次） */
  energyZeroFired: boolean;
  /** 每颗行星引力带内追踪（弹弓判定：入带航向） */
  inWell: Record<string, { inside: boolean; angleIn: number }>;
  /** 当前是否处于某行星大气层内 */
  inAtmo: boolean;
  /** 各基地上一帧是否在补给半径内（抵达判定） */
  wasInRefuel: Record<string, boolean>;
  meteorTimer: number;
  rand: () => number;
}

/** 物理 / 经济参数（与设计契约一一对应，ruleset_id: slingshot-v1） */
export interface SlingshotParams {
  worldWidth: number;
  worldHeight: number;
  thrustMain: number;
  thrustRetro: number;
  turnRate: number;
  spinDamping: number;
  burnMain: number;
  burnRetro: number;
  burnRcs: number;
  energyStart: number;
  atmoDrain: number;
  meteorHitLoss: number;
  refuelRate: number;
  meteorInterval0: number;
  meteorIntervalMin: number;
  meteorRampSec: number;
  meteorCap: number;
  invuln: number;
  knockback: number;
  /** 弹弓判定阈值：通过引力带期间的航向偏转（度） */
  slingTurnDeg: number;
  shipRadius: number;
}

export const SLINGSHOT_PARAMS: SlingshotParams = {
  worldWidth: 5200,
  worldHeight: 3600,
  thrustMain: 280,
  thrustRetro: 220,
  turnRate: 2.6,
  spinDamping: 0.6,
  burnMain: 0.075,
  burnRetro: 0.095,
  burnRcs: 0.018,
  energyStart: 1.0,
  atmoDrain: 0.16,
  meteorHitLoss: 0.3,
  refuelRate: 0.33,
  meteorInterval0: 1.4,
  meteorIntervalMin: 0.5,
  meteorRampSec: 300,
  meteorCap: 60,
  invuln: 1.5,
  knockback: 240,
  slingTurnDeg: 25,
  shipRadius: 10,
};

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

/** 将角度归一化到 (-π, π] */
export function normalizeAngle(a: number): number {
  let x = a % (Math.PI * 2);
  if (x > Math.PI) x -= Math.PI * 2;
  if (x < -Math.PI) x += Math.PI * 2;
  return x;
}

/** 机头方向（世界系单位向量） */
export function noseDir(angle: number): { x: number; y: number } {
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

/** 构造行星（自动派生大气层 / 引力带 / 补给半径） */
function makePlanet(
  id: string,
  name: string,
  x: number,
  y: number,
  radius: number,
  gm: number,
  kind: PlanetKind,
  hue: number,
  jx: number,
  jy: number,
  jr: number,
  jg: number,
): Planet {
  const rr = radius * (1 + jr);
  return {
    id,
    name,
    x: x * (1 + jx),
    y: y * (1 + jy),
    radius: rr,
    gm: gm * (1 + jg),
    kind,
    hue,
    atmosphereR: rr * 1.24,
    wellR: rr * 3.2 + 70,
    refuelR: rr + 95,
  };
}

/**
 * 生成星系世界：1 颗恒星（视觉）+ 3 座人类基地行星 + 5 颗普通行星 + 1 颗巨行星。
 * 布局手调以保证「基地→巨行星弹弓→基地」的天然航线；位置/质量/半径带轻微随机。
 * 基地行星引力刻意调弱（安全港），巨行星引力最强（弹弓主目标）。
 */
export function createWorld(rand: () => number = Math.random): World {
  const j = (amp: number) => (rand() * 2 - 1) * amp;
  const planets: Planet[] = [
    makePlanet("star", "恒星", 2600, 1800, 70, 0, "star", 48, 0, 0, 0, 0),
    makePlanet("giant", "泰坦", 2760, 1420, 46, 2.4e7, "giant", 27, j(0.04), j(0.05), j(0.08), j(0.06)),
    makePlanet("base-a", "曙光站", 700, 750, 22, 3.5e6, "base", 150, j(0.04), j(0.05), j(0.08), j(0.06)),
    makePlanet("base-b", "天枢站", 4520, 3020, 20, 3e6, "base", 155, j(0.04), j(0.05), j(0.08), j(0.06)),
    makePlanet("base-c", "远征站", 760, 3080, 20, 3e6, "base", 160, j(0.04), j(0.05), j(0.08), j(0.06)),
    makePlanet("p1", "祝融", 1500, 1750, 30, 1.2e7, "normal", 8, j(0.05), j(0.05), j(0.08), j(0.07)),
    makePlanet("p2", "羲和", 3980, 1320, 26, 9e6, "normal", 195, j(0.05), j(0.05), j(0.08), j(0.07)),
    makePlanet("p3", "望舒", 2400, 2650, 32, 1.4e7, "normal", 275, j(0.05), j(0.05), j(0.08), j(0.07)),
    makePlanet("p4", "紫电", 3450, 2200, 24, 8e6, "normal", 260, j(0.05), j(0.05), j(0.08), j(0.07)),
    makePlanet("p5", "玄晖", 1300, 2500, 22, 7e6, "normal", 320, j(0.05), j(0.05), j(0.08), j(0.07)),
  ];
  return { width: SLINGSHOT_PARAMS.worldWidth, height: SLINGSHOT_PARAMS.worldHeight, planets, startBaseId: "base-a" };
}

export function planetById(world: World, id: string): Planet | undefined {
  return world.planets.find((p) => p.id === id);
}

/** 初始飞船：停靠在出发基地右侧 210px，向东缓行 */
export function createShip(world: World, params: SlingshotParams, rand: () => number = Math.random): Ship {
  const base = planetById(world, world.startBaseId);
  const bx = base ? base.x : 700;
  const by = base ? base.y : 750;
  return {
    x: bx + 210,
    y: by + (rand() * 2 - 1) * 40,
    vx: 260,
    vy: (rand() * 2 - 1) * 40,
    angle: 0,
    spin: 0,
    energy: params.energyStart,
    invuln: 0,
  };
}

/**
 * 取下一站基地：优先「最久未抵达」的基地（未访问过最优），
 * 同优先级取距当前基地最远者。保证三座基地轮转不偏废。
 */
export function pickNextDest(world: World, visitedOrder: string[]): string {
  const lastId = visitedOrder[visitedOrder.length - 1];
  const last = planetById(world, lastId);
  const recency = new Map<string, number>();
  visitedOrder.forEach((id, i) => recency.set(id, i));
  let bestId = lastId;
  let bestScore = -Infinity;
  for (const p of world.planets) {
    if (p.kind !== "base" || p.id === lastId) continue;
    const r = recency.has(p.id) ? recency.get(p.id)! : -1;
    const d = last ? Math.hypot(p.x - last.x, p.y - last.y) : 0;
    const score = -r * 1e9 + d;
    if (score > bestScore) {
      bestScore = score;
      bestId = p.id;
    }
  }
  return bestId;
}

/** 新建一局（IDLE 预览 / 重开共用） */
export function createRun(rand: () => number = Math.random): { world: World; run: RunState } {
  const world = createWorld(rand);
  const run: RunState = {
    phase: "idle",
    ship: createShip(world, SLINGSHOT_PARAMS, rand),
    meteors: [],
    distancePx: 0,
    time: 0,
    nextDestId: "",
    visitedOrder: [world.startBaseId],
    baseReached: 0,
    slingshots: 0,
    energyZeroFired: false,
    inWell: {},
    inAtmo: false,
    wasInRefuel: {},
    meteorTimer: SLINGSHOT_PARAMS.meteorInterval0,
    rand,
  };
  run.nextDestId = pickNextDest(world, run.visitedOrder);
  return { world, run };
}

/** 速度（px/s） */
export function shipSpeed(s: Ship): number {
  return Math.hypot(s.vx, s.vy);
}

/**
 * 推进一帧（半隐式欧拉）。原地修改 run；反馈事件写入 events。
 * 顺序：推进 → 引力 → 大气层 → 补给/抵达 → 陨石生成与碰撞 → 距离 → 能源归零。
 */
export function stepSim(
  run: RunState,
  input: EngineInput,
  world: World,
  params: SlingshotParams,
  dt: number,
  events: GameEvent[],
): void {
  const ship = run.ship;
  run.time += dt;

  // ── 推进（点火消耗能源；能源为 0 熄火） ──
  let active = input;
  if (ship.energy > 0) {
    const burn =
      (active.main ? params.burnMain : 0) +
      (active.retro ? params.burnRetro : 0) +
      (active.left || active.right ? params.burnRcs : 0);
    ship.energy = Math.max(0, ship.energy - burn * dt);
    if (ship.energy <= 0) active = NO_ENGINES;
  } else {
    active = NO_ENGINES;
  }

  const cosA = Math.cos(ship.angle);
  const sinA = Math.sin(ship.angle);
  let ax = 0;
  let ay = 0;
  if (active.main) {
    ax += params.thrustMain * cosA;
    ay += params.thrustMain * sinA;
  }
  if (active.retro) {
    ax -= params.thrustRetro * cosA;
    ay -= params.thrustRetro * sinA;
  }
  if (active.left) ship.spin -= params.turnRate * dt; // 逆时针
  if (active.right) ship.spin += params.turnRate * dt; // 顺时针

  // ── 引力（所有行星，恒星无质量） ──
  for (const p of world.planets) {
    if (p.gm <= 0) continue;
    const dx = p.x - ship.x;
    const dy = p.y - ship.y;
    const r2 = dx * dx + dy * dy;
    const r = Math.max(Math.sqrt(r2), p.radius * 0.55);
    const a = p.gm / (r * r);
    ax += (dx / r) * a;
    ay += (dy / r) * a;
  }

  ship.vx += ax * dt;
  ship.vy += ay * dt;
  ship.spin -= ship.spin * params.spinDamping * dt;
  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;
  ship.angle += ship.spin * dt;
  if (ship.invuln > 0) ship.invuln = Math.max(0, ship.invuln - dt);

  // ── 世界边界（软约束，避免飞船丢失） ──
  const m = 40;
  if (ship.x < m) { ship.x = m; if (ship.vx < 0) ship.vx = -ship.vx * 0.5; }
  else if (ship.x > world.width - m) { ship.x = world.width - m; if (ship.vx > 0) ship.vx = -ship.vx * 0.5; }
  if (ship.y < m) { ship.y = m; if (ship.vy < 0) ship.vy = -ship.vy * 0.5; }
  else if (ship.y > world.height - m) { ship.y = world.height - m; if (ship.vy > 0) ship.vy = -ship.vy * 0.5; }

  // ── 大气层 / 核心反弹 / 弹弓判定（逐行星） ──
  let inAtmo = false;
  let atmoDrainMax = 0;
  for (const p of world.planets) {
    if (p.kind === "star") continue;
    const d = Math.hypot(p.x - ship.x, p.y - ship.y);

    if (d < p.atmosphereR) {
      inAtmo = true;
      atmoDrainMax = Math.max(atmoDrainMax, params.atmoDrain);
    }

    // 核心反弹：触及核心半径（略小于表面）→ 弹性反弹 + 能源损失
    if (d < p.radius * 0.92) {
      const nx = (ship.x - p.x) / Math.max(d, 1e-6);
      const ny = (ship.y - p.y) / Math.max(d, 1e-6);
      const vn = ship.vx * nx + ship.vy * ny;
      if (vn < 0) {
        ship.vx -= (1.6) * vn * nx;
        ship.vy -= (1.6) * vn * ny;
      }
      const push = p.radius * 0.94;
      ship.x = p.x + nx * push;
      ship.y = p.y + ny * push;
      if (ship.invuln <= 0) {
        ship.energy = Math.max(0, ship.energy - params.meteorHitLoss);
        ship.invuln = params.invuln;
        events.push({ type: "bounce", x: ship.x, y: ship.y });
      }
    }

    // 弹弓判定：进入/离开引力带，出带航向相对入带偏转 ≥ slingTurnDeg 计一次
    const trk = (run.inWell[p.id] = run.inWell[p.id] || { inside: false, angleIn: 0 });
    const velAngle = Math.atan2(ship.vy, ship.vx);
    if (d < p.wellR) {
      if (!trk.inside) {
        trk.inside = true;
        trk.angleIn = velAngle;
      }
    } else if (trk.inside) {
      trk.inside = false;
      const turn = Math.abs(normalizeAngle(velAngle - trk.angleIn));
      if (turn >= (params.slingTurnDeg * Math.PI) / 180) {
        run.slingshots += 1;
        events.push({
          type: "slingshot",
          x: ship.x,
          y: ship.y,
          turnDeg: Math.round((turn * 180) / Math.PI),
        });
      }
    }
  }

  // 大气层持续掉能（首次进入发告警事件）
  if (inAtmo && !run.inAtmo) {
    events.push({ type: "atmo_enter", x: ship.x, y: ship.y });
  }
  if (atmoDrainMax > 0 && ship.invuln <= 0) {
    ship.energy = Math.max(0, ship.energy - atmoDrainMax * dt);
  }
  run.inAtmo = inAtmo;

  // ── 补给 / 抵达 ──
  for (const p of world.planets) {
    if (p.kind !== "base") continue;
    const d = Math.hypot(p.x - ship.x, p.y - ship.y);
    const inside = d < p.refuelR;
    const was = run.wasInRefuel[p.id] || false;
    if (inside && !was) {
      // 抵达补给站：补满标记 + 切换下一站
      run.baseReached += 1;
      run.visitedOrder.push(p.id);
      run.nextDestId = pickNextDest(world, run.visitedOrder);
      events.push({ type: "base_arrived", x: ship.x, y: ship.y, name: p.name });
    }
    if (inside) {
      ship.energy = Math.min(1, ship.energy + params.refuelRate * dt);
      events.push({ type: "refuel", x: ship.x, y: ship.y, name: p.name });
    }
    run.wasInRefuel[p.id] = inside;
  }

  // ── 陨石生成与推进 ──
  run.meteorTimer -= dt;
  if (run.meteorTimer <= 0 && run.meteors.length < params.meteorCap) {
    run.meteorTimer = Math.max(
      params.meteorIntervalMin,
      params.meteorInterval0 * Math.max(0.35, 1 - run.time / params.meteorRampSec),
    );
    spawnMeteor(run, params);
  }
  for (const mt of run.meteors) {
    mt.x += mt.vx * dt;
    mt.y += mt.vy * dt;
  }
  run.meteors = run.meteors.filter(
    (mt) => Math.hypot(mt.x - ship.x, mt.y - ship.y) < 1350,
  );

  // ── 陨石碰撞（无敌窗口内免疫） ──
  for (let i = run.meteors.length - 1; i >= 0; i--) {
    const mt = run.meteors[i];
    const rr = params.shipRadius + mt.radius;
    if (dist2(mt.x, mt.y, ship.x, ship.y) < rr * rr) {
      if (ship.invuln <= 0) {
        ship.energy = Math.max(0, ship.energy - params.meteorHitLoss);
        ship.invuln = params.invuln;
        const dx = ship.x - mt.x;
        const dy = ship.y - mt.y;
        const dl = Math.hypot(dx, dy) || 1;
        ship.vx += (dx / dl) * params.knockback;
        ship.vy += (dy / dl) * params.knockback;
        events.push({ type: "meteor_hit", x: mt.x, y: mt.y });
      }
      run.meteors.splice(i, 1);
    }
  }

  // ── 距离（路径长度）与能源归零 ──
  run.distancePx += shipSpeed(ship) * dt;
  if (ship.energy <= 0 && !run.energyZeroFired) {
    ship.energy = 0;
    run.energyZeroFired = true;
    run.phase = "over";
  }
}

/** 生成一颗陨石：在飞船周围 560-720px 的随机方向，向随机方向漂移 */
function spawnMeteor(run: RunState, params: SlingshotParams): void {
  const a = run.rand() * Math.PI * 2;
  const d = 560 + run.rand() * 160;
  const dir = run.rand() * Math.PI * 2;
  const spd = 40 + run.rand() * 80;
  run.meteors.push({
    x: run.ship.x + Math.cos(a) * d,
    y: run.ship.y + Math.sin(a) * d,
    vx: Math.cos(dir) * spd,
    vy: Math.sin(dir) * spd,
    radius: 7 + run.rand() * 9,
  });
}

/** 轨迹预测：按当前输入（含引力与推力，不含耗能）积分出未来位置点 */
export function predictPath(
  ship: Ship,
  input: EngineInput,
  world: World,
  params: SlingshotParams,
  seconds: number,
  steps: number,
): Array<{ x: number; y: number }> {
  const s: Ship = { ...ship, vx: ship.vx, vy: ship.vy, angle: ship.angle, spin: ship.spin };
  const dt = seconds / steps;
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < steps; i++) {
    const cosA = Math.cos(s.angle);
    const sinA = Math.sin(s.angle);
    let ax = 0;
    let ay = 0;
    if (input.main) {
      ax += params.thrustMain * cosA;
      ay += params.thrustMain * sinA;
    }
    if (input.retro) {
      ax -= params.thrustRetro * cosA;
      ay -= params.thrustRetro * sinA;
    }
    if (input.left) s.spin -= params.turnRate * dt;
    if (input.right) s.spin += params.turnRate * dt;
    for (const p of world.planets) {
      if (p.gm <= 0) continue;
      const dx = p.x - s.x;
      const dy = p.y - s.y;
      const r = Math.max(Math.sqrt(dx * dx + dy * dy), p.radius * 0.55);
      const a = p.gm / (r * r);
      ax += (dx / r) * a;
      ay += (dy / r) * a;
    }
    s.vx += ax * dt;
    s.vy += ay * dt;
    s.spin -= s.spin * params.spinDamping * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.angle += s.spin * dt;
    pts.push({ x: s.x, y: s.y });
  }
  return pts;
}
