import { describe, expect, it } from "vitest";
import { matchPinyin, randInt, formatScore } from "../src/utils";

describe("matchPinyin", () => {
  it("支持中文原文、全拼与首字母匹配", () => {
    expect(matchPinyin("贪吃蛇", "贪吃")).toBe(true);
    expect(matchPinyin("贪吃蛇", "tanchishe")).toBe(true);
    expect(matchPinyin("贪吃蛇", "tcs")).toBe(true);
    expect(matchPinyin("贪吃蛇", "TCS")).toBe(true);
    expect(matchPinyin("贪吃蛇", "mima")).toBe(false);
  });
  it("支持中英混排与普通英文", () => {
    expect(matchPinyin("2048 游戏", "2048")).toBe(true);
    expect(matchPinyin("2048 游戏", "youxi")).toBe(true);
    expect(matchPinyin("Snake Game", "snake")).toBe(true);
  });
  it("空查询恒命中", () => {
    expect(matchPinyin("任意", "")).toBe(true);
  });
});

describe("randInt", () => {
  it("结果在区间内", () => {
    for (let i = 0; i < 100; i++) {
      const v = randInt(1, 10);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(10);
    }
  });
  it("单值区间", () => {
    expect(randInt(5, 5)).toBe(5);
  });
});

describe("formatScore", () => {
  it("千分位格式化", () => {
    expect(formatScore(0)).toBe("0");
    expect(formatScore(1234)).toBe("1,234");
    expect(formatScore(1234567)).toBe("1,234,567");
  });
});
