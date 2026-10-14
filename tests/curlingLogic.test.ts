import { describe, expect, it } from "vitest";
import {
  aiThrow,
  allStopped,
  BOUND_BOTTOM,
  BOUND_LEFT,
  BOUND_RIGHT,
  BOUND_TOP,
  cullInvalid,
  FRICTION,
  HOG_X,
  HOUSE_R,
  makeStone,
  MAX_POWER_V,
  MIN_POWER_V,
  resolveCollisions,
  scoreEnd,
  stepStones,
  STONE_R,
  TEE_X,
  TEE_Y,
  THROW_X,
  THROWS_PER_END,
  TOTAL_ENDS,
  whoseTurn,
  type Stone,
} from "../src/games/curlingLogic";

function stone(
  id: number,
  side: "player" | "ai",
  x: number,
  y: number,
  vx = 0,
  vy = 0,
): Stone {
  return makeStone(id, side, x, y, vx, vy);
}

describe("物理：线性摩擦", () => {
  it("速度按摩擦线性衰减并最终停止", () => {
    const s = stone(1, "player", 0, 0, 500, 0);
    stepStones([s], 1 / 60);
    expect(s.vx).toBeLessThan(500);
    expect(s.x).toBeGreaterThan(0);
    // 持续步进直至停止
    let guard = 0;
    while (!allStopped([s]) && guard < 5000) {
      stepStones([s], 1 / 60);
      guard += 1;
    }
    expect(allStopped([s])).toBe(true);
    expect(s.vx).toBe(0);
  });

  it("静止壶不会被推动", () => {
    const s = stone(1, "player", 100, 100, 0, 0);
    stepStones([s], 1 / 60);
    expect(s.x).toBe(100);
    expect(s.y).toBe(100);
  });

  it("滑行距离符合 v²/2a 公式", () => {
    const v = 400;
    const s = stone(1, "player", 0, 0, v, 0);
    let guard = 0;
    while (!allStopped([s]) && guard < 5000) {
      stepStones([s], 1 / 120);
      guard += 1;
    }
    const expectDist = (v * v) / (2 * FRICTION);
    expect(Math.abs(s.x - expectDist)).toBeLessThan(4);
  });
});

describe("物理：弹性碰撞", () => {
  it("等质量正面碰撞交换速度", () => {
    const a = stone(1, "player", 100, 0, 200, 0);
    const b = stone(2, "ai", 100 + STONE_R * 2 - 1, 0, 0, 0);
    stepStones([a, b], 0.016);
    // a 应被反弹，b 获得速度
    expect(b.vx).toBeGreaterThan(100);
    expect(a.vx).toBeLessThan(100);
  });

  it("碰撞后两壶分离，互不重叠", () => {
    const a = stone(1, "player", 100, 0, 150, 0);
    const b = stone(2, "ai", 100 + STONE_R * 2 - 0.5, 0, 0, 0);
    for (let i = 0; i < 30; i++) stepStones([a, b], 1 / 120);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(STONE_R * 2 - 1e-6);
  });

  it("同向同速的壶互不影响（只受摩擦衰减）", () => {
    const a = stone(1, "player", 100, 0, 100, 0);
    const b = stone(2, "ai", 100 + STONE_R * 2, 0, 100, 0);
    const solo = stone(3, "player", 300, 0, 100, 0);
    stepStones([a, b, solo], 0.016);
    // a/b 与单独滑行的壶速度完全一致 → 没有发生碰撞干涉
    expect(a.vx).toBeCloseTo(solo.vx, 6);
    expect(b.vx).toBeCloseTo(solo.vx, 6);
    expect(solo.vx).toBeLessThan(100);
  });

  it("resolveCollisions 不越界访问", () => {
    const s = stone(1, "player", 0, 0, 0, 0);
    resolveCollisions([s]);
    expect(s.active).toBe(true);
  });
});

describe("有效性判定", () => {
  it("未过前掷线的壶被移除", () => {
    const s = stone(1, "player", HOG_X + 10, 200);
    const res = cullInvalid([s]);
    expect(s.active).toBe(false);
    expect(res.short).toBe(1);
    expect(res.out).toBe(0);
  });

  it("越过前掷线的壶保留", () => {
    const s = stone(1, "player", HOG_X - 10, 200);
    const res = cullInvalid([s]);
    expect(s.active).toBe(true);
    expect(res.short).toBe(0);
  });

  it("出界壶被移除（四侧）", () => {
    const cases: [number, number][] = [
      [BOUND_LEFT - 1, 200],
      [BOUND_RIGHT + 1, 200],
      [200, BOUND_TOP - 1],
      [200, BOUND_BOTTOM + 1],
    ];
    for (const [x, y] of cases) {
      const s = stone(1, "player", x, y);
      const res = cullInvalid([s]);
      expect(s.active).toBe(false);
      expect(res.out).toBe(1);
    }
  });
});

describe("局末计分", () => {
  it("无人进大本营：0:0", () => {
    const stones = [
      stone(1, "player", TEE_X - HOUSE_R - 20, TEE_Y),
      stone(2, "ai", TEE_X + HOUSE_R + 20, TEE_Y),
    ];
    expect(scoreEnd(stones)).toEqual({ player: 0, ai: 0 });
  });

  it("只有一方有壶：按壶数得分", () => {
    const stones = [
      stone(1, "player", TEE_X, TEE_Y),
      stone(2, "player", TEE_X + 20, TEE_Y),
      stone(3, "ai", TEE_X + HOUSE_R + 40, TEE_Y), // 大本营外
    ];
    expect(scoreEnd(stones)).toEqual({ player: 2, ai: 0 });
  });

  it("最近壶决定得分方，每比对方最内更近得 1 分", () => {
    const stones = [
      stone(1, "player", TEE_X, TEE_Y), // 0
      stone(2, "player", TEE_X + 12, TEE_Y), // 12 < 15
      stone(3, "player", TEE_X + 30, TEE_Y), // 30 > 15
      stone(4, "ai", TEE_X + 15, TEE_Y), // 15
    ];
    expect(scoreEnd(stones)).toEqual({ player: 2, ai: 0 });
  });

  it("AI 更近时 AI 得分", () => {
    const stones = [
      stone(1, "player", TEE_X + 20, TEE_Y),
      stone(2, "ai", TEE_X + 8, TEE_Y),
      stone(3, "ai", TEE_X + 25, TEE_Y), // 25 > 20，不算
    ];
    expect(scoreEnd(stones)).toEqual({ player: 0, ai: 1 });
  });

  it("被移除（inactive）的壶不参与计分", () => {
    const removed = stone(1, "player", TEE_X, TEE_Y);
    removed.active = false;
    const stones = [removed, stone(2, "ai", TEE_X + 10, TEE_Y)];
    expect(scoreEnd(stones)).toEqual({ player: 0, ai: 1 });
  });
});

describe("投掷顺序", () => {
  it("玩家先手时：先手投 8、6、4、2 次", () => {
    expect(whoseTurn(8, "player")).toBe("player");
    expect(whoseTurn(7, "player")).toBe("ai");
    expect(whoseTurn(6, "player")).toBe("player");
    expect(whoseTurn(5, "player")).toBe("ai");
    expect(whoseTurn(4, "player")).toBe("player");
    expect(whoseTurn(3, "player")).toBe("ai");
    expect(whoseTurn(2, "player")).toBe("player");
    expect(whoseTurn(1, "player")).toBe("ai");
  });

  it("AI 先手时镜像", () => {
    expect(whoseTurn(8, "ai")).toBe("ai");
    expect(whoseTurn(7, "ai")).toBe("player");
    expect(whoseTurn(1, "ai")).toBe("player");
  });
});

describe("AI 决策", () => {
  it("空场瞄准大本营方向，力度在合法范围", () => {
    for (let i = 0; i < 50; i++) {
      const d = aiThrow([]);
      expect(d.y).toBeGreaterThanOrEqual(BOUND_TOP + STONE_R + 4);
      expect(d.y).toBeLessThanOrEqual(BOUND_BOTTOM - STONE_R - 4);
      const v = Math.hypot(d.vx, d.vy);
      expect(v).toBeGreaterThanOrEqual(MIN_POWER_V);
      expect(v).toBeLessThanOrEqual(MAX_POWER_V);
      // 方向指向左侧（大本营在左）
      expect(d.vx).toBeLessThan(0);
    }
  });

  it("敌方壶接近圆心时瞄准该壶（进攻）", () => {
    // 敌壶在圆心上：目标必然对准圆心方向
    const stones = [stone(1, "player", TEE_X, TEE_Y)];
    for (let i = 0; i < 30; i++) {
      const d = aiThrow(stones);
      // 方向应指向圆心附近（vx 负、vy 与 圆心-起手点 同号）
      expect(d.vx).toBeLessThan(0);
      const vySign = Math.sign(TEE_Y - d.y);
      expect(Math.sign(d.vy)).toBe(vySign === 0 ? 0 : vySign);
    }
  });

  it("常量完整性：每局 8 投、共 8 局", () => {
    expect(THROWS_PER_END).toBe(8);
    expect(TOTAL_ENDS).toBe(8);
  });
});
