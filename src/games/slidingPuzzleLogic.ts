/*
 * slidingPuzzleLogic：数字华容道纯逻辑（不依赖 DOM / React）
 *
 * 棋盘用一维数组 tiles 表示（按行优先），0 表示空格：
 *   size=4 时目标局面为 [1..15, 0]（空格在右下角）。
 *
 * 关键规则：
 *   - 只能把与空格相邻（上下左右）的数字滑入空格
 *   - 洗牌通过「随机排列 + 奇偶校验修正」保证局面必然可解：
 *     奇数边长 → 逆序数为偶数即可解；
 *     偶数边长 → 逆序数 + 空格距底行数（1-based）为偶数即可解。
 */

export interface SlideBoard {
  /** 每边格子数（3 / 4 / 5） */
  size: number;
  /** 按行优先的一维数组，长度 = size²，0 表示空格 */
  tiles: number[];
}

export type SlideDir = "up" | "down" | "left" | "right";

/** 目标局面：1..n-1 顺序排列，空格在右下角 */
export function solvedBoard(size: number): SlideBoard {
  const count = size * size;
  const tiles = Array.from({ length: count }, (_, i) =>
    i === count - 1 ? 0 : i + 1,
  );
  return { size, tiles };
}

/** 空格所在下标（未找到返回 -1） */
export function emptyIndex(board: SlideBoard): number {
  return board.tiles.indexOf(0);
}

/** 与空格相邻、可滑入空格的数字下标列表 */
export function movableIndices(board: SlideBoard): number[] {
  const empty = emptyIndex(board);
  if (empty < 0) return [];
  const { size } = board;
  const r = Math.floor(empty / size);
  const c = empty % size;
  const result: number[] = [];
  if (r > 0) result.push(empty - size);
  if (r < size - 1) result.push(empty + size);
  if (c > 0) result.push(empty - 1);
  if (c < size - 1) result.push(empty + 1);
  return result;
}

/** 尝试把下标 index 的数字滑入空格；不合法时原样返回 */
export function moveTile(board: SlideBoard, index: number): SlideBoard {
  if (movableIndices(board).includes(index)) {
    const empty = emptyIndex(board);
    const tiles = board.tiles.slice();
    [tiles[empty], tiles[index]] = [tiles[index], tiles[empty]];
    return { size: board.size, tiles };
  }
  return board;
}

/** 按方向移动空格（↑ 空格上移，即上方数字滑下）；不可移动返回 null */
export function moveEmpty(board: SlideBoard, dir: SlideDir): SlideBoard | null {
  const empty = emptyIndex(board);
  if (empty < 0) return null;
  const { size } = board;
  const r = Math.floor(empty / size);
  const c = empty % size;
  let target = -1;
  if (dir === "up" && r > 0) target = empty - size;
  else if (dir === "down" && r < size - 1) target = empty + size;
  else if (dir === "left" && c > 0) target = empty - 1;
  else if (dir === "right" && c < size - 1) target = empty + 1;
  return target < 0 ? null : moveTile(board, target);
}

/** 逆序数（忽略空格） */
export function inversionCount(tiles: number[]): number {
  const vals = tiles.filter((t) => t !== 0);
  let inv = 0;
  for (let i = 0; i < vals.length; i++) {
    for (let j = i + 1; j < vals.length; j++) {
      if (vals[i] > vals[j]) inv++;
    }
  }
  return inv;
}

/**
 * 局面是否可解（目标：空格在右下角）
 *
 * 判定规则：
 *   - 奇数边长：不含空格的逆序数为偶数 → 可解
 *   - 偶数边长：逆序数 + 空格距底行数（1-based）为奇数 → 可解
 *     （等价于「含空格的排列逆序数 + 空格到右下角曼哈顿距离」为偶数）
 */
export function isSolvable(board: SlideBoard): boolean {
  const { size, tiles } = board;
  const inv = inversionCount(tiles);
  if (size % 2 === 1) return inv % 2 === 0;
  const emptyRowFromBottom = size - Math.floor(emptyIndex(board) / size);
  return (inv + emptyRowFromBottom) % 2 === 1;
}

/** 随机洗牌，保证结果可解（不可解时交换两个非空格数字翻转奇偶性） */
export function shuffleBoard(size: number, rand: () => number = Math.random): SlideBoard {
  const board = solvedBoard(size);
  const tiles = board.tiles.slice();
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  const shuffled: SlideBoard = { size, tiles };
  if (!isSolvable(shuffled)) {
    const idxs = tiles
      .map((t, i) => (t !== 0 ? i : -1))
      .filter((i) => i >= 0);
    [tiles[idxs[0]], tiles[idxs[1]]] = [tiles[idxs[1]], tiles[idxs[0]]];
  }
  return { size, tiles };
}

/** 是否已还原（数字 1..n-1 顺序排列、空格在右下角） */
export function isSolved(board: SlideBoard): boolean {
  const { size, tiles } = board;
  for (let i = 0; i < tiles.length - 1; i++) {
    if (tiles[i] !== i + 1) return false;
  }
  return tiles[tiles.length - 1] === 0;
}
