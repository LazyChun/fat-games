/*
 * MemoryGame：记忆翻牌（新游戏）
 *
 * 4x4 共 8 对 emoji，点击翻牌配对：翻开两张相同则保持，不同则 1 秒后
 * 翻回。步数越少、用时越短得分越高（score = 1000 - 步数*8 - 秒数*3，
 * 最低 50）。全部配对即胜利并记录成绩。
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ReloadOutlined } from "@ant-design/icons";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import { recordScore } from "../scoreClient";
import { useI18n } from "../hooks";
import GameFrame, { GhostBtn, CHIP_GOLD, CHIP_BLUE, CHIP_GREEN } from "./GameFrame";
import { useThemeMode } from "../ThemeShell";
import "./gameAnimations.less";

const EMOJIS = ["🍎", "🍌", "🍇", "🍓", "🍑", "🥕", "🌽", "🍄"];

interface Card {
  id: number;
  emoji: string;
}

/** 洗牌生成 16 张卡 */
function shuffledCards(): Card[] {
  const deck = [...EMOJIS, ...EMOJIS].map((emoji, i) => ({ id: i, emoji }));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

const FLIP_BACK_MS = 900;

const MemoryGame: React.FC<{ sdk: FatNotesPluginSDK }> = () => {
  const i18n = useI18n();
  const isDark = useThemeMode();

  const [cards, setCards] = useState<Card[]>(shuffledCards);
  const [flipped, setFlipped] = useState<number[]>([]); // 当前翻开的下标
  const [matched, setMatched] = useState<Set<number>>(new Set());
  const [moves, setMoves] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [started, setStarted] = useState(false);
  const [won, setWon] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const lockRef = useRef(false);

  // 计时
  useEffect(() => {
    if (!started || won) return;
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [started, won]);

  // 胜利判定与成绩
  useEffect(() => {
    if (matched.size === cards.length && cards.length > 0) {
      setWon(true);
      if (!recorded) {
        setRecorded(true);
        const s = Math.max(50, 1000 - moves * 8 - seconds * 3);
        recordScore({
          gameId: "memory",
          gameTitle: "记忆翻牌",
          score: s,
          detail: { moves, seconds },
        });
      }
    }
  }, [matched, cards, moves, seconds, won, recorded]);

  /** 点击翻牌 */
  const flip = useCallback(
    (idx: number) => {
      if (lockRef.current) return;
      if (won) return;
      if (flipped.includes(idx) || matched.has(idx)) return;

      setStarted(true);
      const nextFlipped = [...flipped, idx];
      setFlipped(nextFlipped);
      if (nextFlipped.length === 2) {
        setMoves((m) => m + 1);
        const [a, b] = nextFlipped;
        if (cards[a].emoji === cards[b].emoji) {
          // 配对成功
          setMatched((prev) => {
            const next = new Set(prev);
            next.add(a);
            next.add(b);
            return next;
          });
          setFlipped([]);
        } else {
          // 配对失败，稍后翻回
          lockRef.current = true;
          window.setTimeout(() => {
            setFlipped([]);
            lockRef.current = false;
          }, FLIP_BACK_MS);
        }
      }
    },
    [flipped, matched, cards, won],
  );

  /** 重启 */
  const restart = useCallback(() => {
    setCards(shuffledCards());
    setFlipped([]);
    setMatched(new Set());
    setMoves(0);
    setSeconds(0);
    setStarted(false);
    setWon(false);
    setRecorded(false);
    lockRef.current = false;
  }, []);

  const cardBack = isDark
    ? "linear-gradient(145deg, #3d6fe0 0%, #2b4fc0 100%)"
    : "linear-gradient(145deg, #6aa5ff 0%, #3f7df0 100%)";

  return (
    <GameFrame
      emoji="🃏"
      title={i18n.text("game.memory.title")}
      stats={[
        { label: i18n.text("game.memory.moves"), value: moves, colors: CHIP_GOLD },
        { label: i18n.text("game.memory.time"), value: seconds, colors: CHIP_BLUE },
        {
          label: i18n.text("game.memory.pairs"),
          value: `${matched.size / 2}/${EMOJIS.length}`,
          colors: CHIP_GREEN,
        },
      ]}
      headerExtra={
        <GhostBtn onClick={restart}>
          <ReloadOutlined />
          {i18n.text("game.memory.restart")}
        </GhostBtn>
      }
      help={i18n.text("game.memory.help")}
      maxWidth={480}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 92px)",
          gap: 12,
        }}
      >
        {cards.map((card, idx) => {
          const isFlipped = flipped.includes(idx) || matched.has(idx);
          const isMatched = matched.has(idx);
          return (
            <button
              key={card.id}
              type="button"
              onClick={() => flip(idx)}
              disabled={isMatched || won}
              style={{
                width: 92,
                height: 92,
                padding: 0,
                border: "none",
                background: "transparent",
                cursor: isFlipped ? "default" : "pointer",
                perspective: 600,
              }}
            >
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  position: "relative",
                  transformStyle: "preserve-3d",
                  transition: "transform 0.35s cubic-bezier(0.34, 1.3, 0.64, 1)",
                  transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
                }}
              >
                {/* 背面（未翻开） */}
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: 12,
                    background: cardBack,
                    boxShadow: "0 4px 12px rgba(40,80,180,0.35)",
                    backfaceVisibility: "hidden",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "rgba(255,255,255,0.85)",
                    fontSize: 26,
                    border: "2px solid rgba(255,255,255,0.35)",
                  }}
                >
                  ✦
                </div>
                {/* 正面（翻开） */}
                <div
                  className={isMatched ? "gs-win-in" : "gs-flip-in"}
                  style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: 12,
                    background: isDark
                      ? "linear-gradient(145deg, #f3f0e8 0%, #e6e0d2 100%)"
                      : "linear-gradient(145deg, #fffdf7 0%, #f3eee2 100%)",
                    boxShadow: isMatched
                      ? "0 0 0 3px rgba(90,200,120,0.65), 0 6px 16px rgba(60,140,80,0.3)"
                      : "0 4px 14px rgba(0,0,0,0.14)",
                    backfaceVisibility: "hidden",
                    transform: "rotateY(180deg)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 40,
                    userSelect: "none",
                  }}
                >
                  {card.emoji}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {won && (
        <div
          className="gs-win-in"
          style={{
            marginTop: 14,
            padding: "12px 22px",
            borderRadius: 14,
            background: isDark
              ? "rgba(60,140,80,0.25)"
              : "rgba(90,200,120,0.18)",
            border: `1px solid ${isDark ? "rgba(90,200,120,0.5)" : "rgba(60,150,90,0.4)"}`,
            display: "flex",
            alignItems: "center",
            gap: 14,
            color: isDark ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.8)",
          }}
        >
          <span style={{ fontSize: 26 }}>🎉</span>
          <div style={{ fontSize: 14 }}>
            <b>{i18n.text("game.memory.win")}</b> ·{" "}
            {i18n.text("game.memory.moves")} {moves} ·{" "}
            {i18n.text("game.memory.time")} {seconds}s
          </div>
          <GhostBtn onClick={restart}>
            <ReloadOutlined />
            {i18n.text("game.memory.again")}
          </GhostBtn>
        </div>
      )}
    </GameFrame>
  );
};

export default MemoryGame;
