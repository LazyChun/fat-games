/*
 * CarpGateGame：鲤鱼跳龙门（新游戏）
 *
 * 逆流而上：鲤鱼在瀑布中一次次蓄力跃起，穿过一道道红色龙门化龙升天。
 *
 * 特色机制：
 *   - 蓄力一跃：按住（空格 / ↑ / W 或按住画面）悬浮蓄力，松手跃起，蓄满自动跃；
 *   - 摆尾腾跃：空中再按一次二段跃，弥补失误；
 *   - 穿越龙门：龙门（上下横梁）随水流下滚，从门洞穿过 +100×连击倍率；
 *   - 连击倍率：连续穿门叠连击，×1 → ×3；
 *   - 礁石与浪花：撞礁、撞梁、被浪冲走都会扣一条命，三条命用完游戏结束；
 *   - 水流加速：每 12 秒提速，门洞变窄、龙门与礁石更密。
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  PauseOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import { recordScore } from "../scoreClient";
import { useI18n } from "../hooks";
import GameFrame, {
  GhostBtn,
  PrimaryBtn,
  CHIP_GOLD,
  CHIP_GREEN,
  CHIP_BLUE,
  CHIP_PURPLE,
  CHIP_RED,
} from "./GameFrame";
import {
  sfxClick,
  sfxCoin,
  sfxHurt,
  sfxJump,
  sfxLevelUp,
  sfxLose,
  sfxPerfect,
} from "./sound";

/* ------------------------------------------------------------------ */
/* 常量                                                               */
/* ------------------------------------------------------------------ */

const W = 560;
const H = 320;
const CX = 92; // 鲤鱼固定横坐标（中心）
const CARP_R = 14; // 鲤鱼碰撞半径
const SWEEP_Y = 306; // 落水线（被浪冲走）
const GRAVITY = 1500;
const V0 = 105; // 水流初始速度（px/s）
const V_MAX = 230;
const V_ACCEL = 30; // 每 12s 提速
const SPEED_UP_EVERY = 12;
const JUMP_MIN = 500; // 轻点起跳初速
const JUMP_POWER = 430; // 满蓄额外初速
const CHARGE_MAX = 0.38; // 满蓄时长
const DOUBLE_VY = 600; // 摆尾腾跃初速
const GATE_GAP0 = 96; // 门洞初始高度
const GATE_GAP_MIN = 60;
const GATE_BEAM = 190; // 上梁可视高度
const SPAWN0 = 250; // 龙门初始间距（px）
const SPAWN_MIN = 165;
const ROCK_R_MIN = 16;
const ROCK_R_MAX = 25;
const MAX_LIVES = 3;
const LS_BEST = "fat-games.carp.best";

type Phase = "idle" | "running" | "over";

interface Gate {
  y: number; // 门洞上沿（随世界下滚）
  gap: number; // 门洞高度
  passed: boolean;
}
interface Rock {
  x: number;
  y: number;
  r: number;
  seed: number;
  hit: boolean;
}
interface Pearl {
  x: number;
  y: number;
  taken: boolean;
}
interface Popup {
  x: number;
  y: number;
  text: string;
  color: string;
  age: number;
  life: number;
  size: number;
}
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
interface Sim {
  phase: Phase;
  time: number;
  score: number;
  v: number;
  speedUpAt: number;
  combo: number;
  gates: number;
  lives: number;
  best: number;
  y: number; // 鲤鱼底部 y（屏幕坐标）
  vy: number;
  charging: boolean;
  charge: number;
  jumpsUsed: number;
  invincible: number;
  shake: number;
  spawnAcc: number; // 龙门生成距离累积
  rockAcc: number;
  pearlAcc: number;
  gatesArr: Gate[];
  rocks: Rock[];
  pearls: Pearl[];
  popups: Popup[];
  particles: Particle[];
  paused: boolean;
  recorded: boolean;
  lastTs: number;
}
interface Ui {
  phase: Phase;
  score: number;
  gates: number;
  combo: number;
  lives: number;
  best: number;
  paused: boolean;
}

/* ------------------------------------------------------------------ */
/* 纯逻辑                                                             */
/* ------------------------------------------------------------------ */

function newSim(): Sim {
  return {
    phase: "idle",
    time: 0,
    score: 0,
    v: V0,
    speedUpAt: SPEED_UP_EVERY,
    combo: 0,
    gates: 0,
    lives: MAX_LIVES,
    best: loadBest(),
    y: 150,
    vy: 0,
    charging: false,
    charge: 0,
    jumpsUsed: 0,
    invincible: 0,
    shake: 0,
    spawnAcc: 0,
    rockAcc: 40,
    pearlAcc: 20,
    gatesArr: [],
    rocks: [],
    pearls: [],
    popups: [],
    particles: [],
    paused: false,
    recorded: false,
    lastTs: 0,
  };
}

function loadBest(): number {
  try {
    return Number(window.localStorage.getItem(LS_BEST) || 0) || 0;
  } catch {
    return 0;
  }
}

function saveBest(v: number): void {
  try {
    window.localStorage.setItem(LS_BEST, String(v));
  } catch {
    /* ignore */
  }
}

/** 鲤鱼中心 y */
function carpCy(s: Sim): number {
  return s.y - CARP_R;
}

function multiplier(s: Sim): number {
  return Math.min(3, 1 + Math.floor(s.combo / 3));
}

function gateSpacing(s: Sim): number {
  return Math.max(SPAWN_MIN, SPAWN0 - Math.floor(s.time / SPEED_UP_EVERY) * 12);
}

function gateGap(s: Sim): number {
  return Math.max(GATE_GAP_MIN, GATE_GAP0 - Math.floor(s.time / SPEED_UP_EVERY) * 4);
}

function addPopup(
  s: Sim,
  x: number,
  y: number,
  text: string,
  color: string,
  life: number,
  size: number,
): void {
  s.popups.push({ x, y, text, color, age: 0, life, size });
  if (s.popups.length > 24) s.popups.shift();
}

function puff(s: Sim, x: number, y: number, n: number, color: string): void {
  for (let i = 0; i < n; i++) {
    s.particles.push({
      x: x + (Math.random() - 0.5) * 20,
      y: y + (Math.random() - 0.5) * 8,
      vx: (Math.random() - 0.5) * 170,
      vy: -20 - Math.random() * 100,
      age: 0,
      life: 0.3 + Math.random() * 0.25,
      size: 2.5 + Math.random() * 4,
      color,
    });
  }
}

/** 水花（落水 / 起跳溅起） */
function splash(s: Sim, x: number, y: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const a = Math.PI + (Math.random() - 0.5) * 1.4;
    const sp = 60 + Math.random() * 160;
    s.particles.push({
      x: x + (Math.random() - 0.5) * 24,
      y: y + (Math.random() - 0.5) * 6,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp * 0.7 - 30,
      age: 0,
      life: 0.4 + Math.random() * 0.3,
      size: 2.5 + Math.random() * 3.5,
      color: Math.random() < 0.5 ? "#cdeef7" : "#ffffff",
    });
  }
}

function sparkle(s: Sim, x: number, y: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 60 + Math.random() * 150;
    s.particles.push({
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp - 40,
      age: 0,
      life: 0.4 + Math.random() * 0.3,
      size: 2.5 + Math.random() * 2.5,
      color: Math.random() < 0.5 ? "#ffd54a" : "#fff6c9",
    });
  }
}

function tickFx(s: Sim, dt: number): void {
  for (const p of s.popups) {
    p.age += dt;
    p.y -= 34 * dt;
  }
  s.popups = s.popups.filter((p) => p.age < p.life);
  for (const p of s.particles) {
    p.age += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 320 * dt;
  }
  s.particles = s.particles.filter((p) => p.age < p.life);
  s.shake = Math.max(0, s.shake - 26 * dt);
}

/** 起跳（含满蓄自动跃） */
function performJump(s: Sim, t: (id?: string, values?: Record<string, string | number>) => string): void {
  const ratio = s.charge / CHARGE_MAX;
  s.vy = -(JUMP_MIN + JUMP_POWER * ratio);
  s.charging = false;
  s.charge = 0;
  s.jumpsUsed = 1;
  splash(s, CX, s.y + 4, 8);
  sfxJump();
}

/** 摆尾腾跃（空中二段跃） */
function doubleJump(s: Sim): void {
  s.vy = -DOUBLE_VY;
  s.jumpsUsed = 2;
  puff(s, CX, s.y - 8, 6, "#cdeef7");
  sfxJump();
}

/** 扣一条命；返回是否游戏结束 */
function loseLife(
  s: Sim,
  t: (id?: string, values?: Record<string, string | number>) => string,
  reason: "swept" | "gate" | "rock",
): boolean {
  if (s.invincible > 0) return false;
  s.lives -= 1;
  s.combo = 0;
  s.invincible = 1.4;
  s.shake = 10;
  if (reason === "swept") {
    s.y = 110;
    s.vy = -320;
    s.charging = false;
    s.charge = 0;
    s.jumpsUsed = 0;
    splash(s, CX, SWEEP_Y, 18);
    addPopup(s, CX, 128, t("game.carp.swept"), "#ffb3a7", 1.0, 17);
  } else if (reason === "gate") {
    s.vy = -520;
    addPopup(s, CX, s.y - 76, t("game.carp.hitGate"), "#ff8a80", 0.95, 16);
  } else {
    s.vy = -520;
    addPopup(s, CX, s.y - 76, t("game.carp.hitRock"), "#ff8a80", 0.95, 16);
  }
  puff(s, CX, s.y + 2, 10, "#bfe8ee");
  sfxHurt();

  if (s.lives <= 0) {
    s.phase = "over";
    s.charging = false;
    if (!s.recorded) {
      s.recorded = true;
      const finalScore = Math.floor(s.score);
      if (finalScore > s.best) {
        s.best = finalScore;
        saveBest(finalScore);
      }
      recordScore({
        gameId: "carp",
        gameTitle: "鲤鱼跳龙门",
        score: finalScore,
        detail: { gates: s.gates, best: s.best },
      });
    }
    sfxLose();
    return true;
  }
  return false;
}

/** 穿过龙门得分 */
function passGate(
  s: Sim,
  g: Gate,
  t: (id?: string, values?: Record<string, string | number>) => string,
): void {
  g.passed = true;
  s.gates += 1;
  s.combo += 1;
  const mult = multiplier(s);
  const pts = 100 * mult;
  s.score += pts;
  addPopup(s, CX + 6, s.y - 86, `${t("game.carp.gatePass")} +${pts}`, "#ffd54a", 1.0, 18);
  sparkle(s, CX, s.y - 30, 14);
  sfxPerfect();
}

/** 生成一个龙门 */
function spawnGate(s: Sim): void {
  s.gatesArr.push({
    y: -160 - Math.random() * 60,
    gap: gateGap(s),
    passed: false,
  });
}

/** 生成礁石（尽量避开门洞区间） */
function spawnRock(s: Sim): void {
  let rx = 66 + Math.random() * 52;
  let ry = 50 + Math.random() * (H - 100);
  // 避让屏内龙门门洞，最多重试 5 次
  for (let i = 0; i < 5; i++) {
    const clash = s.gatesArr.some(
      (g) => ry > g.y - 16 && ry < g.y + g.gap + 16,
    );
    if (!clash) break;
    ry = 50 + Math.random() * (H - 100);
    rx = 66 + Math.random() * 52;
  }
  s.rocks.push({
    x: rx,
    y: ry,
    r: ROCK_R_MIN + Math.random() * (ROCK_R_MAX - ROCK_R_MIN),
    seed: Math.random() * Math.PI * 2,
    hit: false,
  });
}

/** 生成龙珠 */
function spawnPearl(s: Sim): void {
  s.pearls.push({
    x: 70 + Math.random() * 44,
    y: 40 + Math.random() * (H - 110),
    taken: false,
  });
}

/** 每帧推进模拟 */
function step(
  s: Sim,
  dt: number,
  t: (id?: string, values?: Record<string, string | number>) => string,
): void {
  if (s.phase === "over") {
    tickFx(s, dt);
    return;
  }
  if (s.phase !== "running" || s.paused) return;

  tickFx(s, dt);
  s.time += dt;
  const v = s.v;
  s.score += (v * dt) / 18; // 里程分

  // 水流加速
  s.v = Math.min(V_MAX, V0 + V_ACCEL * Math.floor(s.time / SPEED_UP_EVERY));
  if (s.time >= s.speedUpAt) {
    s.speedUpAt += SPEED_UP_EVERY;
    addPopup(s, W / 2, 46, t("game.carp.speedUp"), "#8bf0a9", 1.1, 20);
    sfxLevelUp();
  }

  // 蓄力：悬浮微浮升，满蓄自动跃起
  if (s.charging) {
    s.vy = 0;
    s.y = Math.max(40, s.y - 26 * dt);
    s.charge += dt;
    if (s.charge >= CHARGE_MAX) {
      s.charge = CHARGE_MAX;
      performJump(s, t);
    }
  }

  // 跳跃物理
  s.vy += GRAVITY * dt;
  s.y += s.vy * dt;
  if (s.y < -30) {
    s.y = -30;
    s.vy = 0;
  }

  // 被浪冲走
  if (s.y > SWEEP_Y) {
    if (loseLife(s, t, "swept")) return;
  }

  // 世界滚动（龙门 / 礁石 / 龙珠向下滚）
  for (const g of s.gatesArr) g.y += v * dt;
  for (const r of s.rocks) r.y += v * dt;
  for (const p of s.pearls) p.y += v * dt;
  s.gatesArr = s.gatesArr.filter((g) => g.y < H + 60);
  s.rocks = s.rocks.filter((r) => r.y < H + 60);
  s.pearls = s.pearls.filter((p) => p.y < H + 60);

  // 生成
  s.spawnAcc += v * dt;
  if (s.spawnAcc >= gateSpacing(s)) {
    s.spawnAcc = 0;
    spawnGate(s);
  }
  s.rockAcc += v * dt;
  if (s.rockAcc >= 190 + Math.random() * 70) {
    s.rockAcc = 0;
    if (Math.random() < 0.75) spawnRock(s);
  }
  s.pearlAcc += v * dt;
  if (s.pearlAcc >= 140 + Math.random() * 80) {
    s.pearlAcc = 0;
    if (Math.random() < 0.6) spawnPearl(s);
  }

  if (s.invincible > 0) s.invincible -= dt;

  const cy = carpCy(s);

  // 龙门碰撞 / 穿过判定
  for (const g of s.gatesArr) {
    if (g.passed) continue;
    if (cy < g.y && cy > g.y - GATE_BEAM) {
      // 撞上梁
      g.passed = true;
      if (loseLife(s, t, "gate")) return;
    } else if (cy > g.y + g.gap) {
      // 撞下梁（沉太低）
      g.passed = true;
      if (loseLife(s, t, "gate")) return;
    } else if (g.y >= cy) {
      // 门洞上沿越过鲤鱼中心 → 穿过
      passGate(s, g, t);
    }
  }

  // 礁石碰撞
  for (const r of s.rocks) {
    if (r.hit) continue;
    const rx = r.x + Math.sin(s.time * 0.8 + r.seed * 2) * 14; // 与渲染一致
    const dx = CX - rx;
    const dy = cy - r.y;
    if (dx * dx + dy * dy < (CARP_R + r.r) * (CARP_R + r.r)) {
      r.hit = true;
      if (loseLife(s, t, "rock")) return;
    }
  }

  // 龙珠
  for (const p of s.pearls) {
    if (p.taken) continue;
    const dx = CX - p.x;
    const dy = cy - p.y;
    if (dx * dx + dy * dy < (CARP_R + 12) * (CARP_R + 12)) {
      p.taken = true;
      s.score += 15;
      addPopup(s, CX + 6, s.y - 72, "+15", "#ffd54a", 0.8, 15);
      sparkle(s, CX, cy - 10, 8);
      sfxCoin();
    }
  }
}

/* ------------------------------------------------------------------ */
/* 渲染                                                               */
/* ------------------------------------------------------------------ */

function wrapY(y: number, span: number): number {
  const m = y % span;
  return m < 0 ? m + span : m;
}

function drawGate(ctx: CanvasRenderingContext2D, g: Gate): void {
  const beamTop = g.y - GATE_BEAM;
  const gapBottom = g.y + g.gap;

  // 上梁
  const grad = ctx.createLinearGradient(0, beamTop, 0, g.y);
  grad.addColorStop(0, "#c62828");
  grad.addColorStop(1, "#8e1b1b");
  ctx.fillStyle = grad;
  ctx.fillRect(0, beamTop, W, GATE_BEAM);
  // 瓦檐纹
  ctx.fillStyle = "rgba(255,255,255,0.13)";
  for (let x = 8; x < W; x += 34) ctx.fillRect(x, beamTop + 10, 18, 4);
  // 金边
  ctx.fillStyle = "#ffd54a";
  ctx.fillRect(0, g.y - 3, W, 3);

  // 下梁
  ctx.fillStyle = "#b23a3a";
  ctx.fillRect(0, gapBottom, W, H - gapBottom);
  ctx.fillStyle = "#ffd54a";
  ctx.fillRect(0, gapBottom, W, 3);

  // 门楣「龙门」
  const mx = W / 2;
  const my = g.y - 24;
  ctx.fillStyle = "rgba(120,10,10,0.92)";
  ctx.fillRect(mx - 34, my, 68, 19);
  ctx.strokeStyle = "#ffd54a";
  ctx.lineWidth = 2;
  ctx.strokeRect(mx - 34, my, 68, 19);
  ctx.font = "900 12px system-ui, -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffd54a";
  ctx.fillText("龙门", mx, my + 14.5);
}

function drawRock(ctx: CanvasRenderingContext2D, r: Rock, now: number): void {
  const x = r.x + Math.sin(now * 0.8 + r.seed * 2) * 14;
  const y = r.y + Math.sin(now * 1.2 + r.seed) * 4;
  ctx.save();
  ctx.translate(x, y);
  // 岩石本体（不规则多边形）
  ctx.fillStyle = "#64748b";
  ctx.beginPath();
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r.seed;
    const rr = r.r * (0.82 + 0.18 * Math.sin(i * 3.7 + r.seed));
    const px = Math.cos(a) * rr;
    const py = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.28)";
  ctx.lineWidth = 2;
  ctx.stroke();
  // 顶部浪花
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.ellipse(0, -r.r * 0.65, r.r * 0.72, r.r * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPearl(ctx: CanvasRenderingContext2D, p: Pearl, now: number): void {
  const y = p.y + Math.sin(now * 2.4 + p.x) * 5;
  ctx.save();
  ctx.translate(p.x, y);
  ctx.fillStyle = "rgba(255,215,74,0.3)";
  ctx.beginPath();
  ctx.arc(0, 0, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffd54a";
  ctx.beginPath();
  ctx.arc(0, 0, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff6d8";
  ctx.beginPath();
  ctx.arc(-2.4, -2.4, 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawCarp(ctx: CanvasRenderingContext2D, s: Sim, now: number): void {
  const cy = s.y - CARP_R;

  // 水中光晕
  ctx.fillStyle = "rgba(255,190,110,0.12)";
  ctx.beginPath();
  ctx.arc(CX, cy, CARP_R + 10, 0, Math.PI * 2);
  ctx.fill();

  // 无敌闪烁
  if (s.invincible > 0 && s.phase === "running" && Math.floor(now * 16) % 2 === 0) {
    return;
  }

  ctx.save();
  ctx.translate(CX, cy);
  // 姿态倾角：跃起前倾，下落回正
  let tilt = Math.max(-0.32, Math.min(0.32, -s.vy * 0.00022));
  if (s.charging) {
    const wob = Math.sin(now * 22) * 0.05;
    tilt = -0.22 + wob;
  }
  ctx.rotate(tilt);

  const tailSwing = Math.sin(now * 12) * 0.5;

  // 尾鳍（下方摆动）
  ctx.fillStyle = "#ff8a3d";
  ctx.beginPath();
  ctx.moveTo(-2, CARP_R - 3);
  ctx.lineTo(-9 - tailSwing * 3, CARP_R + 11);
  ctx.lineTo(6 + tailSwing * 3, CARP_R + 11);
  ctx.closePath();
  ctx.fill();

  // 身体（竖直椭圆，头朝上）
  const bodyGrad = ctx.createLinearGradient(-CARP_R, 0, CARP_R, 0);
  bodyGrad.addColorStop(0, "#ffb066");
  bodyGrad.addColorStop(1, "#ff8a3d");
  ctx.fillStyle = bodyGrad;
  ctx.beginPath();
  ctx.ellipse(0, 0, CARP_R - 2, CARP_R + 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(170,70,10,0.5)";
  ctx.lineWidth = 1.8;
  ctx.stroke();

  // 鳞纹
  ctx.strokeStyle = "rgba(200,90,20,0.35)";
  ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(0, -4 + i * 8, 8, -0.9, 0.9);
    ctx.stroke();
  }

  // 背鳍（头顶后侧）
  ctx.fillStyle = "#ff7a2e";
  ctx.beginPath();
  ctx.moveTo(-CARP_R + 3, -CARP_R + 2);
  ctx.lineTo(-CARP_R - 4, -CARP_R + 10);
  ctx.lineTo(-CARP_R + 7, -CARP_R + 12);
  ctx.closePath();
  ctx.fill();

  // 眼（头顶，跃起方向）
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(4, -CARP_R + 3, 3.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1f2937";
  ctx.beginPath();
  ctx.arc(5.2, -CARP_R + 3.4, 1.6, 0, Math.PI * 2);
  ctx.fill();

  // 鱼须（两条）
  ctx.strokeStyle = "#ff8a3d";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-1, -CARP_R + 1);
  ctx.quadraticCurveTo(-6, -CARP_R - 7, -4, -CARP_R - 13);
  ctx.moveTo(2, -CARP_R + 1);
  ctx.quadraticCurveTo(7, -CARP_R - 7, 5, -CARP_R - 13);
  ctx.stroke();

  // 嘴
  ctx.strokeStyle = "rgba(170,70,10,0.8)";
  ctx.beginPath();
  ctx.moveTo(-3, -CARP_R + 5);
  ctx.lineTo(3, -CARP_R + 5);
  ctx.stroke();

  // 蓄力条
  if (s.charging) {
    const ratio = Math.min(1, s.charge / CHARGE_MAX);
    const bw = 40;
    const by = -CARP_R - 18;
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(-bw / 2, by, bw, 5);
    ctx.fillStyle = ratio >= 1 ? "#ff6b6b" : "#ffd54a";
    ctx.fillRect(-bw / 2, by, bw * ratio, 5);
  }

  ctx.restore();
}

function render(ctx: CanvasRenderingContext2D, s: Sim, now: number): void {
  ctx.clearRect(0, 0, W, H);

  if (s.shake > 0) {
    const m = Math.min(7, s.shake);
    ctx.translate((Math.random() - 0.5) * m * 2, (Math.random() - 0.5) * m * 2);
  }

  // 瀑布背景（由深到浅，底部亮）
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0b3d4a");
  bg.addColorStop(0.55, "#14606e");
  bg.addColorStop(1, "#8fd3dc");
  ctx.fillStyle = bg;
  ctx.fillRect(-12, -12, W + 24, H + 24);

  // 水流纹理（多层白色竖线向下滚，视差）
  for (let i = 0; i < 7; i++) {
    const x = 58 + i * 78 + (i % 2) * 12;
    const off = wrapY(now * s.v * (0.55 + i * 0.1) + i * 137, H + 90) - 45;
    ctx.strokeStyle = i % 2 === 0 ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.1)";
    ctx.lineWidth = 1.8;
    for (let y = -off; y < H + 24; y += 54) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.sin(y * 0.05 + i) * 5, y + 26);
      ctx.stroke();
    }
  }

  // 水泡（向下滚的小圆）
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  for (let i = 0; i < 10; i++) {
    const bx = wrapY(i * 61 + now * s.v * 0.9, W + 20) - 10;
    const by = wrapY(i * 47 + now * s.v * 1.15, H + 30) - 15;
    ctx.beginPath();
    ctx.arc(bx, by, 1.5 + (i % 3), 0, Math.PI * 2);
    ctx.fill();
  }

  // 左右山壁剪影
  ctx.fillStyle = "rgba(9,36,30,0.88)";
  ctx.beginPath();
  ctx.moveTo(-10, -10);
  ctx.lineTo(36, -10);
  ctx.lineTo(60, 118);
  ctx.lineTo(32, 200);
  ctx.lineTo(48, H);
  ctx.lineTo(-10, H);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(W + 10, -10);
  ctx.lineTo(W - 36, -10);
  ctx.lineTo(W - 60, 108);
  ctx.lineTo(W - 32, 190);
  ctx.lineTo(W - 48, H);
  ctx.lineTo(W + 10, H);
  ctx.closePath();
  ctx.fill();

  // 龙门
  for (const g of s.gatesArr) {
    if (g.y < -GATE_BEAM - 30 || g.y > H + 70) continue;
    drawGate(ctx, g);
  }

  // 礁石
  for (const r of s.rocks) {
    if (r.hit || r.y < -60 || r.y > H + 60) continue;
    drawRock(ctx, r, now);
  }

  // 龙珠
  for (const p of s.pearls) {
    if (p.taken || p.y < -40 || p.y > H + 40) continue;
    drawPearl(ctx, p, now);
  }

  // 鲤鱼
  drawCarp(ctx, s, now);

  // 底部浪花
  ctx.fillStyle = "rgba(228,250,252,0.8)";
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 8) {
    const yy =
      H - 8 + Math.sin(x * 0.06 + now * 2.2) * 3 + Math.sin(x * 0.02 + now * 1.1) * 2;
    ctx.lineTo(x, yy);
  }
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  for (let i = 0; i < 8; i++) {
    const bx = wrapY(i * 97 + now * s.v * 0.6, W + 20) - 10;
    const by = H - 14 + Math.sin(now * 3 + i) * 4;
    ctx.beginPath();
    ctx.arc(bx, by, 2.5 + (i % 3), 0, Math.PI * 2);
    ctx.fill();
  }

  // 粒子
  for (const p of s.particles) {
    const a = Math.max(0, 1 - p.age / p.life);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;

  // 飘字
  ctx.textAlign = "center";
  for (const p of s.popups) {
    const a = Math.max(0, 1 - p.age / p.life);
    ctx.globalAlpha = a;
    ctx.font = `800 ${p.size}px system-ui, -apple-system, sans-serif`;
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.strokeText(p.text, p.x, p.y);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, p.x, p.y);
  }
  ctx.globalAlpha = 1;
}

function syncUi(
  s: Sim,
  lastUiRef: React.MutableRefObject<Ui>,
  setUi: (u: Ui) => void,
): void {
  const next: Ui = {
    phase: s.phase,
    score: Math.floor(s.score),
    gates: s.gates,
    combo: s.combo,
    lives: Math.max(0, s.lives),
    best: s.best,
    paused: s.paused,
  };
  const cur = lastUiRef.current;
  if (
    next.phase !== cur.phase ||
    next.score !== cur.score ||
    next.gates !== cur.gates ||
    next.combo !== cur.combo ||
    next.lives !== cur.lives ||
    next.best !== cur.best ||
    next.paused !== cur.paused
  ) {
    lastUiRef.current = next;
    setUi(next);
  }
}

/* ------------------------------------------------------------------ */
/* 组件                                                               */
/* ------------------------------------------------------------------ */

const CarpGateGame: React.FC<{ sdk: FatNotesPluginSDK }> = () => {
  const i18n = useI18n();
  const simRef = useRef<Sim>(newSim());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastUiRef = useRef<Ui>({
    phase: "idle",
    score: 0,
    gates: 0,
    combo: 0,
    lives: MAX_LIVES,
    best: loadBest(),
    paused: false,
  });
  const [ui, setUi] = useState<Ui>(lastUiRef.current);
  const tRef = useRef(i18n.text);
  tRef.current = i18n.text;

  const reset = useCallback(() => {
    simRef.current = newSim();
    const next: Ui = {
      phase: "idle",
      score: 0,
      gates: 0,
      combo: 0,
      lives: MAX_LIVES,
      best: simRef.current.best,
      paused: false,
    };
    lastUiRef.current = next;
    setUi(next);
  }, []);

  const start = useCallback(() => {
    const s = simRef.current;
    if (s.phase === "idle") {
      s.phase = "running";
    } else if (s.phase === "over") {
      reset();
      simRef.current.phase = "running";
    }
    s.lastTs = 0;
    sfxClick();
  }, [reset]);

  const pressJump = useCallback(() => {
    const s = simRef.current;
    if (s.phase === "idle" || s.phase === "over") {
      start();
      return;
    }
    if (s.phase !== "running" || s.paused) return;
    if (s.charging) return;
    if (s.jumpsUsed >= 2) return;
    if (s.jumpsUsed >= 1) {
      // 空中：摆尾腾跃
      doubleJump(s);
      return;
    }
    // 未跃起：悬浮蓄力
    s.charging = true;
    s.charge = 0;
  }, [start]);

  const releaseJump = useCallback(() => {
    const s = simRef.current;
    if (!s.charging || s.phase !== "running" || s.paused) return;
    performJump(s, tRef.current);
  }, []);

  const togglePause = useCallback(() => {
    const s = simRef.current;
    if (s.phase !== "running") return;
    s.paused = !s.paused;
    s.lastTs = 0;
    sfxClick();
  }, []);

  // 键盘
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      if ([" ", "arrowup", "w", "p", "r"].includes(k)) e.preventDefault();
      if (k === "p") {
        togglePause();
        return;
      }
      if (k === "r") {
        reset();
        return;
      }
      if (k === " " || k === "arrowup" || k === "w") pressJump();
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === " " || k === "arrowup" || k === "w") releaseJump();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [pressJump, releaseJump, togglePause, reset]);

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
      let dt = (ts - s.lastTs) / 1000;
      s.lastTs = ts;
      if (dt <= 0) dt = 0.001;
      if (dt > 0.05) dt = 0.05;
      step(s, dt, tRef.current);
      render(ctx, s, ts / 1000);
      syncUi(s, lastUiRef, setUi);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const livesText = ui.lives > 0 ? "❤".repeat(ui.lives) : "—";

  return (
    <GameFrame
      emoji="🐟"
      title={i18n.text("game.carp.title")}
      stats={[
        { label: i18n.text("game.carp.score"), value: ui.score, colors: CHIP_GOLD },
        { label: i18n.text("game.carp.gates"), value: ui.gates, colors: CHIP_RED },
        {
          label: i18n.text("game.carp.combo"),
          value: ui.combo > 1 ? `${ui.combo} ×${Math.min(3, 1 + Math.floor(ui.combo / 3))}` : ui.combo,
          colors: CHIP_GREEN,
        },
        { label: i18n.text("game.carp.lives"), value: livesText, colors: CHIP_PURPLE },
      ]}
      headerExtra={
        <>
          {ui.phase === "running" && (
            <GhostBtn onClick={togglePause}>
              {ui.paused ? <PlayCircleOutlined /> : <PauseOutlined />}
              {ui.paused
                ? i18n.text("game.carp.resume")
                : i18n.text("game.carp.pause")}
            </GhostBtn>
          )}
          <GhostBtn onClick={reset}>
            <ReloadOutlined />
            {i18n.text("game.carp.restart")}
          </GhostBtn>
        </>
      }
      help={i18n.text("game.carp.help")}
      maxWidth={620}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: W,
          borderRadius: 14,
          overflow: "hidden",
          boxShadow: "0 10px 26px rgba(10,50,70,0.35)",
          border: "2px solid rgba(40,140,160,0.4)",
        }}
      >
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          style={{ display: "block", width: "100%", height: "auto" }}
          onPointerDown={(e) => {
            e.preventDefault();
            pressJump();
          }}
          onPointerUp={() => releaseJump()}
          onPointerLeave={() => releaseJump()}
        />

        {/* 待机提示 */}
        {ui.phase === "idle" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(8,30,42,0.5)",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
            }}
          >
            <span style={{ fontSize: 36, lineHeight: 1 }}>🐟</span>
            <span style={{ fontSize: 16, fontWeight: 800 }}>
              {i18n.text("game.carp.idle")}
            </span>
            <PrimaryBtn onClick={start}>{i18n.text("game.carp.start")}</PrimaryBtn>
          </div>
        )}

        {/* 暂停 */}
        {ui.phase === "running" && ui.paused && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(10,14,20,0.45)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
            }}
          >
            <span style={{ fontSize: 22, fontWeight: 800 }}>
              {i18n.text("game.carp.paused")}
            </span>
            <span style={{ fontSize: 13, opacity: 0.85 }}>
              {i18n.text("game.carp.resumeTip")}
            </span>
          </div>
        )}

        {/* 结束 */}
        {ui.phase === "over" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(8,22,30,0.58)",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
            }}
          >
            <span style={{ fontSize: 24, fontWeight: 800 }}>
              {i18n.text("game.carp.over")}
            </span>
            <span style={{ fontSize: 14, opacity: 0.92 }}>
              {i18n.text("game.carp.overDetail", {
                score: ui.score,
                gates: ui.gates,
              })}
            </span>
            <span style={{ fontSize: 13, opacity: 0.8 }}>
              {i18n.text("game.carp.best")}: {ui.best}
            </span>
            <PrimaryBtn onClick={start}>{i18n.text("game.carp.again")}</PrimaryBtn>
          </div>
        )}
      </div>
    </GameFrame>
  );
};

export default CarpGateGame;
