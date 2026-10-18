/*
 * racingLogic：3D 赛车竞速纯逻辑（不依赖 DOM，便于 vitest 单测）
 *
 * 赛道采用 OutRun 式伪 3D 公路：赛道由一段段平面分段构成，渲染时按
 * 「1 / 深度」的透视投影把每段映射到屏幕，弯道通过逐段累积的横向偏移
 * 表达——这是真正的透视投影（近大远小、随距离收敛到地平线）。
 *
 * 本文件只放纯函数：赛道生成、透视投影、玩家物理（加速/刹车/转向/
 * 离心/草地惩罚）、AI 对手车（巡航 + 变道）、碰撞、圈数与成绩换算。
 */

/* ------------------------------------------------------------------ */
/* 常量                                                               */
/* ------------------------------------------------------------------ */

export const SEG_LEN = 2; // 每段长度（米）
export const TRACK_SEGS = 1400; // 单圈段数
export const TRACK_METERS = TRACK_SEGS * SEG_LEN; // 单圈 2800 米
export const TOTAL_LAPS = 3; // 目标圈数
export const TOTAL_METERS = TRACK_METERS * TOTAL_LAPS; // 全程 8400 米

export const ROAD_W = 18; // 路面宽度（米，双向多车道）
export const CAM_HEIGHT = 5.6; // 相机离地高度（米，车顶视角）
export const FOCAL = 1.1; // 透视焦距（约 49° 视场角）
export const DRAW_DIST = 210; // 可见段数
export const CAM_Z_OFF = 26; // 相机相对玩家车的看远偏移（米）
export const MIN_DEPTH = 2; // 小于该深度不投影（防近处飞点）

export const MAX_SPEED = 62; // 最高速度 m/s（约 223 km/h）
export const ACCEL = 16; // 油门加速度 m/s²
export const BRAKE = 30; // 刹车减速度 m/s²
export const DRAG = 3.4; // 松油门的自然阻力 m/s²
export const CENTRI = 0.012; // 离心系数（弯道把车往外甩，stepPlayer 内 ×10）
export const ROAD_CURB = 0.84; // 路肩起点（|x| 超过即压草地）
export const GRASS_DRAG = 12; // 压草地的额外阻力 m/s²
export const CAR_LEN = 4.6; // 车身长度（米，用于碰撞距离）
export const CAR_W = 1.9; // 车身宽度（米，用于碰撞横向阈值）
export const AI_COUNT = 6; // AI 对手车数量

/* ------------------------------------------------------------------ */
/* 基础工具                                                           */
/* ------------------------------------------------------------------ */

/** 确定性伪随机源（测试可复现） */
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

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 向 target 以 rate 速率逼近（一阶加速） */
export function accelerate(v: number, target: number, rate: number, dt: number): number {
  if (target > v) return Math.min(v + rate * dt, target);
  if (target < v) return Math.max(v - rate * dt, target);
  return v;
}

/** 环形里程最短距离（米） */
export function ringDist(a: number, b: number, meters: number): number {
  let d = Math.abs(a - b);
  if (d > meters / 2) d = meters - d;
  return d;
}

/* ------------------------------------------------------------------ */
/* 赛道                                                               */
/* ------------------------------------------------------------------ */

export interface RoadSeg {
  index: number;
  /** 本段横向偏移增量（米/段）：正 = 左弯（路向左偏） */
  curve: number;
}

/** 路边装饰（树/路灯），x 为相对路中心的横向偏移（米） */
export interface Roadside {
  kind: "tree" | "lamp";
  side: -1 | 1;
  x: number;
}

export interface Track {
  segs: RoadSeg[];
  rand: () => number;
}

/** 弯道模式 [起始段, 结束段, 每段曲率]；正值左弯、负值右弯，直道为 0 */
const CURVE_PATTERN: Array<[number, number, number]> = [
  [0, 60, 0],
  [60, 190, 0.05],
  [190, 320, 0],
  [320, 430, -0.06],
  [430, 560, 0],
  [560, 700, 0.07],
  [700, 820, 0],
  [820, 930, -0.09],
  [930, 1080, 0],
  [1080, 1190, 0.055],
  [1190, 1400, 0],
];

/** 生成环形赛道（曲率模式固定，保证每次开局同一赛道） */
export function buildTrack(seed = 7): Track {
  const segs: RoadSeg[] = [];
  for (let i = 0; i < TRACK_SEGS; i++) {
    let curve = 0;
    for (const [s, e, c] of CURVE_PATTERN) {
      if (i >= s && i < e) {
        curve = c;
        break;
      }
    }
    segs.push({ index: i, curve });
  }
  return { segs, rand: mulberry32(seed) };
}

/** 每个段独立哈希随机源（装饰确定性生成） */
function hashRnd(index: number): () => number {
  return mulberry32((index * 2654435761 + 1013904223) >>> 0);
}

/** 某段的确定性路边装饰（树或路灯），null 表示无装饰 */
export function roadsideAt(index: number): Roadside | null {
  const r = hashRnd(index);
  const roll = r();
  if (roll < 0.1) {
    const side: -1 | 1 = r() < 0.5 ? -1 : 1;
    const kind: "tree" | "lamp" = roll < 0.035 ? "lamp" : "tree";
    // 距路中心 11.5 ~ 15.5 米（路外 2.5 ~ 6.5 米）
    return { kind, side, x: ROAD_W / 2 + 2.5 + r() * 4 };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 投影                                                               */
/* ------------------------------------------------------------------ */

export interface ScreenPt {
  x: number;
  y: number;
  scale: number;
  depth: number;
}

/**
 * 世界坐标 → 屏幕坐标（真透视投影，1 / 深度缩放）。
 * cameraX/cameraZ 为相机位置（米），w 为画布宽，horizonY 为地平线屏幕 y。
 * 相机后方（深度过近）返回 null。
 */
export function project(
  worldX: number,
  worldZ: number,
  cameraX: number,
  cameraZ: number,
  w: number,
  horizonY: number,
): ScreenPt | null {
  const dz = worldZ - cameraZ;
  if (dz < MIN_DEPTH) return null;
  const scale = (FOCAL * w) / dz;
  return {
    x: w / 2 + (worldX - cameraX) * scale,
    y: horizonY + CAM_HEIGHT * scale,
    scale,
    depth: dz,
  };
}

/**
 * 遍历相机前方可见段，返回每段的透视几何（路中心相对横向偏移 relX 已含
 * 弯道累积）。供渲染层使用：seg → { dz, scale, y, leftScreenX, rightScreenX }。
 */
export interface SegView {
  seg: RoadSeg;
  /** 相对相机深度（米） */
  dz: number;
  scale: number;
  /** 路中心屏幕 x（未加相机横向偏移） */
  centerX: number;
  /** 该段投影屏幕 y（路面顶边） */
  y: number;
}

/**
 * 计算相机前方所有可见段的投影几何。
 * playerSeg 为玩家所在段下标，playerX 为玩家车道坐标（-1..1，用于相机横向跟随）。
 */
export function computeViews(
  track: Track,
  playerSeg: number,
  playerX: number,
  w: number,
  horizonY: number,
): SegView[] {
  const { segs } = track;
  const views: SegView[] = [];
  const cameraX = playerX * (ROAD_W / 2);
  let relX = 0; // 相对相机所在段的路中心横向偏移
  for (let n = 0; n <= DRAW_DIST; n++) {
    const idx = (playerSeg + n) % TRACK_SEGS;
    const seg = segs[idx];
    if (n > 0) relX += seg.curve;
    const dz = n * SEG_LEN + CAM_Z_OFF;
    if (dz < MIN_DEPTH) continue;
    const scale = (FOCAL * w) / dz;
    views.push({
      seg,
      dz,
      scale,
      centerX: w / 2 + (relX - cameraX) * scale,
      y: horizonY + CAM_HEIGHT * scale,
    });
  }
  return views;
}

/** 某段上的世界横向位置 → 屏幕坐标（相机偏移已含在 view 中） */
export function viewScreenX(view: SegView, worldX: number): number {
  return view.centerX + (worldX - 0) * view.scale;
}

/* ------------------------------------------------------------------ */
/* 玩家与 AI 车                                                        */
/* ------------------------------------------------------------------ */

export interface Car {
  /** 车道坐标：0 = 路中心，±0.84 路肩，±1 压草地 */
  x: number;
  /** 圈内里程（米，0..TRACK_METERS） */
  z: number;
  speed: number; // m/s
}

export interface PlayerCar extends Car {
  steer: number; // 当前转向输入 [-1,1]（车身倾斜用）
  crash: number; // 碰撞顿挫剩余时间（秒），>0 表示刚撞车
}

export interface AiCar extends Car {
  /** 巡航速度比例（相对玩家 MAX_SPEED） */
  cruise: number;
  /** 目标车道中心（-0.55 / 0 / 0.55） */
  laneX: number;
  /** 下次变道/变速的里程 */
  nextChangeZ: number;
  /** 车身配色下标（CAR_COLORS 索引） */
  colorIdx: number;
}

export interface RaceInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

/** 生成一辆 AI 车（lane -1/0/1 之一，巡航 0.62..0.86） */
export function spawnAiCar(rand: () => number, z: number): AiCar {
  const lane = Math.floor(rand() * 3) - 1; // -1 | 0 | 1
  return {
    x: lane * 0.55,
    z,
    speed: 0,
    cruise: 0.62 + rand() * 0.24,
    laneX: lane * 0.55,
    nextChangeZ: z + 220 + rand() * 500,
    colorIdx: Math.floor(rand() * CAR_COLORS.length),
  };
}

/**
 * 生成整支 AI 车队：按环道均匀铺开，并保证开局第一辆就在可视范围内
 * （约 170 米处），让玩家一出发就能看到对手车。
 */
export function spawnAiFleet(rand: () => number): AiCar[] {
  const ratios = [0.06, 0.18, 0.32, 0.5, 0.68, 0.84];
  const cars: AiCar[] = [];
  for (let i = 0; i < AI_COUNT; i++) {
    cars.push(spawnAiCar(rand, TRACK_METERS * ratios[i % ratios.length]));
  }
  return cars;
}

/**
 * AI 在场管理：掉队太远或领先太远（玩家看不见）的车，重新布置到玩家
 * 前方 450~900 米处（视野边缘），保证赛道上始终有对手车可追可超。
 */
export function respawnFarAi(car: AiCar, rand: () => number, playerZ: number): void {
  const d = ringDist(car.z, playerZ, TRACK_METERS);
  if (d <= 700) return;
  const lane = Math.floor(rand() * 3) - 1;
  car.z = (playerZ + 450 + rand() * 450) % TRACK_METERS;
  car.laneX = lane * 0.55;
  car.x = lane * 0.55;
  car.speed = Math.max(car.speed, 12);
  car.nextChangeZ = car.z + 220 + rand() * 500;
}

/** 玩家一帧物理（dt 秒；curve 为玩家所在段曲率，用于离心） */
export function stepPlayer(p: PlayerCar, input: RaceInput, curve: number, dt: number): void {
  // 油门 / 刹车 / 自然减速
  const target = input.up ? MAX_SPEED : input.down ? -MAX_SPEED * 0.3 : 0;
  const rate = input.up ? ACCEL : input.down ? BRAKE : DRAG;
  p.speed = accelerate(p.speed, target, rate, dt);
  p.speed = clamp(p.speed, -12, MAX_SPEED);

  // 转向：横移速度随车速增加，但封顶在 1.1（车道坐标/秒），
  // 保证从路中心到路肩约 1 秒、到草地外约 1.3 秒，可救回
  const steer = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const steerSpeed = clamp(0.35 + Math.abs(p.speed) * 0.011, 0.3, 1.1);
  p.x += steer * steerSpeed * dt * (p.speed >= 0 ? 1 : -1);
  p.steer = steer;

  // 离心：弯道把车往外甩（左弯 curve>0 → 甩向右侧 → x 增加）
  p.x += curve * Math.max(0, p.speed) * CENTRI * 10 * dt;

  // 压草地额外阻力
  if (Math.abs(p.x) > ROAD_CURB) p.speed -= GRASS_DRAG * dt;
  p.x = clamp(p.x, -1.4, 1.4);

  if (p.crash > 0) p.crash -= dt;
}

/** AI 车一帧：绕圈前进 + 巡航调速 + 偶尔变道 */
export function stepAi(car: AiCar, rand: () => number, dt: number): void {
  const target = car.cruise * MAX_SPEED * (0.9 + 0.2 * rand()); // 轻微速度起伏
  car.speed = accelerate(car.speed, target, 6, dt);
  car.z = (car.z + car.speed * dt) % TRACK_METERS;

  // 到达变道里程：随机换到相邻车道并重置下次变道
  if (car.z >= car.nextChangeZ) {
    const dir = rand() < 0.5 ? -1 : 1;
    const nextLane = clamp(Math.round(car.laneX / 0.55) + dir, -1, 1);
    car.laneX = nextLane * 0.55;
    car.nextChangeZ = car.z + 260 + rand() * 600;
    // 变道时略微提速/降速
    car.cruise = clamp(car.cruise + (rand() - 0.5) * 0.08, 0.58, 0.9);
  }
  // 平滑移向目标车道
  car.x = lerp(car.x, car.laneX, Math.min(1, 0.9 * dt));
}

/** 玩家与 AI 车碰撞判定（环形最短距离 + 横向阈值） */
export function detectCollision(p: Car, ai: Car): boolean {
  const dz = ringDist(p.z, ai.z, TRACK_METERS);
  return dz < CAR_LEN + 2 && Math.abs(p.x - ai.x) * (ROAD_W / 2) < CAR_W + 0.7;
}

/* ------------------------------------------------------------------ */
/* 圈数 / 成绩                                                         */
/* ------------------------------------------------------------------ */

export interface LapState {
  lap: number; // 当前圈（1 起）
  prevZ: number;
  /** 本圈开始时刻（秒） */
  lapStartSec: number;
  bestLapSec: number | null;
  /** 本圈累计里程（用于开局第一圈从起点起算） */
  lastLapMeters: number;
}

export function newLapState(): LapState {
  return { lap: 1, prevZ: 0, lapStartSec: 0, bestLapSec: null, lastLapMeters: 0 };
}

/**
 * 推进圈数：z 回绕（接近总长后归零）即完成一圈。
 * 返回是否过线；过线时更新 bestLapSec 与 lapStartSec。
 */
export function advanceLap(st: LapState, z: number, nowSec: number): boolean {
  const crossed = st.prevZ > TRACK_METERS * 0.75 && z < TRACK_METERS * 0.25;
  st.prevZ = z;
  if (crossed) {
    const lapSec = nowSec - st.lapStartSec;
    if (st.bestLapSec === null || lapSec < st.bestLapSec) st.bestLapSec = lapSec;
    st.lap += 1;
    st.lapStartSec = nowSec;
  }
  return crossed;
}

/**
 * 成绩换算：平均速度 × 100（米/秒 → 分）。
 * 同一赛道用时越短分数越高，排行榜倒序天然成立。
 */
export function computeScore(totalMeters: number, timeSec: number): number {
  if (timeSec <= 0) return 1;
  return Math.max(1, Math.round((totalMeters / timeSec) * 100));
}

/** 速度 → 显示用 km/h */
export function kmh(speed: number): number {
  return Math.round(speed * 3.6);
}

/* ------------------------------------------------------------------ */
/* 车配色                                                             */
/* ------------------------------------------------------------------ */

export interface CarPalette {
  body: string;
  cabin: string;
  dark: string;
}

export const CAR_COLORS: CarPalette[] = [
  { body: "#ff5a4e", cabin: "#2b2f3e", dark: "#c33d33" },
  { body: "#4f8cff", cabin: "#22263a", dark: "#3763c2" },
  { body: "#ffb020", cabin: "#33301f", dark: "#c98a13" },
  { body: "#35d07f", cabin: "#1f3330", dark: "#1f9a5b" },
  { body: "#c07bff", cabin: "#2b2438", dark: "#8f4fd0" },
  { body: "#ff6fb5", cabin: "#33202e", dark: "#c94a8c" },
];
