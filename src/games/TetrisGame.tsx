/*
 * TetrisGame：俄罗斯方块（新游戏）
 *
 * 10x20 Canvas 经典玩法：方向键/AD 左右移动，↑ 旋转，↓ 加速下落，
 * 空格硬降，P 暂停。消除行计分，等级越高下落越快；有下一个方块预览
 * 与落地投影（ghost）。游戏结束时记录成绩。
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { PauseCircleOutlined, PlayCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import { recordScore } from "../scoreClient";
import { useI18n } from "../hooks";
import GameFrame, { GhostBtn, CHIP_GOLD, CHIP_BLUE, CHIP_PURPLE } from "./GameFrame";
import "./gameAnimations.less";

const COLS = 10;
const ROWS = 20;
const CELL = 24; // px

interface ShapeDef {
  cells: number[][];
  color: string;
  glow: string;
}

/** 7 种方块基型 */
const PIECES: ShapeDef[] = [
  { cells: [[1, 1, 1, 1]], color: "#3fc1d9", glow: "#7ee7f5" }, // I
  { cells: [[1, 1], [1, 1]], color: "#f7c948", glow: "#ffe08a" }, // O
  { cells: [[0, 1, 0], [1, 1, 1]], color: "#b07ef0", glow: "#d4b3ff" }, // T
  { cells: [[1, 0, 0], [1, 1, 1]], color: "#f68a4e", glow: "#ffc08a" }, // L
  { cells: [[0, 0, 1], [1, 1, 1]], color: "#4f9df2", glow: "#9cc8ff" }, // J
  { cells: [[0, 1, 1], [1, 1, 0]], color: "#5acf6b", glow: "#a4f0ad" }, // S
  { cells: [[1, 1, 0], [0, 1, 1]], color: "#f0567a", glow: "#ffa3b8" }, // Z
];

/** 顺时针旋转矩阵 */
function rotateCells(cells: number[][]): number[][] {
  const h = cells.length;
  const w = cells[0].length;
  const out: number[][] = Array.from({ length: w }, () => Array<number>(h).fill(0));
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      out[c][h - 1 - r] = cells[r][c];
    }
  }
  return out;
}

interface Piece {
  type: number;
  cells: number[][];
  x: number;
  y: number;
}

/** 空棋盘 */
function emptyBoard(): number[][] {
  return Array.from({ length: ROWS }, () => Array<number>(COLS).fill(0));
}

function randomPiece(): Piece {
  const type = Math.floor(Math.random() * PIECES.length);
  return {
    type,
    cells: PIECES[type].cells.map((row) => row.slice()),
    x: Math.floor((COLS - PIECES[type].cells[0].length) / 2),
    y: 0,
  };
}

/** 碰撞检测 */
function collides(board: number[][], cells: number[][], x: number, y: number): boolean {
  for (let r = 0; r < cells.length; r++) {
    for (let c = 0; c < cells[r].length; c++) {
      if (!cells[r][c]) continue;
      const bx = x + c;
      const by = y + r;
      if (bx < 0 || bx >= COLS || by >= ROWS) return true;
      if (by >= 0 && board[by][bx]) return true;
    }
  }
  return false;
}

/** 落地位置（ghost 用）：返回可落到的 y */
function dropY(board: number[][], cells: number[][], x: number, y: number): number {
  let yy = y;
  while (!collides(board, cells, x, yy + 1)) yy++;
  return yy;
}

/** 消行：返回 [新棋盘, 消除行数] */
function clearLines(board: number[][]): [number[][], number] {
  const kept = board.filter((row) => row.some((v) => v === 0));
  const cleared = ROWS - kept.length;
  if (cleared === 0) return [board, 0];
  const fresh = Array.from({ length: cleared }, () => Array<number>(COLS).fill(0));
  return [[...fresh, ...kept], cleared];
}

const LINE_SCORES = [0, 100, 300, 500, 800];

/** 圆角矩形填充（兼容无 roundRect 的环境） */
function fillRounded(
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
  ctx.fill();
}

const TetrisGame: React.FC<{ sdk: FatNotesPluginSDK }> = () => {
  const i18n = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const nextRef = useRef<HTMLCanvasElement | null>(null);

  const [board, setBoard] = useState<number[][]>(emptyBoard);
  const [piece, setPiece] = useState<Piece>(randomPiece);
  const [next, setNext] = useState<Piece>(randomPiece);
  const [score, setScore] = useState(0);
  const [lines, setLines] = useState(0);
  const [level, setLevel] = useState(1);
  const [running, setRunning] = useState(false);
  const [over, setOver] = useState(false);
  const [recorded, setRecorded] = useState(false);

  // 供循环/键盘读最新状态
  const stateRef = useRef({ board, piece, next, running, over });
  stateRef.current = { board, piece, next, running, over };

  /** 尝试生成新方块：失败则游戏结束 */
  const spawnPiece = useCallback(
    (b: number[][], fromNext: Piece): Piece | null => {
      if (collides(b, fromNext.cells, fromNext.x, fromNext.y)) {
        return null;
      }
      return { ...fromNext, cells: fromNext.cells.map((row) => row.slice()) };
    },
    [],
  );

  /** 锁定当前方块 + 消行 + 生成下一个 */
  const lock = useCallback(() => {
    setBoard((prevBoard) => {
      const p = stateRef.current.piece;
      const nb = prevBoard.map((row) => row.slice());
      for (let r = 0; r < p.cells.length; r++) {
        for (let c = 0; c < p.cells[r].length; c++) {
          if (!p.cells[r][c]) continue;
          const by = p.y + r;
          const bx = p.x + c;
          if (by >= 0 && by < ROWS && bx >= 0 && bx < COLS) {
            nb[by][bx] = p.type + 1;
          }
        }
      }
      const [cleared, n] = clearLines(nb);
      if (n > 0) {
        setScore((s) => s + LINE_SCORES[n] * level);
        setLines((l) => {
          const nl = l + n;
          setLevel(Math.floor(nl / 10) + 1);
          return nl;
        });
      }
      // 下一个方块上场
      const nxt = stateRef.current.next
        ? { ...stateRef.current.next, x: Math.floor((COLS - stateRef.current.next.cells[0].length) / 2), y: 0 }
        : randomPiece();
      const spawn = spawnPiece(cleared, nxt);
      if (!spawn) {
        setOver(true);
        setRunning(false);
        return cleared;
      }
      setPiece(spawn);
      setNext(randomPiece());
      return cleared;
    });
  }, [level, spawnPiece]);

  /** 一步下落 */
  const stepDown = useCallback(() => {
    const { board: b, piece: p, running: r, over: o } = stateRef.current;
    if (!r || o) return;
    if (!collides(b, p.cells, p.x, p.y + 1)) {
      setPiece({ ...p, y: p.y + 1 });
    } else {
      lock();
    }
  }, [lock]);

  // 游戏循环（随等级加速）
  useEffect(() => {
    if (!running || over) return;
    const interval = Math.max(70, 760 - (level - 1) * 70);
    const id = window.setInterval(stepDown, interval);
    return () => window.clearInterval(id);
  }, [running, over, level, stepDown]);

  // 游戏结束记录成绩
  useEffect(() => {
    if (over && !recorded) {
      setRecorded(true);
      recordScore({
        gameId: "tetris",
        gameTitle: "俄罗斯方块",
        score,
        detail: { lines, level },
      });
    }
  }, [over, recorded, score, lines, level]);

  // 主画布绘制
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 背景
    const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
    bg.addColorStop(0, "#1c2028");
    bg.addColorStop(1, "#12151b");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 网格
    ctx.strokeStyle = "rgba(255,255,255,0.045)";
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

    const drawCell = (
      bx: number,
      by: number,
      type: number,
      alpha = 1,
      glow = false,
    ) => {
      const def = PIECES[type];
      const x = bx * CELL + 1;
      const y = by * CELL + 1;
      const w = CELL - 2;
      const h = CELL - 2;
      ctx.save();
      ctx.globalAlpha = alpha;
      if (glow) {
        ctx.shadowColor = def.glow;
        ctx.shadowBlur = 8;
      }
      const grad = ctx.createLinearGradient(x, y, x + w, y + h);
      grad.addColorStop(0, def.color);
      grad.addColorStop(1, def.color);
      // 顶部高光
      ctx.fillStyle = grad;
      fillRounded(ctx, x, y, w, h, 4);
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      fillRounded(ctx, x, y, w, 4, 2);
      ctx.restore();
    };

    // 已落棋盘
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const v = board[r][c];
        if (v) drawCell(c, r, v - 1);
      }
    }

    const { piece: p } = stateRef.current;
    // 落地投影（ghost）
    if (p) {
      const gy = dropY(board, p.cells, p.x, p.y);
      if (gy !== p.y) {
        for (let r = 0; r < p.cells.length; r++) {
          for (let c = 0; c < p.cells[r].length; c++) {
            if (p.cells[r][c]) drawCell(p.x + c, gy + r, p.type, 0.22);
          }
        }
      }
      // 当前方块
      for (let r = 0; r < p.cells.length; r++) {
        for (let c = 0; c < p.cells[r].length; c++) {
          if (p.cells[r][c]) drawCell(p.x + c, p.y + r, p.type, 1, true);
        }
      }
    }
  }, [board, piece, stateRef]);

  // 下一个预览画布
  useEffect(() => {
    const canvas = nextRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const cells = next.cells;
    const w = cells[0].length;
    const h = cells.length;
    const cw = 22;
    const ox = (canvas.width - w * cw) / 2;
    const oy = (canvas.height - h * cw) / 2;
    for (let r = 0; r < h; r++) {
      for (let c = 0; c < w; c++) {
        if (!cells[r][c]) continue;
        const def = PIECES[next.type];
        const x = ox + c * cw + 1;
        const y = oy + r * cw + 1;
        ctx.fillStyle = def.color;
        fillRounded(ctx, x, y, cw - 2, cw - 2, 4);
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        fillRounded(ctx, x, y, cw - 2, 4, 2);
      }
    }
  }, [next]);

  /** 开始/暂停 */
  const toggle = useCallback(() => {
    if (over) return;
    setRunning((r) => !r);
  }, [over]);

  /** 重启 */
  const restart = useCallback(() => {
    setBoard(emptyBoard());
    setPiece(randomPiece());
    setNext(randomPiece());
    setScore(0);
    setLines(0);
    setLevel(1);
    setOver(false);
    setRecorded(false);
    setRunning(true);
  }, []);

  /** 移动 / 旋转 / 硬降 */
  const tryMove = useCallback(
    (dx: number, dy: number, rotate: boolean) => {
      const { board: b, piece: p, running: r, over: o } = stateRef.current;
      if (!r || o) return;
      if (rotate) {
        const rotated = rotateCells(p.cells);
        // 简单踢墙：尝试 0 / ±1 / ±2
        for (const k of [0, -1, 1, -2, 2]) {
          if (!collides(b, rotated, p.x + k, p.y)) {
            setPiece({ ...p, cells: rotated, x: p.x + k });
            return;
          }
        }
        return;
      }
      if (!collides(b, p.cells, p.x + dx, p.y + dy)) {
        setPiece({ ...p, x: p.x + dx, y: p.y + dy });
      } else if (dy > 0) {
        lock();
      }
    },
    [lock],
  );

  /** 硬降 */
  const hardDrop = useCallback(() => {
    const { board: b, piece: p, running: r, over: o } = stateRef.current;
    if (!r || o) return;
    const gy = dropY(b, p.cells, p.x, p.y);
    setPiece({ ...p, y: gy });
    lock();
  }, [lock]);

  /** 键盘 */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const { running: r, over: o } = stateRef.current;
      if (key === "p") {
        if (!o) setRunning((v) => !v);
        return;
      }
      if (!r || o) return;
      e.preventDefault();
      if (key === "arrowleft" || key === "a") tryMove(-1, 0, false);
      else if (key === "arrowright" || key === "d") tryMove(1, 0, false);
      else if (key === "arrowdown" || key === "s") tryMove(0, 1, false);
      else if (key === "arrowup" || key === "w") tryMove(0, 0, true);
      else if (key === " ") hardDrop();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [tryMove, hardDrop]);

  return (
    <GameFrame
      emoji="🧱"
      title={i18n.text("game.tetris.title")}
      stats={[
        { label: i18n.text("game.tetris.score"), value: score, colors: CHIP_GOLD },
        { label: i18n.text("game.tetris.lines"), value: lines, colors: CHIP_BLUE },
        { label: i18n.text("game.tetris.level"), value: level, colors: CHIP_PURPLE },
      ]}
      headerExtra={
        <>
          <GhostBtn onClick={toggle} disabled={over}>
            {running ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
            {over
              ? i18n.text("game.tetris.over")
              : running
                ? i18n.text("game.tetris.pause")
                : i18n.text("game.tetris.start")}
          </GhostBtn>
          <GhostBtn onClick={restart}>
            <ReloadOutlined />
            {i18n.text("game.tetris.restart")}
          </GhostBtn>
        </>
      }
      help={i18n.text("game.tetris.help")}
      maxWidth={440}
    >
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
        {/* 主棋盘 */}
        <div
          style={{
            position: "relative",
            borderRadius: 12,
            overflow: "hidden",
            boxShadow: "0 10px 28px rgba(0,0,0,0.45)",
            border: "2px solid rgba(255,255,255,0.14)",
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
                background: "rgba(16,18,24,0.82)",
                display: "flex",
                flexDirection: "column",
                gap: 10,
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
              }}
            >
              <div style={{ fontSize: 26, fontWeight: 900 }}>
                {i18n.text("game.tetris.over")}
              </div>
              <div style={{ fontSize: 14, opacity: 0.8 }}>
                {i18n.text("game.tetris.finalScore", { score })}
              </div>
              <GhostBtn onClick={restart}>
                <ReloadOutlined />
                {i18n.text("game.tetris.again")}
              </GhostBtn>
            </div>
          )}
          {!over && !running && (
            <div
              className="gs-pulse"
              style={{
                position: "absolute",
                inset: 0,
                background: "rgba(16,18,24,0.6)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
                fontSize: 16,
                fontWeight: 700,
                pointerEvents: "none",
              }}
            >
              {i18n.text("game.tetris.idle")}
            </div>
          )}
        </div>

        {/* 右侧：下一个方块 */}
        <div
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 12,
            padding: "10px 8px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
            width: 96,
          }}
        >
          <span
            style={{
              fontSize: 12,
              color: "rgba(255,255,255,0.65)",
              fontWeight: 600,
            }}
          >
            {i18n.text("game.tetris.next")}
          </span>
          <canvas ref={nextRef} width={88} height={88} />
        </div>
      </div>
    </GameFrame>
  );
};

export default TetrisGame;
