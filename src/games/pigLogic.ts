/*
 * pigLogic：猪猪的远望（飞行距离小游戏）纯逻辑
 *
 * 核心玩法：小猪坐在悬崖边的弹弓上，玩家按住向后下方拖拽蓄力
 * （向左下拖 → 向右上射），松开把小猪弹射出去。重力 + 随机风力
 * 影响抛物线；空中云朵碰到后会把小猪再向上托一把（短暂滑翔）；
 * 地面金币碰到加分。落地后小猪在草地上摩擦滚停，按「落点距发射点
 * 的水平距离（米）」计分。共 5 次投掷机会，取最远一次为成绩。
 *
 * 本模块不依赖 DOM / React，全部逻辑可用 vitest 确定性单测。
 */

export interface Vec2 {
  x: number;
  y: number;
}

export const PIG = {
  /** 画布尺寸 */
  W: 760,
  H: 460,
  /** 右侧平原地面线 */
  GROUND: 380,
  /** 悬崖高台：x < CLIFF_END 时地面在 CLIFF_TOP */
  CLIFF_END: 140,
  CLIFF_TOP: 330,
  /** 弹弓锚点（小猪屁股位置） */
  SLING: { x: 100, y: 316 } as Vec2,
  /** 小猪半径 */
  pigR: 16,
  /** 重力 px/s^2 */
  gravity: 900,
  /** 发射速度下限 / 上限 px/s */
  minPower: 200,
  maxPower: 640,
  /** 拖拽最大有效距离 px */
  dragMax: 200,
  /** 云朵半径 */
  cloudR: 26,
  /** 云朵碰到后的向上冲量 px/s */
  cloudBoost: -380,
  /** 云朵托举期间（ms）重力减半 */
  cloudFloatMs: 520,
  /** 金币半径 */
  coinR: 10,
  /** 每枚金币分 */
  coinScore: 25,
  /** 落地摩擦（vx 每毫秒乘的衰减率，按 60fps 校准约 0.94/帧） */
  rollingDrag: 0.0028,
  /** 速度低于此值视为滚停 px/s */
  stopSpeed: 12,
  /** 投掷次数 */
  tosses: 5,
  /** 结算后停留 ms 自动进入下一次 */
  settleMs: 1400,
  /** 像素 → 米换算（10px = 1m） */
  pxPerMeter: 10,
  /** 风力基准 / 每局随机幅度 px/s^2 */
  windBase: 0,
  windJitter: 110,
} as const;

export type Phase = "idle" | "ready" | "flying" | "rolling" | "settled" | "over";

export interface Cloud {
  x: number;
  y: number;
  bounced: boolean;
}

export interface Coin {
  x: number;
  y: number;
  taken: boolean;
}

export interface PigBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  /** 云朵托举剩余 ms */
  floatLeft: number;
}

export type GameEvent =
  | { type: "launch" }
  | { type: "cloud"; x: number; y: number }
  | { type: "coin"; x: number; y: number; score: number }
  | { type: "land"; x: number; y: number }
  | { type: "settle"; x: number; y: number; distM: number }
  | { type: "nextToss"; toss: number }
  | { type: "over" };

export interface World {
  phase: Phase;
  time: number;
  toss: number;
  tossesLeft: number;
  wind: number;
  pig: PigBody;
  clouds: Cloud[];
  coins: Coin[];
  lastDistM: number;
  bestDistM: number;
  coinsCollected: number;
  settleLeft: number;
}

/* ---------------- 工具 ---------------- */

/** 取 x 处的地面高度（悬崖高台 / 平原） */
export function groundYAt(x: number): number {
  return x < PIG.CLIFF_END ? PIG.CLIFF_TOP : PIG.GROUND;
}

/** 金币实际碰撞半径（视觉 10，判定放宽到 14，体感更宽容） */
const COIN_HIT_R = PIG.coinR + 4;
/** 云朵实际碰撞半径 */
const CLOUD_HIT_R = PIG.cloudR + 4;

/**
 * 线段扫掠检测：小猪从 (x1,y1) 沿直线飞到 (x2,y2)，
 * 判断这段轨迹是否切过圆心 (cx,cy)、半径 r 的圆。
 * 斜向高速时不会"从中间穿过去"。
 */
function segmentHitsCircle(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  cx: number,
  cy: number,
  r: number,
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((cx - x1) * dx + (cy - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const px = x1 + t * dx;
  const py = y1 + t * dy;
  return Math.hypot(px - cx, py - cy) < r;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function makeClouds(): Cloud[] {
  return [
    { x: rand(240, 360), y: rand(120, 200), bounced: false },
    { x: rand(420, 560), y: rand(150, 250), bounced: false },
    { x: rand(600, 720), y: rand(110, 200), bounced: false },
  ];
}

function makeCoins(): Coin[] {
  const arr: Coin[] = [];
  // 贴地金币：低空带（抛物线低抛/落地段能吃到）
  for (let i = 0; i < 3; i++) {
    arr.push({
      x: rand(200, 720),
      y: rand(PIG.GROUND - 44, PIG.GROUND - 16),
      taken: false,
    });
  }
  // 中空金币：抛物线上升/下降段穿过的高度，配合云朵带
  for (let i = 0; i < 3; i++) {
    arr.push({
      x: rand(200, 720),
      y: rand(180, 300),
      taken: false,
    });
  }
  return arr;
}

/* ---------------- 创建世界 ---------------- */

export function createWorld(): World {
  return {
    phase: "idle",
    time: 0,
    toss: 0,
    tossesLeft: PIG.tosses,
    wind: 0,
    pig: { x: PIG.SLING.x, y: PIG.SLING.y, vx: 0, vy: 0, rot: 0, floatLeft: 0 },
    clouds: [],
    coins: [],
    lastDistM: 0,
    bestDistM: 0,
    coinsCollected: 0,
    settleLeft: 0,
  };
}

/** 新一局开始：初始化风力 / 云 / 金币，小猪回到弹弓 */
export function startGame(w: World): void {
  w.phase = "ready";
  w.toss = 0;
  w.tossesLeft = PIG.tosses;
  w.bestDistM = 0;
  w.coinsCollected = 0;
  w.lastDistM = 0;
  setupToss(w);
}

/** 单次投掷前：随机风 / 云 / 金币，小猪回弹弓 */
export function setupToss(w: World): void {
  w.wind = PIG.windBase + rand(-PIG.windJitter, PIG.windJitter);
  w.clouds = makeClouds();
  w.coins = makeCoins();
  w.pig = {
    x: PIG.SLING.x,
    y: PIG.SLING.y,
    vx: 0,
    vy: 0,
    rot: 0,
    floatLeft: 0,
  };
  w.settleLeft = 0;
  if (w.phase !== "over") w.phase = "ready";
}

/* ---------------- 发射计算 ---------------- */

/**
 * 由拖拽向量求初速度：方向 = 锚点 - 手指（反向弹射），
 * 长度映射到 [minPower, maxPower]。
 */
export function computeLaunch(pointer: Vec2): { vx: number; vy: number } {
  const dx = PIG.SLING.x - pointer.x;
  const dy = PIG.SLING.y - pointer.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return { vx: 0, vy: 0 };
  const power = Math.min(PIG.maxPower, PIG.minPower + (len / PIG.dragMax) * (PIG.maxPower - PIG.minPower));
  return { vx: (dx / len) * power, vy: (dy / len) * power };
}

/** 拖拽时的弹道预览（按纯重力+风积分，不含云朵/金币） */
export function previewPath(w: World, launch: { vx: number; vy: number }): Vec2[] {
  const pts: Vec2[] = [];
  let x = PIG.SLING.x;
  let y = PIG.SLING.y;
  let vx = launch.vx;
  let vy = launch.vy;
  const dt = 1 / 60;
  for (let i = 0; i < 90; i++) {
    vy += PIG.gravity * dt;
    vx += w.wind * dt;
    x += vx * dt;
    y += vy * dt;
    if (y >= groundYAt(x) - PIG.pigR) {
      pts.push({ x, y: groundYAt(x) - PIG.pigR });
      break;
    }
    pts.push({ x, y });
  }
  return pts;
}

/** 松开 → 发射 */
export function startToss(w: World, launch: { vx: number; vy: number }): GameEvent[] {
  if (w.phase !== "ready") return [];
  w.pig.vx = launch.vx;
  w.pig.vy = launch.vy;
  w.phase = "flying";
  w.toss += 1;
  w.tossesLeft = Math.max(0, PIG.tosses - w.toss);
  return [{ type: "launch" }];
}

/* ---------------- 主步进 ---------------- */

export function stepWorld(w: World, dtMs: number): GameEvent[] {
  const ev: GameEvent[] = [];
  const dt = Math.min(0.05, dtMs / 1000);
  w.time += dtMs;

  if (w.phase === "flying") {
    const p = w.pig;
    // 拆成 4 个子步积分 + 线段扫掠检测：
    // 小猪高速时一帧能飞出 20+px，点碰撞会"跳过"金币/云朵；
    // 用每子步轨迹线段与圆求交，斜向擦边也能稳定吃到。
    const sub = 4;
    const sdt = dt / sub;
    for (let s = 0; s < sub; s++) {
      const prevX = p.x;
      const prevY = p.y;
      const g = p.floatLeft > 0 ? PIG.gravity * 0.35 : PIG.gravity;
      p.vy += g * sdt;
      p.vx += w.wind * sdt;
      p.x += p.vx * sdt;
      p.y += p.vy * sdt;
      p.rot += (p.vx / PIG.pigR) * sdt * 1.4;
      if (p.floatLeft > 0) p.floatLeft -= dtMs / sub;

      // 云朵（线段扫掠）
      for (const c of w.clouds) {
        if (c.bounced) continue;
        if (segmentHitsCircle(prevX, prevY, p.x, p.y, c.x, c.y, CLOUD_HIT_R + PIG.pigR)) {
          c.bounced = true;
          p.vy = PIG.cloudBoost;
          p.floatLeft = PIG.cloudFloatMs;
          ev.push({ type: "cloud", x: c.x, y: c.y });
        }
      }

      // 金币（线段扫掠）
      for (const cn of w.coins) {
        if (cn.taken) continue;
        if (segmentHitsCircle(prevX, prevY, p.x, p.y, cn.x, cn.y, COIN_HIT_R + PIG.pigR)) {
          cn.taken = true;
          w.coinsCollected += 1;
          ev.push({ type: "coin", x: cn.x, y: cn.y, score: PIG.coinScore });
        }
      }

      // 飞出右边界 → 拉回来停住（保底）
      if (p.x > PIG.W - PIG.pigR) {
        p.x = PIG.W - PIG.pigR;
        p.vx = 0;
      }

      // 落地
      const gy = groundYAt(p.x);
      if (p.y >= gy - PIG.pigR && p.vy > 0) {
        p.y = gy - PIG.pigR;
        p.vy = 0;
        w.phase = "rolling";
        ev.push({ type: "land", x: p.x, y: p.y });
        break;
      }
    }
  } else if (w.phase === "rolling") {
    const p = w.pig;
    // 摩擦衰减
    p.vx *= Math.exp(-PIG.rollingDrag * dtMs);
    p.x += p.vx * dt;
    p.rot += (p.vx / PIG.pigR) * dt * 1.4;
    // 滚到边界
    if (p.x > PIG.W - PIG.pigR) {
      p.x = PIG.W - PIG.pigR;
      p.vx = 0;
    }
    if (p.x < PIG.SLING.x) p.x = PIG.SLING.x;

    if (Math.abs(p.vx) < PIG.stopSpeed) {
      p.vx = 0;
      const distM = Math.max(0, (p.x - PIG.SLING.x) / PIG.pxPerMeter);
      w.lastDistM = distM;
      if (distM > w.bestDistM) w.bestDistM = distM;
      w.phase = "settled";
      w.settleLeft = PIG.settleMs;
      ev.push({ type: "settle", x: p.x, y: p.y, distM });
    }
  } else if (w.phase === "settled") {
    w.settleLeft -= dtMs;
    if (w.settleLeft <= 0) {
      if (w.toss >= PIG.tosses) {
        w.phase = "over";
        ev.push({ type: "over" });
      } else {
        setupToss(w);
        ev.push({ type: "nextToss", toss: w.toss + 1 });
      }
    }
  }

  return ev;
}

/** 最终落库分数 = 最远米数（整数），金币与投掷细节进 detail */
export function finalScore(w: World): number {
  return Math.round(w.bestDistM);
}
