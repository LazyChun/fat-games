/*
 * Game2048：经典 2048
 *
 * 4x4 网格，方向键或 WASD 移动方块；相同数字合并，每次移动后随机
 * 生成 2 或 4。游戏结束时记录成绩（含最大方块）。
 */
import React, { useCallback, useEffect, useState } from "react";
import { Button, Card, Statistic } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import { recordScore } from "../scoreClient";
import { useI18n } from "../hooks";

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

/** 在随机空格生成 2（90%）或 4（10%），返回是否还有空格 */
function spawnRandom(grid: Grid): boolean {
  const cells = emptyCells(grid);
  if (cells.length === 0) return false;
  const [r, c] = cells[Math.floor(Math.random() * cells.length)];
  grid[r][c] = Math.random() < 0.9 ? 2 : 4;
  return true;
}

/** 一行向左合并：返回 [新行, 本次得分] */
function mergeRow(row: number[]): [number[], number] {
  const filtered = row.filter((v) => v !== 0);
  const out: number[] = [];
  let gained = 0;
  for (let i = 0; i < filtered.length; i++) {
    if (i + 1 < filtered.length && filtered[i] === filtered[i + 1]) {
      const merged = filtered[i] * 2;
      out.push(merged);
      gained += merged;
      i++; // 跳过被合并的下一个
    } else {
      out.push(filtered[i]);
    }
  }
  while (out.length < SIZE) out.push(0);
  return [out, gained];
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

/** 按方向移动：返回 [moved, gained]；原地修改 grid */
function move(grid: Grid, dir: Dir): [boolean, number] {
  const before = JSON.stringify(grid);
  let work = clone(grid);
  if (dir === "up" || dir === "down") work = transpose(work);
  if (dir === "right" || dir === "down") work = reverseRows(work);

  let gained = 0;
  for (let r = 0; r < SIZE; r++) {
    const [merged, g] = mergeRow(work[r]);
    work[r] = merged;
    gained += g;
  }

  if (dir === "right" || dir === "down") work = reverseRows(work);
  if (dir === "up" || dir === "down") work = transpose(work);

  const moved = JSON.stringify(work) !== before;
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) grid[r][c] = work[r][c];
  }
  return [moved, gained];
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

/** 方块颜色：值 → 背景 */
const TILE_COLORS: Record<number, string> = {
  2: "#eee4da",
  4: "#ede0c8",
  8: "#f2b179",
  16: "#f59563",
  32: "#f67c5f",
  64: "#f65e3b",
  128: "#edcf72",
  256: "#edcc61",
  512: "#edc850",
  1024: "#edc53f",
  2048: "#edc22e",
};
function tileColor(v: number): string {
  if (v === 0) return "rgba(238,228,218,0.35)";
  return TILE_COLORS[v] || "#3c3a32";
}
function tileFontColor(v: number): string {
  return v <= 4 ? "#776e65" : "#fff";
}
function tileFontSize(v: number): number {
  if (v < 100) return 28;
  if (v < 1000) return 24;
  if (v < 10000) return 20;
  return 16;
}

const Game2048: React.FC<{ sdk: FatNotesPluginSDK }> = () => {
  const i18n = useI18n();
  const [grid, setGrid] = useState<Grid>(() => {
    const g = emptyGrid();
    spawnRandom(g);
    spawnRandom(g);
    return g;
  });
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
        const [moved, gained] = move(next, dir);
        if (!moved) return prev;
        spawnRandom(next);
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
          if (nbt !== bt)
            window.localStorage.setItem(LS_BEST_TILE, String(nbt));
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
    spawnRandom(g);
    spawnRandom(g);
    setGrid(g);
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Card size="small" style={{ flex: 1 }}>
          <Statistic title={i18n.text("game.2048.score")} value={score} />
        </Card>
        <Card size="small" style={{ flex: 1 }}>
          <Statistic title={i18n.text("game.2048.best")} value={best} />
        </Card>
        <Card size="small" style={{ flex: 1 }}>
          <Statistic
            title={i18n.text("game.2048.bestTile")}
            value={bestTileEver}
          />
        </Card>
        <Button type="primary" icon={<ReloadOutlined />} onClick={restart}>
          {i18n.text("game.2048.restart")}
        </Button>
      </div>

      <div
        style={{
          position: "relative",
          background: "rgba(143,122,102,0.15)",
          borderRadius: 8,
          padding: 10,
          width: 440,
          alignSelf: "flex-start",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${SIZE}, 90px)`,
            gridTemplateRows: `repeat(${SIZE}, 90px)`,
            gap: 10,
          }}
        >
          {grid.flatMap((row, r) =>
            row.map((v, c) => (
              <div
                key={`${r}-${c}`}
                style={{
                  width: 90,
                  height: 90,
                  background: tileColor(v),
                  color: tileFontColor(v),
                  fontSize: tileFontSize(v),
                  fontWeight: 700,
                  borderRadius: 6,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  userSelect: "none",
                  transition: "background 0.12s ease",
                }}
              >
                {v === 0 ? "" : v}
              </div>
            )),
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
              gap: 12,
              alignItems: "center",
              justifyContent: "center",
              color: "#776e65",
            }}
          >
            <div style={{ fontSize: 28, fontWeight: 800 }}>
              {i18n.text("game.2048.over")}
            </div>
            <Button type="primary" icon={<ReloadOutlined />} onClick={restart}>
              {i18n.text("game.2048.again")}
            </Button>
          </div>
        )}
      </div>

      <div style={{ color: "rgba(0,0,0,0.55)", fontSize: 12 }}>
        {i18n.text("game.2048.help")}
      </div>
    </div>
  );
};

export default Game2048;
