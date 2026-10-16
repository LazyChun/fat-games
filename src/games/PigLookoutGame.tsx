/*
 * PigLookoutGame：猪猪的远望（飞行距离小游戏）
 *
 * 玩法：小猪坐在悬崖边的弹弓上，按住向后下方拖拽蓄力（向左下拖
 * → 向右上射），松开把小猪弹出去。重力 + 风力影响抛物线；空中云
 * 朵会把小猪再向上托一把；地面金币碰到加分。落地后小猪在草地上
 * 摩擦滚停，按落点距离计分。共 5 次投掷，取最远一次为成绩。
 */
import React, { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import { recordScore } from "../scoreClient";
import { useI18n } from "../hooks";
import GameFrame, {
  GhostBtn,
  PrimaryBtn,
  CHIP_GOLD,
  CHIP_GREEN,
  CHIP_BLUE,
  CHIP_PURPLE,
  CHIP_RED,
} from "./GameFrame";
import {
  sfxShoot,
  sfxLand,
  sfxBounce,
  sfxCoin,
  sfxScore,
  sfxLose,
  sfxWin,
} from "./sound";
import {
  PIG,
  computeLaunch,
  createWorld,
  finalScore,
  groundYAt,
  previewPath,
  startGame,
  startToss,
  stepWorld,
  type GameEvent,
  type World,
} from "./pigLogic";

const W = PIG.W;
const H = PIG.H;
const BEST_KEY = "fat-games.piglook.best";

interface Fx {
  x: number;
  y: number;
  text: string;
  color: string;
  born: number;
  life: number;
}

interface Hud {
  phase: World["phase"];
  toss: number;
  tossesLeft: number;
  wind: number;
  lastDistM: number;
  bestDistM: number;
  coinsCollected: number;
  best: number;
}

const PigLookoutGame: React.FC<{ sdk: FatNotesPluginSDK }> = () => {
  const i18n = useI18n();
  const worldRef = useRef<World>(null as unknown as World);
  if (!worldRef.current) {
    worldRef.current = createWorld();
  }

  const [, force] = useReducer((x: number) => x + 1, 0);
  const [hud, setHud] = useState<Hud>(() => snapshot(worldRef.current));
  const [recorded, setRecorded] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggingRef = useRef(false);
  const pointerRef = useRef({ x: 0, y: 0 });
  const previewRef = useRef<{ x: number; y: number }[] | null>(null);
  const fxRef = useRef<Fx[]>([]);
  const lastTRef = useRef(0);
  const rafRef = useRef(0);

  function snapshot(w: World): Hud {
    const best = Number(window.localStorage.getItem(BEST_KEY) || "0");
    return {
      phase: w.phase,
      toss: w.toss,
      tossesLeft: w.tossesLeft,
      wind: w.wind,
      lastDistM: w.lastDistM,
      bestDistM: w.bestDistM,
      coinsCollected: w.coinsCollected,
      best,
    };
  }

  /* ── 事件 → 音效 / 飘字 ─────────────────────────────── */
  const playEvent = useCallback((e: GameEvent): void => {
    const now = performance.now();
    const push = (x: number, y: number, text: string, color: string, life = 900): void => {
      fxRef.current.push({ x, y, text, color, born: now, life });
    };
    switch (e.type) {
      case "launch":
        sfxShoot();
        break;
      case "cloud":
        sfxBounce();
        push(e.x, e.y - 24, "云朵！", "#9fd8ff", 900);
        break;
      case "coin":
        sfxCoin();
        push(e.x, e.y - 18, `+${e.score}`, "#ffd34d", 900);
        break;
      case "land":
        sfxLand();
        break;
      case "settle":
        sfxScore();
        push(e.x, groundYAt(e.x) - 46, `${e.distM.toFixed(1)} m`, "#7ee8a2", 1200);
        break;
      case "over":
        sfxLose();
        break;
      case "nextToss":
        break;
      default:
        break;
    }
  }, []);

  /* ── 落库 ──────────────────────────────────────────── */
  const recordOnce = useCallback(
    (w: World) => {
      if (recorded) return;
      setRecorded(true);
      const score = finalScore(w);
      const best = Math.max(score, Number(window.localStorage.getItem(BEST_KEY) || "0"));
      window.localStorage.setItem(BEST_KEY, String(best));
      recordScore({
        gameId: "piglook",
        gameTitle: "猪猪的远望",
        score,
        detail: {
          lastDistM: Number(w.lastDistM.toFixed(1)),
          coins: w.coinsCollected,
          tosses: w.toss,
          best,
        },
      });
    },
    [recorded],
  );

  useEffect(() => {
    if (hud.phase === "over") {
      recordOnce(worldRef.current);
      if (hud.bestDistM > 0) sfxWin();
    }
  }, [hud.phase, hud.bestDistM, recordOnce]);

  /* ── 主循环 ───────────────────────────────────────── */
  useEffect(() => {
    const loop = (t: number): void => {
      const w = worldRef.current;
      const dtMs = lastTRef.current ? t - lastTRef.current : 16;
      lastTRef.current = t;

      const ev = stepWorld(w, dtMs);
      for (const e of ev) playEvent(e);

      setHud((h) => {
        const n = snapshot(w);
        return n.phase === h.phase &&
          n.toss === h.toss &&
          n.tossesLeft === h.tossesLeft &&
          Math.abs(n.wind - h.wind) < 1 &&
          n.lastDistM === h.lastDistM &&
          n.bestDistM === h.bestDistM &&
          n.coinsCollected === h.coinsCollected &&
          n.best === h.best
          ? h
          : n;
      });

      draw(w);
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playEvent]);

  /* ── 拖拽交互 ─────────────────────────────────────── */
  const canvasPos = useCallback(
    (ev: React.PointerEvent | PointerEvent): { x: number; y: number } => {
      const rect = canvasRef.current!.getBoundingClientRect();
      return {
        x: ((ev.clientX - rect.left) / rect.width) * W,
        y: ((ev.clientY - rect.top) / rect.height) * H,
      };
    },
    [],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const w = worldRef.current;
      if (w.phase !== "ready") return;
      e.preventDefault();
      draggingRef.current = true;
      pointerRef.current = canvasPos(e);
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    },
    [canvasPos],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!draggingRef.current) return;
      pointerRef.current = canvasPos(e);
      const w = worldRef.current;
      previewRef.current = previewPath(w, computeLaunch(pointerRef.current));
      force();
    },
    [canvasPos],
  );

  const onPointerUp = useCallback(() => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    const w = worldRef.current;
    if (w.phase !== "ready") {
      previewRef.current = null;
      return;
    }
    const launch = computeLaunch(pointerRef.current);
    const power = Math.hypot(launch.vx, launch.vy);
    if (power < PIG.minPower + 30) {
      previewRef.current = null;
      force();
      return;
    }
    startToss(w, launch);
    previewRef.current = null;
    force();
  }, []);

  const start = useCallback(() => {
    const w = worldRef.current;
    if (w.phase === "idle" || w.phase === "over") {
      startGame(w);
      fxRef.current = [];
      setRecorded(false);
      setHud(snapshot(w));
    }
  }, []);

  /* ── 绘制 ─────────────────────────────────────────── */
  const draw = useCallback((w: World): void => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.save();

    /* 天空 */
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#a8d8ff");
    sky.addColorStop(0.6, "#dcefff");
    sky.addColorStop(1, "#fff3d6");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    /* 太阳 */
    ctx.fillStyle = "rgba(255,205,90,0.95)";
    ctx.beginPath();
    ctx.arc(690, 56, 26, 0, Math.PI * 2);
    ctx.fill();

    /* 云（远景装饰） */
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    for (const cx of [120, 330, 540]) {
      ctx.beginPath();
      ctx.ellipse(cx, 78, 38, 12, 0, 0, Math.PI * 2);
      ctx.ellipse(cx + 22, 70, 26, 10, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    /* 悬崖高台（左侧） */
    const cliffGrad = ctx.createLinearGradient(0, PIG.CLIFF_TOP, 0, H);
    cliffGrad.addColorStop(0, "#8b6a42");
    cliffGrad.addColorStop(1, "#5c4326");
    ctx.fillStyle = cliffGrad;
    ctx.fillRect(0, PIG.CLIFF_TOP, PIG.CLIFF_END, H - PIG.CLIFF_TOP);
    /* 高台草皮 */
    ctx.fillStyle = "#7ec850";
    ctx.fillRect(0, PIG.CLIFF_TOP - 4, PIG.CLIFF_END, 8);

    /* 平原草地 */
    const grass = ctx.createLinearGradient(0, PIG.GROUND, 0, H);
    grass.addColorStop(0, "#7ec850");
    grass.addColorStop(1, "#4e9331");
    ctx.fillStyle = grass;
    ctx.fillRect(PIG.CLIFF_END, PIG.GROUND, W - PIG.CLIFF_END, H - PIG.GROUND);
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(PIG.CLIFF_END, PIG.GROUND, W - PIG.CLIFF_END, 3);

    /* 距离刻度（平原上每 50px = 5m 一格） */
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.lineWidth = 1;
    ctx.font = "700 10px -apple-system, sans-serif";
    ctx.textAlign = "center";
    for (let px = 150; px < W; px += 50) {
      const m = Math.round((px - PIG.SLING.x) / PIG.pxPerMeter);
      ctx.beginPath();
      ctx.moveTo(px, PIG.GROUND);
      ctx.lineTo(px, PIG.GROUND + 8);
      ctx.stroke();
      if (m > 0) ctx.fillText(`${m}m`, px, PIG.GROUND + 20);
    }

    drawSling(ctx, w);
    drawCoins(ctx, w);
    drawWorldClouds(ctx, w);
    drawPig(ctx, w);
    drawPreview(ctx);
    drawWind(ctx, w);

    /* 飘字 */
    const now = performance.now();
    fxRef.current = fxRef.current.filter((f) => now - f.born < f.life);
    for (const f of fxRef.current) {
      const k = (now - f.born) / f.life;
      ctx.globalAlpha = 1 - k * k;
      ctx.fillStyle = f.color;
      ctx.font = "800 16px -apple-system, 'Segoe UI', 'PingFang SC', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(f.text, f.x, f.y - 24 * k);
    }
    ctx.globalAlpha = 1;

    ctx.restore();

    /* 蓄力提示 */
    if (draggingRef.current && w.phase === "ready") {
      const launch = computeLaunch(pointerRef.current);
      const power = Math.hypot(launch.vx, launch.vy);
      const pct = Math.round(((power - PIG.minPower) / (PIG.maxPower - PIG.minPower)) * 100);
      ctx.fillStyle = "rgba(20,30,40,0.75)";
      roundRect(ctx, W / 2 - 74, 12, 148, 26, 13);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "700 13px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(`蓄力 ${Math.max(0, Math.min(100, pct))}%`, W / 2, 30);
    }
  }, []);

  /* 弹弓架 */
  function drawSling(ctx: CanvasRenderingContext2D, w: World): void {
    const ax = PIG.SLING.x;
    const ay = PIG.SLING.y;
    // Y 形木架
    ctx.strokeStyle = "#7a4a20";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(ax, PIG.CLIFF_TOP);
    ctx.lineTo(ax, ay + 6);
    ctx.moveTo(ax, ay + 6);
    ctx.lineTo(ax - 12, ay - 14);
    ctx.moveTo(ax, ay + 6);
    ctx.lineTo(ax + 12, ay - 14);
    ctx.stroke();

    // 皮筋：拖拽时连到手指
    if (draggingRef.current && w.phase === "ready") {
      ctx.strokeStyle = "#c0392b";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(ax - 12, ay - 14);
      ctx.lineTo(pointerRef.current.x, pointerRef.current.y);
      ctx.lineTo(ax + 12, ay - 14);
      ctx.stroke();
    }
  }

  /* 世界云朵（可弹的） */
  function drawWorldClouds(ctx: CanvasRenderingContext2D, w: World): void {
    for (const c of w.clouds) {
      ctx.fillStyle = c.bounced ? "rgba(255,255,255,0.45)" : "rgba(255,255,255,0.95)";
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, PIG.cloudR, PIG.cloudR * 0.55, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x + PIG.cloudR * 0.55, c.y - 6, PIG.cloudR * 0.6, PIG.cloudR * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* 金币 */
  function drawCoins(ctx: CanvasRenderingContext2D, w: World): void {
    for (const c of w.coins) {
      if (c.taken) continue;
      ctx.fillStyle = "#f6c945";
      ctx.beginPath();
      ctx.arc(c.x, c.y, PIG.coinR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#c8951a";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "#c8951a";
      ctx.font = "900 10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("¥", c.x, c.y + 3.5);
    }
  }

  /* 小猪 */
  function drawPig(ctx: CanvasRenderingContext2D, w: World): void {
    const p = w.pig;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);

    const r = PIG.pigR;
    // 身体
    ctx.fillStyle = "#ffb3c1";
    ctx.beginPath();
    ctx.ellipse(0, 0, r + 2, r - 1, 0, 0, Math.PI * 2);
    ctx.fill();
    // 耳朵
    ctx.fillStyle = "#ff9fb3";
    ctx.beginPath();
    ctx.moveTo(-r * 0.5, -r * 0.7);
    ctx.lineTo(-r * 0.75, -r * 1.25);
    ctx.lineTo(-r * 0.25, -r * 0.85);
    ctx.closePath();
    ctx.fill();
    // 鼻子（朝向 +x 方向）
    ctx.fillStyle = "#ff8fa8";
    ctx.beginPath();
    ctx.ellipse(r * 0.75, 0, 5, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#d96a85";
    ctx.beginPath();
    ctx.arc(r * 0.75 - 1.5, -0.8, 0.9, 0, Math.PI * 2);
    ctx.arc(r * 0.75 + 1.5, -0.8, 0.9, 0, Math.PI * 2);
    ctx.fill();
    // 眼睛
    ctx.fillStyle = "#3a2c1c";
    ctx.beginPath();
    ctx.arc(r * 0.25, -r * 0.35, 1.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /* 弹道预览 */
  function drawPreview(ctx: CanvasRenderingContext2D): void {
    const pts = previewRef.current;
    if (!pts || pts.length < 2) return;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  /* 风力指示 */
  function drawWind(ctx: CanvasRenderingContext2D, w: World): void {
    const strong = Math.min(1, Math.abs(w.wind) / PIG.windJitter);
    const dir = w.wind >= 0 ? 1 : -1;
    ctx.save();
    ctx.translate(W / 2, 30);
    ctx.fillStyle = "rgba(30,45,60,0.7)";
    roundRect(ctx, -74, -14, 148, 28, 14);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "700 12px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("风", -52, 4);
    const n = 3;
    for (let i = 0; i < n; i++) {
      const bx = -22 + i * 20;
      ctx.fillStyle =
        i < Math.round(strong * n) ? (strong > 0.66 ? "#ff8a4c" : "#ffd34d") : "rgba(255,255,255,0.22)";
      ctx.beginPath();
      ctx.moveTo(bx + dir * (i + 1) * 6, -2);
      ctx.lineTo(bx, -8);
      ctx.lineTo(bx, 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillText(`${dir > 0 ? "→" : "←"} ${Math.round(Math.abs(w.wind))}`, 30, 4);
    ctx.restore();
  }

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
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  const phase = hud.phase;
  const t = i18n.text;

  return (
    <GameFrame
      emoji="🐷"
      title={t("game.piglook.title")}
      stats={[
        { label: t("game.piglook.last"), value: `${hud.lastDistM.toFixed(1)}m`, colors: CHIP_BLUE },
        { label: t("game.piglook.bestDist"), value: `${hud.bestDistM.toFixed(1)}m`, colors: CHIP_GOLD },
        { label: t("game.piglook.tosses"), value: hud.tossesLeft, colors: CHIP_GREEN },
        { label: t("game.piglook.coins"), value: hud.coinsCollected * PIG.coinScore, colors: CHIP_PURPLE },
        { label: t("game.piglook.record"), value: hud.best, colors: CHIP_RED },
      ]}
      headerExtra={
        <GhostBtn onClick={phase === "idle" || phase === "over" ? start : start}>
          {phase === "idle" ? t("game.piglook.start") : t("game.piglook.restart")}
        </GhostBtn>
      }
      help={t("game.piglook.help")}
      maxWidth={820}
    >
      <div style={{ position: "relative", width: W, maxWidth: "100%" }}>
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => {
            if (draggingRef.current) {
              draggingRef.current = false;
              previewRef.current = null;
              force();
            }
          }}
          style={{
            width: "100%",
            height: "auto",
            display: "block",
            borderRadius: 14,
            cursor: phase === "ready" ? "grab" : "default",
            touchAction: "none",
            boxShadow: "0 10px 30px rgba(5,8,20,0.35)",
            userSelect: "none",
          }}
        />

        {/* 开始覆盖层 */}
        {phase === "idle" && (
          <div
            className="gs-pulse"
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 14,
              background: "rgba(30,40,60,0.55)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              color: "#fff",
              textAlign: "center",
              zIndex: 3,
              pointerEvents: "none",
            }}
          >
            <div style={{ fontSize: 34, fontWeight: 900 }}>🐷</div>
            <div style={{ fontSize: 18, fontWeight: 800 }}>{t("game.piglook.idleTitle")}</div>
            <div style={{ fontSize: 13, opacity: 0.92, maxWidth: 520, lineHeight: 1.7, padding: "0 16px" }}>
              {t("game.piglook.idleDesc")}
            </div>
            <div style={{ pointerEvents: "auto", marginTop: 6 }}>
              <PrimaryBtn onClick={start}>{t("game.piglook.start")}</PrimaryBtn>
            </div>
          </div>
        )}

        {/* 结算覆盖层 */}
        {phase === "over" && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 14,
              background: "rgba(50,30,10,0.62)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              color: "#fff",
              textAlign: "center",
              zIndex: 3,
              pointerEvents: "none",
            }}
          >
            <div style={{ fontSize: 32, fontWeight: 900 }}>🏁</div>
            <div style={{ fontSize: 24, fontWeight: 900 }}>{t("game.piglook.overTitle")}</div>
            <div style={{ fontSize: 15, fontWeight: 700, marginTop: 2 }}>
              {t("game.piglook.stats", {
                best: hud.bestDistM.toFixed(1),
                coins: hud.coinsCollected * PIG.coinScore,
              })}
            </div>
            {hud.bestDistM >= hud.best && hud.bestDistM > 0 && (
              <div style={{ fontSize: 13, opacity: 0.9 }}>{t("game.piglook.newRecord")}</div>
            )}
            <div style={{ pointerEvents: "auto", marginTop: 8 }}>
              <PrimaryBtn onClick={start}>{t("game.piglook.again")}</PrimaryBtn>
            </div>
          </div>
        )}
      </div>
    </GameFrame>
  );
};

export default PigLookoutGame;
