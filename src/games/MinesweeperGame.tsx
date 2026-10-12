/*
 * MinesweeperGame：扫雷（初学者难度 9x9 / 10 雷）
 *
 * 左键揭开，右键插旗；空格 flood-fill 展开；揭开所有非雷格胜利，
 * 踩雷失败。计时秒数作为成绩记录。
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button, Card, Space, Statistic } from "antd";
import { ReloadOutlined, FlagOutlined } from "@ant-design/icons";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import { recordScore } from "../scoreClient";
import { useI18n } from "../hooks";

const ROWS = 9;
const COLS = 9;
const MINES = 10;

type CellState = "hidden" | "revealed" | "flagged";

interface Cell {
  mine: boolean;
  state: CellState;
  adjacent: number; // 周围雷数（0..8）
}

interface Board {
  cells: Cell[][];
  /** 第一次点击后才生成雷，避免上来就踩雷 */
  minesPlaced: boolean;
  /** 已揭开的非雷格数（胜利判定用） */
  revealed: number;
  /** 是否已踩雷 */
  exploded: boolean;
}

function emptyBoard(): Board {
  const cells: Cell[][] = [];
  for (let r = 0; r < ROWS; r++) {
    const row: Cell[] = [];
    for (let c = 0; c < COLS; c++) {
      row.push({ mine: false, state: "hidden", adjacent: 0 });
    }
    cells.push(row);
  }
  return { cells, minesPlaced: false, revealed: 0, exploded: false };
}

/** 在 firstR/firstC 之外放置 MINES 个雷 */
function placeMines(board: Board, firstR: number, firstC: number): void {
  const positions: Array<[number, number]> = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (r === firstR && c === firstC) continue;
      // 同时避开起手格的 8 邻，保证第一次点击能展开一片
      if (Math.abs(r - firstR) <= 1 && Math.abs(c - firstC) <= 1) continue;
      positions.push([r, c]);
    }
  }
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  for (let i = 0; i < MINES && i < positions.length; i++) {
    const [r, c] = positions[i];
    board.cells[r][c].mine = true;
  }
  // 计算 adjacent
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (board.cells[r][c].mine) continue;
      let n = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
          if (board.cells[nr][nc].mine) n++;
        }
      }
      board.cells[r][c].adjacent = n;
    }
  }
}

function neighbors(r: number, c: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
      out.push([nr, nc]);
    }
  }
  return out;
}

/** 揭开一格（含 flood-fill），返回是否踩雷 */
function revealAt(board: Board, r: number, c: number): boolean {
  const cell = board.cells[r][c];
  if (cell.state !== "hidden") return false;
  cell.state = "revealed";
  if (cell.mine) {
    board.exploded = true;
    return true;
  }
  board.revealed += 1;
  if (cell.adjacent === 0) {
    for (const [nr, nc] of neighbors(r, c)) {
      revealAt(board, nr, nc);
    }
  }
  return false;
}

function cloneBoard(board: Board): Board {
  return {
    cells: board.cells.map((row) => row.map((c) => ({ ...c }))),
    minesPlaced: board.minesPlaced,
    revealed: board.revealed,
    exploded: board.exploded,
  };
}

const NUMBER_COLORS: Record<number, string> = {
  1: "#1976d2",
  2: "#388e3c",
  3: "#d32f2f",
  4: "#7b1fa2",
  5: "#ee5722",
  6: "#0097a7",
  7: "#424242",
  8: "#9e9e9e",
};

const MinesweeperGame: React.FC<{ sdk: FatNotesPluginSDK }> = () => {
  const i18n = useI18n();
  const [board, setBoard] = useState<Board>(() => emptyBoard());
  const [flags, setFlags] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [started, setStarted] = useState(false);
  const [over, setOver] = useState(false);
  const [won, setWon] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const timerRef = useRef<number | null>(null);

  const safeCells = ROWS * COLS - MINES;

  // 计时
  useEffect(() => {
    if (!started || over) return;
    timerRef.current = window.setInterval(() => {
      setSeconds((s) => s + 1);
    }, 1000);
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [started, over]);

  // 胜利判定
  useEffect(() => {
    if (started && !over && board.revealed >= safeCells) {
      setOver(true);
      setWon(true);
      // 胜利时标记剩余雷格为旗
      setBoard((b) => {
        const next = cloneBoard(b);
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            if (next.cells[r][c].mine && next.cells[r][c].state !== "flagged")
              next.cells[r][c].state = "flagged";
          }
        }
        return next;
      });
    }
  }, [board.revealed, safeCells, started, over]);

  // 结束时记录成绩（秒数越低越好）
  useEffect(() => {
    if (over && !recorded) {
      setRecorded(true);
      recordScore({
        gameId: "minesweeper",
        gameTitle: "扫雷",
        score: seconds,
      });
    }
  }, [over, recorded, seconds]);

  const restart = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setBoard(emptyBoard());
    setFlags(0);
    setSeconds(0);
    setStarted(false);
    setOver(false);
    setWon(false);
    setRecorded(false);
  }, []);

  /** 左键揭开 */
  const handleReveal = useCallback(
    (r: number, c: number) => {
      if (over) return;
      setBoard((prev) => {
        const cell = prev.cells[r][c];
        if (cell.state !== "hidden") return prev;
        const next = cloneBoard(prev);
        if (!next.minesPlaced) {
          placeMines(next, r, c);
          next.minesPlaced = true;
          setStarted(true);
        }
        const exploded = revealAt(next, r, c);
        if (exploded) {
          // 揭开所有雷
          for (let rr = 0; rr < ROWS; rr++) {
            for (let cc = 0; cc < COLS; cc++) {
              const x = next.cells[rr][cc];
              if (x.mine && x.state !== "flagged") x.state = "revealed";
            }
          }
          setOver(true);
          setWon(false);
        }
        return next;
      });
    },
    [over],
  );

  /** 右键插旗 */
  const handleFlag = useCallback(
    (r: number, c: number, e: React.MouseEvent) => {
      e.preventDefault();
      if (over) return;
      setBoard((prev) => {
        const cell = prev.cells[r][c];
        if (cell.state === "revealed") return prev;
        const next = cloneBoard(prev);
        const target = next.cells[r][c];
        if (target.state === "hidden") {
          target.state = "flagged";
          setFlags((f) => f + 1);
        } else if (target.state === "flagged") {
          target.state = "hidden";
          setFlags((f) => f - 1);
        }
        return next;
      });
    },
    [over],
  );

  const minesLeft = useMemo(() => MINES - flags, [flags]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Card size="small" style={{ minWidth: 120 }}>
          <Statistic
            title={i18n.text("game.minesweeper.minesLeft")}
            value={minesLeft}
            prefix={<FlagOutlined />}
          />
        </Card>
        <Card size="small" style={{ minWidth: 120 }}>
          <Statistic
            title={i18n.text("game.minesweeper.time")}
            value={seconds}
          />
        </Card>
        <Space>
          <Button type="primary" icon={<ReloadOutlined />} onClick={restart}>
            {i18n.text("game.minesweeper.restart")}
          </Button>
        </Space>
      </div>

      <div
        style={{
          padding: 8,
          background: "rgba(0,0,0,0.05)",
          borderRadius: 8,
          alignSelf: "flex-start",
          position: "relative",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${COLS}, 30px)`,
            gridTemplateRows: `repeat(${ROWS}, 30px)`,
            gap: 2,
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {board.cells.flatMap((row, r) =>
            row.map((cell, c) => {
              const revealed = cell.state === "revealed";
              const flagged = cell.state === "flagged";
              return (
                <button
                  key={`${r}-${c}`}
                  type="button"
                  onClick={() => handleReveal(r, c)}
                  onContextMenu={(e) => handleFlag(r, c, e)}
                  style={{
                    width: 30,
                    height: 30,
                    padding: 0,
                    border: "1px solid rgba(0,0,0,0.15)",
                    borderRadius: 3,
                    background: revealed
                      ? cell.mine
                        ? "#d32f2f"
                        : "#fff"
                      : "#bdbdbd",
                    color:
                      cell.mine && revealed
                        ? "#fff"
                        : NUMBER_COLORS[cell.adjacent] || "#000",
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: over ? "default" : "pointer",
                    userSelect: "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {revealed
                    ? cell.mine
                      ? "💣"
                      : cell.adjacent > 0
                        ? String(cell.adjacent)
                        : ""
                    : flagged
                      ? "🚩"
                      : ""}
                </button>
              );
            }),
          )}
        </div>

        {over && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(255,255,255,0.78)",
              borderRadius: 8,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              alignItems: "center",
              justifyContent: "center",
              color: won ? "#388e3c" : "#d32f2f",
            }}
          >
            <div style={{ fontSize: 24, fontWeight: 800 }}>
              {won
                ? i18n.text("game.minesweeper.win")
                : i18n.text("game.minesweeper.lose")}
            </div>
            <div style={{ fontSize: 14 }}>
              {i18n.text("game.minesweeper.usedSeconds", { seconds })}
            </div>
            <Button type="primary" icon={<ReloadOutlined />} onClick={restart}>
              {i18n.text("game.minesweeper.again")}
            </Button>
          </div>
        )}
      </div>

      <div style={{ color: "rgba(0,0,0,0.55)", fontSize: 12 }}>
        {i18n.text("game.minesweeper.help")}
      </div>
    </div>
  );
};

export default MinesweeperGame;
