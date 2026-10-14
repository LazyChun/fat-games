/*
 * ArcheryGame：反弹神射（射箭小游戏）
 *
 * 玩法：在弓手处按住鼠标向外拖弓蓄力（向左下拖 → 向右上射），松开即射。
 * 重力 + 每箭随机风力影响弹道；箭撞砖墙/冰面会反弹（每次反弹命中 +50%）；
 * 木箱一碰即碎、炸药桶引爆清障；苹果头靶高风险高回报。
 * 每关 5 支箭，达到目标分晋级，风力随关卡增强；连续命中连击最高 ×4。
 */
import React, { useCallback, useEffect, useReducer, useRef, useState } from "react";
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
  sfxShoot,
  sfxBounce,
  sfxLand,
  sfxClear,
  sfxBoom,
  sfxHit,
  sfxScore,
  sfxCoin,
  sfxHurt,
  sfxLevelUp,
  sfxLose,
  sfxWin,
} from "./sound";
import {
  ARC,
  advanceLevel,
  computeLaunch,
  createWorld,
  previewPath,
  startShot,
  stepWorld,
  type GameEvent,
  type World,
} from "./archeryLogic";

const W = ARC.W;
const H = ARC.H;
const G = ARC.GROUND;
const BEST_KEY = "fat-games.archery.best";

/** 浮动文字/粒子等表现层效果（不污染纯逻辑） */
interface Fx {
  x: number;
  y: number;
  text: string;
  color: string;
  born: number;
  life: number;
}

interface Hud {
  phase: World["phase"];
  level: number;
  score: number;
  levelScore: number;
  goal: number;
  arrowsLeft: number;
  combo: number;
  wind: number;
  best: number;
}

const ArcheryGame: React.FC<{ sdk: FatNotesPluginSDK }> = () => {
  const i18n = useI18n();
  const worldRef = useRef<World>(null as unknown as World);
  if (!worldRef.current) {
    worldRef.current = createWorld(1);
  }

  const [, force] = useReducer((x: number) => x + 1, 0);
  const [hud, setHud] = useState<Hud>(() => snapshot(worldRef.current));
  const [recorded, setRecorded] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingRef = useRef(false);
  const pointerRef = useRef({ x: 0, y: 0 });
  const previewRef = useRef<{ x: number; y: number }[] | null>(null);
  const fxRef = useRef<Fx[]>([]);
  const shakeRef = useRef({ t: 0, mag: 0 });
  const lastTRef = useRef(0);
  const rafRef = useRef(0);
  const nextLevelTimerRef = useRef<number | null>(null);

  /* ── 快照 HUD ─────────────────────────────────────────── */
  function snapshot(w: World): Hud {
    const best = Number(window.localStorage.getItem(BEST_KEY) || "0");
    return {
      phase: w.phase,
      level: w.level,
      score: w.score,
      levelScore: w.levelScore,
      goal: w.goal,
      arrowsLeft: w.arrowsLeft,
      combo: w.combo,
      wind: w.wind,
      best,
    };
  }

  /* ── 音效与飘字映射 ───────────────────────────────────── */
  const playEvent = useCallback((e: GameEvent): void => {
    const now = performance.now();
    const push = (
      x: number,
      y: number,
      text: string,
      color: string,
      life = 900,
    ): void => {
      fxRef.current.push({ x, y, text, color, born: now, life });
    };
    switch (e.type) {
      case "shot":
        sfxShoot();
        break;
      case "bounce":
        sfxBounce();
        break;
      case "thud":
      case "land":
        sfxLand();
        break;
      case "crate":
        sfxClear();
        push(e.x, e.y - 16, "碎！", "#e8b15a", 700);
        break;
      case "boom":
        sfxBoom();
        shakeRef.current = { t: 0, mag: 7 };
        push(e.x, e.y - 20, "轰！", "#ff8a4c", 1100);
        break;
      case "hit":
        sfxHit();
        push(e.x, e.y - 26, `+${e.points}`, "#ffd34d", 1000);
        break;
      case "bullseye":
        sfxScore();
        sfxCoin();
        push(e.x, e.y - 30, `十环 +${e.points}`, "#ffd34d", 1200);
        break;
      case "apple":
        sfxCoin();
        push(e.x, e.y - 40, "苹果！", "#ff7d6a", 1100);
        push(e.x, e.y - 16, `+${e.points}`, "#ffd34d", 1100);
        break;
      case "npc":
        sfxHurt();
        shakeRef.current = { t: 0, mag: 4 };
        push(e.x, e.y - 46, "哎哟！", "#ff8b8b", 1300);
        push(e.x, e.y - 22, `${e.points}`, "#ff8b8b", 1300);
        break;
      case "levelup":
        sfxLevelUp();
        break;
      case "over":
        sfxLose();
        break;
      case "won":
        sfxWin();
        break;
      default:
        break;
    }
  }, []);

  /* ── 结算与落库 ───────────────────────────────────────── */
  const recordOnce = useCallback(
    (w: World) => {
      if (recorded) return;
      setRecorded(true);
      const best = Math.max(w.score, Number(window.localStorage.getItem(BEST_KEY) || "0"));
      window.localStorage.setItem(BEST_KEY, String(best));
      recordScore({
        gameId: "archery",
        gameTitle: "反弹神射",
        score: w.score,
        detail: { level: w.level, goal: w.goal, best },
      });
    },
    [recorded],
  );

  useEffect(() => {
    if (hud.phase === "over" || hud.phase === "won") recordOnce(worldRef.current);
  }, [hud.phase, recordOnce]);

  /* ── 主循环 ───────────────────────────────────────────── */
  useEffect(() => {
    const loop = (t: number): void => {
      const w = worldRef.current;
      const dtMs = lastTRef.current ? t - lastTRef.current : 16;
      lastTRef.current = t;

      const ev = stepWorld(w, dtMs);
      for (const e of ev) playEvent(e);

      // 表现层推进
      shakeRef.current.t += dtMs;
      // 过关自动进入下一关（连击/结算后短暂停留）
      if (w.phase === "levelup" && nextLevelTimerRef.current === null) {
        nextLevelTimerRef.current = window.setTimeout(() => {
          nextLevelTimerRef.current = null;
          worldRef.current = advanceLevel(worldRef.current);
          fxRef.current = [];
          setHud(snapshot(worldRef.current));
        }, 1500);
      }

      // 命中后清除拖弓预览
      if (ev.length > 0 && !draggingRef.current) previewRef.current = null;

      setHud((h) => {
        const n = snapshot(w);
        return n.phase === h.phase &&
          n.level === h.level &&
          n.score === h.score &&
          n.levelScore === h.levelScore &&
          n.goal === h.goal &&
          n.arrowsLeft === h.arrowsLeft &&
          n.combo === h.combo &&
          Math.abs(n.wind - h.wind) < 1 &&
          n.best === h.best
          ? h
          : n;
      });

      draw(w);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(rafRef.current);
      if (nextLevelTimerRef.current !== null) {
        window.clearTimeout(nextLevelTimerRef.current);
      }
    };
  }, [playEvent]);

  /* ── 拖弓交互 ─────────────────────────────────────────── */
  const canvasPos = useCallback((ev: React.PointerEvent | PointerEvent): { x: number; y: number } => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: ((ev.clientX - rect.left) / rect.width) * W,
      y: ((ev.clientY - rect.top) / rect.height) * H,
    };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const w = worldRef.current;
      if (w.phase !== "flying") return;
      e.preventDefault();
      draggingRef.current = true;
      pointerRef.current = canvasPos(e);
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [canvasPos],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!draggingRef.current) return;
      pointerRef.current = canvasPos(e);
      const w = worldRef.current;
      const launch = computeLaunch(ARC.ARCHER, pointerRef.current);
      previewRef.current = previewPath(w, launch);
      force();
    },
    [canvasPos],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      const w = worldRef.current;
      const launch = computeLaunch(ARC.ARCHER, pointerRef.current);
      const power = Math.hypot(launch.vx, launch.vy);
      if (power < ARC.minPower + 20) {
        // 拖得太近视为取消
        previewRef.current = null;
        force();
        return;
      }
      startShot(w, launch);
      previewRef.current = null;
      force();
    },
    [],
  );

  const start = useCallback(() => {
    const w = worldRef.current;
    if (w.phase === "idle") {
      w.phase = "flying";
    } else if (w.phase === "over" || w.phase === "won") {
      // 「再来一局」：失败/通关后重开全新第一关，避免带着 0 箭的空世界继续
      worldRef.current = createWorld(1);
      worldRef.current.phase = "flying";
    } else {
      return;
    }
    fxRef.current = [];
    setRecorded(false);
    setHud(snapshot(worldRef.current));
  }, []);

  const restart = useCallback(() => {
    worldRef.current = createWorld(1);
    fxRef.current = [];
    setRecorded(false);
    setHud(snapshot(worldRef.current));
  }, []);

  const nextLevel = useCallback(() => {
    const w = worldRef.current;
    if (w.phase !== "levelup") return;
    worldRef.current = advanceLevel(w);
    fxRef.current = [];
    setHud(snapshot(worldRef.current));
  }, []);

  /* ── 绘制 ─────────────────────────────────────────────── */
  const draw = useCallback((w: World): void => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.save();
    // 震屏
    const shake = shakeRef.current;
    if (shake.mag > 0 && shake.t < 350) {
      const k = Math.max(0, 1 - shake.t / 350);
      ctx.translate(
        (Math.random() - 0.5) * shake.mag * k * 2,
        (Math.random() - 0.5) * shake.mag * k * 2,
      );
    }

    /* 天空 */
    const sky = ctx.createLinearGradient(0, 0, 0, G);
    sky.addColorStop(0, "#b8e0ff");
    sky.addColorStop(0.62, "#e8f6ff");
    sky.addColorStop(1, "#fdf6e3");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    /* 太阳 + 云 */
    ctx.fillStyle = "rgba(255,210,110,0.95)";
    ctx.beginPath();
    ctx.arc(700, 54, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    for (const cx of [140, 260, 470]) {
      const ox = (w.time / 6000) * 18;
      const px = ((cx + ox) % (W + 120)) - 60;
      ctx.beginPath();
      ctx.ellipse(px, 86, 42, 14, 0, 0, Math.PI * 2);
      ctx.ellipse(px + 24, 78, 30, 12, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    /* 远山 */
    ctx.fillStyle = "#cfe3c0";
    ctx.beginPath();
    ctx.moveTo(0, G);
    ctx.quadraticCurveTo(150, G - 60, 300, G);
    ctx.quadraticCurveTo(430, G - 88, 560, G);
    ctx.quadraticCurveTo(660, G - 46, W, G);
    ctx.lineTo(W, G);
    ctx.lineTo(0, G);
    ctx.fill();

    /* 地面 */
    const grass = ctx.createLinearGradient(0, G, 0, H);
    grass.addColorStop(0, "#7ec850");
    grass.addColorStop(1, "#4e9331");
    ctx.fillStyle = grass;
    ctx.fillRect(0, G, W, H - G);
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(0, G, W, 3);

    drawWind(ctx, w);
    drawObstacles(ctx, w);
    drawTargets(ctx, w);
    drawStuckArrows(ctx, w);
    drawArcher(ctx, w);
    drawFlyingArrows(ctx, w);
    drawPreview(ctx, w);

    /* 特效（粒子 + 飘字） */
    const now = performance.now();
    fxRef.current = fxRef.current.filter((f) => now - f.born < f.life);
    for (const f of fxRef.current) {
      const k = (now - f.born) / f.life;
      ctx.globalAlpha = 1 - k * k;
      ctx.fillStyle = f.color;
      ctx.font = "800 17px -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(f.text, f.x, f.y - 26 * k);
    }
    ctx.globalAlpha = 1;

    ctx.restore();

    // 拖弓时信息提示
    if (draggingRef.current && previewRef.current) {
      const launch = computeLaunch(ARC.ARCHER, pointerRef.current);
      const power = Math.hypot(launch.vx, launch.vy);
      const pct = Math.round(((power - ARC.minPower) / (ARC.maxPower - ARC.minPower)) * 100);
      ctx.fillStyle = "rgba(20,30,40,0.75)";
      roundRect(ctx, W / 2 - 74, 12, 148, 26, 13);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "700 13px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`蓄力 ${pct}%`, W / 2, 30);
    }
  }, []);

  /* 风力旗 */
  function drawWind(ctx: CanvasRenderingContext2D, w: World): void {
    const strong = Math.abs(w.wind) / w.windMax;
    const dir = w.wind >= 0 ? 1 : -1;
    ctx.save();
    ctx.translate(W / 2, 30);
    ctx.fillStyle = "rgba(30,45,60,0.7)";
    roundRect(ctx, -84, -15, 168, 30, 15);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "700 12px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("风", -62, 5);
    // 旗杆与旗
    const n = 3;
    for (let i = 0; i < n; i++) {
      const bx = -30 + i * 22;
      ctx.strokeStyle = "#d8e2ea";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(bx, 6);
      ctx.lineTo(bx, -2);
      ctx.stroke();
      ctx.fillStyle =
        i < Math.round(strong * n) ? (strong > 0.66 ? "#ff8a4c" : "#ffd34d") : "rgba(255,255,255,0.22)";
      ctx.beginPath();
      ctx.moveTo(bx + dir * (i + 1) * 6, -2);
      ctx.lineTo(bx, -8);
      ctx.lineTo(bx, 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "700 12px -apple-system, sans-serif";
    ctx.fillText(`${dir > 0 ? "→" : "←"} ${Math.round(Math.abs(w.wind))}`, 30, 5);
    ctx.restore();
  }

  /* 障碍 */
  function drawObstacles(ctx: CanvasRenderingContext2D, w: World): void {
    for (const o of w.obstacles) {
      if (!o.alive) continue;
      if (o.kind === "brick") {
        ctx.fillStyle = "#b96a4a";
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.strokeStyle = "rgba(90,45,25,0.55)";
        ctx.lineWidth = 1;
        const rows = Math.floor(o.h / 14);
        for (let r = 0; r < rows; r++) {
          ctx.strokeRect(o.x + 0.5, o.y + r * 14 + 0.5, o.w - 1, 14);
          if (r % 2 === 0) ctx.beginPath(); // 错缝
        }
        ctx.fillStyle = "rgba(255,255,255,0.18)";
        ctx.fillRect(o.x + 1, o.y + 1, o.w - 2, 6);
      } else if (o.kind === "ice") {
        ctx.fillStyle = "rgba(190,235,255,0.72)";
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.strokeStyle = "rgba(90,170,220,0.9)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(o.x + 0.75, o.y + 0.75, o.w - 1.5, o.h - 1.5);
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.fillRect(o.x + 2, o.y + 3, 3, o.h - 6);
      } else if (o.kind === "crate") {
        ctx.fillStyle = "#c98a4b";
        ctx.fillRect(o.x, o.y, o.w, o.h);
        ctx.strokeStyle = "rgba(90,55,20,0.6)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(o.x + 1, o.y + 1, o.w - 2, o.h - 2);
        ctx.beginPath();
        ctx.moveTo(o.x, o.y);
        ctx.lineTo(o.x + o.w, o.y + o.h);
        ctx.moveTo(o.x + o.w, o.y);
        ctx.lineTo(o.x, o.y + o.h);
        ctx.stroke();
        ctx.fillStyle = "rgba(90,55,20,0.25)";
        ctx.fillRect(o.x + 1, o.y + 1, o.w - 2, 5);
      } else if (o.kind === "barrel") {
        const cx = o.x + o.w / 2;
        const cy = o.y + o.h / 2;
        ctx.fillStyle = "#d64545";
        ctx.beginPath();
        ctx.ellipse(cx, cy, 13, 13, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#a02828";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = "#f2b033";
        ctx.fillRect(cx - 11, cy - 4, 22, 4);
        ctx.fillRect(cx - 11, cy + 1, 22, 4);
        ctx.fillStyle = "#fff";
        ctx.font = "900 11px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("!", cx, cy + 4);
      }
    }
  }

  /* 靶 */
  function drawTargets(ctx: CanvasRenderingContext2D, w: World): void {
    for (const t of w.targets) {
      if (!t.alive) continue;
      if (t.kind === "bullseye") {
        // 支架
        ctx.strokeStyle = "rgba(90,70,40,0.5)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(t.x, t.y + 34);
        ctx.lineTo(t.x, G);
        ctx.moveTo(t.x - 14, G);
        ctx.lineTo(t.x + 14, G);
        ctx.stroke();
        const rings: [number, string][] = [
          [ARC.ringRadii[4], "#f5f2ea"],
          [ARC.ringRadii[3], "#e0d8c8"],
          [ARC.ringRadii[2], "#3f6aa8"],
          [ARC.ringRadii[1], "#d64545"],
          [ARC.ringRadii[0], "#f2b033"],
        ];
        for (const [r, c] of rings) {
          ctx.fillStyle = c;
          ctx.beginPath();
          ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.strokeStyle = "rgba(0,0,0,0.25)";
        ctx.lineWidth = 1;
        for (const [r] of rings.slice(0, 4)) {
          ctx.beginPath();
          ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else {
        // 苹果头靶：威廉·泰尔
        // 苹果
        ctx.fillStyle = "#e03e32";
        ctx.beginPath();
        ctx.arc(t.x, t.y - 30, ARC.appleR, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.beginPath();
        ctx.arc(t.x - 2.5, t.y - 33, 2.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "#7a4a20";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(t.x, t.y - 38);
        ctx.lineTo(t.x + 1.5, t.y - 41);
        ctx.stroke();
        // 头部
        ctx.fillStyle = "#f6c98b";
        ctx.beginPath();
        ctx.arc(t.x, t.y - 16, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#3a2c1c";
        ctx.beginPath();
        ctx.arc(t.x - 3.2, t.y - 17, 1.3, 0, Math.PI * 2);
        ctx.arc(t.x + 3.2, t.y - 17, 1.3, 0, Math.PI * 2);
        ctx.fill();
        // 身体
        ctx.fillStyle = "#4a78c9";
        roundRect(ctx, t.x - 12, t.y - 4, 24, 34, 9);
        ctx.fill();
        ctx.strokeStyle = "#2f4f8f";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(t.x, t.y + 14);
        ctx.lineTo(t.x, t.y + 30);
        ctx.moveTo(t.x, t.y + 30);
        ctx.lineTo(t.x - 9, t.y + 33);
        ctx.moveTo(t.x, t.y + 30);
        ctx.lineTo(t.x + 9, t.y + 33);
        ctx.stroke();
      }
    }
  }

  /* 钉住的箭 */
  function drawStuckArrows(ctx: CanvasRenderingContext2D, w: World): void {
    for (const a of w.arrows) {
      if (!a.stuck || a.removed) continue;
      drawArrowShape(ctx, a.x, a.y, a.rot, "#8a5a2b", 0.85);
    }
  }

  /* 飞行中的箭 + 尾迹 */
  function drawFlyingArrows(ctx: CanvasRenderingContext2D, w: World): void {
    for (const a of w.arrows) {
      if (a.stuck || a.removed) continue;
      // 尾迹
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      const tx = a.x - Math.cos(a.rot) * 26;
      const ty = a.y - Math.sin(a.rot) * 26;
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      drawArrowShape(ctx, a.x, a.y, a.rot, "#f0e4c8", 1);
    }
  }

  function drawArrowShape(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    rot: number,
    color: string,
    alpha: number,
  ): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(-18, 0);
    ctx.lineTo(10, 0);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(16, 0);
    ctx.lineTo(7, -4);
    ctx.lineTo(7, 4);
    ctx.closePath();
    ctx.fill();
    // 尾羽
    ctx.strokeStyle = "rgba(230,120,80,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-18, 0);
    ctx.lineTo(-24, -4);
    ctx.moveTo(-18, 0);
    ctx.lineTo(-24, 4);
    ctx.stroke();
    ctx.restore();
  }

  /* 弓手 */
  function drawArcher(ctx: CanvasRenderingContext2D, w: World): void {
    const ax = ARC.ARCHER.x;
    const ay = ARC.ARCHER.y;
    // 拖弓时弓指向发射方向（与蓄力相反）
    let aim = 0.1;
    if (draggingRef.current) {
      const p = pointerRef.current;
      aim = Math.atan2(ay - p.y, ax - p.x);
    }
    const pull = draggingRef.current
      ? Math.min(1, Math.hypot(pointerRef.current.x - ax, pointerRef.current.y - ay) / ARC.dragMax)
      : 0;

    // 弓
    ctx.save();
    ctx.translate(ax, ay);
    ctx.rotate(aim);
    ctx.strokeStyle = "#7a4a20";
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.arc(0, 0, 26, -Math.PI / 2.1, Math.PI / 2.1);
    ctx.stroke();
    // 弦（蓄力时被拉直，箭头在弓上）
    const bend = 26 * (1 - pull * 0.86);
    ctx.strokeStyle = "#e8e0d0";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, -19);
    ctx.lineTo(14, -bend + 5);
    ctx.lineTo(0, 19);
    ctx.stroke();
    if (draggingRef.current && pull > 0.02) {
      ctx.strokeStyle = "#f0e4c8";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(20, -5);
      ctx.lineTo(8, -bend + 5 + pull * 14);
      ctx.stroke();
    }
    ctx.restore();

    // 人
    ctx.fillStyle = "#3f6aa8";
    roundRect(ctx, ax - 7, ay - 12, 14, 26, 6);
    ctx.fill();
    ctx.fillStyle = "#f6c98b";
    ctx.beginPath();
    ctx.arc(ax, ay - 19, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#3a2c1c";
    ctx.beginPath();
    ctx.arc(ax - 3, ay - 20, 1.2, 0, Math.PI * 2);
    ctx.arc(ax + 3, ay - 20, 1.2, 0, Math.PI * 2);
    ctx.fill();
    // 箭袋
    ctx.fillStyle = "#a06030";
    roundRect(ctx, ax - 11, ay - 6, 6, 18, 3);
    ctx.fill();
    ctx.strokeStyle = "#d8c8a8";
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 2; i++) {
      ctx.beginPath();
      ctx.moveTo(ax - 10, ay - 5 + i * 8);
      ctx.lineTo(ax - 4, ay - 5 + i * 8);
      ctx.stroke();
    }
  }

  /* 弹道预览 */
  function drawPreview(ctx: CanvasRenderingContext2D, w: World): void {
    const pts = previewRef.current;
    if (!pts || pts.length < 2) return;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  const phase = hud.phase;
  const t = i18n.text;

  return (
    <GameFrame
      emoji="🏹"
      title={t("game.archery.title")}
      stats={[
        { label: t("game.archery.score"), value: hud.score, colors: CHIP_GOLD },
        {
          label: `${t("game.archery.level")} ${hud.level} · ${t("game.archery.goal")}`,
          value: `${hud.levelScore}/${hud.goal}`,
          colors: CHIP_BLUE,
        },
        { label: t("game.archery.arrows"), value: hud.arrowsLeft, colors: CHIP_GREEN },
        { label: t("game.archery.combo"), value: hud.combo > 0 ? `×${hud.combo}` : "—", colors: CHIP_PURPLE },
        { label: t("game.archery.best"), value: hud.best, colors: CHIP_RED },
      ]}
      headerExtra={
        phase === "levelup" ? (
          <PrimaryBtn onClick={nextLevel}>{t("game.archery.nextLevel")}</PrimaryBtn>
        ) : (
          <GhostBtn onClick={phase === "idle" || phase === "over" || phase === "won" ? start : restart}>
            {phase === "idle"
              ? t("game.archery.start")
              : phase === "over" || phase === "won"
                ? t("game.archery.again")
                : t("game.archery.restart")}
          </GhostBtn>
        )
      }
      help={t("game.archery.help")}
      maxWidth={820}
    >
      <div style={{ position: "relative", width: W, maxWidth: "100%" }}>
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => {
            if (draggingRef.current) {
              draggingRef.current = false;
              previewRef.current = null;
              force();
            }
          }}
          style={{
            width: "100%",
            height: "auto",
            display: "block",
            borderRadius: 14,
            cursor: "crosshair",
            touchAction: "none",
            boxShadow: "0 10px 30px rgba(5,8,20,0.35)",
            userSelect: "none",
          }}
        />

        {/* 开始覆盖层 */}
        {phase === "idle" && (
          <div
            className="gs-pulse"
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 14,
              background: "rgba(20,40,60,0.55)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              color: "#fff",
              textAlign: "center",
              zIndex: 3,
              pointerEvents: "none",
            }}
          >
            <div style={{ fontSize: 30, fontWeight: 900 }}>🏹</div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{t("game.archery.idleTitle")}</div>
            <div style={{ fontSize: 13, opacity: 0.92, maxWidth: 520, lineHeight: 1.7, padding: "0 16px" }}>
              {t("game.archery.idleDesc")}
            </div>
            <div style={{ pointerEvents: "auto", marginTop: 6 }}>
              <PrimaryBtn onClick={start}>{t("game.archery.start")}</PrimaryBtn>
            </div>
          </div>
        )}

        {/* 过关覆盖层 */}
        {phase === "levelup" && (
          <div
            className="gs-pop"
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 14,
              background: "rgba(10,40,20,0.6)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              color: "#eaffdc",
              textAlign: "center",
              zIndex: 3,
              pointerEvents: "none",
            }}
          >
            <div style={{ fontSize: 26, fontWeight: 900 }}>
              {t("game.archery.levelUpTitle", { level: hud.level })}
            </div>
            <div style={{ fontSize: 14, opacity: 0.92 }}>{t("game.archery.levelUpSub")}</div>
            <div style={{ pointerEvents: "auto", marginTop: 6 }}>
              <PrimaryBtn onClick={nextLevel}>{t("game.archery.nextLevel")}</PrimaryBtn>
            </div>
          </div>
        )}

        {/* 结算覆盖层 */}
        {(phase === "over" || phase === "won") && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 14,
              background:
                phase === "won"
                  ? "rgba(60,20,4,0.62)"
                  : "rgba(30,6,12,0.62)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              color: "#fff",
              textAlign: "center",
              zIndex: 3,
              pointerEvents: "none",
            }}
          >
            <div style={{ fontSize: 30, fontWeight: 900 }}>
              {phase === "won" ? "🏆" : "😵"}
            </div>
            <div style={{ fontSize: 24, fontWeight: 900 }}>
              {phase === "won" ? t("game.archery.wonTitle") : t("game.archery.overTitle")}
            </div>
            <div style={{ fontSize: 14, opacity: 0.92 }}>
              {phase === "won" ? t("game.archery.wonSub") : t("game.archery.overSub")}
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>
              {t("game.archery.stats", {
                score: hud.score,
                level: hud.level,
              })}
            </div>
            {hud.best > 0 && (
              <div style={{ fontSize: 13, opacity: 0.85 }}>
                {t("game.archery.bestLine", { best: hud.best })}
              </div>
            )}
            <div style={{ pointerEvents: "auto", marginTop: 8, display: "flex", gap: 10 }}>
              <PrimaryBtn onClick={start}>{t("game.archery.again")}</PrimaryBtn>
              <GhostBtn onClick={restart}>{t("game.archery.restart")}</GhostBtn>
            </div>
          </div>
        )}
      </div>
    </GameFrame>
  );
};

export default ArcheryGame;
