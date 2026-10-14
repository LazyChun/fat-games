/*
 * matchLogic：快乐消消（三消）纯逻辑（不依赖 DOM / React）
 *
 * 棋盘用一维数组 cells 表示（按行优先），值为方块类型 0..kinds-1：
 *   rows=8, cols=8, kinds=6（默认）
 *
 * 关键规则：
 *   - 交换相邻两个方块后，横向或纵向出现 ≥3 个同色方块即消除
 *   - 消除后上方方块下落填补，顶部随机补充新方块，级联继续消除
 *   - 初始棋盘与洗牌均保证：不存在预置匹配、且至少存在一步可消除的交换
 *   - 计分：每组匹配 10×长度 + (长度-3)×20，再乘级联倍数（第 1 次 ×1、第 2 次 ×2…）
 */

export interface MatchBoard {
  /** 行数 */
  rows: number;
  /** 列数 */
  cols: number;
  /** 方块类型数 */
  kinds: number;
  /** 按行优先的一维数组，长度 = rows×cols，值为 0..kinds-1 */
  cells: number[];
}

/** 一次匹配（一条横向或纵向的 ≥3 连） */
export interface MatchRun {
  kind: number;
  /** 方向：h 横向 / v 纵向 */
  dir: "h" | "v";
  /** 该连包含的格子下标（行优先） */
  indices: number[];
}

export const DEFAULT_ROWS = 8;
export const DEFAULT_COLS = 8;
export const DEFAULT_KINDS = 6;

/** 行列 → 一维下标 */
export function cellIndex(board: Pick<MatchBoard, "cols">, r: number, c: number): number {
  return r * board.cols + c;
}

/** 下标 → 行列 */
export function cellPos(board: Pick<MatchBoard, "cols">, i: number): { r: number; c: number } {
  return { r: Math.floor(i / board.cols), c: i % board.cols };
}

/** 是否越界 */
export function inBounds(board: Pick<MatchBoard, "rows" | "cols">, r: number, c: number): boolean {
  return r >= 0 && r < board.rows && c >= 0 && c < board.cols;
}

/** 两个下标是否相邻（上下左右，非对角） */
export function isAdjacent(board: Pick<MatchBoard, "cols">, a: number, b: number): boolean {
  if (a === b) return false;
  const pa = cellPos(board, a);
  const pb = cellPos(board, b);
  return Math.abs(pa.r - pb.r) + Math.abs(pa.c - pb.c) === 1;
}

/**
 * 生成无预置匹配的棋盘：逐格填充时避开「与左侧两格同色」和「与上方两格同色」，
 * 保证初始局面不包含任何 ≥3 连。
 */
export function createBoard(
  rows: number,
  cols: number,
  kinds: number,
  rand: () => number = Math.random,
): MatchBoard {
  const cells = new Array<number>(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      const banned = new Set<number>();
      if (c >= 2 && cells[i - 1] === cells[i - 2]) banned.add(cells[i - 1]);
      if (r >= 2 && cells[i - cols] === cells[i - 2 * cols]) banned.add(cells[i - cols]);
      let k = Math.floor(rand() * kinds);
      let guard = 0;
      while (banned.has(k) && guard < 32) {
        k = Math.floor(rand() * kinds);
        guard++;
      }
      if (banned.has(k)) {
        // 极端兜底：直接选第一个未被禁用的类型
        k = 0;
        while (banned.has(k)) k++;
      }
      cells[i] = k;
    }
  }
  return { rows, cols, kinds, cells };
}

/** 找出棋盘上所有 ≥3 连（横向 + 纵向） */
export function findRuns(board: MatchBoard): MatchRun[] {
  const { rows, cols, cells } = board;
  const runs: MatchRun[] = [];
  // 横向
  for (let r = 0; r < rows; r++) {
    let start = 0;
    while (start < cols) {
      const k = cells[r * cols + start];
      let end = start + 1;
      while (end < cols && cells[r * cols + end] === k) end++;
      if (end - start >= 3) {
        const indices: number[] = [];
        for (let c = start; c < end; c++) indices.push(r * cols + c);
        runs.push({ kind: k, dir: "h", indices });
      }
      start = end;
    }
  }
  // 纵向
  for (let c = 0; c < cols; c++) {
    let start = 0;
    while (start < rows) {
      const k = cells[start * cols + c];
      let end = start + 1;
      while (end < rows && cells[end * cols + c] === k) end++;
      if (end - start >= 3) {
        const indices: number[] = [];
        for (let r = start; r < end; r++) indices.push(r * cols + c);
        runs.push({ kind: k, dir: "v", indices });
      }
      start = end;
    }
  }
  return runs;
}

/** 参与匹配的所有格子下标（去重，用于整格消除） */
export function findMatches(board: MatchBoard): number[] {
  const set = new Set<number>();
  for (const run of findRuns(board)) {
    for (const i of run.indices) set.add(i);
  }
  return Array.from(set);
}

/** 交换两个格子（任意两格；调用方保证合法） */
export function swapCells(board: MatchBoard, a: number, b: number): MatchBoard {
  if (a === b || a < 0 || b < 0 || a >= board.cells.length || b >= board.cells.length) {
    return board;
  }
  const cells = board.cells.slice();
  [cells[a], cells[b]] = [cells[b], cells[a]];
  return { rows: board.rows, cols: board.cols, kinds: board.kinds, cells };
}

/** 交换 a、b 后是否会产生匹配 */
export function wouldMatch(board: MatchBoard, a: number, b: number): boolean {
  return findRuns(swapCells(board, a, b)).length > 0;
}

/** 棋盘上是否存在至少一步可消除的交换 */
export function hasAnyMove(board: MatchBoard): boolean {
  const { rows, cols } = board;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (c + 1 < cols && wouldMatch(board, i, i + 1)) return true;
      if (r + 1 < rows && wouldMatch(board, i, i + cols)) return true;
    }
  }
  return false;
}

/** 找到第一步可消除的交换，返回 [a, b]；无解返回 null（供「提示」功能使用） */
export function findHintMove(board: MatchBoard): [number, number] | null {
  const { rows, cols } = board;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (c + 1 < cols && wouldMatch(board, i, i + 1)) return [i, i + 1];
      if (r + 1 < rows && wouldMatch(board, i, i + cols)) return [i, i + cols];
    }
  }
  return null;
}

/**
 * 一步消除：把 cleared 中的格子移除，上方方块下落、顶部随机补块。
 * 返回新棋盘与补充的方块数（补充可能产生新匹配，由调用方继续级联）。
 */
export function removeAndRefill(
  board: MatchBoard,
  cleared: ReadonlySet<number>,
  rand: () => number = Math.random,
): { board: MatchBoard; spawned: number } {
  const { rows, cols, kinds, cells } = board;
  const next = cells.slice();
  let spawned = 0;
  for (let c = 0; c < cols; c++) {
    // 自底向上收集幸存方块
    const kept: number[] = [];
    for (let r = rows - 1; r >= 0; r--) {
      const i = r * cols + c;
      if (!cleared.has(i)) kept.push(cells[i]);
    }
    // 顶部补随机块
    while (kept.length < rows) {
      kept.push(Math.floor(rand() * kinds));
      spawned++;
    }
    // 回填该列（kept[0] 在最底行）
    for (let r = 0; r < rows; r++) {
      next[r * cols + c] = kept[rows - 1 - r];
    }
  }
  return { board: { rows, cols, kinds, cells: next }, spawned };
}

/** 计分：每组 10×长度 + (长度-3)×20，再乘级联倍数（cascade ≥ 1） */
export function scoreForRuns(runs: MatchRun[], cascade = 1): number {
  let raw = 0;
  for (const run of runs) {
    const len = run.indices.length;
    raw += len * 10 + (len - 3) * 20;
  }
  return raw * Math.max(1, cascade);
}

/** 把无可用步的棋盘修复为「无预置匹配且至少一步可走」 */
export function fixNoMoveBoard(
  board: MatchBoard,
  rand: () => number = Math.random,
): MatchBoard {
  const { rows, cols, kinds } = board;
  // 尝试只改一个格子的类型来制造一步可走的局面
  for (let i = 0; i < board.cells.length; i++) {
    const orig = board.cells[i];
    for (let k = 0; k < kinds; k++) {
      if (k === orig) continue;
      const cells = board.cells.slice();
      cells[i] = k;
      const nb: MatchBoard = { rows, cols, kinds, cells };
      if (findRuns(nb).length === 0 && hasAnyMove(nb)) return nb;
    }
  }
  // 极端兜底：重新生成（按构造规则必然无预置匹配）
  return createBoard(rows, cols, kinds, rand);
}

/**
 * 洗牌：打乱全部方块，反复尝试直到「无预置匹配 + 至少一步可走」。
 * 尝试次数用尽后走 fixNoMoveBoard 保证一定收敛。
 */
export function shuffleBoard(board: MatchBoard, rand: () => number = Math.random): MatchBoard {
  const { rows, cols, kinds } = board;
  for (let attempt = 0; attempt < 200; attempt++) {
    const cells = board.cells.slice();
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    const nb: MatchBoard = { rows, cols, kinds, cells };
    if (findRuns(nb).length === 0 && hasAnyMove(nb)) return nb;
  }
  return fixNoMoveBoard(board, rand);
}
