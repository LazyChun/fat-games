/*
 * HawkChickenGame：老鹰抓小鸡
 *
 * Canvas 实现：玩家操控母鸡保护身后的小鸡队列，老鹰从天空俯冲抓队尾小鸡；
 * 母鸡撞到老鹰可将其啄晕、救回被抓的小鸡；金蛋可补充小鸡。
 * 坚持 60 秒且仍有小鸡存活获胜；小鸡被抓光则失败，游戏结束记录成绩。
 * 操作：方向键 / WASD 或鼠标移动母鸡；空格 开始/暂停；P 暂停。
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
} from "./GameFrame";
import { sfxHit, sfxHurt, sfxEat, sfxCoin, sfxScore, sfxWin, sfxLose } from "./sound";
import {
  W,
  H,
  HEN_R,
  CHICK_R,
  EAGLE_R,
  newSim,
  stepSim,
  type HawkSim,
  type HawkEvent,
} from "./hawkLogic";
import "./gameAnimations.less";

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
  life: number;
  maxLife: number;
  color: string;
}

interface UiState {
  score: number;
  time: number;
  chicks: number;
  caught: number;
  rescued: number;
  running: boolean;
  over: boolean;
  won: boolean;
}

/* ------------------------------------------------------------------ */
/* 绘制辅助                                                             */
/* ------------------------------------------------------------------ */

function drawBackground(ctx: CanvasRenderingContext2D, ts: number): void {
  // 天空
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#7dbdf0");
  sky.addColorStop(0.55, "#c3e4fb");
  sky.addColorStop(1, "#eaf7ff");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  // 太阳
  ctx.fillStyle = "rgba(255,214,102,0.35)";
  ctx.beginPath();
  ctx.arc(58, 52, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffd766";
  ctx.beginPath();
  ctx.arc(58, 52, 21, 0, Math.PI * 2);
  ctx.fill();

  // 云朵
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  const clouds = [
    [180, 60, 26, 0.9],
    [330, 92, 20, 1.3],
    [100, 118, 18, 0.6],
  ] as const;
  for (const [cx, cy, cr, drift] of clouds) {
    const ox = Math.sin(ts / 3000 + cx) * 6;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.arc(cx + ox, cy, cr, 0, Math.PI * 2);
    ctx.arc(cx + ox + cr * 1.2, cy + 4, cr * 0.8, 0, Math.PI * 2);
    ctx.arc(cx + ox - cr * 1.2, cy + 5, cr * 0.75, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = drift * 0.5 + 0.3;
    ctx.beginPath();
    ctx.arc(cx + ox, cy + 12, cr * 1.15, 0, Math.PI * 2);
    ctx.arc(cx + ox + cr * 1.3, cy + 12, cr * 0.9, 0, Math.PI * 2);
    ctx.arc(cx + ox - cr * 1.3, cy + 12, cr * 0.85, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // 草地
  const grass = ctx.createLinearGradient(0, H - 260, 0, H);
  grass.addColorStop(0, "#8ed081");
  grass.addColorStop(1, "#57a84f");
  ctx.fillStyle = grass;
  ctx.fillRect(0, H - 260, W, 260);
  // 草地顶部柔化
  ctx.fillStyle = "rgba(255,255,255,0.14)";
  ctx.fillRect(0, H - 260, W, 12);

  // 草丛与小花
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  for (const [fx, fy] of [
    [60, H - 150],
    [150, H - 98],
    [240, H - 176],
    [330, H - 108],
    [420, H - 166],
  ] as const) {
    ctx.beginPath();
    ctx.arc(fx, fy, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(fx + 7, fy - 3, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(255,220,120,0.7)";
  for (const [fx, fy] of [
    [100, H - 132],
    [200, H - 158],
    [370, H - 130],
  ] as const) {
    ctx.beginPath();
    ctx.arc(fx, fy, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHen(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  facing: number,
  ts: number,
): void {
  const flap = Math.sin(ts / 90) * 0.2;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing, 1);

  // 尾巴
  ctx.fillStyle = "#f2e2cc";
  ctx.beginPath();
  ctx.moveTo(-14, -6);
  ctx.quadraticCurveTo(-30, -14, -27, 0);
  ctx.quadraticCurveTo(-24, 10, -13, 8);
  ctx.closePath();
  ctx.fill();

  // 身体
  ctx.fillStyle = "#fff7ec";
  ctx.beginPath();
  ctx.ellipse(0, 0, 23, 16, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.14)";
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // 翅膀
  ctx.fillStyle = "#f8e5c2";
  ctx.beginPath();
  ctx.ellipse(0, 5 + flap * 2, 14, 9, flap, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 头
  ctx.fillStyle = "#fff7ec";
  ctx.beginPath();
  ctx.arc(17, -12, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 鸡冠（三个小红三角）
  ctx.fillStyle = "#ef4444";
  for (const [hx, hy] of [
    [12, -20],
    [17, -23],
    [22, -20],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(hx - 3, hy);
    ctx.lineTo(hx, hy - 6.5);
    ctx.lineTo(hx + 3, hy);
    ctx.closePath();
    ctx.fill();
  }

  // 喙
  ctx.fillStyle = "#f59e0b";
  ctx.beginPath();
  ctx.moveTo(25, -13);
  ctx.lineTo(33, -11);
  ctx.lineTo(25, -8);
  ctx.closePath();
  ctx.fill();

  // 眼睛
  ctx.fillStyle = "#333";
  ctx.beginPath();
  ctx.arc(21, -14, 1.8, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawChick(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ts: number,
  idx: number,
): void {
  const bob = Math.sin(ts / 110 + idx * 0.9) * 1.4;
  ctx.save();
  ctx.translate(x, y + bob);

  // 身体
  ctx.fillStyle = "#ffd94a";
  ctx.beginPath();
  ctx.arc(0, 0, CHICK_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // 翅膀
  ctx.fillStyle = "#ffcf6b";
  ctx.beginPath();
  ctx.ellipse(1.5, 3.5, 6, 4, -0.4, 0, Math.PI * 2);
  ctx.fill();

  // 头顶绒毛
  ctx.fillStyle = "#ffcf6b";
  ctx.beginPath();
  ctx.arc(-3, -8, 2.4, 0, Math.PI * 2);
  ctx.fill();

  // 喙
  ctx.fillStyle = "#f97316";
  ctx.beginPath();
  ctx.moveTo(6.5, -2);
  ctx.lineTo(11.5, -1);
  ctx.lineTo(6.5, 1);
  ctx.closePath();
  ctx.fill();

  // 眼睛
  ctx.fillStyle = "#333";
  ctx.beginPath();
  ctx.arc(4.5, -4, 1.7, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawEagle(
  ctx: CanvasRenderingContext2D,
  e: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    phase: number;
    state: string;
    carryChick: boolean;
  },
  ts: number,
): void {
  const stunned = e.state === "stun";
  const flap = Math.sin(e.phase) * (stunned ? 0.12 : 0.55);
  const ang = stunned
    ? Math.sin(e.phase * 2) * 0.18
    : Math.atan2(e.vy, e.vx);
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.rotate(ang);

  // 尾羽
  ctx.fillStyle = "#7a5834";
  ctx.beginPath();
  ctx.moveTo(-16, -4);
  ctx.lineTo(-30, -8);
  ctx.lineTo(-28, -1);
  ctx.lineTo(-16, 4);
  ctx.closePath();
  ctx.fill();

  // 身体
  ctx.fillStyle = "#8a6239";
  ctx.beginPath();
  ctx.ellipse(0, 0, 22, 12.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 1.3;
  ctx.stroke();

  // 展开的翅膀（上下两片）
  ctx.fillStyle = "#6b4826";
  ctx.beginPath();
  ctx.moveTo(-4, -4);
  ctx.quadraticCurveTo(-12, -18 - flap * 10, -30, -16 - flap * 12);
  ctx.quadraticCurveTo(-16, -2, -6, 2);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-4, 4);
  ctx.quadraticCurveTo(-12, 18 + flap * 10, -30, 16 + flap * 12);
  ctx.quadraticCurveTo(-16, 2, -6, -2);
  ctx.closePath();
  ctx.fill();

  // 头
  ctx.fillStyle = "#8a6239";
  ctx.beginPath();
  ctx.arc(19, -6, 8.5, 0, Math.PI * 2);
  ctx.fill();

  // 钩喙
  ctx.fillStyle = "#f59e0b";
  ctx.beginPath();
  ctx.moveTo(26, -8);
  ctx.quadraticCurveTo(33, -6, 27, -2);
  ctx.closePath();
  ctx.fill();

  // 眼睛（晕眩时画圈圈）
  if (stunned) {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(20, -7, 2.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(18.6, -8.4);
    ctx.lineTo(21.4, -5.6);
    ctx.moveTo(21.4, -8.4);
    ctx.lineTo(18.6, -5.6);
    ctx.stroke();
  } else {
    ctx.fillStyle = "#3b2410";
    ctx.beginPath();
    ctx.arc(20, -7, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(20.8, -7.8, 0.7, 0, Math.PI * 2);
    ctx.fill();
  }

  // 叼着的小鸡
  if (e.carryChick && !stunned) {
    ctx.fillStyle = "#ffd94a";
    ctx.beginPath();
    ctx.arc(27, 2, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.15)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#f97316";
    ctx.beginPath();
    ctx.moveTo(32, 1);
    ctx.lineTo(35.5, 2.2);
    ctx.lineTo(32, 3.4);
    ctx.closePath();
    ctx.fill();
  }

  // 晕眩星
  if (stunned) {
    ctx.fillStyle = "#ffe15e";
    ctx.beginPath();
    ctx.arc(-18, -14 + Math.sin(ts / 120) * 2, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-12, -18 + Math.cos(ts / 130) * 2, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawEgg(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ts: number,
): void {
  const wob = Math.sin(ts / 200 + x) * 0.12;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(wob);
  ctx.fillStyle = "#fbbf24";
  ctx.beginPath();
  ctx.ellipse(0, 0, 8, 10.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  ctx.beginPath();
  ctx.ellipse(-2.5, -3.5, 2.4, 3.4, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* 组件                                                               */
/* ------------------------------------------------------------------ */

const HawkChickenGame: React.FC<{ sdk: FatNotesPluginSDK }> = () => {
  const i18n = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<HawkSim>(newSim());
  const keysRef = useRef<Set<string>>(new Set());
  const mouseRef = useRef({ x: 0, y: 0, active: false });
  const partsRef = useRef<Particle[]>([]);
  const floatsRef = useRef<FloatText[]>([]);
  const lastTsRef = useRef(0);

  const lastUiRef = useRef<UiState>({
    score: 0,
    time: 0,
    chicks: 6,
    caught: 0,
    rescued: 0,
    running: false,
    over: false,
    won: false,
  });
  const [ui, setUi] = useState<UiState>(lastUiRef.current);

  const syncUi = (s: HawkSim) => {
    const next: UiState = {
      score: Math.floor(s.score),
      time: s.time,
      chicks: s.chicks.length,
      caught: s.caught,
      rescued: s.rescued,
      running: s.running,
      over: s.over,
      won: s.won,
    };
    const prev = lastUiRef.current;
    if (
      next.score !== prev.score ||
      next.time !== prev.time ||
      next.chicks !== prev.chicks ||
      next.caught !== prev.caught ||
      next.rescued !== prev.rescued ||
      next.running !== prev.running ||
      next.over !== prev.over ||
      next.won !== prev.won
    ) {
      lastUiRef.current = next;
      setUi(next);
    }
  };

  const restart = useCallback(() => {
    simRef.current = newSim();
    partsRef.current = [];
    floatsRef.current = [];
    lastUiRef.current = {
      score: 0,
      time: 0,
      chicks: 6,
      caught: 0,
      rescued: 0,
      running: false,
      over: false,
      won: false,
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

  const spawnParts = useCallback(
    (x: number, y: number, n: number, colors: string[]) => {
      const parts = partsRef.current;
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const spd = 40 + Math.random() * 130;
        parts.push({
          x,
          y,
          vx: Math.cos(a) * spd,
          vy: Math.sin(a) * spd - 40,
          life: 0.5 + Math.random() * 0.35,
          maxLife: 0.85,
          r: 1.8 + Math.random() * 2.2,
          color: colors[Math.floor(Math.random() * colors.length)],
        });
      }
    },
    [],
  );

  const addFloat = useCallback(
    (x: number, y: number, text: string, color = "#ffe15e") => {
      floatsRef.current.push({ x, y, text, life: 0.9, maxLife: 0.9, color });
    },
    [],
  );

  const handleEvents = useCallback(
    (s: HawkSim, events: HawkEvent[]) => {
      for (const ev of events) {
        switch (ev.type) {
          case "stun":
            sfxHit();
            spawnParts(ev.x, ev.y, 6, ["#8a6239", "#6b4826", "#f5d9a8"]);
            break;
          case "rescue":
            sfxScore();
            spawnParts(ev.x, ev.y, 10, ["#ffd94a", "#ffffff", "#fff7ec"]);
            addFloat(
              ev.x,
              ev.y - 18,
              i18n.text("game.hawk.rescue", { points: ev.points }),
            );
            break;
          case "catch":
            sfxHurt();
            spawnParts(ev.x, ev.y, 10, ["#ffd94a", "#ffcf6b", "#ffffff"]);
            break;
          case "egg":
            sfxEat();
            spawnParts(ev.x, ev.y, 8, ["#fbbf24", "#ffd94a", "#fff"]);
            addFloat(
              ev.x,
              ev.y - 16,
              i18n.text("game.hawk.egg", { points: ev.points }),
              "#fbbf24",
            );
            break;
          case "eggFull":
            sfxCoin();
            addFloat(
              ev.x,
              ev.y - 16,
              i18n.text("game.hawk.eggFull", { points: ev.points }),
              "#fbbf24",
            );
            break;
          case "win":
            sfxWin();
            break;
          case "lose":
            sfxLose();
            break;
        }
      }
    },
    [i18n, spawnParts, addFloat],
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
        const keys = keysRef.current;
        let dx = 0;
        let dy = 0;
        if (keys.has("arrowleft") || keys.has("a")) dx -= 1;
        if (keys.has("arrowright") || keys.has("d")) dx += 1;
        if (keys.has("arrowup") || keys.has("w")) dy -= 1;
        if (keys.has("arrowdown") || keys.has("s")) dy += 1;
        if (dx === 0 && dy === 0 && mouseRef.current.active) {
          const m = mouseRef.current;
          const rx = m.x - s.hen.x;
          const ry = m.y - s.hen.y;
          const d = Math.hypot(rx, ry);
          if (d > 14) {
            dx = rx / d;
            dy = ry / d;
          }
        }
        const events = stepSim(s, dt, { dx, dy });
        handleEvents(s, events);
        if (s.over && !s.recorded) {
          s.recorded = true;
          recordScore({
            gameId: "hawk",
            gameTitle: "老鹰抓小鸡",
            score: Math.floor(s.score),
            detail: {
              seconds: Math.floor(s.time),
              caught: s.caught,
              rescued: s.rescued,
              chicksLeft: s.chicks.length,
              won: s.won,
            },
          });
        }
      }

      // 粒子 / 浮字
      const parts = partsRef.current;
      for (const p of parts) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 320 * dt;
        p.life -= dt;
      }
      partsRef.current = parts.filter((p) => p.life > 0);
      const floats = floatsRef.current;
      for (const f of floats) {
        f.y -= 32 * dt;
        f.life -= dt;
      }
      floatsRef.current = floats.filter((f) => f.life > 0);

      // 渲染
      drawBackground(ctx, ts);
      for (const egg of s.eggs) drawEgg(ctx, egg.x, egg.y, ts);
      for (const e of s.eagles) drawEagle(ctx, e, ts);
      if (!s.over) {
        drawHen(ctx, s.hen.x, s.hen.y, s.facing, ts);
      }
      for (let i = 0; i < s.chicks.length; i++) {
        drawChick(ctx, s.chicks[i].x, s.chicks[i].y, ts, i);
      }
      for (const p of parts) {
        const a = Math.max(0, p.life / p.maxLife);
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = "center";
      ctx.font = "bold 15px sans-serif";
      for (const f of floats) {
        const a = Math.max(0, f.life / f.maxLife);
        ctx.globalAlpha = a;
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, f.x, f.y);
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = "start";

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
        startPause();
        return;
      }
      if (k === "p") {
        const s = simRef.current;
        if (!s.over) s.running = !s.running;
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
  }, [startPause]);

  const toCanvasPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scale = W / rect.width;
    mouseRef.current = {
      x: (e.clientX - rect.left) * scale,
      y: (e.clientY - rect.top) * scale,
      active: true,
    };
  };

  return (
    <GameFrame
      emoji="🐔"
      title={i18n.text("game.hawk.title")}
      stats={[
        {
          label: i18n.text("game.hawk.score"),
          value: ui.score,
          colors: CHIP_GOLD,
        },
        {
          label: i18n.text("game.hawk.time"),
          value: `${Math.floor(ui.time)}s`,
          colors: CHIP_BLUE,
        },
        {
          label: i18n.text("game.hawk.chicks"),
          value: ui.chicks,
          colors: CHIP_GREEN,
        },
        {
          label: i18n.text("game.hawk.caught"),
          value: ui.caught,
          colors: CHIP_RED,
        },
      ]}
      headerExtra={
        <>
          <GhostBtn onClick={startPause} disabled={ui.over}>
            {ui.running ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
            {ui.running
              ? i18n.text("game.hawk.pause")
              : i18n.text("game.hawk.start")}
          </GhostBtn>
          <GhostBtn onClick={restart}>
            <ReloadOutlined />
            {i18n.text("game.hawk.restart")}
          </GhostBtn>
        </>
      }
      help={i18n.text("game.hawk.help")}
      maxWidth={540}
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
          onPointerMove={toCanvasPos}
          onPointerEnter={toCanvasPos}
          onPointerLeave={() => {
            mouseRef.current.active = false;
          }}
        />
        {ui.over && (
          <div
            className="gs-win-in"
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(20,40,25,0.78)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              alignItems: "center",
              justifyContent: "center",
              color: "#d8f5d8",
            }}
          >
            <div style={{ fontSize: 26, fontWeight: 900 }}>
              {ui.won
                ? `🎉 ${i18n.text("game.hawk.win")}`
                : `😢 ${i18n.text("game.hawk.lose")}`}
            </div>
            <div style={{ fontSize: 14, opacity: 0.92 }}>
              {ui.won
                ? i18n.text("game.hawk.winDetail", {
                    seconds: Math.floor(ui.time),
                    chicks: ui.chicks,
                  })
                : i18n.text("game.hawk.loseDetail", {
                    seconds: Math.floor(ui.time),
                    score: ui.score,
                    rescued: ui.rescued,
                  })}
            </div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {i18n.text("game.hawk.overScore", { score: ui.score })}
            </div>
            <GhostBtn onClick={restart}>
              <ReloadOutlined />
              {i18n.text("game.hawk.again")}
            </GhostBtn>
          </div>
        )}
        {!ui.running && !ui.over && (
          <div
            className="gs-pulse"
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(20,40,25,0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#eaffea",
              fontSize: 16,
              fontWeight: 700,
              pointerEvents: "none",
            }}
          >
            {i18n.text("game.hawk.idle")}
          </div>
        )}
      </div>
    </GameFrame>
  );
};

export default HawkChickenGame;
