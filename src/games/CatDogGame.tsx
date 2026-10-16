/*
 * CatDogGame：猫狗大战（猫咪守城）
 *
 * Canvas 实时渲染 + rAF 游戏循环。玩家在左侧守卫猫咪城堡，狗大军从右侧
 * 一波波进攻；消耗「小鱼干」在三条道上召唤猫咪（近战布偶猫 / 肉盾橘猫 /
 * 远程黑猫射手），猫咪自动迎击。狗啃到城堡扣血，血量归零游戏结束；
 * 坚持到第 20 波通关，可继续无尽挑战。成绩在游戏结束时落库。
 * 操作：点击战场召唤选中的猫；1/2/3 切换兵种；空格 开始/暂停；P 暂停。
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import { recordScore } from "../scoreClient";
import { useI18n } from "../hooks";
import GameFrame, {
  GhostBtn,
  CHIP_GOLD,
  CHIP_RED,
  CHIP_GREEN,
  CHIP_BLUE,
} from "./GameFrame";
import {
  sfxClick,
  sfxHit,
  sfxHurt,
  sfxCoin,
  sfxBoom,
  sfxWin,
  sfxLose,
  sfxShoot,
  sfxAlarm,
  sfxClear,
  sfxMismatch,
} from "./sound";
import {
  W,
  H,
  LANE_COUNT,
  laneY,
  CASTLE_HP,
  CAT_SPAWN_X,
  UNIT_STATS,
  newSim,
  addCat,
  stepSim,
  isGameOver,
  type Sim,
  type SimEvent,
  type CatKind,
  type UnitKind,
} from "./catDogLogic";
import "./gameAnimations.less";

/* ------------------------------------------------------------------ */
/* 视觉常量                                                            */
/* ------------------------------------------------------------------ */

const CAT_ORDER: CatKind[] = ["tabby", "orange", "black"];

const KIND_EMOJI: Record<UnitKind, string> = {
  tabby: "🐱",
  orange: "🐈",
  black: "🐈⬛",
  shiba: "🐶",
  bulldog: "🐕",
  shepherd: "🦮",
  golden: "🐕🦺",
};

const KIND_COLOR: Record<UnitKind, string> = {
  tabby: "#f6a24b",
  orange: "#e8850c",
  black: "#5d6270",
  shiba: "#e0a45c",
  bulldog: "#b98a5a",
  shepherd: "#c9a06a",
  golden: "#f0c060",
};

interface FloatText {
  x: number;
  y: number;
  text: string;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  r: number;
  color: string;
}

interface UiState {
  fish: number;
  score: number;
  castleHp: number;
  wave: number;
  running: boolean;
  paused: boolean;
  over: boolean;
  won: boolean;
  selected: CatKind;
}

/** 单位体型（画布半径） */
function unitRadius(kind: UnitKind): number {
  return kind === "golden" ? 25 : kind === "orange" || kind === "shepherd" ? 19 : 16;
}

/* ------------------------------------------------------------------ */
/* 绘制辅助                                                            */
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
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBackground(ctx: CanvasRenderingContext2D): void {
  // 草地
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#8fd07c");
  g.addColorStop(1, "#4f9e46");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 顶部高光
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(0, 0, W, 6);

  // 分道线（虚线）
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.lineWidth = 2;
  ctx.setLineDash([8, 10]);
  for (let i = 1; i < LANE_COUNT; i++) {
    const y = (H / LANE_COUNT) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // 右侧狗阵营边缘
  ctx.strokeStyle = "rgba(0,0,0,0.18)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(W - 14, 0);
  ctx.lineTo(W - 14, H);
  ctx.stroke();
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("🐶", W - 14, H - 12);
}

function drawCastle(ctx: CanvasRenderingContext2D, hp: number, maxHp: number, shake: number): void {
  const sx = shake > 0 ? Math.sin(shake * 60) * 2.5 : 0;
  ctx.save();
  ctx.translate(sx, 0);
  // 城堡主体
  ctx.fillStyle = "#8a5a3b";
  roundRect(ctx, 6, H * 0.2, 34, H * 0.62, 7);
  ctx.fill();
  // 城墙垛口
  ctx.fillStyle = "#9c6b47";
  for (let i = 0; i < 3; i++) {
    roundRect(ctx, 6 + i * 12, H * 0.2 - 8, 9, 10, 2);
    ctx.fill();
  }
  // 城门
  ctx.fillStyle = "#5e3b26";
  ctx.beginPath();
  ctx.arc(23, H * 0.82, 11, Math.PI, 0);
  ctx.fill();
  // 心形 HP
  const hpRatio = Math.max(0, hp / maxHp);
  ctx.font = "15px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("🏰", 23, H * 0.2 - 14);
  ctx.font = "13px sans-serif";
  ctx.fillText("❤", 23, H * 0.86);
  // HP 条
  const bw = 52;
  const bx = 6;
  const by = H - 16;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  roundRect(ctx, bx - 1, by - 1, bw + 2, 8, 4);
  ctx.fill();
  ctx.fillStyle = hpRatio > 0.5 ? "#5bd26f" : hpRatio > 0.25 ? "#f5b23d" : "#ef5b54";
  roundRect(ctx, bx, by, Math.max(2, bw * hpRatio), 6, 3);
  ctx.fill();
  ctx.restore();
}

function drawUnit(ctx: CanvasRenderingContext2D, u: Sim["units"][number], ts: number): void {
  const r = unitRadius(u.kind);
  const color = KIND_COLOR[u.kind];
  const isDog = u.side === "dog";
  // 脚步小跳
  const bob = isDog ? Math.sin(ts / 90 + u.id) * 1.4 : Math.sin(ts / 110 + u.id) * 1.2;
  const cy = u.y + bob;

  // 影子
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.beginPath();
  ctx.ellipse(u.x, u.y + r + 3, r * 0.8, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();

  // 身体
  const grad = ctx.createRadialGradient(u.x - r * 0.35, cy - r * 0.4, r * 0.2, u.x, cy, r);
  grad.addColorStop(0, "#ffffff");
  grad.addColorStop(0.35, color);
  grad.addColorStop(1, isDog ? "#7a4f28" : "#8a5a2a");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(u.x, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.stroke();

  // 表情
  ctx.font = `${Math.round(r * 1.35)}px "Segoe UI Emoji","Apple Color Emoji",sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(KIND_EMOJI[u.kind], u.x, cy + 1);

  // 血条
  const bw = r * 2;
  const bh = 5;
  const ratio = Math.max(0, u.hp / u.maxHp);
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  roundRect(ctx, u.x - bw / 2 - 0.5, cy - r - 10, bw + 1, bh + 1, 2.5);
  ctx.fill();
  ctx.fillStyle = isDog ? "#ef6a5a" : "#5bd26f";
  roundRect(ctx, u.x - bw / 2, cy - r - 9.5, Math.max(1.5, bw * ratio), bh - 1, 2);
  ctx.fill();
}

function drawProjectile(ctx: CanvasRenderingContext2D, p: Sim["projectiles"][number]): void {
  ctx.font = '13px "Segoe UI Emoji","Apple Color Emoji",sans-serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("🐟", p.x, p.y);
}

function drawFloats(ctx: CanvasRenderingContext2D, floats: FloatText[]): void {
  for (const f of floats) {
    const t = 1 - f.life / f.maxLife;
    const alpha = f.life / f.maxLife;
    ctx.globalAlpha = alpha;
    ctx.font = `800 ${f.size}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.strokeText(f.text, f.x, f.y - t * 26);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y - t * 26);
  }
  ctx.globalAlpha = 1;
}

function drawParticles(ctx: CanvasRenderingContext2D, ps: Particle[]): void {
  for (const p of ps) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/* ------------------------------------------------------------------ */
/* 组件                                                                */
/* ------------------------------------------------------------------ */

const CatDogGame: React.FC<{ sdk: FatNotesPluginSDK }> = () => {
  const i18n = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<Sim>(newSim());
  const floatsRef = useRef<FloatText[]>([]);
  const particlesRef = useRef<Particle[]>([]);
  const shakeRef = useRef(0);
  const killsRef = useRef(0);
  const recordedRef = useRef(false);
  const lastTsRef = useRef(0);

  const [ui, setUi] = useState<UiState>({
    fish: newSim().fish,
    score: 0,
    castleHp: CASTLE_HP,
    wave: 0,
    running: false,
    paused: false,
    over: false,
    won: false,
    selected: "tabby",
  });

  // 循环内只读 ref，避免因闭包/依赖变化重启 rAF 循环（与 Hawk 同款模式）
  const flagsRef = useRef({ running: ui.running, paused: ui.paused, over: ui.over });
  flagsRef.current = { running: ui.running, paused: ui.paused, over: ui.over };
  const overNotifiedRef = useRef(false);
  const i18nRef = useRef(i18n);
  i18nRef.current = i18n;

  const pushFloat = useCallback((x: number, y: number, text: string, color: string, size = 15): void => {
    floatsRef.current.push({ x, y, text, life: 1.1, maxLife: 1.1, color, size });
    if (floatsRef.current.length > 24) floatsRef.current.splice(0, floatsRef.current.length - 24);
  }, []);

  const burst = useCallback((x: number, y: number, color: string): void => {
    for (let i = 0; i < 7; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 30 + Math.random() * 70;
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 20,
        life: 0.45,
        maxLife: 0.45,
        r: 1.8 + Math.random() * 2.2,
        color,
      });
    }
    if (particlesRef.current.length > 120) {
      particlesRef.current.splice(0, particlesRef.current.length - 120);
    }
  }, []);

  /** 应用一帧事件：音效 + 飘字 + 粒子（经 ref 读 i18n，保持引用稳定） */
  const applyEvents = useCallback(
    (events: SimEvent[]) => {
      const t = i18nRef.current.text;
      for (const e of events) {
        switch (e.type) {
          case "kill":
            if (e.side === "dog") {
              killsRef.current += 1;
              sfxHit();
              burst(e.x, e.y, "#ffd76a");
              pushFloat(e.x, e.y - 10, `+${e.score}`, "#ffd76a", 16);
              if (e.fish > 0) pushFloat(e.x, e.y + 8, `+${e.fish}🐟`, "#7ee8a2", 13);
            } else {
              sfxHurt();
              burst(e.x, e.y, "#ff9a8b");
            }
            break;
          case "castleHit":
            sfxBoom();
            shakeRef.current = 0.4;
            pushFloat(26, H * 0.5, `-${e.dmg}❤`, "#ff6b62", 18);
            break;
          case "waveStart":
            sfxCoin();
            pushFloat(W / 2, 30, t("game.catdog.waveFloat", { wave: e.wave }), "#ffffff", 18);
            break;
          case "waveClear":
            sfxClear();
            pushFloat(W / 2, 30, `+${e.bonus}`, "#7ee8a2", 16);
            break;
          case "boss":
            sfxAlarm();
            pushFloat(W / 2, H * 0.16, t("game.catdog.bossFloat"), "#ff6b62", 20);
            break;
          case "win":
            sfxWin();
            pushFloat(W / 2, H * 0.24, t("game.catdog.winFloat"), "#ffd76a", 24);
            break;
          default:
            break;
        }
      }
    },
    [burst, pushFloat],
  );

  /** 单帧绘制 */
  const draw = useCallback((ts: number): void => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    drawBackground(ctx);

    const sim = simRef.current;
    drawCastle(ctx, Math.max(0, sim.castleHp), CASTLE_HP, shakeRef.current);

    // 近战在前、远程在后（按 x 排序保证视觉层）
    const ordered = [...sim.units].sort((a, b) => a.x - b.x);
    for (const u of ordered) drawUnit(ctx, u, ts);
    for (const p of sim.projectiles) drawProjectile(ctx, p);

    // 粒子 / 飘字
    for (const p of particlesRef.current) {
      p.x += p.vx * (1 / 60);
      p.y += p.vy * (1 / 60);
      p.vy += 60 * (1 / 60);
      p.life -= 1 / 60;
    }
    particlesRef.current = particlesRef.current.filter((p) => p.life > 0);
    for (const f of floatsRef.current) f.life -= 1 / 60;
    floatsRef.current = floatsRef.current.filter((f) => f.life > 0);
    drawParticles(ctx, particlesRef.current);
    drawFloats(ctx, floatsRef.current);

    if (shakeRef.current > 0) shakeRef.current -= 1 / 60;
  }, []);

  /** 主循环：挂载后常驻 rAF，从 flagsRef 读运行状态（与 Hawk 同款模式） */
  useEffect(() => {
    let raf = 0;
    lastTsRef.current = performance.now();
    const loop = (ts: number): void => {
      raf = window.requestAnimationFrame(loop);
      const flags = flagsRef.current;
      if (!flags.running || flags.paused || flags.over) {
        // 空闲 / 暂停 / 结束时冻结模拟，仅维持画面（飘字、粒子继续淡出）
        draw(ts);
        return;
      }
      const dt = Math.min(0.05, (ts - lastTsRef.current) / 1000);
      lastTsRef.current = ts;
      const { sim, events } = stepSim(simRef.current, dt);
      applyEvents(events);

      setUi((prev) => ({
        ...prev,
        fish: Math.floor(sim.fish),
        score: sim.score,
        castleHp: sim.castleHp,
        wave: sim.wave.wave,
        over: isGameOver(sim),
        won: sim.won,
      }));

      if (isGameOver(sim) && !overNotifiedRef.current) {
        overNotifiedRef.current = true;
        sfxLose();
      }
      draw(ts);
    };
    raf = window.requestAnimationFrame(loop);
    return () => window.cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 结束记录成绩
  useEffect(() => {
    if (ui.over && !recordedRef.current) {
      recordedRef.current = true;
      recordScore({
        gameId: "catdog",
        gameTitle: "猫狗大战",
        score: ui.score,
        detail: { wave: ui.wave, kills: killsRef.current },
      });
    }
  }, [ui.over, ui.score, ui.wave]);

  /** 开始 / 暂停 / 继续 / 重开 主按钮 */
  const primaryAction = useCallback(() => {
    if (ui.over) {
      simRef.current = newSim();
      killsRef.current = 0;
      recordedRef.current = false;
      overNotifiedRef.current = false;
      floatsRef.current = [];
      particlesRef.current = [];
      setUi((p) => ({
        ...p,
        fish: newSim().fish,
        score: 0,
        castleHp: CASTLE_HP,
        wave: 0,
        running: true,
        paused: false,
        over: false,
        won: false,
      }));
      sfxClick();
      return;
    }
    if (!ui.running) {
      setUi((p) => ({ ...p, running: true, paused: false }));
      sfxClick();
      return;
    }
    // 运行中：暂停 / 继续
    setUi((p) => ({ ...p, paused: !p.paused }));
    sfxClick();
  }, [ui.over, ui.running]);

  /** 召唤猫咪到指定道 */
  const spawnAt = useCallback(
    (lane: number) => {
      const kind = ui.selected;
      const st = UNIT_STATS[kind];
      if (!ui.running || ui.paused || ui.over) return;
      const { sim, ok } = addCat(simRef.current, kind, lane);
      if (!ok) {
        sfxMismatch();
        pushFloat(W / 2, H * 0.5, i18n.text("game.catdog.insufficient"), "#ffb04d", 15);
        return;
      }
      simRef.current = sim;
      sfxShoot();
      pushFloat(CAT_SPAWN_X + 20, laneY(lane) - 14, `-${st.cost}🐟`, "#ffd76a", 12);
      setUi((p) => ({ ...p, fish: Math.floor(sim.fish) }));
    },
    [ui.selected, ui.running, ui.paused, ui.over, i18n, pushFloat],
  );

  /** 画布点击 → 按 y 判断道 */
  const onCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const scaleY = H / rect.height;
      const y = (e.clientY - rect.top) * scaleY;
      const lane = Math.max(0, Math.min(LANE_COUNT - 1, Math.floor(y / (H / LANE_COUNT))));
      spawnAt(lane);
    },
    [spawnAt],
  );

  // 键盘：1/2/3 选兵种，空格 开始/暂停，P 暂停
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "1" || e.key === "2" || e.key === "3") {
        const idx = Number(e.key) - 1;
        if (idx < CAT_ORDER.length) {
          setUi((p) => ({ ...p, selected: CAT_ORDER[idx] }));
          sfxClick();
        }
      } else if (e.key === " ") {
        e.preventDefault();
        primaryAction();
      } else if (e.key === "p" || e.key === "P") {
        if (ui.running && !ui.over) {
          setUi((p) => ({ ...p, paused: !p.paused }));
          sfxClick();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [primaryAction, ui.running, ui.over]);

  const canAfford = (kind: CatKind): boolean => ui.fish >= (UNIT_STATS[kind].cost ?? Infinity);

  const headerBtn = ui.over ? (
    <GhostBtn onClick={primaryAction}>
      <ReloadOutlined />
      {i18n.text("game.catdog.again")}
    </GhostBtn>
  ) : ui.running ? (
    <GhostBtn onClick={primaryAction}>
      {ui.paused ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
      {ui.paused ? i18n.text("game.catdog.resume") : i18n.text("game.catdog.pause")}
    </GhostBtn>
  ) : (
    <GhostBtn onClick={primaryAction}>
      <PlayCircleOutlined />
      {i18n.text("game.catdog.start")}
    </GhostBtn>
  );

  return (
    <GameFrame
      emoji="🐱🐶"
      title={i18n.text("game.catdog.title")}
      stats={[
        { label: i18n.text("game.catdog.castle"), value: ui.castleHp, colors: CHIP_RED },
        { label: i18n.text("game.catdog.fish"), value: ui.fish, colors: CHIP_GOLD },
        { label: i18n.text("game.catdog.score"), value: ui.score, colors: CHIP_GREEN },
        { label: i18n.text("game.catdog.wave"), value: ui.wave, colors: CHIP_BLUE },
      ]}
      headerExtra={headerBtn}
      help={i18n.text("game.catdog.help")}
      maxWidth={620}
    >
      {/* 战场 */}
      <div style={{ position: "relative", width: "100%", maxWidth: W }}>
        <canvas
          ref={canvasRef}
          width={W * (window.devicePixelRatio || 1)}
          height={H * (window.devicePixelRatio || 1)}
          onClick={onCanvasClick}
          style={{
            display: "block",
            width: "100%",
            maxWidth: W,
            height: "auto",
            aspectRatio: `${W} / ${H}`,
            borderRadius: 14,
            cursor: ui.running && !ui.paused && !ui.over ? "pointer" : "default",
            boxShadow: "0 8px 24px rgba(40,90,40,0.35)",
            border: "3px solid rgba(90,60,30,0.4)",
          }}
        />

        {/* 空闲遮罩 */}
        {!ui.running && !ui.over && (
          <div
            className="gs-pulse"
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 14,
              background: "rgba(40,80,40,0.5)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              color: "#fff",
              fontSize: 17,
              fontWeight: 800,
              pointerEvents: "none",
            }}
          >
            <div style={{ fontSize: 30 }}>🐱 🆚 🐶</div>
            {i18n.text("game.catdog.idle")}
          </div>
        )}

        {/* 暂停遮罩 */}
        {ui.running && ui.paused && !ui.over && (
          <div
            className="gs-pulse"
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 14,
              background: "rgba(20,30,20,0.55)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 18,
              fontWeight: 800,
              pointerEvents: "none",
            }}
          >
            ⏸ {i18n.text("game.catdog.paused")}
          </div>
        )}

        {/* 通关遮罩 */}
        {ui.running && ui.won && !ui.over && (
          <div
            className="gs-stage-in"
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 14,
              background: "rgba(60,40,0,0.42)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              color: "#fff",
            }}
          >
            <div style={{ fontSize: 30, fontWeight: 900 }}>🎉 {i18n.text("game.catdog.winTitle")}</div>
            <div style={{ fontSize: 14, opacity: 0.9 }}>
              {i18n.text("game.catdog.winDetail", { wave: ui.wave })}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <GhostBtn
                onClick={() => {
                  setUi((p) => ({ ...p, won: false }));
                  sfxClick();
                }}
              >
                <PlayCircleOutlined />
                {i18n.text("game.catdog.continue")}
              </GhostBtn>
              <GhostBtn onClick={primaryAction}>
                <ReloadOutlined />
                {i18n.text("game.catdog.again")}
              </GhostBtn>
            </div>
          </div>
        )}

        {/* 结束遮罩 */}
        {ui.over && (
          <div
            className="gs-stage-in"
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 14,
              background: "rgba(30,20,20,0.6)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              color: "#fff",
            }}
          >
            <div style={{ fontSize: 26, fontWeight: 900 }}>💔 {i18n.text("game.catdog.overTitle")}</div>
            <div style={{ fontSize: 14, opacity: 0.92 }}>
              {i18n.text("game.catdog.overDetail", {
                wave: ui.wave,
                score: ui.score,
                kills: killsRef.current,
              })}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <GhostBtn onClick={primaryAction}>
                <ReloadOutlined />
                {i18n.text("game.catdog.again")}
              </GhostBtn>
            </div>
          </div>
        )}
      </div>

      {/* 兵种选择 */}
      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          justifyContent: "center",
          marginTop: 4,
        }}
      >
        {CAT_ORDER.map((kind) => {
          const st = UNIT_STATS[kind];
          const sel = ui.selected === kind;
          const afford = canAfford(kind);
          return (
            <button
              key={kind}
              type="button"
              onClick={() => {
                setUi((p) => ({ ...p, selected: kind }));
                sfxClick();
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "7px 14px",
                borderRadius: 16,
                border: sel ? "2px solid #1677ff" : "2px solid rgba(128,128,128,0.3)",
                background: sel ? "rgba(22,119,255,0.12)" : "rgba(128,128,128,0.08)",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 700,
                color: "rgba(0,0,0,0.82)",
                boxShadow: sel ? "0 3px 10px rgba(22,119,255,0.25)" : "none",
                opacity: afford ? 1 : 0.55,
                transition: "all 0.12s ease",
              }}
            >
              <span style={{ fontSize: 20 }}>{KIND_EMOJI[kind]}</span>
              <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 1 }}>
                <span>{i18n.text(`game.catdog.unit.${kind}`)}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#e08a00" }}>🐟 {st.cost}</span>
              </span>
            </button>
          );
        })}
      </div>
    </GameFrame>
  );
};

export default CatDogGame;
