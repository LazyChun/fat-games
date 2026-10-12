import { describe, expect, it } from "vitest";
import {
  applyMoveName,
  createCube,
  CUBIE_ORIGINS,
  getWorldPos,
  hasSticker,
  isSolved,
  MOVE_DEFS,
  parseMove,
  quatFromAxisAngle,
  quatToAxisAngle,
  rotateVec,
  scramble,
  stickerColor,
  type Quat,
  type Vec3,
} from "../src/games/rubikLogic";

/** 可复现随机源 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function sortedKeys(cube: ReturnType<typeof createCube>): string[] {
  return cube
    .map((c) => getWorldPos(c).join(","))
    .sort((a, b) => a.localeCompare(b));
}

describe("createCube", () => {
  it("生成 26 个可动块且初始已还原", () => {
    const cube = createCube();
    expect(cube).toHaveLength(26);
    expect(isSolved(cube)).toBe(true);
  });
  it("初始位置覆盖除中心外的全部网格", () => {
    const cube = createCube();
    const expected = CUBIE_ORIGINS.map((o) => o.join(",")).sort((a, b) =>
      a.localeCompare(b),
    );
    expect(sortedKeys(cube)).toEqual(expected);
  });
});

describe("基础转动", () => {
  it("一次转动后不再是还原态", () => {
    const cube = createCube();
    applyMoveName(cube, "U");
    expect(isSolved(cube)).toBe(false);
  });
  it("U 后顶右前角块 (1,1,1) 移动到 (-1,1,1)", () => {
    const cube = createCube();
    applyMoveName(cube, "U");
    const moved = cube.find(
      (c) => c.origin[0] === 1 && c.origin[1] === 1 && c.origin[2] === 1,
    );
    expect(getWorldPos(moved!)).toEqual([-1, 1, 1]);
  });
  it("层转动保持该层坐标不变（R 后 x=1 层仍是 x=1）", () => {
    const cube = createCube();
    applyMoveName(cube, "R");
    for (const c of cube) {
      if (c.origin[0] === 1) expect(getWorldPos(c)[0]).toBe(1);
    }
  });
  it("每个基础面向与其 ' 互为逆操作", () => {
    for (const base of Object.keys(MOVE_DEFS)) {
      const cube = createCube();
      applyMoveName(cube, base);
      applyMoveName(cube, `${base}'`);
      expect(isSolved(cube)).toBe(true);
    }
  });
  it("(R U R' U')×6 为单位元", () => {
    const cube = createCube();
    const seq = ["R", "U", "R'", "U'"];
    for (let i = 0; i < 6; i++) {
      for (const m of seq) applyMoveName(cube, m);
    }
    expect(isSolved(cube)).toBe(true);
  });
  it("随机打乱 20 步后未还原，且逐层逆序可还原", () => {
    const cube = createCube();
    const moves = scramble(cube, 20, lcg(42));
    expect(moves).toHaveLength(20);
    expect(isSolved(cube)).toBe(false);
    for (let i = moves.length - 1; i >= 0; i--) {
      const m = moves[i];
      applyMoveName(cube, m.endsWith("'") ? m.slice(0, -1) : `${m}'`);
    }
    expect(isSolved(cube)).toBe(true);
  });
  it("任意转动序列后位置仍在网格且互不重叠", () => {
    const cube = createCube();
    const moves = scramble(cube, 30, lcg(7));
    expect(isSolved(cube)).toBe(false);
    const expected = CUBIE_ORIGINS.map((o) => o.join(",")).sort((a, b) =>
      a.localeCompare(b),
    );
    expect(sortedKeys(cube)).toEqual(expected);
    void moves;
  });
});

describe("贴纸", () => {
  it("角块 3 个贴纸、棱块 2 个、面心 1 个", () => {
    const cube = createCube();
    const corner = cube.find(
      (c) => c.origin[0] === 1 && c.origin[1] === 1 && c.origin[2] === 1,
    )!;
    const edge = cube.find(
      (c) => c.origin[0] === 1 && c.origin[1] === 1 && c.origin[2] === 0,
    )!;
    const center = cube.find(
      (c) => c.origin[0] === 1 && c.origin[1] === 0 && c.origin[2] === 0,
    )!;
    const stickerCount = (c: typeof corner) =>
      [0, 1, 2].reduce(
        (acc, a) =>
          acc +
          [1, -1].filter((s) => {
            const n: [number, number, number] = [0, 0, 0];
            n[a] = s;
            return hasSticker(c, n);
          }).length,
        0,
      );
    expect(stickerCount(corner)).toBe(3);
    expect(stickerCount(edge)).toBe(2);
    expect(stickerCount(center)).toBe(1);
  });
  it("标准配色：顶白 / 底黄 / 右红 / 左橙 / 前绿 / 后蓝", () => {
    const cube = createCube();
    const at = (x: number, y: number, z: number) =>
      cube.find(
        (c) => c.origin[0] === x && c.origin[1] === y && c.origin[2] === z,
      )!;
    expect(stickerColor(at(0, 1, 0), [0, 1, 0])).toBe("#ffffff");
    expect(stickerColor(at(0, -1, 0), [0, -1, 0])).toBe("#ffd500");
    expect(stickerColor(at(1, 0, 0), [1, 0, 0])).toBe("#b71234");
    expect(stickerColor(at(-1, 0, 0), [-1, 0, 0])).toBe("#ff5800");
    expect(stickerColor(at(0, 0, 1), [0, 0, 1])).toBe("#009b48");
    expect(stickerColor(at(0, 0, -1), [0, 0, -1])).toBe("#0046ad");
    // 面心块的侧面没有贴纸
    expect(stickerColor(at(0, 1, 0), [0, 0, 1])).toBe("");
  });
});

describe("parseMove", () => {
  it("解析基础面向与 ' 变体", () => {
    expect(parseMove("U")).toMatchObject({ axis: 1, layer: 1, dir: -1 });
    expect(parseMove("U'")).toMatchObject({ axis: 1, layer: 1, dir: 1 });
    expect(parseMove("r")).toMatchObject({ axis: 0, layer: 1, dir: -1 });
    expect(parseMove("D")).toMatchObject({ axis: 1, layer: -1, dir: 1 });
  });
  it("非法输入返回 null", () => {
    expect(parseMove("")).toBeNull();
    expect(parseMove("X")).toBeNull();
    expect(parseMove("U2")).toBeNull();
  });
});

describe("轴角往返（渲染路径依赖）", () => {
  /** 两个四元数是否表示同一旋转（± 等价） */
  function sameRotation(a: Quat, b: Quat): boolean {
    return (
      Math.abs(a.w - b.w) < 1e-6 &&
      Math.abs(a.x - b.x) < 1e-6 &&
      Math.abs(a.y - b.y) < 1e-6 &&
      Math.abs(a.z - b.z) < 1e-6
    );
  }
  it("quatToAxisAngle(quatFromAxisAngle(q)) 还原同一旋转", () => {
    const cases: Array<[Vec3, number]> = [
      [[1, 0, 0], Math.PI / 2],
      [[0, 1, 0], -Math.PI / 2],
      [[0, 0, 1], Math.PI],
      [[1, 1, 0], Math.PI],
      [[1, 1, 1], (2 * Math.PI) / 3],
    ];
    for (const [axis, angle] of cases) {
      const q = quatFromAxisAngle(axis, angle);
      const [a2, ang2] = quatToAxisAngle(q);
      const q2 = quatFromAxisAngle(a2, ang2);
      expect(sameRotation(q, q2)).toBe(true);
    }
  });
  it("任意打乱序列后每个块轴角往返一致", () => {
    const cube = createCube();
    scramble(cube, 25, lcg(99));
    for (const c of cube) {
      const [axis, angle] = quatToAxisAngle(c.quat);
      const back = quatFromAxisAngle(axis, angle);
      const applied = rotateVec(back, c.origin);
      // +0 归一化：-0 与 +0 在 toEqual 中不等
      expect(applied.map((v) => Math.round(v) + 0)).toEqual(getWorldPos(c));
    }
  });
});
