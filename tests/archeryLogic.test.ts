/*
 * archeryLogic 单元测试
 */
import { describe, expect, it } from "vitest";
import {
  advanceLevel,
  ARC,
  computeLaunch,
  createWorld,
  goalForLevel,
  mulberry32,
  previewPath,
  ringIndex,
  startShot,
  stepWorld,
  type Arrow,
  type Target,
  type World,
} from "../src/games/archeryLogic";

function world(level = 1): World {
  return createWorld(level, 424242);
}

function arrow(partial: Partial<Arrow> = {}): Arrow {
  return {
    x: 400,
    y: 300,
    vx: 0,
    vy: 0,
    rot: 0,
    bounces: 0,
    stuck: false,
    stuckAt: 0,
    removed: false,
    ...partial,
  };
}

function firstBullseye(w: World): Target {
  const t = w.targets.find((x) => x.kind === "bullseye");
  if (!t) throw new Error("no bullseye target");
  return t;
}

describe("computeLaunch 拖弓蓄力", () => {
  it("向左下拖弓 → 向右上发射；力度随拖距增大", () => {
    const archer = { x: 88, y: 340 };
    const weak = computeLaunch(archer, { x: 40, y: 380 });
    const strong = computeLaunch(archer, { x: 0, y: 440 });
    expect(weak.vx).toBeGreaterThan(0);
    expect(weak.vy).toBeLessThan(0);
    expect(Math.hypot(strong.vx, strong.vy)).toBeGreaterThan(
      Math.hypot(weak.vx, weak.vy),
    );
  });

  it("力度上限封顶为 maxPower", () => {
    const archer = { x: 88, y: 340 };
    const far = computeLaunch(archer, { x: -999, y: 999 });
    const p = Math.hypot(far.vx, far.vy);
    expect(p).toBeLessThanOrEqual(ARC.maxPower + 0.001);
    expect(p).toBeGreaterThanOrEqual(ARC.maxPower - 0.001);
  });

  it("与弓手重合时兜底为水平最小力度", () => {
    const archer = { x: 88, y: 340 };
    const l = computeLaunch(archer, { x: 88, y: 340 });
    expect(l.vx).toBe(ARC.minPower);
    expect(l.vy).toBe(0);
  });
});

describe("previewPath 弹道预测", () => {
  it("弹道在重力下向下弯曲，最终停在落地线", () => {
    const w = world();
    const pts = previewPath(w, { vx: 420, vy: -380 });
    expect(pts.length).toBeGreaterThan(10);
    // 整体向右
    expect(pts[pts.length - 1].x).toBeGreaterThan(pts[0].x);
    // 有弯曲：中段 y 高于末段 y
    const midY = pts[Math.floor(pts.length / 2)].y;
    expect(pts[pts.length - 1].y).toBeGreaterThan(midY);
    expect(pts[pts.length - 1].y).toBeLessThanOrEqual(ARC.GROUND);
  });

  it("遇到障碍提前终止", () => {
    const w = world(1);
    // 找一个会挡住中高弹道的砖墙
    const brick = w.obstacles.find((o) => o.kind === "brick");
    if (!brick) throw new Error("no brick");
    // 中高抛：撞进砖墙高度带（300..380）内必然提前终止
    const pts = previewPath(w, { vx: 420, vy: -220 });
    const last = pts[pts.length - 1];
    expect(last.x).toBeLessThan(brick.x + brick.w);
  });
});

describe("ringIndex 靶环计分", () => {
  it("按距离映射到 0..4 环", () => {
    expect(ringIndex(0)).toBe(0);
    expect(ringIndex(5)).toBe(0);
    expect(ringIndex(10)).toBe(1);
    expect(ringIndex(25)).toBe(3);
    expect(ringIndex(34)).toBe(4);
    expect(ringIndex(100)).toBe(4);
  });
});

describe("createWorld 关卡生成", () => {
  it("同 seed 布局确定；关卡越高目标越多、风力越大", () => {
    const a = createWorld(1, 7);
    const b = createWorld(1, 7);
    expect(a.targets.map((t) => [t.x, t.y])).toEqual(
      b.targets.map((t) => [t.x, t.y]),
    );
    const l1 = createWorld(1, 7);
    const l3 = createWorld(3, 7);
    const l5 = createWorld(5, 7);
    expect(l3.windMax).toBeGreaterThan(l1.windMax);
    expect(l5.targets.length).toBeGreaterThanOrEqual(l3.targets.length);
  });

  it("mulberry32 是确定性随机数", () => {
    const r1 = mulberry32(42);
    const r2 = mulberry32(42);
    for (let i = 0; i < 5; i++) expect(r1()).toBe(r2());
  });

  it("每关有苹果头靶和障碍", () => {
    for (let lv = 1; lv <= 4; lv++) {
      const w = createWorld(lv, 9);
      expect(w.targets.some((t) => t.kind === "apple")).toBe(true);
      expect(w.obstacles.length).toBeGreaterThanOrEqual(1);
      expect(w.arrowsLeft).toBe(ARC.arrowsPerLevel);
    }
  });

  it("goalForLevel 随关卡递增", () => {
    expect(goalForLevel(2)).toBeGreaterThan(goalForLevel(1));
    expect(goalForLevel(ARC.maxLevel)).toBe(40 + 35 * ARC.maxLevel);
  });
});

describe("startShot 发射", () => {
  it("消耗一支箭并设置风力（注入随机源）", () => {
    const w = world();
    w.phase = "flying";
    const wind = startShot(w, { vx: 300, vy: -200 }, () => 1);
    expect(wind).toBeCloseTo(w.windMax);
    expect(w.arrowsLeft).toBe(ARC.arrowsPerLevel - 1);
    expect(w.arrows.length).toBe(1);
    expect(w.arrows[0].vx).toBe(300);
  });

  it("有飞行箭时不允许再发", () => {
    const w = world();
    w.phase = "flying";
    startShot(w, { vx: 300, vy: -200 });
    const before = w.arrowsLeft;
    startShot(w, { vx: 300, vy: -200 });
    expect(w.arrowsLeft).toBe(before);
    expect(w.arrows.length).toBe(1);
  });
});

describe("stepWorld 物理", () => {
  it("箭矢受重力下落并钉在地面（land 事件）", () => {
    const w = world();
    w.phase = "flying";
    w.arrows.push(arrow({ x: 300, y: 360, vx: 0, vy: 0 }));
    let ev: ReturnType<typeof stepWorld> = [];
    for (let i = 0; i < 20 && w.arrows[0].y < ARC.GROUND - 2; i++) {
      ev = stepWorld(w, 20); // 每帧 ≤50ms，累积 400ms
    }
    const a = w.arrows[0];
    expect(a.y).toBeGreaterThan(360);
    expect(ev.some((e) => e.type === "land")).toBe(true);
    expect(a.stuck).toBe(true);
  });

  it("反弹：撞砖墙后 vx 反向并按恢复系数衰减", () => {
    const w = world();
    w.phase = "flying";
    const brick = w.obstacles.find((o) => o.kind === "brick");
    if (!brick) throw new Error("no brick");
    w.arrows.push(
      arrow({ x: brick.x - 6, y: brick.y + 30, vx: 420, vy: 0, bounces: 0 }),
    );
    const ev = stepWorld(w, 40);
    const a = w.arrows[0];
    expect(ev.some((e) => e.type === "bounce" && e.kind === "brick")).toBe(true);
    expect(a.bounces).toBe(1);
    expect(a.vx).toBeCloseTo(-420 * ARC.restBrick);
    expect(a.x).toBeLessThan(brick.x);
  });

  it("冰面反弹恢复系数更高", () => {
    const w = createWorld(2, 5);
    w.phase = "flying";
    // 生成器已移除冰面（避免与靶心命中区重叠），此处手工注入一个；
    // 靶心半径 34 的命中区会吞掉整块冰面，先把靶全部挪开再测纯反弹
    for (const tt of w.targets) {
      tt.x = 700;
      tt.y = 60;
    }
    w.obstacles.push({ id: 901, kind: "ice", x: 430, y: 250, w: 12, h: 90, alive: true });
    const ice = w.obstacles.find((o) => o.kind === "ice");
    if (!ice) throw new Error("no ice");
    w.arrows.push(
      arrow({ x: ice.x - 6, y: ice.y + 30, vx: 420, vy: 0, bounces: 0 }),
    );
    const ev = stepWorld(w, 40);
    expect(ev.some((e) => e.type === "bounce" && e.kind === "ice")).toBe(true);
    expect(w.arrows[0].vx).toBeCloseTo(-420 * ARC.restIce);
  });

  it("反弹次数达到上限后钉住（thud 事件）", () => {
    const w = world();
    w.phase = "flying";
    const brick = w.obstacles.find((o) => o.kind === "brick");
    if (!brick) throw new Error("no brick");
    w.arrows.push(
      arrow({ x: brick.x - 6, y: brick.y + 30, vx: 420, vy: 0, bounces: ARC.bounceMax }),
    );
    const ev = stepWorld(w, 40);
    expect(ev.some((e) => e.type === "thud")).toBe(true);
    expect(w.arrows[0].stuck).toBe(true);
  });
});

describe("命中计分", () => {
  it("靶心命中：50 分 × 连击 × 反弹加成", () => {
    const w = world();
    w.phase = "flying";
    const t = firstBullseye(w);
    w.arrows.push(arrow({ x: t.x, y: t.y, bounces: 2 }));
    const ev = stepWorld(w, 16);
    const hit = ev.find((e) => e.type === "bullseye");
    expect(hit).toBeTruthy();
    // 50 * combo(1) * (1 + 0.5*2)
    expect((hit as { points: number }).points).toBe(100);
    expect(w.levelScore).toBe(100);
    expect(t.alive).toBe(false);
  });

  it("外环命中：基础分按环数", () => {
    const w = world();
    w.phase = "flying";
    const t = firstBullseye(w);
    w.arrows.push(arrow({ x: t.x + 30, y: t.y, bounces: 0 }));
    const ev = stepWorld(w, 16);
    const hit = ev.find((e) => e.type === "hit");
    expect(hit).toBeTruthy();
    expect((hit as { points: number }).points).toBeLessThanOrEqual(20);
  });

  it("苹果头靶：命中苹果得分、误伤 NPC 扣分", () => {
    const w = world();
    w.phase = "flying";
    const apple = w.targets.find((t) => t.kind === "apple");
    if (!apple) throw new Error("no apple target");
    w.arrows.push(arrow({ x: apple.x, y: apple.y - 30 }));
    const ev1 = stepWorld(w, 16);
    expect(ev1.some((e) => e.type === "apple")).toBe(true);
    expect(w.score).toBe(ARC.appleScore);

    const w2 = world();
    w2.phase = "flying";
    const apple2 = w2.targets.find((t) => t.kind === "apple");
    if (!apple2) throw new Error("no apple target");
    w2.arrows.push(arrow({ x: apple2.x, y: apple2.y }));
    const ev2 = stepWorld(w2, 16);
    expect(ev2.some((e) => e.type === "npc")).toBe(true);
    expect(w2.score).toBe(0); // 扣分钳制到 0
  });

  it("连击：窗口内连续命中倍率递增，超时归零", () => {
    const w = world();
    w.phase = "flying";
    const t1 = firstBullseye(w);
    w.arrows.push(arrow({ x: t1.x, y: t1.y }));
    stepWorld(w, 16);
    expect(w.combo).toBe(1);
    const t2 = w.targets.find((t) => t.kind === "bullseye" && t.alive);
    if (!t2) throw new Error("need second target");
    w.arrows.push(arrow({ x: t2.x, y: t2.y }));
    stepWorld(w, 16);
    expect(w.combo).toBe(2);
    // 窗口超时后归零
    stepWorld(w, ARC.comboWindowMs + 10);
    expect(w.combo).toBe(0);
  });
});

describe("炸药桶", () => {
  it("引爆清碎木箱并获得基础奖励分", () => {
    const w = createWorld(4, 11); // L4 有桶，且紧贴木箱
    w.phase = "flying";
    const barrel = w.obstacles.find((o) => o.kind === "barrel");
    if (!barrel) throw new Error("no barrel");
    const crate = w.obstacles.find((o) => o.kind === "crate");
    if (!crate) throw new Error("no crate");
    // 桶与首箱距离应在爆破范围内
    const dist = Math.hypot(
      barrel.x + barrel.w / 2 - (crate.x + crate.w / 2),
      barrel.y + barrel.h / 2 - (crate.y + crate.h / 2),
    );
    expect(dist).toBeLessThanOrEqual(ARC.barrelBlast + 40);
    w.arrows.push(
      arrow({ x: barrel.x + barrel.w / 2, y: barrel.y + barrel.h / 2 }),
    );
    const ev = stepWorld(w, 16);
    expect(ev.some((e) => e.type === "boom")).toBe(true);
    expect(barrel.alive).toBe(false);
    expect(crate.alive).toBe(false);
    expect(w.levelScore).toBeGreaterThanOrEqual(ARC.barrelFlatScore);
  });

  it("爆炸清掉爆破范围内的靶并计分", () => {
    const w = createWorld(4, 11);
    w.phase = "flying";
    const barrel = w.obstacles.find((o) => o.kind === "barrel");
    if (!barrel) throw new Error("no barrel");
    const t = firstBullseye(w);
    // 其他靶全部挪到爆破范围之外，确保只清这一个（避免远靶被桶炸到使期望值失真）
    for (const tt of w.targets) {
      tt.moving = false;
      if (tt !== t) {
        tt.x = 700;
        tt.y = 60;
      }
    }
    // 把靶挪到爆破范围内（但不在箭的命中半径内）
    t.x = barrel.x + barrel.w / 2 + 40;
    t.y = barrel.y + barrel.h / 2;
    w.arrows.push(
      arrow({ x: barrel.x + barrel.w / 2, y: barrel.y + barrel.h / 2 }),
    );
    stepWorld(w, 16);
    expect(t.alive).toBe(false);
    // 25（清靶）× combo(1) + 10（爆炸基础分）
    expect(w.levelScore).toBe(ARC.barrelKillScore + ARC.barrelFlatScore);
  });
});

describe("关卡结算", () => {
  it("箭尽未达标 → over；达标 → levelup；最后一关达标 → won", () => {
    const w = world();
    w.phase = "flying";
    w.arrowsLeft = 0;
    w.levelScore = goalForLevel(1) - 1;
    stepWorld(w, 16);
    expect(w.phase).toBe("over");

    const w2 = world();
    w2.phase = "flying";
    w2.arrowsLeft = 0;
    w2.levelScore = goalForLevel(1);
    stepWorld(w2, 16);
    expect(w2.phase).toBe("levelup");

    const w3 = createWorld(ARC.maxLevel, 3);
    w3.phase = "flying";
    w3.arrowsLeft = 0;
    w3.levelScore = goalForLevel(ARC.maxLevel);
    const ev = stepWorld(w3, 16);
    expect(w3.phase).toBe("won");
    expect(ev.some((e) => e.type === "won")).toBe(true);
  });

  it("advanceLevel 保留累计分、进入下一关", () => {
    const w = world();
    w.score = 999;
    const next = advanceLevel(w);
    expect(next.level).toBe(2);
    expect(next.score).toBe(999);
    expect(next.phase).toBe("flying");
    expect(next.arrowsLeft).toBe(ARC.arrowsPerLevel);
    expect(next.levelScore).toBe(0);
  });
});

describe("移动靶", () => {
  it("在 minY/maxY 之间往返", () => {
    const w = createWorld(3, 8); // L3 起大概率有移动靶
    const moving = w.targets.find((t) => t.moving);
    if (!moving) throw new Error("no moving target");
    const y0 = moving.y;
    stepWorld(w, 500);
    expect(moving.y).not.toBe(y0);
    // 不会越界
    for (let i = 0; i < 300; i++) {
      stepWorld(w, 100);
      expect(moving.y).toBeGreaterThanOrEqual(moving.minY - 1);
      expect(moving.y).toBeLessThanOrEqual(moving.maxY + 1);
    }
  });
});
