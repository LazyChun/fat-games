/*
 * MinesweeperGame：扫雷（初学者难度 9x9 / 10 雷，视觉升级版）
 *
 * 左键揭开，右键插旗；空格 flood-fill 展开；揭开所有非雷格胜利，
 * 踩雷失败。方块为 3D 凸起/凹陷样式，数字配色精致；计时秒数作为成绩。
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ReloadOutlined, FlagOutlined } from "@ant-design/icons";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import { recordScore } from "../scoreClient";
import { useI18n } from "../hooks";
import GameFrame, { GhostBtn, CHIP_RED, CHIP_BLUE } from "./GameFrame";
import { sfxReveal, sfxFlag, sfxBoom, sfxWin } from "./sound";
import "./gameAnimations.less";

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
  1: "#1e6fd9",
  2: "#2e9e44",
  3: "#e5484d",
  4: "#7b3ff2",
  5: "#ef6a1f",
  6: "#0fa3a3",
  7: "#4a4458",
  8: "#8d8d93",
};

/** 未揭开方块的 3D 凸起样式 */
const HIDDEN_STYLE: React.CSSProperties = {
  background:
    "linear-gradient(145deg, #e8e9ec 0%, #c9ccd4 100%)",
  borderTop: "2px solid rgba(255,255,255,0.9)",
  borderLeft: "2px solid rgba(255,255,255,0.75)",
  borderBottom: "2px solid rgba(90,95,110,0.45)",
  borderRight: "2px solid rgba(90,95,110,0.4)",
  boxShadow: "0 2px 4px rgba(0,0,0,0.15)",
};

/** 已揭开方块的凹陷样式 */
const REVEALED_STYLE: React.CSSProperties = {
  background: "linear-gradient(145deg, #e6e2d8 0%, #efece4 100%)",
  border: "1px solid rgba(120,110,90,0.25)",
  boxShadow: "inset 0 1px 3px rgba(0,0,0,0.12)",
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
      sfxWin();
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
          sfxBoom();
          // 揭开所有雷
          for (let rr = 0; rr < ROWS; rr++) {
            for (let cc = 0; cc < COLS; cc++) {
              const x = next.cells[rr][cc];
              if (x.mine && x.state !== "flagged") x.state = "revealed";
            }
          }
          setOver(true);
          setWon(false);
        } else {
          sfxReveal();
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
          sfxFlag();
        } else if (target.state === "flagged") {
          target.state = "hidden";
          setFlags((f) => f - 1);
          sfxFlag();
        }
        return next;
      });
    },
    [over],
  );

  const minesLeft = useMemo(() => MINES - flags, [flags]);

  return (
    <GameFrame
      emoji="💣"
      title={i18n.text("game.minesweeper.title")}
      stats={[
        {
          label: i18n.text("game.minesweeper.minesLeft"),
          value: minesLeft,
          colors: CHIP_RED,
        },
        {
          label: i18n.text("game.minesweeper.time"),
          value: seconds,
          colors: CHIP_BLUE,
        },
      ]}
      headerExtra={
        <GhostBtn onClick={restart}>
          <ReloadOutlined />
          {i18n.text("game.minesweeper.restart")}
        </GhostBtn>
      }
      help={i18n.text("game.minesweeper.help")}
      maxWidth={400}
    >
      <div
        className={over && !won ? "gs-shake" : undefined}
        style={{
          padding: 10,
          background:
            "linear-gradient(145deg, #9fa6b5 0%, #7f8798 100%)",
          borderRadius: 12,
          boxShadow:
            "inset 0 2px 6px rgba(0,0,0,0.3), 0 6px 18px rgba(60,70,90,0.25)",
          position: "relative",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${COLS}, 32px)`,
            gridTemplateRows: `repeat(${ROWS}, 32px)`,
            gap: 3,
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
                    width: 32,
                    height: 32,
                    padding: 0,
                    borderRadius: 5,
                    ...(revealed ? REVEALED_STYLE : HIDDEN_STYLE),
                    color:
                      cell.mine && revealed
                        ? "#fff"
                        : NUMBER_COLORS[cell.adjacent] || "#5a5448",
                    fontSize: 15,
                    fontWeight: 800,
                    cursor: over ? "default" : "pointer",
                    userSelect: "none",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "transform 0.08s ease",
                  }}
                  onMouseDown={(e) => {
                    if (!revealed && !over)
                      e.currentTarget.style.transform = "translateY(1px)";
                  }}
                  onMouseUp={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                  }}
                >
                  {revealed ? (
                    cell.mine ? (
                      <span style={{ fontSize: 17, lineHeight: 1 }}>
                        💣
                      </span>
                    ) : cell.adjacent > 0 ? (
                      String(cell.adjacent)
                    ) : (
                      ""
                    )
                  ) : flagged ? (
                    <span style={{ fontSize: 15, lineHeight: 1 }}>🚩</span>
                  ) : (
                    ""
                  )}
                </button>
              );
            }),
          )}
        </div>

        {over && (
          <div
            className="gs-win-in"
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(250,248,244,0.82)",
              borderRadius: 12,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              alignItems: "center",
              justifyContent: "center",
              color: won ? "#2e9e44" : "#e5484d",
            }}
          >
            <div style={{ fontSize: 26, fontWeight: 900 }}>
              {won
                ? i18n.text("game.minesweeper.win")
                : i18n.text("game.minesweeper.lose")}
            </div>
            <div style={{ fontSize: 14, opacity: 0.8 }}>
              {i18n.text("game.minesweeper.usedSeconds", { seconds })}
            </div>
            <GhostBtn onClick={restart}>
              <ReloadOutlined />
              {i18n.text("game.minesweeper.again")}
            </GhostBtn>
          </div>
        )}
      </div>
    </GameFrame>
  );
};

export default MinesweeperGame;
