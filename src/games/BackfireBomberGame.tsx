/*
 * BackfireBomberGame：逆火战轰（横板卷轴轰炸）
 *
 * Canvas 实现：轰炸机沿横向卷轴飞行，方向键 / WASD 移动，空格投弹。
 * 地面目标（防空雷达、防空车、各种建筑、带 RPG 的敌人等）随卷轴从右侧涌入，
 * 炸弹落地爆炸造成范围伤害；防空车 / 雷达 / RPG 会向轰炸机开火。
 * 击毁救护车可回血，金库是高分目标。随时间推移卷轴加速、敌火更凶残。
 * 生命耗尽游戏结束并记录成绩。
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
import "./gameAnimations.less";

const W = 760;
const H = 440;
const GROUND_Y = H - 52; // 地面线

const PLANE_R = 20; // 轰炸机碰撞半径
const PLANE_SPEED = 260; // px / s
const BOMB_CD = 0.52; // 投弹间隔（随难度略微缩短）
const BOMB_GRAVITY = 720; // 炸弹重力加速度
const BOMB_DAMAGE = 3; // 单次爆炸伤害
const BLAST_R = 54; // 爆炸半径
const MAX_HP = 5;
const START_HP = 3;
const INVINCIBLE = 1.5; // 被击中后的无敌时间 s

type TargetKind =
  | "house"
  | "factory"
  | "radar"
  | "aav"
  | "rpg"
  | "medic"
  | "gold";

interface TargetProps {
  w: number;
  h: number;
  hp: number;
  value: number;
  /** 击毁后回血（救护车） */
  heal?: boolean;
}

const TARGET_PROPS: Record<TargetKind, TargetProps> = {
  house: { w: 46, h: 34, hp: 2, value: 100 },
  factory: { w: 66, h: 46, hp: 4, value: 200 },
  radar: { w: 38, h: 42, hp: 3, value: 300 },
  aav: { w: 46, h: 30, hp: 3, value: 200 },
  rpg: { w: 28, h: 32, hp: 2, value: 150 },
  medic: { w: 50, h: 28, hp: 2, value: 200, heal: true },
  gold: { w: 32, h: 28, hp: 1, value: 500 },
};

interface Target {
  kind: TargetKind;
  x: number;
  hp: number;
  maxHp: number;
  fireCd: number;
}

interface Bomb {
  x: number;
  y: number;
  vy: number;
}

type EBulletKind = "aa" | "flak" | "rocket";

interface EBullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  kind: EBulletKind;
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

interface Blast {
  x: number;
  y: number;
  r: number;
  maxR: number;
  life: number;
  maxLife: number;
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  until: number;
  color: string;
}

interface Cloud {
  x: number;
  y: number;
  w: number;
  alpha: number;
}

type GroundMarkKind = "rock" | "bush" | "fence";

interface GroundMark {
  x: number;
  kind: GroundMarkKind;
  size: number;
}

interface Sim {
  px: number;
  py: number;
  bombs: Bomb[];
  ebs: EBullet[];
  targets: Target[];
  parts: Particle[];
  blasts: Blast[];
  floats: FloatText[];
  clouds: Cloud[];
  marks: GroundMark[];
  score: number;
  kills: number;
  hp: number;
  level: number;
  running: boolean;
  over: boolean;
  recorded: boolean;
  elapsed: number;
  scrollSpeed: number;
  spawnCd: number;
  bombCd: number;
  invincible: number;
  shake: number;
  lastTs: number;
}

interface UiState {
  score: number;
  hp: number;
  kills: number;
  level: number;
  running: boolean;
  over: boolean;
}

function makeClouds(): Cloud[] {
  const clouds: Cloud[] = [];
  for (let i = 0; i < 5; i++) {
    clouds.push({
      x: Math.random() * W,
      y: 30 + Math.random() * 150,
      w: 90 + Math.random() * 130,
      alpha: 0.1 + Math.random() * 0.1,
    });
  }
  return clouds;
}

function makeMarks(): GroundMark[] {
  const marks: GroundMark[] = [];
  for (let i = 0; i < 22; i++) {
    const r = Math.random();
    marks.push({
      x: Math.random() * W,
      kind: r < 0.4 ? "rock" : r < 0.75 ? "bush" : "fence",
      size: 6 + Math.random() * 9,
    });
  }
  return marks;
}

function newSim(): Sim {
  return {
    px: W * 0.32,
    py: GROUND_Y - 150,
    bombs: [],
    ebs: [],
    targets: [],
    parts: [],
    blasts: [],
    floats: [],
    clouds: makeClouds(),
    marks: makeMarks(),
    score: 0,
    kills: 0,
    hp: START_HP,
    level: 1,
    running: false,
    over: false,
    recorded: false,
    elapsed: 0,
    scrollSpeed: 105,
    spawnCd: 0.8,
    bombCd: 0,
    invincible: 0,
    shake: 0,
    lastTs: 0,
  };
}

/** 难度递增：卷轴速度 */
function scrollSpeedAt(elapsed: number): number {
  return Math.min(310, 105 + elapsed * 3.4);
}

/** 难度递增：敌火速度倍率 */
function diffMulAt(elapsed: number): number {
  return 1 + Math.min(1.7, elapsed * 0.012);
}

/** 目标类型权重随机（随时间解锁 RPG、增强火力） */
function pickKind(elapsed: number): TargetKind {
  const rpgW = elapsed > 12 ? Math.min(20, 6 + elapsed * 0.3) : 0;
  const r = Math.random() * 100;
  let acc = 0;
  const table: Array<[TargetKind, number]> = [
    ["rpg", rpgW],
    ["aav", 14],
    ["radar", 12],
    ["factory", 14],
    ["medic", 7],
    ["gold", 4],
  ];
  for (const [k, w] of table) {
    acc += w;
    if (r < acc) return k;
  }
  return "house";
}

function spawnTarget(s: Sim): void {
  const kind = pickKind(s.elapsed);
  const p = TARGET_PROPS[kind];
  // 高级目标血量随难度提升
  const extraHp =
    (kind === "factory" || kind === "aav" || kind === "radar"
      ? Math.floor(s.elapsed / 40)
      : 0) || 0;
  s.targets.push({
    kind,
    x: W + 40,
    hp: p.hp + extraHp,
    maxHp: p.hp + extraHp,
    fireCd: 1.2 + Math.random() * 2.4,
  });
  // 后期偶尔成串出现平民建筑
  if (
    s.elapsed > 15 &&
    (kind === "house" || kind === "factory") &&
    Math.random() < 0.3
  ) {
    s.targets.push({
      kind: "house",
      x: W + 40 + p.w * 0.9,
      hp: 2,
      maxHp: 2,
      fireCd: 99,
    });
  }
}

function addBoom(s: Sim, x: number, y: number, big: boolean): void {
  const n = big ? 16 : 9;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 40 + Math.random() * (big ? 200 : 130);
    s.parts.push({
      x,
      y,
      vx: Math.cos(a) * spd,
      vy: Math.sin(a) * spd,
      life: 0.4 + Math.random() * (big ? 0.35 : 0.22),
      maxLife: 0.75,
      r: big ? 2.4 + Math.random() * 3 : 1.8 + Math.random() * 2,
      color:
        Math.random() < 0.4
          ? "#ffd75e"
          : Math.random() < 0.5
            ? "#ff8a4c"
            : "#ff5a4c",
    });
  }
}

function addBlast(s: Sim, x: number, y: number, r: number): void {
  s.blasts.push({
    x,
    y,
    r: 8,
    maxR: r,
    life: 0.42,
    maxLife: 0.42,
  });
}

/** 爆炸：范围伤害 + 特效 */
function explodeBomb(s: Sim, x: number, y: number, ts: number): void {
  addBlast(s, x, y, 26);
  addBoom(s, x, y, true);
  s.shake = Math.min(12, s.shake + 5);
  for (const t of s.targets) {
    const p = TARGET_PROPS[t.kind];
    const cy = GROUND_Y - p.h / 2;
    const d = Math.hypot(t.x - x, cy - y);
    if (d <= BLAST_R + p.w * 0.32) {
      t.hp -= BOMB_DAMAGE;
      if (t.hp <= 0) destroyTarget(s, t, ts);
    }
  }
}

function destroyTarget(s: Sim, t: Target, ts: number): void {
  const p = TARGET_PROPS[t.kind];
  s.kills += 1;
  s.score += p.value;
  const cy = GROUND_Y - p.h / 2;
  s.floats.push({
    x: t.x,
    y: cy - p.h / 2 - 8,
    text: `+${p.value}`,
    until: ts + 800,
    color: "#ffe15e",
  });
  addBlast(s, t.x, cy, p.w * 0.55);
  addBoom(s, t.x, cy, true);
  s.shake = Math.min(14, s.shake + 6);
  if (p.heal && s.hp < MAX_HP) {
    s.hp += 1;
    s.floats.push({
      x: t.x,
      y: cy - p.h / 2 - 26,
      text: "+♥",
      until: ts + 1000,
      color: "#7ee8a2",
    });
  }
}

function hitPlane(s: Sim): void {
  if (s.invincible > 0) return;
  s.hp -= 1;
  s.invincible = INVINCIBLE;
  s.shake = Math.min(15, s.shake + 9);
  addBoom(s, s.px, s.py, false);
  if (s.hp <= 0) {
    s.hp = 0;
    s.over = true;
    s.running = false;
  }
}

/* ------------------------------------------------------------------ */
/* 绘制                                                               */
/* ------------------------------------------------------------------ */

function drawTarget(
  ctx: CanvasRenderingContext2D,
  t: Target,
  ts: number,
  planeX: number,
  planeY: number,
): void {
  const p = TARGET_PROPS[t.kind];
  const x = t.x;
  const y = GROUND_Y - p.h; // 顶边
  const cx = x;
  const cy = GROUND_Y - p.h / 2;

  if (t.kind === "house") {
    // 民居：墙体 + 屋顶 + 门窗
    ctx.fillStyle = "#c98a5e";
    ctx.fillRect(x - p.w / 2, y, p.w, p.h);
    ctx.fillStyle = "#b3573c";
    ctx.beginPath();
    ctx.moveTo(x - p.w / 2 - 4, y);
    ctx.lineTo(x + p.w / 2 + 4, y);
    ctx.lineTo(x, y - 15);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#6b3f26";
    ctx.fillRect(x - 5, GROUND_Y - 13, 10, 13);
    const winGlow = 0.55 + Math.sin(ts / 400 + x) * 0.25;
    ctx.fillStyle = `rgba(255,214,102,${winGlow.toFixed(2)})`;
    ctx.fillRect(x + 8, y + 8, 9, 8);
  } else if (t.kind === "factory") {
    // 工厂：厂房 + 烟囱 + 烟雾
    ctx.fillStyle = "#6b7280";
    ctx.fillRect(x - p.w / 2, y, p.w, p.h);
    ctx.fillStyle = "#4b5563";
    ctx.fillRect(x - p.w / 2 - 3, y - 6, p.w + 6, 8);
    // 烟囱
    const chx = x + p.w * 0.3;
    ctx.fillStyle = "#4b5563";
    ctx.fillRect(chx - 5, y - 20, 10, 20);
    for (let i = 0; i < 3; i++) {
      const ph = (ts / 500 + i * 0.35) % 1;
      ctx.fillStyle = `rgba(148,163,184,${(0.4 * (1 - ph)).toFixed(2)})`;
      ctx.beginPath();
      ctx.arc(chx, y - 22 - ph * 22, 3 + ph * 4, 0, Math.PI * 2);
      ctx.fill();
    }
    // 窗户
    ctx.fillStyle = "rgba(255,214,102,0.75)";
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 2; j++) {
        ctx.fillRect(x - p.w / 2 + 8 + i * 18, y + 10 + j * 14, 10, 9);
      }
    }
  } else if (t.kind === "radar") {
    // 防空雷达：底座 + 支架 + 旋转天线
    ctx.fillStyle = "#7c8794";
    ctx.beginPath();
    ctx.moveTo(x - 13, GROUND_Y);
    ctx.lineTo(x + 13, GROUND_Y);
    ctx.lineTo(x + 8, y + 10);
    ctx.lineTo(x - 8, y + 10);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#9aa5b1";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y + 10);
    ctx.lineTo(x, y + 4);
    ctx.stroke();
    // 旋转碟面
    const tilt = Math.sin(ts / 260 + x) * 0.75;
    ctx.save();
    ctx.translate(x, y + 4);
    ctx.rotate(tilt);
    ctx.fillStyle = "#cbd5e1";
    ctx.beginPath();
    ctx.ellipse(0, 0, 16, 4.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#38bdf8";
    ctx.beginPath();
    ctx.arc(-16, 0, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else if (t.kind === "aav") {
    // 防空车：车身 + 轮子 + 指向玩家的炮管
    ctx.fillStyle = "#4a6b3a";
    ctx.fillRect(x - p.w / 2, GROUND_Y - 14, p.w, 14);
    ctx.fillStyle = "#3c5a2f";
    for (const wx of [-p.w / 2 + 8, -p.w / 2 + 26, p.w / 2 - 8]) {
      ctx.beginPath();
      ctx.arc(x + wx, GROUND_Y - 3, 4.4, 0, Math.PI * 2);
      ctx.fill();
    }
    // 炮塔
    ctx.fillStyle = "#587a42";
    ctx.fillRect(x - 7, GROUND_Y - 22, 14, 9);
    // 炮管（朝玩家方向微调）
    const barrelAng = Math.max(
      -2.3,
      Math.min(-0.15, Math.atan2(planeY - (GROUND_Y - 26), planeX - x)),
    );
    ctx.save();
    ctx.translate(x, GROUND_Y - 23);
    ctx.rotate(barrelAng);
    ctx.fillStyle = "#2f4a24";
    ctx.fillRect(0, -2.2, 17, 4.4);
    ctx.restore();
    ctx.fillStyle = "#ffd75e";
    ctx.beginPath();
    ctx.arc(x, GROUND_Y - 25, 1.6, 0, Math.PI * 2);
    ctx.fill();
  } else if (t.kind === "rpg") {
    // RPG 敌人：士兵 + 肩扛发射筒（朝玩家方向）
    const ang = Math.max(
      -2.3,
      Math.min(-0.15, Math.atan2(planeY - (GROUND_Y - 18), planeX - x)),
    );
    ctx.save();
    ctx.translate(x, GROUND_Y);
    ctx.rotate(ang);
    // 发射筒
    ctx.fillStyle = "#44563a";
    ctx.fillRect(-13, -21, 24, 5);
    ctx.fillStyle = "#2f3d28";
    ctx.beginPath();
    ctx.arc(11, -18.5, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // 身体
    ctx.fillStyle = "#5b7a4a";
    ctx.fillRect(x - 5, GROUND_Y - 16, 10, 16);
    // 头 + 头盔
    ctx.fillStyle = "#e0b084";
    ctx.beginPath();
    ctx.arc(x, GROUND_Y - 20, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#3c5a2f";
    ctx.beginPath();
    ctx.arc(x, GROUND_Y - 21.5, 4.4, Math.PI, 0);
    ctx.fill();
  } else if (t.kind === "medic") {
    // 救护车：车身 + 红十字 + 警示灯（击毁回血）
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(x - p.w / 2, GROUND_Y - 18, p.w, 18);
    ctx.fillStyle = "#e5484d";
    ctx.fillRect(x - 4, GROUND_Y - 14, 8, 10);
    ctx.fillRect(x - 1, GROUND_Y - 17, 2, 16);
    const blink = Math.floor(ts / 280) % 2 === 0;
    ctx.fillStyle = blink ? "#ff5a6a" : "#b91c1c";
    ctx.beginPath();
    ctx.arc(x - p.w / 2 + 7, GROUND_Y - 21, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#334155";
    ctx.fillRect(x + 6, GROUND_Y - 8, 16, 8);
    for (const wx of [-p.w / 2 + 8, p.w / 2 - 8]) {
      ctx.beginPath();
      ctx.arc(x + wx, GROUND_Y - 3, 4.2, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // 金库：宝箱 + 金币 + 呼吸光晕（高分目标）
    const pulse = 0.5 + Math.sin(ts / 220 + x) * 0.3;
    const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, p.w * 0.9);
    glow.addColorStop(0, `rgba(255,214,102,${(0.35 * pulse).toFixed(2)})`);
    glow.addColorStop(1, "rgba(255,214,102,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(cx - p.w, cy - p.w, p.w * 2, p.w * 2);
    ctx.fillStyle = "#a16207";
    ctx.fillRect(x - p.w / 2, GROUND_Y - 24, p.w, 24);
    ctx.fillStyle = "#eab308";
    ctx.fillRect(x - p.w / 2 + 3, GROUND_Y - 20, p.w - 6, 16);
    ctx.fillStyle = "#a16207";
    ctx.fillRect(x - 2, GROUND_Y - 20, 4, 16);
    ctx.fillStyle = "#78350f";
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("$", x, GROUND_Y - 8);
    ctx.textAlign = "start";
  }

  // 受损血条
  if (t.hp < t.maxHp) {
    const bw = p.w;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(x - bw / 2, y - 8, bw, 4);
    const r = Math.max(0, t.hp / t.maxHp);
    ctx.fillStyle = r > 0.5 ? "#43e97b" : "#ff9a4c";
    ctx.fillRect(x - bw / 2, y - 8, bw * r, 4);
  }
}

function drawPlane(
  ctx: CanvasRenderingContext2D,
  s: Sim,
  ts: number,
): void {
  if (s.over) return;
  const blink = s.invincible > 0 && Math.floor(ts / 90) % 2 === 0;
  if (blink) return;

  const px = s.px;
  const py = s.py + Math.sin(ts / 350) * 2.5; // 轻微起伏
  const bombReady = s.bombCd <= 0;

  ctx.save();
  // 投弹落点瞄准线
  ctx.strokeStyle = "rgba(255,255,255,0.16)";
  ctx.lineWidth = 1.4;
  ctx.setLineDash([5, 7]);
  ctx.beginPath();
  ctx.moveTo(px, py + 14);
  ctx.lineTo(px, GROUND_Y - 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.beginPath();
  ctx.arc(px, GROUND_Y - 2, 4 + (bombReady ? 0 : 2), 0, Math.PI * 2);
  ctx.fill();

  ctx.shadowColor = "#9aa5b1";
  ctx.shadowBlur = 10;

  // 尾焰
  const flame = 7 + Math.sin(ts / 45) * 3;
  ctx.fillStyle = "rgba(255,150,60,0.95)";
  ctx.beginPath();
  ctx.moveTo(px - 24, py - 2.5);
  ctx.lineTo(px - 24 - flame, py);
  ctx.lineTo(px - 24, py + 2.5);
  ctx.closePath();
  ctx.fill();

  // 机身（侧视，向右飞行）
  ctx.fillStyle = "#9aa5b1";
  ctx.beginPath();
  ctx.moveTo(px + 34, py); // 机头
  ctx.lineTo(px + 26, py - 5);
  ctx.lineTo(px - 22, py - 5);
  ctx.lineTo(px - 26, py);
  ctx.lineTo(px - 22, py + 5);
  ctx.lineTo(px + 26, py + 5);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#7c8794";
  ctx.beginPath();
  ctx.ellipse(px + 6, py + 3, 20, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // 主翼（后掠）
  ctx.fillStyle = "#7c8794";
  ctx.beginPath();
  ctx.moveTo(px - 4, py + 3);
  ctx.lineTo(px - 34, py + 17);
  ctx.lineTo(px - 10, py + 17);
  ctx.closePath();
  ctx.fill();

  // 尾翼
  ctx.fillStyle = "#6b7684";
  ctx.beginPath();
  ctx.moveTo(px - 12, py - 5);
  ctx.lineTo(px - 24, py - 23);
  ctx.lineTo(px - 6, py - 5);
  ctx.closePath();
  ctx.fill();

  // 座舱
  ctx.fillStyle = "#7fd0ff";
  ctx.beginPath();
  ctx.ellipse(px + 15, py - 5, 8, 4.6, 0, Math.PI, 0);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.beginPath();
  ctx.ellipse(px + 17, py - 6.5, 3, 1.6, -0.4, 0, Math.PI);
  ctx.fill();

  ctx.shadowBlur = 0;
  ctx.restore();

  // 投弹冷却环
  const cdMax = Math.max(0.32, BOMB_CD - s.elapsed * 0.002);
  const frac = Math.max(0, Math.min(1, 1 - s.bombCd / cdMax));
  ctx.strokeStyle = bombReady ? "rgba(126,232,162,0.9)" : "rgba(255,255,255,0.35)";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(px, py, 16, -Math.PI / 2, -Math.PI / 2 + frac * Math.PI * 2);
  ctx.stroke();
  if (bombReady) {
    ctx.fillStyle = "#7ee8a2";
    ctx.beginPath();
    ctx.arc(px, py - 16, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawScene(ctx: CanvasRenderingContext2D, s: Sim, ts: number): void {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  if (s.shake > 0.2) {
    ctx.translate(
      (Math.random() - 0.5) * s.shake,
      (Math.random() - 0.5) * s.shake,
    );
  }

  // 黄昏天空
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  sky.addColorStop(0, "#0d1633");
  sky.addColorStop(0.55, "#1f3460");
  sky.addColorStop(1, "#45375a");
  ctx.fillStyle = sky;
  ctx.fillRect(-20, -20, W + 40, GROUND_Y + 40);

  // 云层（视差）
  for (const c of s.clouds) {
    ctx.fillStyle = `rgba(210,225,255,${c.alpha.toFixed(2)})`;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, c.w / 2, c.w / 5, 0, 0, Math.PI * 2);
    ctx.ellipse(c.x - c.w * 0.3, c.y + 6, c.w * 0.32, c.w / 7, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 地面
  ctx.fillStyle = "#2f2419";
  ctx.fillRect(-20, GROUND_Y, W + 40, H - GROUND_Y + 20);
  ctx.fillStyle = "#4c7a35";
  ctx.fillRect(-20, GROUND_Y, W + 40, 10);
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(-20, GROUND_Y + 10, W + 40, 3);

  // 地面装饰（岩石 / 灌木 / 栅栏，随卷轴滚动）
  for (const m of s.marks) {
    if (m.kind === "rock") {
      ctx.fillStyle = "#4a3b2d";
      ctx.beginPath();
      ctx.arc(m.x, GROUND_Y + 16, m.size * 0.7, 0, Math.PI * 2);
      ctx.fill();
    } else if (m.kind === "bush") {
      ctx.fillStyle = "#3f6b2e";
      ctx.beginPath();
      ctx.arc(m.x, GROUND_Y + 8, m.size * 0.8, 0, Math.PI * 2);
      ctx.arc(m.x + m.size, GROUND_Y + 8, m.size * 0.6, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = "#6b4a2f";
      ctx.fillRect(m.x, GROUND_Y, 3, 10);
      ctx.fillRect(m.x + 8, GROUND_Y, 3, 10);
    }
  }

  // 投弹落点闪烁提示（特殊目标脚下光晕已在其绘制中体现）

  // 地面目标
  for (const t of s.targets) drawTarget(ctx, t, ts, s.px, s.py);

  // 炸弹
  for (const b of s.bombs) {
    ctx.fillStyle = "#22262b";
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, 6, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#454b52";
    ctx.fillRect(b.x - 4, b.y - 13, 8, 4);
  }

  // 敌方弹丸
  for (const b of s.ebs) {
    if (b.kind === "aa") {
      ctx.fillStyle = "#ffd75e";
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,120,60,0.5)";
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 1.8, 0, Math.PI * 2);
      ctx.fill();
    } else if (b.kind === "flak") {
      const g = ctx.createRadialGradient(b.x, b.y, 1, b.x, b.y, b.r * 2.2);
      g.addColorStop(0, "#fff3c4");
      g.addColorStop(0.5, "#ffb347");
      g.addColorStop(1, "rgba(255,140,40,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 2.2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = "#e0b084";
      ctx.fillRect(b.x - 2.4, b.y - 8, 4.8, 13);
      ctx.fillStyle = "#ff6a3d";
      ctx.beginPath();
      ctx.arc(b.x, b.y + 6, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 爆炸火球
  for (const b of s.blasts) {
    const a = Math.max(0, b.life / b.maxLife);
    const g = ctx.createRadialGradient(b.x, b.y, 2, b.x, b.y, b.r);
    g.addColorStop(0, `rgba(255,244,196,${(a * 0.95).toFixed(2)})`);
    g.addColorStop(0.45, `rgba(255,168,64,${(a * 0.9).toFixed(2)})`);
    g.addColorStop(1, "rgba(255,80,40,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 粒子
  for (const p of s.parts) {
    const a = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 飘字
  for (const f of s.floats) {
    if (ts >= f.until) continue;
    const a = Math.min(1, (f.until - ts) / 500);
    ctx.globalAlpha = a;
    ctx.fillStyle = f.color;
    ctx.font = "bold 15px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(f.text, f.x, f.y);
    ctx.globalAlpha = 1;
    ctx.textAlign = "start";
  }

  // 轰炸机
  drawPlane(ctx, s, ts);

  ctx.restore();

  // HUD：生命 + 得分（不受抖动影响）
  ctx.fillStyle = "#ff5a6a";
  ctx.font = "bold 14px sans-serif";
  for (let i = 0; i < s.hp; i++) {
    ctx.fillText("♥", 14 + i * 20, 24);
  }
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.textAlign = "right";
  ctx.font = "bold 16px sans-serif";
  ctx.fillText(String(s.score), W - 14, 24);
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.font = "bold 13px sans-serif";
  ctx.fillText(`LV ${s.level}`, W - 14, 42);
  ctx.textAlign = "start";
}

/* ------------------------------------------------------------------ */
/* 组件                                                               */
/* ------------------------------------------------------------------ */

const BackfireBomberGame: React.FC<{ sdk: FatNotesPluginSDK }> = () => {
  const i18n = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<Sim>(newSim());
  const keysRef = useRef<Set<string>>(new Set());
  const lastUiRef = useRef<UiState>({
    score: 0,
    hp: START_HP,
    kills: 0,
    level: 1,
    running: false,
    over: false,
  });
  const [ui, setUi] = useState<UiState>(lastUiRef.current);

  const syncUi = (s: Sim) => {
    const next: UiState = {
      score: s.score,
      hp: s.hp,
      kills: s.kills,
      level: s.level,
      running: s.running,
      over: s.over,
    };
    const prev = lastUiRef.current;
    if (
      next.score !== prev.score ||
      next.hp !== prev.hp ||
      next.kills !== prev.kills ||
      next.level !== prev.level ||
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
      hp: START_HP,
      kills: 0,
      level: 1,
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
        s.level = 1 + Math.floor(s.elapsed / 25);
        s.scrollSpeed = scrollSpeedAt(s.elapsed);
        const keys = keysRef.current;

        // 移动
        let dx = 0;
        let dy = 0;
        if (keys.has("arrowleft") || keys.has("a")) dx -= 1;
        if (keys.has("arrowright") || keys.has("d")) dx += 1;
        if (keys.has("arrowup") || keys.has("w")) dy -= 1;
        if (keys.has("arrowdown") || keys.has("s")) dy += 1;
        if (dx !== 0 || dy !== 0) {
          const len = Math.hypot(dx, dy);
          s.px += (dx / len) * PLANE_SPEED * dt;
          s.py += (dy / len) * PLANE_SPEED * dt;
        }
        s.px = Math.max(40, Math.min(W - 40, s.px));
        s.py = Math.max(52, Math.min(GROUND_Y - 70, s.py));

        // 投弹
        s.bombCd -= dt;
        if (keys.has(" ") && s.bombCd <= 0) {
          s.bombCd = Math.max(0.32, BOMB_CD - s.elapsed * 0.002);
          s.bombs.push({ x: s.px, y: s.py + 18, vy: 40 });
        }

        // 目标生成（越来越密）
        s.spawnCd -= dt;
        const interval = Math.max(0.55, 1.25 - s.elapsed * 0.014);
        if (s.spawnCd <= 0) {
          s.spawnCd = interval * (0.7 + Math.random() * 0.6);
          spawnTarget(s);
        }

        // 炸弹下落
        for (const b of s.bombs) {
          b.vy += BOMB_GRAVITY * dt;
          b.y += b.vy * dt;
        }
        // 炸弹命中/落地
        const consumed = new Set<Bomb>();
        for (const b of s.bombs) {
          let exploded = false;
          if (b.y >= GROUND_Y - 6) exploded = true;
          if (!exploded) {
            for (const t of s.targets) {
              const p = TARGET_PROPS[t.kind];
              if (Math.hypot(t.x - b.x, GROUND_Y - p.h / 2 - b.y) <= p.w * 0.5 + 8) {
                exploded = true;
                break;
              }
            }
          }
          if (exploded) {
            consumed.add(b);
            explodeBomb(s, b.x, Math.min(b.y, GROUND_Y - 4), ts);
          }
        }
        if (consumed.size > 0) {
          s.bombs = s.bombs.filter((b) => !consumed.has(b));
        }

        // 目标移动与开火
        const diffMul = diffMulAt(s.elapsed);
        for (const t of s.targets) {
          t.x -= s.scrollSpeed * dt;
          t.fireCd -= dt;
          if (t.fireCd <= 0) {
            const p = TARGET_PROPS[t.kind];
            if (t.kind === "aav" && s.elapsed > 4) {
              t.fireCd =
                Math.max(1.0, 2.8 - s.elapsed * 0.03) * (0.75 + Math.random() * 0.5);
              const ang =
                Math.atan2(s.py - (GROUND_Y - p.h / 2), s.px - t.x) +
                (Math.random() - 0.5) * 0.24;
              const spd = (165 + Math.random() * 45) * diffMul;
              s.ebs.push({
                x: t.x,
                y: GROUND_Y - p.h - 4,
                vx: Math.cos(ang) * spd,
                vy: Math.sin(ang) * spd,
                r: 4,
                kind: "aa",
              });
            } else if (t.kind === "radar" && s.elapsed > 30) {
              t.fireCd = 4.5 + Math.random() * 2;
              s.ebs.push({
                x: t.x,
                y: GROUND_Y - p.h,
                vx: (Math.random() - 0.5) * 40,
                vy: -135 * diffMul,
                r: 7,
                kind: "flak",
              });
            } else if (t.kind === "rpg" && s.elapsed > 10) {
              t.fireCd =
                Math.max(1.4, 3.2 - s.elapsed * 0.03) * (0.8 + Math.random() * 0.4);
              s.ebs.push({
                x: t.x,
                y: GROUND_Y - p.h - 4,
                vx: 0,
                vy: -155 * diffMul,
                r: 5,
                kind: "rocket",
              });
            }
          }
        }
        s.targets = s.targets.filter(
          (t) => t.hp > 0 && t.x > -TARGET_PROPS[t.kind].w - 20,
        );

        // 敌方弹丸移动（火箭带跟踪）
        for (const b of s.ebs) {
          if (b.kind === "rocket") {
            b.vx += Math.sign(s.px - b.x) * 150 * dt;
            b.vx = Math.max(-150, Math.min(150, b.vx));
            if (Math.random() < 0.5) {
              s.parts.push({
                x: b.x + (Math.random() - 0.5) * 3,
                y: b.y + 7,
                vx: (Math.random() - 0.5) * 20,
                vy: 20 + Math.random() * 20,
                life: 0.4,
                maxLife: 0.4,
                r: 1.8,
                color: "rgba(200,200,200,0.8)",
              });
            }
          }
          b.x += b.vx * dt;
          b.y += b.vy * dt;
        }
        s.ebs = s.ebs.filter(
          (b) => b.x > -30 && b.x < W + 30 && b.y > -70 && b.y < GROUND_Y + 12,
        );

        // 弹丸 vs 轰炸机
        for (const b of s.ebs) {
          if (
            s.hp > 0 &&
            s.invincible <= 0 &&
            Math.hypot(b.x - s.px, b.y - s.py) <= PLANE_R + b.r
          ) {
            hitPlane(s);
            b.x = -9999;
            break;
          }
        }
        s.ebs = s.ebs.filter((b) => b.x > -3000);

        // 爆炸/粒子/飘字/云/地面滚动
        for (const b of s.blasts) {
          b.life -= dt;
          // 火球随时间扩张至最大半径
          b.r = Math.max(4, b.maxR * (1 - Math.max(0, b.life / b.maxLife)));
        }
        s.blasts = s.blasts.filter((b) => b.life > 0);

        for (const p of s.parts) {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.life -= dt;
        }
        s.parts = s.parts.filter((p) => p.life > 0);
        s.floats = s.floats.filter((f) => ts < f.until);

        for (const c of s.clouds) {
          c.x -= s.scrollSpeed * 0.22 * dt;
          if (c.x < -c.w) {
            c.x = W + c.w;
            c.y = 30 + Math.random() * 150;
          }
        }
        for (const m of s.marks) {
          m.x -= s.scrollSpeed * dt;
          if (m.x < -20) {
            m.x = W + 20;
          }
        }

        if (s.invincible > 0) s.invincible -= dt;
        s.shake = Math.max(0, s.shake - dt * 26);

        // 游戏结束
        if (s.over && !s.recorded) {
          s.recorded = true;
          recordScore({
            gameId: "backfire",
            gameTitle: "逆火战轰",
            score: s.score,
            detail: {
              targets: s.kills,
              level: s.level,
              seconds: Math.floor(s.elapsed),
            },
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

  // 键盘
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k))
        e.preventDefault();
      if (k === " ") {
        const s = simRef.current;
        if (s.over) {
          restart();
          return;
        }
        if (!s.running) s.running = true;
        // 按住空格持续投弹（由主循环按冷却节流）
        keysRef.current.add(" ");
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
  }, [restart]);

  return (
    <GameFrame
      emoji="💣"
      title={i18n.text("game.backfire.title")}
      stats={[
        {
          label: i18n.text("game.backfire.score"),
          value: ui.score,
          colors: CHIP_GOLD,
        },
        {
          label: i18n.text("game.backfire.hp"),
          value: ui.hp,
          colors: CHIP_RED,
        },
        {
          label: i18n.text("game.backfire.targets"),
          value: ui.kills,
          colors: CHIP_GREEN,
        },
        {
          label: i18n.text("game.backfire.level"),
          value: ui.level,
          colors: CHIP_BLUE,
        },
      ]}
      headerExtra={
        <>
          <GhostBtn onClick={startPause} disabled={ui.over}>
            {ui.running ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
            {ui.running
              ? i18n.text("game.backfire.pause")
              : i18n.text("game.backfire.start")}
          </GhostBtn>
          <GhostBtn onClick={restart}>
            <ReloadOutlined />
            {i18n.text("game.backfire.restart")}
          </GhostBtn>
        </>
      }
      help={i18n.text("game.backfire.help")}
      maxWidth={820}
    >
      <div
        style={{
          position: "relative",
          width: W,
          height: H,
          borderRadius: 14,
          overflow: "hidden",
          boxShadow: "0 8px 24px rgba(20,40,90,0.4)",
          border: "3px solid rgba(80,110,170,0.55)",
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
              background: "rgba(10,16,30,0.82)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              alignItems: "center",
              justifyContent: "center",
              color: "#9ecbff",
            }}
          >
            <div style={{ fontSize: 28, fontWeight: 900 }}>
              {i18n.text("game.backfire.over.title")}
            </div>
            <div style={{ fontSize: 16, opacity: 0.9 }}>
              {i18n.text("game.backfire.over.score", { score: ui.score })}
            </div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {i18n.text("game.backfire.over.targets", {
                targets: ui.kills,
              })}
            </div>
            <GhostBtn onClick={restart}>
              <ReloadOutlined />
              {i18n.text("game.backfire.again")}
            </GhostBtn>
          </div>
        )}
        {!ui.running && !ui.over && (
          <div
            className="gs-pulse"
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(10,16,30,0.55)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#9ecbff",
              fontSize: 16,
              fontWeight: 700,
              pointerEvents: "none",
            }}
          >
            {i18n.text("game.backfire.idle")}
          </div>
        )}
      </div>
    </GameFrame>
  );
};

export default BackfireBomberGame;
