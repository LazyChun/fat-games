/*
 * HurdleGame：跨栏冲刺（新游戏）
 *
 * 田径场横向跑酷：选手自动奔跑，空格 / ↑ / W（或点击画面）起跳——
 * 按住蓄力跳更高，空中可再按一次二段跳。
 *
 * 特色机制：
 *   - 精准跨栏：贴栏顶跃过判定「完美」（+25×倍率），跳太高只算普通（+10×倍率）；
 *   - 高栏需蓄力起跳、双栏需要节奏（可二段跳连过）；
 *   - 金色圆环：跨栏后仍滞空可顺路摘取加分；
 *   - 连击倍率：连续跨栏叠连击，倍率 ×1 → ×3；
 *   - 撞栏绊倒：短暂减速、连击清零并扣一条命，三条命用完比赛结束；
 *   - 速度随时间持续提升，每 14 秒提示一次「加速」。
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
  sfxLand,
  sfxLevelUp,
  sfxLose,
  sfxMatch,
  sfxMismatch,
  sfxPerfect,
  sfxRefuel,
  sfxScore,
} from "./sound";

/* ------------------------------------------------------------------ */
/* 常量                                                               */
/* ------------------------------------------------------------------ */

const W = 560;
const H = 320;
const GROUND = 268;
const RUNNER_X = 92; // 选手固定横坐标（脚底中心）
const RUNNER_HALF = 17; // 碰撞半宽
const GRAVITY = 1650;
const BASE_SPEED = 250;
const MAX_SPEED = 560;
const SPEED_ACCEL = 7.5; // 每秒提速
const JUMP_MIN = 500; // 轻点起跳初速
const JUMP_POWER = 380; // 蓄力加成
const CHARGE_MAX = 0.42; // 最大蓄力时长
const DOUBLE_JUMP_VY = 660;
const KNOCKDOWN = 1.3; // 绊倒减速时长
const LS_BEST = "fat-games.hurdle.best";

/* 体力系统 */
const STAMINA_MAX = 100;
const STAMINA_RECOVER = 22; // 每秒平缓恢复
const JUMP_COST_MIN = 14; // 轻点起跳消耗
const JUMP_COST_POWER = 34; // 满蓄额外消耗
const DOUBLE_COST = 26; // 二段跳消耗
const MIN_JUMP_STAMINA = 12; // 低于该值无法起跳

/* 高空补给包 */
const MAX_LIVES = 5; // 生命上限（血包可加命）
const PACK_Y = GROUND - 148; // 补给包悬浮高度
const PACK_COLLECT_Y = GROUND - 128; // 脚底低于该高度才可拾取

type Phase = "idle" | "running" | "over";

interface Hurdle {
  x: number;
  height: number; // 栏高（随机变化）
  cleared: boolean;
  hit: boolean;
  fall: number; // 倾倒角（>0 表示已被撞倒）
}
interface Pack {
  x: number;
  kind: "health" | "stamina";
  taken: boolean;
}
interface Ring {
  x: number;
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
  dist: number;
  score: number;
  combo: number;
  lives: number;
  speed: number;
  best: number;
  stamina: number;
  // 选手
  y: number; // 脚底 y
  vy: number;
  airborne: boolean;
  jumpsUsed: number;
  charging: boolean;
  charge: number;
  runPhase: number;
  // 场景
  nextX: number;
  nextPackX: number; // 下一个补给包的滚动触发点
  hurdles: Hurdle[];
  rings: Ring[];
  packs: Pack[];
  popups: Popup[];
  particles: Particle[];
  shake: number;
  invincible: number;
  knockdown: number;
  speedUpAt: number;
  cleared: number;
  paused: boolean;
  recorded: boolean;
  lastTs: number;
}
interface Ui {
  phase: Phase;
  score: number;
  dist: number;
  combo: number;
  lives: number;
  stamina: number;
  cleared: number;
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
    dist: 0,
    score: 0,
    combo: 0,
    lives: 3,
    speed: BASE_SPEED,
    best: loadBest(),
    stamina: STAMINA_MAX,
    y: GROUND,
    vy: 0,
    airborne: false,
    jumpsUsed: 0,
    charging: false,
    charge: 0,
    runPhase: 0,
    nextX: RUNNER_X + 340,
    nextPackX: W + 220,
    hurdles: [],
    rings: [],
    packs: [],
    popups: [],
    particles: [],
    shake: 0,
    invincible: 0,
    knockdown: 0,
    speedUpAt: 12,
    cleared: 0,
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

function barTop(h: Hurdle): number {
  return GROUND - h.height;
}

function multiplier(s: Sim): number {
  return Math.min(3, 1 + Math.floor(s.combo / 4));
}

function effectiveSpeed(s: Sim): number {
  return s.knockdown > 0 ? s.speed * 0.55 : s.speed;
}

function mkHurdle(x: number, height: number): Hurdle {
  return { x, height, cleared: false, hit: false, fall: 0 };
}

/** 一次起跳（含体力扣除）；返回是否成功起跳 */
function performGroundJump(
  s: Sim,
  t: (id?: string, values?: Record<string, string | number>) => string,
): boolean {
  const ratio = s.charge / CHARGE_MAX;
  if (s.stamina < MIN_JUMP_STAMINA) {
    addPopup(s, RUNNER_X, GROUND - 116, t("game.hurdle.noStamina"), "#ffb3a7", 0.7, 14);
    sfxMismatch();
    s.charging = false;
    return false;
  }
  s.stamina = Math.max(0, s.stamina - (JUMP_COST_MIN + JUMP_COST_POWER * ratio));
  s.vy = -(JUMP_MIN + JUMP_POWER * ratio);
  s.airborne = true;
  s.jumpsUsed = 1;
  s.charging = false;
  sfxJump();
  puff(s, RUNNER_X, GROUND, 8, "#c8b49a");
  return true;
}

/** 生成一组障碍：连栏数量、高栏概率与密度都随进度提升，越到后面栏越多 */
function spawnPattern(s: Sim): void {
  const tier = Math.min(6, Math.floor(s.time / 8)); // 每 8s 升一档
  const bump = Math.min(16, tier * 3); // 栏高随进度整体抬升
  const r = Math.random();

  // 连栏数量：难度逐级爬升——1 栏 → 双栏 → 三连 → 四连成墙
  let count = 1;
  if (tier >= 4) {
    if (r < 0.3) count = 2;
    else if (r < 0.75) count = 3;
    else if (r < 0.95) count = 4;
  } else if (tier === 3) {
    if (r < 0.4) count = 2;
    else if (r < 0.9) count = 3;
  } else if (tier === 2) {
    if (r < 0.55) count = 2;
    else if (r < 0.85) count = 3;
  } else if (tier === 1) {
    if (r < 0.65) count = 2;
  }

  // 高栏概率随进度上升（前期无高栏，后期过半）
  const highChance = tier >= 1 ? Math.min(0.55, 0.12 + (tier - 1) * 0.09) : 0;
  const x = s.nextX;
  for (let i = 0; i < count; i++) {
    const hx = x + i * (40 + Math.random() * 12);
    const isHigh = Math.random() < highChance;
    const h = isHigh
      ? 62 + Math.random() * 28 + bump
      : 28 + Math.random() * 26 + bump;
    s.hurdles.push(mkHurdle(hx, h));
  }

  // 金环：约半数障碍组伴随一个金环
  if (Math.random() < 0.55) {
    s.rings.push({ x: x + count * 42 + 8, taken: false });
  }

  // 组间距：随进度与速度持续收紧（后期屏内可同时出现成排的栏）
  const gap =
    Math.max(130, 300 - tier * 32 - (s.speed - BASE_SPEED) * 0.16) +
    Math.random() * 45;
  s.nextX = x + count * 42 + gap;
}

/** 卷轴式补给：在屏幕右侧边缘外随机生成一个高空补给包（生命 / 体力） */
function spawnPack(s: Sim): void {
  s.packs.push({
    x: W + 24,
    kind: Math.random() < 0.5 ? "health" : "stamina",
    taken: false,
  });
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
      x: x + (Math.random() - 0.5) * 18,
      y: y - Math.random() * 6,
      vx: (Math.random() - 0.5) * 160,
      vy: -20 - Math.random() * 90,
      age: 0,
      life: 0.35 + Math.random() * 0.25,
      size: 3 + Math.random() * 4,
      color,
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

/** 撞栏绊倒：扣命、掉连击、短暂减速；返回是否比赛结束 */
function hitHurdle(
  s: Sim,
  h: Hurdle,
  t: (id?: string, values?: Record<string, string | number>) => string,
): boolean {
  h.hit = true;
  h.fall = 0.001;
  s.lives -= 1;
  s.combo = 0;
  s.knockdown = KNOCKDOWN;
  s.invincible = 1.5;
  s.shake = 9;
  addPopup(s, RUNNER_X, GROUND - 96, t("game.hurdle.trip"), "#ff8a80", 0.95, 18);
  sfxHurt();
  puff(s, RUNNER_X, GROUND, 12, "#e8c9a0");

  if (s.lives <= 0) {
    s.phase = "over";
    s.charging = false;
    s.airborne = false;
    s.vy = 0;
    s.y = GROUND;
    if (!s.recorded) {
      s.recorded = true;
      const finalScore = Math.floor(s.score);
      // 本地最高分
      if (finalScore > s.best) {
        s.best = finalScore;
        try {
          window.localStorage.setItem(LS_BEST, String(finalScore));
        } catch {
          /* ignore */
        }
      }
      recordScore({
        gameId: "hurdle",
        gameTitle: "跨栏冲刺",
        score: finalScore,
        detail: { cleared: s.cleared, dist: Math.floor(s.dist / 55) },
      });
    }
    sfxLose();
    return true;
  }
  return false;
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
  const eff = effectiveSpeed(s);
  s.dist += eff * dt;
  s.score += (eff * dt) / 14; // 距离分（每 14px 得 1 分）

  s.speed = Math.min(MAX_SPEED, BASE_SPEED + SPEED_ACCEL * s.time);
  if (s.time >= s.speedUpAt) {
    s.speedUpAt += 14;
    addPopup(s, W / 2, 54, t("game.hurdle.speedUp"), "#8bf0a9", 1.1, 22);
    sfxLevelUp();
  }

  // 蓄力（按住越长跳越高；满蓄自动起跳）
  if (s.charging) {
    s.charge += dt;
    if (s.charge >= CHARGE_MAX) {
      s.charge = CHARGE_MAX;
      performGroundJump(s, t);
    }
  }

  // 体力：不跳跃时平缓恢复（起跳 / 滞空 / 蓄力中不恢复）
  if (!s.airborne && !s.charging) {
    s.stamina = Math.min(STAMINA_MAX, s.stamina + STAMINA_RECOVER * dt);
  }

  // 跳跃物理
  if (s.airborne) {
    s.vy += GRAVITY * dt;
    s.y += s.vy * dt;
    if (s.y >= GROUND) {
      s.y = GROUND;
      s.vy = 0;
      s.airborne = false;
      s.jumpsUsed = 0;
      sfxLand();
      puff(s, RUNNER_X, GROUND, 6, "#c8b49a");
    }
  }

  s.runPhase += eff * dt * 0.028;

  // 障碍移动与倾倒
  for (const h of s.hurdles) {
    h.x -= eff * dt;
    if (h.fall > 0) h.fall = Math.min(0.6, h.fall + dt * 1.6);
  }
  for (const r of s.rings) r.x -= eff * dt;
  for (const p of s.packs) p.x -= eff * dt;
  s.hurdles = s.hurdles.filter((h) => h.x > -100);
  s.rings = s.rings.filter((r) => r.x > -60);
  s.packs = s.packs.filter((p) => p.x > -60);

  // 世界滚动：生成点随世界一起前移，保证障碍循环不断
  s.nextX -= eff * dt;
  while (s.nextX < W + 180) spawnPattern(s);

  // 补给包卷轴：持续从右侧边缘滚入，循环不断
  s.nextPackX -= eff * dt;
  if (s.nextPackX < W + 20) {
    if (Math.random() < 0.85) spawnPack(s);
    s.nextPackX = W + 180 + Math.random() * 220;
  }

  if (s.knockdown > 0) s.knockdown -= dt;
  if (s.invincible > 0) s.invincible -= dt;

  // 跨栏判定
  for (const h of s.hurdles) {
    if (h.cleared || h.hit) continue;
    if (Math.abs(h.x - RUNNER_X) > RUNNER_HALF + 6) continue;
    const top = barTop(h);
    if (s.airborne && s.y <= top - 2) {
      h.cleared = true;
      s.cleared += 1;
      s.combo += 1;
      const mult = multiplier(s);
      const clear = top - s.y; // 栏顶之上富余高度
      if (clear <= 26) {
        const pts = 25 * mult;
        s.score += pts;
        addPopup(
          s,
          RUNNER_X + 4,
          GROUND - 152,
          `${t("game.hurdle.perfect")} +${pts}`,
          "#ffd54a",
          1.0,
          19,
        );
        sparkle(s, RUNNER_X, s.y - 26, 12);
        sfxPerfect();
      } else {
        const pts = 10 * mult;
        s.score += pts;
        addPopup(s, RUNNER_X + 4, GROUND - 142, `+${pts}`, "#d5f5d8", 0.8, 16);
        sfxScore();
      }
    } else if (s.invincible <= 0) {
      if (hitHurdle(s, h, t)) break;
    }
  }

  // 金环
  for (const r of s.rings) {
    if (r.taken) continue;
    if (s.airborne && Math.abs(r.x - RUNNER_X) < 19 && s.y < GROUND - 66) {
      r.taken = true;
      const pts = 5 * multiplier(s);
      s.score += pts;
      addPopup(s, RUNNER_X, GROUND - 170, `+${pts}`, "#ffd54a", 0.8, 15);
      sparkle(s, RUNNER_X, GROUND - 138, 8);
      sfxCoin();
    }
  }

  // 高空补给包：生命包加命 / 体力包回满
  for (const p of s.packs) {
    if (p.taken) continue;
    if (s.airborne && Math.abs(p.x - RUNNER_X) < 21 && s.y < PACK_COLLECT_Y) {
      p.taken = true;
      if (p.kind === "health") {
        if (s.lives < MAX_LIVES) {
          s.lives += 1;
          addPopup(s, RUNNER_X, GROUND - 195, t("game.hurdle.lifeUp"), "#ff8a80", 0.9, 17);
          sfxMatch();
        } else {
          s.score += 25;
          addPopup(s, RUNNER_X, GROUND - 195, "+25", "#ffd54a", 0.8, 16);
          sfxCoin();
        }
      } else {
        s.stamina = STAMINA_MAX;
        addPopup(s, RUNNER_X, GROUND - 195, t("game.hurdle.staminaFull"), "#7cc7ff", 0.9, 16);
        sfxRefuel();
      }
      sparkle(s, RUNNER_X, PACK_Y - 10, 10);
    }
  }
}

/* ------------------------------------------------------------------ */
/* 渲染                                                               */
/* ------------------------------------------------------------------ */

function wrapX(x: number, span: number): number {
  const m = x % span;
  return m < 0 ? m + span : m;
}

function cloud(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
): void {
  ctx.beginPath();
  ctx.arc(x, y, 14 * s, 0, Math.PI * 2);
  ctx.arc(x + 14 * s, y - 5 * s, 11 * s, 0, Math.PI * 2);
  ctx.arc(x + 28 * s, y, 13 * s, 0, Math.PI * 2);
  ctx.fill();
}

function drawRunner(
  ctx: CanvasRenderingContext2D,
  s: Sim,
  now: number,
): void {
  const x = RUNNER_X;
  const feetY = s.y;
  const airH = Math.max(0, (GROUND - feetY) / 150);

  // 影子（高度越高影子越小越淡，钳制到 0 防止极端高度下负值报错）
  const shAlpha = Math.max(0, 0.16 * (1 - airH * 0.6));
  const shRx = Math.max(0, 15 * (1 - airH * 0.45));
  ctx.fillStyle = `rgba(0,0,0,${shAlpha})`;
  ctx.beginPath();
  ctx.ellipse(x, GROUND + 3, shRx, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // 无敌闪烁
  if (s.invincible > 0 && s.phase === "running" && Math.floor(now * 18) % 2 === 0) {
    return;
  }

  ctx.save();
  ctx.translate(x, feetY);
  ctx.lineCap = "round";

  const t = s.runPhase;
  const swing = s.airborne ? 0 : Math.sin(t);
  const fFootX = 11 * swing;
  const rFootX = -11 * swing;
  const fFootY = s.airborne ? -16 - Math.max(0, s.vy) * 0.012 : -2;
  const rFootY = s.airborne ? -10 - Math.max(0, -s.vy) * 0.008 : -2;

  // 后腿
  ctx.strokeStyle = "#20242b";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(1, -30);
  ctx.lineTo(rFootX, rFootY);
  ctx.stroke();
  // 前腿
  ctx.strokeStyle = "#2f3542";
  ctx.beginPath();
  ctx.moveTo(1, -30);
  ctx.lineTo(fFootX, fFootY);
  ctx.stroke();

  // 跑鞋
  ctx.fillStyle = "#ff6b6b";
  ctx.beginPath();
  ctx.ellipse(rFootX, rFootY + 1, 6, 3.2, 0, 0, Math.PI * 2);
  ctx.ellipse(fFootX, fFootY + 1, 6, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // 身体（前倾）
  ctx.strokeStyle = "#3b82f6";
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(0, -28);
  ctx.lineTo(6, -50);
  ctx.stroke();
  // 短裤
  ctx.strokeStyle = "#facc15";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(0, -28);
  ctx.lineTo(1, -31);
  ctx.stroke();

  // 手臂（随奔跑摆动，与腿相反；腾空时上举）
  const shX = 6;
  const shY = -50;
  let fAng: number;
  let bAng: number;
  if (s.airborne) {
    fAng = -1.15; // 上举
    bAng = -2.1;
  } else {
    const swingA = Math.sin(t);
    fAng = 0.5 + swingA * 0.75;
    bAng = Math.PI - 0.5 - swingA * 0.75;
  }
  const fHx = shX + Math.cos(fAng) * 13;
  const fHy = shY + Math.sin(fAng) * 13;
  const bHx = shX + Math.cos(bAng) * 13;
  const bHy = shY + Math.sin(bAng) * 13;
  ctx.strokeStyle = "#1d4ed8";
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.moveTo(shX, shY);
  ctx.lineTo(bHx, bHy);
  ctx.stroke();
  ctx.strokeStyle = "#2563eb";
  ctx.beginPath();
  ctx.moveTo(shX, shY);
  ctx.lineTo(fHx, fHy);
  ctx.stroke();
  // 手（皮肤色小圆，与手臂相连）
  ctx.fillStyle = "#ffd7a8";
  ctx.beginPath();
  ctx.arc(fHx, fHy, 2.3, 0, Math.PI * 2);
  ctx.arc(bHx, bHy, 2.3, 0, Math.PI * 2);
  ctx.fill();

  // 头
  ctx.fillStyle = "#ffd7a8";
  ctx.beginPath();
  ctx.arc(9, -58, 6.5, 0, Math.PI * 2);
  ctx.fill();
  // 红帽
  ctx.fillStyle = "#ef4444";
  ctx.beginPath();
  ctx.arc(9, -60, 6.5, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(9, -66, 8, 3.2);
  // 眼睛
  ctx.fillStyle = "#20242b";
  ctx.beginPath();
  ctx.arc(11.5, -58.5, 1.1, 0, Math.PI * 2);
  ctx.fill();

  // 体力条（始终显示，低于 25% 变红）
  const stRatio = Math.max(0, s.stamina) / STAMINA_MAX;
  const sbW = 44;
  const sbY = -110;
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(-sbW / 2, sbY, sbW, 5);
  ctx.fillStyle = stRatio < 0.25 ? "#ff6b6b" : "#4facfe";
  ctx.fillRect(-sbW / 2, sbY, sbW * stRatio, 5);

  // 蓄力条
  if (s.charging) {
    const ratio = Math.min(1, s.charge / CHARGE_MAX);
    const bw = 36;
    const by = -96;
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(-bw / 2, by, bw, 5);
    ctx.fillStyle = ratio >= 1 ? "#ff6b6b" : "#ffd54a";
    ctx.fillRect(-bw / 2, by, bw * ratio, 5);
  }

  // 连击倍率
  if (s.combo >= 2 && s.phase === "running") {
    ctx.font = "800 15px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.strokeText(`×${multiplier(s)}`, 28, -92);
    ctx.fillStyle = "#ffd54a";
    ctx.fillText(`×${multiplier(s)}`, 28, -92);
  }

  ctx.restore();
}

function render(ctx: CanvasRenderingContext2D, s: Sim, now: number): void {
  ctx.clearRect(0, 0, W, H);

  // 震屏
  if (s.shake > 0) {
    const m = Math.min(7, s.shake);
    ctx.translate((Math.random() - 0.5) * m * 2, (Math.random() - 0.5) * m * 2);
  }

  // 天空
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#7ec8f7");
  sky.addColorStop(0.65, "#cdeafb");
  sky.addColorStop(1, "#eef7fd");
  ctx.fillStyle = sky;
  ctx.fillRect(-12, -12, W + 24, H + 24);

  // 太阳
  ctx.fillStyle = "rgba(255,236,160,0.35)";
  ctx.beginPath();
  ctx.arc(W - 70, 52, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffd65a";
  ctx.beginPath();
  ctx.arc(W - 70, 52, 20, 0, Math.PI * 2);
  ctx.fill();

  // 云（视差）
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  for (let i = 0; i < 3; i++) {
    const cx = wrapX(i * 240 + 60 - now * 26, W + 200) - 100;
    cloud(ctx, cx, 46 + i * 26, 0.9 + i * 0.15);
  }

  // 看台
  ctx.fillStyle = "rgba(96,116,148,0.35)";
  ctx.fillRect(0, 88, W, 26);
  ctx.fillStyle = "rgba(130,150,180,0.4)";
  const bandOff = wrapX(s.dist * 0.35, 40);
  for (let x = -bandOff; x < W; x += 40) {
    ctx.fillRect(x, 92, 22, 18);
  }

  // 跑道
  const trackTop = 222;
  ctx.fillStyle = "#d6503f";
  ctx.fillRect(0, trackTop, W, GROUND - trackTop);
  // 跑道纹理（滚动）
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 2;
  const lineOff = wrapX(s.dist, 52);
  for (let x = -lineOff; x < W; x += 52) {
    ctx.beginPath();
    ctx.moveTo(x, 240);
    ctx.lineTo(x, 250);
    ctx.stroke();
  }
  // 分道线
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.setLineDash([16, 20]);
  ctx.lineDashOffset = -s.dist;
  ctx.beginPath();
  ctx.moveTo(0, 256);
  ctx.lineTo(W, 256);
  ctx.stroke();
  ctx.setLineDash([]);

  // 草地
  ctx.fillStyle = "#4c9e4f";
  ctx.fillRect(0, GROUND, W, H - GROUND);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  const grassOff = wrapX(s.dist * 0.5, 60);
  for (let x = -grassOff; x < W; x += 60) {
    ctx.fillRect(x, GROUND, 30, H - GROUND);
  }

  // 金环
  for (const r of s.rings) {
    if (r.taken) continue;
    ctx.save();
    ctx.translate(r.x, GROUND - 138);
    ctx.rotate(now * 2 + r.x * 0.02);
    ctx.strokeStyle = "#ffd54a";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "#fff3c4";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // 高空补给包：白底红十字 = 生命包；蓝底闪电 = 体力包
  for (const p of s.packs) {
    if (p.taken) continue;
    const bob = Math.sin(now * 3 + p.x * 0.03) * 4;
    const py = PACK_Y + bob;
    ctx.save();
    ctx.translate(p.x, py);
    // 柔光晕
    ctx.fillStyle =
      p.kind === "health" ? "rgba(255,120,110,0.28)" : "rgba(90,180,255,0.28)";
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.fill();
    if (p.kind === "health") {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(-11, -9, 22, 18);
      ctx.fillStyle = "#e5484d";
      ctx.fillRect(-3.5, -6, 7, 12);
      ctx.fillRect(-6, -3.5, 12, 7);
    } else {
      ctx.fillStyle = "#4facfe";
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(1.5, -6);
      ctx.lineTo(-3.5, 1.5);
      ctx.lineTo(0.5, 1.5);
      ctx.lineTo(-1.5, 6);
      ctx.lineTo(3.5, -1.5);
      ctx.lineTo(-0.5, -1.5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // 栏架
  for (const h of s.hurdles) {
    if (h.x < -40 || h.x > W + 40) continue;
    const top = barTop(h);
    ctx.save();
    if (h.fall > 0) {
      ctx.translate(h.x, GROUND);
      ctx.rotate(-Math.min(1.35, h.fall * 2.4));
    } else {
      ctx.translate(h.x, 0);
    }
    ctx.strokeStyle = "#f5f5f5";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-4, top);
    ctx.lineTo(-4, GROUND);
    ctx.moveTo(4, top);
    ctx.lineTo(4, GROUND);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(-16, top - 5, 32, 6);
    ctx.fillStyle = "#e5484d";
    ctx.fillRect(-16, top - 3, 32, 3);
    ctx.restore();
  }

  // 选手
  drawRunner(ctx, s, now);

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
    dist: Math.floor(s.dist / 55),
    combo: s.combo,
    lives: Math.max(0, s.lives),
    stamina: Math.round(s.stamina),
    cleared: s.cleared,
    best: s.best,
    paused: s.paused,
  };
  const cur = lastUiRef.current;
  if (
    next.phase !== cur.phase ||
    next.score !== cur.score ||
    next.dist !== cur.dist ||
    next.combo !== cur.combo ||
    next.lives !== cur.lives ||
    next.stamina !== cur.stamina ||
    next.cleared !== cur.cleared ||
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

const HurdleGame: React.FC<{ sdk: FatNotesPluginSDK }> = () => {
  const i18n = useI18n();
  const simRef = useRef<Sim>(newSim());
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastUiRef = useRef<Ui>({
    phase: "idle",
    score: 0,
    dist: 0,
    combo: 0,
    lives: 3,
    stamina: STAMINA_MAX,
    cleared: 0,
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
      dist: 0,
      combo: 0,
      lives: 3,
      stamina: STAMINA_MAX,
      cleared: 0,
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
    if (!s.airborne) {
      s.charging = true;
    } else if (s.jumpsUsed < 2) {
      if (s.stamina < DOUBLE_COST) {
        addPopup(
          s,
          RUNNER_X,
          s.y - 66,
          tRef.current("game.hurdle.noStamina"),
          "#ffb3a7",
          0.7,
          14,
        );
        sfxMismatch();
        return;
      }
      s.stamina = Math.max(0, s.stamina - DOUBLE_COST);
      s.vy = -DOUBLE_JUMP_VY;
      s.jumpsUsed = 2;
      sfxJump();
      puff(s, RUNNER_X, s.y - 8, 6, "#e8e8e8");
    }
  }, [start]);

  const releaseJump = useCallback(() => {
    const s = simRef.current;
    if (!s.charging || s.phase !== "running" || s.paused) return;
    performGroundJump(s, tRef.current);
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
      const k = e.key.toLowerCase();
      if ([" ", "arrowup", "w", "p"].includes(k)) e.preventDefault();
      if (k === "p") {
        togglePause();
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
  }, [pressJump, releaseJump, togglePause]);

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
      emoji="🏃"
      title={i18n.text("game.hurdle.title")}
      stats={[
        { label: i18n.text("game.hurdle.score"), value: ui.score, colors: CHIP_GOLD },
        {
          label: i18n.text("game.hurdle.dist"),
          value: `${ui.dist}m`,
          colors: CHIP_BLUE,
        },
        {
          label: i18n.text("game.hurdle.combo"),
          value: ui.combo > 1 ? `${ui.combo} ×${Math.min(3, 1 + Math.floor(ui.combo / 4))}` : ui.combo,
          colors: CHIP_GREEN,
        },
        {
          label: i18n.text("game.hurdle.stamina"),
          value: `${ui.stamina}%`,
          colors: ui.stamina < 25 ? CHIP_RED : CHIP_PURPLE,
        },
        { label: i18n.text("game.hurdle.lives"), value: livesText, colors: CHIP_RED },
      ]}
      headerExtra={
        <>
          {ui.phase === "running" && (
            <GhostBtn onClick={togglePause}>
              {ui.paused ? <PlayCircleOutlined /> : <PauseOutlined />}
              {ui.paused
                ? i18n.text("game.hurdle.resume")
                : i18n.text("game.hurdle.pause")}
            </GhostBtn>
          )}
          <GhostBtn onClick={reset}>
            <ReloadOutlined />
            {i18n.text("game.hurdle.restart")}
          </GhostBtn>
        </>
      }
      help={i18n.text("game.hurdle.help")}
      maxWidth={620}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: W,
          borderRadius: 14,
          overflow: "hidden",
          boxShadow: "0 10px 26px rgba(30,60,110,0.35)",
          border: "2px solid rgba(90,140,190,0.4)",
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
              background: "rgba(12,30,50,0.45)",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
            }}
          >
            <span style={{ fontSize: 36, lineHeight: 1 }}>🏃</span>
            <span style={{ fontSize: 16, fontWeight: 800 }}>
              {i18n.text("game.hurdle.idle")}
            </span>
            <PrimaryBtn onClick={start}>{i18n.text("game.hurdle.start")}</PrimaryBtn>
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
              {i18n.text("game.hurdle.paused")}
            </span>
            <span style={{ fontSize: 13, opacity: 0.85 }}>
              {i18n.text("game.hurdle.resumeTip")}
            </span>
          </div>
        )}

        {/* 结束 */}
        {ui.phase === "over" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(10,14,20,0.55)",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
            }}
          >
            <span style={{ fontSize: 24, fontWeight: 800 }}>
              {i18n.text("game.hurdle.over")}
            </span>
            <span style={{ fontSize: 14, opacity: 0.92 }}>
              {i18n.text("game.hurdle.overDetail", {
                score: ui.score,
                cleared: ui.cleared,
                dist: ui.dist,
              })}
            </span>
            <span style={{ fontSize: 13, opacity: 0.8 }}>
              {i18n.text("game.hurdle.best")}: {ui.best}
            </span>
            <PrimaryBtn onClick={start}>{i18n.text("game.hurdle.again")}</PrimaryBtn>
          </div>
        )}
      </div>
    </GameFrame>
  );
};

export default HurdleGame;
