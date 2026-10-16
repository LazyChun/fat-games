/*
 * WukongGame：大圣闹天宫（横版闯关格斗）
 *
 * Canvas 实现：玩家操控孙悟空，持金箍棒横闯天宫。
 *   - A/D 或 ←/→ 左右移动，W/↑/空格 跳跃（可二段跳），J 普通棍击，K 旋转棍舞（耗气）
 *   - 天兵从两侧源源不断杀来，天将更耐打且会远程掷矛
 *   - 相机跟随悟空横向滚动，云海平台可站
 *   - 连击倍数随击杀提升；血量耗尽则闹天宫失败
 * 随时间推进：敌人更密、更快、更耐打。
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
  CHIP_RED,
  CHIP_GREEN,
  CHIP_BLUE,
} from "./GameFrame";
import {
  sfxHit,
  sfxBoom,
  sfxHurt,
  sfxLose,
  sfxJump,
  sfxScore,
} from "./sound";
import "./gameAnimations.less";

/* ------------------------------------------------------------------ */
/* 常量                                                                */
/* ------------------------------------------------------------------ */
const W = 800;
const H = 480;
const GROUND_Y = 410; // 地面顶部 y
const GRAVITY = 1500; // px/s^2
const MOVE_SPEED = 260;
const JUMP_VELOCITY = -560;
const PLAYER_W = 34;
const PLAYER_H = 52;
const PLACK = 60; // 玩家棍击判定宽度
const MAX_HP = 100;
const MAX_MP = 100; // 气
const ATTACK_DURATION = 0.32; // s
const ATTACK_HIT_DURATION = 0.16; // 判定帧窗口
const SPIN_DURATION = 0.7; // K 旋转棍舞时长
const SPIN_COST = 35;
const INVINCIBLE = 1.0;

interface Platform {
  x: number;
  y: number;
  w: number;
}

interface Enemy {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  kind: "soldier" | "general" | "archer";
  facing: number; // -1 左, 1 右
  onGround: boolean;
  attackCd: number;
  attackAnim: number;
  hitFlash: number;
  dead: boolean;
  deathT: number;
}

interface Spear {
  x: number;
  y: number;
  vx: number;
  facing: number;
  life: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  r: number;
  color: string;
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  until: number;
  color?: string;
}

interface Cloud {
  x: number;
  y: number;
  w: number;
  speed: number;
}

interface Sim {
  px: number;
  py: number; // 脚底 y
  vx: number;
  vy: number;
  facing: number;
  onGround: boolean;
  jumps: number; // 已用跳跃次数（最多 2）
  hp: number;
  mp: number;
  attackT: number; // >0 普通攻击进行中
  attackHitDone: boolean;
  spinT: number; // >0 旋转棍舞进行中
  spinHitDone: boolean;
  invincible: number;
  camX: number;
  enemies: Enemy[];
  spears: Spear[];
  parts: Particle[];
  floats: FloatText[];
  clouds: Cloud[];
  platforms: Platform[];
  score: number;
  kills: number;
  combo: number;
  comboTimer: number;
  running: boolean;
  over: boolean;
  recorded: boolean;
  elapsed: number;
  spawnCd: number;
  lastTs: number;
}

interface UiState {
  score: number;
  hp: number;
  mp: number;
  kills: number;
  combo: number;
  running: boolean;
  over: boolean;
}

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */
function makeClouds(): Cloud[] {
  const arr: Cloud[] = [];
  for (let i = 0; i < 12; i++) {
    arr.push({
      x: Math.random() * 2400,
      y: 30 + Math.random() * 180,
      w: 60 + Math.random() * 90,
      speed: 8 + Math.random() * 16,
    });
  }
  return arr;
}

function makePlatforms(): Platform[] {
  // 世界宽度约 2400，平台错落分布
  return [
    { x: 200, y: 330, w: 120 },
    { x: 420, y: 270, w: 110 },
    { x: 640, y: 320, w: 130 },
    { x: 900, y: 260, w: 120 },
    { x: 1120, y: 330, w: 110 },
    { x: 1360, y: 280, w: 130 },
    { x: 1620, y: 340, w: 110 },
    { x: 1860, y: 270, w: 120 },
    { x: 2100, y: 330, w: 120 },
  ];
}

function newSim(): Sim {
  return {
    px: 120,
    py: GROUND_Y,
    vx: 0,
    vy: 0,
    facing: 1,
    onGround: true,
    jumps: 0,
    hp: MAX_HP,
    mp: 60,
    attackT: 0,
    attackHitDone: false,
    spinT: 0,
    spinHitDone: false,
    invincible: 0,
    camX: 0,
    enemies: [],
    spears: [],
    parts: [],
    floats: [],
    clouds: makeClouds(),
    platforms: makePlatforms(),
    score: 0,
    kills: 0,
    combo: 0,
    comboTimer: 0,
    running: false,
    over: false,
    recorded: false,
    elapsed: 0,
    spawnCd: 1.0,
    lastTs: 0,
  };
}

function spawnEnemy(elapsed: number, camX: number, worldRight: number): Enemy | null {
  const difficulty = 1 + elapsed * 0.012;
  const roll = Math.random() * 100;
  let kind: Enemy["kind"] = "soldier";
  if (roll < 15 + Math.min(25, elapsed * 0.2)) kind = "archer";
  else if (roll < 35 + Math.min(30, elapsed * 0.4)) kind = "general";

  // 从相机两侧之外生成
  const fromLeft = Math.random() < 0.5;
  const x = fromLeft ? camX - 60 : camX + W + 60;
  if (x < 0 || x > worldRight) return null;

  if (kind === "soldier") {
    return {
      x,
      y: GROUND_Y,
      vx: 0,
      vy: 0,
      w: 30,
      h: 46,
      hp: Math.round(2 * difficulty),
      maxHp: Math.round(2 * difficulty),
      kind,
      facing: fromLeft ? 1 : -1,
      onGround: true,
      attackCd: 0,
      attackAnim: 0,
      hitFlash: 0,
      dead: false,
      deathT: 0,
    };
  }
  if (kind === "general") {
    return {
      x,
      y: GROUND_Y,
      vx: 0,
      vy: 0,
      w: 40,
      h: 58,
      hp: Math.round(5 * difficulty),
      maxHp: Math.round(5 * difficulty),
      kind,
      facing: fromLeft ? 1 : -1,
      onGround: true,
      attackCd: 1.0,
      attackAnim: 0,
      hitFlash: 0,
      dead: false,
      deathT: 0,
    };
  }
  // archer：站在地面但保持距离，掷矛
  return {
    x,
    y: GROUND_Y,
    vx: 0,
    vy: 0,
    w: 30,
    h: 48,
    hp: Math.round(3 * difficulty),
    maxHp: Math.round(3 * difficulty),
    kind,
    facing: fromLeft ? 1 : -1,
    onGround: true,
    attackCd: 1.5,
    attackAnim: 0,
    hitFlash: 0,
    dead: false,
    deathT: 0,
  };
}

function addHitSparks(s: Sim, x: number, y: number, big: boolean): void {
  const n = big ? 14 : 8;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 60 + Math.random() * (big ? 220 : 140);
    s.parts.push({
      x,
      y,
      vx: Math.cos(a) * spd,
      vy: Math.sin(a) * spd - 40,
      life: 0.3 + Math.random() * 0.25,
      maxLife: 0.55,
      r: big ? 2 + Math.random() * 2.5 : 1.5 + Math.random() * 1.8,
      color:
        Math.random() < 0.5
          ? "#ffd75e"
          : Math.random() < 0.5
            ? "#ff8a4c"
            : "#fff3a0",
    });
  }
}

function damagePlayer(s: Sim, amount: number, knockDir: number): void {
  if (s.invincible > 0 || s.over) return;
  s.hp -= amount;
  s.combo = 0;
  s.comboTimer = 0;
  s.invincible = INVINCIBLE;
  s.vx = knockDir * 180;
  s.vy = -220;
  addHitSparks(s, s.px, s.py - PLAYER_H / 2, false);
  sfxHurt();
  if (s.hp <= 0) {
    s.hp = 0;
    s.over = true;
    s.running = false;
    sfxLose();
  }
}

/* ------------------------------------------------------------------ */
/* 绘制                                                                */
/* ------------------------------------------------------------------ */
function drawScene(ctx: CanvasRenderingContext2D, s: Sim, ts: number): void {
  ctx.clearRect(0, 0, W, H);

  // 天宫背景：渐变天 + 远山/宫殿剪影
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#2a1a4a");
  bg.addColorStop(0.45, "#5a2a6a");
  bg.addColorStop(0.8, "#c05a4a");
  bg.addColorStop(1, "#e8a060");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 月亮
  ctx.fillStyle = "rgba(255,240,200,0.9)";
  ctx.beginPath();
  ctx.arc(W - 110, 80, 38, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,220,160,0.25)";
  ctx.beginPath();
  ctx.arc(W - 110, 80, 55, 0, Math.PI * 2);
  ctx.fill();

  // 远景宫殿剪影（ parallax 0.3）
  const bgCam = s.camX * 0.3;
  ctx.fillStyle = "rgba(60,20,60,0.55)";
  for (let i = 0; i < 6; i++) {
    const bx = i * 420 - (bgCam % 420) - 100;
    // 主殿
    ctx.fillRect(bx, 200, 180, GROUND_Y - 200);
    // 飞檐
    ctx.beginPath();
    ctx.moveTo(bx - 20, 200);
    ctx.lineTo(bx + 90, 160);
    ctx.lineTo(bx + 200, 200);
    ctx.closePath();
    ctx.fill();
    // 塔楼
    ctx.fillRect(bx + 60, 150, 60, 50);
    ctx.beginPath();
    ctx.moveTo(bx + 50, 150);
    ctx.lineTo(bx + 90, 120);
    ctx.lineTo(bx + 130, 150);
    ctx.closePath();
    ctx.fill();
  }

  // 飘动祥云（前景）
  for (const c of s.clouds) {
    const cx = c.x - s.camX * 0.6;
    if (cx + c.w < -20 || cx > W + 20) continue;
    ctx.fillStyle = "rgba(255,230,200,0.35)";
    ctx.beginPath();
    ctx.ellipse(cx, c.y, c.w / 2, 14, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + c.w * 0.2, c.y - 8, c.w / 3, 12, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 地面（云海基座）
  const groundGrad = ctx.createLinearGradient(0, GROUND_Y, 0, H);
  groundGrad.addColorStop(0, "#e8b878");
  groundGrad.addColorStop(1, "#8a4a5a");
  ctx.fillStyle = groundGrad;
  ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
  // 地面金边
  ctx.fillStyle = "rgba(255,220,150,0.8)";
  ctx.fillRect(0, GROUND_Y, W, 4);

  // 平台（云阶）
  for (const p of s.platforms) {
    const px = p.x - s.camX;
    if (px + p.w < -10 || px > W + 10) continue;
    ctx.fillStyle = "rgba(255,240,220,0.92)";
    ctx.beginPath();
    ctx.ellipse(px + p.w / 2, p.y, p.w / 2, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.beginPath();
    ctx.ellipse(px + p.w / 2, p.y - 4, p.w / 3, 8, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 敌方掷矛
  for (const sp of s.spears) {
    const sx = sp.x - s.camX;
    ctx.save();
    ctx.translate(sx, sp.y);
    ctx.rotate(sp.facing > 0 ? 0 : Math.PI);
    ctx.fillStyle = "#d0d0e0";
    ctx.fillRect(0, -1.5, 34, 3);
    ctx.beginPath();
    ctx.moveTo(34, -4);
    ctx.lineTo(44, 0);
    ctx.lineTo(34, 4);
    ctx.closePath();
    ctx.fillStyle = "#aaaacc";
    ctx.fill();
    ctx.restore();
  }

  // 敌人
  for (const e of s.enemies) {
    const ex = e.x - s.camX;
    if (ex < -60 || ex > W + 60) continue;
    drawEnemy(ctx, e, ts);
  }

  // 粒子
  for (const p of s.parts) {
    const a = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x - s.camX, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 飘字
  for (const f of s.floats) {
    if (ts >= f.until) continue;
    const a = Math.min(1, (f.until - ts) / 500);
    ctx.globalAlpha = a;
    ctx.fillStyle = f.color || "#ffe15e";
    ctx.font = "bold 15px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(f.text, f.x - s.camX, f.y - (700 - (f.until - ts)) * 0.04);
    ctx.globalAlpha = 1;
    ctx.textAlign = "start";
  }

  // 玩家（无敌时闪烁）
  if (!s.over) {
    const blink = s.invincible > 0 && Math.floor(ts / 90) % 2 === 0;
    if (!blink) drawWukong(ctx, s, ts);
  }

  // HUD：血条 / 气条
  const barX = 16;
  const barY = 16;
  const barW = 220;
  // HP 底
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(barX, barY, barW, 14);
  const hpR = s.hp / MAX_HP;
  const hpGrad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
  hpGrad.addColorStop(0, "#ff5a6a");
  hpGrad.addColorStop(1, "#ff9a4c");
  ctx.fillStyle = hpGrad;
  ctx.fillRect(barX + 2, barY + 2, (barW - 4) * hpR, 10);
  ctx.fillStyle = "#fff";
  ctx.font = "bold 10px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`HP ${Math.ceil(s.hp)}`, barX + barW / 2, barY + 11);
  // MP 气条
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.fillRect(barX, barY + 20, barW, 9);
  const mpR = s.mp / MAX_MP;
  ctx.fillStyle = "#5ac8ff";
  ctx.fillRect(barX + 2, barY + 22, (barW - 4) * mpR, 5);
  ctx.textAlign = "start";

  // 分数 / 连击
  ctx.fillStyle = "#fff";
  ctx.font = "bold 18px sans-serif";
  ctx.textAlign = "right";
  ctx.fillText(String(s.score), W - 16, 28);
  if (s.combo >= 2) {
    ctx.fillStyle = "#ffd75e";
    ctx.font = "bold 14px sans-serif";
    ctx.fillText(`${s.combo} 连击!`, W - 16, 48);
  }
  ctx.textAlign = "start";
}

function drawWukong(ctx: CanvasRenderingContext2D, s: Sim, ts: number): void {
  const cx = s.px - s.camX;
  const cy = s.py; // 脚底
  const dir = s.facing;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(dir, 1); // 朝向翻转

  // 腿
  ctx.strokeStyle = "#b8860b";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-6, -PLAYER_H + 18);
  ctx.lineTo(-6, -4);
  ctx.moveTo(6, -PLAYER_H + 18);
  ctx.lineTo(6, -4);
  ctx.stroke();
  // 靴子
  ctx.fillStyle = "#6b3410";
  ctx.fillRect(-10, -6, 8, 6);
  ctx.fillRect(3, -6, 8, 6);

  // 身体（虎皮裙 / 黄衣）
  ctx.fillStyle = "#e8b820";
  ctx.fillRect(-9, -PLAYER_H + 18, 18, 20);
  ctx.fillStyle = "#d06020";
  ctx.fillRect(-9, -PLAYER_H + 30, 18, 8);

  // 头
  ctx.fillStyle = "#e8a860";
  ctx.beginPath();
  ctx.arc(0, -PLAYER_H + 8, 9, 0, Math.PI * 2);
  ctx.fill();
  // 紧箍咒
  ctx.strokeStyle = "#ffd75e";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, -PLAYER_H + 8, 9, Math.PI * 1.1, Math.PI * 1.9);
  ctx.stroke();
  // 眼睛
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.arc(4, -PLAYER_H + 8, 1.6, 0, Math.PI * 2);
  ctx.fill();

  // 金箍棒
  const swinging = s.attackT > 0;
  const spinning = s.spinT > 0;
  ctx.save();
  if (spinning) {
    // 旋转棍舞：棍绕身体旋转
    const ang = (ts / 40) % (Math.PI * 2);
    ctx.rotate(ang);
    ctx.fillStyle = "#ffd75e";
    ctx.fillRect(-4, -PLAYER_H - 30, 8, PLAYER_H + 30);
    ctx.fillStyle = "#c06020";
    ctx.fillRect(-6, -PLAYER_H - 34, 12, 6);
    ctx.restore();
  } else if (swinging) {
    // 向前劈棍
    ctx.rotate(-0.6 + (1 - s.attackT / ATTACK_DURATION) * 1.6);
    ctx.fillStyle = "#ffd75e";
    ctx.fillRect(-4, -PLAYER_H - 20, 8, PLAYER_H + 20);
    ctx.fillStyle = "#c06020";
    ctx.fillRect(-6, -PLAYER_H - 24, 12, 6);
  } else {
    // 持棍站立
    ctx.fillStyle = "#ffd75e";
    ctx.fillRect(6, -PLAYER_H - 16, 7, PLAYER_H + 16);
    ctx.fillStyle = "#c06020";
    ctx.fillRect(4, -PLAYER_H - 20, 11, 5);
  }
  ctx.restore();

  ctx.restore();
}

function drawEnemy(ctx: CanvasRenderingContext2D, e: Enemy, ts: number): void {
  const cx = e.x - (e.dead ? 0 : 0); // 相机外已过滤
  const cy = e.y;
  const dir = e.facing;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(dir, 1);

  // 死亡动画：倒地淡出
  if (e.dead) {
    ctx.globalAlpha = Math.max(0, 1 - e.deathT / 0.5);
    ctx.rotate(e.deathT * 4);
  }

  // 受击闪白
  const flash = e.hitFlash > 0;

  // 腿
  ctx.strokeStyle = "#405080";
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(-5, -e.h + 16);
  ctx.lineTo(-5, -3);
  ctx.moveTo(5, -e.h + 16);
  ctx.lineTo(5, -3);
  ctx.stroke();

  // 身体
  if (e.kind === "soldier") {
    ctx.fillStyle = flash ? "#fff" : "#5068a8";
    ctx.fillRect(-8, -e.h + 16, 16, 18);
  } else if (e.kind === "general") {
    ctx.fillStyle = flash ? "#fff" : "#8a4a8a";
    ctx.fillRect(-10, -e.h + 18, 20, 24);
    // 甲片
    ctx.strokeStyle = "#ffd75e";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-10, -e.h + 18, 20, 24);
  } else {
    // archer
    ctx.fillStyle = flash ? "#fff" : "#3a8a6a";
    ctx.fillRect(-8, -e.h + 16, 16, 18);
  }

  // 头
  ctx.fillStyle = flash ? "#fff" : "#d0a070";
  ctx.beginPath();
  ctx.arc(0, -e.h + 6, 8, 0, Math.PI * 2);
  ctx.fill();
  // 头盔
  ctx.fillStyle = flash ? "#fff" : e.kind === "general" ? "#ffd75e" : "#304070";
  ctx.beginPath();
  ctx.arc(0, -e.h + 4, 8.5, Math.PI, 0);
  ctx.fill();
  // 盔缨
  ctx.strokeStyle = "#e03030";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -e.h - 4);
  ctx.lineTo(0, -e.h - 12);
  ctx.stroke();

  // 武器（天兵举刀 / 天将重锤 / 弓箭手弯弓）
  if (e.attackAnim > 0) {
    ctx.rotate(-0.5 + (1 - e.attackAnim) * 1.4);
  }
  if (e.kind === "soldier") {
    ctx.fillStyle = "#c0c0d0";
    ctx.fillRect(5, -e.h - 4, 4, 24);
  } else if (e.kind === "general") {
    ctx.fillStyle = "#a08040";
    ctx.fillRect(6, -e.h - 8, 6, 30);
    ctx.fillStyle = "#c04040";
    ctx.fillRect(2, -e.h - 14, 14, 8);
  } else {
    ctx.strokeStyle = "#604020";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(10, -e.h + 10, 10, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
  }

  ctx.restore();

  // 血条（小）
  if (!e.dead && e.hp < e.maxHp) {
    const bw = e.w;
    const bx = cx - bw / 2;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(bx, e.y - e.h - 12, bw, 4);
    ctx.fillStyle = "#ff5a6a";
    ctx.fillRect(bx, e.y - e.h - 12, bw * (e.hp / e.maxHp), 4);
  }
}

// 辅助：血条绘制时用屏幕坐标（cx 已是屏幕 x）

/* ------------------------------------------------------------------ */
/* 组件                                                                */
/* ------------------------------------------------------------------ */
const WukongGame: React.FC<{ sdk: FatNotesPluginSDK }> = () => {
  const i18n = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<Sim>(newSim());
  const keysRef = useRef<Set<string>>(new Set());
  const lastUiRef = useRef<UiState>({
    score: 0,
    hp: MAX_HP,
    mp: 60,
    kills: 0,
    combo: 0,
    running: false,
    over: false,
  });
  const [ui, setUi] = useState<UiState>(lastUiRef.current);

  const syncUi = (s: Sim) => {
    const next: UiState = {
      score: s.score,
      hp: Math.ceil(s.hp),
      mp: Math.floor(s.mp),
      kills: s.kills,
      combo: s.combo,
      running: s.running,
      over: s.over,
    };
    const prev = lastUiRef.current;
    if (
      next.score !== prev.score ||
      next.hp !== prev.hp ||
      next.mp !== prev.mp ||
      next.kills !== prev.kills ||
      next.combo !== prev.combo ||
      next.running !== prev.running ||
      next.over !== prev.over
    ) {
      lastUiRef.current = next;
      setUi(next);
    }
  };

  const restart = useCallback(() => {
    simRef.current = newSim();
    lastUiRef.current = {
      score: 0,
      hp: MAX_HP,
      mp: 60,
      kills: 0,
      combo: 0,
      running: false,
      over: false,
    };
    setUi(lastUiRef.current);
  }, []);

  const startPause = useCallback(() => {
    const s = simRef.current;
    if (s.over) {
      restart();
      return;
    }
    s.running = !s.running;
  }, [restart]);

  // 主循环
  useEffect(() => {
    let raf = 0;
    const WORLD_RIGHT = 2400;

    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      const s = simRef.current;
      if (!s.lastTs) s.lastTs = ts;
      const dt = Math.min(0.05, (ts - s.lastTs) / 1000);
      s.lastTs = ts;

      if (s.running && !s.over) {
        s.elapsed += dt;
        const keys = keysRef.current;

        // ---- 输入：左右移动 ----
        let dx = 0;
        if (keys.has("arrowleft") || keys.has("a")) dx -= 1;
        if (keys.has("arrowright") || keys.has("d")) dx += 1;
        if (dx !== 0 && s.attackT <= 0 && s.spinT <= 0) {
          s.vx = dx * MOVE_SPEED;
          s.facing = dx > 0 ? 1 : -1;
        } else if (s.attackT <= 0 && s.spinT <= 0) {
          s.vx *= 0.8;
        }

        // ---- 跳跃（在 keydown 中触发 jumpPressed）----
        // 跳跃触发在 keyboard handler 里通过 ref 设置

        // ---- 攻击计时 ----
        if (s.attackT > 0) {
          s.attackT -= dt;
          // 攻击判定窗口
          if (!s.attackHitDone && s.attackT < ATTACK_DURATION - ATTACK_HIT_DURATION) {
            s.attackHitDone = true;
            // 判定前方敌人
            const hitX = s.px + s.facing * (PLAYER_W / 2 + PLACK / 2);
            for (const e of s.enemies) {
              if (e.dead) continue;
              const eCenter = e.x;
              if (Math.abs(eCenter - hitX) < PLACK / 2 + e.w / 2 && Math.abs(e.y - s.py) < 70) {
                e.hp -= 1;
                e.hitFlash = 0.15;
                e.facing = s.facing;
                addHitSparks(s, e.x, e.y - e.h / 2, e.hp <= 0);
                sfxHit();
                if (e.hp <= 0) {
                  e.dead = true;
                  e.deathT = 0;
                  s.kills += 1;
                  s.combo += 1;
                  s.comboTimer = 2.0;
                  const mult = 1 + Math.min(4, s.combo * 0.2);
                  const gain = Math.round((e.kind === "general" ? 300 : e.kind === "archer" ? 180 : 100) * mult);
                  s.score += gain;
                  s.floats.push({
                    x: e.x,
                    y: e.y - e.h - 10,
                    text: `+${gain}`,
                    until: ts + 700,
                    color: "#ffd75e",
                  });
                  sfxBoom();
                  sfxScore();
                  s.mp = Math.min(MAX_MP, s.mp + 8);
                }
              }
            }
          }
        }

        if (s.spinT > 0) {
          s.spinT -= dt;
          // 旋转棍舞持续判定
          const spinRadius = 70;
          for (const e of s.enemies) {
            if (e.dead) continue;
            const d = Math.hypot(e.x - s.px, e.y - s.py);
            if (d < spinRadius + e.w / 2 && e.hitFlash <= 0) {
              e.hp -= 1;
              e.hitFlash = 0.25;
              e.vx = (e.x - s.px) > 0 ? 220 : -220;
              addHitSparks(s, e.x, e.y - e.h / 2, e.hp <= 0);
              sfxHit();
                if (e.hp <= 0) {
                  e.dead = true;
                  e.deathT = 0;
                  s.kills += 1;
                  s.combo += 1;
                  s.comboTimer = 2.0;
                  const gain = Math.round((e.kind === "general" ? 300 : 100) * (1 + Math.min(4, s.combo * 0.2)));
                  s.score += gain;
                  s.floats.push({
                    x: e.x,
                    y: e.y - e.h - 10,
                    text: `+${gain}`,
                    until: ts + 700,
                  });
                  sfxBoom();
                  s.mp = Math.min(MAX_MP, s.mp + 8);
                }
            }
          }
        }

        // ---- 物理 ----
        s.vy += GRAVITY * dt;
        s.px += s.vx * dt;
        s.py += s.vy * dt;

        // 世界边界
        s.px = Math.max(20, Math.min(WORLD_RIGHT - 20, s.px));

        // 地面碰撞
        s.onGround = false;
        if (s.py >= GROUND_Y) {
          s.py = GROUND_Y;
          s.vy = 0;
          s.onGround = true;
          s.jumps = 0;
        }
        // 平台碰撞（只在下落时）
        if (s.vy >= 0) {
          for (const p of s.platforms) {
            const prevY = s.py - s.vy * dt;
            if (
              s.px > p.x - 6 &&
              s.px < p.x + p.w + 6 &&
              prevY <= p.y &&
              s.py >= p.y &&
              s.py <= p.y + 20
            ) {
              s.py = p.y;
              s.vy = 0;
              s.onGround = true;
              s.jumps = 0;
              break;
            }
          }
        }

        // ---- 敌人 AI ----
        for (const e of s.enemies) {
          if (e.dead) {
            e.deathT += dt;
            continue;
          }
          if (e.hitFlash > 0) e.hitFlash -= dt;
          if (e.attackAnim > 0) e.attackAnim -= dt;

          // 朝向玩家
          const dxTo = s.px - e.x;
          e.facing = dxTo > 0 ? 1 : -1;

          if (e.kind === "soldier") {
            // 靠近并挥刀
            if (Math.abs(dxTo) > 40) {
              e.vx = e.facing * 90 * (1 + s.elapsed * 0.01);
            } else {
              e.vx *= 0.6;
              e.attackCd -= dt;
              if (e.attackCd <= 0) {
                e.attackCd = 1.0;
                e.attackAnim = 0.3;
                // 命中判定
                if (Math.abs(dxTo) < 50 && Math.abs(e.y - s.py) < 60) {
                  damagePlayer(s, 10, e.facing);
                }
              }
            }
          } else if (e.kind === "general") {
            // 慢速逼近，重锤
            if (Math.abs(dxTo) > 60) {
              e.vx = e.facing * 55 * (1 + s.elapsed * 0.008);
            } else {
              e.vx *= 0.6;
              e.attackCd -= dt;
              if (e.attackCd <= 0) {
                e.attackCd = 1.6;
                e.attackAnim = 0.4;
                if (Math.abs(dxTo) < 70 && Math.abs(e.y - s.py) < 70) {
                  damagePlayer(s, 18, e.facing);
                }
              }
            }
          } else {
            // archer：保持距离，掷矛
            const desired = 220;
            if (Math.abs(dxTo) > desired + 20) e.vx = e.facing * 70;
            else if (Math.abs(dxTo) < desired - 40) e.vx = -e.facing * 60;
            else e.vx *= 0.7;
            e.attackCd -= dt;
            if (e.attackCd <= 0 && Math.abs(dxTo) < 400) {
              e.attackCd = 2.2 - Math.min(0.8, s.elapsed * 0.005);
              e.attackAnim = 0.3;
              s.spears.push({
                x: e.x + e.facing * 20,
                y: e.y - e.h + 10,
                vx: e.facing * 320,
                facing: e.facing,
                life: 3.0,
              });
            }
          }

          // 敌人简单重力 / 地面
          e.vy += GRAVITY * dt;
          e.x += e.vx * dt;
          e.y += e.vy * dt;
          if (e.y >= GROUND_Y) {
            e.y = GROUND_Y;
            e.vy = 0;
            e.onGround = true;
          }
          e.x = Math.max(10, Math.min(WORLD_RIGHT - 10, e.x));
        }
        s.enemies = s.enemies.filter((e) => !e.dead || e.deathT < 0.5);

        // ---- 掷矛 ----
        for (const sp of s.spears) {
          sp.x += sp.vx * dt;
          sp.life -= dt;
          // 命中玩家
          if (
            s.invincible <= 0 &&
            Math.abs(sp.x - s.px) < 20 &&
            Math.abs(sp.y - (s.py - PLAYER_H / 2)) < 30
          ) {
            sp.life = 0;
            damagePlayer(s, 12, sp.facing);
          }
        }
        s.spears = s.spears.filter((sp) => sp.life > 0 && sp.x > 0 && sp.x < WORLD_RIGHT);

        // ---- 敌人生成 ----
        s.spawnCd -= dt;
        const interval = Math.max(0.7, 2.2 - s.elapsed * 0.02);
        if (s.spawnCd <= 0) {
          s.spawnCd = interval;
          const e = spawnEnemy(s.elapsed, s.camX, WORLD_RIGHT);
          if (e) s.enemies.push(e);
        }

        // ---- 相机跟随 ----
        const targetCam = Math.max(0, Math.min(WORLD_RIGHT - W, s.px - W * 0.4));
        s.camX += (targetCam - s.camX) * Math.min(1, dt * 5);

        // ---- 云飘动 ----
        for (const c of s.clouds) {
          c.x += c.speed * dt;
          if (c.x - s.camX * 0.6 > W + 100) {
            c.x = s.camX * 0.6 - 100;
            c.y = 30 + Math.random() * 180;
          }
        }

        // ---- 粒子 / 飘字 ----
        for (const p of s.parts) {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vy += 400 * dt;
          p.life -= dt;
        }
        s.parts = s.parts.filter((p) => p.life > 0);
        s.floats = s.floats.filter((f) => ts < f.until);

        // 连击计时
        if (s.comboTimer > 0) {
          s.comboTimer -= dt;
          if (s.comboTimer <= 0) s.combo = 0;
        }

        // 气缓慢恢复
        s.mp = Math.min(MAX_MP, s.mp + 4 * dt);

        if (s.invincible > 0) s.invincible -= dt;

        // 游戏结束落库
        if (s.over && !s.recorded) {
          s.recorded = true;
          recordScore({
            gameId: "wukong",
            gameTitle: "大圣闹天宫",
            score: s.score,
            detail: { kills: s.kills, seconds: Math.floor(s.elapsed) },
          });
        }
      }

      drawScene(ctx, s, ts);
      syncUi(s);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 跳跃触发（通过 ref 注入）
  const doJump = useCallback(() => {
    const s = simRef.current;
    if (!s.running || s.over) return;
    if (s.jumps < 2) {
      s.vy = JUMP_VELOCITY * (s.jumps === 0 ? 1 : 0.85);
      s.jumps += 1;
      s.onGround = false;
      sfxJump();
    }
  }, []);

  const doAttack = useCallback(() => {
    const s = simRef.current;
    if (!s.running || s.over) return;
    if (s.attackT <= 0 && s.spinT <= 0) {
      s.attackT = ATTACK_DURATION;
      s.attackHitDone = false;
    }
  }, []);

  const doSpin = useCallback(() => {
    const s = simRef.current;
    if (!s.running || s.over) return;
    if (s.spinT <= 0 && s.mp >= SPIN_COST) {
      s.mp -= SPIN_COST;
      s.spinT = SPIN_DURATION;
      s.spinHitDone = false;
    }
  }, []);

  // 键盘
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (
        ["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)
      )
        e.preventDefault();
      if (k === " " || k === "arrowup" || k === "w") {
        if (!e.repeat) doJump();
        return;
      }
      if (k === "j") {
        if (!e.repeat) doAttack();
        return;
      }
      if (k === "k") {
        if (!e.repeat) doSpin();
        return;
      }
      if (k === "p" || k === "escape") {
        startPause();
        return;
      }
      keysRef.current.add(k);
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
  }, [doJump, doAttack, doSpin, startPause]);

  return (
    <GameFrame
      emoji="🐒"
      title={i18n.text("game.wukong.title")}
      stats={[
        {
          label: i18n.text("game.wukong.score"),
          value: ui.score,
          colors: CHIP_GOLD,
        },
        {
          label: i18n.text("game.wukong.hp"),
          value: ui.hp,
          colors: CHIP_RED,
        },
        {
          label: i18n.text("game.wukong.mp"),
          value: ui.mp,
          colors: CHIP_BLUE,
        },
        {
          label: i18n.text("game.wukong.kills"),
          value: ui.kills,
          colors: CHIP_GREEN,
        },
      ]}
      headerExtra={
        <>
          <GhostBtn onClick={startPause} disabled={ui.over}>
            {ui.running ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
            {ui.running
              ? i18n.text("game.wukong.pause")
              : i18n.text("game.wukong.start")}
          </GhostBtn>
          <GhostBtn onClick={restart}>
            <ReloadOutlined />
            {i18n.text("game.wukong.restart")}
          </GhostBtn>
        </>
      }
      help={i18n.text("game.wukong.help")}
      maxWidth={840}
    >
      <div
        style={{
          position: "relative",
          width: W,
          height: H,
          borderRadius: 14,
          overflow: "hidden",
          boxShadow: "0 8px 24px rgba(60,20,60,0.5)",
          border: "3px solid rgba(255,200,120,0.55)",
        }}
      >
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          style={{ display: "block" }}
        />
        {ui.over && (
          <div
            className="gs-win-in"
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(30,10,40,0.85)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              alignItems: "center",
              justifyContent: "center",
              color: "#ffd75e",
            }}
          >
            <div style={{ fontSize: 30, fontWeight: 900 }}>
              {i18n.text("game.wukong.over.title")}
            </div>
            <div style={{ fontSize: 16, opacity: 0.9 }}>
              {i18n.text("game.wukong.over.score", { score: ui.score })}
            </div>
            <div style={{ fontSize: 13, opacity: 0.75 }}>
              {i18n.text("game.wukong.over.kills", { kills: ui.kills })}
            </div>
            <GhostBtn onClick={restart}>
              <ReloadOutlined />
              {i18n.text("game.wukong.again")}
            </GhostBtn>
          </div>
        )}
        {!ui.running && !ui.over && (
          <div
            className="gs-pulse"
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(30,10,40,0.55)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#ffd75e",
              fontSize: 18,
              fontWeight: 700,
              pointerEvents: "none",
            }}
          >
            {i18n.text("game.wukong.idle")}
          </div>
        )}
      </div>
    </GameFrame>
  );
};

export default WukongGame;
