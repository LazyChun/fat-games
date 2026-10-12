/*
 * TankBattleGame：坦克对决（3D 战场）
 *
 * Canvas 软件渲染：真实透视投影绘制 3D 战场（草地 / 水塘 / 树林 / 墙体），
 * 玩家驾驶绿色坦克与多辆 AI 坦克对射，击毁全部敌军获胜。
 *   - W/S 或 ↑/↓ 前进 / 后退，A/D 或 ←/→ 转向车身
 *   - 鼠标移动瞄准炮塔，左键或空格开火
 *   - 水塘与树林无法通行，墙体可作掩体
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import { recordScore } from "../scoreClient";
import { useI18n } from "../hooks";
import GameFrame, {
  GhostBtn,
  CHIP_GOLD,
  CHIP_GREEN,
  CHIP_BLUE,
  CHIP_RED,
} from "./GameFrame";
import "./gameAnimations.less";

/* ------------------------------------------------------------------ */
/* 常量                                                                */
/* ------------------------------------------------------------------ */

const TILE = 56;
const COLS = 25;
const ROWS = 17;
const W = COLS * TILE; // 1400
const D = ROWS * TILE; // 952
const CW = 1120;
const CH = 700;
const WALL_H = 46;
const TREE_H = 92;
const BULLET_SPEED = 560;
const BULLET_RANGE = 700;
const SEE_RANGE = 620;

/* ------------------------------------------------------------------ */
/* 地图（程序化生成）：. 草地  # 墙体  ~ 水塘  T 树林                   */
/* ------------------------------------------------------------------ */

const TREES: Array<[number, number]> = [
  [1, 5], [1, 13], [1, 20], [3, 10], [3, 16], [4, 17], [5, 8], [5, 15],
  [5, 21], [7, 2], [8, 5], [8, 19], [10, 13], [10, 21], [12, 14], [14, 4],
  [15, 10], [15, 18],
];

const MAP: string[] = (() => {
  const g: string[][] = [];
  for (let r = 0; r < ROWS; r++) {
    const row: string[] = [];
    for (let c = 0; c < COLS; c++) {
      row.push(r === 0 || c === 0 || r === ROWS - 1 || c === COLS - 1 ? "#" : ".");
    }
    g.push(row);
  }
  const put = (r: number, c: number, ch: string) => {
    if (r > 0 && c > 0 && r < ROWS - 1 && c < COLS - 1) g[r][c] = ch;
  };
  // 水塘：左上 3x3、右上 3x2、左下 3x2
  for (const [r1, r2, c1, c2] of [
    [2, 4, 3, 5],
    [6, 7, 18, 20],
    [11, 12, 3, 5],
  ] as Array<[number, number, number, number]>) {
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) put(r, c, "~");
    }
  }
  // 墙体：三处竖墙 + 两处横墙，形成掩体与通道
  for (let r = 3; r <= 7; r++) put(r, 12, "#");
  for (let r = 9; r <= 13; r++) put(r, 16, "#");
  for (let r = 12; r <= 14; r++) put(r, 10, "#");
  for (let c = 5; c <= 7; c++) put(6, c, "#");
  for (let c = 8; c <= 10; c++) put(9, c, "#");
  // 树林
  for (const [r, c] of TREES) put(r, c, "T");
  return g.map((row) => row.join(""));
})();

function tileAt(x: number, z: number): string {
  const c = Math.max(0, Math.min(COLS - 1, Math.floor(x / TILE)));
  const r = Math.max(0, Math.min(ROWS - 1, Math.floor(z / TILE)));
  return MAP[r][c];
}

function solidMove(ch: string): boolean {
  return ch === "#" || ch === "T" || ch === "~";
}

function solidShot(ch: string): boolean {
  return ch === "#" || ch === "T";
}

/** 圆形 vs 地形碰撞 */
function collides(x: number, z: number, r: number): boolean {
  const c0 = Math.floor((x - r) / TILE);
  const c1 = Math.floor((x + r) / TILE);
  const r0 = Math.floor((z - r) / TILE);
  const r1 = Math.floor((z + r) / TILE);
  for (let rr = r0; rr <= r1; rr++) {
    for (let cc = c0; cc <= c1; cc++) {
      if (cc < 0 || cc >= COLS || rr < 0 || rr >= ROWS) return true;
      if (solidMove(MAP[rr][cc])) {
        const tcx = cc * TILE + TILE / 2;
        const tcz = rr * TILE + TILE / 2;
        const dx = Math.max(Math.abs(x - tcx) - TILE / 2, 0);
        const dz = Math.max(Math.abs(z - tcz) - TILE / 2, 0);
        if (dx * dx + dz * dz < r * r) return true;
      }
    }
  }
  return false;
}

/** 视线是否被墙体 / 树木阻挡 */
function losClear(x1: number, z1: number, x2: number, z2: number): boolean {
  const d = Math.hypot(x2 - x1, z2 - z1);
  const steps = Math.max(1, Math.ceil(d / 16));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const ch = tileAt(x1 + (x2 - x1) * t, z1 + (z2 - z1) * t);
    if (solidShot(ch)) return false;
  }
  return true;
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/* ------------------------------------------------------------------ */
/* 相机（透视投影）                                                     */
/* ------------------------------------------------------------------ */

interface Cam {
  ex: number;
  ey: number;
  ez: number;
  rx: number;
  ry: number;
  rz: number;
  ux: number;
  uy: number;
  uz: number;
  fx: number;
  fy: number;
  fz: number;
  f: number;
  cx: number;
  cy: number;
  ox: number;
  oy: number;
}

function buildCam(): Cam {
  const ex = W / 2;
  const ey = 880;
  const ez = D / 2 + 740;
  const lx = W / 2;
  const ly = 26;
  const lz = D / 2;
  let fdx = lx - ex;
  let fdy = ly - ey;
  let fdz = lz - ez;
  const fl = Math.hypot(fdx, fdy, fdz) || 1;
  fdx /= fl;
  fdy /= fl;
  fdz /= fl;
  // right = forward × up(0,1,0)
  let rdx = -fdz;
  let rdz = fdx;
  const rl = Math.hypot(rdx, rdz) || 1;
  rdx /= rl;
  rdz /= rl;
  // up = right × forward
  let udx = -rdz * fdy;
  let udy = rdz * fdx - rdx * fdz;
  let udz = rdx * fdy;
  const ul = Math.hypot(udx, udy, udz) || 1;
  udx /= ul;
  udy /= ul;
  udz /= ul;
  return {
    ex,
    ey,
    ez,
    rx: rdx,
    ry: 0,
    rz: rdz,
    ux: udx,
    uy: udy,
    uz: udz,
    fx: fdx,
    fy: fdy,
    fz: fdz,
    f: 1,
    cx: CW / 2,
    cy: CH / 2,
    ox: 0,
    oy: 0,
  };
}

interface P {
  x: number;
  y: number;
  zc: number;
  s: number;
}

function project(cam: Cam, x: number, y: number, z: number): P | null {
  const dx = x - cam.ex;
  const dy = y - cam.ey;
  const dz = z - cam.ez;
  const zc = dx * cam.fx + dy * cam.fy + dz * cam.fz;
  if (zc < 12) return null;
  const xc = dx * cam.rx + dy * cam.ry + dz * cam.rz;
  const yc = dx * cam.ux + dy * cam.uy + dz * cam.uz;
  const s = cam.f / zc;
  return { x: cam.cx + xc * s + cam.ox, y: cam.cy - yc * s + cam.oy, zc, s };
}

function unprojectGround(cam: Cam, sx: number, sy: number): { x: number; z: number } | null {
  const xc = (sx - cam.cx - cam.ox) / cam.f;
  const yc = -(sy - cam.cy - cam.oy) / cam.f;
  const dx = xc * cam.rx + yc * cam.ux + cam.fx;
  const dy = xc * cam.ry + yc * cam.uy + cam.fy;
  const dz = xc * cam.rz + yc * cam.uz + cam.fz;
  if (Math.abs(dy) < 1e-6) return null;
  const t = -cam.ey / dy;
  if (t <= 0) return null;
  return { x: cam.ex + dx * t, z: cam.ez + dz * t };
}

/** 根据战场范围自动取景：缩放焦距并居中 */
function fitCam(cam: Cam): void {
  const pts: Array<[number, number, number]> = [];
  const corners: Array<[number, number]> = [[0, 0], [W, 0], [0, D], [W, D]];
  for (const [x, z] of corners) pts.push([x, 0, z]);
  for (let c = 0; c <= COLS; c++) {
    pts.push([c * TILE, WALL_H, 0]);
    pts.push([c * TILE, WALL_H, D]);
  }
  for (let r = 0; r <= ROWS; r++) {
    pts.push([0, WALL_H, r * TILE]);
    pts.push([W, WALL_H, r * TILE]);
  }
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (MAP[r][c] === "T") {
        pts.push([c * TILE + TILE / 2, TREE_H, r * TILE + TILE / 2]);
      }
    }
  }
  const tmpF = CH;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [x, y, z] of pts) {
    const dx = x - cam.ex;
    const dy = y - cam.ey;
    const dz = z - cam.ez;
    const zc = dx * cam.fx + dy * cam.fy + dz * cam.fz;
    if (zc < 40) continue;
    const xc = dx * cam.rx + dy * cam.ry + dz * cam.rz;
    const yc = dx * cam.ux + dy * cam.uy + dz * cam.uz;
    const s = tmpF / zc;
    const sx = xc * s;
    const sy = -yc * s;
    if (sx < minX) minX = sx;
    if (sx > maxX) maxX = sx;
    if (sy < minY) minY = sy;
    if (sy > maxY) maxY = sy;
  }
  const bw = Math.max(maxX - minX, 1);
  const bh = Math.max(maxY - minY, 1);
  const f = tmpF * Math.min((CW * 0.84) / bw, (CH * 0.82) / bh);
  cam.f = f;
  let minX2 = Infinity;
  let maxX2 = -Infinity;
  let minY2 = Infinity;
  let maxY2 = -Infinity;
  for (const [x, y, z] of pts) {
    const dx = x - cam.ex;
    const dy = y - cam.ey;
    const dz = z - cam.ez;
    const zc = dx * cam.fx + dy * cam.fy + dz * cam.fz;
    if (zc < 40) continue;
    const xc = dx * cam.rx + dy * cam.ry + dz * cam.rz;
    const yc = dx * cam.ux + dy * cam.uy + dz * cam.uz;
    const s = f / zc;
    const sx = xc * s;
    const sy = -yc * s;
    if (sx < minX2) minX2 = sx;
    if (sx > maxX2) maxX2 = sx;
    if (sy < minY2) minY2 = sy;
    if (sy > maxY2) maxY2 = sy;
  }
  cam.ox = -(minX2 + maxX2) / 2;
  cam.oy = -(minY2 + maxY2) / 2;
}

/* ------------------------------------------------------------------ */
/* 实体                                                                */
/* ------------------------------------------------------------------ */

type EnemyType = "normal" | "scout" | "heavy";

interface Tank {
  kind: "player" | "enemy";
  type: EnemyType | "player";
  x: number;
  z: number;
  yaw: number;
  tyaw: number;
  hp: number;
  maxHp: number;
  speed: number;
  turn: number;
  dmg: number;
  fireCd: number;
  fireTimer: number;
  r: number;
  scale: number;
  score: number;
  alive: boolean;
  flash: number;
  recoil: number;
  muzzle: number;
  fireMin: number;
  fireMax: number;
  aimErr: number;
  aimBias: number;
  body: string;
  top: string;
  wanderT: number;
  wanderTx: number;
  wanderTz: number;
  stuck: number;
}

interface Bullet {
  x: number;
  z: number;
  y: number;
  vx: number;
  vz: number;
  owner: "player" | "enemy";
  dmg: number;
  life: number;
  ttl: number;
  dead: boolean;
  trail: Array<{ x: number; z: number }>;
}

interface Fx {
  kind: "spark" | "smoke" | "ring" | "flash" | "text";
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  ttl: number;
  size: number;
  color: string;
  text?: string;
}

interface Sim {
  state: "idle" | "running" | "paused" | "over";
  result: "win" | "lose" | null;
  time: number;
  player: Tank;
  enemies: Tank[];
  bullets: Bullet[];
  fx: Fx[];
  kills: number;
  recorded: boolean;
  cam: Cam;
  aim: { x: number; z: number } | null;
  lastTs: number;
}

interface Ui {
  hp: number;
  kills: number;
  left: number;
  state: Sim["state"];
  result: Sim["result"];
}

const ENEMY_CFG: Record<
  EnemyType,
  {
    hp: number;
    speed: number;
    turn: number;
    dmg: number;
    r: number;
    scale: number;
    score: number;
    fireMin: number;
    fireMax: number;
    aimErr: number;
    body: string;
    top: string;
  }
> = {
  normal: {
    hp: 100,
    speed: 104,
    turn: 2.0,
    dmg: 18,
    r: 19,
    scale: 1,
    score: 100,
    fireMin: 1.7,
    fireMax: 2.6,
    aimErr: 0.035,
    body: "#b34a4a",
    top: "#cf5c5c",
  },
  scout: {
    hp: 70,
    speed: 150,
    turn: 3.1,
    dmg: 12,
    r: 17,
    scale: 0.88,
    score: 80,
    fireMin: 1.3,
    fireMax: 2.1,
    aimErr: 0.06,
    body: "#c97f33",
    top: "#e09a45",
  },
  heavy: {
    hp: 160,
    speed: 74,
    turn: 1.6,
    dmg: 24,
    r: 23,
    scale: 1.18,
    score: 150,
    fireMin: 2.0,
    fireMax: 3.1,
    aimErr: 0.025,
    body: "#7d4fb8",
    top: "#9663d4",
  },
};

function makeTank(
  kind: "player" | "enemy",
  type: EnemyType | "player",
  x: number,
  z: number,
  yaw: number,
): Tank {
  const p = type === "player" ? null : ENEMY_CFG[type];
  const base = p
    ? p
    : {
        hp: 120,
        speed: 190,
        turn: 2.7,
        dmg: 42,
        r: 19,
        scale: 1,
        score: 0,
        fireMin: 0.5,
        fireMax: 0.5,
        aimErr: 0,
        body: "#4a8f52",
        top: "#5aa663",
      };
  return {
    kind,
    type,
    x,
    z,
    yaw,
    tyaw: yaw,
    hp: base.hp,
    maxHp: base.hp,
    speed: base.speed,
    turn: base.turn,
    dmg: base.dmg,
    fireCd: base.fireMin,
    fireTimer: 0,
    r: base.r,
    scale: base.scale,
    score: base.score,
    alive: true,
    flash: 0,
    recoil: 0,
    muzzle: 0,
    fireMin: base.fireMin,
    fireMax: base.fireMax,
    aimErr: base.aimErr,
    aimBias: 0,
    body: base.body,
    top: base.top,
    wanderT: 0,
    wanderTx: x,
    wanderTz: z,
    stuck: 0,
  };
}

function newSim(): Sim {
  const player = makeTank("player", "player", 7 * TILE + TILE / 2, 14 * TILE + TILE / 2, Math.PI);
  const spawns: Array<[EnemyType, number, number]> = [
    ["normal", 4 * TILE + TILE / 2, TILE + TILE / 2],
    ["normal", 10 * TILE + TILE / 2, TILE + TILE / 2],
    ["normal", 16 * TILE + TILE / 2, TILE + TILE / 2],
    ["heavy", 22 * TILE + TILE / 2, TILE + TILE / 2],
    ["normal", 20 * TILE + TILE / 2, 3 * TILE + TILE / 2],
    ["scout", 9 * TILE + TILE / 2, 6 * TILE + TILE / 2],
    ["scout", 22 * TILE + TILE / 2, 8 * TILE + TILE / 2],
    ["heavy", 7 * TILE + TILE / 2, 10 * TILE + TILE / 2],
  ];
  const enemies = spawns.map(([type, x, z]) => makeTank("enemy", type, x, z, 0));
  return {
    state: "idle",
    result: null,
    time: 0,
    player,
    enemies,
    bullets: [],
    fx: [],
    kills: 0,
    recorded: false,
    cam: buildCam(),
    aim: null,
    lastTs: 0,
  };
}

/* ------------------------------------------------------------------ */
/* 玩法逻辑                                                             */
/* ------------------------------------------------------------------ */

function slideMove(t: Tank, dx: number, dz: number): void {
  if (dx !== 0 && !collides(t.x + dx, t.z, t.r)) t.x += dx;
  if (dz !== 0 && !collides(t.x, t.z + dz, t.r)) t.z += dz;
}

function turnTowards(t: Tank, target: number, rate: number, dt: number): void {
  const diff = angleDiff(target, t.yaw);
  const step = rate * dt;
  if (Math.abs(diff) <= step) t.yaw = target;
  else t.yaw += Math.sign(diff) * step;
}

function aimTowards(t: Tank, target: number, rate: number, dt: number): void {
  const diff = angleDiff(target, t.tyaw);
  const step = rate * dt;
  if (Math.abs(diff) <= step) t.tyaw = target;
  else t.tyaw += Math.sign(diff) * step;
}

function spawnExplosion(sim: Sim, x: number, z: number, y: number, big: boolean): void {
  const fx = sim.fx;
  fx.push({
    kind: "ring",
    x,
    y: 2,
    z,
    px: x,
    py: 2,
    pz: z,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 0,
    ttl: 0.38,
    size: big ? 54 : 34,
    color: "#ff9f43",
  });
  fx.push({
    kind: "flash",
    x,
    y,
    z,
    px: x,
    py: y,
    pz: z,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 0,
    ttl: 0.16,
    size: big ? 42 : 26,
    color: "#fff3b0",
  });
  const sparks = big ? 20 : 12;
  const colors = ["#ffd75e", "#ff9f43", "#ff6b6b", "#fff3b0"];
  for (let i = 0; i < sparks; i++) {
    const ang = Math.random() * Math.PI * 2;
    const sp = 50 + Math.random() * (big ? 200 : 150);
    fx.push({
      kind: "spark",
      x,
      y,
      z,
      px: x,
      py: y,
      pz: z,
      vx: Math.cos(ang) * sp,
      vy: 30 + Math.random() * 90,
      vz: Math.sin(ang) * sp,
      life: 0,
      ttl: 0.3 + Math.random() * 0.35,
      size: 3 + Math.random() * 2.5,
      color: colors[Math.floor(Math.random() * colors.length)],
    });
  }
  const smoke = big ? 9 : 6;
  for (let i = 0; i < smoke; i++) {
    const ang = Math.random() * Math.PI * 2;
    fx.push({
      kind: "smoke",
      x,
      y,
      z,
      px: x,
      py: y,
      pz: z,
      vx: Math.cos(ang) * 26,
      vy: 18 + Math.random() * 26,
      vz: Math.sin(ang) * 26,
      life: 0,
      ttl: 0.7 + Math.random() * 0.6,
      size: 8 + Math.random() * 6,
      color: "#9a9a9a",
    });
  }
}

function spawnText(sim: Sim, x: number, z: number, y: number, text: string, color: string): void {
  sim.fx.push({
    kind: "text",
    x,
    y,
    z,
    px: x,
    py: y,
    pz: z,
    vx: 0,
    vy: 48,
    vz: 0,
    life: 0,
    ttl: 0.95,
    size: 17,
    color,
    text,
  });
}

function fireBullet(sim: Sim, t: Tank): void {
  const cd = t.kind === "player" ? t.fireCd : t.fireMin + Math.random() * (t.fireMax - t.fireMin);
  t.fireTimer = cd;
  t.recoil = 1;
  t.muzzle = 0.09;
  const bx = t.x + Math.sin(t.tyaw) * 30 * t.scale;
  const bz = t.z + Math.cos(t.tyaw) * 30 * t.scale;
  sim.bullets.push({
    x: bx,
    z: bz,
    y: 32,
    vx: Math.sin(t.tyaw) * BULLET_SPEED,
    vz: Math.cos(t.tyaw) * BULLET_SPEED,
    owner: t.kind,
    dmg: t.dmg,
    life: 0,
    ttl: BULLET_RANGE / BULLET_SPEED,
    dead: false,
    trail: [{ x: bx, z: bz }],
  });
}

function damageTank(sim: Sim, t: Tank, dmg: number, atX: number, atZ: number): void {
  t.hp -= dmg;
  t.flash = 0.16;
  spawnExplosion(sim, atX, atZ, 26, false);
  spawnText(sim, atX, atZ, 46, `-${dmg}`, "#ffd166");
  if (t.hp <= 0 && t.alive) {
    t.alive = false;
    spawnExplosion(sim, t.x, t.z, 14, true);
    if (t.kind === "enemy") {
      sim.kills += 1;
      spawnText(sim, t.x, t.z, 64, `+${t.score}`, "#7ee8a2");
    }
  }
}

function updateBullets(sim: Sim, dt: number): void {
  for (const b of sim.bullets) {
    b.life += dt;
    if (b.life >= b.ttl) {
      b.dead = true;
      continue;
    }
    const steps = Math.max(1, Math.ceil((BULLET_SPEED * dt) / 14));
    for (let i = 0; i < steps && !b.dead; i++) {
      b.x += (b.vx * dt) / steps;
      b.z += (b.vz * dt) / steps;
      if (solidShot(tileAt(b.x, b.z))) {
        spawnExplosion(sim, b.x, b.z, 20, false);
        b.dead = true;
        break;
      }
      if (b.owner === "player") {
        for (const e of sim.enemies) {
          if (!e.alive) continue;
          const dist = Math.hypot(b.x - e.x, b.z - e.z);
          if (dist < e.r + 5 && Math.abs(b.y - 30) < 42) {
            damageTank(sim, e, b.dmg, b.x, b.z);
            b.dead = true;
            break;
          }
        }
      } else {
        const p = sim.player;
        if (p.alive) {
          const dist = Math.hypot(b.x - p.x, b.z - p.z);
          if (dist < p.r + 5 && Math.abs(b.y - 30) < 42) {
            damageTank(sim, p, b.dmg, b.x, b.z);
            b.dead = true;
          }
        }
      }
    }
    if (!b.dead) {
      b.trail.push({ x: b.x, z: b.z });
      if (b.trail.length > 5) b.trail.shift();
    }
  }
  sim.bullets = sim.bullets.filter((b) => !b.dead);
}

function updatePlayer(sim: Sim, dt: number, keys: Set<string>): void {
  const p = sim.player;
  if (!p.alive) return;
  let move = 0;
  let turn = 0;
  if (keys.has("w") || keys.has("arrowup")) move += 1;
  if (keys.has("s") || keys.has("arrowdown")) move -= 1;
  if (keys.has("a") || keys.has("arrowleft")) turn -= 1;
  if (keys.has("d") || keys.has("arrowright")) turn += 1;
  p.yaw += turn * p.turn * dt;
  const dx = Math.sin(p.yaw) * move * p.speed * dt;
  const dz = Math.cos(p.yaw) * move * p.speed * dt;
  slideMove(p, dx, dz);
  // 炮塔：无鼠标目标时跟随车身方向
  const aimTarget = sim.aim
    ? Math.atan2(sim.aim.x - p.x, sim.aim.z - p.z)
    : p.yaw;
  aimTowards(p, aimTarget, 4.6, dt);
  p.fireTimer -= dt;
}

function updateEnemy(sim: Sim, e: Tank, dt: number): void {
  if (!e.alive) return;
  e.fireTimer -= dt;
  const p = sim.player;
  if (!p.alive) return;
  const dx = p.x - e.x;
  const dz = p.z - e.z;
  const dist = Math.hypot(dx, dz);
  const desired = Math.atan2(dx, dz);
  const canSee = dist < SEE_RANGE && losClear(e.x, e.z, p.x, p.z);

  if (canSee) {
    turnTowards(e, desired, e.turn, dt);
    let mv = 1;
    if (dist < 220 && e.type !== "scout") mv = Math.random() < 0.4 ? -0.6 : 1;
    const nx = e.x + Math.sin(e.yaw) * mv * e.speed * dt;
    const nz = e.z + Math.cos(e.yaw) * mv * e.speed * dt;
    if (!collides(nx, nz, e.r)) {
      e.x = nx;
      e.z = nz;
    } else {
      e.stuck += dt * 3;
    }
    // 炮塔瞄准（带固定偏差 + 随机扰动）
    const target = desired + e.aimBias + (Math.random() - 0.5) * 0.02;
    aimTowards(e, target, e.turn * 1.7, dt);
    if (
      e.fireTimer <= 0 &&
      Math.abs(angleDiff(e.tyaw, desired)) < 0.09 &&
      dist < BULLET_RANGE &&
      losClear(e.x, e.z, p.x, p.z)
    ) {
      fireBullet(sim, e);
    }
  } else {
    // 巡逻：向随机目标点移动
    e.wanderT -= dt;
    if (e.wanderT <= 0) {
      e.wanderT = 2.5 + Math.random() * 3;
      e.wanderTx = 60 + Math.random() * (W - 120);
      e.wanderTz = 60 + Math.random() * (D - 120);
      e.stuck = 0;
    }
    turnTowards(e, Math.atan2(e.wanderTx - e.x, e.wanderTz - e.z), e.turn, dt);
    const nx = e.x + Math.sin(e.yaw) * e.speed * dt * 0.7;
    const nz = e.z + Math.cos(e.yaw) * e.speed * dt * 0.7;
    if (!collides(nx, nz, e.r)) {
      e.x = nx;
      e.z = nz;
    } else {
      e.stuck += dt * 2;
    }
    if (e.stuck > 1.2) e.wanderT = 0;
  }
}

function separateTanks(sim: Sim): void {
  const all = [sim.player, ...sim.enemies].filter((t) => t.alive);
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i];
      const b = all[j];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      const min = (a.r + b.r) * 0.72;
      if (d > 0.001 && d < min) {
        const push = (min - d) / 2;
        const ux = dx / d;
        const uz = dz / d;
        if (!collides(a.x - ux * push, a.z, a.r)) a.x -= ux * push;
        if (!collides(a.x, a.z - uz * push, a.r)) a.z -= uz * push;
        if (!collides(b.x + ux * push, b.z, b.r)) b.x += ux * push;
        if (!collides(b.x, b.z + uz * push, b.r)) b.z += uz * push;
      }
    }
  }
}

function updateFx(sim: Sim, dt: number): void {
  for (const f of sim.fx) {
    f.px = f.x;
    f.py = f.y;
    f.pz = f.z;
    f.life += dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.z += f.vz * dt;
    if (f.kind === "spark") {
      f.vy -= 240 * dt;
      f.vx *= 1 - 1.6 * dt;
      f.vz *= 1 - 1.6 * dt;
    } else if (f.kind === "smoke") {
      f.vy += 26 * dt;
      f.size += 9 * dt;
    }
  }
  sim.fx = sim.fx.filter((f) => f.life < f.ttl);
}

function finishGame(sim: Sim, result: "win" | "lose"): void {
  sim.state = "over";
  sim.result = result;
  if (!sim.recorded) {
    sim.recorded = true;
    const hpLeft = Math.max(0, Math.round(sim.player.hp));
    const score = sim.kills * 100 + hpLeft;
    recordScore({
      gameId: "tankbattle",
      gameTitle: "坦克对决",
      score,
      detail: {
        result,
        kills: sim.kills,
        hpLeft,
      },
    });
  }
}

function update(sim: Sim, dt: number, keys: Set<string>): void {
  sim.time += dt;
  updatePlayer(sim, dt, keys);
  for (const e of sim.enemies) updateEnemy(sim, e, dt);
  updateBullets(sim, dt);
  updateFx(sim, dt);
  separateTanks(sim);
  for (const t of [sim.player, ...sim.enemies]) {
    if (t.flash > 0) t.flash -= dt;
    if (t.recoil > 0) t.recoil = Math.max(0, t.recoil - dt * 6);
    if (t.muzzle > 0) t.muzzle = Math.max(0, t.muzzle - dt);
  }
  if (sim.state !== "running") return;
  if (!sim.player.alive) {
    finishGame(sim, "lose");
  } else if (sim.enemies.every((e) => !e.alive)) {
    finishGame(sim, "win");
  }
}

/* ------------------------------------------------------------------ */
/* 3D 绘制辅助                                                         */
/* ------------------------------------------------------------------ */

function shade(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const k = Math.max(0.4, Math.min(1.5, f));
  const rr = Math.round(Math.min(255, r * k));
  const gg = Math.round(Math.min(255, g * k));
  const bb = Math.round(Math.min(255, b * k));
  return `rgb(${rr},${gg},${bb})`;
}

interface BoxColors {
  top: string;
  side: string;
}

/** 绘制任意朝向的 3D 盒子（面按深度排序 + 面光照） */
function drawBox(
  cam: Cam,
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  cz: number,
  w: number,
  h: number,
  d: number,
  yaw: number,
  colors: BoxColors,
  edge = "rgba(0,0,0,0.22)",
): void {
  const hw = w / 2;
  const hh = h / 2;
  const hd = d / 2;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const pts: Array<P | null> = [];
  for (let i = 0; i < 8; i++) {
    const sx = i & 1 ? 1 : -1;
    const sy = i & 2 ? 1 : -1;
    const sz = i & 4 ? 1 : -1;
    const wx = cx + sx * hw * cos + sz * hd * sin;
    const wy = cy + sy * hh;
    const wz = cz - sx * hw * sin + sz * hd * cos;
    pts.push(project(cam, wx, wy, wz));
  }
  const faces: Array<{
    ids: number[];
    kind: "top" | "side";
    nx: number;
    nz: number;
  }> = [
    // 顶点索引：(sx,sy,sz) = (i&1, i&2, i&4) ∈ {-1,+1}
    // 0:(-,-,-) 1:(+,-,-) 2:(-,+,-) 3:(+,+,-) 4:(-,-,+) 5:(+,-,+) 6:(-,+,+) 7:(+,+,+)
    { ids: [2, 3, 7, 6], kind: "top", nx: 0, nz: 0 }, // y+ 顶面
    { ids: [1, 3, 7, 5], kind: "side", nx: cos, nz: sin }, // 局部 x+
    { ids: [0, 2, 6, 4], kind: "side", nx: -cos, nz: -sin }, // 局部 x-
    { ids: [4, 6, 7, 5], kind: "side", nx: sin, nz: cos }, // 局部 z+
    { ids: [0, 1, 3, 2], kind: "side", nx: -sin, nz: -cos }, // 局部 z-
  ];
  const arr: Array<{ ids: number[]; kind: "top" | "side"; zc: number; bright: number }> = [];
  for (const f of faces) {
    const p0 = pts[f.ids[0]];
    if (!p0 || !pts[f.ids[1]] || !pts[f.ids[2]] || !pts[f.ids[3]]) continue;
    const zc = (p0.zc + pts[f.ids[1]]!.zc + pts[f.ids[2]]!.zc + pts[f.ids[3]]!.zc) / 4;
    let bright = 1;
    if (f.kind === "side") {
      const nd = f.nx * cam.fx + f.nz * cam.fz;
      bright = 0.55 + 0.62 * Math.max(0, nd);
    }
    arr.push({ ids: f.ids, kind: f.kind, zc, bright });
  }
  arr.sort((a, b) => a.zc - b.zc); // 先远后近（zc 小 = 远）
  for (const f of arr) {
    const p = f.ids.map((i) => pts[i]!);
    ctx.fillStyle = f.kind === "top" ? colors.top : shade(colors.side, f.bright);
    ctx.beginPath();
    ctx.moveTo(p[0].x, p[0].y);
    ctx.lineTo(p[1].x, p[1].y);
    ctx.lineTo(p[2].x, p[2].y);
    ctx.lineTo(p[3].x, p[3].y);
    ctx.closePath();
    ctx.fill();
    if (edge) {
      ctx.strokeStyle = edge;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

function drawShadow(
  cam: Cam,
  ctx: CanvasRenderingContext2D,
  x: number,
  z: number,
  rx: number,
  rz: number,
  alpha: number,
): void {
  const c = project(cam, x, 2, z);
  const ex = project(cam, x + rx, 2, z);
  const ez = project(cam, x, 2, z + rz);
  if (!c || !ex || !ez) return;
  const rxS = Math.max(Math.abs(ex.x - c.x), 3);
  const ryS = Math.max(Math.abs(ez.y - c.y), 3);
  ctx.fillStyle = `rgba(20,30,20,${alpha})`;
  ctx.beginPath();
  ctx.ellipse(c.x, c.y, rxS, ryS, 0, 0, Math.PI * 2);
  ctx.fill();
}

/* ------------------------------------------------------------------ */
/* 场景绘制                                                             */
/* ------------------------------------------------------------------ */

function quadPath(ctx: CanvasRenderingContext2D, p: Array<{ x: number; y: number }>): void {
  ctx.beginPath();
  ctx.moveTo(p[0].x, p[0].y);
  for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
  ctx.closePath();
}

function drawGround(cam: Cam, ctx: CanvasRenderingContext2D, t: number): void {
  const grassCols = ["#7fae57", "#78a750", "#86b55e", "#74a04b"];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const ch = MAP[r][c];
      const x0 = c * TILE;
      const z0 = r * TILE;
      const p0 = project(cam, x0, 0, z0);
      const p1 = project(cam, x0 + TILE, 0, z0);
      const p2 = project(cam, x0 + TILE, 0, z0 + TILE);
      const p3 = project(cam, x0, 0, z0 + TILE);
      if (!p0 || !p1 || !p2 || !p3) continue;
      const quad = [p0, p1, p2, p3];
      if (ch === "~") {
        const g = ctx.createLinearGradient(0, p0.y, 0, p3.y);
        g.addColorStop(0, "#2f8fc2");
        g.addColorStop(1, "#1f6d9c");
        ctx.fillStyle = g;
        quadPath(ctx, quad);
        ctx.fill();
        const wave = Math.sin(t * 2.2 + (r * COLS + c) * 1.7) * 0.5 + 0.5;
        ctx.strokeStyle = `rgba(255,255,255,${(0.08 + wave * 0.16).toFixed(3)})`;
        ctx.lineWidth = 1.5;
        for (let k = 0; k < 2; k++) {
          const wx0 = x0 + TILE * (0.12 + k * 0.34);
          const wx1 = x0 + TILE * (0.9 - k * 0.22);
          const wz = z0 + TILE * (0.38 + k * 0.28);
          const a = project(cam, wx0, 0, wz);
          const b = project(cam, wx1, 0, wz);
          if (!a || !b) continue;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      } else {
        const hash = ((r * 7 + c * 13 + 17) * 2654435761) >>> 0;
        ctx.fillStyle = grassCols[hash % grassCols.length];
        quadPath(ctx, quad);
        ctx.fill();
        ctx.strokeStyle = "rgba(20,40,20,0.07)";
        ctx.lineWidth = 1;
        quadPath(ctx, quad);
        ctx.stroke();
        // 零星草簇
        if (hash % 5 === 0) {
          const hx = x0 + TILE * (0.2 + ((hash >> 3) % 60) / 100);
          const hz = z0 + TILE * (0.25 + ((hash >> 9) % 60) / 100);
          const base = project(cam, hx, 0, hz);
          const tip = project(cam, hx, 7, hz);
          if (base && tip) {
            const dirx = tip.x - base.x;
            const diry = tip.y - base.y;
            ctx.strokeStyle = "rgba(30,70,30,0.5)";
            ctx.lineWidth = 1;
            for (let k = -1; k <= 1; k++) {
              const ox = base.x - k * diry * 0.35;
              const oy = base.y + k * dirx * 0.35;
              ctx.beginPath();
              ctx.moveTo(ox, oy);
              ctx.lineTo(ox + dirx * 0.7, oy + diry * 0.7);
              ctx.stroke();
            }
          }
        }
      }
    }
  }
}

function drawWall(cam: Cam, ctx: CanvasRenderingContext2D, cx: number, cz: number): void {
  drawShadow(cam, ctx, cx, cz, 25, 25, 0.16);
  drawBox(cam, ctx, cx, WALL_H / 2, cz, TILE, WALL_H, TILE, 0, {
    top: "#b6ab8c",
    side: "#92846a",
  });
  const inset = 5;
  const q = [
    project(cam, cx - TILE / 2 + inset, WALL_H, cz - TILE / 2 + inset),
    project(cam, cx + TILE / 2 - inset, WALL_H, cz - TILE / 2 + inset),
    project(cam, cx + TILE / 2 - inset, WALL_H, cz + TILE / 2 - inset),
    project(cam, cx - TILE / 2 + inset, WALL_H, cz + TILE / 2 - inset),
  ];
  if (q[0] && q[1] && q[2] && q[3]) {
    ctx.strokeStyle = "rgba(60,50,30,0.28)";
    ctx.lineWidth = 1;
    quadPath(ctx, q as Array<{ x: number; y: number }>);
    ctx.stroke();
  }
}

function drawTree(cam: Cam, ctx: CanvasRenderingContext2D, cx: number, cz: number, t: number): void {
  drawShadow(cam, ctx, cx, cz, 20, 20, 0.26);
  drawBox(cam, ctx, cx, 15, cz, 9, 30, 9, 0, { top: "#7a5230", side: "#63421f" });
  const sway = Math.sin(t * 1.4 + cx * 0.05) * 1.4;
  const greens = ["#2e7d3c", "#358a46", "#3d9950"];
  const ys = [40, 58, 74];
  const rs = [17, 13.5, 10];
  for (let i = 0; i < 3; i++) {
    const p = project(cam, cx + sway * (i + 1) * 0.4, ys[i], cz);
    if (!p) continue;
    const r = rs[i] * p.s;
    ctx.fillStyle = greens[i];
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r, r * 0.82, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(10,40,20,0.4)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawBarrel(
  cam: Cam,
  ctx: CanvasRenderingContext2D,
  tk: Tank,
): void {
  const bl = 34 * tk.scale * (1 - 0.35 * tk.recoil);
  const bx = tk.x + Math.sin(tk.tyaw) * (10 * tk.scale + bl / 2);
  const bz = tk.z + Math.cos(tk.tyaw) * (10 * tk.scale + bl / 2);
  drawBox(cam, ctx, bx, 31 * tk.scale, bz, 7 * tk.scale, 6 * tk.scale, bl, tk.tyaw, {
    top: "#313138",
    side: "#232329",
  });
}

function drawTank(cam: Cam, ctx: CanvasRenderingContext2D, tk: Tank, t: number): void {
  const s = tk.scale;
  const flash = tk.flash > 0;
  const body = flash ? "#ffffff" : tk.body;
  const top = flash ? "#ffffff" : tk.top;
  drawShadow(cam, ctx, tk.x, tk.z, 24 * s, 26 * s, 0.24);
  const trackCol: BoxColors = { top: "#3a3f45", side: "#2a2e34" };
  drawBox(cam, ctx, tk.x - 16 * s, 9 * s, tk.z, 12 * s, 9 * s, 48 * s, tk.yaw, trackCol);
  drawBox(cam, ctx, tk.x + 16 * s, 9 * s, tk.z, 12 * s, 9 * s, 48 * s, tk.yaw, trackCol);
  drawBox(cam, ctx, tk.x, 15 * s, tk.z, 34 * s, 12 * s, 50 * s, tk.yaw, {
    top,
    side: body,
  });
  drawBox(cam, ctx, tk.x, 27 * s, tk.z, 25 * s, 10 * s, 25 * s, tk.tyaw, {
    top,
    side: body,
  });
  drawBarrel(cam, ctx, tk);
  drawBox(cam, ctx, tk.x, 33 * s, tk.z, 12 * s, 4 * s, 12 * s, tk.yaw, {
    top: shade(tk.top, 1.15),
    side: shade(tk.body, 1.15),
  });
  if (tk.muzzle > 0) {
    const mlen = (34 * s + 8) * (1 + tk.muzzle * 0.3);
    const mx = tk.x + Math.sin(tk.tyaw) * mlen;
    const mz = tk.z + Math.cos(tk.tyaw) * mlen;
    drawMuzzle(cam, ctx, mx, 31 * s, mz, 8 + tk.muzzle * 90);
  }
  // 血条
  const hpP = project(cam, tk.x, 42 * s + 52, tk.z);
  if (hpP && tk.maxHp > 0) {
    const ratio = Math.max(0, Math.min(1, tk.hp / tk.maxHp));
    const bw = 44 * s * hpP.s;
    const bh = 5.5 * hpP.s;
    const x = hpP.x - bw / 2;
    const y = hpP.y - bh * 2.4;
    ctx.fillStyle = "rgba(10,20,10,0.6)";
    ctx.fillRect(x - 1, y - 1, bw + 2, bh + 2);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(x, y, bw, bh);
    const col = tk.kind === "player" ? "#5bd06a" : tk.type === "heavy" ? "#b48bff" : "#e5484d";
    ctx.fillStyle = col;
    if (ratio > 0) ctx.fillRect(x, y, bw * ratio, bh);
  }
}

function drawMuzzle(
  cam: Cam,
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  z: number,
  r: number,
): void {
  const p = project(cam, x, y, z);
  if (!p) return;
  const rr = Math.max(r * p.s, 2);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
  g.addColorStop(0, "rgba(255,246,190,0.95)");
  g.addColorStop(1, "rgba(255,140,40,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBullet(cam: Cam, ctx: CanvasRenderingContext2D, b: Bullet): void {
  for (let i = 0; i < b.trail.length; i++) {
    const tr = b.trail[i];
    const p = project(cam, tr.x, b.y, tr.z);
    if (!p) continue;
    const a = (i / b.trail.length) * 0.4;
    ctx.fillStyle = `rgba(255,180,90,${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.2 * p.s * (0.5 + (i / b.trail.length) * 0.5), 0, Math.PI * 2);
    ctx.fill();
  }
  const p = project(cam, b.x, b.y, b.z);
  if (!p) return;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 9 * p.s);
  g.addColorStop(0, "rgba(255,255,220,0.95)");
  g.addColorStop(0.45, "rgba(255,190,80,0.7)");
  g.addColorStop(1, "rgba(255,140,40,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(p.x, p.y, 9 * p.s, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawFx(cam: Cam, ctx: CanvasRenderingContext2D, f: Fx): void {
  const k = f.life / f.ttl;
  if (f.kind === "spark") {
    const p0 = project(cam, f.px, f.py, f.pz);
    const p1 = project(cam, f.x, f.y, f.z);
    if (!p0 || !p1) return;
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = f.color;
    ctx.lineWidth = Math.max(1.5, 3 * p1.s);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (f.kind === "smoke") {
    const p = project(cam, f.x, f.y, f.z);
    if (!p) return;
    ctx.globalAlpha = (1 - k) * 0.45;
    ctx.fillStyle = "#8f8f8f";
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(2, f.size * p.s), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  } else if (f.kind === "ring") {
    const p = project(cam, f.x, f.y, f.z);
    if (!p) return;
    const r = f.size * k * p.s;
    ctx.globalAlpha = (1 - k) * 0.85;
    ctx.strokeStyle = f.color;
    ctx.lineWidth = Math.max(2, 5 * p.s);
    ctx.beginPath();
    ctx.ellipse(p.x, p.y, r, r * 0.45, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (f.kind === "flash") {
    const p = project(cam, f.x, f.y, f.z);
    if (!p) return;
    const r = Math.max(2, (f.size * (1 - k) + 6) * p.s);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    g.addColorStop(0, "rgba(255,240,180,0.9)");
    g.addColorStop(1, "rgba(255,120,30,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else if (f.kind === "text" && f.text) {
    const p = project(cam, f.x, f.y, f.z);
    if (!p) return;
    ctx.globalAlpha = Math.max(0, 1 - k * 1.15);
    const fs = Math.max(9, Math.min(24, f.size * p.s));
    ctx.font = `bold ${fs}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.strokeStyle = "rgba(0,0,0,0.55)";
    ctx.lineWidth = 3;
    ctx.strokeText(f.text, p.x, p.y);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, p.x, p.y);
    ctx.textAlign = "start";
    ctx.globalAlpha = 1;
  }
}

function drawReticle(cam: Cam, ctx: CanvasRenderingContext2D, sim: Sim): void {
  if (!sim.aim || sim.state !== "running" || !sim.player.alive) return;
  const p = project(cam, sim.aim.x, 2, sim.aim.z);
  if (!p) return;
  let overEnemy = false;
  for (const e of sim.enemies) {
    if (!e.alive) continue;
    if (Math.hypot(sim.aim.x - e.x, sim.aim.z - e.z) < e.r + 10) {
      overEnemy = true;
      break;
    }
  }
  const col = overEnemy ? "rgba(255,80,70,0.95)" : "rgba(255,255,255,0.8)";
  const r = (overEnemy ? 13 : 9) * p.s;
  ctx.strokeStyle = col;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p.x - r - 5, p.y);
  ctx.lineTo(p.x - r + 3, p.y);
  ctx.moveTo(p.x + r - 3, p.y);
  ctx.lineTo(p.x + r + 5, p.y);
  ctx.moveTo(p.x, p.y - r - 5);
  ctx.lineTo(p.x, p.y - r + 3);
  ctx.moveTo(p.x, p.y + r - 3);
  ctx.lineTo(p.x, p.y + r + 5);
  ctx.stroke();
}

function render(ctx: CanvasRenderingContext2D, sim: Sim, t: number): void {
  const cam = sim.cam;
  const bg = ctx.createLinearGradient(0, 0, 0, CH);
  bg.addColorStop(0, "#3d553e");
  bg.addColorStop(1, "#1e2a1f");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CW, CH);

  drawGround(cam, ctx, t);

  const items: Array<{ zc: number; draw: () => void }> = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (MAP[r][c] === "#") {
        const cx = c * TILE + TILE / 2;
        const cz = r * TILE + TILE / 2;
        const p = project(cam, cx, WALL_H / 2, cz);
        if (p) items.push({ zc: p.zc, draw: () => drawWall(cam, ctx, cx, cz) });
      }
    }
  }
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (MAP[r][c] === "T") {
        const cx = c * TILE + TILE / 2;
        const cz = r * TILE + TILE / 2;
        const p = project(cam, cx, 15, cz);
        if (p) items.push({ zc: p.zc, draw: () => drawTree(cam, ctx, cx, cz, t) });
      }
    }
  }
  if (sim.player.alive) {
    const p = project(cam, sim.player.x, 15 * sim.player.scale, sim.player.z);
    if (p) {
      const tk = sim.player;
      items.push({ zc: p.zc, draw: () => drawTank(cam, ctx, tk, t) });
    }
  }
  for (const e of sim.enemies) {
    if (!e.alive) continue;
    const p = project(cam, e.x, 15 * e.scale, e.z);
    if (p) items.push({ zc: p.zc, draw: () => drawTank(cam, ctx, e, t) });
  }
  for (const b of sim.bullets) {
    const p = project(cam, b.x, b.y, b.z);
    if (p) items.push({ zc: p.zc, draw: () => drawBullet(cam, ctx, b) });
  }
  for (const f of sim.fx) {
    const p = project(cam, f.x, f.y, f.z);
    if (p) items.push({ zc: p.zc, draw: () => drawFx(cam, ctx, f) });
  }
  items.sort((a, b) => a.zc - b.zc); // 先远后近
  for (const it of items) it.draw();

  drawReticle(cam, ctx, sim);
}

/* ------------------------------------------------------------------ */
/* React 组件                                                          */
/* ------------------------------------------------------------------ */

const TankBattleGame: React.FC<{ sdk: FatNotesPluginSDK }> = () => {
  const i18n = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<Sim | null>(null);
  const keysRef = useRef<Set<string>>(new Set());
  const lastUiRef = useRef<Ui>({
    hp: 120,
    kills: 0,
    left: 8,
    state: "idle",
    result: null,
  });
  const [ui, setUi] = useState<Ui>(lastUiRef.current);

  const syncUi = (sim: Sim) => {
    const next: Ui = {
      hp: Math.max(0, Math.round(sim.player.hp)),
      kills: sim.kills,
      left: sim.enemies.filter((e) => e.alive).length,
      state: sim.state,
      result: sim.result,
    };
    const prev = lastUiRef.current;
    if (
      next.hp !== prev.hp ||
      next.kills !== prev.kills ||
      next.left !== prev.left ||
      next.state !== prev.state ||
      next.result !== prev.result
    ) {
      lastUiRef.current = next;
      setUi(next);
    }
  };

  const startGame = useCallback(() => {
    const sim = simRef.current;
    if (!sim) return;
    if (sim.state === "idle") {
      sim.state = "running";
    } else if (sim.state === "paused") {
      sim.state = "running";
      sim.lastTs = 0;
    }
  }, []);

  const tryFire = useCallback(() => {
    const sim = simRef.current;
    if (!sim || sim.state !== "running") return;
    const p = sim.player;
    if (!p.alive || p.fireTimer > 0) return;
    fireBullet(sim, p);
  }, []);

  const reset = useCallback(() => {
    simRef.current = newSim();
    fitCam(simRef.current.cam);
    lastUiRef.current = {
      hp: 120,
      kills: 0,
      left: 8,
      state: "idle",
      result: null,
    };
    setUi(lastUiRef.current);
  }, []);

  const startPause = useCallback(() => {
    const sim = simRef.current;
    if (!sim) return;
    if (sim.state === "over") {
      reset();
      return;
    }
    if (sim.state === "idle") {
      startGame();
    } else if (sim.state === "running") {
      sim.state = "paused";
    } else if (sim.state === "paused") {
      startGame();
    }
  }, [reset, startGame]);

  // 初始化
  useEffect(() => {
    if (!simRef.current) {
      simRef.current = newSim();
      fitCam(simRef.current.cam);
    }
  }, []);

  // 主循环
  useEffect(() => {
    let raf = 0;
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const sim = simRef.current;
      if (!sim) return;
      if (!sim.lastTs) sim.lastTs = ts;
      const dt = Math.min(0.05, (ts - sim.lastTs) / 1000);
      sim.lastTs = ts;
      if (sim.state === "running") update(sim, dt, keysRef.current);
      render(ctx, sim, sim.time + dt);
      syncUi(sim);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 键盘
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === " " || k === "arrowup" || k === "arrowdown" || k === "arrowleft" || k === "arrowright") {
        e.preventDefault();
      }
      keysRef.current.add(k);
      if (k === " ") {
        const sim = simRef.current;
        if (!sim) return;
        if (sim.state === "idle") startGame();
        else if (sim.state === "running") tryFire();
      }
    };
    const up = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key.toLowerCase());
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [startGame, tryFire]);

  const running = ui.state === "running";

  return (
    <GameFrame
      emoji="🛡️"
      title={i18n.text("game.tankbattle.title")}
      stats={[
        { label: i18n.text("game.tankbattle.hp"), value: ui.hp, colors: CHIP_RED },
        { label: i18n.text("game.tankbattle.kills"), value: ui.kills, colors: CHIP_GOLD },
        { label: i18n.text("game.tankbattle.left"), value: ui.left, colors: CHIP_BLUE },
      ]}
      headerExtra={
        <>
          <GhostBtn onClick={startPause} disabled={ui.state === "over"}>
            {running ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
            {running
              ? i18n.text("game.tankbattle.pause")
              : ui.state === "paused"
                ? i18n.text("game.tankbattle.resume")
                : i18n.text("game.tankbattle.start")}
          </GhostBtn>
          <GhostBtn onClick={reset}>
            <ReloadOutlined />
            {i18n.text("game.tankbattle.restart")}
          </GhostBtn>
        </>
      }
      help={i18n.text("game.tankbattle.help")}
      maxWidth={900}
    >
      <div
        style={{
          position: "relative",
          width: CW,
          height: CH,
          borderRadius: 14,
          overflow: "hidden",
          boxShadow: "0 8px 24px rgba(20,40,20,0.35)",
          border: "3px solid rgba(90,120,80,0.55)",
          touchAction: "none",
        }}
      >
        <canvas
          ref={canvasRef}
          width={CW}
          height={CH}
          style={{
            display: "block",
            width: "100%",
            height: "auto",
            cursor: "crosshair",
          }}
          onPointerMove={(e) => {
            const sim = simRef.current;
            if (!sim) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const sx = ((e.clientX - rect.left) / rect.width) * CW;
            const sy = ((e.clientY - rect.top) / rect.height) * CH;
            sim.aim = unprojectGround(sim.cam, sx, sy);
          }}
          onPointerLeave={() => {
            const sim = simRef.current;
            if (sim) sim.aim = null;
          }}
          onPointerDown={() => {
            const sim = simRef.current;
            if (!sim) return;
            if (sim.state === "idle") startGame();
            else if (sim.state === "running") tryFire();
          }}
        />
        {ui.state === "over" && (
          <div
            className="gs-win-in"
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(24,34,24,0.78)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
            }}
          >
            <div style={{ fontSize: 30, fontWeight: 900 }}>
              {ui.result === "win"
                ? i18n.text("game.tankbattle.win")
                : i18n.text("game.tankbattle.lose")}
            </div>
            <div style={{ fontSize: 15, opacity: 0.9, fontWeight: 700 }}>
              {i18n.text("game.tankbattle.result", {
                kills: ui.kills,
                hp: ui.hp,
              })}
            </div>
            <GhostBtn onClick={reset}>
              <ReloadOutlined />
              {i18n.text("game.tankbattle.again")}
            </GhostBtn>
          </div>
        )}
        {ui.state === "idle" && (
          <div
            className="gs-pulse"
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(24,34,24,0.45)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 17,
              fontWeight: 800,
              letterSpacing: 1,
              pointerEvents: "none",
            }}
          >
            {i18n.text("game.tankbattle.idle")}
          </div>
        )}
        {ui.state === "paused" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(24,34,24,0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 20,
              fontWeight: 900,
              pointerEvents: "none",
              letterSpacing: 2,
            }}
          >
            {i18n.text("game.tankbattle.paused")}
          </div>
        )}
      </div>
    </GameFrame>
  );
};

export default TankBattleGame;
