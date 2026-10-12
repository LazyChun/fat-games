/*
 * GoldMinerGame：黄金矿工
 *
 * Canvas 实现经典玩法：吊绳左右摆动 → 空格/按钮放爪下探 →
 * 抓取金块与钻石后自动收绳；抓到石头会崩断绳子短暂失效。
 * 限定时间内凑够目标金额即过关，关卡越高物品越值钱也越危险；
 * 时间耗尽游戏结束并记录成绩。
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { PlayCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import { recordScore } from "../scoreClient";
import { useI18n } from "../hooks";
import GameFrame, { GhostBtn, CHIP_GOLD, CHIP_GREEN, CHIP_RED, CHIP_BLUE } from "./GameFrame";
import { sfxDrop, sfxGrab, sfxHurt, sfxCoin, sfxLevelUp, sfxLose } from "./sound";
import "./gameAnimations.less";

const W = 520;
const H = 430;
const ANCHOR_X = W / 2;
const ANCHOR_Y = 44;
const GROUND_Y = 372;
const SWING_SPEED = 1.3; // rad / s
const SWING_MAX = (72 * Math.PI) / 180;
const DROP_SPEED = 320; // px / s
const RETRACT_SPEED = 300; // px / s
const BROKEN_PAUSE = 1.25; // s
const CLAW_R = 11;
const MAX_WEIGHT = 30; // 超过该重量的物品（石头）会崩断绳子
const LEVEL_TIME = 60; // 每关秒数
const MIN_ROPE = 44;

type Kind = "gold" | "big" | "diamond" | "stone";
type Phase = "swing" | "drop" | "retract" | "broken";

interface Item {
  id: number;
  kind: Kind;
  x: number;
  y: number;
  r: number;
  value: number;
  weight: number;
}

interface Toast {
  text: string;
  until: number;
  color: string;
}

interface Sim {
  phase: Phase;
  angle: number; // 0 = 垂直向下，向右为正
  angleDir: 1 | -1;
  length: number; // 当前绳长
  dropAngle: number; // 放爪时锁定的角度
  items: Item[];
  carried: Item | null;
  money: number;
  level: number;
  target: number;
  timeLeft: number; // 秒
  brokenAt: number; // ms
  toast: Toast | null;
  over: boolean;
  recorded: boolean;
  lastTs: number;
  dropCount: number;
  lastId: number;
}

interface UiState {
  money: number;
  time: number;
  level: number;
  target: number;
  phase: Phase;
  over: boolean;
}

function levelSpec(level: number): { target: number; count: number } {
  return { target: 150 + (level - 1) * 250, count: Math.min(5 + level * 2, 16) };
}

function makeItem(id: number, level: number): Item {
  const scale = 1 + (level - 1) * 0.15;
  const roll = Math.random() * 100;
  let kind: Kind;
  if (roll < 38) kind = "gold";
  else if (roll < 38 + Math.min(26, 14 + level * 2)) kind = "big";
  else if (roll < 60 + Math.min(16, 6 + level * 3)) kind = "diamond";
  else kind = "stone";

  if (kind === "gold") {
    return { id, kind, x: 0, y: 0, r: 11, value: Math.round((30 + Math.random() * 30) * scale), weight: 3 };
  }
  if (kind === "big") {
    return { id, kind, x: 0, y: 0, r: 16, value: Math.round((110 + Math.random() * 70) * scale), weight: 9 };
  }
  if (kind === "diamond") {
    return { id, kind, x: 0, y: 0, r: 13, value: Math.round((250 + Math.random() * 120) * scale), weight: 4 };
  }
  return { id, kind, x: 0, y: 0, r: 18, value: 0, weight: 60 };
}

function genItems(level: number, startId: number): Item[] {
  const { count } = levelSpec(level);
  const items: Item[] = [];
  let guard = 0;
  while (items.length < count && guard < 400) {
    guard += 1;
    const it = makeItem(startId + items.length, level);
    it.x = 46 + Math.random() * (W - 92);
    // 石头半埋进地面，其余浮在地面上方一点
    it.y = GROUND_Y - it.r - (it.kind === "stone" ? 2 + Math.random() * 8 : 8 + Math.random() * 20);
    if (items.some((o) => Math.hypot(o.x - it.x, o.y - it.y) < 44)) continue;
    items.push(it);
  }
  return items;
}

function newSim(): Sim {
  return {
    phase: "swing",
    angle: 0,
    angleDir: 1,
    length: MIN_ROPE,
    dropAngle: 0,
    items: genItems(1, 1),
    carried: null,
    money: 0,
    level: 1,
    target: levelSpec(1).target,
    timeLeft: LEVEL_TIME,
    brokenAt: 0,
    toast: null,
    over: false,
    recorded: false,
    lastTs: 0,
    dropCount: 0,
    lastId: 100,
  };
}

/** 圆角矩形路径 */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

/** 绘制一个带高光的圆形金块 */
function drawGold(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, 2, x, y, r);
  g.addColorStop(0, "#ffe9a3");
  g.addColorStop(0.55, "#f6c453");
  g.addColorStop(1, "#c78a1e");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  ctx.beginPath();
  ctx.arc(x - r * 0.32, y - r * 0.4, r * 0.2, 0, Math.PI * 2);
  ctx.fill();
}

/** 绘制钻石（多边形 + 棱面 + 高光） */
function drawDiamond(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.save();
  const g = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
  g.addColorStop(0, "#cff5ff");
  g.addColorStop(0.5, "#5ec8f7");
  g.addColorStop(1, "#1d6fd6");
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r * 0.68, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r * 0.68, y);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x, y + r);
  ctx.moveTo(x - r * 0.68, y);
  ctx.lineTo(x + r * 0.68, y);
  ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.arc(x - r * 0.2, y - r * 0.25, r * 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** 绘制石头（灰岩 + 裂纹） */
function drawStone(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 2, x, y, r);
  g.addColorStop(0, "#b9b4ac");
  g.addColorStop(1, "#6f6a62");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(50,45,40,0.5)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(x - r * 0.4, y - r * 0.2);
  ctx.lineTo(x - r * 0.05, y + r * 0.15);
  ctx.lineTo(x + r * 0.3, y + r * 0.05);
  ctx.moveTo(x + r * 0.1, y - r * 0.45);
  ctx.lineTo(x + r * 0.35, y - r * 0.15);
  ctx.stroke();
}

/** 绘制抓钩（两爪 + 环） */
function drawClaw(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.strokeStyle = "#d8a44c";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - 9, y + 16);
  ctx.moveTo(x, y);
  ctx.lineTo(x + 9, y + 16);
  ctx.stroke();
  ctx.fillStyle = "#d8a44c";
  ctx.beginPath();
  ctx.arc(x, y, 4.5, 0, Math.PI * 2);
  ctx.fill();
}

function drawScene(ctx: CanvasRenderingContext2D, sim: Sim, now: number): void {
  ctx.clearRect(0, 0, W, H);

  // 天空
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  sky.addColorStop(0, "#bfe3ff");
  sky.addColorStop(1, "#eaf6ff");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, GROUND_Y);

  // 地面
  const dirt = ctx.createLinearGradient(0, GROUND_Y, 0, H);
  dirt.addColorStop(0, "#9a6b3f");
  dirt.addColorStop(1, "#5f3d22");
  ctx.fillStyle = dirt;
  ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
  ctx.fillStyle = "#6c9a3f";
  ctx.fillRect(0, GROUND_Y, W, 6);

  // 物品
  for (const it of sim.items) {
    if (it.kind === "gold") drawGold(ctx, it.x, it.y, it.r);
    else if (it.kind === "big") drawGold(ctx, it.x, it.y, it.r);
    else if (it.kind === "diamond") drawDiamond(ctx, it.x, it.y, it.r);
    else drawStone(ctx, it.x, it.y, it.r);
  }

  // 绳与爪
  const dirX = Math.sin(sim.angle);
  const dirY = Math.cos(sim.angle);
  const tipX = ANCHOR_X + dirX * sim.length;
  const tipY = ANCHOR_Y + dirY * sim.length;

  ctx.strokeStyle = "#b0a184";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ANCHOR_X, ANCHOR_Y);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();

  // 吊绳顶端固定环
  ctx.strokeStyle = "#8a7a5a";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(ANCHOR_X, ANCHOR_Y, 4, 0, Math.PI * 2);
  ctx.stroke();

  if (sim.phase === "broken") {
    // 断绳：只画到 2/3 处，画毛边
    const bx = ANCHOR_X + dirX * sim.length * 0.6;
    const by = ANCHOR_Y + dirY * sim.length * 0.6;
    ctx.strokeStyle = "#b0a184";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ANCHOR_X, ANCHOR_Y);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.fillStyle = "#d8a44c";
    ctx.font = "12px sans-serif";
    ctx.fillText("✕", bx + 6, by + 6);
  } else {
    drawClaw(ctx, tipX, tipY);
    if (sim.carried) {
      const it = sim.carried;
      const cy = tipY + it.r + 8;
      if (it.kind === "gold" || it.kind === "big") drawGold(ctx, tipX, cy, it.r);
      else if (it.kind === "diamond") drawDiamond(ctx, tipX, cy, it.r);
      else drawStone(ctx, tipX, cy, it.r);
    }
  }

  // 漂浮提示（过关 / 断绳）
  if (sim.toast && now < sim.toast.until) {
    const remain = (sim.toast.until - now) / 1000;
    ctx.globalAlpha = Math.min(1, remain / 0.3);
    ctx.fillStyle = sim.toast.color;
    ctx.font = "bold 26px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(sim.toast.text, W / 2, 190);
    ctx.globalAlpha = 1;
    ctx.textAlign = "start";
  }

  // 倒计时最后 10 秒：放大闪烁
  if (!sim.over && sim.timeLeft <= 10) {
    const blink = Math.sin(now / 130) > 0 ? 1 : 0.35;
    ctx.globalAlpha = blink;
    ctx.fillStyle = "#e5484d";
    ctx.font = "bold 20px sans-serif";
    ctx.textAlign = "right";
    ctx.fillText(`${Math.max(0, Math.ceil(sim.timeLeft))}s`, W - 12, 34);
    ctx.globalAlpha = 1;
    ctx.textAlign = "start";
  }
}

const GoldMinerGame: React.FC<{ sdk: FatNotesPluginSDK }> = () => {
  const i18n = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<Sim>(newSim());
  const lastUiRef = useRef<UiState>({
    money: 0,
    time: LEVEL_TIME,
    level: 1,
    target: simRef.current.target,
    phase: "swing",
    over: false,
  });
  const [ui, setUi] = useState<UiState>(lastUiRef.current);

  const syncUi = () => {
    const s = simRef.current;
    const next: UiState = {
      money: s.money,
      time: Math.max(0, Math.ceil(s.timeLeft)),
      level: s.level,
      target: s.target,
      phase: s.phase,
      over: s.over,
    };
    const prev = lastUiRef.current;
    if (
      next.money !== prev.money ||
      next.time !== prev.time ||
      next.level !== prev.level ||
      next.target !== prev.target ||
      next.phase !== prev.phase ||
      next.over !== prev.over
    ) {
      lastUiRef.current = next;
      setUi(next);
    }
  };

  const drop = useCallback(() => {
    const s = simRef.current;
    if (s.over || s.phase !== "swing") return;
    s.phase = "drop";
    s.dropAngle = s.angle;
    s.dropCount += 1;
    sfxDrop();
  }, []);

  const restart = useCallback(() => {
    simRef.current = newSim();
    lastUiRef.current = {
      money: 0,
      time: LEVEL_TIME,
      level: 1,
      target: simRef.current.target,
      phase: "swing",
      over: false,
    };
    setUi(lastUiRef.current);
  }, []);

  // 游戏主循环
  useEffect(() => {
    let raf = 0;
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      const s = simRef.current;
      if (!s.lastTs) s.lastTs = ts;
      const dt = Math.min(0.05, (ts - s.lastTs) / 1000);
      s.lastTs = ts;

      if (!s.over) {
        s.timeLeft -= dt;

        if (s.phase === "swing") {
          s.angle += s.angleDir * SWING_SPEED * dt;
          if (s.angle > SWING_MAX) {
            s.angle = SWING_MAX;
            s.angleDir = -1;
          } else if (s.angle < -SWING_MAX) {
            s.angle = -SWING_MAX;
            s.angleDir = 1;
          }
        } else if (s.phase === "drop") {
          s.length += DROP_SPEED * dt;
          const tipX = ANCHOR_X + Math.sin(s.dropAngle) * s.length;
          const tipY = ANCHOR_Y + Math.cos(s.dropAngle) * s.length;
          // 触底自动收绳
          if (tipY >= GROUND_Y - 4) {
            s.length = Math.min(s.length, (GROUND_Y - ANCHOR_Y) / Math.cos(s.dropAngle));
            s.phase = "retract";
          } else {
            // 碰撞检测
            for (const it of s.items) {
              const d = Math.hypot(tipX - it.x, tipY - it.y);
              if (d <= it.r + CLAW_R + 3) {
                if (it.weight <= MAX_WEIGHT) {
                  s.carried = it;
                  s.phase = "retract";
                  sfxGrab();
                } else {
                  s.phase = "broken";
                  s.brokenAt = ts;
                  sfxHurt();
                  s.toast = { text: i18n.text("game.goldminer.ropeBroken"), until: ts + 1200, color: "#e5484d" };
                }
                break;
              }
            }
          }
        } else if (s.phase === "retract") {
          s.length -= RETRACT_SPEED * dt;
          if (s.length <= MIN_ROPE) {
            s.length = MIN_ROPE;
            if (s.carried) {
              s.money += s.carried.value;
              s.items = s.items.filter((it) => it.id !== s.carried!.id);
              s.carried = null;
              sfxCoin();
              if (s.money >= s.target) {
                s.level += 1;
                const spec = levelSpec(s.level);
                s.target = spec.target;
                s.items = genItems(s.level, s.lastId);
                s.lastId += spec.count + 5;
                s.timeLeft = LEVEL_TIME;
                sfxLevelUp();
                s.toast = {
                  text: i18n.text("game.goldminer.levelUp", { level: s.level }),
                  until: ts + 1400,
                  color: "#2e9e5b",
                };
              }
            }
            s.phase = "swing";
          }
        } else if (s.phase === "broken") {
          if (ts - s.brokenAt >= BROKEN_PAUSE * 1000) {
            s.phase = "swing";
            s.length = MIN_ROPE;
          }
        }

        if (s.timeLeft <= 0) {
          s.timeLeft = 0;
          s.over = true;
          sfxLose();
          if (!s.recorded) {
            s.recorded = true;
            recordScore({
              gameId: "goldminer",
              gameTitle: "黄金矿工",
              score: s.money,
              detail: { level: s.level, target: s.target, collected: s.money },
            });
          }
        }
      }

      drawScene(ctx, s, ts);
      syncUi();
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 键盘：空格 / 回车放爪
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === "Enter") {
        e.preventDefault();
        drop();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [drop]);

  const idleShow = ui.phase === "swing" && !ui.over && simRef.current.dropCount === 0;

  return (
    <GameFrame
      emoji="⛏️"
      title={i18n.text("game.goldminer.title")}
      stats={[
        { label: i18n.text("game.goldminer.money"), value: ui.money, colors: CHIP_GOLD },
        { label: i18n.text("game.goldminer.target"), value: ui.target, colors: CHIP_GREEN },
        { label: i18n.text("game.goldminer.time"), value: `${ui.time}s`, colors: CHIP_RED },
        { label: i18n.text("game.goldminer.level"), value: ui.level, colors: CHIP_BLUE },
      ]}
      headerExtra={
        <>
          <GhostBtn onClick={drop} disabled={ui.phase !== "swing" || ui.over}>
            <PlayCircleOutlined />
            {i18n.text("game.goldminer.drop")}
          </GhostBtn>
          <GhostBtn onClick={restart}>
            <ReloadOutlined />
            {i18n.text("game.goldminer.restart")}
          </GhostBtn>
        </>
      }
      help={i18n.text("game.goldminer.help")}
      maxWidth={560}
    >
      <div
        style={{
          position: "relative",
          width: W,
          height: H,
          borderRadius: 14,
          overflow: "hidden",
          boxShadow: "0 8px 24px rgba(60,90,120,0.25)",
          border: "3px solid rgba(120,140,160,0.5)",
        }}
      >
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          style={{ display: "block" }}
        />
        {ui.over && (
          <div
            className="gs-win-in"
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(240,247,255,0.85)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              alignItems: "center",
              justifyContent: "center",
              color: "#8a5a00",
            }}
          >
            <div style={{ fontSize: 28, fontWeight: 900 }}>
              {i18n.text("game.goldminer.over.title")}
            </div>
            <div style={{ fontSize: 15, opacity: 0.85 }}>
              {i18n.text("game.goldminer.over.score", { score: ui.money })}
            </div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {i18n.text("game.goldminer.over.level", { level: ui.level })}
            </div>
            <GhostBtn onClick={restart}>
              <ReloadOutlined />
              {i18n.text("game.goldminer.again")}
            </GhostBtn>
          </div>
        )}
        {idleShow && (
          <div
            className="gs-pulse"
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(240,247,255,0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#2b6cb0",
              fontSize: 16,
              fontWeight: 700,
              pointerEvents: "none",
            }}
          >
            {i18n.text("game.goldminer.idle")}
          </div>
        )}
        {ui.phase === "broken" && !ui.over && (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 26,
              display: "flex",
              justifyContent: "center",
              color: "#e5484d",
              fontSize: 13,
              fontWeight: 700,
              pointerEvents: "none",
            }}
          >
            {i18n.text("game.goldminer.ropeBroken")}
          </div>
        )}
      </div>
    </GameFrame>
  );
};

export default GoldMinerGame;
