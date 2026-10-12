/*
 * ThunderFighterGame：战鹰雷霆（纵向卷轴射击）
 *
 * Canvas 实现：战机自动开火，方向键 / WASD 移动；
 * 敌机从上方分批来袭，击落得分；敌机与子弹碰撞会损失生命。
 * 随时间推进敌机更密集、更快、更耐打。生命耗尽游戏结束并记录成绩。
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
} from "./GameFrame";
import "./gameAnimations.less";

const W = 480;
const H = 640;
const PLAYER_R = 16;
const PLAYER_SPEED = 280; // px / s
const FIRE_INTERVAL = 0.22; // s
const MAX_LIVES = 3;
const INVINCIBLE = 1.6; // s
const MAX_HP = 4;

interface Bullet {
  x: number;
  y: number;
  vy: number;
  r: number;
  color: string;
}

type EnemyKind = "fly" | "jet" | "tank";

interface Enemy {
  x: number;
  y: number;
  vy: number;
  hp: number;
  maxHp: number;
  r: number;
  kind: EnemyKind;
  value: number;
  fireCd: number;
  fireInterval: number;
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

interface FloatText {
  x: number;
  y: number;
  text: string;
  until: number;
}

interface Star {
  x: number;
  y: number;
  r: number;
  spd: number;
}

interface Sim {
  px: number;
  py: number;
  bullets: Bullet[];
  eBullets: Bullet[];
  enemies: Enemy[];
  parts: Particle[];
  floats: FloatText[];
  stars: Star[];
  score: number;
  kills: number;
  lives: number;
  running: boolean;
  over: boolean;
  recorded: boolean;
  elapsed: number;
  spawnCd: number;
  fireCd: number;
  invincible: number;
  lastTs: number;
}

interface UiState {
  score: number;
  lives: number;
  kills: number;
  running: boolean;
  over: boolean;
}

function makeStars(): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < 70; i++) {
    stars.push({
      x: Math.random() * W,
      y: Math.random() * H,
      r: Math.random() < 0.8 ? 1 : 2,
      spd: 40 + Math.random() * 90,
    });
  }
  return stars;
}

function newSim(): Sim {
  return {
    px: W / 2,
    py: H - 90,
    bullets: [],
    eBullets: [],
    enemies: [],
    parts: [],
    floats: [],
    stars: makeStars(),
    score: 0,
    kills: 0,
    lives: MAX_LIVES,
    running: false,
    over: false,
    recorded: false,
    elapsed: 0,
    spawnCd: 1.2,
    fireCd: 0.3,
    invincible: 0,
    lastTs: 0,
  };
}

function spawnEnemy(elapsed: number): Enemy {
  const tankP = Math.min(30, 10 + elapsed * 0.35);
  const roll = Math.random() * 100;
  let kind: EnemyKind;
  if (roll < tankP) kind = "tank";
  else if (roll < tankP + 30) kind = "jet";
  else kind = "fly";

  const speedMul = 1 + elapsed * 0.008;
  if (kind === "fly") {
    return {
      x: 26 + Math.random() * (W - 52),
      y: -30,
      vy: (110 + Math.random() * 50) * speedMul,
      hp: 1,
      maxHp: 1,
      r: 16,
      kind,
      value: 100,
      fireCd: 99,
      fireInterval: 99,
    };
  }
  if (kind === "jet") {
    return {
      x: 26 + Math.random() * (W - 52),
      y: -30,
      vy: (80 + Math.random() * 30) * speedMul,
      hp: 2,
      maxHp: 2,
      r: 20,
      kind,
      value: 200,
      fireCd: 1.5 + Math.random() * 0.6,
      fireInterval: 1.8,
    };
  }
  return {
    x: 26 + Math.random() * (W - 52),
    y: -30,
    vy: (48 + Math.random() * 14) * speedMul,
    hp: MAX_HP,
    maxHp: MAX_HP,
    r: 27,
    kind,
    value: 400,
    fireCd: 0.9 + Math.random() * 0.5,
    fireInterval: 1.15,
  };
}

function addBoom(s: Sim, x: number, y: number, big: boolean): void {
  const n = big ? 16 : 10;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const spd = 40 + Math.random() * (big ? 190 : 120);
    s.parts.push({
      x,
      y,
      vx: Math.cos(a) * spd,
      vy: Math.sin(a) * spd,
      life: 0.45 + Math.random() * (big ? 0.3 : 0.2),
      maxLife: 0.75,
      r: big ? 2.5 + Math.random() * 3 : 1.8 + Math.random() * 2,
      color:
        Math.random() < 0.4
          ? "#ffd75e"
          : Math.random() < 0.5
            ? "#ff8a4c"
            : "#ff5a4c",
    });
  }
}

function hitPlayer(s: Sim): void {
  if (s.invincible > 0) return;
  s.lives -= 1;
  s.invincible = INVINCIBLE;
  addBoom(s, s.px, s.py, false);
  if (s.lives <= 0) {
    s.lives = 0;
    s.over = true;
    s.running = false;
  }
}

function drawScene(ctx: CanvasRenderingContext2D, s: Sim, ts: number): void {
  ctx.clearRect(0, 0, W, H);

  // 深空背景
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0a0f1e");
  bg.addColorStop(0.6, "#101a30");
  bg.addColorStop(1, "#0a0f1e");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // 星空
  for (const st of s.stars) {
    ctx.fillStyle = `rgba(220,235,255,${(st.r === 2 ? 0.85 : 0.5).toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 玩家子弹（黄色光弹）
  for (const b of s.bullets) {
    const g = ctx.createRadialGradient(b.x, b.y, 1, b.x, b.y, b.r * 2.2);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.4, "#ffe15e");
    g.addColorStop(1, "rgba(255,180,40,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // 敌机子弹（粉红光弹）
  for (const b of s.eBullets) {
    const g = ctx.createRadialGradient(b.x, b.y, 1, b.x, b.y, b.r * 2);
    g.addColorStop(0, "#ffd1f0");
    g.addColorStop(0.5, "#ff5ac8");
    g.addColorStop(1, "rgba(255,80,180,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * 2, 0, Math.PI * 2);
    ctx.fill();
  }

  // 敌机
  for (const e of s.enemies) {
    const wob = Math.sin(ts / 90 + e.x) * 3;
    if (e.kind === "fly") {
      // 小型敌机：红色菱形
      ctx.fillStyle = "#e5484d";
      ctx.beginPath();
      ctx.moveTo(e.x, e.y - e.r + wob);
      ctx.lineTo(e.x + e.r * 0.7, e.y + wob);
      ctx.lineTo(e.x, e.y + e.r + wob);
      ctx.lineTo(e.x - e.r * 0.7, e.y + wob);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.beginPath();
      ctx.arc(e.x, e.y - e.r * 0.3 + wob, 3, 0, Math.PI * 2);
      ctx.fill();
    } else if (e.kind === "jet") {
      // 中型敌机：橙色战机
      ctx.fillStyle = "#f06a2a";
      ctx.beginPath();
      ctx.moveTo(e.x, e.y - e.r + wob);
      ctx.lineTo(e.x + e.r, e.y - e.r * 0.3 + wob);
      ctx.lineTo(e.x + e.r * 0.5, e.y + e.r * 0.5 + wob);
      ctx.lineTo(e.x - e.r * 0.5, e.y + e.r * 0.5 + wob);
      ctx.lineTo(e.x - e.r, e.y - e.r * 0.3 + wob);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath();
      ctx.arc(e.x, e.y - e.r * 0.25 + wob, 3.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // 重型敌机：紫色堡垒，带血条
      ctx.fillStyle = "#7b3ff2";
      ctx.beginPath();
      ctx.moveTo(e.x, e.y - e.r + wob);
      ctx.lineTo(e.x + e.r * 0.9, e.y - e.r * 0.4 + wob);
      ctx.lineTo(e.x + e.r * 0.6, e.y + e.r * 0.7 + wob);
      ctx.lineTo(e.x - e.r * 0.6, e.y + e.r * 0.7 + wob);
      ctx.lineTo(e.x - e.r * 0.9, e.y - e.r * 0.4 + wob);
      ctx.closePath();
      ctx.fill();
      const hpW = e.r * 1.8;
      const hpR = e.hp / e.maxHp;
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.fillRect(e.x - hpW / 2, e.y - e.r - 10 + wob, hpW, 4);
      ctx.fillStyle = hpR > 0.5 ? "#43e97b" : "#ff9a4c";
      ctx.fillRect(e.x - hpW / 2, e.y - e.r - 10 + wob, hpW * hpR, 4);
    }
  }

  // 粒子
  for (const p of s.parts) {
    const a = Math.max(0, p.life / p.maxLife);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // 得分飘字
  for (const f of s.floats) {
    if (ts >= f.until) continue;
    const a = Math.min(1, (f.until - ts) / 400);
    ctx.globalAlpha = a;
    ctx.fillStyle = "#ffe15e";
    ctx.font = "bold 15px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(f.text, f.x, f.y);
    ctx.globalAlpha = 1;
    ctx.textAlign = "start";
  }

  // 玩家战机（无敌时闪烁）
  if (!s.over) {
    const blink = s.invincible > 0 && Math.floor(ts / 90) % 2 === 0;
    if (!blink) {
      const flame = 6 + Math.sin(ts / 40) * 2.5;
      ctx.save();
      ctx.shadowColor = "#4facfe";
      ctx.shadowBlur = 14;
      // 机体
      ctx.fillStyle = "#3f9bf5";
      ctx.beginPath();
      ctx.moveTo(s.px, s.py - PLAYER_R - 4);
      ctx.lineTo(s.px + PLAYER_R * 0.75, s.py + PLAYER_R * 0.4);
      ctx.lineTo(s.px + PLAYER_R * 0.3, s.py + PLAYER_R * 0.15);
      ctx.lineTo(s.px, s.py + PLAYER_R);
      ctx.lineTo(s.px - PLAYER_R * 0.3, s.py + PLAYER_R * 0.15);
      ctx.lineTo(s.px - PLAYER_R * 0.75, s.py + PLAYER_R * 0.4);
      ctx.closePath();
      ctx.fill();
      // 机翼
      ctx.fillStyle = "#2b7de9";
      ctx.beginPath();
      ctx.moveTo(s.px - PLAYER_R * 0.3, s.py + PLAYER_R * 0.1);
      ctx.lineTo(s.px - PLAYER_R * 1.5, s.py + PLAYER_R * 0.85);
      ctx.lineTo(s.px - PLAYER_R * 0.4, s.py + PLAYER_R * 0.4);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(s.px + PLAYER_R * 0.3, s.py + PLAYER_R * 0.1);
      ctx.lineTo(s.px + PLAYER_R * 1.5, s.py + PLAYER_R * 0.85);
      ctx.lineTo(s.px + PLAYER_R * 0.4, s.py + PLAYER_R * 0.4);
      ctx.closePath();
      ctx.fill();
      // 尾焰
      ctx.fillStyle = "rgba(255,180,60,0.9)";
      ctx.beginPath();
      ctx.moveTo(s.px - 4, s.py + PLAYER_R * 0.7);
      ctx.lineTo(s.px, s.py + PLAYER_R + 6 + flame);
      ctx.lineTo(s.px + 4, s.py + PLAYER_R * 0.7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  // HUD：生命与分数
  ctx.fillStyle = "#ff5a6a";
  ctx.font = "bold 14px sans-serif";
  for (let i = 0; i < s.lives; i++) {
    ctx.fillText("♥", 14 + i * 20, 24);
  }
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.textAlign = "right";
  ctx.font = "bold 16px sans-serif";
  ctx.fillText(String(s.score), W - 14, 24);
  ctx.textAlign = "start";
}

const ThunderFighterGame: React.FC<{ sdk: FatNotesPluginSDK }> = () => {
  const i18n = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<Sim>(newSim());
  const keysRef = useRef<Set<string>>(new Set());
  const lastUiRef = useRef<UiState>({
    score: 0,
    lives: MAX_LIVES,
    kills: 0,
    running: false,
    over: false,
  });
  const [ui, setUi] = useState<UiState>(lastUiRef.current);

  const syncUi = (s: Sim) => {
    const next: UiState = {
      score: s.score,
      lives: s.lives,
      kills: s.kills,
      running: s.running,
      over: s.over,
    };
    const prev = lastUiRef.current;
    if (
      next.score !== prev.score ||
      next.lives !== prev.lives ||
      next.kills !== prev.kills ||
      next.running !== prev.running ||
      next.over !== prev.over
    ) {
      lastUiRef.current = next;
      setUi(next);
    }
  };

  const restart = useCallback(() => {
    simRef.current = newSim();
    lastUiRef.current = {
      score: 0,
      lives: MAX_LIVES,
      kills: 0,
      running: false,
      over: false,
    };
    setUi(lastUiRef.current);
  }, []);

  const startPause = useCallback(() => {
    const s = simRef.current;
    if (s.over) {
      restart();
      return;
    }
    s.running = !s.running;
  }, [restart]);

  // 主循环
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

      if (s.running && !s.over) {
        s.elapsed += dt;
        const keys = keysRef.current;

        // 移动
        let dx = 0;
        let dy = 0;
        if (keys.has("arrowleft") || keys.has("a")) dx -= 1;
        if (keys.has("arrowright") || keys.has("d")) dx += 1;
        if (keys.has("arrowup") || keys.has("w")) dy -= 1;
        if (keys.has("arrowdown") || keys.has("s")) dy += 1;
        if (dx !== 0 || dy !== 0) {
          const len = Math.hypot(dx, dy);
          s.px += (dx / len) * PLAYER_SPEED * dt;
          s.py += (dy / len) * PLAYER_SPEED * dt;
        }
        s.px = Math.max(PLAYER_R + 2, Math.min(W - PLAYER_R - 2, s.px));
        s.py = Math.max(PLAYER_R + 14, Math.min(H - PLAYER_R - 2, s.py));

        // 自动开火
        s.fireCd -= dt;
        if (s.fireCd <= 0) {
          s.fireCd = FIRE_INTERVAL;
          s.bullets.push({
            x: s.px,
            y: s.py - PLAYER_R - 10,
            vy: -540,
            r: 3.5,
            color: "#ffe15e",
          });
        }

        // 敌机生成（越来越密）
        s.spawnCd -= dt;
        const interval = Math.max(0.34, 0.95 - s.elapsed * 0.012);
        if (s.spawnCd <= 0) {
          s.spawnCd = interval;
          s.enemies.push(spawnEnemy(s.elapsed));
        }

        // 子弹移动
        for (const b of s.bullets) b.y += b.vy * dt;
        for (const b of s.eBullets) b.y += b.vy * dt;
        s.bullets = s.bullets.filter((b) => b.y > -30 && b.y < H + 30);
        s.eBullets = s.eBullets.filter((b) => b.y > -30 && b.y < H + 30);

        // 敌机移动与开火
        for (const e of s.enemies) {
          e.y += e.vy * dt;
          e.fireCd -= dt;
          if (e.kind !== "fly" && e.fireCd <= 0 && e.y > 20 && e.y < H * 0.6) {
            e.fireCd = e.fireInterval * (0.8 + Math.random() * 0.4);
            if (e.kind === "tank") {
              // 三发散弹
              for (const off of [-0.22, 0, 0.22]) {
                const ang = Math.PI / 2 + off;
                s.eBullets.push({
                  x: e.x,
                  y: e.y + e.r,
                  vy: Math.sin(ang) * 240,
                  r: 5,
                  color: "#ff5ac8",
                });
              }
            } else {
              s.eBullets.push({
                x: e.x,
                y: e.y + e.r,
                vy: 250,
                r: 5,
                color: "#ff5ac8",
              });
            }
          }
        }
        s.enemies = s.enemies.filter((e) => e.y < H + 60);

        // 玩家子弹 vs 敌机
        const newBullets: Bullet[] = [];
        for (const b of s.bullets) {
          let consumed = false;
          for (const e of s.enemies) {
            const d = Math.hypot(b.x - e.x, b.y - e.y);
            if (d <= e.r + b.r) {
              consumed = true;
              e.hp -= 1;
              addBoom(s, b.x, b.y, false);
              if (e.hp <= 0) {
                s.score += e.value;
                s.kills += 1;
                s.floats.push({
                  x: e.x,
                  y: e.y - e.r,
                  text: `+${e.value}`,
                  until: ts + 700,
                });
                addBoom(s, e.x, e.y, true);
              }
              break;
            }
          }
          if (!consumed) newBullets.push(b);
        }
        s.bullets = newBullets;
        s.enemies = s.enemies.filter((e) => e.hp > 0);

        // 敌机子弹 / 敌机本体 vs 玩家
        for (const b of s.eBullets) {
          if (
            s.lives > 0 &&
            s.invincible <= 0 &&
            Math.hypot(b.x - s.px, b.y - s.py) <= PLAYER_R + b.r
          ) {
            hitPlayer(s);
            b.vy = 9999; // 标记移除
            break;
          }
        }
        s.eBullets = s.eBullets.filter((b) => b.vy < 9000);

        for (const e of s.enemies) {
          if (
            s.lives > 0 &&
            s.invincible <= 0 &&
            Math.hypot(e.x - s.px, e.y - s.py) <= e.r + PLAYER_R
          ) {
            hitPlayer(s);
            e.hp = 0;
            addBoom(s, e.x, e.y, true);
            break;
          }
        }
        s.enemies = s.enemies.filter((e) => e.hp > 0);

        // 星空滚动
        for (const st of s.stars) {
          st.y += st.spd * dt * (1 + s.elapsed * 0.01);
          if (st.y > H + 2) {
            st.y = -2;
            st.x = Math.random() * W;
          }
        }

        // 粒子
        for (const p of s.parts) {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.life -= dt;
        }
        s.parts = s.parts.filter((p) => p.life > 0);
        s.floats = s.floats.filter((f) => ts < f.until);

        if (s.invincible > 0) s.invincible -= dt;

        // 游戏结束
        if (s.over && !s.recorded) {
          s.recorded = true;
          recordScore({
            gameId: "thunder",
            gameTitle: "战鹰雷霆",
            score: s.score,
            detail: { kills: s.kills, seconds: Math.floor(s.elapsed) },
          });
        }
      }

      drawScene(ctx, s, ts);
      syncUi(s);
    };

    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 键盘
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k))
        e.preventDefault();
      if (k === " ") {
        startPause();
        return;
      }
      keysRef.current.add(k);
    };
    const up = (e: KeyboardEvent) => {
      keysRef.current.delete(e.key.toLowerCase());
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [startPause]);

  return (
    <GameFrame
      emoji="✈️"
      title={i18n.text("game.thunder.title")}
      stats={[
        {
          label: i18n.text("game.thunder.score"),
          value: ui.score,
          colors: CHIP_GOLD,
        },
        {
          label: i18n.text("game.thunder.lives"),
          value: ui.lives,
          colors: CHIP_RED,
        },
        {
          label: i18n.text("game.thunder.kills"),
          value: ui.kills,
          colors: CHIP_GREEN,
        },
      ]}
      headerExtra={
        <>
          <GhostBtn onClick={startPause} disabled={ui.over}>
            {ui.running ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
            {ui.running
              ? i18n.text("game.thunder.pause")
              : i18n.text("game.thunder.start")}
          </GhostBtn>
          <GhostBtn onClick={restart}>
            <ReloadOutlined />
            {i18n.text("game.thunder.restart")}
          </GhostBtn>
        </>
      }
      help={i18n.text("game.thunder.help")}
      maxWidth={540}
    >
      <div
        style={{
          position: "relative",
          width: W,
          height: H,
          borderRadius: 14,
          overflow: "hidden",
          boxShadow: "0 8px 24px rgba(20,40,90,0.4)",
          border: "3px solid rgba(80,110,170,0.55)",
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
              background: "rgba(10,16,30,0.82)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              alignItems: "center",
              justifyContent: "center",
              color: "#9ecbff",
            }}
          >
            <div style={{ fontSize: 28, fontWeight: 900 }}>
              {i18n.text("game.thunder.over.title")}
            </div>
            <div style={{ fontSize: 16, opacity: 0.9 }}>
              {i18n.text("game.thunder.over.score", { score: ui.score })}
            </div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              {i18n.text("game.thunder.over.kills", { kills: ui.kills })}
            </div>
            <GhostBtn onClick={restart}>
              <ReloadOutlined />
              {i18n.text("game.thunder.again")}
            </GhostBtn>
          </div>
        )}
        {!ui.running && !ui.over && (
          <div
            className="gs-pulse"
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(10,16,30,0.55)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#9ecbff",
              fontSize: 16,
              fontWeight: 700,
              pointerEvents: "none",
            }}
          >
            {i18n.text("game.thunder.idle")}
          </div>
        )}
      </div>
    </GameFrame>
  );
};

export default ThunderFighterGame;
