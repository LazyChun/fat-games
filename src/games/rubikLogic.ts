/*
 * rubikLogic：3D 魔方核心纯逻辑（不依赖 DOM / React，便于 vitest 单测）
 *
 * 模型：
 *   - 3x3 魔方由 26 个可动块（cubie）组成，每个块用一个四元数 quat 表示
 *     其相对初始姿态的累计旋转，初始坐标为 origin（逻辑坐标，y 向上）。
 *   - 每个块当前的世界位置 = rotateVec(quat, origin)（仍在 {-1,0,1} 网格上）。
 *   - 一次层转动：选中轴上某一层（layer ∈ {-1,0,1}）的所有块，
 *     左乘一个 90° 四元数（dir=+1 为绕该轴正方向旋转）。
 *   - 贴纸颜色由块的「本地法向」决定：|origin · n| === 1 的面上才有贴纸，
 *     颜色只取决于该面属于哪个大面（+y 白、-y 黄、+z 绿、-z 蓝、+x 红、-x 橙）。
 *
 * 精度：转动后把四元数分量吸附到 90° 转动群的取值集合
 * （{0, ±0.5, ±√2/2, ±1/√3, ±1}），保证任意转动序列后姿态精确无漂移，
 * isSolved 可用等值判定。
 */

export type Vec3 = [number, number, number];
export interface Quat {
  w: number;
  x: number;
  y: number;
  z: number;
}

/** 逻辑坐标轴索引：0=x 1=y 2=z */
export type Axis = 0 | 1 | 2;
export type Layer = -1 | 0 | 1;
export type Dir = 1 | -1;

export interface Cubie {
  id: number;
  /** 初始网格坐标（{-1,0,1}³ 中除中心外） */
  origin: Vec3;
  /** 累计姿态四元数 */
  quat: Quat;
}

/* ------------------------------------------------------------------ */
/* 四元数基础                                                           */
/* ------------------------------------------------------------------ */

export const IDENTITY: Quat = { w: 1, x: 0, y: 0, z: 0 };

/** 四元数是否为单位元（±q 等价，带容差） */
export function isIdentity(q: Quat): boolean {
  return (
    Math.abs(Math.abs(q.w) - 1) < 1e-9 &&
    Math.abs(q.x) < 1e-9 &&
    Math.abs(q.y) < 1e-9 &&
    Math.abs(q.z) < 1e-9
  );
}

/** 绕单位轴旋转 angle 弧度 → 四元数 */
export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const half = angle / 2;
  const s = Math.sin(half);
  return { w: Math.cos(half), x: axis[0] * s, y: axis[1] * s, z: axis[2] * s };
}

/** 标准 Hamilton 四元数乘法 a ⊗ b */
export function quatMul(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y + a.y * b.w + a.z * b.x - a.x * b.z,
    z: a.w * b.z + a.z * b.w + a.x * b.y - a.y * b.x,
  };
}

/** 四元数旋转向量（标准公式 v + 2w(qv×v) + 2(qv×(qv×v))） */
export function rotateVec(q: Quat, v: Vec3): Vec3 {
  const [vx, vy, vz] = v;
  // t = qv × v
  const tx = q.y * vz - q.z * vy;
  const ty = q.z * vx - q.x * vz;
  const tz = q.x * vy - q.y * vx;
  // p = v + 2w·t
  const px = vx + 2 * q.w * tx;
  const py = vy + 2 * q.w * ty;
  const pz = vz + 2 * q.w * tz;
  // u = qv × t（注意是对 t 再叉积，不是对 p）
  const ux = q.y * tz - q.z * ty;
  const uy = q.z * tx - q.x * tz;
  const uz = q.x * ty - q.y * tx;
  return [px + 2 * ux, py + 2 * uy, pz + 2 * uz];
}

/** 四元数 → 轴角（[单位轴, 弧度]；单位元返回 [x 轴, 0]） */
export function quatToAxisAngle(q: Quat): [Vec3, number] {
  if (isIdentity(q)) return [[1, 0, 0], 0];
  const w = Math.min(1, Math.max(-1, q.w));
  const angle = 2 * Math.acos(w);
  const s = Math.sin(angle / 2);
  if (s < 1e-9) return [[1, 0, 0], 0];
  return [
    [q.x / s, q.y / s, q.z / s],
    angle,
  ];
}

/* ------------------------------------------------------------------ */
/* 90° 转动群吸附（防止浮点漂移）                                       */
/* ------------------------------------------------------------------ */

/*
 * 90° 面向转动群（八面体旋转群，24 个姿态）的四元数分量取值集合：
 *   {0, ±0.5, ±√2/2, ±1/√3, ±1}
 * 其中 ±1/√3 来自 180° 绕体对角线转动（例如 R U 的组合可到达）。
 * 转动后把分量吸附到该集合，保证任意序列后姿态精确无漂移。
 */
const SQRT1_3 = 1 / Math.sqrt(3);
const SNAP_SET = [
  0,
  0.5,
  -0.5,
  Math.SQRT1_2,
  -Math.SQRT1_2,
  SQRT1_3,
  -SQRT1_3,
  1,
  -1,
];

function snapComponent(v: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (const s of SNAP_SET) {
    const d = Math.abs(s - v);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

/** 把四元数吸附到 90° 转动群分量，保证后续判定精确 */
export function snapQuat(q: Quat): Quat {
  return {
    w: snapComponent(q.w),
    x: snapComponent(q.x),
    y: snapComponent(q.y),
    z: snapComponent(q.z),
  };
}

/* ------------------------------------------------------------------ */
/* 魔方状态                                                             */
/* ------------------------------------------------------------------ */

/** 26 个可动块的初始坐标（排除中心块） */
export const CUBIE_ORIGINS: Vec3[] = (() => {
  const list: Vec3[] = [];
  for (let x = -1; x <= 1; x++) {
    for (let y = -1; y <= 1; y++) {
      for (let z = -1; z <= 1; z++) {
        if (x === 0 && y === 0 && z === 0) continue;
        list.push([x, y, z]);
      }
    }
  }
  return list;
})();

/** 创建已还原的魔方（26 块） */
export function createCube(): Cubie[] {
  return CUBIE_ORIGINS.map((origin, i) => ({ id: i, origin, quat: { ...IDENTITY } }));
}

/** 块的当前世界位置（逻辑坐标，吸附到网格；+0 归一化去掉 -0） */
export function getWorldPos(c: Cubie): Vec3 {
  const [x, y, z] = rotateVec(c.quat, c.origin);
  return [Math.round(x) + 0, Math.round(y) + 0, Math.round(z) + 0];
}

/** 块上某本地法向 n 当前的世界法向（90° 群下仍为轴向） */
export function getWorldNormal(c: Cubie, n: Vec3): Vec3 {
  const [x, y, z] = rotateVec(c.quat, n);
  return [Math.round(x) + 0, Math.round(y) + 0, Math.round(z) + 0];
}

/* ------------------------------------------------------------------ */
/* 层转动                                                               */
/* ------------------------------------------------------------------ */

/**
 * 绕 axis 轴转动 layer 层（dir=+1 绕该轴正方向 90°）。
 * 只转动当前世界位置在 axis 轴上等于 layer 的块。
 */
export function applyMove(
  cube: Cubie[],
  axis: Axis,
  layer: Layer,
  dir: Dir,
): void {
  const r = quatFromAxisAngle(
    axis === 0 ? [1, 0, 0] : axis === 1 ? [0, 1, 0] : [0, 0, 1],
    dir * (Math.PI / 2),
  );
  for (const c of cube) {
    const p = getWorldPos(c);
    if (p[axis] !== layer) continue;
    c.quat = snapQuat(quatMul(r, c.quat));
  }
}

/* ------------------------------------------------------------------ */
/* 面向记号：U D L R F B（' 表示反向）                                  */
/* ------------------------------------------------------------------ */

export interface MoveSpec {
  /** 面向的名称（如 "U"、"R'"） */
  name: string;
  axis: Axis;
  layer: Layer;
  dir: Dir;
}

/**
 * 6 个基础面向：U/D/L/R/F/B 及其 ' 变体。
 * dir=+1 为绕该轴正方向旋转；此处约定的「顺时针」方向完全自洽：
 * U R F 为绕其外法向轴负方向转，D L B 为绕其外法向轴正方向转，
 * 任意面向与其 ' 互为逆操作。
 */
export const MOVE_DEFS: Record<string, MoveSpec> = {
  U: { name: "U", axis: 1, layer: 1, dir: -1 },
  D: { name: "D", axis: 1, layer: -1, dir: 1 },
  R: { name: "R", axis: 0, layer: 1, dir: -1 },
  L: { name: "L", axis: 0, layer: -1, dir: 1 },
  F: { name: "F", axis: 2, layer: 1, dir: -1 },
  B: { name: "B", axis: 2, layer: -1, dir: 1 },
};

/** 面向记号（如 "U"、"R'"）→ 转动参数；无法解析返回 null */
export function parseMove(move: string): MoveSpec | null {
  const m = move.trim();
  if (!m) return null;
  const base = m[0].toUpperCase();
  const def = MOVE_DEFS[base];
  if (!def) return null;
  if (m.length === 1) return { ...def, name: base };
  if (m[1] === "'") return { ...def, name: `${base}'`, dir: (def.dir * -1) as Dir };
  return null;
}

/** 按面向记号应用一次转动 */
export function applyMoveName(cube: Cubie[], move: string): void {
  const spec = parseMove(move);
  if (!spec) return;
  applyMove(cube, spec.axis, spec.layer, spec.dir);
}

/** 随机生成 n 个面向转动（默认随机源；传入 rng 可复现） */
export function randomMoves(n: number, rng: () => number = Math.random): string[] {
  const bases = Object.keys(MOVE_DEFS);
  const moves: string[] = [];
  for (let i = 0; i < n; i++) {
    const base = bases[Math.floor(rng() * bases.length)];
    const r = rng();
    moves.push(r < 0.5 ? base : `${base}'`);
  }
  return moves;
}

/** 在魔方上原地打乱 n 步，返回所用转动序列 */
export function scramble(cube: Cubie[], n = 20, rng?: () => number): string[] {
  const moves = randomMoves(n, rng);
  for (const m of moves) applyMoveName(cube, m);
  return moves;
}

/** 是否已还原（所有块姿态均为单位元） */
export function isSolved(cube: Cubie[]): boolean {
  return cube.every((c) => isIdentity(c.quat));
}

/* ------------------------------------------------------------------ */
/* 贴纸                                                               */
/* ------------------------------------------------------------------ */

/** 6 个本地法向 */
export const FACE_NORMALS: Vec3[] = [
  [0, 1, 0], // +y 顶
  [0, -1, 0], // -y 底
  [1, 0, 0], // +x 右
  [-1, 0, 0], // -x 左
  [0, 0, 1], // +z 前
  [0, 0, -1], // -z 后
];

/** 标准魔方配色（按本地法向 key "x,y,z"） */
export const FACE_COLORS: Record<string, string> = {
  "0,1,0": "#ffffff", // U 白
  "0,-1,0": "#ffd500", // D 黄
  "1,0,0": "#b71234", // R 红
  "-1,0,0": "#ff5800", // L 橙
  "0,0,1": "#009b48", // F 绿
  "0,0,-1": "#0046ad", // B 蓝
};

/** 块在本地法向 n 上是否有贴纸（位于该大面表面） */
export function hasSticker(c: Cubie, n: Vec3): boolean {
  const dot =
    c.origin[0] * n[0] + c.origin[1] * n[1] + c.origin[2] * n[2];
  return dot === 1;
}

/** 本地法向 → 贴纸颜色（不在表面的面返回空） */
export function stickerColor(c: Cubie, n: Vec3): string {
  if (!hasSticker(c, n)) return "";
  return FACE_COLORS[`${n[0]},${n[1]},${n[2]}`] || "";
}

/** 面向记号 → 外法向（用于界面命名与点击选层） */
export function moveOutwardNormal(name: string): Vec3 {
  const base = name[0].toUpperCase();
  const def = MOVE_DEFS[base];
  if (!def) return [0, 0, 0];
  const axis = def.axis;
  const sign = def.layer === 1 ? 1 : -1;
  return axis === 0 ? [sign, 0, 0] : axis === 1 ? [0, sign, 0] : [0, 0, sign];
}
