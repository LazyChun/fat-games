/*
 * RocketLandingGame：星舰回收（Starship Recovery）
 *
 * 一艘星舰从外太空返回，携带 上/下/左/右 四个反推喷口：
 *   - ↑ / W：点火上喷口（顶喷口）→ 向下压（加速下降）
 *   - ↓ / S：点火下喷口（尾喷口）→ 向上刹车减速
 *   - ← / A：点火左喷口 → 顺时针转向（机头向右摆，喷气反作用）
 *   - → / D：点火右喷口 → 逆时针转向（机头向左摆，喷气反作用）
 * 点火消耗燃料；机头略微倾斜后点火下喷口即可横向平移。
 * 目标：让机尾朝下、在着陆点内低速轻柔着陆。
 * 着陆成功加分并进入下一发；越靠后的星舰初始下落越快、燃料越少；
 * 速度过快 / 姿态倾斜 / 落点偏离都会坠毁，坠毁后记录总分。
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
  defaultWorld,
  evaluateLanding,
  landingScore,
  normalizeAngle,
  ROCKET_PARAMS,
  spawnRocket,
  stepRocket,
  tailWorld,
  type EngineId,
  type EngineInput,
  type LandingVerdict,
  type RocketState,
  type RocketWorld,
} from "./rocketLogic";

const W = 560;
const H = 760;
const LS_BEST = "fat-games.starship.best";
const LANDED_DELAY = 1400; // 着陆成功后下一发间隔（ms）

type Phase = "idle" | "flying" | "landed" | "crashed";

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

/** 坠毁解体碎片：火箭被炸开的机头 / 机身 / 舷窗 / 尾翼小块 */
interface Debris {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  spin: number;
  kind: "nose" | "body" | "window" | "fin";
  size: number;
  age: number;
  life: number;
}

interface Sim {
  rocket: RocketState;
  wave: number;
  score: number;
  landings: number;
  phase: Phase;
  landedAt: number;
  lastTs: number;
  lastScore: number;
  particles: Particle[];
  debris: Debris[];
  shake: number;
  time: number;
  recorded: boolean;
}

interface UiState {
  phase: Phase;
  score: number;
  wave: number;
  fuel: number;
  best: number;
}

function newSim(): Sim {
  const world = defaultWorld();
  return {
    rocket: spawnRocket(1, world),
    wave: 1,
    score: 0,
    landings: 0,
    phase: "idle",
    landedAt: 0,
    lastTs: 0,
    lastScore: 0,
    particles: [],
    debris: [],
    shake: 0,
    time: 0,
    recorded: false,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** 火箭四个端点（用于触地爆炸点选择） */
function rocketPoints(s: RocketState): Array<{ x: number; y: number }> {
  const p = ROCKET_PARAMS;
  const a = s.angle;
  return [
    { x: s.x + p.halfLen * Math.sin(a), y: s.y - p.halfLen * Math.cos(a) }, // nose
    { x: s.x - p.halfWid * Math.cos(a), y: s.y - p.halfWid * Math.sin(a) }, // left
    { x: s.x + p.halfWid * Math.cos(a), y: s.y + p.halfWid * Math.sin(a) }, // right
    { x: s.x - p.halfLen * Math.sin(a), y: s.y + p.halfLen * Math.cos(a) }, // tail
  ];
}

/* ------------------------------------------------------------------ */
/* 绘制：星空 / 地面 / 火箭 / 粒子 / HUD                                 */
/* ------------------------------------------------------------------ */

interface Star {
  x: number;
  y: number;
  r: number;
  tw: number;
  ph: number;
}

function makeStars(count: number): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random() * W,
      y: Math.random() * H * 0.5,
      r: 0.6 + Math.random() * 1.4,
      tw: 0.4 + Math.random() * 0.5,
      ph: Math.random() * Math.PI * 2,
    });
  }
  return stars;
}

const STARS = makeStars(70);

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

function drawSky(ctx: CanvasRenderingContext2D, time: number, world: RocketWorld): void {
  const g = ctx.createLinearGradient(0, 0, 0, world.groundY);
  g.addColorStop(0, "#05070f");
  g.addColorStop(0.45, "#0b1630");
  g.addColorStop(0.8, "#1d3a5c");
  g.addColorStop(1, "#37618a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, world.groundY);

  // 星星（上层闪烁）
  for (const s of STARS) {
    const alpha = s.tw * (0.55 + 0.45 * Math.sin(time * 2 + s.ph));
    ctx.fillStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 远处的行星
  const px = W - 84;
  const py = 108;
  const pg = ctx.createRadialGradient(px - 4, py - 4, 2, px, py, 20);
  pg.addColorStop(0, "#f7e7c8");
  pg.addColorStop(1, "#c99b5a");
  ctx.fillStyle = pg;
  ctx.beginPath();
  ctx.arc(px, py, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(px, py, 26, 7, -0.35, 0, Math.PI * 2);
  ctx.stroke();

  // 大气层辉光
  const haze = ctx.createLinearGradient(0, world.groundY - 90, 0, world.groundY);
  haze.addColorStop(0, "rgba(120,180,230,0)");
  haze.addColorStop(1, "rgba(140,200,240,0.35)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, world.groundY - 90, W, 90);
}

function drawGround(ctx: CanvasRenderingContext2D, time: number, world: RocketWorld): void {
  // 地面岩层
  const g = ctx.createLinearGradient(0, world.groundY, 0, H);
  g.addColorStop(0, "#4a3b2c");
  g.addColorStop(0.4, "#33281e");
  g.addColorStop(1, "#1d150e");
  ctx.fillStyle = g;
  ctx.fillRect(0, world.groundY, W, H - world.groundY);

  // 地面高光线
  ctx.fillStyle = "rgba(255,210,150,0.18)";
  ctx.fillRect(0, world.groundY, W, 2);

  // 着陆平台
  const px = world.padX;
  const pw = world.padHalfWidth * 2;
  const topY = world.groundY;
  const platG = ctx.createLinearGradient(0, topY, 0, topY + 18);
  platG.addColorStop(0, "#aeb9c8");
  platG.addColorStop(0.5, "#7f8b9c");
  platG.addColorStop(1, "#56616f");
  ctx.fillStyle = platG;
  roundRect(ctx, px - pw / 2 - 6, topY - 4, pw + 12, 22, 4);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.25)";
  ctx.fillRect(px - pw / 2 - 6, topY - 4, pw + 12, 3);

  // 平台边缘指示灯（交替闪烁）
  const blink = Math.sin(time * 3) > 0;
  for (const side of [-1, 1]) {
    const lx = px + side * (pw / 2 - 4);
    ctx.fillStyle = blink ? "#4ade80" : "#16a34a";
    ctx.shadowColor = "#4ade80";
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(lx, topY - 1, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }

  // 着陆引导虚线（随闪烁脉冲）
  const guideAlpha = 0.16 + 0.14 * Math.sin(time * 2.4);
  ctx.setLineDash([8, 8]);
  ctx.strokeStyle = `rgba(120,230,160,${guideAlpha.toFixed(3)})`;
  ctx.lineWidth = 2;
  for (const side of [-1, 1]) {
    const gx = px + side * (pw / 2 + 2);
    ctx.beginPath();
    ctx.moveTo(gx, topY - 170);
    ctx.lineTo(gx, topY);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // 平台着陆标记
  ctx.strokeStyle = "rgba(20,30,40,0.65)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(px - 12, topY - 12);
  ctx.lineTo(px, topY - 4);
  ctx.lineTo(px + 12, topY - 12);
  ctx.stroke();
}

/** 单侧火焰 */
function flame(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  dx: number,
  dy: number,
  len: number,
  half: number,
): void {
  const ex = sx + dx * len;
  const ey = sy + dy * len;
  const px = -dy;
  const py = dx;
  const g = ctx.createLinearGradient(sx, sy, ex, ey);
  g.addColorStop(0, "rgba(255,180,70,0.95)");
  g.addColorStop(0.5, "rgba(255,120,40,0.75)");
  g.addColorStop(1, "rgba(255,210,120,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(sx + px * half, sy + py * half);
  ctx.lineTo(ex, ey);
  ctx.lineTo(sx - px * half, sy - py * half);
  ctx.closePath();
  ctx.fill();
}

function drawRocket(
  ctx: CanvasRenderingContext2D,
  s: RocketState,
  engines: EngineInput,
  firing: boolean,
  time: number,
): void {
  const L = ROCKET_PARAMS.halfLen;
  const Wd = ROCKET_PARAMS.halfWid;
  ctx.save();
  ctx.translate(s.x, s.y);
  ctx.rotate(s.angle);

  // ── 火焰（先画在机身下方） ──
  const flick = (speed: number, seed: number) =>
    1 + 0.18 * Math.sin(time * speed + seed) + 0.12 * Math.sin(time * (speed * 1.7) + seed * 2.3);
  if (firing) {
    if (engines.down) {
      const len = 30 * flick(21, 1);
      flame(ctx, 0, L - 2, 0, 1, len, 6.5);
      flame(ctx, 0, L - 2, 0, 1, len * 0.55, 4);
    }
    if (engines.up) {
      const len = 13 * flick(19, 3);
      flame(ctx, 0, -L - 5, 0, -1, len, 3.6);
    }
    if (engines.left) {
      const len = 12 * flick(17, 5);
      flame(ctx, -Wd - 4, -L * 0.58, -1, 0, len, 3);
    }
    if (engines.right) {
      const len = 12 * flick(17, 7);
      flame(ctx, Wd + 4, -L * 0.58, 1, 0, len, 3);
    }
  }

  // ── 尾翼（机尾两侧） ──
  ctx.fillStyle = "#d23c3e";
  ctx.beginPath();
  ctx.moveTo(-Wd, L * 0.28);
  ctx.lineTo(-Wd * 1.9, L * 0.88);
  ctx.lineTo(-Wd * 0.5, L * 0.92);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(Wd, L * 0.28);
  ctx.lineTo(Wd * 1.9, L * 0.88);
  ctx.lineTo(Wd * 0.5, L * 0.92);
  ctx.closePath();
  ctx.fill();

  // ── 机身 ──
  const bodyG = ctx.createLinearGradient(-Wd, 0, Wd, 0);
  bodyG.addColorStop(0, "#c3ccd8");
  bodyG.addColorStop(0.5, "#eef2f7");
  bodyG.addColorStop(1, "#93a0b0");
  ctx.fillStyle = bodyG;
  roundRect(ctx, -Wd, -L * 0.5, Wd * 2, L * 1.22, 6);
  ctx.fill();

  // ── 机头锥 ──
  const noseG = ctx.createLinearGradient(-Wd, 0, Wd, 0);
  noseG.addColorStop(0, "#c03436");
  noseG.addColorStop(0.5, "#ef5753");
  noseG.addColorStop(1, "#9d2628");
  ctx.fillStyle = noseG;
  ctx.beginPath();
  ctx.moveTo(-Wd, -L * 0.5);
  ctx.lineTo(0, -L);
  ctx.lineTo(Wd, -L * 0.5);
  ctx.closePath();
  ctx.fill();

  // ── 舷窗 ──
  const winG = ctx.createRadialGradient(-1.4, -L * 0.2 - 1.6, 0.8, 0, -L * 0.2, 5);
  winG.addColorStop(0, "#eafcff");
  winG.addColorStop(0.6, "#5cc8f0");
  winG.addColorStop(1, "#1f7fb8");
  ctx.fillStyle = winG;
  ctx.beginPath();
  ctx.arc(0, -L * 0.18, 5, 0, Math.PI * 2);
  ctx.fill();

  // ── 尾喷口（下喷口） ──
  ctx.fillStyle = "#6b7280";
  ctx.beginPath();
  ctx.moveTo(-5, L * 0.7);
  ctx.lineTo(-7, L);
  ctx.lineTo(7, L);
  ctx.lineTo(5, L * 0.7);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#374151";
  ctx.fillRect(-7, L - 2.5, 14, 2.5);

  // ── 顶喷口（上喷口） ──
  ctx.fillStyle = "#6b7280";
  ctx.beginPath();
  ctx.moveTo(-3, -L - 1);
  ctx.lineTo(-4, -L - 6);
  ctx.lineTo(4, -L - 6);
  ctx.lineTo(3, -L - 1);
  ctx.closePath();
  ctx.fill();

  // ── 左右 RCS 喷口 ──
  for (const side of [-1, 1]) {
    ctx.fillStyle = "#5b6470";
    roundRect(ctx, side * Wd - (side > 0 ? 2 : 3), -L * 0.66, 5, 9, 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[]): void {
  for (const pt of particles) {
    const t = clamp(pt.age / pt.life, 0, 1);
    const alpha = (1 - t) * 0.9;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = pt.color;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, pt.size * (1 - t * 0.6), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** 触地爆炸时把星舰炸成碎片（沿机身轮廓取 7 块，向四周飞散并旋转） */
function spawnDebris(s: Sim, rocket: RocketState): void {
  const p = ROCKET_PARAMS;
  const a = rocket.angle;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const local = (lx: number, ly: number) => ({
    x: rocket.x + lx * cos - ly * sin,
    y: rocket.y + lx * sin + ly * cos,
  });
  const frags: Array<{ lx: number; ly: number; kind: Debris["kind"]; size: number }> = [
    { lx: 0, ly: -p.halfLen * 0.78, kind: "nose", size: 1 },
    { lx: 0, ly: -p.halfLen * 0.18, kind: "body", size: 0.95 },
    { lx: 0, ly: p.halfLen * 0.12, kind: "window", size: 0.85 },
    { lx: 0, ly: p.halfLen * 0.55, kind: "body", size: 0.75 },
    { lx: -p.halfWid * 1.9, ly: p.halfLen * 0.62, kind: "fin", size: 0.9 },
    { lx: p.halfWid * 1.9, ly: p.halfLen * 0.62, kind: "fin", size: 0.9 },
    { lx: 0, ly: p.halfLen * 0.92, kind: "fin", size: 0.7 },
  ];
  for (const f of frags) {
    const pos = local(f.lx, f.ly);
    const dir = Math.random() * Math.PI * 2;
    const spd = 80 + Math.random() * 270;
    s.debris.push({
      x: pos.x,
      y: pos.y,
      // 继承部分星舰当前速度 + 爆炸冲量（向外扩散、略向上抛）
      vx: rocket.vx * 0.5 + Math.cos(dir) * spd,
      vy: rocket.vy * 0.5 + Math.sin(dir) * spd - 70,
      angle: rocket.angle + (Math.random() - 0.5) * 0.9,
      spin: (Math.random() - 0.5) * 9,
      kind: f.kind,
      size: f.size,
      age: 0,
      life: 1.6 + Math.random() * 0.9,
    });
  }
}

function drawDebris(ctx: CanvasRenderingContext2D, debris: Debris[]): void {
  for (const d of debris) {
    const t = clamp(d.age / d.life, 0, 1);
    ctx.save();
    ctx.globalAlpha = (1 - t) * 0.95;
    ctx.translate(d.x, d.y);
    ctx.rotate(d.angle);
    if (d.kind === "nose") {
      ctx.fillStyle = "#d23c3e";
      ctx.beginPath();
      ctx.moveTo(0, -11 * d.size);
      ctx.lineTo(-6.5 * d.size, 2 * d.size);
      ctx.lineTo(6.5 * d.size, 2 * d.size);
      ctx.closePath();
      ctx.fill();
    } else if (d.kind === "window") {
      ctx.fillStyle = "#aee4ff";
      ctx.beginPath();
      ctx.arc(0, 0, 4.2 * d.size, 0, Math.PI * 2);
      ctx.fill();
    } else if (d.kind === "fin") {
      ctx.fillStyle = "#d23c3e";
      ctx.beginPath();
      ctx.moveTo(0, -3 * d.size);
      ctx.lineTo(-8.5 * d.size, 9 * d.size);
      ctx.lineTo(0, 3.5 * d.size);
      ctx.closePath();
      ctx.fill();
    } else {
      ctx.fillStyle = "#f4f7fb";
      ctx.fillRect(-5 * d.size, -7 * d.size, 10 * d.size, 14 * d.size);
      ctx.strokeStyle = "rgba(160,170,185,0.5)";
      ctx.lineWidth = 1;
      ctx.strokeRect(-5 * d.size, -7 * d.size, 10 * d.size, 14 * d.size);
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawHUD(
  ctx: CanvasRenderingContext2D,
  s: RocketState,
  sim: Sim,
  t: (id: string, v?: Record<string, string | number>) => string,
): void {
  ctx.save();
  ctx.textBaseline = "middle";

  // 燃料条
  const bw = 168;
  const bh = 13;
  const bx = 14;
  const by = 14;
  roundRect(ctx, bx, by, bw, bh, 7);
  ctx.fillStyle = "rgba(4,8,16,0.55)";
  ctx.fill();
  const fuel = s.fuel;
  const fg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  fg.addColorStop(0, "#4ade80");
  fg.addColorStop(0.55, "#facc15");
  fg.addColorStop(1, "#ef4444");
  ctx.fillStyle = fg;
  roundRect(ctx, bx + 2, by + 2, Math.max(4, (bw - 4) * fuel), bh - 4, 5);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`${t("game.starship.fuel")} ${Math.round(fuel * 100)}%`, bx + 6, by + bh / 2 + 0.5);

  // 右上：波次 / 得分
  ctx.textAlign = "right";
  ctx.font = "bold 15px sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.shadowColor = "rgba(0,0,0,0.6)";
  ctx.shadowBlur = 4;
  ctx.fillText(`${t("game.starship.wave")} ${sim.wave}`, W - 14, 22);
  ctx.font = "bold 20px sans-serif";
  ctx.fillStyle = "#ffd86b";
  ctx.fillText(`${sim.score}`, W - 14, 46);
  ctx.shadowBlur = 0;
  ctx.textAlign = "left";

  // 左下：高度 / 速度 / 倾角
  const world = defaultWorld();
  const tail = tailWorld(s, ROCKET_PARAMS);
  const alt = Math.max(0, world.groundY - tail.y);
  const speed = Math.hypot(s.vx, s.vy) / 10;
  const tiltDeg = Math.round((Math.abs(normalizeAngle(s.angle)) * 180) / Math.PI);
  const speedOk = speed * 10 <= ROCKET_PARAMS.maxLandingSpeed;
  roundRect(ctx, 14, world.groundY - 54, 232, 40, 9);
  ctx.fillStyle = "rgba(4,8,16,0.5)";
  ctx.fill();
  ctx.font = "bold 12px sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.fillText(`${t("game.starship.altitude")} ${Math.round(alt / 10)}m`, 24, world.groundY - 42);
  ctx.fillStyle = speedOk ? "#7ee8a2" : "#ff7a70";
  ctx.fillText(
    `${t("game.starship.speed")} ${speed.toFixed(1)}m/s${speedOk ? "" : " !"}`,
    24,
    world.groundY - 27,
  );
  ctx.fillStyle =
    Math.abs(normalizeAngle(s.angle)) <= ROCKET_PARAMS.maxTilt ? "#7ee8a2" : "#ff7a70";
  ctx.fillText(`${t("game.starship.tilt")} ${tiltDeg}°`, 24, world.groundY - 12);

  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* 组件                                                                */
/* ------------------------------------------------------------------ */

const RocketLandingGame: React.FC<{ sdk: FatNotesPluginSDK }> = () => {
  const i18n = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<Sim>(newSim());
  const inputsRef = useRef<EngineInput>({ up: false, down: false, left: false, right: false });
  const lastUiRef = useRef<UiState>({
    phase: "idle",
    score: 0,
    wave: 1,
    fuel: 1,
    best: Number(window.localStorage.getItem(LS_BEST) || 0),
  });
  const [ui, setUi] = useState<UiState>(lastUiRef.current);
  // 渲染期内 i18n.text 引用（供 rAF 循环闭包使用）
  const tRef = useRef(i18n.text);
  tRef.current = i18n.text;

  const syncUi = (s: Sim) => {
    const next: UiState = {
      phase: s.phase,
      score: s.score,
      wave: s.wave,
      fuel: s.rocket.fuel,
      best: lastUiRef.current.best,
    };
    const prev = lastUiRef.current;
    if (
      next.phase !== prev.phase ||
      next.score !== prev.score ||
      next.wave !== prev.wave ||
      Math.round(next.fuel * 100) !== Math.round(prev.fuel * 100)
    ) {
      lastUiRef.current = next;
      setUi(next);
    }
  };

  const updateBest = useCallback((score: number) => {
    const prev = lastUiRef.current.best;
    if (score > prev) {
      lastUiRef.current.best = score;
      window.localStorage.setItem(LS_BEST, String(score));
    }
  }, []);

  const spawnNext = useCallback((s: Sim) => {
    const world = defaultWorld();
    s.wave += 1;
    s.rocket = spawnRocket(s.wave, world);
    s.phase = "flying";
    s.landedAt = 0;
    s.lastTs = 0;
    s.particles = [];
    s.debris = [];
    inputsRef.current = { up: false, down: false, left: false, right: false };
  }, []);

  const burst = useCallback((s: Sim, x: number, y: number, kind: "explosion" | "dust", power: number) => {
    const colors =
      kind === "explosion"
        ? ["#ffd86b", "#ff9d2f", "#ef4444", "#f8fafc"]
        : ["#c8b49a", "#e8d9c2", "#f5efe4"];
    const n = kind === "explosion" ? 26 : 12;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = (0.3 + Math.random() * 0.9) * power;
      s.particles.push({
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd - (kind === "explosion" ? 60 : 30),
        age: 0,
        life: 0.5 + Math.random() * (kind === "explosion" ? 0.7 : 0.4),
        size: 3 + Math.random() * (kind === "explosion" ? 5 : 3.5),
        color: colors[Math.floor(Math.random() * colors.length)],
      });
    }
  }, []);

  /** 开始 / 再来一局 */
  const reset = useCallback(() => {
    simRef.current = newSim();
    inputsRef.current = { up: false, down: false, left: false, right: false };
    lastUiRef.current = {
      phase: "idle",
      score: 0,
      wave: 1,
      fuel: 1,
      best: Number(window.localStorage.getItem(LS_BEST) || 0),
    };
    setUi(lastUiRef.current);
  }, []);

  const start = useCallback(() => {
    const s = simRef.current;
    if (s.phase === "idle") {
      s.phase = "flying";
    } else if (s.phase === "crashed") {
      reset();
      simRef.current.phase = "flying";
    }
  }, [reset]);

  const setEngine = useCallback((id: EngineId, on: boolean) => {
    inputsRef.current[id] = on;
  }, []);

  // 主循环
  useEffect(() => {
    let raf = 0;

    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      const s = simRef.current;
      if (!s.lastTs) s.lastTs = ts;
      const lastTs = s.lastTs;
      s.lastTs = ts;
      let dt = Math.min(0.05, (ts - lastTs) / 1000);
      if (dt <= 0) dt = 0.016;
      s.time += dt;
      const world = defaultWorld();
      const t = tRef.current;

      if (s.phase === "flying") {
        const engines = inputsRef.current;
        stepRocket(s.rocket, engines, world, ROCKET_PARAMS, dt);
        const verdict = evaluateLanding(s.rocket, world, ROCKET_PARAMS);
        if (verdict.result === "landed") {
          // 着陆成功：贴平平台、加分、短暂展示后进入下一发
          const tail = tailWorld(s.rocket, ROCKET_PARAMS);
          s.rocket.y = world.groundY - ROCKET_PARAMS.halfLen * Math.cos(s.rocket.angle);
          s.rocket.x = tail.x;
          s.rocket.vx = 0;
          s.rocket.vy = 0;
          s.rocket.spin = 0;
          const pts = landingScore(
            s.rocket.fuel,
            verdict.impactSpeed ?? 0,
            tail.x,
            world.padX,
            world.padHalfWidth,
            ROCKET_PARAMS.maxLandingSpeed,
          );
          s.score += pts;
          s.lastScore = pts;
          s.landings += 1;
          s.phase = "landed";
          s.landedAt = ts;
          updateBest(s.score);
          burst(s, tail.x, world.groundY - 6, "dust", 150);
          s.shake = 3;
        } else if (verdict.result === "crashed") {
          // 触地爆炸：星舰解体成碎片 + 火光粒子 + 震屏
          const pts = rocketPoints(s.rocket);
          const hit = pts.reduce((a, b) => (b.y > a.y ? b : a));
          s.phase = "crashed";
          s.landedAt = ts;
          spawnDebris(s, s.rocket);
          burst(s, hit.x, hit.y, "explosion", 320);
          s.shake = 16;
          if (!s.recorded) {
            s.recorded = true;
            updateBest(s.score);
            recordScore({
              gameId: "starship",
              gameTitle: "星舰回收",
              score: s.score,
              detail: { wave: s.wave, landings: s.landings },
            });
          }
        }
      } else if (s.phase === "landed") {
        if (ts - s.landedAt >= LANDED_DELAY) {
          spawnNext(s);
        }
      }

      // 粒子推进
      if (s.particles.length > 0) {
        for (const pt of s.particles) {
          pt.age += dt;
          pt.x += pt.vx * dt;
          pt.y += pt.vy * dt;
          pt.vy += (pt.color === "#ffd86b" || pt.color === "#ff9d2f" || pt.color === "#ef4444" ? 420 : 60) * dt;
        }
        s.particles = s.particles.filter((p) => p.age < p.life);
      }
      // 解体碎片推进（重力 + 旋转 + 轻微空气阻尼）
      if (s.debris.length > 0) {
        for (const d of s.debris) {
          d.age += dt;
          d.x += d.vx * dt;
          d.y += d.vy * dt;
          d.vy += 300 * dt;
          d.vx *= 1 - 0.5 * dt;
          d.vy *= 1 - 0.5 * dt;
          d.angle += d.spin * dt;
          d.spin *= 1 - 0.4 * dt;
        }
        s.debris = s.debris.filter((d) => d.age < d.life);
      }
      if (s.shake > 0) s.shake = Math.max(0, s.shake - 60 * dt);

      // 绘制
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      if (s.shake > 0.5) {
        ctx.translate((Math.random() - 0.5) * s.shake, (Math.random() - 0.5) * s.shake);
      }
      drawSky(ctx, s.time, world);
      drawGround(ctx, s.time, world);

      const firing = s.phase === "flying";
      if (s.phase === "idle") {
        // 待机预览：星舰悬浮在平台上空，轻微上下浮动
        const bob = Math.sin(s.time * 1.6) * 6;
        const idleRocket: RocketState = { ...s.rocket, y: 150 + bob };
        drawRocket(ctx, idleRocket, { up: false, down: false, left: false, right: false }, false, s.time);
      } else if (s.phase === "crashed") {
        // 坠毁：星舰已解体，只绘制飞散的碎片与火光
        drawDebris(ctx, s.debris);
      } else {
        drawRocket(ctx, s.rocket, inputsRef.current, firing, s.time);
      }
      drawParticles(ctx, s.particles);
      drawHUD(ctx, s.rocket, s, t);
      ctx.restore();

      syncUi(s);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [burst, spawnNext, updateBest]);

  // 键盘
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) {
        e.preventDefault();
      }
      if (k === " ") {
        start();
        return;
      }
      const map: Record<string, EngineId> = {
        arrowup: "up",
        w: "up",
        arrowdown: "down",
        s: "down",
        arrowleft: "left",
        a: "left",
        arrowright: "right",
        d: "right",
      };
      if (map[k]) inputsRef.current[map[k]] = true;
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const map: Record<string, EngineId> = {
        arrowup: "up",
        w: "up",
        arrowdown: "down",
        s: "down",
        arrowleft: "left",
        a: "left",
        arrowright: "right",
        d: "right",
      };
      if (map[k]) inputsRef.current[map[k]] = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [start]);

  const fuelPct = Math.round(ui.fuel * 100);

  return (
    <GameFrame
      emoji="🚀"
      title={i18n.text("game.starship.title")}
      stats={[
        { label: i18n.text("game.starship.score"), value: ui.score, colors: CHIP_GOLD },
        { label: i18n.text("game.starship.wave"), value: ui.wave, colors: CHIP_BLUE },
        {
          label: i18n.text("game.starship.fuel"),
          value: `${fuelPct}%`,
          colors: ui.fuel <= 0.3 ? CHIP_RED : CHIP_GREEN,
        },
        { label: i18n.text("game.starship.best"), value: ui.best, colors: CHIP_PURPLE },
      ]}
      headerExtra={
        <GhostBtn onClick={() => reset()}>
          <ReloadOutlined />
          {i18n.text("game.starship.restart")}
        </GhostBtn>
      }
      help={i18n.text("game.starship.help")}
      maxWidth={620}
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
          style={{ display: "block" }}
        />

        {/* 待机提示 */}
        {ui.phase === "idle" && (
          <div
            className="gs-pulse"
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(5,8,20,0.35)",
              display: "flex",
              flexDirection: "column",
              gap: 14,
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
            }}
          >
            <div style={{ fontSize: 17, fontWeight: 800, textAlign: "center", lineHeight: 1.5 }}>
              {i18n.text("game.starship.idle")}
            </div>
            <PrimaryBtn onClick={start}>{i18n.text("game.starship.start")}</PrimaryBtn>
          </div>
        )}

        {/* 着陆成功（自动进入下一发） */}
        {ui.phase === "landed" && (
          <div
            className="gs-win-in"
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(18,34,22,0.62)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
              alignItems: "center",
              justifyContent: "center",
              color: "#d8f7e2",
              pointerEvents: "none",
            }}
          >
            <div style={{ fontSize: 30, fontWeight: 900 }}>✅ {i18n.text("game.starship.success")}</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#ffd86b" }}>
              {i18n.text("game.starship.successPoints", { points: simRef.current.lastScore })}
            </div>
            <div style={{ fontSize: 14, opacity: 0.8 }}>
              {i18n.text("game.starship.nextWave", { wave: simRef.current.wave + 1 })}
            </div>
          </div>
        )}

        {/* 坠毁 */}
        {ui.phase === "crashed" && (
          <div
            className="gs-win-in"
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(40,8,8,0.55)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              alignItems: "center",
              justifyContent: "center",
              color: "#ffe3dd",
            }}
          >
            <div style={{ fontSize: 32, fontWeight: 900 }}>💥 {i18n.text("game.starship.crashed")}</div>
            <div style={{ fontSize: 16, opacity: 0.9 }}>
              {i18n.text("game.starship.crashDetail", {
                score: ui.score,
                landings: ui.wave - 1,
              })}
            </div>
            <GhostBtn onClick={start}>
              <ReloadOutlined />
              {i18n.text("game.starship.again")}
            </GhostBtn>
          </div>
        )}
      </div>

      {/* 喷口控制面板（按住点火） */}
      <div
        style={{
          marginTop: 10,
          display: "grid",
          gridTemplateColumns: "repeat(3, 84px)",
          gridTemplateRows: "repeat(2, 58px)",
          gap: 8,
          justifyItems: "center",
        }}
      >
        <div />
        <ThrusterBtn
          label="▲"
          sub={i18n.text("game.starship.thrustDown")}
          nozzle={i18n.text("game.starship.nozzleUp")}
          on={inputsRef.current.up}
          onDown={() => setEngine("up", true)}
          onUp={() => setEngine("up", false)}
        />
        <div />
        <ThrusterBtn
          label="◀"
          sub={i18n.text("game.starship.rotateRight")}
          nozzle={i18n.text("game.starship.nozzleLeft")}
          on={inputsRef.current.left}
          onDown={() => setEngine("left", true)}
          onUp={() => setEngine("left", false)}
        />
        <div
          style={{
            display: "flex",
            alignItems: "center",
            fontSize: 11,
            color: "rgba(128,128,128,0.75)",
          }}
        >
          {i18n.text("game.starship.holdTip")}
        </div>
        <ThrusterBtn
          label="▶"
          sub={i18n.text("game.starship.rotateLeft")}
          nozzle={i18n.text("game.starship.nozzleRight")}
          on={inputsRef.current.right}
          onDown={() => setEngine("right", true)}
          onUp={() => setEngine("right", false)}
        />
        <div />
        <ThrusterBtn
          label="▼"
          sub={i18n.text("game.starship.thrustBrake")}
          nozzle={i18n.text("game.starship.nozzleDown")}
          on={inputsRef.current.down}
          onDown={() => setEngine("down", true)}
          onUp={() => setEngine("down", false)}
        />
        <div />
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
        width: 84,
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

export default RocketLandingGame;
