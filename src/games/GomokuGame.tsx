/*
 * GomokuGame：五子棋（新游戏）
 *
 * 15x15 棋盘，玩家执黑先手，AI 执白。简单启发式 AI：
 * 先看自己能否五连，再看是否需堵对方五连，否则按“冲四/活三/活二”
 * 模式打分选最优落点。先连成五子者胜；玩家获胜时记录成绩
 * （score = max(50, 600 - 玩家手数×10)，步数越少分越高）。
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ReloadOutlined } from "@ant-design/icons";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import { recordScore } from "../scoreClient";
import { useI18n } from "../hooks";
import GameFrame, { GhostBtn, CHIP_BLUE, CHIP_GOLD, CHIP_PURPLE } from "./GameFrame";
import "./gameAnimations.less";

const N = 15;
const CELL = 30;
const MARGIN = 22;
const SIZE = (N - 1) * CELL + MARGIN * 2;

type Stone = 0 | 1 | 2; // 0 空 / 1 黑(玩家) / 2 白(AI)

const DIRS: Array<[number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

function emptyGrid(): Stone[][] {
  return Array.from({ length: N }, () => Array<Stone>(N).fill(0));
}

/** 在指定方向统计从 (r,c) 出发、颜色 color 的连续长度与两端开闭 */
function lineInfo(
  grid: Stone[][],
  r: number,
  c: number,
  dr: number,
  dc: number,
  color: Stone,
): { count: number; openEnds: number } {
  let count = 1;
  let openEnds = 0;
  // 正向
  let rr = r + dr;
  let cc = c + dc;
  while (rr >= 0 && rr < N && cc >= 0 && cc < N && grid[rr][cc] === color) {
    count++;
    rr += dr;
    cc += dc;
  }
  if (rr >= 0 && rr < N && cc >= 0 && cc < N && grid[rr][cc] === 0) openEnds++;
  // 反向
  rr = r - dr;
  cc = c - dc;
  while (rr >= 0 && rr < N && cc >= 0 && cc < N && grid[rr][cc] === color) {
    count++;
    rr -= dr;
    cc -= dc;
  }
  if (rr >= 0 && rr < N && cc >= 0 && cc < N && grid[rr][cc] === 0) openEnds++;
  return { count, openEnds };
}

/** 某点放 color 后的分数（模式匹配） */
function pointScore(
  grid: Stone[][],
  r: number,
  c: number,
  color: Stone,
): number {
  let total = 0;
  for (const [dr, dc] of DIRS) {
    const { count, openEnds } = lineInfo(grid, r, c, dr, dc, color);
    if (count >= 5) total += 100000;
    else if (count === 4) total += openEnds === 2 ? 20000 : openEnds === 1 ? 5000 : 0;
    else if (count === 3) total += openEnds === 2 ? 4000 : openEnds === 1 ? 500 : 0;
    else if (count === 2) total += openEnds === 2 ? 300 : openEnds === 1 ? 50 : 0;
    else if (count === 1) total += openEnds === 2 ? 10 : 0;
  }
  return total;
}

/** 是否五连 */
function checkWin(
  grid: Stone[][],
  r: number,
  c: number,
  color: Stone,
): boolean {
  for (const [dr, dc] of DIRS) {
    const { count } = lineInfo(grid, r, c, dr, dc, color);
    if (count >= 5) return true;
  }
  return false;
}

/** AI 选点 */
function aiMove(grid: Stone[][]): [number, number] {
  // 空棋盘：天元
  let best: [number, number] | null = null;
  let bestScore = -1;
  let aiWin: [number, number] | null = null;
  let blockWin: [number, number] | null = null;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (grid[r][c] !== 0) continue;
      const ai = pointScore(grid, r, c, 2);
      const player = pointScore(grid, r, c, 1);
      if (ai >= 100000) aiWin = [r, c];
      if (player >= 100000) blockWin = [r, c];
      const s = ai * 1.05 + player;
      if (s > bestScore) {
        bestScore = s;
        best = [r, c];
      }
    }
  }
  if (aiWin) return aiWin;
  if (blockWin) return blockWin;
  return best || [7, 7];
}

const GomokuGame: React.FC<{ sdk: FatNotesPluginSDK }> = () => {
  const i18n = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [grid, setGrid] = useState<Stone[][]>(emptyGrid);
  const [turn, setTurn] = useState<1 | 2>(1); // 1 玩家 / 2 AI
  const [playerMoves, setPlayerMoves] = useState(0);
  const [winner, setWinner] = useState<0 | 1 | 2>(0); // 0 进行中
  const [recorded, setRecorded] = useState(false);
  const [aiThinking, setAiThinking] = useState(false);
  const aiTimerRef = useRef<number | null>(null);

  const stateRef = useRef({ grid, turn, winner, aiThinking });
  stateRef.current = { grid, turn, winner, aiThinking };

  /** place 的稳定引用（供 AI 定时回调递归调用） */
  const placeRef = useRef<(r: number, c: number, color: 1 | 2) => void>(() => {});

  /** 落子并判胜负；玩家落子后调度 AI 应手 */
  const place = useCallback((r: number, c: number, color: 1 | 2) => {
    setGrid((prev) => {
      if (prev[r][c] !== 0) return prev;
      const next = prev.map((row) => row.slice());
      next[r][c] = color;
      if (checkWin(next, r, c, color)) {
        setWinner(color);
        return next;
      }
      if (color === 1) {
        // 轮到 AI：延迟 260ms 应手（用 next 快照，避免竞态）
        setTurn(2);
        setAiThinking(true);
        aiTimerRef.current = window.setTimeout(() => {
          aiTimerRef.current = null;
          const [ar, ac] = aiMove(next);
          setAiThinking(false);
          placeRef.current(ar, ac, 2);
        }, 260);
      } else {
        setTurn(1);
      }
      return next;
    });
  }, []);
  placeRef.current = place;

  /** 玩家点击 */
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const { winner: w, turn: t, aiThinking: th } = stateRef.current;
      if (w !== 0 || t !== 1 || th) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const c = Math.round((x - MARGIN) / CELL);
      const r = Math.round((y - MARGIN) / CELL);
      if (r < 0 || r >= N || c < 0 || c >= N) return;
      setPlayerMoves((m) => m + 1);
      place(r, c, 1);
    },
    [place],
  );

  // 玩家获胜记录成绩
  useEffect(() => {
    if (winner === 1 && !recorded) {
      setRecorded(true);
      const s = Math.max(50, 600 - playerMoves * 10);
      recordScore({
        gameId: "gomoku",
        gameTitle: "五子棋",
        score: s,
        detail: { moves: playerMoves, result: "win" },
      });
    }
  }, [winner, recorded, playerMoves]);

  // 卸载时清理 AI 定时器
  useEffect(
    () => () => {
      if (aiTimerRef.current !== null) {
        window.clearTimeout(aiTimerRef.current);
        aiTimerRef.current = null;
      }
    },
    [],
  );

  // 绘制棋盘与棋子
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);

    // 木纹棋盘
    const wood = ctx.createLinearGradient(0, 0, SIZE, SIZE);
    wood.addColorStop(0, "#e5b56f");
    wood.addColorStop(1, "#d19c52");
    ctx.fillStyle = wood;
    ctx.fillRect(0, 0, SIZE, SIZE);

    // 网格线
    ctx.strokeStyle = "rgba(80,50,20,0.75)";
    ctx.lineWidth = 1;
    for (let i = 0; i < N; i++) {
      const p = MARGIN + i * CELL;
      ctx.beginPath();
      ctx.moveTo(MARGIN, p);
      ctx.lineTo(MARGIN + (N - 1) * CELL, p);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(p, MARGIN);
      ctx.lineTo(p, MARGIN + (N - 1) * CELL);
      ctx.stroke();
    }

    // 星位
    const stars: Array<[number, number]> = [
      [3, 3],
      [3, 11],
      [7, 7],
      [11, 3],
      [11, 11],
    ];
    ctx.fillStyle = "rgba(80,50,20,0.85)";
    for (const [sr, sc] of stars) {
      ctx.beginPath();
      ctx.arc(MARGIN + sc * CELL, MARGIN + sr * CELL, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // 棋子
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        const v = grid[r][c];
        if (v === 0) continue;
        const x = MARGIN + c * CELL;
        const y = MARGIN + r * CELL;
        ctx.save();
        ctx.shadowColor = "rgba(0,0,0,0.4)";
        ctx.shadowBlur = 5;
        ctx.shadowOffsetY = 2;
        const stone = ctx.createRadialGradient(
          x - 4,
          y - 5,
          2,
          x,
          y,
          CELL * 0.44,
        );
        if (v === 1) {
          stone.addColorStop(0, "#5a5a62");
          stone.addColorStop(1, "#16161c");
          ctx.fillStyle = stone;
          ctx.beginPath();
          ctx.arc(x, y, CELL * 0.42, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.35)";
          ctx.beginPath();
          ctx.arc(x - 4, y - 5, 3, 0, Math.PI * 2);
          ctx.fill();
        } else {
          stone.addColorStop(0, "#ffffff");
          stone.addColorStop(1, "#d9d4cc");
          ctx.fillStyle = stone;
          ctx.beginPath();
          ctx.arc(x, y, CELL * 0.42, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "rgba(0,0,0,0.15)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        ctx.restore();
      }
    }

    // AI 思考中的落点提示
    if (stateRef.current.aiThinking && stateRef.current.turn === 2) {
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.font = "14px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("AI…", SIZE / 2, 16);
    }
  }, [grid, stateRef, aiThinking, turn]);

  /** 重启 */
  const restart = useCallback(() => {
    if (aiTimerRef.current !== null) {
      window.clearTimeout(aiTimerRef.current);
      aiTimerRef.current = null;
    }
    setGrid(emptyGrid());
    setTurn(1);
    setPlayerMoves(0);
    setWinner(0);
    setRecorded(false);
    setAiThinking(false);
  }, []);

  const statusText =
    winner === 1
      ? `${i18n.text("game.gomoku.playerWin")} 🎉`
      : winner === 2
        ? i18n.text("game.gomoku.aiWin")
        : turn === 1
          ? i18n.text("game.gomoku.yourTurn")
          : i18n.text("game.gomoku.aiTurn");

  return (
    <GameFrame
      emoji="⚫"
      title={i18n.text("game.gomoku.title")}
      stats={[
        {
          label: i18n.text("game.gomoku.turn"),
          value: statusText,
          colors: turn === 1 ? CHIP_BLUE : CHIP_PURPLE,
        },
        {
          label: i18n.text("game.gomoku.myMoves"),
          value: playerMoves,
          colors: CHIP_GOLD,
        },
      ]}
      headerExtra={
        <GhostBtn onClick={restart}>
          <ReloadOutlined />
          {i18n.text("game.gomoku.restart")}
        </GhostBtn>
      }
      help={i18n.text("game.gomoku.help")}
      maxWidth={540}
    >
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        onClick={handleClick}
        style={{
          borderRadius: 12,
          boxShadow: "0 10px 26px rgba(90,60,20,0.35)",
          cursor: winner === 0 && turn === 1 ? "pointer" : "default",
          border: "3px solid #8a5a2a",
        }}
      />
      {winner !== 0 && (
        <div
          className="gs-win-in"
          style={{
            marginTop: 12,
            padding: "10px 20px",
            borderRadius: 12,
            background: winner === 1 ? "rgba(90,200,120,0.18)" : "rgba(200,90,90,0.15)",
            border: `1px solid ${winner === 1 ? "rgba(60,150,90,0.45)" : "rgba(200,80,80,0.4)"}`,
            display: "flex",
            alignItems: "center",
            gap: 12,
            fontSize: 14,
          }}
        >
          <b>{statusText}</b>
          <GhostBtn onClick={restart}>
            <ReloadOutlined />
            {i18n.text("game.gomoku.again")}
          </GhostBtn>
        </div>
      )}
    </GameFrame>
  );
};

export default GomokuGame;
