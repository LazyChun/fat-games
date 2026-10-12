/*
 * slidingPuzzleLogic（数字华容道）单元测试
 *
 * 覆盖：目标局面、逆序数、可解性判定、洗牌可解性、移动合法性、
 * 方向移动边界与胜利判定。
 */
import { describe, expect, it } from "vitest";
import {
  emptyIndex,
  inversionCount,
  isSolvable,
  isSolved,
  movableIndices,
  moveEmpty,
  moveTile,
  shuffleBoard,
  solvedBoard,
  type SlideBoard,
} from "../src/games/slidingPuzzleLogic";

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

function board(size: number, tiles: number[]): SlideBoard {
  return { size, tiles };
}

describe("solvedBoard / isSolved", () => {
  it("生成 3x3 目标局面：1..8 顺序，空格在末尾", () => {
    expect(solvedBoard(3).tiles).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 0]);
  });

  it("生成 4x4 目标局面：1..15 顺序，空格在末尾", () => {
    expect(solvedBoard(4).tiles).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0,
    ]);
  });

  it("目标局面判定为已还原", () => {
    expect(isSolved(solvedBoard(4))).toBe(true);
  });

  it("打乱局面判定为未还原", () => {
    expect(isSolved(board(3, [1, 2, 3, 4, 5, 6, 7, 0, 8]))).toBe(false);
  });
});

describe("inversionCount", () => {
  it("顺序排列逆序数为 0", () => {
    expect(inversionCount([1, 2, 3, 4])).toBe(0);
  });

  it("忽略空格计算", () => {
    expect(inversionCount([0, 1, 2, 3])).toBe(0);
  });

  it("倒序排列逆序数为 C(n,2)", () => {
    expect(inversionCount([4, 3, 2, 1])).toBe(6);
  });
});

describe("isSolvable", () => {
  it("3x3：不含空格逆序数为偶数时可解", () => {
    // [1,2,3,4,5,6,8,7,0]：仅 8>7 一组逆序（奇数）→ 不可解
    expect(isSolvable(board(3, [1, 2, 3, 4, 5, 6, 8, 7, 0]))).toBe(false);
    // [1,2,3,4,5,6,7,8,0]：逆序数 0（偶数）→ 可解
    expect(isSolvable(board(3, [1, 2, 3, 4, 5, 6, 7, 8, 0]))).toBe(true);
  });

  it("4x4 目标局面：逆序数 0 + 距底 1 行 = 奇数 → 可解", () => {
    expect(isSolvable(solvedBoard(4))).toBe(true);
  });

  it("4x4 从目标走一步（15 左滑）：逆序数 0 + 距底 1 行 = 奇数 → 可解", () => {
    const one = moveTile(solvedBoard(4), 14);
    expect(one.tiles[14]).toBe(0);
    expect(isSolvable(one)).toBe(true);
  });

  it("4x4 从目标走两步：逆序数 3 + 距底 2 行 = 奇数 → 可解", () => {
    let b = solvedBoard(4);
    b = moveTile(b, 14); // 15 左滑入空格
    b = moveTile(b, 10); // 11 下滑入空格
    expect(isSolvable(b)).toBe(true);
  });

  it("4x4 交换两数字翻转奇偶性后不可解", () => {
    const tiles = solvedBoard(4).tiles.slice();
    [tiles[0], tiles[1]] = [tiles[1], tiles[0]]; // 交换 1 和 2 → 逆序数 1，距底 1 行，和为 2（偶数）
    expect(isSolvable(board(4, tiles))).toBe(false);
  });
});

describe("shuffleBoard", () => {
  it.each([3, 4, 5])("size=%i 洗牌结果必然可解且含唯一空格", (size) => {
    const rand = mulberry32(20261013);
    for (let k = 0; k < 50; k++) {
      const b = shuffleBoard(size, rand);
      expect(b.tiles.length).toBe(size * size);
      expect(b.tiles.filter((t) => t === 0).length).toBe(1);
      expect(new Set(b.tiles).size).toBe(size * size);
      expect(isSolvable(b)).toBe(true);
    }
  });

  it("洗牌结果基本不会是已还原局面", () => {
    const rand = mulberry32(7);
    const b = shuffleBoard(4, rand);
    expect(isSolved(b)).toBe(false);
  });
});

describe("moveTile / movableIndices", () => {
  it("只允许滑动与空格相邻的数字", () => {
    const b = board(3, [1, 2, 3, 4, 0, 5, 6, 7, 8]); // 空格在中心
    expect(movableIndices(b).sort((a, b) => a - b)).toEqual([1, 3, 5, 7]);
  });

  it("角落空格的可移动下标", () => {
    const b = board(3, [1, 2, 3, 4, 5, 6, 7, 8, 0]); // 空格在右下角
    expect(movableIndices(b).sort((a, b) => a - b)).toEqual([5, 7]);
  });

  it("移动合法数字返回新棋盘（不修改原棋盘）", () => {
    const b = board(3, [1, 2, 3, 4, 0, 5, 6, 7, 8]);
    const next = moveTile(b, 3);
    expect(next.tiles).toEqual([1, 2, 3, 0, 4, 5, 6, 7, 8]);
    expect(b.tiles).toEqual([1, 2, 3, 4, 0, 5, 6, 7, 8]);
  });

  it("移动非相邻数字时原样返回", () => {
    const b = board(3, [1, 2, 3, 4, 0, 5, 6, 7, 8]);
    expect(moveTile(b, 0).tiles).toEqual(b.tiles);
    expect(moveTile(b, 8).tiles).toEqual(b.tiles);
  });
});

describe("moveEmpty", () => {
  it("方向键移动等价于滑动对应数字", () => {
    const b = board(3, [1, 2, 3, 4, 0, 5, 6, 7, 8]); // 空格中心
    // ↑ 空格上移：上方数字 2 滑下
    expect(moveEmpty(b, "up")?.tiles).toEqual([1, 0, 3, 4, 2, 5, 6, 7, 8]);
    // ↓ 空格下移：下方数字 7 滑上
    expect(moveEmpty(b, "down")?.tiles).toEqual([1, 2, 3, 4, 7, 5, 6, 0, 8]);
    // ← 空格左移：左侧数字 4 滑右
    expect(moveEmpty(b, "left")?.tiles).toEqual([1, 2, 3, 0, 4, 5, 6, 7, 8]);
    // → 空格右移：右侧数字 5 滑左
    expect(moveEmpty(b, "right")?.tiles).toEqual([1, 2, 3, 4, 5, 0, 6, 7, 8]);
  });

  it("边界方向返回 null", () => {
    const b = board(3, [1, 2, 3, 4, 5, 6, 7, 8, 0]); // 空格右下角
    expect(moveEmpty(b, "down")).toBeNull();
    expect(moveEmpty(b, "right")).toBeNull();
    expect(moveEmpty(b, "up")).not.toBeNull();
    expect(moveEmpty(b, "left")).not.toBeNull();
  });

  it("从打乱局面走回目标可还原（多步验证）", () => {
    // 手动构造一个 3x3 可解局面：从目标沿确定路径打乱 3 步，再逆序还原
    let b = solvedBoard(3);
    b = moveTile(b, 7); // 8 上滑
    b = moveTile(b, 4); // 5 下滑
    b = moveTile(b, 3); // 4 右滑
    expect(isSolved(b)).toBe(false);
    // 逆序还原：4 左滑 → 5 上滑 → 8 左滑
    b = moveEmpty(b, "right")!; // 空格右移（4 左滑回）
    b = moveEmpty(b, "down")!; // 空格下移（5 上滑回）
    b = moveEmpty(b, "right")!; // 空格右移（8 左滑回）
    expect(isSolved(b)).toBe(true);
    expect(emptyIndex(b)).toBe(8);
  });
});
