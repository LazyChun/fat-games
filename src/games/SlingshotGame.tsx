/*
 * SlingshotGame：引力弹弓（Gravity Slingshot）
 *
 * 驾驶一艘小探测器在星系中自由飞行：
 *   - ↑/W：主引擎（尾喷口）→ 沿机头方向加速
 *   - ↓/S：减速（前喷口）→ 逆机头方向刹车
 *   - ←/A、→/D：RCS 左右转向（侧喷口）
 * 所有行星对其施加牛顿引力；切入行星引力带（引力井）会免费获得大角度偏转
 * 与势能转化的速度飙升 = 引力弹弓，无需消耗能源。
 * 人类基地行星（绿色光环）补给半径内自动充能，抵达即切换“下一站”；
 * 陨石撞击损失能源并击退；深潜大气层持续掉能；能源归零 → 航线终止，
 * 按累计航行距离计分（1px = 1km）。
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ReloadOutlined } from "@ant-design/icons";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import { recordScore } from "../scoreClient";
import { useI18n } from "../hooks";
import GameFrame, {
  GhostBtn,
  PrimaryBtn,
  CHIP_GOLD,
  CHIP_BLUE,
  CHIP_GREEN,
  CHIP_RED,
  CHIP_PURPLE,
} from "./GameFrame";
import "./gameAnimations.less";
import {
  createRun,
  planetById,
  predictPath,
  shipSpeed,
  SLINGSHOT_PARAMS,
  stepSim,
  type EngineInput,
  type GameEvent,
  type Phase,
  type Planet,
  type RunState,
  type Ship,
  type World,
} from "./slingshotLogic";

const W = 760;
const H = 540;
const LS_BEST = "fat-games.slingshot.best";
const PREDICT_SECONDS = 4.5;
const PREDICT_STEPS = 40;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  color: string;
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  color: string;
  age: number;
  life: number;
}

interface Sim {
  world: World;
  run: RunState;
  particles: Particle[];
  texts: FloatText[];
  shake: number;
  time: number;
  maxSpeed: number;
  recorded: boolean;
  paused: boolean;
}

interface UiState {
  phase: Phase;
  distanceKm: number;
  energyPct: number;
  speed: number;
  nextDestName: string;
  baseReached: number;
  slingshots: number;
  refueling: boolean;
  inAtmo: boolean;
  best: number;
}

function newSim(): Sim {
  const { world, run } = createRun();
  return {
    world,
    run,
    particles: [],
    texts: [],
    shake: 0,
    time: 0,
    maxSpeed: 0,
    recorded: false,
    paused: false,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** 确定性二维哈希（用于星空网格，避免相机移动时星星漂移） */
function hash2(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/* ------------------------------------------------------------------ */
/* 绘制：星空 / 星云 / 行星 / 飞船 / 陨石 / 轨迹 / HUD / 小地图          */
/* ------------------------------------------------------------------ */

function drawStars(ctx: CanvasRenderingContext2D, camX: number, camY: number, time: number): void {
  const layers = [
    { par: 0.18, cell: 72, count: 0.65, base: 0.5 },
    { par: 0.42, cell: 46, count: 0.8, base: 0.8 },
  ];
  for (let li = 0; li < layers.length; li++) {
    const L = layers[li];
    const ox = camX * L.par;
    const oy = camY * L.par;
    const x0 = Math.floor(ox / L.cell) * L.cell;
    const y0 = Math.floor(oy / L.cell) * L.cell;
    const cols = Math.ceil(W / L.cell) + 1;
    const rows = Math.ceil(H / L.cell) + 1;
    for (let cx = 0; cx <= cols; cx++) {
      for (let cy = 0; cy <= rows; cy++) {
        const gx = x0 + cx * L.cell;
        const gy = y0 + cy * L.cell;
        const h = hash2(gx, gy);
        if (h > L.count) continue;
        const sx = gx - ox + ((h * 7919) % L.cell);
        const sy = gy - oy + ((h * 104729) % L.cell);
        const r = 0.5 + ((h * 31) % 10) / 10 * 1.3;
        const tw = 0.35 + 0.65 * Math.abs(Math.sin(time * (1.2 + h * 2.2) + h * 40));
        ctx.fillStyle = `rgba(255,255,255,${(L.base * tw).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
}

function drawNebula(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
  const spots: Array<[number, number, number, string]> = [
    [2760, 1420, 560, "hsla(265,70%,55%,0.085)"],
    [4520, 3020, 620, "hsla(200,80%,55%,0.07)"],
    [1400, 2400, 700, "hsla(165,70%,50%,0.055)"],
  ];
  for (const [wx, wy, r, col] of spots) {
    const sx = wx - camX * 0.15;
    const sy = wy - camY * 0.15;
    const g = ctx.createRadialGradient(sx, sy, r * 0.1, sx, sy, r);
    g.addColorStop(0, col);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(sx - r, sy - r, r * 2, r * 2);
  }
}

function drawPlanet(
  ctx: CanvasRenderingContext2D,
  p: Planet,
  sx: number,
  sy: number,
  time: number,
  isDest: boolean,
  showLabels: boolean,
): void {
  const hue = p.hue;
  // 引力带（虚线圆环）
  if (p.wellR > 0) {
    const wellAlpha = isDest ? 0.4 : p.kind === "giant" ? 0.3 : 0.16;
    ctx.setLineDash([7, 9]);
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = `hsla(${hue},70%,65%,${wellAlpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(sx, sy, p.wellR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 大气层（危险）环
  if (p.atmosphereR > p.radius) {
    ctx.strokeStyle = `hsla(${hue},80%,75%,0.30)`;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(sx, sy, p.atmosphereR, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 星球辉光
  const glowR = p.radius * 2.4;
  const g = ctx.createRadialGradient(sx, sy, p.radius * 0.3, sx, sy, glowR);
  g.addColorStop(0, `hsla(${hue},80%,60%,${p.kind === "star" ? 0.55 : 0.34})`);
  g.addColorStop(1, `hsla(${hue},80%,60%,0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(sx, sy, glowR, 0, Math.PI * 2);
  ctx.fill();

  if (p.kind === "star") {
    ctx.fillStyle = "#fff7e0";
    ctx.shadowColor = "#ffd76b";
    ctx.shadowBlur = 26;
    ctx.beginPath();
    ctx.arc(sx, sy, p.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    return;
  }

  // 球体
  const bg = ctx.createLinearGradient(sx - p.radius, sy - p.radius, sx + p.radius, sy + p.radius);
  bg.addColorStop(0, `hsl(${hue},72%,62%)`);
  bg.addColorStop(0.55, `hsl(${hue},62%,42%)`);
  bg.addColorStop(1, `hsl(${hue},65%,16%)`);
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.arc(sx, sy, p.radius, 0, Math.PI * 2);
  ctx.fill();
  // 明暗交界
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(sx - p.radius * 0.35, sy - p.radius * 0.3, p.radius * 0.92, 0, Math.PI * 2);
  ctx.stroke();

  // 基地：补给圈 + 信标
  if (p.kind === "base") {
    const pulse = 0.5 + 0.5 * Math.sin(time * 2.4 + p.hue);
    ctx.strokeStyle = `rgba(74,222,128,${(0.35 + 0.25 * pulse).toFixed(3)})`;
    ctx.lineWidth = 1.8;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.arc(sx, sy, p.refuelR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = `rgba(134,239,172,${(0.6 + 0.4 * pulse).toFixed(3)})`;
    ctx.shadowColor = "#4ade80";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(sx, sy, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // 目的地高亮环
  if (isDest) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 3.2);
    ctx.strokeStyle = `rgba(255,216,107,${(0.45 + 0.4 * pulse).toFixed(3)})`;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(sx, sy, p.radius + 8 + pulse * 3, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 名称标签
  if (showLabels) {
    const labelY = sy + p.radius + 14;
    ctx.font = p.kind === "base" ? "bold 11px sans-serif" : "10px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillText(p.name, sx + 0.7, labelY + 0.7);
    ctx.fillStyle = p.kind === "base" ? "rgba(190,242,210,0.95)" : "rgba(230,238,248,0.8)";
    ctx.fillText(p.name, sx, labelY);
  }
}

function drawShip(
  ctx: CanvasRenderingContext2D,
  ship: Ship,
  engines: EngineInput,
  time: number,
  sx: number,
  sy: number,
): void {
  const invuln = ship.invuln > 0;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(ship.angle);
  if (invuln) {
    ctx.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(time * 18));
  }

  const flick = (speed: number, seed: number) =>
    1 + 0.2 * Math.sin(time * speed + seed) + 0.12 * Math.sin(time * speed * 1.7 + seed * 2.3);

  // 火焰（先画，在机身下层）
  const flame = (len: number, half: number, dir: number, col: string[]) => {
    const ex = dir * len;
    const g = ctx.createLinearGradient(0, 0, ex, 0);
    g.addColorStop(0, col[0]);
    g.addColorStop(0.55, col[1]);
    g.addColorStop(1, "rgba(255,220,140,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(dir * 6, -half);
    ctx.lineTo(ex, 0);
    ctx.lineTo(dir * 6, half);
    ctx.closePath();
    ctx.fill();
  };
  if (engines.main) {
    flame(24 * flick(24, 1), 5.5, -1, ["rgba(255,190,90,0.95)", "rgba(255,120,40,0.7)"]);
  }
  if (engines.retro) {
    flame(13 * flick(22, 3), 3.4, 1, ["rgba(125,211,252,0.95)", "rgba(56,160,255,0.6)"]);
  }

  // 侧喷口 RCS 喷流
  if (engines.left) {
    flame(9 * flick(20, 5), 2.6, -1, ["rgba(196,181,253,0.9)", "rgba(139,92,246,0.55)"]);
    ctx.translate(0, 5.2);
    flame(9 * flick(20, 5), 2.6, -1, ["rgba(196,181,253,0.9)", "rgba(139,92,246,0.55)"]);
    ctx.translate(0, -5.2);
  } else if (engines.right) {
    ctx.translate(0, -5.2);
    flame(9 * flick(20, 7), 2.6, 1, ["rgba(196,181,253,0.9)", "rgba(139,92,246,0.55)"]);
    ctx.translate(0, 5.2);
    flame(9 * flick(20, 7), 2.6, 1, ["rgba(196,181,253,0.9)", "rgba(139,92,246,0.55)"]);
  }

  // 机翼（两侧）
  ctx.fillStyle = "#3b82f6";
  ctx.beginPath();
  ctx.moveTo(-2, -4.5);
  ctx.lineTo(-9, -9);
  ctx.lineTo(-6, -3.5);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-2, 4.5);
  ctx.lineTo(-9, 9);
  ctx.lineTo(-6, 3.5);
  ctx.closePath();
  ctx.fill();

  // 机身
  const bodyG = ctx.createLinearGradient(0, -4.5, 0, 4.5);
  bodyG.addColorStop(0, "#dbe4ee");
  bodyG.addColorStop(0.5, "#f4f8fc");
  bodyG.addColorStop(1, "#8fa0b4");
  ctx.fillStyle = bodyG;
  roundRect(ctx, -13, -4.5, 24, 9, 4);
  ctx.fill();

  // 机头锥
  ctx.fillStyle = "#1d4ed8";
  ctx.beginPath();
  ctx.moveTo(11, -4.2);
  ctx.lineTo(17.5, 0);
  ctx.lineTo(11, 4.2);
  ctx.closePath();
  ctx.fill();

  // 舷窗
  const winG = ctx.createRadialGradient(3.5, -1.2, 0.5, 4, 0, 3.4);
  winG.addColorStop(0, "#eafcff");
  winG.addColorStop(0.6, "#5cc8f0");
  winG.addColorStop(1, "#1f7fb8");
  ctx.fillStyle = winG;
  ctx.beginPath();
  ctx.arc(4, 0, 3.4, 0, Math.PI * 2);
  ctx.fill();

  // 尾喷口
  ctx.fillStyle = "#4b5563";
  roundRect(ctx, -16, -3, 5, 6, 1.5);
  ctx.fill();
  ctx.fillStyle = "#374151";
  ctx.fillRect(-17.5, -4, 2.5, 8);
  // 前喷口（减速）
  ctx.fillStyle = "#4b5563";
  roundRect(ctx, 14.5, -2.2, 4, 4.4, 1.4);
  ctx.fill();
  // 侧喷口
  for (const side of [-1, 1]) {
    ctx.fillStyle = "#5b6470";
    roundRect(ctx, -3, side * 4.5 - 1.4, 4.5, 2.8, 1.2);
    ctx.fill();
  }

  ctx.restore();

  // 无敌护盾圈
  if (invuln) {
    const r = 18 + Math.sin(time * 10) * 2;
    ctx.strokeStyle = "rgba(147,197,253,0.55)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

/* 飞船定位光环：让玩家随时能看到探测器位置 */
function drawShipMarker(ctx: CanvasRenderingContext2D, sx: number, sy: number, time: number, label: string): void {
  const pulse = 1 + 0.14 * Math.sin(time * 3.2);
  ctx.save();
  const glow = ctx.createRadialGradient(sx, sy, 2, sx, sy, 26);
  glow.addColorStop(0, "rgba(120,220,255,0.30)");
  glow.addColorStop(1, "rgba(120,220,255,0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(sx, sy, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(140,225,255,0.6)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(sx, sy, 15 * pulse, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(140,225,255,0.22)";
  ctx.beginPath();
  ctx.arc(sx, sy, 21 * pulse, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "rgba(205,238,255,0.95)";
  ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillText(`🛰 ${label}`, sx, sy + 17);
  ctx.restore();
}

function drawMeteor(ctx: CanvasRenderingContext2D, mx: number, my: number, r: number): void {
  const rot = (mx * 13.7 + my * 7.3) % (Math.PI * 2);
  ctx.save();
  ctx.translate(mx, my);
  ctx.rotate(rot);
  const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
  g.addColorStop(0, "#d6c9b8");
  g.addColorStop(0.6, "#8a7662");
  g.addColorStop(1, "#3d3229");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  for (let i = 0; i < 3; i++) {
    const hh = hash2(mx + i * 7, my + i * 13);
    ctx.beginPath();
    ctx.arc((hh - 0.5) * r * 1.2, (hash2(mx + i * 31, my + i * 17) - 0.5) * r * 1.2, r * 0.16 + hh * r * 0.14, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawTrajectory(
  ctx: CanvasRenderingContext2D,
  pts: Array<{ x: number; y: number }>,
  camX: number,
  camY: number,
): void {
  const n = pts.length;
  for (let i = 0; i < n; i += 2) {
    const t = i / n;
    const sx = pts[i].x - camX;
    const sy = pts[i].y - camY;
    if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) continue;
    ctx.fillStyle = `rgba(125,211,252,${(0.5 * (1 - t * 0.85)).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(sx, sy, 2.4 * (1 - t * 0.6), 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHUD(
  ctx: CanvasRenderingContext2D,
  sim: Sim,
  t: (id: string, v?: Record<string, string | number>) => string,
): void {
  const run = sim.run;
  ctx.save();
  ctx.textBaseline = "middle";

  // ── 左上：能源条 ──
  const bw = 196;
  const bh = 15;
  const bx = 14;
  const by = 14;
  const pct = clamp(run.ship.energy, 0, 1);
  const refueling = Object.values(run.wasInRefuel).some(Boolean);
  roundRect(ctx, bx - 2, by - 2, bw + 4, bh + 4, 9);
  ctx.fillStyle = "rgba(4,8,16,0.6)";
  ctx.fill();
  const fg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  fg.addColorStop(0, "#4ade80");
  fg.addColorStop(0.55, "#facc15");
  fg.addColorStop(1, "#ef4444");
  ctx.fillStyle = fg;
  roundRect(ctx, bx, by, Math.max(5, bw * pct), bh, 6);
  ctx.fill();
  if (refueling) {
    ctx.strokeStyle = "rgba(74,222,128,0.85)";
    ctx.lineWidth = 2;
    roundRect(ctx, bx - 2, by - 2, bw + 4, bh + 4, 9);
    ctx.stroke();
  }
  ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.fillText(
    `${t("game.slingshot.energy")} ${Math.round(pct * 100)}%`,
    bx + 7,
    by + bh / 2 + 0.5,
  );
  if (refueling) {
    ctx.fillStyle = "#86efac";
    ctx.fillText(`⚡ ${t("game.slingshot.refueling")}`, bx + bw + 12, by + bh / 2 + 0.5);
  }

  // ── 右上：航行距离 ──
  ctx.textAlign = "right";
  ctx.font = "bold 12px sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.fillText(t("game.slingshot.distance"), W - 14, 20);
  ctx.font = "bold 22px sans-serif";
  ctx.fillStyle = "#ffd86b";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 5;
  ctx.fillText(`${Math.round(run.distancePx).toLocaleString()} km`, W - 14, 42);
  ctx.shadowBlur = 0;

  // ── 左下：航速 ──
  const spd = shipSpeed(run.ship);
  roundRect(ctx, 14, H - 46, 132, 32, 9);
  ctx.fillStyle = "rgba(4,8,16,0.5)";
  ctx.fill();
  ctx.textAlign = "left";
  ctx.font = "bold 12px sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  ctx.fillText(`${t("game.slingshot.speed")}`, 24, H - 36);
  ctx.fillStyle = "#a5f3fc";
  ctx.font = "bold 15px sans-serif";
  ctx.fillText(`${Math.round(spd).toLocaleString()} km/s`, 24, H - 20);

  // ── 大气层告警 ──
  if (run.inAtmo && run.phase === "flying") {
    const pulse = 0.55 + 0.45 * Math.sin(sim.time * 9);
    ctx.textAlign = "center";
    roundRect(ctx, W / 2 - 150, 16, 300, 30, 15);
    ctx.fillStyle = `rgba(190,60,20,${(0.5 + 0.3 * pulse).toFixed(3)})`;
    ctx.fill();
    ctx.strokeStyle = `rgba(255,170,90,${(0.5 + 0.5 * pulse).toFixed(3)})`;
    ctx.lineWidth = 1.6;
    roundRect(ctx, W / 2 - 150, 16, 300, 30, 15);
    ctx.stroke();
    ctx.font = "bold 13px sans-serif";
    ctx.fillStyle = "#ffe8d1";
    ctx.fillText(`⚠ ${t("game.slingshot.atmoWarning")}`, W / 2, 31.5);
  }

  // ── 低能源警示 ──
  if (run.phase === "flying" && pct < 0.22) {
    const pulse = 0.5 + 0.5 * Math.sin(sim.time * 6);
    ctx.strokeStyle = `rgba(239,68,68,${(0.25 + 0.45 * pulse).toFixed(3)})`;
    ctx.lineWidth = 5;
    ctx.strokeRect(7, 7, W - 14, H - 14);
  }

  ctx.restore();
}

function drawMiniMap(
  ctx: CanvasRenderingContext2D,
  world: World,
  run: RunState,
  camX: number,
  camY: number,
  time: number,
): void {
  const mw = 156;
  const mh = Math.round((mw * world.height) / world.width);
  const mx = W - mw - 12;
  const my = H - mh - 12;
  ctx.save();
  roundRect(ctx, mx - 4, my - 4, mw + 8, mh + 8, 8);
  ctx.fillStyle = "rgba(4,8,16,0.6)";
  ctx.fill();
  ctx.strokeStyle = "rgba(120,150,180,0.35)";
  ctx.lineWidth = 1;
  roundRect(ctx, mx - 4, my - 4, mw + 8, mh + 8, 8);
  ctx.stroke();

  const px = (wx: number) => mx + (wx / world.width) * mw;
  const py = (wy: number) => my + (wy / world.height) * mh;

  for (const p of world.planets) {
    if (p.kind === "star") continue;
    const r = p.kind === "giant" ? 3.6 : p.kind === "base" ? 3 : 1.7;
    ctx.fillStyle =
      p.kind === "base" ? "#4ade80" : p.kind === "giant" ? "#c4b5fd" : "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.arc(px(p.x), py(p.y), r, 0, Math.PI * 2);
    ctx.fill();
    if (p.id === run.nextDestId) {
      const pulse = 0.6 + 0.4 * Math.sin(time * 4);
      ctx.strokeStyle = `rgba(255,216,107,${pulse.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(px(p.x), py(p.y), r + 3, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // 当前视野
  ctx.strokeStyle = "rgba(160,200,255,0.5)";
  ctx.lineWidth = 1;
  ctx.strokeRect(px(camX), py(camY), (W / world.width) * mw, (H / world.height) * mh);

  // 飞船
  const sx = px(run.ship.x);
  const sy = py(run.ship.y);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(sx, sy, 2.6, 0, Math.PI * 2);
  ctx.fill();
  const head = run.ship.angle;
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(sx + Math.cos(head) * 6, sy + Math.sin(head) * 6);
  ctx.stroke();
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* 组件                                                                */
/* ------------------------------------------------------------------ */

const SlingshotGame: React.FC<{ sdk: FatNotesPluginSDK }> = () => {
  const i18n = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<Sim>(newSim());
  const inputsRef = useRef<EngineInput>({ main: false, retro: false, left: false, right: false });
  const lastUiRef = useRef<UiState>({
    phase: "idle",
    distanceKm: 0,
    energyPct: 100,
    speed: 0,
    nextDestName: "",
    baseReached: 0,
    slingshots: 0,
    refueling: false,
    inAtmo: false,
    best: Number(window.localStorage.getItem(LS_BEST) || 0),
  });
  const [ui, setUi] = useState<UiState>(lastUiRef.current);
  const tRef = useRef(i18n.text);
  tRef.current = i18n.text;

  const syncUi = (s: Sim) => {
    const run = s.run;
    const dest = planetById(s.world, run.nextDestId);
    const next: UiState = {
      phase: run.phase,
      distanceKm: Math.round(run.distancePx),
      energyPct: Math.round(run.ship.energy * 100),
      speed: Math.round(shipSpeed(run.ship)),
      nextDestName: dest ? dest.name : "",
      baseReached: run.baseReached,
      slingshots: run.slingshots,
      refueling: Object.values(run.wasInRefuel).some(Boolean),
      inAtmo: run.inAtmo,
      best: lastUiRef.current.best,
    };
    const prev = lastUiRef.current;
    if (
      next.phase !== prev.phase ||
      next.distanceKm !== prev.distanceKm ||
      next.energyPct !== prev.energyPct ||
      Math.abs(next.speed - prev.speed) >= 5 ||
      next.nextDestName !== prev.nextDestName ||
      next.baseReached !== prev.baseReached ||
      next.slingshots !== prev.slingshots ||
      next.refueling !== prev.refueling ||
      next.inAtmo !== prev.inAtmo
    ) {
      lastUiRef.current = next;
      setUi(next);
    }
  };

  const updateBest = useCallback((score: number) => {
    if (score > lastUiRef.current.best) {
      lastUiRef.current.best = score;
      window.localStorage.setItem(LS_BEST, String(score));
    }
  }, []);

  const reset = useCallback(() => {
    simRef.current = newSim();
    inputsRef.current = { main: false, retro: false, left: false, right: false };
    lastUiRef.current = {
      ...lastUiRef.current,
      phase: "idle",
      distanceKm: 0,
      energyPct: 100,
      speed: 0,
      baseReached: 0,
      slingshots: 0,
      refueling: false,
      inAtmo: false,
    };
    setUi(lastUiRef.current);
  }, []);

  const start = useCallback(() => {
    const s = simRef.current;
    if (s.run.phase === "idle") {
      s.run.phase = "flying";
      s.time = 0;
    } else if (s.run.phase === "over") {
      const fresh = newSim();
      fresh.run.phase = "flying";
      simRef.current = fresh;
      inputsRef.current = { main: false, retro: false, left: false, right: false };
      lastUiRef.current = {
        ...lastUiRef.current,
        phase: "flying",
        distanceKm: 0,
        energyPct: 100,
        speed: 0,
        baseReached: 0,
        slingshots: 0,
        refueling: false,
        inAtmo: false,
      };
      setUi(lastUiRef.current);
    } else if (s.run.phase === "paused") {
      s.run.phase = "flying";
    }
  }, []);

  const togglePause = useCallback(() => {
    const s = simRef.current;
    if (s.run.phase === "flying") {
      s.run.phase = "paused";
    } else if (s.run.phase === "paused") {
      s.run.phase = "flying";
    }
  }, []);

  const setEngine = useCallback((id: keyof EngineInput, on: boolean) => {
    inputsRef.current[id] = on;
  }, []);

  const pushText = (s: Sim, x: number, y: number, text: string, color: string, life = 1.5) => {
    s.texts.push({ x, y, text, color, age: 0, life });
    if (s.texts.length > 14) s.texts.shift();
  };

  const burst = useCallback((s: Sim, x: number, y: number, colors: string[], n: number, power: number) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = (0.3 + Math.random() * 0.8) * power;
      s.particles.push({
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        age: 0,
        life: 0.4 + Math.random() * 0.7,
        size: 2 + Math.random() * 4,
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
    if (s.particles.length > 240) {
      s.particles.splice(0, s.particles.length - 240);
    }
  }, []);

  // 主循环
  useEffect(() => {
    let raf = 0;
    let lastTs = 0;

    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      const s = simRef.current;
      if (!lastTs) lastTs = ts;
      const dt = Math.min(0.05, Math.max(0.001, (ts - lastTs) / 1000));
      lastTs = ts;
      s.time += dt;
      const world = s.world;
      const run = s.run;
      const t = tRef.current;

      if (run.phase === "flying" && !s.paused) {
        const events: GameEvent[] = [];
        stepSim(run, inputsRef.current, world, SLINGSHOT_PARAMS, dt, events);

        // 事件 → 反馈
        for (const ev of events) {
          switch (ev.type) {
            case "base_arrived":
              pushText(s, ev.x, ev.y, t("game.slingshot.arrived", { name: ev.name }), "#86efac", 1.8);
              burst(s, ev.x, ev.y, ["#4ade80", "#86efac", "#bbf7d0"], 14, 160);
              break;
            case "slingshot":
              pushText(s, ev.x, ev.y, t("game.slingshot.slingshot", { deg: ev.turnDeg }), "#7dd3fc", 1.6);
              burst(s, ev.x, ev.y, ["#7dd3fc", "#bae6fd", "#e0f2fe"], 10, 120);
              break;
            case "meteor_hit":
              pushText(s, ev.x, ev.y, t("game.slingshot.meteorHit"), "#fb923c", 1.4);
              burst(s, ev.x, ev.y, ["#fbbf24", "#fb923c", "#ef4444", "#f8fafc"], 20, 260);
              s.shake = 12;
              break;
            case "bounce":
              pushText(s, ev.x, ev.y, t("game.slingshot.bounce"), "#f87171", 1.3);
              burst(s, ev.x, ev.y, ["#f87171", "#fca5a5", "#fde68a"], 14, 200);
              s.shake = 8;
              break;
            case "atmo_enter":
              pushText(s, ev.x, ev.y, t("game.slingshot.atmoWarning"), "#fdba74", 1.9);
              break;
            default:
              break;
          }
        }

        // 补给星尘
        if (Object.values(run.wasInRefuel).some(Boolean)) {
          const a = Math.random() * Math.PI * 2;
          const d = 14 + Math.random() * 26;
          s.particles.push({
            x: run.ship.x + Math.cos(a) * d,
            y: run.ship.y + Math.sin(a) * d,
            vx: (Math.random() - 0.5) * 20,
            vy: -20 - Math.random() * 30,
            age: 0,
            life: 0.5 + Math.random() * 0.4,
            size: 1.4 + Math.random() * 1.8,
            color: "#4ade80",
          });
        }
        // 引擎尾焰粒子
        const inp = inputsRef.current;
        if (inp.main && run.ship.energy > 0) {
          const bx = run.ship.x - Math.cos(run.ship.angle) * 18;
          const by = run.ship.y - Math.sin(run.ship.angle) * 18;
          s.particles.push({
            x: bx + (Math.random() - 0.5) * 5,
            y: by + (Math.random() - 0.5) * 5,
            vx: -Math.cos(run.ship.angle) * (80 + Math.random() * 60),
            vy: -Math.sin(run.ship.angle) * (80 + Math.random() * 60),
            age: 0,
            life: 0.25 + Math.random() * 0.2,
            size: 1.6 + Math.random() * 1.8,
            color: Math.random() < 0.5 ? "#fb923c" : "#fbbf24",
          });
        }

        // 最高航速记录
        s.maxSpeed = Math.max(s.maxSpeed, shipSpeed(run.ship));
      }

      // 粒子 / 文字推进
      for (const pt of s.particles) {
        pt.age += dt;
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
      }
      s.particles = s.particles.filter((p) => p.age < p.life);
      for (const ft of s.texts) {
        ft.age += dt;
        ft.y -= 26 * dt;
      }
      s.texts = s.texts.filter((f) => f.age < f.life);
      if (s.shake > 0) s.shake = Math.max(0, s.shake - 55 * dt);

      // 终局结算（只一次）
      if (run.phase === "over" && !s.recorded) {
        s.recorded = true;
        const score = Math.round(run.distancePx);
        updateBest(score);
        recordScore({
          gameId: "slingshot",
          gameTitle: "引力弹弓",
          score,
          detail: {
            distanceKm: score,
            bases: run.baseReached,
            slingshots: run.slingshots,
            timeSec: Math.round(run.time),
            maxSpeed: Math.round(s.maxSpeed),
          },
        });
      }

      // ── 渲染 ──
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
        canvas.width = W * dpr;
        canvas.height = H * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      // 背景
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#05070f");
      bg.addColorStop(1, "#0a1120");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // 相机
      const camX = clamp(run.ship.x - W / 2, 0, Math.max(0, world.width - W));
      const camY = clamp(run.ship.y - H / 2, 0, Math.max(0, world.height - H));

      ctx.save();
      if (s.shake > 0.5) {
        ctx.translate((Math.random() - 0.5) * s.shake, (Math.random() - 0.5) * s.shake);
      }

      drawNebula(ctx, camX, camY);
      drawStars(ctx, camX, camY, s.time);

      // 行星
      const destPlanet = planetById(world, run.nextDestId);
      for (const p of world.planets) {
        const sx = p.x - camX;
        const sy = p.y - camY;
        if (sx < -p.wellR - 40 || sx > W + p.wellR + 40 || sy < -p.wellR - 40 || sy > H + p.wellR + 40) {
          continue;
        }
        drawPlanet(ctx, p, sx, sy, s.time, destPlanet?.id === p.id, true);
      }

      // 轨迹预测
      if (run.phase !== "over") {
        const pts = predictPath(run.ship, inputsRef.current, world, SLINGSHOT_PARAMS, PREDICT_SECONDS, PREDICT_STEPS);
        drawTrajectory(ctx, pts, camX, camY);
      }

      // 陨石
      for (const mt of run.meteors) {
        const sx = mt.x - camX;
        const sy = mt.y - camY;
        if (sx < -30 || sx > W + 30 || sy < -30 || sy > H + 30) continue;
        drawMeteor(ctx, sx, sy, mt.radius);
      }

      // 飞船
      if (run.phase !== "over") {
        const shx = run.ship.x - camX;
        const shy = run.ship.y - camY;
        drawShip(ctx, run.ship, inputsRef.current, s.time, shx, shy);
        drawShipMarker(ctx, shx, shy, s.time, i18n.text("game.slingshot.ship"));
      }

      // 粒子 / 浮动文字（世界坐标）
      for (const pt of s.particles) {
        const t0 = clamp(pt.age / pt.life, 0, 1);
        ctx.globalAlpha = (1 - t0) * 0.9;
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(pt.x - camX, pt.y - camY, Math.max(0.4, pt.size * (1 - t0 * 0.5)), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      for (const ft of s.texts) {
        const t0 = clamp(ft.age / ft.life, 0, 1);
        const alpha = t0 < 0.15 ? t0 / 0.15 : 1 - (t0 - 0.15) / 0.85;
        ctx.font = "bold 13px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.globalAlpha = Math.max(0, alpha);
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(0,0,0,0.6)";
        ctx.strokeText(ft.text, ft.x - camX, ft.y - camY);
        ctx.fillStyle = ft.color;
        ctx.fillText(ft.text, ft.x - camX, ft.y - camY);
      }
      ctx.globalAlpha = 1;

      ctx.restore();

      // 屏幕空间 HUD / 小地图
      drawHUD(ctx, s, t);
      drawMiniMap(ctx, world, run, camX, camY, s.time);

      syncUi(s);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [burst, updateBest]);

  // 键盘
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) {
        e.preventDefault();
      }
      const s = simRef.current;
      if (k === " ") {
        if (s.run.phase === "idle" || s.run.phase === "over") {
          start();
        } else if (s.run.phase === "paused") {
          s.run.phase = "flying";
        }
        return;
      }
      if (k === "p") {
        togglePause();
        return;
      }
      const map: Record<string, keyof EngineInput> = {
        arrowup: "main",
        w: "main",
        arrowdown: "retro",
        s: "retro",
        arrowleft: "left",
        a: "left",
        arrowright: "right",
        d: "right",
      };
      if (map[k]) inputsRef.current[map[k]] = true;
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const map: Record<string, keyof EngineInput> = {
        arrowup: "main",
        w: "main",
        arrowdown: "retro",
        s: "retro",
        arrowleft: "left",
        a: "left",
        arrowright: "right",
        d: "right",
      };
      if (map[k]) inputsRef.current[map[k]] = false;
    };
    const blur = () => {
      inputsRef.current = { main: false, retro: false, left: false, right: false };
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [start, togglePause]);

  const destName = ui.nextDestName || "—";

  return (
    <GameFrame
      emoji="🛰️"
      title={i18n.text("game.slingshot.title")}
      stats={[
        { label: i18n.text("game.slingshot.distance"), value: `${ui.distanceKm.toLocaleString()} km`, colors: CHIP_GOLD },
        {
          label: i18n.text("game.slingshot.energy"),
          value: `${ui.energyPct}%`,
          colors: ui.energyPct <= 30 ? CHIP_RED : ui.energyPct <= 60 ? CHIP_GOLD : CHIP_GREEN,
        },
        { label: i18n.text("game.slingshot.slingshots"), value: ui.slingshots, colors: CHIP_BLUE },
        { label: i18n.text("game.slingshot.best"), value: `${ui.best.toLocaleString()} km`, colors: CHIP_PURPLE },
      ]}
      headerExtra={
        <GhostBtn onClick={reset}>
          <ReloadOutlined />
          {i18n.text("game.slingshot.restart")}
        </GhostBtn>
      }
      help={i18n.text("game.slingshot.help")}
      maxWidth={820}
    >
      <div
        style={{
          position: "relative",
          width: W,
          height: H,
          borderRadius: 14,
          overflow: "hidden",
          boxShadow: "0 10px 30px rgba(5,8,20,0.45)",
          border: "2px solid rgba(120,150,180,0.35)",
        }}
      >
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          style={{ display: "block", width: W, height: H }}
        />

        {/* 待机：底部信息卡，不遮挡画面中央的飞船 */}
        {ui.phase === "idle" && (
          <div
            className="gs-pulse"
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(5,8,20,0.2)",
              display: "flex",
              flexDirection: "column",
              gap: 14,
              alignItems: "center",
              justifyContent: "flex-end",
              paddingBottom: 22,
              color: "#fff",
            }}
          >
            <div
              style={{
                background: "rgba(5,8,20,0.62)",
                border: "1px solid rgba(120,200,255,0.18)",
                borderRadius: 14,
                padding: "12px 20px 14px",
                display: "flex",
                flexDirection: "column",
                gap: 8,
                alignItems: "center",
                maxWidth: 560,
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 800, textAlign: "center", lineHeight: 1.55 }}>
                {i18n.text("game.slingshot.idle")}
              </div>
              <div style={{ fontSize: 12, opacity: 0.75 }}>{i18n.text("game.slingshot.idleTip")}</div>
              <PrimaryBtn onClick={start}>{i18n.text("game.slingshot.start")}</PrimaryBtn>
            </div>
          </div>
        )}

        {/* 暂停 */}
        {ui.phase === "paused" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(5,8,20,0.55)",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
            }}
          >
            <div style={{ fontSize: 26, fontWeight: 900 }}>⏸ {i18n.text("game.slingshot.paused")}</div>
            <div style={{ fontSize: 13, opacity: 0.8 }}>{i18n.text("game.slingshot.resumeTip")}</div>
            <PrimaryBtn onClick={togglePause}>{i18n.text("game.slingshot.resume")}</PrimaryBtn>
          </div>
        )}

        {/* 终局 */}
        {ui.phase === "over" && (
          <div
            className="gs-win-in"
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(30,6,12,0.6)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              alignItems: "center",
              justifyContent: "center",
              color: "#ffe3dd",
            }}
          >
            <div style={{ fontSize: 32, fontWeight: 900 }}>💥 {i18n.text("game.slingshot.overTitle")}</div>
            <div style={{ fontSize: 14.5, opacity: 0.9 }}>{i18n.text("game.slingshot.overSub")}</div>
            <div style={{ fontSize: 30, fontWeight: 900, color: "#ffd86b" }}>
              {ui.distanceKm.toLocaleString()} km
            </div>
            <div style={{ fontSize: 13.5, opacity: 0.95 }}>
              {i18n.text("game.slingshot.overStats", {
                bases: ui.baseReached,
                slings: ui.slingshots,
                speed: ui.speed,
              })}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
              <PrimaryBtn onClick={start}>
                <ReloadOutlined />
                {i18n.text("game.slingshot.again")}
              </PrimaryBtn>
              <GhostBtn onClick={reset}>{i18n.text("game.slingshot.restart")}</GhostBtn>
            </div>
          </div>
        )}
      </div>

      {/* 喷口控制面板（按住点火） */}
      <div
        style={{
          marginTop: 10,
          display: "grid",
          gridTemplateColumns: "repeat(3, 88px)",
          gridTemplateRows: "repeat(2, 58px)",
          gap: 8,
          justifyItems: "center",
        }}
      >
        <ThrusterBtn
          label="◀"
          sub={i18n.text("game.slingshot.rotateL")}
          nozzle={i18n.text("game.slingshot.nozzleL")}
          on={inputsRef.current.left}
          onDown={() => setEngine("left", true)}
          onUp={() => setEngine("left", false)}
        />
        <ThrusterBtn
          label="▲"
          sub={i18n.text("game.slingshot.thrustMain")}
          nozzle={i18n.text("game.slingshot.nozzleMain")}
          on={inputsRef.current.main}
          onDown={() => setEngine("main", true)}
          onUp={() => setEngine("main", false)}
        />
        <ThrusterBtn
          label="▶"
          sub={i18n.text("game.slingshot.rotateR")}
          nozzle={i18n.text("game.slingshot.nozzleR")}
          on={inputsRef.current.right}
          onDown={() => setEngine("right", true)}
          onUp={() => setEngine("right", false)}
        />
        <div />
        <ThrusterBtn
          label="▼"
          sub={i18n.text("game.slingshot.thrustRetro")}
          nozzle={i18n.text("game.slingshot.nozzleRetro")}
          on={inputsRef.current.retro}
          onDown={() => setEngine("retro", true)}
          onUp={() => setEngine("retro", false)}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 11,
            color: "rgba(128,128,128,0.75)",
          }}
        >
          {i18n.text("game.slingshot.holdTip")}
        </div>
      </div>
    </GameFrame>
  );
};

function ThrusterBtn({
  label,
  sub,
  nozzle,
  on,
  onDown,
  onUp,
}: {
  label: string;
  sub: string;
  nozzle: string;
  on: boolean;
  onDown: () => void;
  onUp: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      onPointerDown={(e) => {
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        onDown();
      }}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerLeave={onUp}
      onContextMenu={(e) => e.preventDefault()}
      style={{
        width: 88,
        height: 58,
        borderRadius: 14,
        border: `2px solid ${on ? "#4facfe" : "rgba(128,128,128,0.35)"}`,
        background: on
          ? "linear-gradient(135deg, #4facfe 0%, #1677ff 100%)"
          : "rgba(128,128,128,0.10)",
        color: on ? "#fff" : "rgba(0,0,0,0.72)",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 1,
        userSelect: "none",
        touchAction: "none",
        boxShadow: on ? "0 4px 12px rgba(22,119,255,0.4)" : "none",
        transition: "all 0.1s ease",
      }}
    >
      <span style={{ fontSize: 19, fontWeight: 900, lineHeight: 1 }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: 700, lineHeight: 1.1 }}>{sub}</span>
      <span style={{ fontSize: 9.5, opacity: 0.6, lineHeight: 1.1 }}>{nozzle}</span>
    </button>
  );
}

export default SlingshotGame;
