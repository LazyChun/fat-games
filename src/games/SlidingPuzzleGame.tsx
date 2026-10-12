/*
 * SlidingPuzzleGame：数字华容道（新游戏）
 *
 * 3x3 / 4x4 / 5x5 三种难度：点击空格相邻的数字方块，或按方向键 / WASD
 * 滑动空格。洗牌保证局面可解（逻辑见 slidingPuzzleLogic.ts）。
 * 步数越少、用时越短得分越高（score = 难度基数 - 步数*5 - 秒数*2，最低 50），
 * 还原成功即记录成绩。
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ReloadOutlined } from "@ant-design/icons";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import { recordScore } from "../scoreClient";
import { useI18n } from "../hooks";
import GameFrame, { GhostBtn, CHIP_GOLD, CHIP_BLUE, CHIP_GREEN } from "./GameFrame";
import {
  isSolved,
  moveEmpty,
  moveTile,
  movableIndices,
  shuffleBoard,
  type SlideBoard,
  type SlideDir,
} from "./slidingPuzzleLogic";
import { sfxMove, sfxWin } from "./sound";
import { useThemeMode } from "../ThemeShell";
import "./gameAnimations.less";

const SIZES = [3, 4, 5] as const;

/** 难度 → 得分基数（3x3 易 / 4x4 中 / 5x5 难） */
const SCORE_BASE: Record<number, number> = { 3: 1200, 4: 2000, 5: 2800 };

/** 棋盘总宽（px） */
const BOARD_WIDTH = 380;
const GAP = 8;

const DIR_KEYS: Record<string, SlideDir> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  w: "up",
  s: "down",
  a: "left",
  d: "right",
  W: "up",
  S: "down",
  A: "left",
  D: "right",
};

const SlidingPuzzleGame: React.FC<{ sdk: FatNotesPluginSDK }> = () => {
  const i18n = useI18n();
  const isDark = useThemeMode();

  const [size, setSize] = useState<number>(4);
  const [board, setBoard] = useState<SlideBoard>(() => shuffleBoard(4));
  const [moves, setMoves] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [started, setStarted] = useState(false);
  const [won, setWon] = useState(false);
  const recordedRef = useRef(false);

  // 计时：首次移动后开始，还原后停止
  useEffect(() => {
    if (!started || won) return;
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [started, won]);

  /** 重置（可指定新难度） */
  const reset = useCallback(
    (s: number = size) => {
      setBoard(shuffleBoard(s));
      setMoves(0);
      setSeconds(0);
      setStarted(false);
      setWon(false);
      recordedRef.current = false;
    },
    [size],
  );

  /** 切换难度 */
  const changeSize = useCallback(
    (s: number) => {
      if (s === size) return;
      setSize(s);
      reset(s);
    },
    [size, reset],
  );

  /** 执行一次滑动；还原时计分并播胜利音效 */
  const applyMove = useCallback(
    (next: SlideBoard, moved: boolean) => {
      if (!moved || won) return;
      const newMoves = moves + 1;
      setBoard(next);
      setStarted(true);
      setMoves(newMoves);
      sfxMove();
      if (isSolved(next)) {
        if (!recordedRef.current) {
          recordedRef.current = true;
          const score = Math.max(
            50,
            SCORE_BASE[size] - newMoves * 5 - seconds * 2,
          );
          recordScore({
            gameId: "sliding",
            gameTitle: "数字华容道",
            score,
            detail: { size, moves: newMoves, seconds },
          });
        }
        setWon(true);
        sfxWin();
      }
    },
    [moves, seconds, size, won],
  );

  /** 点击数字方块 */
  const clickTile = useCallback(
    (idx: number) => applyMove(moveTile(board, idx), true),
    [board, applyMove],
  );

  // 键盘：方向键 / WASD 滑动空格
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dir = DIR_KEYS[e.key];
      if (!dir) return;
      e.preventDefault();
      const next = moveEmpty(board, dir);
      if (next) applyMove(next, true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [board, applyMove]);

  const cell = (BOARD_WIDTH - (size - 1) * GAP) / size;
  const fontSize = size === 3 ? 30 : size === 4 ? 26 : 21;
  const movableSet = new Set(movableIndices(board));

  const slotBg = isDark
    ? "rgba(255,255,255,0.045)"
    : "rgba(0,0,0,0.05)";
  const tileBg = isDark
    ? "linear-gradient(145deg, #3a4150 0%, #2a2f3a 100%)"
    : "linear-gradient(145deg, #ffffff 0%, #f2efe9 100%)";
  const tileColor = isDark ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.82)";
  const movableGlow = isDark
    ? "0 0 0 2px rgba(102,178,255,0.55), 0 6px 14px rgba(0,0,0,0.4)"
    : "0 0 0 2px rgba(22,119,255,0.5), 0 6px 14px rgba(22,119,255,0.22)";

  return (
    <GameFrame
      emoji="🧩"
      title={i18n.text("game.sliding.title")}
      stats={[
        { label: i18n.text("game.sliding.moves"), value: moves, colors: CHIP_GOLD },
        { label: i18n.text("game.sliding.time"), value: seconds, colors: CHIP_BLUE },
        {
          label: i18n.text("game.sliding.size"),
          value: `${size}×${size}`,
          colors: CHIP_GREEN,
        },
      ]}
      headerExtra={
        <GhostBtn onClick={() => reset()}>
          <ReloadOutlined />
          {i18n.text("game.sliding.restart")}
        </GhostBtn>
      }
      help={i18n.text("game.sliding.help")}
      maxWidth={460}
    >
      {/* 难度切换 */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {SIZES.map((s) => {
          const active = s === size;
          return (
            <button
              key={s}
              type="button"
              onClick={() => changeSize(s)}
              style={{
                padding: "5px 16px",
                borderRadius: 14,
                fontSize: 12,
                fontWeight: 700,
                border: "none",
                cursor: "pointer",
                background: active
                  ? "linear-gradient(135deg, #4facfe 0%, #1677ff 100%)"
                  : isDark
                    ? "rgba(255,255,255,0.08)"
                    : "rgba(0,0,0,0.06)",
                color: active
                  ? "#fff"
                  : isDark
                    ? "rgba(255,255,255,0.75)"
                    : "rgba(0,0,0,0.6)",
                boxShadow: active ? "0 3px 8px rgba(22,119,255,0.3)" : "none",
                transition: "all 0.15s ease",
              }}
            >
              {s}×{s}
            </button>
          );
        })}
      </div>

      {/* 棋盘 */}
      <div
        className={won ? "" : "gs-stage-in"}
        style={{
          position: "relative",
          width: BOARD_WIDTH,
          height: BOARD_WIDTH,
          borderRadius: 16,
          background: isDark
            ? "rgba(255,255,255,0.03)"
            : "rgba(0,0,0,0.035)",
          boxShadow: isDark
            ? "inset 0 1px 0 rgba(255,255,255,0.08)"
            : "inset 0 1px 0 rgba(255,255,255,0.7)",
        }}
      >
        {board.tiles.map((t, idx) => {
          const r = Math.floor(idx / size);
          const c = idx % size;
          const x = c * (cell + GAP);
          const y = r * (cell + GAP);
          const pos = {
            position: "absolute" as const,
            left: 0,
            top: 0,
            width: cell,
            height: cell,
            transform: `translate(${x}px, ${y}px)`,
          };
          if (t === 0) {
            // 空格凹槽
            return (
              <div
                key={`slot-${idx}`}
                style={{
                  ...pos,
                  borderRadius: 12,
                  background: slotBg,
                  boxShadow: isDark
                    ? "inset 0 1px 3px rgba(0,0,0,0.5)"
                    : "inset 0 1px 3px rgba(0,0,0,0.12)",
                }}
              />
            );
          }
          const movable = movableSet.has(idx);
          return (
            <button
              key={`tile-${t}`}
              type="button"
              onClick={() => clickTile(idx)}
              disabled={won}
              style={{
                ...pos,
                borderRadius: 12,
                background: tileBg,
                color: tileColor,
                fontSize,
                fontWeight: 700,
                border: "none",
                padding: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                userSelect: "none",
                cursor: movable && !won ? "pointer" : "default",
                boxShadow: movable && !won ? movableGlow : "0 4px 10px rgba(0,0,0,0.12)",
                transition:
                  "transform 0.16s cubic-bezier(0.3, 0.9, 0.4, 1), box-shadow 0.15s ease",
              }}
            >
              {t}
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
            <b>{i18n.text("game.sliding.win")}</b> ·{" "}
            {i18n.text("game.sliding.winDetail", {
              moves,
              seconds,
            })}
          </div>
          <GhostBtn onClick={() => reset()}>
            <ReloadOutlined />
            {i18n.text("game.sliding.again")}
          </GhostBtn>
        </div>
      )}
    </GameFrame>
  );
};

export default SlidingPuzzleGame;
