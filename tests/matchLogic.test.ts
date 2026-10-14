/*
 * matchLogic（快乐消消 / 三消）单元测试
 *
 * 覆盖：棋盘生成无预置匹配、匹配检测（横向/纵向/交叉去重）、交换与相邻判定、
 * 消除后下落补块、可走性判定、提示、计分、洗牌收敛。
 */
import { describe, expect, it } from "vitest";
import {
  cellIndex,
  cellPos,
  createBoard,
  findHintMove,
  findMatches,
  findRuns,
  fixNoMoveBoard,
  hasAnyMove,
  isAdjacent,
  removeAndRefill,
  scoreForRuns,
  shuffleBoard,
  swapCells,
  wouldMatch,
  type MatchBoard,
} from "../src/games/matchLogic";

/** 确定性伪随机（mulberry32），避免测试依赖 Math.random */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function make(rows: number, cols: number, cells?: number[]): MatchBoard {
  return { rows, cols, kinds: 6, cells: cells ?? new Array(rows * cols).fill(0) };
}

describe("createBoard", () => {
  it("默认 8x8、64 格、类型均在合法范围", () => {
    const b = createBoard(8, 8, 6, mulberry32(1));
    expect(b.cells).toHaveLength(64);
    expect(b.rows).toBe(8);
    expect(b.cols).toBe(8);
    for (const k of b.cells) {
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThan(6);
    }
  });

  it("初始棋盘不含任何预置匹配", () => {
    for (let seed = 0; seed < 20; seed++) {
      const b = createBoard(8, 8, 6, mulberry32(seed));
      expect(findRuns(b)).toHaveLength(0);
    }
  });

  it("任意尺寸生成均合法", () => {
    const b = createBoard(5, 6, 4, mulberry32(7));
    expect(b.cells).toHaveLength(30);
    expect(findRuns(b)).toHaveLength(0);
  });
});

describe("findRuns / findMatches", () => {
  it("检测横向三连", () => {
    // row0: 0 0 0 1
    const b = make(2, 4, [0, 0, 0, 1, 2, 3, 4, 5]);
    const runs = findRuns(b);
    expect(runs).toHaveLength(1);
    expect(runs[0].dir).toBe("h");
    expect(runs[0].indices).toEqual([0, 1, 2]);
  });

  it("检测纵向四连", () => {
    // col0: 2 2 2 2
    const b = make(4, 2, [2, 0, 2, 1, 2, 3, 2, 4]);
    const runs = findRuns(b);
    expect(runs).toHaveLength(1);
    expect(runs[0].dir).toBe("v");
    expect(runs[0].indices).toEqual([0, 2, 4, 6]);
  });

  it("检测十字交叉：两组匹配、去重后 5 格", () => {
    // 5x5：r2c0-r2c2 与 r0c2-r2c2 均为 1（十字），其余无任何三连
    const b = make(5, 5, [
      2, 3, 1, 4, 2,
      4, 2, 1, 3, 4,
      1, 1, 1, 2, 3,
      3, 4, 2, 3, 4,
      2, 3, 4, 2, 3,
    ]);
    const runs = findRuns(b);
    expect(runs).toHaveLength(2);
    const cleared = findMatches(b);
    expect(cleared).toHaveLength(5);
    expect(cleared.sort((a, x) => a - x)).toEqual([2, 7, 10, 11, 12]);
  });

  it("两个同色不相连不构成匹配", () => {
    const b = make(1, 4, [0, 1, 0, 1]);
    expect(findRuns(b)).toHaveLength(0);
  });
});

describe("swapCells / isAdjacent / wouldMatch", () => {
  it("交换两个格子的值并返回新对象", () => {
    const b = make(2, 3, [0, 1, 2, 3, 4, 5]);
    const nb = swapCells(b, 0, 1);
    expect(nb.cells[0]).toBe(1);
    expect(nb.cells[1]).toBe(0);
    expect(b.cells[0]).toBe(0); // 原棋盘不变（不可变）
    expect(nb).not.toBe(b);
  });

  it("相同下标 / 越界交换原样返回", () => {
    const b = make(2, 2, [0, 1, 2, 3]);
    expect(swapCells(b, 1, 1)).toBe(b);
    expect(swapCells(b, 0, 99)).toBe(b);
  });

  it("相邻判定：上下左右为邻，对角/同格不为邻", () => {
    const b = make(3, 3);
    expect(isAdjacent(b, 0, 1)).toBe(true);
    expect(isAdjacent(b, 0, 3)).toBe(true);
    expect(isAdjacent(b, 0, 4)).toBe(false);
    expect(isAdjacent(b, 0, 0)).toBe(false);
    expect(isAdjacent(b, 4, 8)).toBe(false);
  });

  it("交换后能成三连则 wouldMatch 为真", () => {
    // row0: 0 0 1 / row1: 0 1 2 / row2: 3 4 1
    // 交换 (1,1)=1 与 (1,2)=2 → col2 变为 1 1 1
    const b = make(3, 3, [0, 0, 1, 0, 1, 2, 3, 4, 1]);
    expect(findRuns(b)).toHaveLength(0);
    expect(wouldMatch(b, cellIndex(b, 1, 1), cellIndex(b, 1, 2))).toBe(true);
  });
});

describe("removeAndRefill", () => {
  it("消除后列内下落、顶部补块、棋盘仍满", () => {
    // 3x3：row0 全为 0 → 消除 row0；幸存下落，顶部补 3 块
    const b = make(3, 3, [0, 0, 0, 1, 2, 3, 4, 5, 0]);
    const cleared = new Set([0, 1, 2]);
    const { board: nb, spawned } = removeAndRefill(b, cleared, mulberry32(5));
    expect(spawned).toBe(3);
    expect(nb.cells).toHaveLength(9);
    for (const k of nb.cells) {
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThan(6);
    }
    // 列内下落：col0 = [新, 1, 4]、col1 = [新, 2, 5]、col2 = [新, 3, 0]
    expect(nb.cells[cellIndex(nb, 1, 0)]).toBe(1);
    expect(nb.cells[cellIndex(nb, 2, 0)]).toBe(4);
    expect(nb.cells[cellIndex(nb, 1, 1)]).toBe(2);
    expect(nb.cells[cellIndex(nb, 2, 1)]).toBe(5);
    expect(nb.cells[cellIndex(nb, 1, 2)]).toBe(3);
    expect(nb.cells[cellIndex(nb, 2, 2)]).toBe(0);
  });

  it("整列消除时整列补新块", () => {
    const b = make(3, 2, [0, 1, 0, 2, 0, 3]);
    const cleared = new Set([0, 2, 4]); // col0 全部
    const { board: nb, spawned } = removeAndRefill(b, cleared, mulberry32(9));
    expect(spawned).toBe(3);
    expect(nb.cells.length).toBe(6);
    // 未被消除的 col1 保持不变
    expect(nb.cells[cellIndex(nb, 0, 1)]).toBe(1);
    expect(nb.cells[cellIndex(nb, 1, 1)]).toBe(2);
    expect(nb.cells[cellIndex(nb, 2, 1)]).toBe(3);
  });
});

describe("hasAnyMove / findHintMove / fixNoMoveBoard", () => {
  it("存在可消除交换时 hasAnyMove 为真且提示给出相邻对", () => {
    const b = make(3, 3, [0, 0, 1, 0, 1, 2, 3, 4, 1]);
    expect(hasAnyMove(b)).toBe(true);
    const hint = findHintMove(b);
    expect(hint).not.toBeNull();
    const [a, x] = hint as [number, number];
    expect(isAdjacent(b, a, x)).toBe(true);
    expect(wouldMatch(b, a, x)).toBe(true);
  });

  it("无可用步棋盘经 fixNoMoveBoard 修复后必有步可走", () => {
    // 手工构造一个「交换任意相邻对都不成三连」的局面：
    // 3x3 使用 6 类，每格与其左右/上下都不存在凑三连的可能（两两不同且相邻亦不同）
    const b = make(3, 3, [0, 1, 2, 3, 4, 5, 0, 2, 1]);
    expect(hasAnyMove(b)).toBe(false);
    const fixed = fixNoMoveBoard(b, mulberry32(3));
    expect(findRuns(fixed)).toHaveLength(0);
    expect(hasAnyMove(fixed)).toBe(true);
  });
});

describe("shuffleBoard", () => {
  it("洗牌后无预置匹配且至少一步可走", () => {
    const b = createBoard(8, 8, 6, mulberry32(11));
    for (let i = 0; i < 10; i++) {
      const s = shuffleBoard(b, mulberry32(100 + i));
      expect(s.cells).toHaveLength(64);
      expect(findRuns(s)).toHaveLength(0);
      expect(hasAnyMove(s)).toBe(true);
    }
  });

  it("保持类型种类与总数不变", () => {
    const b = createBoard(8, 8, 6, mulberry32(21));
    const count = (cells: number[]) => {
      const m = new Map<number, number>();
      for (const k of cells) m.set(k, (m.get(k) || 0) + 1);
      return m;
    };
    const before = count(b.cells);
    const after = count(shuffleBoard(b, mulberry32(31)).cells);
    for (const [k, n] of before) expect(after.get(k)).toBe(n);
  });
});

describe("scoreForRuns", () => {
  it("三连 30 分、四连 60 分、五连 90 分", () => {
    const run3 = { kind: 0, dir: "h" as const, indices: [0, 1, 2] };
    const run4 = { kind: 1, dir: "h" as const, indices: [0, 1, 2, 3] };
    const run5 = { kind: 2, dir: "h" as const, indices: [0, 1, 2, 3, 4] };
    expect(scoreForRuns([run3])).toBe(30);
    expect(scoreForRuns([run4])).toBe(60);
    expect(scoreForRuns([run5])).toBe(90);
  });

  it("多组匹配累加，级联倍数生效", () => {
    const runA = { kind: 0, dir: "h" as const, indices: [0, 1, 2] };
    const runB = { kind: 1, dir: "v" as const, indices: [0, 3, 6] };
    expect(scoreForRuns([runA, runB])).toBe(60);
    expect(scoreForRuns([runA], 2)).toBe(60);
    expect(scoreForRuns([runA, runB], 3)).toBe(180);
  });

  it("cellIndex / cellPos 互逆", () => {
    const b = make(8, 8);
    expect(cellPos(b, 13)).toEqual({ r: 1, c: 5 });
    expect(cellIndex(b, 1, 5)).toBe(13);
  });
});
