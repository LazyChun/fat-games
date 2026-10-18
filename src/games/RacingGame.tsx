/*
 * RacingGame：3D 赛车竞速
 *
 * Canvas 手写 3D 透视渲染（OutRun 式伪 3D 公路）：
 *   - 赛道由 1400 个分段构成，弯道用逐段累积的横向偏移表达，
 *     每段按「1 / 深度」透视投影到屏幕（近大远小、收敛到地平线）
 *   - 路边树/路灯、远景山体、云层随深度缩放，营造真实纵深
 *   - 玩家车矢量绘制在近景，随转向倾斜、刹车亮灯、加速拖速度线
 *   - AI 对手车按投影缩放画在路面上，巡航 + 随机变道
 *   - 操作：↑/W 油门，↓/S 刹车（可倒车），←/→/A/D 转向，
 *     P 暂停，R 重新开始；过弯速度太快会被离心甩出赛道，压草地减速，
 *     撞上对手车会顿挫减速
 *   - 目标：跑完 3 圈。成绩 = 平均速度 × 100，用时越短分越高
 */
import React, { useEffect, useRef, useState } from "react";
import { CaretRightOutlined, FlagOutlined, PauseOutlined, ReloadOutlined } from "@ant-design/icons";
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
} from "./GameFrame";
import {
  ACCEL,
  advanceLap,
  BRAKE,
  buildTrack,
  CAM_HEIGHT,
  CAM_Z_OFF,
  CAR_COLORS,
  CAR_LEN,
  CAR_W,
  computeScore,
  computeViews,
  DRAW_DIST,
  detectCollision,
  FOCAL,
  kmh,
  MAX_SPEED,
  newLapState,
  project,
  roadsideAt,
  ROAD_CURB,
  ROAD_W,
  SEG_LEN,
  respawnFarAi,
  spawnAiFleet,
  stepAi,
  stepPlayer,
  TOTAL_LAPS,
  TOTAL_METERS,
  TRACK_METERS,
  TRACK_SEGS,
  type AiCar,
  type CarPalette,
  type LapState,
  type PlayerCar,
  type RaceInput,
  type Track,
} from "./racingLogic";
import { sfxClick, sfxHurt, sfxLevelUp, sfxWin } from "./sound";
import "./gameAnimations.less";

/* ------------------------------------------------------------------ */
/* 画布常量                                                           */
/* ------------------------------------------------------------------ */

const CW = 1000;
const CH = 520;
const HORIZON = CH * 0.42;
const BEST_KEY = "fat-games.racing.best";

type Phase = "idle" | "running" | "paused" | "finished";

interface BestRecord {
  score: number;
  timeSec: number;
  bestLapSec: number | null;
}

interface ResultInfo {
  score: number;
  timeSec: number;
  avgKmh: number;
  bestLapSec: number | null;
}

interface GameState {
  track: Track;
  player: PlayerCar;
  ai: AiCar[];
  lap: LapState;
  timeSec: number;
  lapFlash: number;
  camShake: number;
  recorded: boolean;
}

function newGameState(): GameState {
  const track = buildTrack();
  const player: PlayerCar = { x: 0, z: 0, speed: 0, steer: 0, crash: 0 };
  const ai = spawnAiFleet(track.rand);
  return {
    track,
    player,
    ai,
    lap: newLapState(),
    timeSec: 0,
    lapFlash: 0,
    camShake: 0,
    recorded: false,
  };
}

function readBest(): BestRecord | null {
  try {
    const raw = window.localStorage.getItem(BEST_KEY);
    return raw ? (JSON.parse(raw) as BestRecord) : null;
  } catch {
    return null;
  }
}

function writeBest(rec: BestRecord): void {
  try {
    window.localStorage.setItem(BEST_KEY, JSON.stringify(rec));
  } catch {
    /* ignore */
  }
}

function segIndexOf(z: number): number {
  const m = ((z % TRACK_METERS) + TRACK_METERS) % TRACK_METERS;
  return Math.floor(m / SEG_LEN) % TRACK_SEGS;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Canvas 绘制工具                                                     */
/* ------------------------------------------------------------------ */

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rad = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function trap(
  ctx: CanvasRenderingContext2D,
  x1a: number, x1b: number, y1: number,
  x2a: number, x2b: number, y2: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x1a, y1);
  ctx.lineTo(x1b, y1);
  ctx.lineTo(x2b, y2);
  ctx.lineTo(x2a, y2);
  ctx.closePath();
}

/** 十六进制颜色提亮（用于车顶亮面） */
function lighten(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) + 42);
  const g = Math.min(255, ((n >> 8) & 255) + 42);
  const b = Math.min(255, (n & 255) + 42);
  return `rgb(${r},${g},${b})`;
}

/** 后视卡通赛车（车尾盒子 + 双竖尾灯 + 梯形后窗 + 贴地大轮 + 腰线） */
function drawCar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  len: number,
  tilt: number,
  pal: CarPalette,
  brake: boolean,
): void {
  const w = len * 0.7; // 车宽（宽扁更像车）
  const h = len * 0.5; // 车高
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt);

  // 地面阴影
  ctx.fillStyle = "rgba(0,0,0,0.32)";
  ctx.beginPath();
  ctx.ellipse(0, h * 0.44, w * 0.6, h * 0.12, 0, 0, Math.PI * 2);
  ctx.fill();

  // 后轮：车尾板底部两侧，明显外露
  const wr = w * 0.15;
  const wy = h * 0.4;
  ctx.fillStyle = "#0c0e14";
  ctx.beginPath();
  ctx.arc(-w * 0.42, wy, wr, 0, Math.PI * 2);
  ctx.arc(w * 0.42, wy, wr, 0, Math.PI * 2);
  ctx.fill();
  // 轮胎高光弧
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = Math.max(1, wr * 0.12);
  ctx.beginPath();
  ctx.arc(-w * 0.42, wy, wr * 0.8, Math.PI * 0.9, Math.PI * 1.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(w * 0.42, wy, wr * 0.8, Math.PI * 0.9, Math.PI * 1.6);
  ctx.stroke();
  // 轮毂
  ctx.fillStyle = "#c2cad9";
  ctx.beginPath();
  ctx.arc(-w * 0.42, wy, wr * 0.4, 0, Math.PI * 2);
  ctx.arc(w * 0.42, wy, wr * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#6a7284";
  ctx.beginPath();
  ctx.arc(-w * 0.42, wy, wr * 0.13, 0, Math.PI * 2);
  ctx.arc(w * 0.42, wy, wr * 0.13, 0, Math.PI * 2);
  ctx.fill();

  // 车尾板（车身主体：宽扁圆角矩形）
  const bodyTop = -h * 0.12;
  const bodyBot = h * 0.4;
  ctx.fillStyle = pal.body;
  rr(ctx, -w * 0.45, bodyTop, w * 0.9, bodyBot - bodyTop, w * 0.06);
  ctx.fill();
  // 车尾板两侧明暗
  ctx.fillStyle = "rgba(0,0,0,0.15)";
  rr(ctx, -w * 0.45, bodyTop, w * 0.1, bodyBot - bodyTop, w * 0.05);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  rr(ctx, w * 0.32, bodyTop, w * 0.13, bodyBot - bodyTop, w * 0.05);
  ctx.fill();
  // 腰线（车尾板中部横贯装饰线）
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  ctx.fillRect(-w * 0.4, h * 0.22, w * 0.8, h * 0.018);

  // 车顶（窄圆角矩形，亮色）+ 弧线过渡
  ctx.fillStyle = lighten(pal.body);
  rr(ctx, -w * 0.19, -h * 0.52, w * 0.38, h * 0.4, w * 0.1);
  ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  ctx.fillRect(-w * 0.19, bodyTop - h * 0.03, w * 0.38, h * 0.035);

  // 后窗（梯形玻璃，上窄下宽，嵌在车顶下）
  ctx.fillStyle = pal.cabin;
  ctx.beginPath();
  ctx.moveTo(-w * 0.13, -h * 0.4);
  ctx.lineTo(w * 0.13, -h * 0.4);
  ctx.lineTo(w * 0.17, -h * 0.16);
  ctx.lineTo(-w * 0.17, -h * 0.16);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.beginPath();
  ctx.moveTo(-w * 0.1, -h * 0.37);
  ctx.lineTo(-w * 0.03, -h * 0.37);
  ctx.lineTo(-w * 0.07, -h * 0.2);
  ctx.lineTo(-w * 0.12, -h * 0.2);
  ctx.closePath();
  ctx.fill();

  // 尾翼（车顶下方横贯）
  ctx.fillStyle = pal.dark;
  rr(ctx, -w * 0.4, -h * 0.26, w * 0.8, h * 0.085, w * 0.04);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.18)";
  rr(ctx, -w * 0.4, -h * 0.25, w * 0.8, h * 0.024, w * 0.035);
  ctx.fill();

  // 双竖尾灯（左右各一，真车尾灯特征，刹车高亮）
  const lampW = w * 0.11;
  const lampH = h * 0.16;
  const lampY = -h * 0.02;
  ctx.fillStyle = brake ? "rgba(255,34,51,0.5)" : "rgba(255,90,78,0.34)";
  rr(ctx, -w * 0.36, lampY, lampW + w * 0.03, lampH + h * 0.05, w * 0.05);
  ctx.fill();
  rr(ctx, w * 0.36 - lampW - w * 0.03, lampY, lampW + w * 0.03, lampH + h * 0.05, w * 0.05);
  ctx.fill();
  ctx.fillStyle = brake ? "#ff2233" : "#ff5a4e";
  rr(ctx, -w * 0.35, lampY + h * 0.01, lampW, lampH, w * 0.045);
  ctx.fill();
  rr(ctx, w * 0.35 - lampW, lampY + h * 0.01, lampW, lampH, w * 0.045);
  ctx.fill();
  ctx.fillStyle = brake ? "#ffc4ca" : "#ffc0b8";
  rr(ctx, -w * 0.33, lampY + h * 0.02, lampW * 0.5, lampH * 0.3, w * 0.03);
  ctx.fill();
  rr(ctx, w * 0.35 - lampW + lampW * 0.1, lampY + h * 0.02, lampW * 0.5, lampH * 0.3, w * 0.03);
  ctx.fill();

  // 牌照（车尾板下部）
  ctx.fillStyle = "#e8ecf2";
  rr(ctx, -w * 0.11, h * 0.18, w * 0.22, h * 0.11, w * 0.03);
  ctx.fill();
  ctx.fillStyle = "#3a4150";
  ctx.fillRect(-w * 0.09, h * 0.22, w * 0.18, h * 0.04);

  // 后保险杠（底部深色条）
  ctx.fillStyle = "#23262f";
  rr(ctx, -w * 0.4, h * 0.32, w * 0.8, h * 0.09, w * 0.035);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  rr(ctx, -w * 0.4, h * 0.33, w * 0.8, h * 0.02, w * 0.035);
  ctx.fill();

  // 排气管（保险杠内）
  ctx.fillStyle = "#0c0e14";
  ctx.beginPath();
  ctx.arc(-w * 0.22, h * 0.37, w * 0.035, 0, Math.PI * 2);
  ctx.arc(w * 0.22, h * 0.37, w * 0.035, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#c8ced9";
  ctx.beginPath();
  ctx.arc(-w * 0.22, h * 0.37, w * 0.016, 0, Math.PI * 2);
  ctx.arc(w * 0.22, h * 0.37, w * 0.016, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* 组件                                                               */
/* ------------------------------------------------------------------ */

export default function RacingGame({ sdk }: { sdk: FatNotesPluginSDK }): React.ReactElement {
  const i18n = useI18n();
  const t = i18n.text;
  const isDark = useThemeMode();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const phaseRef = useRef<Phase>("idle");
  const keysRef = useRef<Set<string>>(new Set());
  const stateRef = useRef<GameState>(newGameState());
  const [phase, setPhaseState] = useState<Phase>("idle");
  const [result, setResult] = useState<ResultInfo | null>(null);
  const [best, setBest] = useState<BestRecord | null>(readBest());

  const setPhase = (p: Phase): void => {
    phaseRef.current = p;
    setPhaseState(p);
  };

  /* ---------------- 游戏流程 ---------------- */

  const restart = (): void => {
    sfxClick();
    stateRef.current = newGameState();
    setResult(null);
    setPhase("idle");
  };

  const start = (): void => {
    sfxClick();
    if (phaseRef.current !== "running") stateRef.current = newGameState();
    setPhase("running");
  };

  const finish = (): void => {
    const s = stateRef.current;
    if (s.recorded) return;
    s.recorded = true;
    const timeSec = Math.max(0.1, s.timeSec);
    const score = computeScore(TOTAL_METERS, timeSec);
    const avgKmh = Math.round((TOTAL_METERS / timeSec) * 3.6);
    const info: ResultInfo = {
      score,
      timeSec,
      avgKmh,
      bestLapSec: s.lap.bestLapSec,
    };
    setResult(info);
    const prev = readBest();
    if (!prev || score > prev.score) {
      const rec: BestRecord = { score, timeSec, bestLapSec: s.lap.bestLapSec };
      writeBest(rec);
      setBest(rec);
    }
    recordScore({
      gameId: "racing",
      gameTitle: "赛车竞速",
      score,
      detail: {
        laps: TOTAL_LAPS,
        timeSec: Math.round(timeSec * 10) / 10,
        avgSpeedKmh: avgKmh,
        bestLapSec: s.lap.bestLapSec ? Math.round(s.lap.bestLapSec * 10) / 10 : null,
      },
    });
    sfxWin();
    setPhase("finished");
  };

  /* ---------------- 键盘 ---------------- */

  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      const k = e.key;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].indexOf(k) >= 0) e.preventDefault();
      keysRef.current.add(k);
      if (k === "p" || k === "P") {
        const ph = phaseRef.current;
        if (ph === "running") {
          sfxClick();
          phaseRef.current = "paused";
          setPhaseState("paused");
        } else if (ph === "paused") {
          sfxClick();
          phaseRef.current = "running";
          setPhaseState("running");
        }
      } else if (k === "r" || k === "R") {
        if (phaseRef.current !== "idle") {
          sfxClick();
          stateRef.current = newGameState();
          setResult(null);
          phaseRef.current = "idle";
          setPhaseState("idle");
        }
      } else if (k === " " || k === "Enter") {
        const ph = phaseRef.current;
        if (ph === "idle" || ph === "paused") {
          sfxClick();
          phaseRef.current = "running";
          setPhaseState("running");
        } else if (ph === "finished") {
          sfxClick();
          stateRef.current = newGameState();
          setResult(null);
          phaseRef.current = "idle";
          setPhaseState("idle");
        }
      }
    };
    const up = (e: KeyboardEvent): void => {
      keysRef.current.delete(e.key);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  /* ---------------- 主循环 ---------------- */

  useEffect(() => {
    let raf = 0;
    let last = performance.now();

    const step = (dt: number): void => {
      const s = stateRef.current;
      const keys = keysRef.current;
      const input: RaceInput = {
        up: keys.has("ArrowUp") || keys.has("w") || keys.has("W"),
        down: keys.has("ArrowDown") || keys.has("s") || keys.has("S"),
        left: keys.has("ArrowLeft") || keys.has("a") || keys.has("A"),
        right: keys.has("ArrowRight") || keys.has("d") || keys.has("D"),
      };
      const segIdx = segIndexOf(s.player.z);
      const curve = s.track.segs[segIdx].curve;
      stepPlayer(s.player, input, curve, dt);
      s.player.z = ((s.player.z + s.player.speed * dt) % TRACK_METERS + TRACK_METERS) % TRACK_METERS;
      s.timeSec += dt;

      if (advanceLap(s.lap, s.player.z, s.timeSec)) {
        s.lapFlash = 2.2;
        sfxLevelUp();
        if (s.lap.lap > TOTAL_LAPS) {
          finish();
          return;
        }
      }

      for (const c of s.ai) stepAi(c, s.track.rand, dt);
      // AI 在场管理：掉队/跑远的车重新布置到前方，保持赛道上有对手
      for (const c of s.ai) respawnFarAi(c, s.track.rand, s.player.z);
      for (const c of s.ai) {
        if (detectCollision(s.player, c)) {
          s.player.speed *= 0.45;
          s.player.crash = 0.35;
          s.camShake = 0.4;
          sfxHurt();
        }
      }

      if (s.lapFlash > 0) s.lapFlash -= dt;
      if (s.camShake > 0) s.camShake -= dt;
    };

    const draw = (): void => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== CW * dpr || canvas.height !== CH * dpr) {
        canvas.width = CW * dpr;
        canvas.height = CH * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const s = stateRef.current;
      const clock = performance.now() / 1000;

      ctx.save();
      if (s.camShake > 0) {
        const k = s.camShake * 16;
        ctx.translate((Math.random() - 0.5) * k, (Math.random() - 0.5) * k);
      }
      drawScene(ctx, s, clock);
      ctx.restore();

      drawHud(ctx, s);
    };

    const loop = (now: number): void => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      if (phaseRef.current === "running") step(dt);
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------- 场景绘制 ---------------- */

  const drawScene = (ctx: CanvasRenderingContext2D, s: GameState, clock: number): void => {
    const { track, player } = s;

    // 天空
    const sky = ctx.createLinearGradient(0, 0, 0, HORIZON);
    if (isDark) {
      sky.addColorStop(0, "#101a3c");
      sky.addColorStop(0.6, "#1d2a55");
      sky.addColorStop(1, "#39497e");
    } else {
      sky.addColorStop(0, "#2c4a8a");
      sky.addColorStop(0.62, "#5d80d2");
      sky.addColorStop(1, "#a9c5ec");
    }
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CW, HORIZON + 1);

    // 太阳与光晕
    const sunX = CW * 0.76;
    const sunY = HORIZON - 66;
    const glow = ctx.createRadialGradient(sunX, sunY, 6, sunX, sunY, 90);
    glow.addColorStop(0, "rgba(255,240,190,0.9)");
    glow.addColorStop(0.35, "rgba(255,220,150,0.35)");
    glow.addColorStop(1, "rgba(255,220,150,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(sunX - 90, sunY - 90, 180, 180);
    ctx.fillStyle = "#fff3cf";
    ctx.beginPath();
    ctx.arc(sunX, sunY, 22, 0, Math.PI * 2);
    ctx.fill();

    // 云（缓慢漂移）
    ctx.fillStyle = isDark ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.72)";
    for (let i = 0; i < 3; i++) {
      const cx = ((i * 380 + clock * 14) % (CW + 260)) - 130;
      const cy = 46 + i * 34;
      ctx.beginPath();
      ctx.ellipse(cx, cy, 52, 15, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + 30, cy - 8, 32, 12, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 远景山（两层）
    ctx.fillStyle = isDark ? "rgba(88,102,150,0.85)" : "rgba(128,148,196,0.85)";
    ctx.beginPath();
    ctx.moveTo(0, HORIZON + 2);
    for (let x = 0; x <= CW; x += 36) {
      const y = HORIZON - 26 - 40 * Math.abs(Math.sin(x * 0.008 + 1.2 + clock * 0.004)) - 26 * Math.sin(x * 0.02 + clock * 0.01);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(CW, HORIZON + 2);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = isDark ? "rgba(52,84,74,0.9)" : "rgba(74,126,88,0.9)";
    ctx.beginPath();
    ctx.moveTo(0, HORIZON + 2);
    for (let x = 0; x <= CW; x += 30) {
      const y = HORIZON - 10 - 30 * Math.abs(Math.sin(x * 0.012 + 2.6 + clock * 0.006)) - 18 * Math.sin(x * 0.027);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(CW, HORIZON + 2);
    ctx.closePath();
    ctx.fill();

    // 草地
    const grass = ctx.createLinearGradient(0, HORIZON, 0, CH);
    if (isDark) {
      grass.addColorStop(0, "#3f7048");
      grass.addColorStop(1, "#1e3c28");
    } else {
      grass.addColorStop(0, "#63ab68");
      grass.addColorStop(1, "#377a40");
    }
    ctx.fillStyle = grass;
    ctx.fillRect(0, HORIZON, CW, CH - HORIZON);

    // 赛道与沿线元素
    const playerSeg = segIndexOf(player.z);
    const views = computeViews(track, playerSeg, player.x, CW, HORIZON);

    // AI 车按所在段归类（仅可见范围）
    const aiBySeg = new Map<number, AiCar[]>();
    for (const c of s.ai) {
      const segIdx = segIndexOf(c.z);
      const rel = ((segIdx - playerSeg) % TRACK_SEGS + TRACK_SEGS) % TRACK_SEGS;
      if (rel >= 1 && rel <= DRAW_DIST) {
        const arr = aiBySeg.get(segIdx) || [];
        arr.push(c);
        aiBySeg.set(segIdx, arr);
      }
    }

    // 从远到近绘制路面；沿线精灵（树/路灯/AI 车）收集后统一按深度绘制，
    // 避免近处路面梯形盖住远处车辆导致「半透明」
    const half = ROAD_W / 2;
    interface Sprite {
      depth: number;
      draw: () => void;
    }
    const sprites: Sprite[] = [];
    for (let i = views.length - 1; i >= 0; i--) {
      const v = views[i];
      const near = i > 0 ? views[i - 1] : null;
      drawRoadSurface(ctx, v, near);
      // 路边装饰（树 / 路灯），仅中远距离出现
      if (v.dz > 46) {
        const dec = roadsideAt(v.seg.index);
        if (dec) {
          const sx = v.centerX + dec.x * dec.side * v.scale;
          const sy = v.y;
          const depth = v.dz;
          sprites.push({
            depth,
            draw: () => {
              if (dec.kind === "tree") {
                const crown = v.scale * 7;
                ctx.fillStyle = "#7a5a36";
                ctx.fillRect(sx - crown * 0.05, sy, crown * 0.1, crown * 0.45);
                ctx.fillStyle = isDark ? "#2f5d38" : "#3f8a4c";
                ctx.beginPath();
                ctx.arc(sx, sy - crown * 0.2, crown * 0.5, 0, Math.PI * 2);
                ctx.arc(sx - crown * 0.34, sy - crown * 0.05, crown * 0.34, 0, Math.PI * 2);
                ctx.arc(sx + crown * 0.34, sy - crown * 0.05, crown * 0.34, 0, Math.PI * 2);
                ctx.fill();
              } else {
                const h = v.scale * 5.5;
                ctx.fillStyle = "#8f97a8";
                ctx.fillRect(sx - v.scale * 0.16, sy - h, v.scale * 0.32, h);
                ctx.fillStyle = "#ffe9a8";
                ctx.beginPath();
                ctx.arc(sx, sy - h, v.scale * 0.55, 0, Math.PI * 2);
                ctx.fill();
              }
            },
          });
        }
      }
      // AI 对手车
      const cars = aiBySeg.get(v.seg.index) || [];
      for (const c of cars) {
        const sx = v.centerX + c.x * half * v.scale;
        const lenPx = Math.max(8, CAR_LEN * v.scale);
        const pal = CAR_COLORS[c.colorIdx] ?? CAR_COLORS[0];
        const depth = v.dz;
        const carY = v.y + lenPx * 0.5;
        sprites.push({
          depth,
          draw: () => drawCar(ctx, sx, carY, lenPx, 0, pal, false),
        });
      }
    }
    // 精灵按深度从远到近绘制（远的先画，近的覆盖远的）
    sprites.sort((a, b) => b.depth - a.depth);
    for (const sp of sprites) sp.draw();

    drawPlayerCar(ctx, s);
  };

  /** 单段路面梯形 + 路肩 + 中线（不含精灵，精灵统一后置绘制） */
  const drawRoadSurface = (
    ctx: CanvasRenderingContext2D,
    v: ReturnType<typeof computeViews>[number],
    near: ReturnType<typeof computeViews>[number] | null,
  ): void => {
    const half = ROAD_W / 2;
    const topY = v.y;
    const topL = v.centerX - half * v.scale;
    const topR = v.centerX + half * v.scale;
    const botY = near ? near.y : CH;
    const botL = near ? near.centerX - half * near.scale : topL;
    const botR = near ? near.centerX + half * near.scale : topR;
    const nearScale = near ? near.scale : v.scale;

    // 路面（交替深浅营造棋盘感）
    const lightRoad = isDark ? "#4a5163" : "#6b7284";
    const darkRoad = isDark ? "#3d4354" : "#565c6c";
    ctx.fillStyle = v.seg.index % 2 === 0 ? lightRoad : darkRoad;
    trap(ctx, topL, topR, topY, botL, botR, botY);
    ctx.fill();

    // 路肩（红白交替）
    const curb = ROAD_W * 0.055;
    const redCurb = v.seg.index % 12 < 6;
    ctx.fillStyle = redCurb ? "#e04b3e" : "#e9e6dc";
    trap(ctx, topL - curb * v.scale, topL, topY, botL - curb * nearScale, botL, botY);
    ctx.fill();
    ctx.fillStyle = redCurb ? "#e9e6dc" : "#e04b3e";
    trap(ctx, topR, topR + curb * v.scale, topY, botR, botR + curb * nearScale, botY);
    ctx.fill();

    // 车道虚线
    const midW = ROAD_W * 0.014;
    ctx.fillStyle = v.seg.index % 2 === 0 ? "rgba(255,255,255,0.72)" : "rgba(255,255,255,0.34)";
    trap(
      ctx,
      v.centerX - (midW / 2) * v.scale, v.centerX + (midW / 2) * v.scale, topY,
      near ? near.centerX - (midW / 2) * nearScale : v.centerX - (midW / 2) * v.scale,
      near ? near.centerX + (midW / 2) * nearScale : v.centerX + (midW / 2) * v.scale,
      botY,
    );
    ctx.fill();
  };

  /** 玩家车（近景固定大小，随转向倾斜） */
  const drawPlayerCar = (ctx: CanvasRenderingContext2D, s: GameState): void => {
    const px = CW / 2 + s.player.x * 250;
    const py = CH - 78;
    const len = 128;
    const keys = keysRef.current;
    const braking = keys.has("ArrowDown") || keys.has("s") || keys.has("S");

    // 速度线（高速时向后拖）
    const sp = Math.abs(s.player.speed);
    if (sp > 14) {
      ctx.strokeStyle = "rgba(255,255,255,0.4)";
      ctx.lineWidth = 2.4;
      ctx.lineCap = "round";
      const n = 2 + Math.floor(sp / 16);
      for (let i = 0; i < n; i++) {
        const ox = (i % 2 === 0 ? -1 : 1) * (66 + (i % 3) * 16);
        const sy = py + 60 + (i % 2) * 10;
        const drag = 30 + sp * 1.3;
        ctx.beginPath();
        ctx.moveTo(px + ox, sy);
        ctx.lineTo(px + ox, sy + drag);
        ctx.stroke();
      }
    }

    drawCar(ctx, px, py, len, s.player.steer * 0.16, { body: "#ff5a4e", cabin: "#2b2f3e", dark: "#c33d33" }, braking);
  };

  /* ---------------- HUD ---------------- */

  const drawHud = (ctx: CanvasRenderingContext2D, s: GameState): void => {
    // 速度表（左下）
    ctx.fillStyle = "rgba(10,12,20,0.62)";
    rr(ctx, 14, CH - 92, 168, 78, 16);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.font = "700 38px system-ui, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(String(kmh(s.player.speed)), 30, CH - 42);
    ctx.font = "600 13px system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.62)";
    ctx.fillText("km/h", 118, CH - 42);

    // 圈数与计时（右上）
    ctx.fillStyle = "rgba(10,12,20,0.62)";
    rr(ctx, CW - 236, 14, 222, 78, 16);
    ctx.fill();
    ctx.textAlign = "right";
    ctx.font = "700 22px system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.fillText(`${s.lap.lap} / ${TOTAL_LAPS}`, CW - 28, 42);
    ctx.font = "600 30px system-ui, sans-serif";
    ctx.fillText(formatTime(s.timeSec), CW - 28, 76);
    ctx.font = "600 11px system-ui, sans-serif";
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillText("LAP", CW - 28, 24);

    // 最佳圈速（右上角小标）
    if (s.lap.bestLapSec !== null) {
      ctx.font = "600 12px system-ui, sans-serif";
      ctx.fillStyle = "rgba(255,224,130,0.95)";
      ctx.fillText(`BEST ${formatTime(s.lap.bestLapSec)}`, CW - 28, 100);
    }

    // 过圈浮字
    if (s.lapFlash > 0) {
      const a = Math.min(1, s.lapFlash / 0.6);
      ctx.textAlign = "center";
      ctx.font = "800 44px system-ui, sans-serif";
      ctx.fillStyle = `rgba(255,224,130,${a})`;
      ctx.fillText(t("game.racing.lapDone", { lap: s.lap.lap - 1 }), CW / 2, CH * 0.34);
    }
  };

  /* ---------------- 覆盖层 ---------------- */

  const overlay = (content: React.ReactNode): React.ReactElement => (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(8,10,18,0.55)",
        borderRadius: 12,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 10,
          padding: "22px 34px",
          borderRadius: 18,
          background: isDark ? "rgba(24,28,44,0.92)" : "rgba(255,255,255,0.94)",
          boxShadow: "0 10px 34px rgba(0,0,0,0.35)",
          minWidth: 300,
        }}
      >
        {content}
      </div>
    </div>
  );

  const bestLapText = result?.bestLapSec != null ? formatTime(result.bestLapSec) : "—";

  return (
    <GameFrame
      emoji="🏎️"
      title={t("game.racing.title")}
      maxWidth={900}
      stats={[
        {
          label: t("game.racing.best"),
          value: best ? best.score : "—",
          colors: CHIP_GOLD,
        },
        {
          label: t("game.racing.bestLap"),
          value: best?.bestLapSec != null ? formatTime(best.bestLapSec) : "—",
          colors: CHIP_GREEN,
        },
        {
          label: t("game.racing.distance"),
          value: `${TOTAL_METERS} m`,
          colors: CHIP_BLUE,
        },
      ]}
      headerExtra={
        <GhostBtn onClick={restart}>
          <ReloadOutlined /> {t("game.racing.restart")}
        </GhostBtn>
      }
      help={t("game.racing.help", { laps: TOTAL_LAPS })}
    >
      <div style={{ position: "relative", width: "100%" }}>
        <canvas
          ref={canvasRef}
          tabIndex={0}
          style={{
            width: "100%",
            aspectRatio: `${CW}/${CH}`,
            borderRadius: 12,
            display: "block",
            outline: "none",
            cursor: "pointer",
          }}
          onClick={() => {
            const ph = phaseRef.current;
            if (ph === "idle") start();
            else if (ph === "paused") {
              sfxClick();
              setPhase("running");
            }
          }}
        />
        {phase === "idle" &&
          overlay(
            <>
              <span style={{ fontSize: 44, lineHeight: 1 }}>🏎️</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: isDark ? "#fff" : "#1a1f2e" }}>
                {t("game.racing.title")}
              </span>
              <span style={{ fontSize: 13, color: isDark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.6)" }}>
                {t("game.racing.idle")}
              </span>
              <PrimaryBtn onClick={start}>
                <CaretRightOutlined /> {t("game.racing.start")}
              </PrimaryBtn>
            </>,
          )}
        {phase === "paused" &&
          overlay(
            <>
              <span style={{ fontSize: 20, fontWeight: 800, color: isDark ? "#fff" : "#1a1f2e" }}>
                <PauseOutlined /> {t("game.racing.paused")}
              </span>
              <span style={{ fontSize: 13, color: isDark ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.6)" }}>
                {t("game.racing.resumeTip")}
              </span>
              <div style={{ display: "flex", gap: 10 }}>
                <PrimaryBtn onClick={() => setPhase("running")}>
                  <CaretRightOutlined /> {t("game.racing.resume")}
                </PrimaryBtn>
                <GhostBtn onClick={restart}>{t("game.racing.restart")}</GhostBtn>
              </div>
            </>,
          )}
        {phase === "finished" &&
          result &&
          overlay(
            <>
              <span style={{ fontSize: 40, lineHeight: 1 }}>🏁</span>
              <span style={{ fontSize: 20, fontWeight: 800, color: isDark ? "#fff" : "#1a1f2e" }}>
                {t("game.racing.finish")}
              </span>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto auto",
                  gap: "6px 22px",
                  fontSize: 14,
                  color: isDark ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.78)",
                }}
              >
                <span>{t("game.racing.time")}</span>
                <b>{formatTime(result.timeSec)}</b>
                <span>{t("game.racing.avgSpeed")}</span>
                <b>{result.avgKmh} km/h</b>
                <span>{t("game.racing.bestLap")}</span>
                <b>{bestLapText}</b>
                <span>{t("game.racing.score")}</span>
                <b style={{ color: "#e8a33d" }}>{result.score}</b>
              </div>
              <PrimaryBtn onClick={restart}>
                <FlagOutlined /> {t("game.racing.again")}
              </PrimaryBtn>
            </>,
          )}
      </div>
    </GameFrame>
  );
}
