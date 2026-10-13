/*
 * Pool3DGame：3D 台球
 *
 * Canvas 3D 透视渲染的美式台球：
 *   - 物理（碰撞/库边/落袋/阻尼）收敛在 poolLogic.ts（纯函数，可单测）
 *   - 相机架在球台后方高处俯视球台（透视投影），球体用径向渐变模拟立体感，
 *     库边/袋口/瞄准线/球杆均按同一投影绘制，实现“3D”观感
 *   - 操作：移动鼠标瞄准（虚线为瞄准线）；按住左键拖动蓄力、松开击球；
 *     空格直接击球，R 重新开球。把 15 颗球全部打进袋即清台，杆数越少得分越高
 *   - 白球落袋自动复位；清台弹出结算并记录成绩（杆数换算得分）
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AimOutlined, ReloadOutlined } from "@ant-design/icons";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import { recordScore } from "../scoreClient";
import { useI18n } from "../hooks";
import { useThemeMode } from "../ThemeShell";
import GameFrame, {
  GhostBtn,
  PrimaryBtn,
  CHIP_BLUE,
  CHIP_GOLD,
  CHIP_GREEN,
  CHIP_RED,
} from "./GameFrame";
import {
  anyMoving,
  autoPlaceCue,
  ballColor,
  BALL_R,
  clamp,
  CORNER_MOUTH,
  countLeft,
  createRack,
  isStriped,
  POCKETS,
  shoot,
  SIDE_MOUTH,
  stepBalls,
  TABLE_L,
  TABLE_W,
  type PoolBall,
} from "./poolLogic";
import { sfxBounce, sfxDrop, sfxHit, sfxShoot, sfxWin } from "./sound";
import "./gameAnimations.less";

/* ------------------------------------------------------------------ */
/* 相机                                                               */
/* ------------------------------------------------------------------ */

const CW = 1000;
const CH = 500;
const FOCAL = 950;
/** 相机注视点（台面正中心，保证透视投影下球台在画布中居中） */
const CAM_TARGET = { x: TABLE_L / 2, y: TABLE_W / 2, z: 0 };

/** 相机状态：绕注视点球坐标（yaw 弧度 / pitch 仰角度 / 距离） */
interface CamState {
  yaw: number;
  pitch: number;
  dist: number;
}

/** 默认视角（台面后上方：站在球台短边一侧俯视，台面横放完整且居中） */
const DEFAULT_VIEW: CamState = { yaw: Math.PI * 1.5, pitch: 50, dist: 175 };
/** 俯视视角（正上方，方便瞄直线球） */
const TOP_VIEW: CamState = { yaw: Math.PI * 1.5, pitch: 88, dist: 112 };

function eyeFromView(v: CamState): Vec3 {
  const cp = Math.cos((v.pitch * Math.PI) / 180);
  const sp = Math.sin((v.pitch * Math.PI) / 180);
  return {
    x: CAM_TARGET.x + v.dist * cp * Math.cos(v.yaw),
    y: CAM_TARGET.y + v.dist * cp * Math.sin(v.yaw),
    z: CAM_TARGET.z + v.dist * sp,
  };
}

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

interface Cam {
  eye: Vec3;
  rgt: Vec3;
  up: Vec3;
  fwd: Vec3;
  focal: number;
  cx: number;
  cy: number;
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function norm3(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function buildCam(view: CamState): Cam {
  const eye = eyeFromView(view);
  const fwd = norm3(sub(CAM_TARGET, eye));
  const rgt = norm3(cross(fwd, { x: 0, y: 0, z: 1 }));
  const up = cross(rgt, fwd);
  return { eye, rgt, up, fwd, focal: FOCAL, cx: CW / 2, cy: CH / 2 };
}

interface ScreenPt {
  x: number;
  y: number;
  scale: number;
  zc: number;
}

/** 世界坐标 → 屏幕坐标（返回 null 表示在相机后方） */
function worldToScreen(cam: Cam, x: number, y: number, z: number): ScreenPt | null {
  const d = sub({ x, y, z }, cam.eye);
  const zc = dot(d, cam.fwd);
  if (zc < 2) return null;
  const xc = dot(d, cam.rgt);
  const yc = dot(d, cam.up);
  const scale = cam.focal / zc;
  return { x: cam.cx + xc * scale, y: cam.cy - yc * scale, scale, zc };
}

/** 屏幕坐标 → 台面平面（z=0）交点；射线不命中平面返回 null */
function screenToPlane(cam: Cam, sx: number, sy: number): { x: number; y: number } | null {
  const dx = (sx - cam.cx) / cam.focal;
  const dy = -(sy - cam.cy) / cam.focal;
  const dir = norm3({
    x: cam.rgt.x * dx + cam.up.x * dy + cam.fwd.x,
    y: cam.rgt.y * dx + cam.up.y * dy + cam.fwd.y,
    z: cam.rgt.z * dx + cam.up.z * dy + cam.fwd.z,
  });
  if (dir.z >= -1e-6) return null;
  const t = (0 - cam.eye.z) / dir.z;
  if (t <= 0) return null;
  return { x: cam.eye.x + dir.x * t, y: cam.eye.y + dir.y * t };
}

/* ------------------------------------------------------------------ */
/* 颜色工具                                                            */
/* ------------------------------------------------------------------ */

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgb(r: number, g: number, b: number): string {
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

/** 变暗 */
function shade(hex: string, f: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgb(r * f, g * f, b * f);
}

/** 提亮（向白色混合） */
function tint(hex: string, f: number): string {
  const [r, g, b] = hexToRgb(hex);
  return rgb(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f);
}

/* ------------------------------------------------------------------ */
/* 渲染                                                               */
/* ------------------------------------------------------------------ */

/** 球台外框木色（明/暗主题共用一套木色，近处稍亮） */
const RAIL_DARK = "#4a2c16";
const RAIL_LIGHT = "#6e4426";

/** 台面一条边减去袋口区间后剩下的有效库边段 */
function subtractHoles(
  a0: number,
  a1: number,
  holes: Array<[number, number]>,
): Array<[number, number]> {
  const hs = holes
    .filter(([h0, h1]) => h1 > a0 && h0 < a1)
    .map(([h0, h1]) => [Math.max(a0, h0), Math.min(a1, h1)] as [number, number])
    .sort((x, y) => x[0] - y[0]);
  const out: Array<[number, number]> = [];
  let cur = a0;
  for (const [h0, h1] of hs) {
    if (h0 > cur + 0.6) out.push([cur, h0]);
    cur = Math.max(cur, h1);
  }
  if (a1 > cur + 0.6) out.push([cur, a1]);
  return out;
}

/** 四条库边在袋口处断开的有效段（世界坐标；每段沿 axis 从 from 到 to） */
function cushionSegments(): Array<{ fixed: number; axis: "x" | "y"; from: number; to: number }> {
  const segs: Array<{ fixed: number; axis: "x" | "y"; from: number; to: number }> = [];
  for (const y of [0, TABLE_W]) {
    const segsX = subtractHoles(0, TABLE_L, [
      [0, CORNER_MOUTH],
      [TABLE_L - CORNER_MOUTH, TABLE_L],
      [TABLE_L / 2 - SIDE_MOUTH, TABLE_L / 2 + SIDE_MOUTH],
    ]);
    for (const [from, to] of segsX) segs.push({ fixed: y, axis: "x", from, to });
  }
  for (const x of [0, TABLE_L]) {
    const segsY = subtractHoles(0, TABLE_W, [
      [0, CORNER_MOUTH],
      [TABLE_W - CORNER_MOUTH, TABLE_W],
    ]);
    for (const [from, to] of segsY) segs.push({ fixed: x, axis: "y", from, to });
  }
  return segs;
}

/** 库边（缓冲胶边）：按段采样投影，袋口处自然断开 */
function drawCushions(
  ctx: CanvasRenderingContext2D,
  cam: Cam,
  isDark: boolean,
): void {
  ctx.strokeStyle = isDark ? "#0f3a26" : "#1e6b41";
  ctx.lineCap = "round";
  for (const s of cushionSegments()) {
    const mid =
      s.axis === "x" ? { x: (s.from + s.to) / 2, y: s.fixed } : { x: s.fixed, y: (s.from + s.to) / 2 };
    const msp = worldToScreen(cam, mid.x, mid.y, 0);
    ctx.lineWidth = msp ? Math.max(3, 2.1 * msp.scale) : 6;
    ctx.beginPath();
    let started = false;
    const n = Math.max(2, Math.ceil((s.to - s.from) / 0.9));
    for (let i = 0; i <= n; i++) {
      const t = s.from + ((s.to - s.from) * i) / n;
      const p = worldToScreen(cam, s.axis === "x" ? t : s.fixed, s.axis === "x" ? s.fixed : t, 0);
      if (!p) continue;
      if (!started) {
        ctx.moveTo(p.x, p.y);
        started = true;
      } else ctx.lineTo(p.x, p.y);
    }
    if (started) ctx.stroke();
  }
}

/** 毛呢切角/缺口尺寸：角袋 45° 斜切、中袋凹口，与库边挖口及袋口圆半径匹配（角袋挖口 4.6 < 视觉洞 3.62 覆盖半径，中袋挖口 3.0 < 视觉洞 3.13） */
const CORNER_CUT = 3.6;
const MOUTH_HALF = 3.0;

/** 毛呢 12 点轮廓（世界坐标）：四角斜切 + 两侧中袋凹口，真实球台形状 */
const FELT_POINTS: Array<{ x: number; y: number }> = [
  { x: 0, y: CORNER_CUT }, // 左边下沿（左下斜切终点）
  { x: CORNER_CUT, y: 0 }, // 顶边左端（左上斜切起点）
  { x: TABLE_L / 2 - MOUTH_HALF, y: 0 }, // 顶边中袋左缘
  { x: TABLE_L / 2 + MOUTH_HALF, y: 0 }, // 顶边中袋右缘
  { x: TABLE_L - CORNER_CUT, y: 0 }, // 顶边右端
  { x: TABLE_L, y: CORNER_CUT }, // 右上斜切终点
  { x: TABLE_L, y: TABLE_W - CORNER_CUT }, // 右边上沿
  { x: TABLE_L - CORNER_CUT, y: TABLE_W }, // 右下斜切终点
  { x: TABLE_L / 2 + MOUTH_HALF, y: TABLE_W }, // 底边中袋右缘
  { x: TABLE_L / 2 - MOUTH_HALF, y: TABLE_W }, // 底边中袋左缘
  { x: CORNER_CUT, y: TABLE_W }, // 底边左端
  { x: 0, y: TABLE_W - CORNER_CUT }, // 左下斜切终点
];

/** 袋口视觉中心：角袋偏移到斜切缺口中点（向台内对角），中袋保持长边中点 */
function pocketVisCenter(p: (typeof POCKETS)[number]): { x: number; y: number } {
  if (p.x === 0 || p.x === TABLE_L) {
    const ox = p.x === 0 ? CORNER_CUT / 2 : -CORNER_CUT / 2;
    const oy = p.y === 0 ? CORNER_CUT / 2 : -CORNER_CUT / 2;
    return { x: p.x + ox, y: p.y + oy };
  }
  return { x: p.x, y: p.y };
}

/** 袋口：按真实透视画成椭圆（长轴沿视线投影方向、短轴按视线倾角压缩），带金属圈 */
function drawPocket(
  ctx: CanvasRenderingContext2D,
  cam: Cam,
  p: (typeof POCKETS)[number],
): void {
  const c = pocketVisCenter(p);
  const sp = worldToScreen(cam, c.x, c.y, 0);
  if (!sp) return;
  const r = p.r * sp.scale * 1.08;
  // 视线方向（袋口 → 相机），决定椭圆朝向与压缩
  const dir = norm3(sub(cam.eye, { x: c.x, y: c.y, z: 0 }));
  const cosT = Math.max(0.5, Math.abs(dir.z));
  const wl = Math.hypot(dir.x, dir.y);
  let rot = 0;
  if (wl > 1e-4) {
    const ux = dir.x / wl;
    const uy = dir.y / wl;
    const dxs = ux * cam.rgt.x + uy * cam.rgt.y;
    const dys = ux * cam.up.x + uy * cam.up.y;
    rot = Math.atan2(-dys, dxs); // canvas y 向下
  }
  // 洞口（深色）
  ctx.fillStyle = "#120d08";
  ctx.beginPath();
  ctx.ellipse(sp.x, sp.y, r, r * cosT, rot, 0, Math.PI * 2);
  ctx.fill();
  // 金属圈
  ctx.strokeStyle = "rgba(214,178,136,0.5)";
  ctx.lineWidth = 2;
  ctx.stroke();
  // 洞口内高光
  ctx.fillStyle = "rgba(255,255,255,0.07)";
  ctx.beginPath();
  ctx.ellipse(sp.x - r * 0.22, sp.y - r * 0.2, r * 0.45, r * 0.45 * cosT, rot, 0, Math.PI * 2);
  ctx.fill();
}

function drawTable(
  ctx: CanvasRenderingContext2D,
  cam: Cam,
  isDark: boolean,
): void {
  const corners = [
    { x: 0, y: 0 },
    { x: TABLE_L, y: 0 },
    { x: TABLE_L, y: TABLE_W },
    { x: 0, y: TABLE_W },
  ];
  const pts = corners
    .map((c) => worldToScreen(cam, c.x, c.y, 0))
    .filter((p): p is ScreenPt => !!p);
  if (pts.length < 4) return;
  const center = worldToScreen(cam, TABLE_L / 2, TABLE_W / 2, 0);
  if (!center) return;

  // 外框（木色）：沿屏幕方向把四个角向外推
  const railW = 7.6;
  const outer = pts.map((p, i) => {
    const dx = p.x - center.x;
    const dy = p.y - center.y;
    const dl = Math.hypot(dx, dy) || 1;
    const w = railW * p.scale;
    return { x: p.x + (dx / dl) * w, y: p.y + (dy / dl) * w };
  });

  // 桌影
  const shadowPts = outer.map((p) => ({
    x: p.x + 7,
    y: p.y + 9,
  }));
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath();
  shadowPts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.fill();

  // 木框
  const railFill = isDark ? RAIL_DARK : RAIL_LIGHT;
  ctx.fillStyle = railFill;
  ctx.beginPath();
  outer.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  ctx.closePath();
  ctx.fill();

  // 毛呢轮廓（切角 + 中袋凹口，投影到屏幕）
  const felt = FELT_POINTS.map((c) => worldToScreen(cam, c.x, c.y, 0));
  const feltPts = felt.filter((p): p is ScreenPt => !!p);

  if (feltPts.length >= 3) {
    // 木框高光（内侧描边，沿毛呢轮廓——袋口缺口处自然断开，不穿过洞口）
    ctx.strokeStyle = isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    feltPts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();

    // 绿色毛呢
    const feltColor = isDark ? "#1c5a3c" : "#2e8b57";
    const feltDark = isDark ? "#16482f" : "#257a49";
    const g = ctx.createLinearGradient(0, feltPts[0].y, 0, feltPts[6].y);
    g.addColorStop(0, tint(feltColor, 0.06));
    g.addColorStop(0.5, feltColor);
    g.addColorStop(1, feltDark);
    ctx.fillStyle = g;
    ctx.beginPath();
    feltPts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
    ctx.fill();
  }

  // 库边（缓冲胶边，比毛呢略深；在袋口处断开）
  drawCushions(ctx, cam, isDark);

  // 袋口（覆盖斜切/凹口，洞缘与毛呢轮廓贴合）
  for (const p of POCKETS) drawPocket(ctx, cam, p);
}

/** 画一颗球：平面阴影 + 渐变球体 + 花色/号码 + 高光 */
function drawBall(
  ctx: CanvasRenderingContext2D,
  cam: Cam,
  ball: PoolBall,
): void {
  const sp = worldToScreen(cam, ball.x, ball.y, BALL_R);
  if (!sp) return;
  const r = BALL_R * sp.scale;

  // 桌面阴影（椭圆）
  const sh = worldToScreen(cam, ball.x, ball.y, 0);
  if (sh) {
    ctx.fillStyle = "rgba(0,0,0,0.30)";
    ctx.beginPath();
    ctx.ellipse(sh.x, sh.y, r * 1.02, r * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const base = ballColor(ball.id);
  // 球体径向渐变（光源在左上方）
  const grad = ctx.createRadialGradient(
    sp.x - r * 0.35,
    sp.y - r * 0.42,
    r * 0.1,
    sp.x,
    sp.y,
    r,
  );
  grad.addColorStop(0, tint(base, 0.35));
  grad.addColorStop(0.55, base);
  grad.addColorStop(1, shade(base, 0.5));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
  ctx.fill();

  if (ball.id === 0) {
    // 白球：更亮的边缘
    ctx.strokeStyle = "rgba(120,130,150,0.35)";
    ctx.lineWidth = 1;
    ctx.stroke();
  } else {
    ctx.save();
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
    ctx.clip();
    // 花色球：白色腰带
    if (isStriped(ball.id)) {
      ctx.fillStyle = "rgba(255,255,255,0.94)";
      ctx.fillRect(sp.x - r, sp.y - r * 0.4, r * 2, r * 0.8);
    }
    // 号码圆
    const nr = r * (isStriped(ball.id) ? 0.42 : 0.5);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, nr, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.restore();
    // 号码
    ctx.fillStyle = ball.id === 8 ? "#22262e" : "#20242c";
    ctx.font = `700 ${Math.max(8, r * 0.72)}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(ball.id), sp.x, sp.y + r * 0.02);
  }

  // 高光
  const hl = ctx.createRadialGradient(
    sp.x - r * 0.42,
    sp.y - r * 0.5,
    0,
    sp.x - r * 0.42,
    sp.y - r * 0.5,
    r * 0.34,
  );
  hl.addColorStop(0, "rgba(255,255,255,0.9)");
  hl.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = hl;
  ctx.beginPath();
  ctx.arc(sp.x, sp.y, r * 0.86, 0, Math.PI * 2);
  ctx.fill();
}

/** 球杆：按瞄准方向画在台面上（蓄力时后拉） */
function drawCue(
  ctx: CanvasRenderingContext2D,
  cam: Cam,
  cue: PoolBall,
  angle: number,
  pull: number,
): void {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  // 杆尖在白球后方 pull 距离处；各段在世界坐标上沿 -dir 延伸，再做真实透视投影，
  // 与瞄准虚线共用同一投影，保证杆身方向与瞄准线一致（透视下 dx/dy 不能当屏幕方向用）
  const tipX = cue.x - dx * (BALL_R + 0.55 + pull);
  const tipY = cue.y - dy * (BALL_R + 0.55 + pull);
  const h = BALL_R * 0.5;

  const seg = (from: number, to: number, color: string, ww: number) => {
    const x1 = tipX - dx * from;
    const y1 = tipY - dy * from;
    const x2 = tipX - dx * to;
    const y2 = tipY - dy * to;
    const p1 = worldToScreen(cam, x1, y1, h);
    const p2 = worldToScreen(cam, x2, y2, h);
    if (!p1 || !p2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = ww * 1.15 * p1.scale;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  };

  // 后节（深色）
  seg(12, 34, "#7a4a22", 1.28);
  // 前节（浅木色）
  seg(2.6, 12, "#e0b06a", 1.05);
  // 皮头
  seg(0, 2.6, "#f4f0e6", 0.8);
}

/** 从白球沿 angle 方向到首个障碍（球/库边）的命中点 */
function aimContact(
  balls: PoolBall[],
  angle: number,
): { x: number; y: number; hitBall: boolean } {
  const cue = balls[0];
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let tEnd = Infinity;
  let hitBall = false;

  // 库边
  const rails: [number, number][] = [
    [BALL_R, 1],
    [TABLE_L - BALL_R, 1],
    [BALL_R, 2],
    [TABLE_W - BALL_R, 2],
  ];
  for (const [b, axis] of rails) {
    const d = axis === 1 ? dx : dy;
    const p0 = axis === 1 ? cue.x : cue.y;
    if (Math.abs(d) < 1e-6) continue;
    const t = (b - p0) / d;
    if (t > 0 && t < tEnd) tEnd = t;
  }

  // 目标球
  const d2 = BALL_R * 2;
  for (const b of balls) {
    if (b.id === 0 || b.potted) continue;
    const rx = b.x - cue.x;
    const ry = b.y - cue.y;
    const proj = rx * dx + ry * dy;
    if (proj <= 0) continue;
    const perp2 = rx * rx + ry * ry - proj * proj;
    if (perp2 >= d2 * d2) continue;
    const t = proj - Math.sqrt(d2 * d2 - perp2);
    if (t > 0 && t < tEnd) {
      tEnd = t;
      hitBall = true;
    }
  }

  if (!Number.isFinite(tEnd) || tEnd > 400) tEnd = 400;
  return { x: cue.x + dx * tEnd, y: cue.y + dy * tEnd, hitBall };
}

/** 瞄准虚线 + 命中标记 */
function drawAim(
  ctx: CanvasRenderingContext2D,
  cam: Cam,
  balls: PoolBall[],
  angle: number,
): void {
  const cue = balls[0];
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const contact = aimContact(balls, angle);
  const p0 = { x: cue.x + dx * 1.2, y: cue.y + dy * 1.2 };
  const len = Math.hypot(contact.x - p0.x, contact.y - p0.y);

  // 虚线
  const steps = 10;
  ctx.save();
  ctx.setLineDash([6, 10]);
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * len;
    const p = worldToScreen(cam, p0.x + dx * t, p0.y + dy * t, 0.05);
    if (!p) continue;
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.restore();

  // 命中标记
  const hp = worldToScreen(cam, contact.x, contact.y, 0.05);
  if (hp) {
    ctx.fillStyle = contact.hitBall ? "rgba(255,190,80,0.9)" : "rgba(255,255,255,0.75)";
    ctx.beginPath();
    ctx.arc(hp.x, hp.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/** 底部力度条 */
function drawPowerBar(
  ctx: CanvasRenderingContext2D,
  power: number,
  charging: boolean,
): void {
  const w = 190;
  const h = 10;
  const x = 16;
  const y = CH - 28;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.roundRect(x - 3, y - 3, w + 6, h + 6, 8);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 5);
  ctx.fill();
  const pw = w * power;
  if (pw > 0.5) {
    const grad = ctx.createLinearGradient(x, 0, x + w, 0);
    grad.addColorStop(0, "#35d97a");
    grad.addColorStop(pw / w > 0.5 ? 0.5 : pw / w, "#ffd166");
    grad.addColorStop(1, "#ff6b57");
    ctx.fillStyle = grad;
  } else {
    ctx.fillStyle = "#35d97a";
  }
  ctx.beginPath();
  ctx.roundRect(x, y, Math.max(0, pw), h, 5);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = "600 11px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(charging ? "POWER" : "POWER  ·  SPACE", x, y - 5);
}

/* ------------------------------------------------------------------ */
/* 组件                                                               */
/* ------------------------------------------------------------------ */

const LS_BEST = "fat-games.pool3d.best";
const CHARGE_RANGE = 52; // 拖动多少世界单位达到满力
const DEFAULT_POWER = 0.62;

type Phase = "aim" | "moving" | "over";

interface AimState {
  angle: number;
  power: number;
  charging: boolean;
  hasPointer: boolean;
}

const Pool3DGame: React.FC<{ sdk: FatNotesPluginSDK }> = () => {
  const i18n = useI18n();
  const isDark = useThemeMode() === "dark";

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ballsRef = useRef<PoolBall[]>(createRack());
  const viewRef = useRef<CamState>({ ...DEFAULT_VIEW });
  const camRef = useRef<Cam>(buildCam(DEFAULT_VIEW));
  const phaseRef = useRef<Phase>("aim");
  const aimRef = useRef<AimState>({
    angle: 0, // 默认指向球堆方向（正 x）
    power: DEFAULT_POWER,
    charging: false,
    hasPointer: false,
  });
  const dragRef = useRef<{
    mode: "aim" | "view";
    x: number;
    y: number;
    view0: CamState;
  } | null>(null);
  const msgRef = useRef<{ text: string; until: number } | null>(null);
  const recordedRef = useRef(false);
  const isDarkRef = useRef(isDark);
  isDarkRef.current = isDark;

  const [shots, setShots] = useState(0);
  const [left, setLeft] = useState(15);
  const [potted, setPotted] = useState(0);
  const [best, setBest] = useState<number | null>(() => {
    const v = Number(window.localStorage.getItem(LS_BEST) || 0);
    return v > 0 ? v : null;
  });
  const [over, setOver] = useState(false);
  const [phase, setPhase] = useState<Phase>("aim");

  const shotsRef = useRef(0);
  const pottedRef = useRef(0);

  /* ── 视角 ─────────────────────────────────────────────────────── */
  const applyView = useCallback((v: CamState) => {
    viewRef.current = v;
    camRef.current = buildCam(v);
  }, []);

  const setCanvasCursor = (cursor: string) => {
    const cv = canvasRef.current;
    if (cv) cv.style.cursor = cursor;
  };

  /* ── 击球 ─────────────────────────────────────────────────────── */
  const fireShot = useCallback(() => {
    const balls = ballsRef.current;
    const aim = aimRef.current;
    if (phaseRef.current !== "aim" || balls[0].potted) return;
    if (!shoot(balls, aim.angle, aim.power)) return;
    phaseRef.current = "moving";
    setPhase("moving");
    shotsRef.current += 1;
    setShots(shotsRef.current);
    sfxShoot();
  }, []);

  const restart = useCallback(() => {
    ballsRef.current = createRack();
    phaseRef.current = "aim";
    shotsRef.current = 0;
    pottedRef.current = 0;
    recordedRef.current = false;
    msgRef.current = null;
    setShots(0);
    setLeft(15);
    setPotted(0);
    setOver(false);
    setPhase("aim");
  }, []);

  const reposition = useCallback(() => {
    const balls = ballsRef.current;
    if (phaseRef.current !== "aim" || balls[0].potted) return;
    autoPlaceCue(balls);
    msgRef.current = {
      text: i18n.text("game.pool3d.repositioned"),
      until: performance.now() + 1500,
    };
  }, [i18n]);

  /* ── 渲染一帧 ──────────────────────────────────────────────────── */
  const renderFrame = (
    ctx: CanvasRenderingContext2D,
    balls: PoolBall[],
    ph: Phase,
    dark: boolean,
  ) => {
    const cam = camRef.current;
    ctx.clearRect(0, 0, CW, CH);

    drawTable(ctx, cam, dark);

    const cue = balls[0];
    const aim = aimRef.current;
    const inAim = ph === "aim" && !cue.potted && !over;

    if (inAim && aim.hasPointer) {
      drawAim(ctx, cam, balls, aim.angle);
    }

    // 球（按深度排序，远处先画）
    const drawables = balls
      .filter((b) => !b.potted)
      .map((b) => ({ b, d: worldToScreen(cam, b.x, b.y, BALL_R)?.zc ?? 0 }))
      .sort((a, c) => c.d - a.d);
    for (const { b } of drawables) drawBall(ctx, cam, b);

    if (inAim) {
      const pull = aim.charging ? aim.power * 9 : 0.4;
      drawCue(ctx, cam, cue, aim.angle, pull);
      if (aim.charging) drawPowerBar(ctx, aim.power, true);
      else drawPowerBar(ctx, DEFAULT_POWER, false);
    }

    // 白球复位提示
    if (msgRef.current && performance.now() < msgRef.current.until) {
      const msg = msgRef.current;
      const alpha = Math.min(1, (msg.until - performance.now()) / 400);
      const tw = ctx.measureText(msg.text).width;
      ctx.fillStyle = `rgba(0,0,0,${(0.4 * alpha).toFixed(3)})`;
      ctx.beginPath();
      ctx.roundRect(CW / 2 - tw / 2 - 14, 14, tw + 28, 32, 10);
      ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${(0.95 * alpha).toFixed(3)})`;
      ctx.font = "600 17px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(msg.text, CW / 2, 31);
    }
  };

  /* ── 主循环：物理 + 渲染 ───────────────────────────────────────── */
  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    const loop = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      const balls = ballsRef.current;
      const canvas = canvasRef.current;

      if (phaseRef.current === "moving") {
        const h = 1 / 120;
        const steps = Math.max(1, Math.min(8, Math.round(dt / h)));
        let cushion = 0;
        let impact = 0;
        let pottedCount = 0;
        for (let s = 0; s < steps; s++) {
          const r = stepBalls(balls, h);
          cushion += r.cushionHits;
          impact += r.ballImpacts;
          pottedCount += r.potted.length;
        }
        if (cushion > 0) sfxBounce();
        if (impact > 0) sfxHit();
        if (pottedCount > 0) {
          sfxDrop();
          pottedRef.current += pottedCount;
          if (balls[0].potted) {
            msgRef.current = {
              text: i18n.text("game.pool3d.cuePotted"),
              until: now + 1500,
            };
          }
        }
        if (!anyMoving(balls)) {
          // 白球落袋：自动复位
          if (balls[0].potted) autoPlaceCue(balls);
          const leftNow = countLeft(balls);
          pottedRef.current = 15 - leftNow;
          setLeft(leftNow);
          setPotted(pottedRef.current);
          if (leftNow === 0) {
            // 清台
            phaseRef.current = "over";
            setPhase("over");
            setOver(true);
            sfxWin();
            if (!recordedRef.current) {
              recordedRef.current = true;
              const s = shotsRef.current;
              const score = Math.max(1, 2000 - s * 60);
              const prev = Number(window.localStorage.getItem(LS_BEST) || 0);
              const nb = prev > 0 ? Math.min(prev, s) : s;
              window.localStorage.setItem(LS_BEST, String(nb));
              setBest(nb);
              recordScore({
                gameId: "pool3d",
                gameTitle: "3D 台球",
                score,
                detail: { shots: s, potted: 15 },
              });
            }
          } else {
            phaseRef.current = "aim";
            setPhase("aim");
          }
        }
      }

      // 渲染
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          renderFrame(ctx, balls, phaseRef.current, isDarkRef.current);
        }
      }
      raf = requestAnimationFrame(loop);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [i18n]);

  /* ── 指针交互 ──────────────────────────────────────────────────── */
  const planePoint = (e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const sx = ((e.clientX - rect.left) / rect.width) * CW;
    const sy = ((e.clientY - rect.top) / rect.height) * CH;
    return screenToPlane(camRef.current, sx, sy);
  };

  const updateAimFromPoint = (pt: { x: number; y: number }) => {
    const cue = ballsRef.current[0];
    const dx = pt.x - cue.x;
    const dy = pt.y - cue.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.5) return;
    const aim = aimRef.current;
    aim.angle = Math.atan2(dy, dx);
    if (aim.charging) {
      aim.power = clamp(dist / CHARGE_RANGE, 0.05, 1);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    // 右键拖拽：旋转视角（任何阶段可用）
    if (d?.mode === "view") {
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      applyView({
        ...d.view0,
        yaw: d.view0.yaw + dx * 0.006,
        pitch: clamp(d.view0.pitch + dy * 0.006, 20, 89),
      });
      return;
    }
    if (phaseRef.current !== "aim" || over) return;
    const pt = planePoint(e);
    if (!pt) return;
    aimRef.current.hasPointer = true;
    updateAimFromPoint(pt);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // 右键：开始旋转视角（不区分游戏阶段）
    if (e.button === 2) {
      e.preventDefault();
      dragRef.current = {
        mode: "view",
        x: e.clientX,
        y: e.clientY,
        view0: { ...viewRef.current },
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      setCanvasCursor("grabbing");
      return;
    }
    if (phaseRef.current !== "aim" || over) return;
    const pt = planePoint(e);
    if (!pt) return;
    dragRef.current = {
      mode: "aim",
      x: e.clientX,
      y: e.clientY,
      view0: { ...viewRef.current },
    };
    aimRef.current.charging = true;
    aimRef.current.hasPointer = true;
    updateAimFromPoint(pt);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    if (d.mode === "view") {
      setCanvasCursor("crosshair");
      return;
    }
    // 左键：松开击球
    const aim = aimRef.current;
    aim.charging = false;
    const pt = planePoint(e);
    if (pt) updateAimFromPoint(pt);
    if (aim.power >= 0.05) fireShot();
  };

  const onPointerLeave = () => {
    aimRef.current.hasPointer = false;
    aimRef.current.charging = false;
  };

  /** 滚轮缩放视角 */
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      const factor = e.deltaY > 0 ? 1.14 : 1 / 1.14;
      applyView({ ...v, dist: clamp(v.dist * factor, 80, 280) });
    };
    cv.addEventListener("wheel", onWheel, { passive: false });
    return () => cv.removeEventListener("wheel", onWheel);
  }, [applyView]);

  /* ── 键盘：空格击球、R 重开 ────────────────────────────────────── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === "Space") {
        e.preventDefault();
        fireShot();
      } else if (e.key.toLowerCase() === "r") {
        restart();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [fireShot, restart]);

  return (
    <GameFrame
      emoji="🎱"
      title={i18n.text("game.pool3d.title")}
      stats={[
        { label: i18n.text("game.pool3d.shots"), value: shots, colors: CHIP_GOLD },
        { label: i18n.text("game.pool3d.left"), value: left, colors: CHIP_RED },
        { label: i18n.text("game.pool3d.potted"), value: potted, colors: CHIP_GREEN },
        {
          label: i18n.text("game.pool3d.best"),
          value: best === null ? "—" : best,
          colors: CHIP_BLUE,
        },
      ]}
      headerExtra={
        <>
          <GhostBtn onClick={reposition} disabled={phase !== "aim" || over}>
            <AimOutlined />
            {i18n.text("game.pool3d.reposition")}
          </GhostBtn>
          <GhostBtn onClick={restart}>
            <ReloadOutlined />
            {i18n.text("game.pool3d.restart")}
          </GhostBtn>
        </>
      }
      help={i18n.text("game.pool3d.help")}
      maxWidth={700}
      padded={false}
    >
      <div style={{ position: "relative", width: "100%", maxWidth: 660 }}>
        <canvas
          ref={canvasRef}
          width={CW}
          height={CH}
          style={{
            width: "100%",
            height: "auto",
            aspectRatio: "2 / 1",
            display: "block",
            borderRadius: 12,
            cursor: "crosshair",
            touchAction: "none",
            userSelect: "none",
            WebkitUserSelect: "none",
          }}
          onPointerMove={onPointerMove}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerLeave}
          onContextMenu={(e) => e.preventDefault()}
        />

        {/* 视角控制 */}
        <div
          className="gs-stage-in"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
            justifyContent: "center",
            marginTop: 10,
          }}
        >
          <GhostBtn onClick={() => applyView({ ...DEFAULT_VIEW })}>
            {i18n.text("game.pool3d.viewDefault")}
          </GhostBtn>
          <GhostBtn onClick={() => applyView({ ...TOP_VIEW })}>
            {i18n.text("game.pool3d.viewTop")}
          </GhostBtn>
          <span
            style={{
              fontSize: 12,
              color: isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.55)",
            }}
          >
            {i18n.text("game.pool3d.viewHint")}
          </span>
        </div>

        {over && (
          <div
            className="gs-win-in"
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              gap: 10,
              alignItems: "center",
              justifyContent: "center",
              background: isDark
                ? "rgba(20,22,26,0.82)"
                : "rgba(253,251,247,0.88)",
              color: isDark ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.82)",
              borderRadius: 12,
              zIndex: 10,
            }}
          >
            <div style={{ fontSize: 34, lineHeight: 1.2 }}>🎱</div>
            <div style={{ fontSize: 24, fontWeight: 900 }}>
              {i18n.text("game.pool3d.win")}
            </div>
            <div style={{ fontSize: 14, opacity: 0.75, textAlign: "center" }}>
              {i18n.text("game.pool3d.winDetail", { shots })}
            </div>
            <div style={{ fontSize: 14, opacity: 0.75 }}>
              {i18n.text("game.pool3d.winBest", { best: best ?? shots })}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <PrimaryBtn onClick={restart}>
                <ReloadOutlined />
                {i18n.text("game.pool3d.again")}
              </PrimaryBtn>
            </div>
          </div>
        )}
      </div>
    </GameFrame>
  );
};

export default Pool3DGame;
