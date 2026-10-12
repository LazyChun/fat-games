/*
 * SnakeGame：贪吃蛇
 *
 * 20x20 网格 Canvas，方向键控制方向；吃到食物得分，撞墙或撞自己
 * 结束。蛇身越长速度越快。游戏结束时记录成绩。
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Space, Statistic } from "antd";
import {
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import { recordScore } from "../scoreClient";
import { useI18n } from "../hooks";

const COLS = 20;
const ROWS = 20;
const CELL = 20; // px
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
        return prev;
      }
      // 撞自己（不包含尾部，因为尾部会移走）
      for (let i = 0; i < prev.length - 1; i++) {
        if (samePt(prev[i], head)) {
          setOver(true);
          setRunning(false);
          return prev;
        }
      }

      const next = [head, ...prev];
      if (samePt(head, food)) {
        // 吃到食物：尾部不移除
        setScore((s) => s + 1);
        setFood(randomFood(next));
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

    // 背景
    ctx.fillStyle = "#f7f3ea";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 网格线
    ctx.strokeStyle = "rgba(0,0,0,0.05)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= COLS; x++) {
      ctx.beginPath();
      ctx.moveTo(x * CELL, 0);
      ctx.lineTo(x * CELL, ROWS * CELL);
      ctx.stroke();
    }
    for (let y = 0; y <= ROWS; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * CELL);
      ctx.lineTo(COLS * CELL, y * CELL);
      ctx.stroke();
    }

    // 食物
    ctx.fillStyle = "#ff5b5b";
    ctx.beginPath();
    ctx.arc(
      food.x * CELL + CELL / 2,
      food.y * CELL + CELL / 2,
      CELL / 2 - 2,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    // 蛇
    snake.forEach((seg, idx) => {
      ctx.fillStyle = idx === 0 ? "#1f7a3a" : "#2e8b57";
      ctx.fillRect(seg.x * CELL + 1, seg.y * CELL + 1, CELL - 2, CELL - 2);
    });
  }, [snake, food]);

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
      setDir(next);
      // 按方向键自动启动
      if (!running && !over) setRunning(true);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [running, over]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Card size="small" style={{ minWidth: 120 }}>
          <Statistic title={i18n.text("game.snake.score")} value={score} />
        </Card>
        <Card size="small" style={{ minWidth: 120 }}>
          <Statistic
            title={i18n.text("game.snake.length")}
            value={snake.length}
          />
        </Card>
        <Space>
          <Button
            type="primary"
            icon={running ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
            onClick={toggle}
            disabled={over}
          >
            {running
              ? i18n.text("game.snake.pause")
              : over
                ? i18n.text("game.snake.over")
                : i18n.text("game.snake.start")}
          </Button>
          <Button icon={<ReloadOutlined />} onClick={restart}>
            {i18n.text("game.snake.restart")}
          </Button>
        </Space>
      </div>

      <div
        style={{
          position: "relative",
          width: COLS * CELL,
          height: ROWS * CELL,
          borderRadius: 8,
          overflow: "hidden",
          boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
          alignSelf: "flex-start",
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
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(255,255,255,0.78)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              alignItems: "center",
              justifyContent: "center",
              color: "#1f7a3a",
            }}
          >
            <div style={{ fontSize: 26, fontWeight: 800 }}>
              {i18n.text("game.snake.over.title")}
            </div>
            <div style={{ fontSize: 14 }}>
              {i18n.text("game.snake.over.score", { score })}
            </div>
            <Button type="primary" icon={<ReloadOutlined />} onClick={restart}>
              {i18n.text("game.snake.again")}
            </Button>
          </div>
        )}
        {!over && !running && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(255,255,255,0.55)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#1f7a3a",
              fontSize: 16,
              fontWeight: 600,
            }}
          >
            {i18n.text("game.snake.idle")}
          </div>
        )}
      </div>

      <div style={{ color: "rgba(0,0,0,0.55)", fontSize: 12 }}>
        {i18n.text("game.snake.help")}
      </div>
    </div>
  );
};

export default SnakeGame;
