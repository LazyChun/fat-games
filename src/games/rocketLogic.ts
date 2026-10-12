/*
 * 星舰回收（Starship Recovery）纯逻辑
 *
 * 不依赖 DOM / React，便于 vitest 单元测试：
 *   - 刚体物理：重力 + 上/下/左/右四个喷口反推（线性推力 + 侧喷口扭矩）
 *   - 落地判定：触地部分是否为尾喷口、是否在着陆点内、速度 / 姿态是否合格
 *   - 波次参数：越靠后初始下落速度越快、可用燃料越少
 *
 * 坐标系：屏幕坐标（x 向右，y 向下）；角度 0 表示机头朝上（尾喷口朝下），
 * 正角度为顺时针。控制模型采用「按键方向 = 喷口位置 = 牛顿反作用力」：
 *   - 点火左喷口（喷口朝左喷气）→ 反作用力使机头向右摆（顺时针）
 *   - 点火右喷口（喷口朝右喷气）→ 反作用力使机头向左摆（逆时针）
 * 侧喷口为纯转向 RCS：只产生扭矩，不产生横向平移（见 ROCKET_PARAMS）。
 */

export type EngineId = "up" | "down" | "left" | "right";

/** 四个喷口的点火输入 */
export type EngineInput = Record<EngineId, boolean>;

export const NO_ENGINES: EngineInput = {
  up: false,
  down: false,
  left: false,
  right: false,
};

export interface RocketState {
  /** 质心 x（px） */
  x: number;
  /** 质心 y（px，屏幕坐标，向下为正） */
  y: number;
  /** 水平速度（px/s） */
  vx: number;
  /** 垂直速度（px/s，向下为正） */
  vy: number;
  /** 姿态角（rad），0 = 机头朝上（尾朝下），正值为顺时针 */
  angle: number;
  /** 角速度（rad/s），正值顺时针 */
  spin: number;
  /** 燃料（0..1） */
  fuel: number;
}

/** 世界 / 场地 */
export interface RocketWorld {
  width: number;
  height: number;
  /** 地面 y 坐标（着陆平台顶面） */
  groundY: number;
  /** 着陆点中心 x */
  padX: number;
  /** 着陆点半宽 */
  padHalfWidth: number;
}

/** 物理参数（全部可调，供调参） */
export interface RocketParams {
  /** 重力加速度（px/s^2，向下为正） */
  gravity: number;
  /** 尾喷口（下喷口）线性推力加速度（px/s^2） */
  thrustDown: number;
  /** 顶喷口（上喷口）线性推力加速度（px/s^2） */
  thrustUp: number;
  /** 侧喷口线性推力加速度（px/s^2） */
  thrustSide: number;
  /** 侧喷口扭矩（rad/s^2），左喷口为正（顺时针）、右喷口为负（逆时针） */
  torqueSide: number;
  /** 角速度阻尼系数（1/s） */
  spinDamping: number;
  /** 各喷口每秒燃料消耗（燃料占比 / s） */
  burnDown: number;
  burnUp: number;
  burnSide: number;
  /** 质心到机头 / 机尾的距离（px） */
  halfLen: number;
  /** 质心到侧壁的距离（px） */
  halfWid: number;
  /** 着陆允许的最大触地速度（px/s，按尾端合速度） */
  maxLandingSpeed: number;
  /** 着陆允许的最大倾斜角（rad） */
  maxTilt: number;
  /** 着陆允许的最大角速度（rad/s） */
  maxSpin: number;
}

/**
 * 默认参数（与 UI 画布 560x760 配套）
 *
 * 控制模型：侧喷口为纯转向 RCS（只产生扭矩，不产生横向平移）；
 * 横向平移通过「略微倾斜机身 + 点火下喷口」实现（推力沿机头方向）。
 */
export const ROCKET_PARAMS: RocketParams = {
  gravity: 240,
  thrustDown: 400,
  thrustUp: 280,
  thrustSide: 0,
  torqueSide: 1.3,
  spinDamping: 0.5,
  burnDown: 0.145,
  burnUp: 0.1,
  burnSide: 0.05,
  halfLen: 34,
  halfWid: 13,
  maxLandingSpeed: 140,
  maxTilt: 0.45,
  maxSpin: 0.5,
};

/** 默认世界 */
export function defaultWorld(): RocketWorld {
  return {
    width: 560,
    height: 760,
    groundY: 700,
    padX: 280,
    padHalfWidth: 70,
  };
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
  return { x: Math.sin(angle), y: -Math.cos(angle) };
}

/** 机身右侧方向（世界系单位向量） */
export function rightDir(angle: number): { x: number; y: number } {
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

/** 机尾端点世界坐标 */
export function tailWorld(s: RocketState, p: RocketParams): { x: number; y: number } {
  return {
    x: s.x - p.halfLen * Math.sin(s.angle),
    y: s.y + p.halfLen * Math.cos(s.angle),
  };
}

/** 机头端点世界坐标 */
export function noseWorld(s: RocketState, p: RocketParams): { x: number; y: number } {
  return {
    x: s.x + p.halfLen * Math.sin(s.angle),
    y: s.y - p.halfLen * Math.cos(s.angle),
  };
}

/** 尾端点合速度（刚体上该点的速度，px/s） */
export function tailSpeed(s: RocketState, p: RocketParams): number {
  const vx = s.vx - s.spin * p.halfLen * Math.cos(s.angle);
  const vy = s.vy - s.spin * p.halfLen * Math.sin(s.angle);
  return Math.hypot(vx, vy);
}

/** 推进一帧（半隐式欧拉），原地修改状态 */
export function stepRocket(
  s: RocketState,
  engines: EngineInput,
  world: RocketWorld,
  p: RocketParams,
  dt: number,
): void {
  // 燃料：点火即消耗；燃料耗尽立即熄火
  let active = engines;
  if (s.fuel > 0) {
    const burn =
      (active.down ? p.burnDown : 0) +
      (active.up ? p.burnUp : 0) +
      (active.left ? p.burnSide : 0) +
      (active.right ? p.burnSide : 0);
    s.fuel = Math.max(0, s.fuel - burn * dt);
    if (s.fuel <= 0) active = NO_ENGINES;
  } else {
    active = NO_ENGINES;
  }

  const sinA = Math.sin(s.angle);
  const cosA = Math.cos(s.angle);
  const u = { x: sinA, y: -cosA }; // 机头方向
  const r = { x: cosA, y: sinA }; // 机身右侧

  let ax = 0;
  let ay = p.gravity;
  let aspin = 0;
  if (active.down) {
    ax += p.thrustDown * u.x;
    ay += p.thrustDown * u.y;
  }
  if (active.up) {
    ax -= p.thrustUp * u.x;
    ay -= p.thrustUp * u.y;
  }
  if (active.left) {
    ax += p.thrustSide * r.x;
    ay += p.thrustSide * r.y;
    aspin += p.torqueSide;
  }
  if (active.right) {
    ax -= p.thrustSide * r.x;
    ay -= p.thrustSide * r.y;
    aspin -= p.torqueSide;
  }

  s.vx += ax * dt;
  s.vy += ay * dt;
  s.spin += aspin * dt;
  s.spin -= s.spin * p.spinDamping * dt;
  s.x += s.vx * dt;
  s.y += s.vy * dt;
  s.angle += s.spin * dt;

  applyWorldBounds(s, world, p);
}

/** 世界边界：左右墙体反弹，顶部限制不可飞出视野 */
export function applyWorldBounds(s: RocketState, world: RocketWorld, p: RocketParams): void {
  const left = s.x - p.halfWid * Math.cos(s.angle);
  const right = s.x + p.halfWid * Math.cos(s.angle);
  if (left < 0) {
    s.x += 0 - left;
    if (s.vx < 0) s.vx = -s.vx * 0.5;
  } else if (right > world.width) {
    s.x -= right - world.width;
    if (s.vx > 0) s.vx = -s.vx * 0.5;
  }
  const noseY = s.y - p.halfLen * Math.cos(s.angle);
  if (noseY < 10) {
    s.y += 10 - noseY;
    if (s.vy < 0) s.vy = 0;
  }
}

/** 落地判定结果 */
export type LandingResult = "air" | "landed" | "crashed";

export interface LandingVerdict {
  result: LandingResult;
  /** 坠毁原因（仅 crashed） */
  reason?: "off-pad" | "fast" | "tilt" | "spin" | "wrong-part";
  impactSpeed?: number;
  tilt?: number;
  onPad?: boolean;
}

/**
 * 落地判定：取火箭四个端点（机头/左右翼/机尾）中最低的一点，
 * 触地部位不是机尾则直接坠毁；触地部位是机尾时按
 * 着陆点内 + 低速 + 姿态正 + 角速度小 判定成功。
 */
export function evaluateLanding(
  s: RocketState,
  world: RocketWorld,
  p: RocketParams,
): LandingVerdict {
  const points: Array<{ id: string; y: number }> = [
    { id: "nose", y: noseWorld(s, p).y },
    { id: "left", y: s.y - p.halfWid * Math.sin(s.angle) },
    { id: "right", y: s.y + p.halfWid * Math.sin(s.angle) },
    { id: "tail", y: tailWorld(s, p).y },
  ];
  const deepest = points.reduce((a, b) => (b.y > a.y ? b : a));
  if (deepest.y < world.groundY) return { result: "air" };

  if (deepest.id !== "tail") {
    return { result: "crashed", reason: "wrong-part" };
  }

  const impactSpeed = tailSpeed(s, p);
  const tilt = Math.abs(normalizeAngle(s.angle));
  const onPad = Math.abs(tailWorld(s, p).x - world.padX) <= world.padHalfWidth;

  const verdict: LandingVerdict = {
    result: "crashed",
    impactSpeed,
    tilt,
    onPad,
  };
  if (!onPad) {
    verdict.reason = "off-pad";
  } else if (impactSpeed > p.maxLandingSpeed) {
    verdict.reason = "fast";
  } else if (tilt > p.maxTilt) {
    verdict.reason = "tilt";
  } else if (Math.abs(s.spin) > p.maxSpin) {
    verdict.reason = "spin";
  } else {
    verdict.result = "landed";
  }
  return verdict;
}

/** 第 N 波的初始参数：下落更快、燃料更少（带下限） */
export function waveParams(wave: number): { vy0: number; fuel: number } {
  const vy0 = Math.min(260, 35 + (wave - 1) * 32);
  const fuel = Math.max(0.3, 1 - (wave - 1) * 0.085);
  return { vy0, fuel };
}

/** 生成一发新的星舰（初始姿态 / 水平速度随机扰动，横向偏移较小） */
export function spawnRocket(
  wave: number,
  world: RocketWorld,
  rand: () => number = Math.random,
): RocketState {
  const { vy0, fuel } = waveParams(wave);
  return {
    x: world.padX + (rand() * 2 - 1) * world.width * 0.1,
    y: 120,
    vx: (rand() * 2 - 1) * 25,
    vy: vy0,
    angle: (rand() * 2 - 1) * 0.2,
    spin: (rand() * 2 - 1) * 0.3,
    fuel,
  };
}

/** 单次成功着陆得分：基础分 + 剩余燃料奖励 + 落点精度奖励 + 触地速度奖励 */
export function landingScore(
  fuelLeft: number,
  impactSpeed: number,
  tailX: number,
  padX: number,
  padHalfWidth: number,
  maxLandingSpeed: number,
): number {
  const base = 100;
  const fuelBonus = Math.round(fuelLeft * 100);
  const distRatio = Math.min(1, Math.abs(tailX - padX) / padHalfWidth);
  const precisionBonus = Math.round(60 * (1 - distRatio));
  const speedRatio = Math.min(1, impactSpeed / maxLandingSpeed);
  const speedBonus = Math.round(40 * (1 - speedRatio));
  return base + fuelBonus + precisionBonus + speedBonus;
}
