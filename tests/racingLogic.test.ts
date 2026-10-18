/*
 * racingLogic 单元测试：赛道生成 / 透视投影 / 玩家物理 / AI / 碰撞 / 圈数 / 成绩
 */
import { describe, expect, it } from "vitest";
import {
  accelerate,
  advanceLap,
  AI_COUNT,
  buildTrack,
  CENTRI,
  clamp,
  computeScore,
  computeViews,
  detectCollision,
  kmh,
  MAX_SPEED,
  newLapState,
  project,
  respawnFarAi,
  roadsideAt,
  ROAD_CURB,
  ROAD_W,
  SEG_LEN,
  spawnAiCar,
  spawnAiFleet,
  stepAi,
  stepPlayer,
  TRACK_METERS,
  TRACK_SEGS,
  type AiCar,
  type PlayerCar,
} from "../src/games/racingLogic";

describe("buildTrack", () => {
  it("生成固定段数的环形赛道，首尾直道衔接", () => {
    const track = buildTrack();
    expect(track.segs).toHaveLength(TRACK_SEGS);
    expect(track.segs[0].curve).toBe(0);
    expect(track.segs[TRACK_SEGS - 1].curve).toBe(0);
  });

  it("同一种子生成完全一致的赛道", () => {
    const a = buildTrack(42);
    const b = buildTrack(42);
    for (let i = 0; i < TRACK_SEGS; i++) {
      expect(a.segs[i].curve).toBe(b.segs[i].curve);
    }
  });

  it("赛道包含左右弯与直道（曲率有正有负有零）", () => {
    const track = buildTrack();
    const has = (pred: (c: number) => boolean) => track.segs.some((s) => pred(s.curve));
    expect(has((c) => c > 0)).toBe(true);
    expect(has((c) => c < 0)).toBe(true);
    expect(has((c) => c === 0)).toBe(true);
  });
});

describe("project（透视投影）", () => {
  const W = 1000;
  const H = 520;
  const horizon = H * 0.42;

  it("越远 scale 越小（近大远小）", () => {
    const near = project(0, 100, 0, 0, W, horizon)!;
    const far = project(0, 800, 0, 0, W, horizon)!;
    expect(near.scale).toBeGreaterThan(far.scale);
  });

  it("正横向偏移投影到屏幕右侧", () => {
    const left = project(-100, 100, 0, 0, W, horizon)!;
    const right = project(100, 100, 0, 0, W, horizon)!;
    expect(right.x).toBeGreaterThan(left.x);
  });

  it("相机后方返回 null", () => {
    expect(project(0, 1, 0, 0, W, horizon)).toBeNull();
    expect(project(0, 50, 0, 60, W, horizon)).toBeNull();
  });

  it("相机位置影响投影：相机右移，世界点左移", () => {
    const a = project(0, 100, -50, 0, W, horizon)!;
    const b = project(0, 100, 50, 0, W, horizon)!;
    expect(a.x).toBeGreaterThan(b.x);
  });
});

describe("computeViews（赛道分段投影）", () => {
  it("深度单调递增、scale 单调递减", () => {
    const track = buildTrack();
    const views = computeViews(track, 0, 0, 1000, 200);
    expect(views.length).toBeGreaterThan(100);
    for (let i = 1; i < views.length; i++) {
      expect(views[i].dz).toBeGreaterThan(views[i - 1].dz);
      expect(views[i].scale).toBeLessThan(views[i - 1].scale);
    }
  });

  it("玩家横向位置会平移整条路（相机跟随）", () => {
    const track = buildTrack();
    const vLeft = computeViews(track, 0, -1, 1000, 200);
    const vRight = computeViews(track, 0, 1, 1000, 200);
    // 玩家偏右 → 路在屏幕上偏左
    expect(vLeft[1].centerX).toBeGreaterThan(vRight[1].centerX);
  });

  it("弯道让远端中心横向偏移（曲率累积生效）", () => {
    const track = buildTrack();
    const views = computeViews(track, 60, 0, 1000, 200); // 从左弯起点开始
    // 至少存在远端明显偏移的段
    const maxOff = Math.max(...views.map((v) => Math.abs(v.centerX - 500)));
    expect(maxOff).toBeGreaterThan(2);
  });
});

describe("stepPlayer（玩家物理）", () => {
  const idle: PlayerCar = { x: 0, z: 0, speed: 0, steer: 0, crash: 0 };

  it("油门加速并封顶", () => {
    const p = { ...idle };
    for (let i = 0; i < 20; i++) stepPlayer(p, { up: true, down: false, left: false, right: false }, 0, 0.1);
    expect(p.speed).toBeGreaterThan(0);
    expect(p.speed).toBeLessThanOrEqual(MAX_SPEED + 1e-9);
  });

  it("刹车减速到负速（倒车）", () => {
    const p = { ...idle, speed: 40 };
    for (let i = 0; i < 20; i++) stepPlayer(p, { up: false, down: true, left: false, right: false }, 0, 0.1);
    expect(p.speed).toBeLessThan(10);
    expect(p.speed).toBeGreaterThanOrEqual(-MAX_SPEED * 0.3 - 1e-9);
  });

  it("松油门自然减速", () => {
    const p = { ...idle, speed: 30 };
    const before = p.speed;
    stepPlayer(p, { up: false, down: false, left: false, right: false }, 0, 0.2);
    expect(p.speed).toBeLessThan(before);
  });

  it("右转增加 x，左转减少 x", () => {
    const p = { ...idle, speed: 30 };
    stepPlayer(p, { up: false, down: false, left: false, right: true }, 0, 0.2);
    expect(p.x).toBeGreaterThan(0);
    const q = { ...idle, speed: 30 };
    stepPlayer(q, { up: false, down: false, left: true, right: false }, 0, 0.2);
    expect(q.x).toBeLessThan(0);
  });

  it("左弯离心把车甩向右侧", () => {
    const p = { ...idle, speed: 50 };
    stepPlayer(p, { up: false, down: false, left: false, right: false }, 0.05, 0.2);
    expect(p.x).toBeGreaterThan(0);
  });

  it("压草地受到额外阻力", () => {
    const p = { ...idle, speed: 50, x: ROAD_CURB + 0.3 };
    const before = p.speed;
    stepPlayer(p, { up: true, down: false, left: false, right: false }, 0, 0.2);
    // 草地阻力会让速度低于纯加速的预期
    const p2 = { ...idle, speed: 50 };
    stepPlayer(p2, { up: true, down: false, left: false, right: false }, 0, 0.2);
    expect(p.speed).toBeLessThan(p2.speed);
  });

  it("横向位置被 clamp 在赛道边界内", () => {
    const p = { ...idle, speed: 50, x: 5 };
    stepPlayer(p, { up: false, down: false, left: false, right: false }, 0, 0.1);
    expect(p.x).toBeLessThanOrEqual(1.4);
  });

  it("转向输入记录到 steer（车身倾斜）", () => {
    const p = { ...idle, speed: 20 };
    stepPlayer(p, { up: false, down: false, left: false, right: true }, 0, 0.1);
    expect(p.steer).toBe(1);
  });

  it("转向可控：全速按住右转 0.5 秒不会瞬间飞出赛道", () => {
    const p = { ...idle, speed: 60 };
    for (let i = 0; i < 30; i++) {
      stepPlayer(p, { up: false, down: false, left: false, right: true }, 0, 1 / 60);
    }
    // 0.5 秒最多横移 ~0.55，远未到草地（1.0）
    expect(p.x).toBeGreaterThan(0);
    expect(p.x).toBeLessThan(0.7);
  });
});

describe("stepAi（AI 对手车）", () => {
  function makeAi(z: number): AiCar {
    const c = spawnAiCar(() => 0.5, z);
    c.cruise = 0.7;
    return c;
  }

  it("绕圈前进并回绕", () => {
    const c = makeAi(TRACK_METERS - 10);
    c.speed = 40;
    stepAi(c, () => 0.5, 1);
    // 前进 40 米后回绕到环内
    expect(c.z).toBeGreaterThanOrEqual(0);
    expect(c.z).toBeLessThan(TRACK_METERS);
    expect(c.z).toBeLessThan(TRACK_METERS - 10 + 40);
  });

  it("速度收敛到巡航目标附近", () => {
    const c = makeAi(100);
    c.speed = 0;
    for (let i = 0; i < 100; i++) stepAi(c, () => 0.5, 0.1);
    expect(c.speed).toBeGreaterThan(0.5 * MAX_SPEED);
    expect(c.speed).toBeLessThanOrEqual(MAX_SPEED);
  });

  it("平滑移向目标车道", () => {
    const c = makeAi(100);
    c.x = -1;
    c.laneX = 1;
    c.nextChangeZ = 10000;
    for (let i = 0; i < 60; i++) stepAi(c, () => 0.5, 0.1);
    expect(c.x).toBeGreaterThan(-0.1);
  });

  it("到达变道里程后会更新目标车道", () => {
    const c = makeAi(100);
    c.nextChangeZ = 0; // 立即触发
    const oldLane = c.laneX;
    stepAi(c, () => 0.5, 0.1);
    expect(c.nextChangeZ).toBeGreaterThan(100);
    expect(c.laneX).not.toBe(oldLane);
  });
});

describe("detectCollision（碰撞）", () => {
  it("同车道前方近距离相撞", () => {
    const p = { x: 0, z: 100, speed: 50 };
    const ai = { x: 0, z: 104, speed: 40 };
    expect(detectCollision(p, ai)).toBe(true);
  });

  it("横向错开不撞", () => {
    const p = { x: 0, z: 100, speed: 50 };
    const ai = { x: 1, z: 104, speed: 40 };
    expect(detectCollision(p, ai)).toBe(false);
  });

  it("距离较远不撞（含环形回绕侧）", () => {
    const p = { x: 0, z: 100, speed: 50 };
    const ai = { x: 0, z: 500, speed: 40 };
    expect(detectCollision(p, ai)).toBe(false);
    const farWrap = { x: 0, z: (100 + TRACK_METERS / 2 + 100) % TRACK_METERS, speed: 40 };
    expect(detectCollision(p, farWrap)).toBe(false);
  });
});

describe("spawnAiFleet / respawnFarAi（AI 在场管理）", () => {
  it("生成整支车队，且开局第一辆在可视范围内", () => {
    const track = buildTrack();
    const fleet = spawnAiFleet(track.rand);
    expect(fleet).toHaveLength(AI_COUNT);
    // 第一辆约 0.06 圈 = 168 米，位于 DRAW_DIST 视野内
    expect(fleet[0].z).toBeLessThan(420);
  });

  it("掉队太远的车被重新布置到玩家前方 450~900 米", () => {
    const car = spawnAiCar(() => 0.5, 1500); // 玩家在 z=0，车在 1500 米处（环形距离 1300 > 700）
    respawnFarAi(car, () => 0.5, 0);
    const ahead = (car.z - 0 + TRACK_METERS) % TRACK_METERS;
    expect(ahead).toBeGreaterThanOrEqual(450);
    expect(ahead).toBeLessThanOrEqual(900);
  });

  it("距离较近的车不会被移动", () => {
    const car = spawnAiCar(() => 0.5, 300);
    const before = car.z;
    respawnFarAi(car, () => 0.5, 0);
    expect(car.z).toBe(before);
  });
});

describe("advanceLap（圈数推进）", () => {
  it("跨过起点线完成一圈", () => {
    const st = newLapState();
    st.prevZ = TRACK_METERS * 0.9;
    const crossed = advanceLap(st, 10, 32);
    expect(crossed).toBe(true);
    expect(st.lap).toBe(2);
  });

  it("普通前进不算过线", () => {
    const st = newLapState();
    st.prevZ = 100;
    expect(advanceLap(st, 200, 5)).toBe(false);
    expect(st.lap).toBe(1);
  });

  it("更新最佳圈速", () => {
    const st = newLapState();
    st.prevZ = TRACK_METERS * 0.9;
    st.lapStartSec = 0;
    advanceLap(st, 10, 40); // 第一圈 40 秒
    expect(st.bestLapSec).toBe(40);
    expect(st.lapStartSec).toBe(40);
    st.prevZ = TRACK_METERS * 0.9;
    advanceLap(st, 10, 75); // 第二圈 35 秒
    expect(st.bestLapSec).toBe(35);
    expect(st.lap).toBe(3);
  });
});

describe("computeScore / kmh / 工具", () => {
  it("用时越短分数越高", () => {
    expect(computeScore(8400, 120)).toBe(7000);
    expect(computeScore(8400, 105)).toBe(8000);
    expect(computeScore(8400, 105)).toBeGreaterThan(computeScore(8400, 120));
  });

  it("时间为 0 时返回 1（防除零）", () => {
    expect(computeScore(8400, 0)).toBe(1);
  });

  it("kmh 换算", () => {
    expect(kmh(20)).toBe(72);
    expect(kmh(62)).toBe(223);
  });

  it("accelerate 与 clamp", () => {
    expect(accelerate(0, 10, 5, 1)).toBe(5);
    expect(accelerate(8, 10, 5, 1)).toBe(10);
    expect(accelerate(20, 10, 5, 1)).toBe(15);
    expect(clamp(5, 0, 3)).toBe(3);
  });
});

describe("roadsideAt（路边装饰）", () => {
  it("确定性：同一段装饰一致", () => {
    const a = roadsideAt(123);
    const b = roadsideAt(123);
    expect(a?.kind).toBe(b?.kind);
    expect(a?.side).toBe(b?.side);
    expect(a?.x).toBe(b?.x);
  });

  it("装饰位于路外侧", () => {
    for (let i = 0; i < 300; i++) {
      const r = roadsideAt(i);
      if (r) {
        expect(Math.abs(r.x)).toBeGreaterThan(ROAD_W / 2);
        expect(r.side === -1 || r.side === 1).toBe(true);
      }
    }
  });

  it("存在有装饰与无装饰的段", () => {
    let has = false;
    let none = false;
    for (let i = 0; i < 500; i++) {
      if (roadsideAt(i)) has = true;
      else none = true;
    }
    expect(has).toBe(true);
    expect(none).toBe(true);
  });
});
