/*
 * OrangePeelGame：剥橘子
 *
 * 玩法：俯视橘子由 8 瓣 × 3 段共 24 块橘皮拼成。按住鼠标/手指拖动，
 * 划过的皮块会被撕下，露出白络与果肉，并飞出卷皮粒子。核心技巧是
 * 「快而稳」——连续撕皮叠加连击倍率（最高 ×5），但拖太快会划伤果肉
 * （只拿 2 分、断连击、破损处影响评级）。
 *
 * 里程碑：整瓣剥完触发「整瓣掀起」+25；剥完 24 块且零划伤得 S 评级
 * （+200 完美奖励 + 剩余时间加成）。60 秒一局，成绩自动落库。
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ReloadOutlined } from "@ant-design/icons";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import { recordScore } from "../scoreClient";
import { useI18n } from "../hooks";
import GameFrame, {
  PrimaryBtn,
  GhostBtn,
  CHIP_GOLD,
  CHIP_BLUE,
  CHIP_RED,
  CHIP_PURPLE,
} from "./GameFrame";
import {
  blockGain,
  blockPath,
  comboMultiplier,
  hitTest,
  PEEL_TOTAL,
  R_IN,
  R_OUT,
  ratingFor,
  segArc,
  SLICES,
  SLICE_ANGLE,
  sliceComplete,
  slicePath,
  START_ANGLE,
  polar,
  type Rating,
} from "./orangeLogic";
import { sfxClick, sfxEat, sfxHurt, sfxLose, sfxPerfect, sfxScore, sfxWin } from "./sound";
import "./gameAnimations.less";

const ROUND_SECONDS = 60; // 一局时长
const COMBO_WINDOW = 900; // 连击窗口（毫秒）
const SPEED_CUT = 1.5; // 划伤阈值：拖动速度（SVG 坐标 px / ms）
const SLICE_BONUS = 25; // 整瓣剥完奖励
const PERFECT_BONUS = 200; // 剥完整颗奖励
const TIME_BONUS_RATE = 5; // 剩余每秒加成

type Phase = "idle" | "playing" | "over";

interface Particle {
  id: number;
  x: number; // SVG 坐标（0-300）
  y: number;
  kind: "peel" | "juice" | "slice";
  angle: number; // 飞出方向（度）
}

interface FloatText {
  id: number;
  x: number;
  y: number;
  text: string;
  kind: "good" | "bad" | "great";
}

const RATING_COLORS: Record<Rating, { color: string; glow: string }> = {
  S: { color: "#ffd45e", glow: "rgba(255,190,60,0.9)" },
  A: { color: "#7dffb0", glow: "rgba(90,230,150,0.85)" },
  B: { color: "#8ec9ff", glow: "rgba(90,170,255,0.8)" },
  C: { color: "#d8dce2", glow: "rgba(180,185,195,0.8)" },
};

let fxSeq = 0;
function nextId(): number {
  fxSeq += 1;
  return fxSeq;
}

/** 果肉瓣粒纹理：放射线 + 两段分界弧 */
function FleshTexture({ slice }: { slice: number }): React.ReactElement {
  const a0 = START_ANGLE + slice * SLICE_ANGLE;
  const a1 = a0 + SLICE_ANGLE;
  const mid = a0 + SLICE_ANGLE / 2;
  const [ix0, iy0] = polar(150, 150, R_IN, a0);
  const [ox0, oy0] = polar(150, 150, R_OUT, a0);
  const [ix1, iy1] = polar(150, 150, R_IN, a1);
  const [ox1, oy1] = polar(150, 150, R_OUT, a1);
  const [mx, my] = polar(150, 150, R_OUT, mid);
  return (
    <g stroke="#f5851f" strokeWidth="1.1" opacity="0.65" fill="none">
      <path d={`M ${ix0.toFixed(2)} ${iy0.toFixed(2)} L ${ox0.toFixed(2)} ${oy0.toFixed(2)}`} />
      <path d={`M ${ix1.toFixed(2)} ${iy1.toFixed(2)} L ${ox1.toFixed(2)} ${oy1.toFixed(2)}`} />
      <path d={`M 150 150 L ${mx.toFixed(2)} ${my.toFixed(2)}`} />
      <path d={segArc(slice, 1)} />
      <path d={segArc(slice, 2)} />
    </g>
  );
}

/** 粒子：撕下的卷皮 / 果肉溅汁 / 整瓣卷皮 */
function FxParticle({
  p,
  onDone,
}: {
  p: Particle;
  onDone: (id: number) => void;
}): React.ReactElement {
  const elRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = elRef.current;
    if (!el) return undefined;
    const dist = p.kind === "slice" ? 74 : p.kind === "juice" ? 26 : 52;
    const dur = p.kind === "slice" ? 900 : p.kind === "juice" ? 520 : 640;
    const rad = (p.angle * Math.PI) / 180;
    const x = Math.cos(rad) * dist;
    const y = Math.sin(rad) * dist + (p.kind === "peel" ? 18 : 0);
    const rotEnd = p.kind === "slice" ? 480 : p.kind === "juice" ? 160 : 320;
    const anim = el.animate(
      [
        {
          transform: "translate(-50%, -50%) translate(0, 0) rotate(0deg) scale(0.7)",
          opacity: 1,
        },
        {
          transform: `translate(-50%, -50%) translate(${x}px, ${y}px) rotate(${rotEnd}deg) scale(1)`,
          opacity: 0,
          offset: 0.75,
        },
        {
          transform: `translate(-50%, -50%) translate(${x * 1.25}px, ${y * 1.25 + 26}px) rotate(${
            rotEnd + 160
          }deg) scale(0.85)`,
          opacity: 0,
        },
      ],
      { duration: dur, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    anim.onfinish = () => onDone(p.id);
    return () => anim.cancel();
  }, [p, onDone]);

  return (
    <div
      ref={elRef}
      style={{
        position: "absolute",
        left: `${(p.x / 300) * 100}%`,
        top: `${(p.y / 300) * 100}%`,
        width: p.kind === "slice" ? 30 : p.kind === "juice" ? 7 : 12,
        height: p.kind === "slice" ? 44 : p.kind === "juice" ? 7 : 16,
        borderRadius: p.kind === "juice" ? "50%" : 6,
        background:
          p.kind === "juice"
            ? "radial-gradient(circle at 35% 30%, #ffd07a 0%, #ff9a2c 70%)"
            : "linear-gradient(160deg, #ffc06a 0%, #ff9a33 55%, #f0781c 100%)",
        border: p.kind === "juice" ? "none" : "1px solid #d97116",
        boxShadow: "0 2px 6px rgba(120,60,0,0.3)",
      }}
    />
  );
}

/** 上飘浮字：加分 / 划伤 / 里程碑 */
function FloatTextFx({
  f,
  onDone,
}: {
  f: FloatText;
  onDone: (id: number) => void;
}): React.ReactElement {
  const elRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = elRef.current;
    if (!el) return undefined;
    const anim = el.animate(
      [
        { transform: "translate(-50%, -50%) translateY(0)", opacity: 1 },
        { transform: "translate(-50%, -50%) translateY(-44px)", opacity: 0, offset: 0.8 },
        { transform: "translate(-50%, -50%) translateY(-58px)", opacity: 0 },
      ],
      { duration: 1150, easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
    );
    anim.onfinish = () => onDone(f.id);
    return () => anim.cancel();
  }, [f, onDone]);

  return (
    <div
      ref={elRef}
      style={{
        position: "absolute",
        left: `${(f.x / 300) * 100}%`,
        top: `${(f.y / 300) * 100}%`,
        fontSize: f.kind === "great" ? 20 : 17,
        fontWeight: 800,
        color:
          f.kind === "good" ? "#ffd45e" : f.kind === "bad" ? "#ff7a6b" : "#7dffb0",
        textShadow: "0 2px 8px rgba(0,0,0,0.45)",
        whiteSpace: "nowrap",
        zIndex: 6,
      }}
    >
      {f.text}
    </div>
  );
}

const OrangePeelGame: React.FC<{ sdk: FatNotesPluginSDK }> = () => {
  const i18n = useI18n();
  const [phase, setPhase] = useState<Phase>("idle");
  const [peeled, setPeeled] = useState<ReadonlySet<number>>(new Set());
  const [cuts, setCuts] = useState<ReadonlySet<number>>(new Set());
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [comboMax, setComboMax] = useState(0);
  const [timeLeft, setTimeLeft] = useState(ROUND_SECONDS);
  const [particles, setParticles] = useState<Particle[]>([]);
  const [floats, setFloats] = useState<FloatText[]>([]);
  const [shaking, setShaking] = useState(false);
  const [recorded, setRecorded] = useState(false);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const lastPointRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const lastPeelRef = useRef(0);
  const phaseRef = useRef<Phase>(phase);
  const peeledRef = useRef(peeled);
  const comboRef = useRef(combo);
  phaseRef.current = phase;
  peeledRef.current = peeled;
  comboRef.current = combo;

  /** 各瓣是否整瓣剥完（白络 → 果肉切换） */
  const completeSlices = useMemo(
    () => Array.from({ length: SLICES }, (_, s) => sliceComplete(s, peeled)),
    [peeled],
  );

  /** 静态 path 缓存 */
  const peelPaths = useMemo(
    () => Array.from({ length: PEEL_TOTAL }, (_, i) => blockPath(i)),
    [],
  );
  const slicePaths = useMemo(
    () => Array.from({ length: SLICES }, (_, s) => slicePath(s)),
    [],
  );

  const removeParticle = useCallback((id: number) => {
    setParticles((ps) => ps.filter((p) => p.id !== id));
  }, []);
  const removeFloat = useCallback((id: number) => {
    setFloats((fs) => fs.filter((f) => f.id !== id));
  }, []);
  const spawn = useCallback(
    (fx: Omit<Particle, "id">) => {
      setParticles((ps) => [...ps.slice(-24), { id: nextId(), ...fx }]);
    },
    [],
  );
  const spawnFloat = useCallback(
    (fx: Omit<FloatText, "id">) => {
      setFloats((fs) => [...fs.slice(-5), { id: nextId(), ...fx }]);
    },
    [],
  );

  /** 整局结束（剥完 / 时间到） */
  const finishGame = useCallback(
    (perfect: boolean, peeledAll: boolean, elapsed: number) => {
      setPhase("over");
      if (perfect) {
        setScore((s) => s + PERFECT_BONUS);
        sfxWin();
      } else {
        sfxLose();
      }
      if (peeledAll) {
        setScore((s) => s + elapsed * TIME_BONUS_RATE);
      }
    },
    [],
  );

  /** 撕一块皮 */
  const peelAt = useCallback(
    (x: number, y: number, fast: boolean) => {
      if (phaseRef.current !== "playing") return;
      const hit = hitTest(x, y);
      if (!hit) return;
      const cur = peeledRef.current;
      if (cur.has(hit.idx)) return;

      const now = performance.now();
      const isCut = fast;
      const nextCombo =
        !isCut && now - lastPeelRef.current <= COMBO_WINDOW
          ? comboRef.current + 1
          : 1;
      lastPeelRef.current = now;
      const gain = blockGain(nextCombo, isCut);

      const newPeeled = new Set(cur);
      newPeeled.add(hit.idx);
      setPeeled(newPeeled);
      if (isCut) setCuts((prev) => new Set(prev).add(hit.idx));
      setCombo(nextCombo);
      if (!isCut) setComboMax((m) => Math.max(m, nextCombo));
      setScore((s) => s + gain);

      const fxPt = { x, y };

      if (isCut) {
        sfxHurt();
        setShaking(true);
        for (let i = 0; i < 5; i++) {
          spawn({ ...fxPt, kind: "juice", angle: 120 + Math.random() * 120 });
        }
        spawnFloat({ ...fxPt, text: `划伤 -${gain}`, kind: "bad" });
      } else {
        if (nextCombo >= 3) sfxScore();
        else sfxEat();
        spawn({ ...fxPt, kind: "peel", angle: -100 + Math.random() * 40 });
        spawn({ ...fxPt, kind: "peel", angle: -40 + Math.random() * 30 });
        spawnFloat({ ...fxPt, text: `+${gain}`, kind: "good" });
      }

      // 整瓣剥完
      if (sliceComplete(hit.slice, newPeeled)) {
        setScore((s) => s + SLICE_BONUS);
        sfxPerfect();
        spawn({ ...fxPt, kind: "slice", angle: -90 + Math.random() * 60 });
        spawnFloat({ ...fxPt, text: `整瓣 +${SLICE_BONUS}`, kind: "great" });
      }

      // 剥完整颗 → 完美收尾
      if (newPeeled.size >= PEEL_TOTAL) {
        spawnFloat({
          x: 150,
          y: 90,
          text: `完美剥皮 +${PERFECT_BONUS}`,
          kind: "great",
        });
        finishGame(true, true, ROUND_SECONDS - timeLeft);
      }
    },
    [finishGame, spawn, spawnFloat, timeLeft],
  );

  const toSvg = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return { x: 0, y: 0 };
    return {
      x: ((e.clientX - rect.left) / rect.width) * 300,
      y: ((e.clientY - rect.top) / rect.height) * 300,
    };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (phaseRef.current !== "playing") return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const pt = toSvg(e);
      lastPointRef.current = { ...pt, t: performance.now() };
      peelAt(pt.x, pt.y, false);
    },
    [peelAt, toSvg],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (phaseRef.current !== "playing") return;
      const pt = toSvg(e);
      const lp = lastPointRef.current;
      const now = performance.now();
      let fast = false;
      if (lp) {
        const dt = now - lp.t;
        const dist = Math.hypot(pt.x - lp.x, pt.y - lp.y);
        if (dt > 0 && dist / dt > SPEED_CUT) fast = true;
      }
      lastPointRef.current = { ...pt, t: now };
      peelAt(pt.x, pt.y, fast);
    },
    [peelAt, toSvg],
  );

  const onPointerUp = useCallback(() => {
    lastPointRef.current = null;
  }, []);

  /** 开始一局 */
  const start = useCallback(() => {
    setPeeled(new Set());
    setCuts(new Set());
    setScore(0);
    setCombo(0);
    setComboMax(0);
    setTimeLeft(ROUND_SECONDS);
    setRecorded(false);
    setParticles([]);
    setFloats([]);
    lastPeelRef.current = 0;
    lastPointRef.current = null;
    setPhase("playing");
    sfxClick();
  }, []);

  // 倒计时
  useEffect(() => {
    if (phase !== "playing") return;
    const id = window.setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          finishGame(false, false, 0);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase, finishGame]);

  // 抖动复位
  useEffect(() => {
    if (!shaking) return;
    const id = window.setTimeout(() => setShaking(false), 450);
    return () => window.clearTimeout(id);
  }, [shaking]);

  // 结束记录成绩
  useEffect(() => {
    if (phase !== "over" || recorded) return;
    setRecorded(true);
    recordScore({
      gameId: "orange",
      gameTitle: "剥橘子",
      score,
      detail: {
        peeled: peeled.size,
        total: PEEL_TOTAL,
        cuts: cuts.size,
        comboMax,
        rating: ratingFor(peeled.size, cuts.size),
        seconds: ROUND_SECONDS - timeLeft,
      },
    });
  }, [phase, recorded, score, peeled, cuts, comboMax, timeLeft]);

  const peeledAll = peeled.size >= PEEL_TOTAL;
  const rating = ratingFor(peeled.size, cuts.size);
  const mult = comboMultiplier(combo);
  const progress = Math.round((peeled.size / PEEL_TOTAL) * 100);

  /** 皮块配色：瓣间色相微调 + 段间深浅交替 */
  const peelFill = (idx: number): string => {
    const slice = Math.floor(idx / 3);
    const seg = idx % 3;
    const warm = slice % 2 === 0;
    if (seg === 0) return warm ? "#ffa63e" : "#ffb04e";
    if (seg === 1) return warm ? "#f8932c" : "#fa9a33";
    return warm ? "#f08724" : "#f59a2c";
  };

  return (
    <GameFrame
      emoji="🍊"
      title={i18n.text("game.orange.title")}
      stats={[
        { label: i18n.text("game.orange.score"), value: score, colors: CHIP_GOLD },
        {
          label: i18n.text("game.orange.combo"),
          value: combo > 0 ? `${combo} ×${mult.toFixed(1)}` : "—",
          colors: CHIP_PURPLE,
        },
        {
          label: i18n.text("game.orange.progress"),
          value: `${peeled.size}/${PEEL_TOTAL}`,
          colors: CHIP_BLUE,
        },
        {
          label: i18n.text("game.orange.time"),
          value: `${timeLeft}s`,
          colors: CHIP_RED,
        },
      ]}
      headerExtra={
        <GhostBtn onClick={start}>
          <ReloadOutlined />
          {phase === "playing" || phase === "over"
            ? i18n.text("game.orange.restart")
            : i18n.text("game.orange.start")}
        </GhostBtn>
      }
      help={i18n.text("game.orange.help")}
      maxWidth={520}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          maxWidth: 430,
          margin: "0 auto",
          aspectRatio: "1 / 1",
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
      >
        {/* 粒子 / 浮字层 */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 5,
            overflow: "visible",
          }}
        >
          {particles.map((p) => (
            <FxParticle key={p.id} p={p} onDone={removeParticle} />
          ))}
          {floats.map((f) => (
            <FloatTextFx key={f.id} f={f} onDone={removeFloat} />
          ))}
        </div>

        {/* 橘子 SVG */}
        <div
          className={shaking ? "gs-shake" : undefined}
          style={{ position: "absolute", inset: 0 }}
        >
          <svg
            ref={svgRef}
            viewBox="0 0 300 300"
            style={{
              width: "100%",
              height: "100%",
              display: "block",
              cursor: phase === "playing" ? "crosshair" : "default",
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            <defs>
              <radialGradient id="orange-flesh" cx="40%" cy="35%" r="80%">
                <stop offset="0%" stopColor="#ffbd5e" />
                <stop offset="70%" stopColor="#ff9a2c" />
                <stop offset="100%" stopColor="#f7821c" />
              </radialGradient>
              <linearGradient id="orange-pith" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#fdf3da" />
                <stop offset="100%" stopColor="#f2e0b4" />
              </linearGradient>
            </defs>

            {/* 投影 */}
            <ellipse cx="150" cy="247" rx="96" ry="13" fill="rgba(0,0,0,0.16)" />

            {/* 果肉底（最下层） */}
            <circle
              cx="150"
              cy="150"
              r={R_OUT}
              fill="url(#orange-flesh)"
              stroke="#e6781a"
              strokeWidth="2"
            />

            {/* 白络层 / 整瓣完成后的果肉瓣 */}
            {slicePaths.map((d, s) => {
              const touched =
                peeled.has(s * 3) || peeled.has(s * 3 + 1) || peeled.has(s * 3 + 2);
              if (!touched) return null;
              const done = completeSlices[s];
              return (
                <g key={s} className={done ? "gs-flesh-in" : undefined}>
                  <path
                    d={d}
                    fill={done ? "url(#orange-flesh)" : "url(#orange-pith)"}
                    stroke={done ? "#ffb354" : "#ecd5a0"}
                    strokeWidth={done ? 1.4 : 1}
                    opacity={done ? 1 : 0.92}
                  />
                  {done && <FleshTexture slice={s} />}
                </g>
              );
            })}

            {/* 划伤破损（被快速撕下的块） */}
            {peelPaths.map((d, idx) =>
              cuts.has(idx) ? (
                <path
                  key={`cut-${idx}`}
                  d={d}
                  fill="#e8732a"
                  opacity="0.85"
                  stroke="#c95d18"
                  strokeWidth="0.8"
                />
              ) : null,
            )}

            {/* 未剥的橘皮块 */}
            {peelPaths.map((d, idx) =>
              peeled.has(idx) ? null : (
                <path
                  key={idx}
                  d={d}
                  fill={peelFill(idx)}
                  stroke="#d97b1f"
                  strokeWidth="1.2"
                  strokeLinejoin="round"
                />
              ),
            )}

            {/* 果脐 */}
            <circle
              cx="150"
              cy="150"
              r="22"
              fill="#e8851d"
              stroke="#cf6a12"
              strokeWidth="1.4"
            />
            <circle cx="150" cy="150" r="10" fill="#f0a03a" opacity="0.85" />
            {Array.from({ length: 6 }, (_, i) => {
              const a = ((i * 60 + 30) * Math.PI) / 180;
              return (
                <circle
                  key={i}
                  cx={150 + 15 * Math.cos(a)}
                  cy={150 + 15 * Math.sin(a)}
                  r="1.6"
                  fill="#b95a0e"
                />
              );
            })}

            {/* 顶部高光 */}
            <ellipse
              cx="112"
              cy="92"
              rx="50"
              ry="27"
              fill="#ffffff"
              opacity="0.30"
              transform="rotate(-16 112 92)"
              pointerEvents="none"
            />
          </svg>
        </div>

        {/* idle 覆盖层 */}
        {phase === "idle" && (
          <div
            className="gs-win-in"
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              background: "rgba(255,140,50,0.9)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              color: "#fff",
              zIndex: 8,
              padding: 20,
              textAlign: "center",
              boxShadow: "inset 0 0 60px rgba(140,60,0,0.35)",
            }}
          >
            <div style={{ fontSize: 34, lineHeight: 1.2 }}>🍊</div>
            <div style={{ fontSize: 21, fontWeight: 800 }}>{i18n.text("game.orange.title")}</div>
            <div style={{ fontSize: 12.5, opacity: 0.92, maxWidth: 280 }}>
              {i18n.text("game.orange.idleSub")}
            </div>
            <div style={{ marginTop: 6 }}>
              <PrimaryBtn onClick={start}>{i18n.text("game.orange.start")}</PrimaryBtn>
            </div>
          </div>
        )}

        {/* 结算覆盖层 */}
        {phase === "over" && (
          <div
            className="gs-win-in"
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              background: "rgba(24,26,32,0.78)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              color: "#fff",
              zIndex: 8,
              padding: 20,
              textAlign: "center",
              backdropFilter: "blur(2px)",
            }}
          >
            <div
              style={{
                fontSize: 54,
                fontWeight: 900,
                lineHeight: 1,
                color: RATING_COLORS[rating].color,
                textShadow: `0 0 26px ${RATING_COLORS[rating].glow}`,
              }}
            >
              {rating}
            </div>
            <div style={{ fontSize: 24, fontWeight: 800 }}>{score}</div>
            <div style={{ fontSize: 12.5, opacity: 0.9 }}>
              {peeledAll
                ? i18n.text("game.orange.over.peeled", {
                    peeled: peeled.size,
                    cuts: cuts.size,
                  })
                : i18n.text("game.orange.over.timeUp")}
            </div>
            <div style={{ fontSize: 11.5, opacity: 0.72 }}>
              {i18n.text("game.orange.over.detail", {
                combo: comboMax,
                rating,
              })}
            </div>
            <div style={{ marginTop: 8 }}>
              <PrimaryBtn onClick={start}>{i18n.text("game.orange.again")}</PrimaryBtn>
            </div>
          </div>
        )}
      </div>
    </GameFrame>
  );
};

export default OrangePeelGame;
