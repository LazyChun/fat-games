/*
 * orangeLogic（剥橘子）单元测试
 *
 * 覆盖：角度归一化、皮块 path 合法性、命中测试（各段/各瓣/边界/未命中）、
 * 整瓣判定、评级规则、连击倍率与计分。
 */
import { describe, expect, it } from "vitest";
import {
  PEEL_TOTAL,
  R_IN,
  R_OUT,
  SEG_EDGES,
  SLICES,
  SLICE_ANGLE,
  START_ANGLE,
  blockGain,
  blockPath,
  comboMultiplier,
  hitTest,
  normAngle,
  polar,
  ratingFor,
  segArc,
  sliceComplete,
  slicePath,
} from "../src/games/orangeLogic";

describe("normAngle / polar", () => {
  it("角度归一化到 [0, 360)", () => {
    expect(normAngle(0)).toBe(0);
    expect(normAngle(360)).toBe(0);
    expect(normAngle(-90)).toBe(270);
    expect(normAngle(400)).toBe(40);
    expect(normAngle(-400)).toBe(320);
  });

  it("极坐标还原角度与半径", () => {
    for (const deg of [-90, 0, 45, 180, 315]) {
      const [x, y] = polar(150, 150, 100, deg);
      const back = (Math.atan2(y - 150, x - 150) * 180) / Math.PI;
      expect(normAngle(back)).toBeCloseTo(normAngle(deg), 5);
      expect(Math.hypot(x - 150, y - 150)).toBeCloseTo(100, 5);
    }
  });
});

describe("blockPath / slicePath / segArc", () => {
  it("皮块 path 为闭合扇形环段且落在橘子几何内", () => {
    for (let idx = 0; idx < PEEL_TOTAL; idx++) {
      const d = blockPath(idx);
      expect(d.startsWith("M ")).toBe(true);
      expect(d.endsWith("Z")).toBe(true);
      // 外弧半径 = 对应段外边界，内弧半径 = 内边界
      const seg = idx % 3;
      expect(d).toContain(`A ${SEG_EDGES[seg]}`);
      expect(d).toContain(`A ${SEG_EDGES[seg + 1]}`);
    }
  });

  it("整瓣 path 使用外半径与果肉半径", () => {
    const d = slicePath(0);
    expect(d).toContain(`A ${R_OUT}`);
    expect(d).toContain(`A ${R_IN}`);
  });

  it("瓣粒分界弧半径来自段边界", () => {
    expect(segArc(1, 1)).toContain(`A ${SEG_EDGES[1]}`);
  });

  it("全部 8 瓣 × 3 段 = 24 块", () => {
    expect(PEEL_TOTAL).toBe(24);
    expect(SLICES * 3).toBe(PEEL_TOTAL);
  });
});

describe("hitTest", () => {
  it("中心果脐区与橘子外返回 null", () => {
    expect(hitTest(150, 150)).toBeNull();
    expect(hitTest(150, 150 + R_IN - 10)).toBeNull();
    expect(hitTest(150, 150 + R_OUT + 10)).toBeNull();
  });

  it("正上方（-90°）落在第 0 瓣", () => {
    // 段 0 范围 [112, 128]；段 1 [96, 112]；段 2 [78, 96]
    const b0 = hitTest(150, 150 - (R_OUT + 118) / 2);
    expect(b0?.slice).toBe(0);
    expect(b0?.seg).toBe(0);
    const b1 = hitTest(150, 150 - 104);
    expect(b1?.slice).toBe(0);
    expect(b1?.seg).toBe(1);
    const b2 = hitTest(150, 150 - 87);
    expect(b2?.slice).toBe(0);
    expect(b2?.seg).toBe(2);
  });

  it("角度连续覆盖所有瓣且 idx 唯一（三层半径各扫一圈）", () => {
    const seen = new Set<number>();
    const rMids = [
      (SEG_EDGES[0] + SEG_EDGES[1]) / 2, // 段 0
      (SEG_EDGES[1] + SEG_EDGES[2]) / 2, // 段 1
      (SEG_EDGES[2] + SEG_EDGES[3]) / 2, // 段 2
    ];
    for (const r of rMids) {
      const seg = rMids.indexOf(r);
      for (let deg = -90; deg < 270; deg += 1) {
        const rad = (deg * Math.PI) / 180;
        const b = hitTest(150 + r * Math.cos(rad), 150 + r * Math.sin(rad));
        expect(b).not.toBeNull();
        expect(b!.slice).toBe(
          Math.min(SLICES - 1, Math.floor(((deg - START_ANGLE + 360) % 360) / SLICE_ANGLE)),
        );
        expect(b!.seg).toBe(seg);
        seen.add(b!.idx);
      }
    }
    expect(seen.size).toBe(PEEL_TOTAL);
  });

  it("每个皮块索引都能从几何中心命中", () => {
    for (let idx = 0; idx < PEEL_TOTAL; idx++) {
      const seg = idx % 3;
      const slice = Math.floor(idx / 3);
      const rMid = (SEG_EDGES[seg] + SEG_EDGES[seg + 1]) / 2;
      const aMid = START_ANGLE + (slice + 0.5) * SLICE_ANGLE;
      const rad = (aMid * Math.PI) / 180;
      const b = hitTest(150 + rMid * Math.cos(rad), 150 + rMid * Math.sin(rad));
      expect(b?.idx).toBe(idx);
    }
  });
});

describe("sliceComplete", () => {
  it("瓣内 3 块齐了才算整瓣剥完", () => {
    const peeled = new Set<number>([0, 1, 2]);
    expect(sliceComplete(0, peeled)).toBe(true);
    expect(sliceComplete(1, peeled)).toBe(false);
    peeled.add(5);
    expect(sliceComplete(1, peeled)).toBe(false); // 缺 3、4
    peeled.add(3);
    peeled.add(4);
    expect(sliceComplete(1, peeled)).toBe(true);
  });
});

describe("ratingFor", () => {
  it("完整无划伤 → S；完整有划伤 → A", () => {
    expect(ratingFor(PEEL_TOTAL, 0)).toBe("S");
    expect(ratingFor(PEEL_TOTAL, 1)).toBe("A");
  });

  it("≥60% → B，否则 C", () => {
    expect(ratingFor(15, 0)).toBe("B");
    expect(ratingFor(14, 2)).toBe("C");
    expect(ratingFor(0, 0)).toBe("C");
  });
});

describe("comboMultiplier / blockGain", () => {
  it("连击倍率 1 起步、每连 +0.5、封顶 5", () => {
    expect(comboMultiplier(1)).toBe(1);
    expect(comboMultiplier(2)).toBe(1.5);
    expect(comboMultiplier(5)).toBe(3);
    expect(comboMultiplier(9)).toBe(5);
    expect(comboMultiplier(99)).toBe(5);
  });

  it("普通撕皮按倍率取整，划伤固定 2 分", () => {
    expect(blockGain(1, false)).toBe(10);
    expect(blockGain(3, false)).toBe(20);
    expect(blockGain(7, false)).toBe(40);
    expect(blockGain(99, true)).toBe(2);
  });
});
