/*
 * RaceGame：龟兔赛跑
 *
 * Canvas 实现：你控制兔子（按住奔跑/松手休息），AI 控制乌龟稳健爬行。
 * 慢走会积累睡意，睡意满 → 兔子原地睡着，快速连点唤醒（寓言名场面）。
 * 奔跑攒能量兑换道具：胡萝卜冲刺 / 香蕉皮 / 激将法；赛道随机地形影响双方。
 * 先到终点者胜，用时越短得分越高，结束记录成绩。
 * 操作：按住空格/鼠标奔跑（松手休息）；睡着时快速点击唤醒；
 *       1/2/3 或点击按钮使用道具；P 暂停；R 重新开始。
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
  CHIP_RED,
  CHIP_BLUE,
  CHIP_PURPLE,
} from "./GameFrame";
import {
  sfxClick,
  sfxMove,
  sfxEat,
  sfxCoin,
  sfxJump,
  sfxHurt,
  sfxBounce,
  sfxAlarm,
  sfxReveal,
  sfxMismatch,
  sfxLevelUp,
  sfxSlingshot,
  sfxWin,
  sfxLose,
} from "./sound";
import {
  TRACK_LEN,
  WAKE_TAPS,
  MAX_ENERGY,
  newSim,
  stepSim,
  terrainAt,
  leadMeters,
  type RaceSim,
  type RaceEvent,
  type ItemId,
  type TerrainKind,
} from "./raceLogic";
import "./gameAnimations.less";

const W = 720;
const H = 430;
const START_X = 36;
const END_X = W - 46;

/** 米 → 画布像素 */
function px(meters: number): number {
  return START_X + (meters / TRACK_LEN) * (END_X - START_X);
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
  kind?: "dust" | "zzz" | "star" | "spark";
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  life: number;
  maxLife: number;
  color: string;
}

interface UiState {
  dist: number;
  time: number;
  lead: number;
  stateKey: "run" | "walk" | "sleep";
  energy: number;
  running: boolean;
  paused: boolean;
  over: boolean;
  won: boolean;
  score: number;
  sleepHint: boolean;
}

/* ------------------------------------------------------------------ */
/* 地形色带配置                                                          */
/* ------------------------------------------------------------------ */

const TERRAIN_COLOR: Record<TerrainKind, string> = {
  plain: "rgba(120,190,110,0.55)",
  hill: "rgba(150,170,230,0.6)",
  mud: "rgba(150,120,80,0.7)",
  shade: "rgba(70,130,90,0.75)",
  carrot: "rgba(240,150,60,0.55)",
};

const TERRAIN_ICON: Record<TerrainKind, string> = {
  plain: "🌿",
  hill: "⛰️",
  mud: "💧",
  shade: "🌳",
  carrot: "🥕",
};

/* ------------------------------------------------------------------ */
/* 绘制辅助                                                             */
/* ------------------------------------------------------------------ */

function ellipse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  fill: string,
  stroke?: string,
  lw = 2,
): void {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
}

function drawBackground(ctx: CanvasRenderingContext2D, ts: number): void {
  // 天空
  const sky = ctx.createLinearGradient(0, 0, 0, 120);
  sky.addColorStop(0, "#8ec9f5");
  sky.addColorStop(1, "#d8f0fb");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, 120);

  // 太阳
  ctx.fillStyle = "rgba(255,220,110,0.3)";
  ctx.beginPath();
  ctx.arc(74, 44, 38, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffd766";
  ctx.beginPath();
  ctx.arc(74, 44, 24, 0, Math.PI * 2);
  ctx.fill();

  // 云朵
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  const clouds: Array<[number, number, number]> = [
    [200, 44, 20],
    [390, 60, 15],
    [560, 40, 17],
  ];
  for (const [cx, cy, cr] of clouds) {
    const ox = Math.sin(ts / 2600 + cx) * 7;
    ctx.beginPath();
    ctx.arc(cx + ox, cy, cr, 0, Math.PI * 2);
    ctx.arc(cx + ox + cr * 1.2, cy + 4, cr * 0.75, 0, Math.PI * 2);
    ctx.arc(cx + ox - cr * 1.2, cy + 5, cr * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  // 草地
  const grass = ctx.createLinearGradient(0, 120, 0, H);
  grass.addColorStop(0, "#9ed487");
  grass.addColorStop(0.55, "#6cbd63");
  grass.addColorStop(1, "#4f9f52");
  ctx.fillStyle = grass;
  ctx.fillRect(0, 120, W, H - 120);

  // 远山（地平线）
  ctx.fillStyle = "rgba(120,180,120,0.35)";
  ctx.beginPath();
  ctx.moveTo(0, 128);
  ctx.quadraticCurveTo(140, 92, 300, 126);
  ctx.quadraticCurveTo(460, 90, 600, 124);
  ctx.quadraticCurveTo(660, 122, 720, 118);
  ctx.lineTo(720, 128);
  ctx.lineTo(0, 128);
  ctx.fill();

  // 跑道（浅色土路）
  const road = ctx.createLinearGradient(0, 258, 0, 352);
  road.addColorStop(0, "#e9d9b0");
  road.addColorStop(1, "#d8c295");
  ctx.fillStyle = road;
  ctx.fillRect(20, 258, W - 40, 94);
  // 跑道边线
  ctx.strokeStyle = "rgba(120,90,40,0.45)";
  ctx.lineWidth = 3;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(24, 258);
  ctx.lineTo(W - 24, 258);
  ctx.moveTo(24, 352);
  ctx.lineTo(W - 24, 352);
  ctx.stroke();
  ctx.setLineDash([]);

  // 里程标
  ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(80,60,30,0.75)";
  for (let m = 20; m < TRACK_LEN; m += 20) {
    const x = px(m);
    ctx.beginPath();
    ctx.moveTo(x, 254);
    ctx.lineTo(x - 5, 246);
    ctx.lineTo(x + 5, 246);
    ctx.closePath();
    ctx.fillStyle = "rgba(120,90,40,0.5)";
    ctx.fill();
    ctx.fillStyle = "rgba(80,60,30,0.8)";
    ctx.fillText(`${m}m`, x, 238);
  }
  ctx.textAlign = "start";
}

function drawTerrainStrip(ctx: CanvasRenderingContext2D, sim: RaceSim): void {
  // 跑道下方地形色带
  for (const seg of sim.terrain) {
    const x0 = px(seg.from);
    const x1 = px(seg.to);
    ctx.fillStyle = TERRAIN_COLOR[seg.kind];
    ctx.fillRect(x0, 354, x1 - x0, 16);
    // 分隔
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(x0, 354, 1.5, 16);
  }
  // 图标 + 当前段高亮
  const cur = terrainAt(sim.terrain, sim.rabbit.x);
  ctx.font = "14px sans-serif";
  ctx.textAlign = "center";
  for (const seg of sim.terrain) {
    const cx = px((seg.from + seg.to) / 2);
    ctx.globalAlpha = seg === cur ? 1 : 0.55;
    ctx.fillText(TERRAIN_ICON[seg.kind], cx, 349);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "start";
}

function drawFinish(ctx: CanvasRenderingContext2D, ts: number): void {
  // 终点彩旗线
  const x = END_X;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x, 258);
  ctx.lineTo(x, 352);
  ctx.stroke();
  // 彩旗
  const colors = ["#ff6b6b", "#feca57", "#48dbfb", "#1dd1a1", "#ff9ff3"];
  for (let i = 0; i < 5; i++) {
    const y = 258 + i * 18;
    const wave = Math.sin(ts / 300 + i) * 3;
    ctx.fillStyle = colors[i];
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 10 + wave, y + 5);
    ctx.lineTo(x, y + 10);
    ctx.closePath();
    ctx.fill();
  }
  ctx.font = "bold 13px sans-serif";
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.fillText("FINISH", x, 252);
  ctx.textAlign = "start";
}

function drawStart(ctx: CanvasRenderingContext2D): void {
  const x = START_X;
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, 258);
  ctx.lineTo(x, 352);
  ctx.stroke();
  ctx.font = "bold 13px sans-serif";
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.textAlign = "center";
  ctx.fillText("START", x, 252);
  ctx.textAlign = "start";
}

/* ------------------------------------------------------------------ */
/* 角色绘制                                                             */
/* ------------------------------------------------------------------ */

function drawRabbit(ctx: CanvasRenderingContext2D, r: RaceSim["rabbit"], ts: number): void {
  const x = px(r.x);
  const y = 292;
  ctx.save();
  ctx.translate(x, y);

  if (r.state === "sleeping") {
    // 缩成一团睡着
    ctx.rotate(Math.sin(ts / 600) * 0.05);
    ctx.fillStyle = "#f2ede4";
    ctx.beginPath();
    ctx.ellipse(0, 2, 16, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#c9bfb0";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // 耳朵耷拉
    ctx.fillStyle = "#efe7da";
    ctx.beginPath();
    ctx.ellipse(-9, -6, 3.4, 9, -0.5, 0, Math.PI * 2);
    ctx.ellipse(8, -6, 3.4, 9, 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#f3c6d0";
    ctx.beginPath();
    ctx.ellipse(-9, -4, 1.6, 6, -0.5, 0, Math.PI * 2);
    ctx.ellipse(8, -4, 1.6, 6, 0.5, 0, Math.PI * 2);
    ctx.fill();
    // 呼噜泡泡
    const b = 6 + Math.sin(ts / 400) * 1.5;
    ctx.beginPath();
    ctx.arc(20, -18, b, 0, Math.PI * 2);
    ctx.strokeStyle = "rgba(140,190,255,0.9)";
    ctx.lineWidth = 2;
    ctx.stroke();
  } else {
    // 奔跑 / 慢走：身体 + 腿
    const running = r.state === "running";
    const bob = running ? Math.abs(Math.sin(r.phase)) * -2.5 : Math.sin(ts / 420) * -1.2;
    const lean = running ? 0.14 : 0.05;
    ctx.rotate(lean);
    ctx.translate(0, bob);
    // 后腿摆动
    const swing = running ? Math.sin(r.phase) * 0.55 : Math.sin(ts / 420) * 0.15;
    ctx.strokeStyle = "#e0d8c8";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-4, 6);
    ctx.lineTo(-4 - swing * 9, 16);
    ctx.moveTo(4, 6);
    ctx.lineTo(4 + swing * 9, 16);
    ctx.stroke();
    // 前腿
    ctx.beginPath();
    ctx.moveTo(9, 5);
    ctx.lineTo(9 + swing * 5, 15);
    ctx.stroke();
    // 身体
    ellipse(ctx, 1, 0, 13, 9, "#f5efe6", "#cfc4b2", 1.6);
    // 尾巴
    ctx.fillStyle = "#f5efe6";
    ctx.beginPath();
    ctx.arc(-12, -2, 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#cfc4b2";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // 头
    ellipse(ctx, 13, -6, 7.5, 6.5, "#f5efe6", "#cfc4b2", 1.4);
    // 耳朵
    const earWob = running ? Math.sin(r.phase + 1) * 1.6 : Math.sin(ts / 420) * 0.8;
    ctx.fillStyle = "#f5efe6";
    ctx.beginPath();
    ctx.ellipse(11, -14 + earWob, 2.8, 7.5, -0.15, 0, Math.PI * 2);
    ctx.ellipse(16.5, -14 - earWob, 2.8, 7.5, 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#cfc4b2";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // 内耳
    ctx.fillStyle = "#f3c6d0";
    ctx.beginPath();
    ctx.ellipse(11, -12.5 + earWob, 1.3, 5, -0.15, 0, Math.PI * 2);
    ctx.ellipse(16.5, -12.5 - earWob, 1.3, 5, 0.15, 0, Math.PI * 2);
    ctx.fill();
    // 眼睛
    ctx.fillStyle = "#3a3430";
    ctx.beginPath();
    ctx.arc(15.5, -7, 1.5, 0, Math.PI * 2);
    ctx.fill();
    // 冲刺加速线
    if (r.burst > 0) {
      ctx.strokeStyle = "rgba(255,180,60,0.9)";
      ctx.lineWidth = 2.5;
      for (let i = 0; i < 3; i++) {
        const off = -22 - i * 9 + Math.sin(ts / 90 + i * 2) * 2;
        ctx.beginPath();
        ctx.moveTo(off, -2 + i * 3);
        ctx.lineTo(off + 7, -2 + i * 3);
        ctx.stroke();
      }
    }
  }
  ctx.restore();

  // 体力条
  const bx = x - 20;
  const by = y - 34;
  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.fillRect(bx, by, 40, 5);
  const ratio = r.stamina / 100;
  ctx.fillStyle =
    ratio > 0.5 ? "#58d68d" : ratio > 0.25 ? "#f4d03f" : "#e74c3c";
  ctx.fillRect(bx, by, 40 * ratio, 5);
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 1;
  ctx.strokeRect(bx, by, 40, 5);

  // 能量豆
  for (let i = 0; i < MAX_ENERGY; i++) {
    const ex = x - 20 + i * 10;
    ctx.beginPath();
    ctx.arc(ex, by + 10, 3.4, 0, Math.PI * 2);
    ctx.fillStyle = i < r.energy ? "#ffb347" : "rgba(255,255,255,0.35)";
    ctx.fill();
    if (i < r.energy) {
      ctx.strokeStyle = "rgba(200,120,20,0.6)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

function drawTurtle(ctx: CanvasRenderingContext2D, t: RaceSim["turtle"], ts: number): void {
  const x = px(t.x);
  const y = 332;
  ctx.save();
  ctx.translate(x, y);

  if (t.state === "roll") {
    // 缩壳滚动：圆壳 + 旋转花纹 + 速度线
    const ang = ts / 110 + t.x * 0.4;
    ctx.rotate(ang * 0.5);
    ctx.fillStyle = "#4f9f52";
    ctx.beginPath();
    ctx.arc(0, 0, 14, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#2f6b33";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.strokeStyle = "#8fd08a";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * 13, Math.sin(a) * 13);
      ctx.stroke();
    }
    // 速度线
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 3; i++) {
      const off = -22 - i * 8 + Math.sin(ts / 100 + i * 1.6) * 2;
      ctx.beginPath();
      ctx.moveTo(off, -3 + i * 3);
      ctx.lineTo(off + 6, -3 + i * 3);
      ctx.stroke();
    }
  } else if (t.slipped) {
    // 被香蕉皮滑倒：四脚朝天 + 星星
    ctx.rotate(Math.sin(ts / 200) * 0.12);
    ctx.fillStyle = "#f0e6c8";
    ctx.beginPath();
    ctx.ellipse(0, 0, 16, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#c9bfa0";
    ctx.lineWidth = 1.8;
    ctx.stroke();
    // 腹部 + 腿朝上
    ctx.strokeStyle = "#4f9f52";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-8, -6);
    ctx.lineTo(-10, -14);
    ctx.moveTo(-2, -8);
    ctx.lineTo(-2, -16);
    ctx.moveTo(6, -8);
    ctx.lineTo(6, -16);
    ctx.moveTo(11, -5);
    ctx.lineTo(13, -13);
    ctx.stroke();
    // 星星
    ctx.fillStyle = "#ffd766";
    const sa = ts / 250;
    for (let i = 0; i < 3; i++) {
      const sx = 22 + Math.sin(sa + i * 2) * 4;
      const sy = -12 + i * 9 + Math.cos(sa + i) * 3;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(sa + i);
      ctx.beginPath();
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
        const a2 = a + Math.PI / 5;
        ctx.lineTo(Math.cos(a) * 4, Math.sin(a) * 4);
        ctx.lineTo(Math.cos(a2) * 2, Math.sin(a2) * 2);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  } else {
    // 正常爬行：壳 + 头 + 腿
    const running = t.state === "anger";
    const swing = Math.sin(t.phase) * 0.5;
    ctx.strokeStyle = "#4f9f52";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-7, 8);
    ctx.lineTo(-7 - swing * 6, 17);
    ctx.moveTo(3, 8);
    ctx.lineTo(3 + swing * 6, 17);
    ctx.moveTo(-1, 8);
    ctx.lineTo(-1 + swing * 5, 17);
    ctx.moveTo(9, 8);
    ctx.lineTo(9 - swing * 5, 17);
    ctx.stroke();
    // 壳
    ellipse(ctx, 0, 0, 16, 12, running ? "#e67e22" : "#4f9f52", "#2f6b33", 2);
    // 壳纹
    ctx.strokeStyle = running ? "#c96f1c" : "#8fd08a";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-9, 0);
    ctx.lineTo(9, 0);
    ctx.moveTo(-7, -5);
    ctx.lineTo(7, -5);
    ctx.moveTo(-6, 5);
    ctx.lineTo(6, 5);
    ctx.stroke();
    // 头
    ellipse(ctx, 15, -4, 6.4, 5, "#8fd08a", "#4f9f52", 1.4);
    // 眼睛
    ctx.fillStyle = "#1c3b1e";
    ctx.beginPath();
    ctx.arc(18, -5.5, 1.4, 0, Math.PI * 2);
    ctx.fill();
    // 愤怒的汗滴
    if (running) {
      ctx.fillStyle = "rgba(120,160,255,0.95)";
      ctx.beginPath();
      ctx.arc(-20, -12, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function drawBanana(ctx: CanvasRenderingContext2D, sim: RaceSim): void {
  if (!sim.banana) return;
  const x = px(sim.banana.x);
  ctx.save();
  ctx.translate(x, 338);
  ctx.rotate(-0.15);
  ctx.strokeStyle = "#f5c542";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(0, 0, 8, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();
  ctx.strokeStyle = "#b8860b";
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* 组件                                                               */
/* ------------------------------------------------------------------ */

const RaceGame: React.FC<{ sdk: FatNotesPluginSDK }> = () => {
  const i18n = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<RaceSim>(newSim());
  const holdRef = useRef(false);
  const tapRef = useRef(false);
  const itemRef = useRef<ItemId | null>(null);
  const partsRef = useRef<Particle[]>([]);
  const floatsRef = useRef<FloatText[]>([]);
  const lastTsRef = useRef(0);
  const lastStepSfxRef = useRef(0);
  const [ui, setUi] = useState<UiState>({
    dist: 0,
    time: 0,
    lead: 0,
    stateKey: "walk",
    energy: 1,
    running: false,
    paused: false,
    over: false,
    won: false,
    score: 0,
    sleepHint: false,
  });

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) =>
      i18n.text(key, vars),
    [i18n],
  );

  const restart = useCallback(() => {
    simRef.current = newSim();
    partsRef.current = [];
    floatsRef.current = [];
    tapRef.current = false;
    itemRef.current = null;
    setUi((u) => ({
      ...u,
      dist: 0,
      time: 0,
      lead: 0,
      stateKey: "walk",
      energy: 1,
      running: false,
      paused: false,
      over: false,
      won: false,
      score: 0,
      sleepHint: false,
    }));
  }, []);

  const startPause = useCallback(() => {
    const s = simRef.current;
    if (s.over) return;
    s.running = !s.running;
    setUi((u) => ({ ...u, running: s.running, paused: !s.running }));
  }, []);

  const useItemNow = useCallback((item: ItemId) => {
    itemRef.current = item;
  }, []);

  /** 生成粒子 */
  const spawnParts = useCallback((items: Particle[]) => {
    partsRef.current.push(...items);
  }, []);

  /** 生成浮字 */
  const addFloat = useCallback(
    (x: number, y: number, text: string, color: string) => {
      floatsRef.current.push({ x, y, text, life: 1.5, maxLife: 1.5, color });
    },
    [],
  );

  /** 事件 → 音效 / 粒子 / 浮字 */
  const handleEvents = useCallback(
    (s: RaceSim, events: RaceEvent[]) => {
      for (const ev of events) {
        switch (ev.type) {
          case "sleep":
            sfxMismatch();
            addFloat(px(s.rabbit.x), 250, t("game.race.toast.sleep"), "#9b8cff");
            setUi((u) => ({ ...u, sleepHint: true }));
            break;
          case "wake":
            sfxJump();
            addFloat(px(s.rabbit.x), 248, t("game.race.toast.wake"), "#58d68d");
            setUi((u) => ({ ...u, sleepHint: false }));
            break;
          case "turtleRoll":
            sfxSlingshot();
            addFloat(px(s.turtle.x), 372, t("game.race.toast.roll"), "#48dbfb");
            break;
          case "turtleEat":
            sfxEat();
            addFloat(px(s.turtle.x), 372, t("game.race.toast.eat"), "#8fd08a");
            break;
          case "banana": {
            if (ev.slipped) {
              sfxHurt();
              addFloat(px(s.turtle.x), 372, t("game.race.toast.banana"), "#f5c542");
              for (let i = 0; i < 6; i++) {
                spawnParts([
                  {
                    x: px(s.turtle.x),
                    y: 330,
                    vx: (Math.random() - 0.5) * 120,
                    vy: -60 - Math.random() * 80,
                    life: 0.6,
                    maxLife: 0.6,
                    r: 2 + Math.random() * 3,
                    color: "#ffd766",
                    kind: "star",
                  },
                ]);
              }
            } else {
              sfxBounce();
              addFloat(px(s.turtle.x), 372, t("game.race.toast.bananaMiss"), "#b8e994");
            }
            break;
          }
          case "provoke": {
            if (ev.ok) {
              sfxAlarm();
              addFloat(px(s.turtle.x), 372, t("game.race.toast.provoke"), "#ff7a70");
            } else {
              sfxMismatch();
              addFloat(px(s.rabbit.x), 250, t("game.race.toast.provokeMiss"), "#c9c2b0");
            }
            break;
          }
          case "burst":
            sfxLevelUp();
            addFloat(px(s.rabbit.x), 250, t("game.race.toast.burst"), "#ffb347");
            for (let i = 0; i < 10; i++) {
              spawnParts([
                {
                  x: px(s.rabbit.x) - 18,
                  y: 285 + (Math.random() - 0.5) * 20,
                  vx: -80 - Math.random() * 60,
                  vy: (Math.random() - 0.5) * 40,
                  life: 0.5,
                  maxLife: 0.5,
                  r: 2 + Math.random() * 2.5,
                  color: i % 2 ? "#ffb347" : "#ffd766",
                  kind: "spark",
                },
              ]);
            }
            break;
          case "energy":
            sfxCoin();
            addFloat(px(s.rabbit.x) + 10, 268, "+1 ⚡", "#ffb347");
            break;
          case "terrain":
            sfxReveal();
            addFloat(px(s.rabbit.x), 232, `${TERRAIN_ICON[ev.kind]} ${t(`game.race.terrain.${ev.kind}`)}`, "#fff");
            break;
          case "finish":
            if (ev.winner === "rabbit") sfxWin();
            else sfxLose();
            break;
        }
      }
    },
    [t, addFloat, spawnParts],
  );

  // 主循环
  useEffect(() => {
    let raf = 0;
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      const s = simRef.current;
      if (!lastTsRef.current) lastTsRef.current = ts;
      const dt = Math.min(0.05, (ts - lastTsRef.current) / 1000);
      lastTsRef.current = ts;

      if (s.running && !s.over) {
        const input = {
          hold: holdRef.current,
          tap: tapRef.current,
          item: itemRef.current,
        };
        tapRef.current = false;
        itemRef.current = null;
        const events = stepSim(s, dt, input);
        handleEvents(s, events);
        // 奔跑脚步声（节流）
        if (s.rabbit.state === "running" && ts - lastStepSfxRef.current > 220) {
          lastStepSfxRef.current = ts;
          sfxMove();
          // 脚下尘土
          spawnParts([
            {
              x: px(s.rabbit.x) - 8,
              y: 306,
              vx: -30,
              vy: -20 - Math.random() * 20,
              life: 0.35,
              maxLife: 0.35,
              r: 2 + Math.random() * 2,
              color: "rgba(200,170,120,0.9)",
              kind: "dust",
            },
          ]);
        }
        // 睡着时 Zzz 粒子
        if (s.rabbit.state === "sleeping" && Math.random() < 0.12) {
          spawnParts([
            {
              x: px(s.rabbit.x) + 18,
              y: 272,
              vx: 14,
              vy: -22,
              life: 1.2,
              maxLife: 1.2,
              r: 3,
              color: "rgba(140,190,255,0.95)",
              kind: "zzz",
            },
          ]);
        }
        // 成绩落库
        if (s.over && !s.recorded) {
          s.recorded = true;
          recordScore({
            gameId: "race",
            gameTitle: "龟兔赛跑",
            score: s.score,
            detail: {
              seconds: Math.round(s.time),
              winner: s.won ? "rabbit" : "turtle",
              items: s.itemsUsed,
            },
          });
        }
      }

      // 粒子 / 浮字更新
      const parts = partsRef.current;
      for (const p of parts) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.kind === "dust") p.vy += 160 * dt;
        else p.vy -= 20 * dt;
        p.life -= dt;
      }
      partsRef.current = parts.filter((p) => p.life > 0);
      const floats = floatsRef.current;
      for (const f of floats) {
        f.y -= 26 * dt;
        f.life -= dt;
      }
      floatsRef.current = floats.filter((f) => f.life > 0);

      // 渲染
      drawBackground(ctx, ts);
      drawTerrainStrip(ctx, s);
      drawStart(ctx);
      drawFinish(ctx, ts);
      drawBanana(ctx, s);
      drawRabbit(ctx, s.rabbit, ts);
      drawTurtle(ctx, s.turtle, ts);

      // 唤醒进度条（睡着时）
      if (s.rabbit.state === "sleeping" && !s.over) {
        const rx = px(s.rabbit.x);
        const prog = Math.min(1, s.rabbit.wakeTaps / WAKE_TAPS);
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.fillRect(rx - 25, 262, 50, 7);
        ctx.fillStyle = "#9b8cff";
        ctx.fillRect(rx - 25, 262, 50 * prog, 7);
        ctx.strokeStyle = "rgba(255,255,255,0.7)";
        ctx.lineWidth = 1;
        ctx.strokeRect(rx - 25, 262, 50, 7);
        ctx.font = "bold 14px sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.fillText(t("game.race.sleepTip"), rx, 252);
        ctx.textAlign = "start";
      }

      // 粒子
      for (const p of parts) {
        const a = Math.max(0, p.life / p.maxLife);
        ctx.globalAlpha = a;
        if (p.kind === "zzz") {
          ctx.font = "bold 13px sans-serif";
          ctx.textAlign = "center";
          ctx.fillStyle = p.color;
          ctx.fillText("Z", p.x, p.y);
          ctx.textAlign = "start";
        } else {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      // 浮字
      ctx.font = "bold 14px sans-serif";
      ctx.textAlign = "center";
      for (const f of floats) {
        const a = Math.max(0, f.life / f.maxLife);
        ctx.globalAlpha = a;
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.lineWidth = 3;
        ctx.strokeText(f.text, f.x, f.y);
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, f.x, f.y);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = "start";

      // UI 同步（节流到 ~4Hz）
      if (Math.floor(ts / 250) !== Math.floor((ts - dt * 1000) / 250)) {
        const lead = leadMeters(s);
        setUi((u) => ({
          ...u,
          dist: Math.floor(s.rabbit.x),
          time: Math.floor(s.time),
          lead,
          stateKey:
            s.rabbit.state === "running"
              ? "run"
              : s.rabbit.state === "walking"
                ? "walk"
                : "sleep",
          energy: s.rabbit.energy,
          over: s.over,
          won: s.won,
          score: s.score,
        }));
      }
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleEvents, spawnParts, t]);

  // 键盘
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
        e.preventDefault();
      }
      if (k === " ") {
        const s = simRef.current;
        if (!s.over) {
          if (!s.running) {
            s.running = true;
            setUi((u) => ({ ...u, running: true, paused: false }));
          }
          holdRef.current = true;
          tapRef.current = true; // 睡着时作为唤醒连击
        }
        return;
      }
      if (k === "p") {
        startPause();
        return;
      }
      if (k === "r") {
        restart();
        return;
      }
      if (k === "1") useItemNow("carrot");
      else if (k === "2") useItemNow("banana");
      else if (k === "3") useItemNow("provoke");
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === " ") holdRef.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [startPause, restart, useItemNow]);

  // 鼠标/触屏
  const onPointerDown = () => {
    const s = simRef.current;
    if (s.over) return;
    if (!s.running) {
      s.running = true;
      setUi((u) => ({ ...u, running: true, paused: false }));
    }
    holdRef.current = true;
    tapRef.current = true;
  };
  const onPointerUp = () => {
    holdRef.current = false;
  };

  const itemBtn = (item: ItemId, emoji: string, label: string, hotkey: string) => {
    const s = simRef.current;
    const cost = item === "carrot" ? 3 : item === "banana" ? 2 : 1;
    const disabled = s.over || s.rabbit.state === "sleeping" || s.rabbit.energy < cost;
    return (
      <button
        key={item}
        type="button"
        onClick={() => useItemNow(item)}
        disabled={disabled}
        style={{
          flex: 1,
          padding: "7px 4px",
          borderRadius: 12,
          border: "1px solid rgba(150,120,60,0.45)",
          background: "linear-gradient(135deg, #fff8e6 0%, #ffe8b3 100%)",
          color: "rgba(90,60,10,0.95)",
          fontSize: 12.5,
          fontWeight: 700,
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled ? 0.4 : 1,
          boxShadow: disabled ? "none" : "0 3px 8px rgba(180,130,40,0.25)",
          transition: "transform 0.12s ease",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 5,
        }}
        title={`[${hotkey}] ${label}`}
      >
        <span style={{ fontSize: 16 }}>{emoji}</span>
        <span>{label}</span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: disabled ? "#a08c50" : "#b8860b",
          }}
        >
          ×{cost}
        </span>
      </button>
    );
  };

  return (
    <GameFrame
      emoji="🐢"
      title={t("game.race.title")}
      stats={[
        {
          label: t("game.race.dist"),
          value: `${ui.dist}m`,
          colors: CHIP_BLUE,
        },
        {
          label: t("game.race.time"),
          value: `${ui.time}s`,
          colors: CHIP_PURPLE,
        },
        {
          label: t("game.race.lead"),
          value: `${ui.lead >= 0 ? "+" : ""}${ui.lead.toFixed(1)}m`,
          colors: ui.lead >= 0 ? CHIP_GREEN : CHIP_RED,
        },
        {
          label: t("game.race.energy"),
          value: "⚡".repeat(Math.max(0, ui.energy)),
          colors: CHIP_GOLD,
        },
        {
          label: t("game.race.state"),
          value:
            ui.stateKey === "run"
              ? t("game.race.state.run")
              : ui.stateKey === "walk"
                ? t("game.race.state.walk")
                : t("game.race.state.sleep"),
          colors:
            ui.stateKey === "sleep"
              ? CHIP_RED
              : ui.stateKey === "run"
                ? CHIP_GREEN
                : undefined,
        },
      ]}
      headerExtra={
        <>
          <GhostBtn onClick={startPause} disabled={ui.over}>
            {ui.running ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
            {ui.running ? t("game.race.pause") : t("game.race.start")}
          </GhostBtn>
          <GhostBtn onClick={restart}>
            <ReloadOutlined />
            {t("game.race.restart")}
          </GhostBtn>
        </>
      }
      help={t("game.race.help")}
      maxWidth={760}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: W,
          borderRadius: 14,
          overflow: "hidden",
          boxShadow: "0 8px 24px rgba(40,90,40,0.35)",
          border: "3px solid rgba(110,150,90,0.5)",
        }}
      >
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          style={{ display: "block", width: "100%", height: "auto" }}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        />
        {ui.over && (
          <div
            className="gs-win-in"
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(20,40,25,0.8)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div style={{ fontSize: 42, lineHeight: 1 }}>
              {ui.won ? "🐇🏆" : "🐢🏆"}
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: ui.won ? "#ffd766" : "#8fd08a",
              }}
            >
              {ui.won ? t("game.race.win") : t("game.race.lose")}
            </div>
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.85)" }}>
              {t("game.race.winDetail", {
                time: ui.time,
                score: ui.score,
              })}
            </div>
            <GhostBtn onClick={restart}>
              <ReloadOutlined />
              {t("game.race.again")}
            </GhostBtn>
          </div>
        )}
      </div>

      {/* 道具栏 */}
      <div
        style={{
          display: "flex",
          gap: 8,
          width: "100%",
          maxWidth: W,
          marginTop: 10,
        }}
      >
        {itemBtn("carrot", "🥕", t("game.race.item.carrot"), "1")}
        {itemBtn("banana", "🍌", t("game.race.item.banana"), "2")}
        {itemBtn("provoke", "📣", t("game.race.item.provoke"), "3")}
      </div>
      <div style={{ fontSize: 11.5, color: "rgba(0,0,0,0.55)", marginTop: 8 }}>
        {t("game.race.itemTip")}
      </div>
    </GameFrame>
  );
};

export default RaceGame;
