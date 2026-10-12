/*
 * Game2048：经典 2048（视觉升级版）
 *
 * 4x4 网格，方向键或 WASD 移动方块；相同数字合并，每次移动后随机
 * 生成 2 或 4。方块带渐变/高光/投影，合并与生成有弹跳动画；
 * 游戏结束时记录成绩（含最大方块）。
 */
import React, { useCallback, useEffect, useState } from "react";
import { ReloadOutlined } from "@ant-design/icons";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import { recordScore } from "../scoreClient";
import { useI18n } from "../hooks";
import GameFrame, { GhostBtn, CHIP_GOLD, CHIP_BLUE, CHIP_PURPLE } from "./GameFrame";
import "./gameAnimations.less";

type Grid = number[][]; // 4x4，0 表示空格
type Dir = "up" | "down" | "left" | "right";

const SIZE = 4;
const LS_BEST = "fat-games.2048.best";
const LS_BEST_TILE = "fat-games.2048.bestTile";

/** 空网格 */
function emptyGrid(): Grid {
  return Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(0));
}

/** 深拷贝 */
function clone(grid: Grid): Grid {
  return grid.map((row) => row.slice());
}

/** 取空格坐标 */
function emptyCells(grid: Grid): Array<[number, number]> {
  const cells: Array<[number, number]> = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (grid[r][c] === 0) cells.push([r, c]);
    }
  }
  return cells;
}

/** 在随机空格生成 2（90%）或 4（10%），返回生成位置 */
function spawnRandomAt(grid: Grid): [number, number] | null {
  const cells = emptyCells(grid);
  if (cells.length === 0) return null;
  const [r, c] = cells[Math.floor(Math.random() * cells.length)];
  grid[r][c] = Math.random() < 0.9 ? 2 : 4;
  return [r, c];
}

/** 一行向左合并：返回 [新行, 得分, 哪些输出位发生了合并] */
function mergeRow(
  row: number[],
): [number[], number, boolean[]] {
  const filtered = row.filter((v) => v !== 0);
  const out: number[] = [];
  const mergedFlag: boolean[] = [];
  let gained = 0;
  for (let i = 0; i < filtered.length; i++) {
    if (i + 1 < filtered.length && filtered[i] === filtered[i + 1]) {
      const merged = filtered[i] * 2;
      out.push(merged);
      mergedFlag.push(true);
      gained += merged;
      i++; // 跳过被合并的下一个
    } else {
      out.push(filtered[i]);
      mergedFlag.push(false);
    }
  }
  while (out.length < SIZE) {
    out.push(0);
    mergedFlag.push(false);
  }
  return [out, gained, mergedFlag];
}

/** 转置（用于 up/down 与 left/right 互换） */
function transpose(grid: Grid): Grid {
  const out = emptyGrid();
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) out[c][r] = grid[r][c];
  }
  return out;
}

/** 反转每一行（用于 right/down） */
function reverseRows(grid: Grid): Grid {
  return grid.map((row) => row.slice().reverse());
}

/** 按方向移动：返回 [是否移动, 得分, 合并格坐标]；原地修改 grid */
function moveFx(
  grid: Grid,
  dir: Dir,
): { moved: boolean; gained: number; merged: Array<[number, number]> } {
  const before = JSON.stringify(grid);
  let work = clone(grid);
  const transposed = dir === "up" || dir === "down";
  const reversed = dir === "right" || dir === "down";
  if (transposed) work = transpose(work);
  if (reversed) work = reverseRows(work);

  let gained = 0;
  const flags: boolean[][] = [];
  for (let r = 0; r < SIZE; r++) {
    const [merged, g, flag] = mergeRow(work[r]);
    work[r] = merged;
    flags.push(flag);
    gained += g;
  }

  if (reversed) work = reverseRows(work);
  if (transposed) work = transpose(work);

  // 把合并位映射回网格坐标
  const merged: Array<[number, number]> = [];
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      if (!flags[r][c]) continue;
      let gr = r;
      let gc = c;
      if (reversed) gc = SIZE - 1 - gc;
      if (transposed) {
        const t = gr;
        gr = gc;
        gc = t;
      }
      merged.push([gr, gc]);
    }
  }

  const moved = JSON.stringify(work) !== before;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) grid[r][c] = work[r][c];
  }
  return { moved, gained, merged };
}

/** 是否还有可合并的相邻同值方块（或空格） */
function hasMoves(grid: Grid): boolean {
  if (emptyCells(grid).length > 0) return true;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const v = grid[r][c];
      if (c + 1 < SIZE && grid[r][c + 1] === v) return true;
      if (r + 1 < SIZE && grid[r + 1][c] === v) return true;
    }
  }
  return false;
}

/** 最大方块值 */
function bestTile(grid: Grid): number {
  let best = 0;
  for (const row of grid) for (const v of row) if (v > best) best = v;
  return best;
}

/** 方块样式：值 → 背景 / 文字色 / 阴影 */
interface TileStyle {
  background: string;
  color: string;
  shadow: string;
}

const TILE_STYLES: Record<number, TileStyle> = {
  2: {
    background: "linear-gradient(135deg, #f3ecdf 0%, #eee4da 100%)",
    color: "#776e65",
    shadow: "0 2px 6px rgba(119,110,101,0.18)",
  },
  4: {
    background: "linear-gradient(135deg, #f0e3c4 0%, #ede0c8 100%)",
    color: "#776e65",
    shadow: "0 2px 6px rgba(119,110,101,0.22)",
  },
  8: {
    background: "linear-gradient(135deg, #f7b37c 0%, #f2a05f 100%)",
    color: "#fff",
    shadow: "0 3px 8px rgba(242,160,95,0.45)",
  },
  16: {
    background: "linear-gradient(135deg, #f79a68 0%, #f5824f 100%)",
    color: "#fff",
    shadow: "0 3px 8px rgba(245,130,79,0.5)",
  },
  32: {
    background: "linear-gradient(135deg, #f6805e 0%, #f5684a 100%)",
    color: "#fff",
    shadow: "0 3px 9px rgba(245,104,74,0.55)",
  },
  64: {
    background: "linear-gradient(135deg, #f46b43 0%, #f24f2c 100%)",
    color: "#fff",
    shadow: "0 4px 10px rgba(242,79,44,0.6)",
  },
  128: {
    background: "linear-gradient(135deg, #f5d870 0%, #edc53f 100%)",
    color: "#fff",
    shadow: "0 4px 12px rgba(237,197,63,0.6)",
  },
  256: {
    background: "linear-gradient(135deg, #f7d558 0%, #edc22e 100%)",
    color: "#fff",
    shadow: "0 4px 13px rgba(237,194,46,0.68)",
  },
  512: {
    background: "linear-gradient(135deg, #fbd64d 0%, #f0b71e 100%)",
    color: "#fff",
    shadow: "0 5px 14px rgba(240,183,30,0.72)",
  },
  1024: {
    background: "linear-gradient(135deg, #ffd94a 0%, #f0a916 100%)",
    color: "#fff",
    shadow: "0 5px 16px rgba(240,169,22,0.8)",
  },
  2048: {
    background: "linear-gradient(135deg, #ffe14d 0%, #f09000 100%)",
    color: "#fff",
    shadow: "0 5px 18px rgba(240,144,0,0.85)",
  },
};

function tileStyle(v: number): TileStyle {
  if (v === 0) {
    return {
      background: "rgba(238,228,218,0.32)",
      color: "transparent",
      shadow: "none",
    };
  }
  return TILE_STYLES[v] || {
    background: "linear-gradient(135deg, #4a4458 0%, #2d2936 100%)",
    color: "#fff",
    shadow: "0 4px 12px rgba(0,0,0,0.35)",
  };
}

function tileFontSize(v: number): number {
  if (v < 100) return 30;
  if (v < 1000) return 25;
  if (v < 10000) return 20;
  return 16;
}

/** 格子动画效果：key → 动画类型（pop 生成 / merge 合并） */
type CellFx = Record<string, { type: "pop" | "merge"; nonce: number }>;

const Game2048: React.FC<{ sdk: FatNotesPluginSDK }> = () => {
  const i18n = useI18n();
  const [grid, setGrid] = useState<Grid>(() => {
    const g = emptyGrid();
    spawnRandomAt(g);
    spawnRandomAt(g);
    return g;
  });
  const [fx, setFx] = useState<CellFx>({});
  const [score, setScore] = useState(0);
  const [best, setBest] = useState<number>(() => {
    const v = Number(window.localStorage.getItem(LS_BEST) || 0);
    return Number.isFinite(v) ? v : 0;
  });
  const [bestTileEver, setBestTileEver] = useState<number>(() => {
    const v = Number(window.localStorage.getItem(LS_BEST_TILE) || 0);
    return Number.isFinite(v) ? v : 0;
  });
  const [over, setOver] = useState(false);
  const [recorded, setRecorded] = useState(false);

  /** 移动并同步状态 */
  const doMove = useCallback(
    (dir: Dir) => {
      if (over) return;
      setGrid((prev) => {
        const next = clone(prev);
        const { moved, gained, merged } = moveFx(next, dir);
        if (!moved) return prev;
        const spawned = spawnRandomAt(next);

        // 记录动画：生成位 pop，合并位 merge
        const nextFx: CellFx = {};
        const nonce = Date.now() + Math.floor(Math.random() * 1000);
        if (spawned) nextFx[`${spawned[0]}-${spawned[1]}`] = { type: "pop", nonce };
        for (const [r, c] of merged) {
          nextFx[`${r}-${c}`] = { type: "merge", nonce: nonce + 1 };
        }
        setFx(nextFx);

        const newScore = score + gained;
        const tile = bestTile(next);
        setScore(newScore);

        // 更新最佳分数 / 最佳方块
        setBest((b) => {
          const nb = Math.max(b, newScore);
          if (nb !== b) window.localStorage.setItem(LS_BEST, String(nb));
          return nb;
        });
        setBestTileEver((bt) => {
          const nbt = Math.max(bt, tile);
          if (nbt !== bt) window.localStorage.setItem(LS_BEST_TILE, String(nbt));
          return nbt;
        });

        if (!hasMoves(next)) {
          setOver(true);
          if (!recorded) {
            setRecorded(true);
            recordScore({
              gameId: "2048",
              gameTitle: "2048",
              score: newScore,
              detail: { bestTile: tile },
            });
          }
        }
        return next;
      });
    },
    [over, score, recorded],
  );

  /** 重启 */
  const restart = useCallback(() => {
    const g = emptyGrid();
    spawnRandomAt(g);
    spawnRandomAt(g);
    setGrid(g);
    setFx({});
    setScore(0);
    setOver(false);
    setRecorded(false);
  }, []);

  /** 键盘绑定 */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      let dir: Dir | null = null;
      if (key === "arrowup" || key === "w") dir = "up";
      else if (key === "arrowdown" || key === "s") dir = "down";
      else if (key === "arrowleft" || key === "a") dir = "left";
      else if (key === "arrowright" || key === "d") dir = "right";
      if (!dir) return;
      e.preventDefault();
      doMove(dir);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [doMove]);

  const CELL = 92;

  return (
    <GameFrame
      emoji="🧩"
      title="2048"
      stats={[
        { label: i18n.text("game.2048.score"), value: score, colors: CHIP_GOLD },
        { label: i18n.text("game.2048.best"), value: best, colors: CHIP_BLUE },
        {
          label: i18n.text("game.2048.bestTile"),
          value: bestTileEver,
          colors: CHIP_PURPLE,
        },
      ]}
      headerExtra={
        <GhostBtn onClick={restart}>
          <ReloadOutlined />
          {i18n.text("game.2048.restart")}
        </GhostBtn>
      }
      help={i18n.text("game.2048.help")}
      maxWidth={470}
    >
      <div
        style={{
          position: "relative",
          background: "linear-gradient(145deg, #c3b6a6 0%, #b3a392 100%)",
          borderRadius: 14,
          padding: 10,
          boxShadow:
            "inset 0 2px 8px rgba(0,0,0,0.28), 0 6px 20px rgba(90,70,40,0.22)",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${SIZE}, ${CELL}px)`,
            gridTemplateRows: `repeat(${SIZE}, ${CELL}px)`,
            gap: 10,
          }}
        >
          {grid.flatMap((row, r) =>
            row.map((v, c) => {
              const fxKey = `${r}-${c}`;
              const fxItem = fx[fxKey];
              const style = tileStyle(v);
              return (
                <div
                  key={fxItem ? `${fxKey}#${fxItem.nonce}` : fxKey}
                  className={
                    fxItem
                      ? fxItem.type === "merge"
                        ? "gs-tile-merge"
                        : "gs-tile-pop"
                      : undefined
                  }
                  style={{
                    width: CELL,
                    height: CELL,
                    background: style.background,
                    color: style.color,
                    fontSize: tileFontSize(v),
                    fontWeight: 800,
                    borderRadius: 9,
                    boxShadow: style.shadow,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    userSelect: "none",
                    textShadow:
                      v >= 8 ? "0 1px 2px rgba(0,0,0,0.22)" : "none",
                  }}
                >
                  {v === 0 ? "" : v}
                </div>
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
              background: "rgba(250,246,238,0.82)",
              borderRadius: 14,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              alignItems: "center",
              justifyContent: "center",
              color: "#776e65",
            }}
          >
            <div style={{ fontSize: 30, fontWeight: 900 }}>
              {i18n.text("game.2048.over")}
            </div>
            <div style={{ fontSize: 14, opacity: 0.75 }}>
              {i18n.text("game.2048.score")}：{score} ·{" "}
              {i18n.text("game.2048.bestTile")}：{bestTileEver}
            </div>
            <GhostBtn onClick={restart}>
              <ReloadOutlined />
              {i18n.text("game.2048.again")}
            </GhostBtn>
          </div>
        )}
      </div>
    </GameFrame>
  );
};

export default Game2048;
