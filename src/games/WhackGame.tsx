/*
 * WhackGame：打地鼠（新游戏）
 *
 * 3x3 地洞，地鼠随机冒出（出现时间随进度变短），点击击打 +10 分；
 * 30 秒一局，结束后记录成绩（得分 = 击中次数 × 10）。
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ReloadOutlined } from "@ant-design/icons";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import { recordScore } from "../scoreClient";
import { useI18n } from "../hooks";
import GameFrame, { GhostBtn, CHIP_GOLD, CHIP_RED, CHIP_GREEN } from "./GameFrame";
import "./gameAnimations.less";

const HOLES = 9;
const ROUND_SECONDS = 30;

const WhackGame: React.FC<{ sdk: FatNotesPluginSDK }> = () => {
  const i18n = useI18n();
  const [active, setActive] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [hits, setHits] = useState(0);
  const [timeLeft, setTimeLeft] = useState(ROUND_SECONDS);
  const [running, setRunning] = useState(false);
  const [over, setOver] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const spawnRef = useRef<number | null>(null);
  const vanishRef = useRef<number | null>(null);
  const timeRef = useRef(timeLeft);
  timeRef.current = timeLeft;

  const clearTimers = useCallback(() => {
    if (spawnRef.current !== null) {
      window.clearTimeout(spawnRef.current);
      spawnRef.current = null;
    }
    if (vanishRef.current !== null) {
      window.clearTimeout(vanishRef.current);
      vanishRef.current = null;
    }
  }, []);

  /** 让当前地鼠消失并安排下一只 */
  const nextMole = useCallback(
    (remaining: number) => {
      const vanish = 900 - Math.max(0, ROUND_SECONDS - remaining) * 18; // 越到后面越快
      vanishRef.current = window.setTimeout(() => {
        setActive(null);
        if (timeRef.current > 0) {
          spawnRef.current = window.setTimeout(
            () => spawnMole(remaining - 1),
            350 + Math.random() * 450,
          );
        }
      }, Math.max(320, vanish));
    },
    [],
  );

  function spawnMole(remaining: number): void {
    if (timeRef.current <= 0) return;
    const hole = Math.floor(Math.random() * HOLES);
    setActive(hole);
    nextMole(remaining);
  }

  /** 开始一局 */
  const start = useCallback(() => {
    setScore(0);
    setHits(0);
    setTimeLeft(ROUND_SECONDS);
    setOver(false);
    setRecorded(false);
    setRunning(true);
    clearTimers();
    spawnRef.current = window.setTimeout(() => spawnMole(ROUND_SECONDS), 600);
  }, [clearTimers]);

  // 倒计时
  useEffect(() => {
    if (!running || over) return;
    const id = window.setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          setRunning(false);
          setOver(true);
          setActive(null);
          clearTimers();
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [running, over, clearTimers]);

  // 结束记录成绩
  useEffect(() => {
    if (over && !recorded) {
      setRecorded(true);
      recordScore({
        gameId: "whack",
        gameTitle: "打地鼠",
        score: hits * 10,
        detail: { hits },
      });
    }
  }, [over, recorded, hits]);

  // 卸载清理
  useEffect(() => clearTimers, [clearTimers]);

  /** 击打 */
  const whack = useCallback(
    (hole: number) => {
      if (!running || over) return;
      if (hole !== active) return;
      // 取消本只地鼠的“消失”定时，避免残留再生成
      if (vanishRef.current !== null) {
        window.clearTimeout(vanishRef.current);
        vanishRef.current = null;
      }
      setActive(null);
      setHits((h) => h + 1);
      setScore((s) => s + 10);
      // 打中后更快出下一只
      if (timeRef.current > 0) {
        spawnRef.current = window.setTimeout(
          () => spawnMole(timeRef.current - 1),
          200 + Math.random() * 300,
        );
      }
    },
    [running, over, active],
  );

  const fmtTime = `${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, "0")}`;

  return (
    <GameFrame
      emoji="🐹"
      title={i18n.text("game.whack.title")}
      stats={[
        { label: i18n.text("game.whack.score"), value: score, colors: CHIP_GOLD },
        { label: i18n.text("game.whack.hits"), value: hits, colors: CHIP_GREEN },
        { label: i18n.text("game.whack.time"), value: fmtTime, colors: CHIP_RED },
      ]}
      headerExtra={
        <GhostBtn onClick={start}>
          <ReloadOutlined />
          {over
            ? i18n.text("game.whack.again")
            : running
              ? i18n.text("game.whack.restart")
              : i18n.text("game.whack.start")}
        </GhostBtn>
      }
      help={i18n.text("game.whack.help")}
      maxWidth={440}
    >
      <div
        style={{
          background:
            "linear-gradient(180deg, #7ec850 0%, #5aa93c 100%)",
          borderRadius: 16,
          padding: "18px 16px 20px",
          boxShadow: "0 8px 24px rgba(60,130,60,0.3)",
          position: "relative",
          border: "3px solid rgba(120,90,40,0.35)",
        }}
      >
        {!running && !over && (
          <div
            className="gs-pulse"
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 14,
              background: "rgba(60,130,60,0.45)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 16,
              fontWeight: 700,
              zIndex: 3,
              pointerEvents: "none",
            }}
          >
            {i18n.text("game.whack.idle")}
          </div>
        )}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 108px)",
            gap: 14,
            position: "relative",
            zIndex: 1,
          }}
        >
          {Array.from({ length: HOLES }, (_, i) => {
            const isMole = active === i;
            return (
              <div
                key={i}
                style={{
                  width: 108,
                  height: 108,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  position: "relative",
                }}
              >
                {/* 地鼠（冒出） */}
                {isMole && (
                  <button
                    type="button"
                    className="gs-mole-up"
                    onClick={() => whack(i)}
                    style={{
                      position: "absolute",
                      top: 4,
                      width: 84,
                      height: 84,
                      border: "none",
                      background:
                        "radial-gradient(circle at 35% 30%, #f6c98b 0%, #d99a5b 60%, #b9793c 100%)",
                      borderRadius: "50% 50% 42% 42%",
                      cursor: "pointer",
                      boxShadow:
                        "0 6px 12px rgba(0,0,0,0.3), inset 0 -6px 10px rgba(0,0,0,0.18)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 44,
                      zIndex: 2,
                      transform: "translateY(4px)",
                    }}
                  >
                    🐹
                  </button>
                )}
                {/* 地洞 */}
                <div
                  style={{
                    position: "absolute",
                    bottom: 2,
                    width: 104,
                    height: 34,
                    background:
                      "radial-gradient(ellipse at center, #3a2c1c 0%, #241a10 75%)",
                    borderRadius: "50%",
                    boxShadow:
                      "inset 0 6px 10px rgba(0,0,0,0.6), 0 2px 0 rgba(255,255,255,0.25)",
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    </GameFrame>
  );
};

export default WhackGame;
