/*
 * PingPongGame：乒乓（经典弹球对战）
 *
 * Canvas 实现：左右球拍弹球，先得 7 分获胜。
 *   - 人机模式：左拍由玩家控制（W/S 或 ↑/↓ 或鼠标），右拍为 AI
 *   - 双人模式：左拍 W/S，右拍 ↑/↓
 * 每次击球球速递增，击打位置决定反弹角度。结束后记录成绩。
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { PauseCircleOutlined, PlayCircleOutlined, ReloadOutlined } from "@ant-design/icons";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import { recordScore } from "../scoreClient";
import { useI18n } from "../hooks";
import GameFrame, { GhostBtn, CHIP_GOLD, CHIP_GREEN, CHIP_BLUE } from "./GameFrame";
import { sfxBounce, sfxScore, sfxWin, sfxLose } from "./sound";
import "./gameAnimations.less";

const W = 540;
const H = 380;
const PADDLE_W = 12;
const PADDLE_H = 78;
const BALL_R = 9;
const WIN_SCORE = 7;
const BASE_SPEED = 300; // px / s
const MAX_SPEED = 640;
const PADDLE_SPEED = 380; // px / s
const AI_SPEED = 250;
const SERVE_DELAY = 900; // ms

type Mode = "solo" | "duo";

interface Sim {
  mode: Mode;
  lx: number;
  ly: number; // 左拍中心 y
  ry: number; // 右拍中心 y
  bx: number;
  by: number;
  bvx: number;
  bvy: number;
  speed: number;
  p1: number; // 左方分数
  p2: number; // 右方分数
  running: boolean;
  over: boolean;
  recorded: boolean;
  serveAt: number; // ms；0 表示已发球
  lastScorer: 1 | 2 | null;
  lastTs: number;
  hitFlash: number; // 击球闪光计时（s）
  trail: { x: number; y: number }[];
}

interface UiState {
  p1: number;
  p2: number;
  running: boolean;
  over: boolean;
  mode: Mode;
  serving: boolean;
}

function newSim(mode: Mode): Sim {
  return {
    mode,
    lx: 30,
    ly: H / 2,
    ry: H / 2,
    bx: W / 2,
    by: H / 2,
    bvx: 0,
    bvy: 0,
    speed: BASE_SPEED,
    p1: 0,
    p2: 0,
    running: false,
    over: false,
    recorded: false,
    serveAt: 0,
    lastScorer: null,
    lastTs: 0,
    hitFlash: 0,
    trail: [],
  };
}

/** 发球：朝上一局失分方方向飞，方向随机化 */
function serve(s: Sim): void {
  const dir = s.lastScorer === 2 ? 1 : s.lastScorer === 1 ? -1 : Math.random() < 0.5 ? -1 : 1;
  s.bx = W / 2;
  s.by = H / 2 + (Math.random() - 0.5) * 70;
  s.speed = BASE_SPEED;
  const ang = (Math.random() - 0.5) * 0.9;
  s.bvx = Math.cos(ang) * s.speed * dir;
  s.bvy = Math.sin(ang) * s.speed;
  s.trail = [{ x: s.bx, y: s.by }];
}

/** 球拍击球：根据击打偏移决定反弹角度，球速递增 */
function hit(s: Sim, paddleY: number, dirRight: boolean): void {
  const offset = (s.by - paddleY) / (PADDLE_H / 2);
  const clamped = Math.max(-1, Math.min(1, offset));
  const vy = clamped * 280;
  s.speed = Math.min(MAX_SPEED, s.speed + 14);
  const vx = Math.sqrt(Math.max(0, s.speed * s.speed - vy * vy));
  s.bvx = (dirRight ? 1 : -1) * vx;
  s.bvy = vy;
  // 击球后球紧贴被击球拍的面，并朝反弹方向飞出（左拍→贴左拍右侧，右拍→贴右拍左侧）
  s.bx = dirRight
    ? s.lx + PADDLE_W / 2 + BALL_R
    : W - s.lx - PADDLE_W / 2 - BALL_R;
  s.hitFlash = 0.12;
  sfxBounce();
}

function drawScene(ctx: CanvasRenderingContext2D, s: Sim): void {
  ctx.clearRect(0, 0, W, H);

  // 球台
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#1e6f3e");
  g.addColorStop(0.5, "#2e8b57");
  g.addColorStop(1, "#1c5c34");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  // 中线和边线
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 2;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.moveTo(W / 2, 0);
  ctx.lineTo(W / 2, H);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 3;
  ctx.strokeRect(6, 6, W - 12, H - 12);

  // 球影轨迹
  for (let i = 0; i < s.trail.length; i++) {
    const t = s.trail[i];
    const a = (i / s.trail.length) * 0.35;
    ctx.fillStyle = `rgba(255,255,255,${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(t.x, t.y, BALL_R * (0.5 + (i / s.trail.length) * 0.5), 0, Math.PI * 2);
    ctx.fill();
  }

  // 左拍
  const lFlash = s.hitFlash > 0 && s.bvx > 0;
  ctx.fillStyle = lFlash ? "#fff7ae" : "#ffffff";
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 6;
  ctx.fillRect(s.lx - PADDLE_W / 2, s.ly - PADDLE_H / 2, PADDLE_W, PADDLE_H);
  // 右拍
  const rFlash = s.hitFlash > 0 && s.bvx < 0;
  ctx.fillStyle = rFlash ? "#fff7ae" : "#ffffff";
  ctx.fillRect(W - s.lx - PADDLE_W / 2, s.ry - PADDLE_H / 2, PADDLE_W, PADDLE_H);
  ctx.shadowBlur = 0;

  // 球
  const ballG = ctx.createRadialGradient(s.bx - 2, s.by - 2, 1, s.bx, s.by, BALL_R);
  ballG.addColorStop(0, "#ffffff");
  ballG.addColorStop(1, "#ffd75e");
  ctx.fillStyle = ballG;
  ctx.beginPath();
  ctx.arc(s.bx, s.by, BALL_R, 0, Math.PI * 2);
  ctx.fill();

  // 等待发球提示
  if (s.running && s.serveAt > 0) {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "bold 20px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("…", W / 2, H / 2 - 28);
    ctx.textAlign = "start";
  }
}

const PingPongGame: React.FC<{ sdk: FatNotesPluginSDK }> = () => {
  const i18n = useI18n();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const simRef = useRef<Sim>(newSim("solo"));
  const keysRef = useRef<Set<string>>(new Set());
  const pointerRef = useRef<{ y: number; ts: number } | null>(null);
  const lastUiRef = useRef<UiState>({
    p1: 0,
    p2: 0,
    running: false,
    over: false,
    mode: "solo",
    serving: false,
  });
  const [ui, setUi] = useState<UiState>(lastUiRef.current);

  const syncUi = (s: Sim) => {
    const next: UiState = {
      p1: s.p1,
      p2: s.p2,
      running: s.running,
      over: s.over,
      mode: s.mode,
      serving: s.running && s.serveAt > 0,
    };
    const prev = lastUiRef.current;
    if (
      next.p1 !== prev.p1 ||
      next.p2 !== prev.p2 ||
      next.running !== prev.running ||
      next.over !== prev.over ||
      next.mode !== prev.mode ||
      next.serving !== prev.serving
    ) {
      lastUiRef.current = next;
      setUi(next);
    }
  };

  const reset = useCallback((mode: Mode = simRef.current.mode) => {
    simRef.current = newSim(mode);
    lastUiRef.current = { p1: 0, p2: 0, running: false, over: false, mode, serving: false };
    setUi(lastUiRef.current);
  }, []);

  const startPause = useCallback(() => {
    const s = simRef.current;
    if (s.over) {
      reset(s.mode);
      return;
    }
    if (s.running) {
      s.running = false;
    } else {
      s.running = true;
      if (s.serveAt === 0) s.serveAt = performance.now() + SERVE_DELAY;
    }
  }, [reset]);

  const toggleMode = useCallback(() => {
    reset(simRef.current.mode === "solo" ? "duo" : "solo");
  }, [reset]);

  // 主循环
  useEffect(() => {
    let raf = 0;

    const finishPoint = (s: Sim, ts: number) => {
      if (s.p1 >= WIN_SCORE || s.p2 >= WIN_SCORE) {
        s.over = true;
        s.running = false;
        if (s.mode === "solo" && s.p1 >= WIN_SCORE) {
          sfxWin();
        } else {
          sfxLose();
        }
        if (!s.recorded) {
          s.recorded = true;
          const playerWin = s.p1 >= WIN_SCORE;
          recordScore({
            gameId: "pingpong",
            gameTitle: "乒乓",
            score: s.p1,
            detail: {
              mode: s.mode,
              result: s.mode === "solo" ? (playerWin ? "win" : "lose") : playerWin ? "left-win" : "right-win",
              opponentScore: s.p2,
            },
          });
        }
      } else {
        s.serveAt = ts + SERVE_DELAY;
      }
    };

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
        const keys = keysRef.current;

        // 左拍：W/S（双人模式下 ↑/↓ 归右拍）
        if (keys.has("w")) s.ly -= PADDLE_SPEED * dt;
        if (keys.has("s")) s.ly += PADDLE_SPEED * dt;
        if (s.mode === "solo") {
          if (keys.has("arrowup")) s.ly -= PADDLE_SPEED * dt;
          if (keys.has("arrowdown")) s.ly += PADDLE_SPEED * dt;
        } else {
          if (keys.has("arrowup")) s.ry -= PADDLE_SPEED * dt;
          if (keys.has("arrowdown")) s.ry += PADDLE_SPEED * dt;
        }

        // 鼠标控制左拍
        const ptr = pointerRef.current;
        if (ptr && ts - ptr.ts < 3000) {
          const target = (ptr.y / 1000) * H;
          const diff = target - s.ly;
          const step = 620 * dt;
          s.ly += Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
        }

        s.ly = Math.max(PADDLE_H / 2, Math.min(H - PADDLE_H / 2, s.ly));
        if (s.mode === "duo") {
          s.ry = Math.max(PADDLE_H / 2, Math.min(H - PADDLE_H / 2, s.ry));
        } else {
          // AI：球朝右时追球（带一点预判），球离开时回中
          const targetY = s.bvx > 0 ? s.by + s.bvy * 0.55 : H / 2;
          const diff = targetY - s.ry;
          const step = AI_SPEED * dt;
          s.ry += Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
          s.ry = Math.max(PADDLE_H / 2, Math.min(H - PADDLE_H / 2, s.ry));
        }

        // 发球倒计时
        if (s.serveAt > 0) {
          if (ts >= s.serveAt) {
            s.serveAt = 0;
            serve(s);
          }
        } else {
          s.bx += s.bvx * dt;
          s.by += s.bvy * dt;
          s.trail.push({ x: s.bx, y: s.by });
          if (s.trail.length > 14) s.trail.shift();

          // 上下反弹
          if (s.by - BALL_R <= 6) {
            s.by = 6 + BALL_R;
            s.bvy = Math.abs(s.bvy);
          } else if (s.by + BALL_R >= H - 6) {
            s.by = H - 6 - BALL_R;
            s.bvy = -Math.abs(s.bvy);
          }

          // 左拍碰撞
          if (s.bvx < 0 && s.bx - BALL_R <= s.lx + PADDLE_W / 2 && s.bx >= s.lx - PADDLE_W / 2 - BALL_R && s.by >= s.ly - PADDLE_H / 2 - BALL_R && s.by <= s.ly + PADDLE_H / 2 + BALL_R) {
            hit(s, s.ly, true);
          }
          // 右拍碰撞
          const rx = W - s.lx;
          if (s.bvx > 0 && s.bx + BALL_R >= rx - PADDLE_W / 2 && s.bx <= rx + PADDLE_W / 2 + BALL_R && s.by >= s.ry - PADDLE_H / 2 - BALL_R && s.by <= s.ry + PADDLE_H / 2 + BALL_R) {
            hit(s, s.ry, false);
          }

          // 得分
          if (s.bx < -24) {
            s.p2 += 1;
            s.lastScorer = 2;
            sfxScore();
            finishPoint(s, ts);
          } else if (s.bx > W + 24) {
            s.p1 += 1;
            s.lastScorer = 1;
            sfxScore();
            finishPoint(s, ts);
          }
        }

        if (s.hitFlash > 0) s.hitFlash -= dt;
      }

      drawScene(ctx, s);
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
      if (k === " " || k === "arrowup" || k === "arrowdown") e.preventDefault();
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

  const winnerIsPlayer = ui.mode === "solo" && ui.p1 >= WIN_SCORE;

  return (
    <GameFrame
      emoji="🏓"
      title={i18n.text("game.pingpong.title")}
      stats={[
        {
          label: i18n.text("game.pingpong.score"),
          value: `${ui.p1} : ${ui.p2}`,
          colors: CHIP_GOLD,
        },
        { label: i18n.text("game.pingpong.target"), value: WIN_SCORE, colors: CHIP_GREEN },
        {
          label: i18n.text("game.pingpong.mode"),
          value: ui.mode === "solo" ? i18n.text("game.pingpong.solo") : i18n.text("game.pingpong.duo"),
          colors: CHIP_BLUE,
        },
      ]}
      headerExtra={
        <>
          <GhostBtn onClick={startPause} disabled={ui.over}>
            {ui.running ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
            {ui.running ? i18n.text("game.pingpong.pause") : i18n.text("game.pingpong.start")}
          </GhostBtn>
          <GhostBtn onClick={toggleMode}>
            {ui.mode === "solo" ? i18n.text("game.pingpong.duo") : i18n.text("game.pingpong.solo")}
          </GhostBtn>
          <GhostBtn onClick={() => reset(ui.mode)}>
            <ReloadOutlined />
            {i18n.text("game.pingpong.restart")}
          </GhostBtn>
        </>
      }
      help={i18n.text("game.pingpong.help")}
      maxWidth={600}
    >
      <div
        style={{
          position: "relative",
          width: W,
          height: H,
          borderRadius: 14,
          overflow: "hidden",
          boxShadow: "0 8px 24px rgba(30,90,60,0.3)",
          border: "3px solid rgba(120,150,130,0.5)",
        }}
      >
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          style={{ display: "block", cursor: "none" }}
          onPointerMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            pointerRef.current = { y: (e.clientY - rect.top) / rect.height, ts: performance.now() };
          }}
          onPointerLeave={() => {
            pointerRef.current = null;
          }}
        />
        {ui.over && (
          <div
            className="gs-win-in"
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(235,248,240,0.86)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              alignItems: "center",
              justifyContent: "center",
              color: "#1c5c34",
            }}
          >
            <div style={{ fontSize: 28, fontWeight: 900 }}>
              {ui.mode === "duo"
                ? i18n.text("game.pingpong.finish")
                : winnerIsPlayer
                  ? i18n.text("game.pingpong.win")
                  : i18n.text("game.pingpong.lose")}
            </div>
            <div style={{ fontSize: 16, opacity: 0.85, fontWeight: 700 }}>
              {ui.p1} : {ui.p2}
            </div>
            <GhostBtn onClick={() => reset(ui.mode)}>
              <ReloadOutlined />
              {i18n.text("game.pingpong.again")}
            </GhostBtn>
          </div>
        )}
        {!ui.running && !ui.over && (
          <div
            className="gs-pulse"
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(235,248,240,0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#1c5c34",
              fontSize: 16,
              fontWeight: 700,
              pointerEvents: "none",
            }}
          >
            {i18n.text("game.pingpong.idle")}
          </div>
        )}
      </div>
    </GameFrame>
  );
};

export default PingPongGame;
