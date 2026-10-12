/*
 * SnakeGame：贪吃蛇（视觉升级版）
 *
 * 20x20 网格 Canvas，方向键控制方向；吃到食物得分，撞墙或撞自己
 * 结束。蛇身越长速度越快。渲染升级：棋盘格背景、圆角渐变蛇身 +
 * 蛇眼、带辉光的食物、悬浮脉冲。游戏结束时记录成绩。
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { PauseCircleOutlined, PlayCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import { recordScore } from "../scoreClient";
import { useI18n } from "../hooks";
import GameFrame, { GhostBtn, CHIP_GREEN, CHIP_GOLD } from "./GameFrame";
import { sfxMove, sfxEat, sfxLose } from "./sound";
import "./gameAnimations.less";

const COLS = 20;
const ROWS = 20;
const CELL = 22; // px
const BASE_INTERVAL = 160; // ms / step
const MIN_INTERVAL = 70;

type Pt = { x: number; y: number };
type Dir = "up" | "down" | "left" | "right";

const DIR_DELTA: Record<Dir, Pt> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

function samePt(a: Pt, b: Pt): boolean {
  return a.x === b.x && a.y === b.y;
}

/** 随机生成一个不与蛇身重叠的食物坐标 */
function randomFood(snake: Pt[]): Pt {
  while (true) {
    const f = {
      x: Math.floor(Math.random() * COLS),
      y: Math.floor(Math.random() * ROWS),
    };
    if (!snake.some((s) => samePt(s, f))) return f;
  }
}

function initialSnake(): Pt[] {
  return [
    { x: 8, y: 10 },
    { x: 7, y: 10 },
    { x: 6, y: 10 },
  ];
}

/** 圆角矩形路径 */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** 蛇头眼睛：根据方向画两个眼睛 */
function drawEyes(
  ctx: CanvasRenderingContext2D,
  head: Pt,
  dir: Dir,
): void {
  const cx = head.x * CELL + CELL / 2;
  const cy = head.y * CELL + CELL / 2;
  // 朝向向量与垂直向量
  const dv: Pt = DIR_DELTA[dir];
  const perp: Pt = { x: -dv.y, y: dv.x }; // 顺时针垂直
  const eyeR = CELL * 0.16;
  const pupilR = eyeR * 0.5;
  const offset = CELL * 0.18; // 眼距中心距离
  const fwd = CELL * 0.16; // 眼睛前移量

  for (const s of [1, -1]) {
    const ex = cx + perp.x * offset * s + dv.x * fwd;
    const ey = cy + perp.y * offset * s + dv.y * fwd;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(ex, ey, eyeR, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#1d2b20";
    ctx.beginPath();
    ctx.arc(ex + dv.x * eyeR * 0.42, ey + dv.y * eyeR * 0.42, pupilR, 0, Math.PI * 2);
    ctx.fill();
  }
}

const SnakeGame: React.FC<{ sdk: FatNotesPluginSDK }> = () => {
  const i18n = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [snake, setSnake] = useState<Pt[]>(initialSnake);
  const [food, setFood] = useState<Pt>(() => randomFood(initialSnake()));
  const [dir, setDir] = useState<Dir>("right");
  const [score, setScore] = useState(0);
  const [running, setRunning] = useState(false);
  const [over, setOver] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [pulse, setPulse] = useState(0); // 食物脉冲动画

  // 把方向放入 ref，避免 useEffect 闭包旧值
  const dirRef = useRef(dir);
  dirRef.current = dir;

  /** 一步：移动 + 碰撞检测 */
  const step = useCallback(() => {
    setSnake((prev) => {
      const d = DIR_DELTA[dirRef.current];
      const head: Pt = { x: prev[0].x + d.x, y: prev[0].y + d.y };

      // 撞墙
      if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS) {
        setOver(true);
        setRunning(false);
        sfxLose();
        return prev;
      }
      // 撞自己（不包含尾部，因为尾部会移走）
      for (let i = 0; i < prev.length - 1; i++) {
        if (samePt(prev[i], head)) {
          setOver(true);
          setRunning(false);
          sfxLose();
          return prev;
        }
      }

      const next = [head, ...prev];
      if (samePt(head, food)) {
        // 吃到食物：尾部不移除
        setScore((s) => s + 1);
        setFood(randomFood(next));
        sfxEat();
      } else {
        next.pop();
      }
      return next;
    });
  }, [food]);

  // 游戏循环
  useEffect(() => {
    if (!running || over) return;
    // 蛇越长速度越快
    const interval = Math.max(MIN_INTERVAL, BASE_INTERVAL - snake.length * 4);
    const id = window.setInterval(step, interval);
    return () => window.clearInterval(id);
  }, [running, over, snake.length, step]);

  // 食物脉冲
  useEffect(() => {
    if (!running || over) return;
    const id = window.setInterval(() => setPulse((p) => p + 1), 120);
    return () => window.clearInterval(id);
  }, [running, over]);

  // 游戏结束时记录成绩
  useEffect(() => {
    if (over && !recorded) {
      setRecorded(true);
      recordScore({
        gameId: "snake",
        gameTitle: "贪吃蛇",
        score,
      });
    }
  }, [over, recorded, score]);

  // 绘制
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 棋盘格背景
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? "#eef3e9" : "#e3ebdc";
        ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
      }
    }

    // 柔和网格线
    ctx.strokeStyle = "rgba(80,110,70,0.10)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= COLS; x++) {
      ctx.beginPath();
      ctx.moveTo(x * CELL + 0.5, 0);
      ctx.lineTo(x * CELL + 0.5, ROWS * CELL);
      ctx.stroke();
    }
    for (let y = 0; y <= ROWS; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * CELL + 0.5);
      ctx.lineTo(COLS * CELL, y * CELL + 0.5);
      ctx.stroke();
    }

    // 食物：红苹果 + 辉光 + 白色高光
    const fc = food.x * CELL + CELL / 2;
    const fcy = food.y * CELL + CELL / 2;
    const foodR = CELL / 2 - 2 + Math.sin(pulse * 0.45) * 1.2;
    // 辉光
    const glow = ctx.createRadialGradient(fc, fcy, 1, fc, fcy, foodR + 6);
    glow.addColorStop(0, "rgba(255,99,71,0.55)");
    glow.addColorStop(1, "rgba(255,99,71,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(fc, fcy, foodR + 6, 0, Math.PI * 2);
    ctx.fill();
    // 果体
    const body = ctx.createRadialGradient(
      fc - foodR * 0.35,
      fcy - foodR * 0.4,
      1,
      fc,
      fcy,
      foodR,
    );
    body.addColorStop(0, "#ff8a6b");
    body.addColorStop(1, "#e2332b");
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(fc, fcy, foodR, 0, Math.PI * 2);
    ctx.fill();
    // 高光
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.beginPath();
    ctx.arc(fc - foodR * 0.32, fcy - foodR * 0.38, foodR * 0.22, 0, Math.PI * 2);
    ctx.fill();

    // 蛇：头部亮绿，向尾部渐深，圆角 + 投影
    const len = snake.length;
    snake.forEach((seg, idx) => {
      const t = len === 1 ? 0 : idx / (len - 1);
      const isHead = idx === 0;
      // 头部：#43e97b → #22b14c；越往后越深 #2e8b57 → #1a5c34
      let color: string;
      if (isHead) {
        color = "#2fd06b";
      } else {
        const light = 0x2e8b57;
        const dark = 0x1a5c34;
        const lerp = (a: number, b: number) =>
          Math.round(a + (b - a) * t);
        const [lr, lg, lb] = [(light >> 16) & 255, (light >> 8) & 255, light & 255];
        const [dr, dg, db] = [(dark >> 16) & 255, (dark >> 8) & 255, dark & 255];
        color = `rgb(${lerp(lr, dr)},${lerp(lg, dg)},${lerp(lb, db)})`;
      }
      const x = seg.x * CELL + 1;
      const y = seg.y * CELL + 1;
      const w = CELL - 2;
      const h = CELL - 2;
      ctx.save();
      ctx.shadowColor = "rgba(30,90,50,0.35)";
      ctx.shadowBlur = isHead ? 7 : 3;
      ctx.fillStyle = color;
      roundRectPath(ctx, x, y, w, h, isHead ? 8 : 6);
      ctx.fill();
      ctx.restore();
    });

    // 蛇头眼睛
    if (snake.length > 0) {
      drawEyes(ctx, snake[0], dirRef.current);
    }
  }, [snake, food, pulse]);

  /** 启动/暂停切换 */
  const toggle = useCallback(() => {
    if (over) return;
    setRunning((r) => !r);
  }, [over]);

  /** 重启 */
  const restart = useCallback(() => {
    const s = initialSnake();
    setSnake(s);
    setFood(randomFood(s));
    setDir("right");
    dirRef.current = "right";
    setScore(0);
    setOver(false);
    setRecorded(false);
    setRunning(true);
  }, []);

  /** 键盘 */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const cur = dirRef.current;
      let next: Dir | null = null;
      if ((key === "arrowup" || key === "w") && cur !== "down") next = "up";
      else if ((key === "arrowdown" || key === "s") && cur !== "up")
        next = "down";
      else if ((key === "arrowleft" || key === "a") && cur !== "right")
        next = "left";
      else if ((key === "arrowright" || key === "d") && cur !== "left")
        next = "right";
      if (!next) return;
      e.preventDefault();
      sfxMove();
      setDir(next);
      // 按方向键自动启动
      if (!running && !over) setRunning(true);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [running, over]);

  return (
    <GameFrame
      emoji="🐍"
      title={i18n.text("game.snake.title")}
      stats={[
        { label: i18n.text("game.snake.score"), value: score, colors: CHIP_GOLD },
        {
          label: i18n.text("game.snake.length"),
          value: snake.length,
          colors: CHIP_GREEN,
        },
      ]}
      headerExtra={
        <>
          <GhostBtn onClick={toggle} disabled={over}>
            {running ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
            {over
              ? i18n.text("game.snake.over")
              : running
                ? i18n.text("game.snake.pause")
                : i18n.text("game.snake.start")}
          </GhostBtn>
          <GhostBtn onClick={restart}>
            <ReloadOutlined />
            {i18n.text("game.snake.restart")}
          </GhostBtn>
        </>
      }
      help={i18n.text("game.snake.help")}
      maxWidth={480}
    >
      <div
        style={{
          position: "relative",
          width: COLS * CELL,
          height: ROWS * CELL,
          borderRadius: 14,
          overflow: "hidden",
          boxShadow: "0 8px 24px rgba(60,110,70,0.25)",
          border: "3px solid rgba(120,150,110,0.5)",
        }}
      >
        <canvas
          ref={canvasRef}
          width={COLS * CELL}
          height={ROWS * CELL}
          style={{ display: "block" }}
        />
        {over && (
          <div
            className="gs-win-in"
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(240,248,238,0.82)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              alignItems: "center",
              justifyContent: "center",
              color: "#1f7a3a",
            }}
          >
            <div style={{ fontSize: 28, fontWeight: 900 }}>
              {i18n.text("game.snake.over.title")}
            </div>
            <div style={{ fontSize: 14, opacity: 0.8 }}>
              {i18n.text("game.snake.over.score", { score })}
            </div>
            <GhostBtn onClick={restart}>
              <ReloadOutlined />
              {i18n.text("game.snake.again")}
            </GhostBtn>
          </div>
        )}
        {!over && !running && (
          <div
            className="gs-pulse"
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(240,248,238,0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#1f7a3a",
              fontSize: 16,
              fontWeight: 700,
              pointerEvents: "none",
            }}
          >
            {i18n.text("game.snake.idle")}
          </div>
        )}
      </div>
    </GameFrame>
  );
};

export default SnakeGame;
