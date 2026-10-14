/*
 * CurlingGame：冰壶（Curling）
 *
 * Canvas 俯视冰道：玩家（红壶）与 AI（黄壶）8 局对战，每局各投 4 壶。
 * 交互：移动鼠标选投掷点并瞄准（虚线），按住左键蓄力、松开投出。
 * 物理：线性摩擦减速 + 等质量弹性碰撞（见 curlingLogic.ts）。
 * 规则：局末距大本营圆心最近的一方得分（在大本营内、每比对方最内
 * 一壶更近得 1 分）；壶未过前掷线或滑出冰面被移除。8 局后总分高者胜。
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ReloadOutlined } from "@ant-design/icons";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import { recordScore } from "../scoreClient";
import { useI18n } from "../hooks";
import GameFrame, { GhostBtn, CHIP_GOLD, CHIP_RED, CHIP_BLUE } from "./GameFrame";
import {
  aiThrow,
  allStopped,
  BOUND_BOTTOM,
  BOUND_LEFT,
  BOUND_RIGHT,
  BOUND_TOP,
  CHARGE_TIME,
  clamp,
  cullInvalid,
  H,
  HOG_X,
  HOUSE_R,
  makeStone,
  MAX_POWER_V,
  MIN_POWER_V,
  scoreEnd,
  stepStones,
  STONE_R,
  TEE_X,
  TEE_Y,
  THROW_X,
  THROWS_PER_END,
  TOTAL_ENDS,
  W,
  whoseTurn,
  type Side,
  type Stone,
} from "./curlingLogic";
import { sfxBounce, sfxClick, sfxDrop, sfxHurt, sfxLose, sfxScore, sfxWin } from "./sound";
import "./gameAnimations.less";

type Phase = "player" | "ai" | "sliding" | "over";
type Result = "player" | "ai" | "draw";

interface Sim {
  stones: Stone[];
  end: number;
  phase: Phase;
  playerTotal: number;
  aiTotal: number;
  throwsLeft: number;
  first: Side;
  turn: Side | null;
  power: number;
  charging: boolean;
  mouseX: number;
  mouseY: number;
  pendingY: number;
  over: Result | null;
  endResult: { player: number; ai: number } | null;
  recorded: boolean;
  lastTs: number;
  nextId: number;
}

interface UiState {
  end: number;
  phase: Phase;
  playerTotal: number;
  aiTotal: number;
  throwsLeft: number;
  turn: Side | null;
  over: Result | null;
  endResult: { player: number; ai: number } | null;
  charging: boolean;
}

function newSim(): Sim {
  return {
    stones: [],
    end: 1,
    phase: "player",
    playerTotal: 0,
    aiTotal: 0,
    throwsLeft: THROWS_PER_END,
    first: "player",
    turn: "player",
    power: 0,
    charging: false,
    mouseX: 170,
    mouseY: TEE_Y,
    pendingY: TEE_Y,
    over: null,
    endResult: null,
    recorded: false,
    lastTs: 0,
    nextId: 1,
  };
}

function toUi(s: Sim): UiState {
  return {
    end: s.end,
    phase: s.phase,
    playerTotal: s.playerTotal,
    aiTotal: s.aiTotal,
    throwsLeft: s.throwsLeft,
    turn: s.turn,
    over: s.over,
    endResult: s.endResult,
    charging: s.charging,
  };
}

/* ------------------------------------------------------------------ */
/* 冰面纹理（固定伪随机，一次性生成）                                   */
/* ------------------------------------------------------------------ */

interface IceLine {
  x: number;
  y: number;
  len: number;
  angle: number;
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const ICE_SPECKS = (() => {
  const rnd = lcg(20241014);
  return Array.from({ length: 110 }, () => ({
    x: rnd() * W,
    y: rnd() * H,
    r: 0.5 + rnd() * 1.4,
  }));
})();

const ICE_LINES: IceLine[] = (() => {
  const rnd = lcg(8848);
  return Array.from({ length: 24 }, () => ({
    x: rnd() * W,
    y: rnd() * H,
    len: 40 + rnd() * 110,
    angle: rnd() * Math.PI,
  }));
})();

/* ------------------------------------------------------------------ */
/* 绘制                                                               */
/* ------------------------------------------------------------------ */

function roundRect(
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

/** 绘制一个冰壶（渐变球体 + 手柄环 + 中心点） */
function drawStone(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  side: Side,
  alpha = 1,
): void {
  const isPlayer = side === "player";
  const g = ctx.createRadialGradient(x - 4, y - 5, 2, x, y, STONE_R);
  if (isPlayer) {
    g.addColorStop(0, "#ff9d90");
    g.addColorStop(0.55, "#e5484d");
    g.addColorStop(1, "#a62f35");
  } else {
    g.addColorStop(0, "#ffe28a");
    g.addColorStop(0.55, "#f0a232");
    g.addColorStop(1, "#b06a14");
  }
  ctx.globalAlpha = alpha;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, STONE_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.28)";
  ctx.lineWidth = 1.4;
  ctx.stroke();
  // 手柄环
  ctx.fillStyle = isPlayer ? "#fff" : "#3a2a12";
  ctx.beginPath();
  ctx.arc(x, y, STONE_R * 0.5, 0, Math.PI * 2);
  ctx.fill();
  // 中心点
  ctx.fillStyle = isPlayer ? "#e5484d" : "#f0a232";
  ctx.beginPath();
  ctx.arc(x, y, STONE_R * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawHouse(ctx: CanvasRenderingContext2D): void {
  const rings: { r: number; color: string }[] = [
    { r: HOUSE_R, color: "#4a7fd4" },
    { r: HOUSE_R * 0.75, color: "#f7fbfe" },
    { r: HOUSE_R * 0.5, color: "#e05b52" },
    { r: HOUSE_R * 0.25, color: "#f7fbfe" },
  ];
  for (const ring of rings) {
    ctx.fillStyle = ring.color;
    ctx.beginPath();
    ctx.arc(TEE_X, TEE_Y, ring.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#4a7fd4";
  ctx.beginPath();
  ctx.arc(TEE_X, TEE_Y, 6, 0, Math.PI * 2);
  ctx.fill();
  // 外环描边，让白色环在冰面上可辨
  ctx.strokeStyle = "rgba(70,110,160,0.4)";
  ctx.lineWidth = 1.2;
  for (const ring of rings) {
    ctx.beginPath();
    ctx.arc(TEE_X, TEE_Y, ring.r, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawLines(ctx: CanvasRenderingContext2D): void {
  ctx.lineWidth = 1.4;
  // 中心线（贯穿冰道）
  ctx.strokeStyle = "rgba(120,155,200,0.55)";
  ctx.beginPath();
  ctx.moveTo(TEE_X, BOUND_TOP - 10);
  ctx.lineTo(TEE_X, BOUND_BOTTOM + 10);
  ctx.stroke();
  // tee line（横向穿过圆心）
  ctx.strokeStyle = "rgba(120,155,200,0.6)";
  ctx.beginPath();
  ctx.moveTo(TEE_X - HOUSE_R - 34, TEE_Y);
  ctx.lineTo(TEE_X + HOUSE_R + 34, TEE_Y);
  ctx.stroke();
  // 前掷线（红色实线）
  ctx.strokeStyle = "rgba(229,72,77,0.75)";
  ctx.beginPath();
  ctx.moveTo(HOG_X, BOUND_TOP - 10);
  ctx.lineTo(HOG_X, BOUND_BOTTOM + 10);
  ctx.stroke();
  // 起手线（虚线）
  ctx.setLineDash([7, 6]);
  ctx.strokeStyle = "rgba(120,155,200,0.7)";
  ctx.beginPath();
  ctx.moveTo(THROW_X, BOUND_TOP - 10);
  ctx.lineTo(THROW_X, BOUND_BOTTOM + 10);
  ctx.stroke();
  ctx.setLineDash([]);
  // 冰道边界
  ctx.strokeStyle = "rgba(90,130,170,0.5)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(8, BOUND_TOP);
  ctx.lineTo(W - 8, BOUND_TOP);
  ctx.moveTo(8, BOUND_BOTTOM);
  ctx.lineTo(W - 8, BOUND_BOTTOM);
  ctx.stroke();
}

function drawPowerBar(ctx: CanvasRenderingContext2D, power: number): void {
  const bw = 176;
  const bh = 10;
  const bx = (W - bw) / 2;
  const by = H - 18;
  ctx.fillStyle = "rgba(255,255,255,0.8)";
  roundRect(ctx, bx, by, bw, bh, 5);
  ctx.fill();
  ctx.strokeStyle = "rgba(80,120,160,0.35)";
  ctx.lineWidth = 1;
  roundRect(ctx, bx, by, bw, bh, 5);
  ctx.stroke();
  if (power > 0.005) {
    const grad = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    grad.addColorStop(0, "#3db861");
    grad.addColorStop(0.55, "#f6c453");
    grad.addColorStop(1, "#e5484d");
    ctx.fillStyle = grad;
    roundRect(ctx, bx, by, Math.max(6, bw * power), bh, 5);
    ctx.fill();
  }
  ctx.fillStyle = "rgba(31,78,121,0.8)";
  ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`${Math.round(power * 100)}%`, W / 2, by - 5);
  ctx.textAlign = "start";
}

function drawScene(ctx: CanvasRenderingContext2D, sim: Sim, now: number): void {
  ctx.clearRect(0, 0, W, H);
  // 冰面
  const ice = ctx.createLinearGradient(0, 0, 0, H);
  ice.addColorStop(0, "#eef7fd");
  ice.addColorStop(0.5, "#ddeffb");
  ice.addColorStop(1, "#eef7fd");
  ctx.fillStyle = ice;
  ctx.fillRect(0, 0, W, H);
  // 冰纹
  ctx.fillStyle = "rgba(255,255,255,0.5)";
  for (const sp of ICE_SPECKS) {
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, sp.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = "rgba(255,255,255,0.42)";
  ctx.lineWidth = 0.9;
  for (const ln of ICE_LINES) {
    const dx = Math.cos(ln.angle) * ln.len;
    const dy = Math.sin(ln.angle) * ln.len;
    ctx.beginPath();
    ctx.moveTo(ln.x - dx / 2, ln.y - dy / 2);
    ctx.lineTo(ln.x + dx / 2, ln.y + dy / 2);
    ctx.stroke();
  }
  drawHouse(ctx);
  drawLines(ctx);

  // 已投出的壶
  for (const s of sim.stones) {
    if (s.active) drawStone(ctx, s.x, s.y, s.side);
  }

  // 玩家回合：待投壶 + 瞄准线 + 力度条
  if (sim.phase === "player") {
    const py = sim.pendingY;
    // 呼吸光圈
    const glow = 0.45 + 0.3 * Math.sin(now / 240);
    ctx.strokeStyle = `rgba(229,72,77,${glow.toFixed(3)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(THROW_X, py, STONE_R + 7 + Math.sin(now / 240) * 3, 0, Math.PI * 2);
    ctx.stroke();
    drawStone(ctx, THROW_X, py, "player", 0.82);

    // 瞄准虚线（待投壶 → 鼠标）
    if (sim.mouseX >= 0 && sim.mouseY >= 0) {
      const dx = sim.mouseX - THROW_X;
      const dy = sim.mouseY - py;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      ctx.setLineDash([6, 6]);
      ctx.strokeStyle = "rgba(229,72,77,0.65)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(THROW_X, py);
      ctx.lineTo(THROW_X + ux * 235, py + uy * 235);
      ctx.stroke();
      // 方向箭头
      const ax = THROW_X + ux * 214;
      const ay = py + uy * 214;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(ax - ux * 12 + uy * 7, ay - uy * 12 - ux * 7);
      ctx.lineTo(ax - ux * 12 - uy * 7, ay - uy * 12 + ux * 7);
      ctx.closePath();
      ctx.fillStyle = "rgba(229,72,77,0.65)";
      ctx.fill();
      ctx.setLineDash([]);
    }

    if (sim.charging) drawPowerBar(ctx, sim.power);
  }
}

/* ------------------------------------------------------------------ */
/* 组件                                                               */
/* ------------------------------------------------------------------ */

const CurlingGame: React.FC<{ sdk: FatNotesPluginSDK }> = () => {
  const i18n = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<Sim>(newSim());
  const timersRef = useRef<number[]>([]);
  const [ui, setUi] = useState<UiState>(() => toUi(simRef.current));
  const [banner, setBanner] = useState<{ text: string; color: string } | null>(null);

  const syncUi = useCallback(() => {
    setUi(toUi(simRef.current));
  }, []);

  /** 显示短暂横幅提示（自动清除） */
  const showBanner = useCallback((text: string, color: string) => {
    setBanner({ text, color });
    const t = window.setTimeout(() => setBanner(null), 1700);
    timersRef.current.push(t);
  }, []);

  const clearTimers = () => {
    timersRef.current.forEach((t) => window.clearTimeout(t));
    timersRef.current = [];
  };

  /* ---------------- 流程控制 ---------------- */

  const scheduleAi = useCallback(() => {
    const t = window.setTimeout(() => {
      const s = simRef.current;
      if (s.phase !== "ai") return;
      const d = aiThrow(s.stones);
      s.stones.push(makeStone(s.nextId++, "ai", THROW_X, d.y, d.vx, d.vy));
      s.phase = "sliding";
      s.turn = null;
      sfxDrop();
      syncUi();
    }, 650 + Math.random() * 550);
    timersRef.current.push(t);
  }, [syncUi]);

  const beginNextOrFinish = useCallback(() => {
    const s = simRef.current;
    if (s.end >= TOTAL_ENDS) {
      s.phase = "over";
      s.turn = null;
      s.over =
        s.playerTotal > s.aiTotal ? "player" : s.playerTotal < s.aiTotal ? "ai" : "draw";
      if (!s.recorded) {
        s.recorded = true;
        recordScore({
          gameId: "curling",
          gameTitle: i18n.text("game.curling.title"),
          score: s.playerTotal,
          detail: { ends: TOTAL_ENDS, aiScore: s.aiTotal, playerScore: s.playerTotal },
        });
      }
      if (s.over === "player") sfxWin();
      else if (s.over === "ai") sfxLose();
      else sfxScore();
    } else {
      s.end += 1;
      s.first = s.end % 2 === 0 ? "ai" : "player";
      s.stones = [];
      s.throwsLeft = THROWS_PER_END;
      s.turn = s.first;
      s.phase = s.turn;
      s.pendingY = TEE_Y;
      s.endResult = null;
      if (s.turn === "ai") scheduleAi();
    }
    syncUi();
  }, [i18n, scheduleAi, syncUi]);

  /** 玩家投壶 */
  const throwPlayer = useCallback(() => {
    const s = simRef.current;
    if (s.phase !== "player" || !s.charging) return;
    s.charging = false;
    const p = s.power;
    s.power = 0;
    if (p < 0.05) {
      syncUi();
      return;
    }
    const mx = s.mouseX >= 0 ? s.mouseX : TEE_X;
    const my = s.mouseY >= 0 ? s.mouseY : TEE_Y;
    let dx = mx - THROW_X;
    let dy = my - s.pendingY;
    const len = Math.hypot(dx, dy);
    if (len < 1) {
      dx = -1;
      dy = 0;
    } else {
      dx /= len;
      dy /= len;
    }
    const v = MIN_POWER_V + p * (MAX_POWER_V - MIN_POWER_V);
    s.stones.push(makeStone(s.nextId++, "player", THROW_X, s.pendingY, dx * v, dy * v));
    s.phase = "sliding";
    s.turn = null;
    sfxDrop();
    syncUi();
  }, [syncUi]);

  /** 一投结束后结算（移除无效壶、决定下一投或计分） */
  const settleStones = useCallback(() => {
    const s = simRef.current;
    if (s.phase !== "sliding") return;
    const cull = cullInvalid(s.stones);
    if (cull.removed.length > 0) {
      const text =
        cull.short > 0 && cull.out > 0
          ? i18n.text("game.curling.removedBoth")
          : cull.short > 0
            ? i18n.text("game.curling.noHog")
            : i18n.text("game.curling.out");
      showBanner(text, "#e5484d");
      sfxHurt();
    }
    s.throwsLeft -= 1;
    if (s.throwsLeft > 0) {
      s.turn = whoseTurn(s.throwsLeft, s.first);
      s.phase = s.turn;
      if (s.turn === "player") s.pendingY = clamp(s.pendingY, BOUND_TOP + STONE_R + 4, BOUND_BOTTOM - STONE_R - 4);
      syncUi();
      if (s.turn === "ai") scheduleAi();
    } else {
      const res = scoreEnd(s.stones);
      s.playerTotal += res.player;
      s.aiTotal += res.ai;
      s.endResult = res;
      if (res.player === 0 && res.ai === 0) {
        showBanner(i18n.text("game.curling.endScoreNone"), "#8a8a8a");
        sfxClick();
      } else if (res.player > 0) {
        showBanner(i18n.text("game.curling.endScore", { score: res.player }), "#2e9e5b");
        sfxScore();
      } else {
        showBanner(i18n.text("game.curling.endScoreAi", { score: res.ai }), "#e5484d");
        sfxLose();
      }
      syncUi();
      const t = window.setTimeout(beginNextOrFinish, 1900);
      timersRef.current.push(t);
    }
  }, [beginNextOrFinish, i18n, scheduleAi, showBanner, syncUi]);

  const restart = useCallback(() => {
    clearTimers();
    simRef.current = newSim();
    setBanner(null);
    syncUi();
  }, [syncUi]);

  /* ---------------- 主循环 ---------------- */

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

      if (s.phase === "sliding") {
        stepStones(s.stones, dt);
        // 碰撞音效（分离中的壶对）
        if (collidingNow(s.stones)) sfxBounce();
        if (allStopped(s.stones)) settleStones();
      } else if (s.phase === "player" && s.charging) {
        s.power = Math.min(1, s.power + dt / CHARGE_TIME);
      }

      drawScene(ctx, s, ts);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [settleStones]);

  /* ---------------- 鼠标 / 键盘交互 ---------------- */

  const onMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const s = simRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    s.mouseX = x;
    s.mouseY = y;
    if (s.phase === "player") {
      s.pendingY = clamp(y, BOUND_TOP + STONE_R + 4, BOUND_BOTTOM - STONE_R - 4);
    }
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const s = simRef.current;
    if (s.phase !== "player" || s.charging) return;
    s.charging = true;
    s.power = 0;
    sfxClick();
    syncUi();
  }, [syncUi]);

  const onMouseUp = useCallback(() => {
    throwPlayer();
  }, [throwPlayer]);

  const onMouseLeave = useCallback(() => {
    const s = simRef.current;
    s.mouseX = -1;
    s.mouseY = -1;
    if (s.charging) {
      s.charging = false;
      s.power = 0;
      syncUi();
    }
  }, [syncUi]);

  useEffect(() => {
    window.addEventListener("mouseup", onMouseUp);
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "r" || e.key === "R") restart();
    };
    window.addEventListener("keydown", keyHandler);
    return () => {
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("keydown", keyHandler);
      clearTimers();
    };
  }, [onMouseUp, restart]);

  /* ---------------- 渲染 ---------------- */

  const endResultText = ui.endResult
    ? ui.endResult.player === 0 && ui.endResult.ai === 0
      ? i18n.text("game.curling.endScoreNone")
      : ui.endResult.player > 0
        ? i18n.text("game.curling.endScore", { score: ui.endResult.player })
        : i18n.text("game.curling.endScoreAi", { score: ui.endResult.ai })
    : "";
  const overTitle =
    ui.over === "player"
      ? i18n.text("game.curling.win")
      : ui.over === "ai"
        ? i18n.text("game.curling.lose")
        : i18n.text("game.curling.draw");

  return (
    <GameFrame
      emoji="🥌"
      title={i18n.text("game.curling.title")}
      stats={[
        {
          label: i18n.text("game.curling.end"),
          value: `${ui.end}/${TOTAL_ENDS}`,
          colors: CHIP_BLUE,
        },
        { label: i18n.text("game.curling.youScore"), value: ui.playerTotal, colors: CHIP_RED },
        { label: i18n.text("game.curling.aiScore"), value: ui.aiTotal, colors: CHIP_GOLD },
        { label: i18n.text("game.curling.remaining"), value: ui.throwsLeft },
      ]}
      headerExtra={
        <GhostBtn onClick={restart}>
          <ReloadOutlined />
          {i18n.text("game.curling.restart")}
        </GhostBtn>
      }
      help={i18n.text("game.curling.help")}
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
          border: "3px solid rgba(110,150,190,0.55)",
          cursor: ui.phase === "player" ? "crosshair" : "default",
        }}
      >
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          style={{ display: "block" }}
          onMouseMove={onMouseMove}
          onMouseDown={onMouseDown}
          onMouseLeave={onMouseLeave}
        />

        {/* 回合提示胶囊 */}
        {(ui.phase === "player" || ui.phase === "ai") && (
          <div
            style={{
              position: "absolute",
              top: 10,
              left: 0,
              right: 0,
              display: "flex",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                background:
                  ui.phase === "player"
                    ? "rgba(229,72,77,0.92)"
                    : "rgba(240,162,50,0.92)",
                color: "#fff",
                fontSize: 13,
                fontWeight: 700,
                padding: "5px 14px",
                borderRadius: 14,
                boxShadow: "0 3px 10px rgba(0,0,0,0.2)",
              }}
            >
              {ui.phase === "player"
                ? i18n.text("game.curling.yourTurn")
                : i18n.text("game.curling.aiTurn")}
            </div>
          </div>
        )}

        {/* 瞄准操作提示 */}
        {ui.phase === "player" && !ui.charging && (
          <div
            style={{
              position: "absolute",
              bottom: 32,
              left: 0,
              right: 0,
              textAlign: "center",
              fontSize: 12,
              fontWeight: 600,
              color: "rgba(31,78,121,0.85)",
              pointerEvents: "none",
              textShadow: "0 1px 2px rgba(255,255,255,0.8)",
            }}
          >
            {i18n.text("game.curling.aimTip")}
          </div>
        )}

        {/* 横幅提示（未过线 / 出界 / 本局得分） */}
        {banner && (
          <div
            className="gs-pulse"
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(238,247,253,0.55)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                fontSize: 17,
                fontWeight: 800,
                color: banner.color,
                textAlign: "center",
                padding: "0 20px",
              }}
            >
              {banner.text}
            </div>
          </div>
        )}

        {/* 局末得分横幅 */}
        {ui.endResult && (
          <div
            className="gs-pulse"
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(238,247,253,0.75)",
              display: "flex",
              flexDirection: "column",
              gap: 6,
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <div style={{ fontSize: 22, fontWeight: 900, color: "#1f4e79" }}>
              {endResultText}
            </div>
            <div style={{ fontSize: 13, opacity: 0.7, color: "#1f4e79" }}>
              {i18n.text("game.curling.curScore", {
                you: ui.playerTotal,
                ai: ui.aiTotal,
              })}
            </div>
          </div>
        )}

        {/* 游戏结束 */}
        {ui.over && (
          <div
            className="gs-win-in"
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(238,247,253,0.92)",
              display: "flex",
              flexDirection: "column",
              gap: 12,
              alignItems: "center",
              justifyContent: "center",
              color: "#1f4e79",
            }}
          >
            <div style={{ fontSize: 28, fontWeight: 900 }}>{overTitle}</div>
            <div style={{ fontSize: 16, opacity: 0.85 }}>
              {i18n.text("game.curling.final", {
                you: ui.playerTotal,
                ai: ui.aiTotal,
              })}
            </div>
            <GhostBtn onClick={restart}>
              <ReloadOutlined />
              {i18n.text("game.curling.again")}
            </GhostBtn>
          </div>
        )}
      </div>
    </GameFrame>
  );
};

/** 检测是否有壶对正在互相分离（碰撞刚发生），用于触发碰撞音效 */
function collidingNow(stones: Stone[]): boolean {
  for (let i = 0; i < stones.length; i++) {
    const a = stones[i];
    if (!a.active) continue;
    for (let j = i + 1; j < stones.length; j++) {
      const b = stones[j];
      if (!b.active) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      if (dist < STONE_R * 2 + 2 && dist > 0) {
        const nx = dx / dist;
        const ny = dy / dist;
        const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
        if (rel > 1) return true;
      }
    }
  }
  return false;
}

export default CurlingGame;
