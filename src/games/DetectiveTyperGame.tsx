/*
 * DetectiveTyperGame：逍遥警探（打字缉凶）
 *
 * 嫌犯举着罪名标签从右侧潜逃，玩家敲键盘拼出罪名全拼即可逮捕；
 * 嫌犯溜过左侧逃逸线扣 1 条命，3 条命耗尽任务结束。
 * 连续逮捕积累连击，连击越高每个案子的赏金越多。
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ReloadOutlined } from "@ant-design/icons";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import { recordScore } from "../scoreClient";
import { useI18n } from "../hooks";
import GameFrame, {
  GhostBtn,
  CHIP_GOLD,
  CHIP_RED,
  CHIP_GREEN,
  CHIP_PURPLE,
} from "./GameFrame";
import { sfxClick, sfxCoin, sfxHurt, sfxLose, sfxMismatch } from "./sound";
import {
  ESCAPE_X,
  LANE_Y,
  MAX_SUSPECTS,
  STAGE_H,
  START_LIVES,
  handleKey,
  spawnSuspect,
  speedAt,
  spawnIntervalAt,
  type Suspect,
} from "./detectiveLogic";

interface FloatText {
  id: number;
  x: number;
  y: number;
  text: string;
  color: string;
}

let floatId = 1;

const DetectiveTyperGame: React.FC<{ sdk: FatNotesPluginSDK }> = () => {
  const i18n = useI18n();

  const [suspects, setSuspects] = useState<Suspect[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [typedLen, setTypedLen] = useState(0);
  const [score, setScore] = useState(0);
  const [arrested, setArrested] = useState(0);
  const [lives, setLives] = useState(START_LIVES);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [running, setRunning] = useState(false);
  const [over, setOver] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const [floats, setFloats] = useState<FloatText[]>([]);
  const [wrongPulse, setWrongPulse] = useState(0);

  // ── mutable 世界（rAF 内读写，避免闭包过期） ──
  const suspectsRef = useRef<Suspect[]>([]);
  const activeRef = useRef<number | null>(null);
  const typedRef = useRef(0);
  const comboRef = useRef(0);
  const livesRef = useRef(START_LIVES);
  const elapsedRef = useRef(0);
  const spawnAccRef = useRef(0);
  const usedWordsRef = useRef<Set<string>>(new Set());
  const rafRef = useRef<number | null>(null);
  const lastTRef = useRef<number>(0);
  const runningRef = useRef(false);

  suspectsRef.current = suspects;
  activeRef.current = activeId;
  typedRef.current = typedLen;
  comboRef.current = combo;

  const pushFloat = useCallback((x: number, y: number, text: string, color: string) => {
    const id = floatId++;
    setFloats((fs) => [...fs, { id, x, y, text, color }]);
    window.setTimeout(() => {
      setFloats((fs) => fs.filter((f) => f.id !== id));
    }, 900);
  }, []);

  /** 开始 / 重开一局 */
  const start = useCallback(() => {
    setSuspects([]);
    setActiveId(null);
    setTypedLen(0);
    setScore(0);
    setArrested(0);
    setLives(START_LIVES);
    setCombo(0);
    setMaxCombo(0);
    setFloats([]);
    setOver(false);
    setRecorded(false);
    suspectsRef.current = [];
    activeRef.current = null;
    typedRef.current = 0;
    comboRef.current = 0;
    livesRef.current = START_LIVES;
    elapsedRef.current = 0;
    spawnAccRef.current = 0;
    usedWordsRef.current = new Set();
    runningRef.current = true;
    setRunning(true);
    sfxClick();
  }, []);

  // ── rAF 世界步进 ──
  useEffect(() => {
    if (!running || over) return;

    const tick = (t: number) => {
      const last = lastTRef.current || t;
      const dt = Math.min(0.05, (t - last) / 1000);
      lastTRef.current = t;
      elapsedRef.current += dt;

      const speed = speedAt(elapsedRef.current);
      let list = suspectsRef.current.map((s) => ({ ...s, x: s.x - speed * dt }));

      // 出怪
      spawnAccRef.current += dt * 1000;
      const interval = spawnIntervalAt(elapsedRef.current);
      if (spawnAccRef.current >= interval && list.length < MAX_SUSPECTS) {
        spawnAccRef.current = 0;
        const { suspect, used } = spawnSuspect(list, usedWordsRef.current);
        usedWordsRef.current = used;
        list = [...list, suspect];
      }

      // 逃逸判定
      const escaped = list.filter((s) => s.x <= ESCAPE_X);
      if (escaped.length > 0) {
        list = list.filter((s) => s.x > ESCAPE_X);
        livesRef.current -= escaped.length;
        setLives(livesRef.current);
        comboRef.current = 0;
        setCombo(0);
        const left = activeRef.current;
        if (left !== null && escaped.some((e) => e.id === left)) {
          activeRef.current = null;
          typedRef.current = 0;
          setActiveId(null);
          setTypedLen(0);
        }
        for (const e of escaped) {
          pushFloat(ESCAPE_X + 30, LANE_Y[e.lane] + 10, i18n.text("game.detective.escaped"), "#ff8a80");
        }
        sfxHurt();
        if (livesRef.current <= 0) {
          list = list.filter((s) => !escaped.some((e) => e.id === s.id));
          suspectsRef.current = list;
          setSuspects(list);
          runningRef.current = false;
          setRunning(false);
          setOver(true);
          sfxLose();
          return;
        }
      }

      suspectsRef.current = list;
      setSuspects(list);
      rafRef.current = window.requestAnimationFrame(tick);
    };

    lastTRef.current = 0;
    rafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current);
    };
  }, [running, over, i18n, pushFloat]);

  // ── 结束记录成绩 ──
  useEffect(() => {
    if (over && !recorded) {
      setRecorded(true);
      recordScore({
        gameId: "detective",
        gameTitle: "逍遥警探",
        score,
        detail: { arrested, maxCombo },
      });
    }
  }, [over, recorded, score, arrested, maxCombo]);

  // ── 键盘输入 ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();

      // 空格：空闲 / 结束时开局
      if (k === " ") {
        if (!runningRef.current) {
          e.preventDefault();
          start();
        }
        return;
      }
      if (!/^[a-z]$/.test(k)) return;
      if (!runningRef.current) return;
      e.preventDefault();

      const r = handleKey(k, {
        suspects: suspectsRef.current,
        activeId: activeRef.current,
        typedLen: typedRef.current,
        combo: comboRef.current,
      });

      activeRef.current = r.activeId;
      typedRef.current = r.typedLen;
      setActiveId(r.activeId);
      setTypedLen(r.typedLen);

      switch (r.outcome.type) {
        case "activate":
          sfxClick();
          break;
        case "advance":
          sfxClick();
          break;
        case "arrest": {
          const o = r.outcome;
          comboRef.current = r.combo;
          setCombo(r.combo);
          setMaxCombo((m) => Math.max(m, r.combo));
          setScore((s) => s + o.points);
          setArrested((n) => n + 1);
          const victim = suspectsRef.current.find((s) => s.id === o.suspectId);
          if (victim) {
            pushFloat(victim.x + 40, LANE_Y[victim.lane] + 6, `+${o.points}`, "#ffd34d");
          }
          // 若逮捕的是当前激活词，已在上面重置 active
          if (activeRef.current === o.suspectId) {
            activeRef.current = null;
            typedRef.current = 0;
            setActiveId(null);
            setTypedLen(0);
          }
          suspectsRef.current = suspectsRef.current.filter((s) => s.id !== o.suspectId);
          setSuspects(suspectsRef.current);
          sfxCoin();
          break;
        }
        case "error":
          comboRef.current = 0;
          setCombo(0);
          setWrongPulse((n) => n + 1);
          sfxMismatch();
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [start, pushFloat, i18n]);

  // 当前激活词展示
  const active = activeId !== null ? suspects.find((s) => s.id === activeId) : undefined;

  return (
    <GameFrame
      emoji="🕵️"
      title={i18n.text("game.detective.title")}
      stats={[
        { label: i18n.text("game.detective.score"), value: score, colors: CHIP_GOLD },
        { label: i18n.text("game.detective.arrested"), value: arrested, colors: CHIP_GREEN },
        { label: i18n.text("game.detective.combo"), value: combo > 1 ? `×${combo}` : "—", colors: CHIP_PURPLE },
        { label: i18n.text("game.detective.lives"), value: "❤️".repeat(Math.max(0, lives)) || "💔", colors: CHIP_RED },
      ]}
      headerExtra={
        <GhostBtn onClick={start}>
          <ReloadOutlined />
          {over
            ? i18n.text("game.detective.again")
            : running
              ? i18n.text("game.detective.restart")
              : i18n.text("game.detective.start")}
        </GhostBtn>
      }
      help={i18n.text("game.detective.help")}
      maxWidth={560}
    >
      {/* ── 舞台 ── */}
      <div
        style={{
          position: "relative",
          width: "100%",
          height: STAGE_H,
          borderRadius: 14,
          overflow: "hidden",
          background:
            "linear-gradient(180deg, #1c2745 0%, #131b31 55%, #0d1324 100%)",
          border: "2px solid rgba(90,120,180,0.35)",
          boxShadow: "0 10px 26px rgba(8,14,30,0.45)",
        }}
      >
        {/* 地面 */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 18,
            background: "linear-gradient(180deg, #2a3552 0%, #1c2440 100%)",
          }}
        />

        {/* 逃逸线 */}
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 10,
            background:
              "repeating-linear-gradient(45deg, #ff4d4f 0 8px, #ffd6d6 8px 16px)",
            opacity: 0.9,
            boxShadow: "0 0 12px rgba(255,77,79,0.55)",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: 14,
            top: 6,
            fontSize: 10,
            fontWeight: 700,
            color: "#ff8a80",
            letterSpacing: 1,
          }}
        >
          🚨 {i18n.text("game.detective.escapeLine")}
        </div>

        {/* 嫌犯 */}
        {suspects.map((s) => {
          const isActive = s.id === activeId;
          const typed = isActive ? typedLen : 0;
          return (
            <div
              key={s.id}
              style={{
                position: "absolute",
                left: s.x,
                top: LANE_Y[s.lane],
                width: 96,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 2,
                transition: "none",
                filter: isActive ? "drop-shadow(0 0 8px rgba(255,211,77,0.8))" : "none",
              }}
            >
              {/* 罪名气泡 */}
              <div
                style={{
                  background: isActive ? "#ffd34d" : "rgba(255,255,255,0.94)",
                  color: "#222",
                  borderRadius: 10,
                  padding: "3px 10px",
                  fontSize: 13,
                  fontWeight: 800,
                  lineHeight: 1.2,
                  boxShadow: "0 2px 6px rgba(0,0,0,0.35)",
                  whiteSpace: "nowrap",
                }}
              >
                {s.word}
              </div>
              {/* 脸 */}
              <div style={{ fontSize: 30, lineHeight: 1.1 }}>{s.face}</div>
              {/* 拼音进度 */}
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  fontFamily: "Consolas, monospace",
                }}
              >
                {isActive ? (
                  <>
                    <span style={{ color: "#7ee8a2" }}>{s.pinyin.slice(0, typed)}</span>
                    <span style={{ color: "rgba(255,255,255,0.95)" }}>
                      {s.pinyin.slice(typed)}
                    </span>
                  </>
                ) : (
                  <span style={{ color: "rgba(255,255,255,0.35)" }}>{s.pinyin}</span>
                )}
              </div>
            </div>
          );
        })}

        {/* 飘字 */}
        {floats.map((f) => (
          <div
            key={f.id}
            style={{
              position: "absolute",
              left: f.x,
              top: f.y,
              color: f.color,
              fontSize: 16,
              fontWeight: 900,
              textShadow: "0 2px 6px rgba(0,0,0,0.6)",
              pointerEvents: "none",
            }}
          >
            {f.text}
          </div>
        ))}

        {/* 打错红闪 */}
        {wrongPulse > 0 && (
          <WrongFlash key={wrongPulse} />
        )}

        {/* 当前追捕提示 */}
        {running && active && (
          <div
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 22,
              textAlign: "center",
              color: "rgba(255,255,255,0.85)",
              fontSize: 13,
              fontWeight: 600,
              pointerEvents: "none",
            }}
          >
            {i18n.text("game.detective.chasing")}：{active.word}（
            <span style={{ color: "#7ee8a2" }}>{active.pinyin.slice(0, typedLen)}</span>
            {active.pinyin.slice(typedLen)}）
          </div>
        )}

        {/* 空闲遮罩 */}
        {!running && !over && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(10,16,32,0.72)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              color: "#fff",
              textAlign: "center",
              padding: "0 24px",
            }}
          >
            <div style={{ fontSize: 44 }}>🕵️</div>
            <div style={{ fontSize: 18, fontWeight: 900 }}>
              {i18n.text("game.detective.idleTitle")}
            </div>
            <div style={{ fontSize: 12.5, opacity: 0.85, lineHeight: 1.8, maxWidth: 420 }}>
              {i18n.text("game.detective.idleDesc")}
            </div>
          </div>
        )}

        {/* 结束遮罩 */}
        {over && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(40,14,14,0.78)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              color: "#fff",
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: 40 }}>🚔</div>
            <div style={{ fontSize: 20, fontWeight: 900 }}>
              {i18n.text("game.detective.overTitle")}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>
              {i18n.text("game.detective.overDetail", { score, arrested, maxCombo })}
            </div>
          </div>
        )}
      </div>
    </GameFrame>
  );
};

/** 打错时的红闪（短暂挂载后由 key 重挂载触发动画） */
const WrongFlash: React.FC = () => (
  <div
    className="gs-wrong-flash"
    style={{
      position: "absolute",
      inset: 0,
      background: "rgba(255,60,60,0.22)",
      pointerEvents: "none",
    }}
  />
);

export default DetectiveTyperGame;
