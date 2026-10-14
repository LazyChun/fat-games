/*
 * MatchGame：快乐消消（三消，新游戏）
 *
 * 8x8 糖果棋盘，6 种方块：
 *   - 点击选中方块，再点击相邻方块交换；横向/纵向凑齐 3 个及以上同色即消除
 *   - 消除后上方方块下落、顶部补新块，级联消除连击分数翻倍
 *   - 无步可走时自动洗牌（逻辑见 matchLogic.ts）
 *   - 限时 60 秒，时间到按总分记录成绩
 * 动画管线：交换/下落用 CSS transform 过渡（方块实例带稳定 id 复用 DOM），
 * 消除先放大淡出，新块从棋盘上方落入。
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { BulbOutlined, ReloadOutlined } from "@ant-design/icons";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import { recordScore } from "../scoreClient";
import { useI18n } from "../hooks";
import GameFrame, { GhostBtn, CHIP_BLUE, CHIP_GOLD, CHIP_GREEN, CHIP_RED } from "./GameFrame";
import {
  createBoard,
  findHintMove,
  findRuns,
  hasAnyMove,
  isAdjacent,
  scoreForRuns,
  shuffleBoard,
  type MatchBoard,
  type MatchRun,
} from "./matchLogic";
import { sfxClear, sfxClick, sfxLose, sfxMismatch, sfxMove, sfxRefuel } from "./sound";
import { useThemeMode } from "../ThemeShell";
import "./gameAnimations.less";

const ROWS = 8;
const COLS = 8;
const KINDS = 6;
const GAME_TIME = 60;
const BEST_KEY = "fat-games.match.best";

const BOARD_WIDTH = 380;
const GAP = 4;
const CELL = (BOARD_WIDTH - (COLS - 1) * GAP) / COLS; // 44

/** 每种方块的视觉：主体渐变 + 光晕 */
const KIND_STYLE: { bg: string; glow: string }[] = [
  { bg: "linear-gradient(145deg,#ff8a80 0%,#e53935 100%)", glow: "rgba(229,57,53,0.5)" },
  { bg: "linear-gradient(145deg,#ffcc80 0%,#fb8c00 100%)", glow: "rgba(251,140,0,0.5)" },
  { bg: "linear-gradient(145deg,#fff176 0%,#fdd835 100%)", glow: "rgba(253,216,53,0.55)" },
  { bg: "linear-gradient(145deg,#a5d6a7 0%,#43a047 100%)", glow: "rgba(67,160,71,0.5)" },
  { bg: "linear-gradient(145deg,#90caf9 0%,#1e88e5 100%)", glow: "rgba(30,136,229,0.5)" },
  { bg: "linear-gradient(145deg,#ce93d8 0%,#8e24aa 100%)", glow: "rgba(142,36,170,0.5)" },
];

/** 棋盘上的一块方块实例（id 稳定，供 React 复用 DOM 做位移动画） */
interface TileInst {
  id: number;
  kind: number;
  r: number;
  c: number;
  dying?: boolean;
  /** 新块生成位到落点的下落行数（仅新块使用） */
  fall?: number;
}

const delay = (ms: number) => new Promise<void>((res) => setTimeout(res, ms));

/** 棋盘实例 → 纯逻辑棋盘（用于匹配/可走性判定） */
function tilesToBoard(tiles: TileInst[]): MatchBoard {
  const cells = new Array<number>(ROWS * COLS).fill(0);
  for (const t of tiles) {
    if (t.r >= 0 && t.r < ROWS && t.c >= 0 && t.c < COLS) {
      cells[t.r * COLS + t.c] = t.kind;
    }
  }
  return { rows: ROWS, cols: COLS, kinds: KINDS, cells };
}

/** 纯逻辑棋盘 → 棋盘实例（全部新 id） */
function boardToTiles(board: MatchBoard, nextId: () => number): TileInst[] {
  const tiles: TileInst[] = [];
  for (let i = 0; i < board.cells.length; i++) {
    tiles.push({ id: nextId(), kind: board.cells[i], r: Math.floor(i / COLS), c: i % COLS });
  }
  return tiles;
}

/** 按位置找实例 */
function posToId(tiles: TileInst[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const t of tiles) m.set(t.r * COLS + t.c, t.id);
  return m;
}

const MatchGame: React.FC<{ sdk: FatNotesPluginSDK }> = () => {
  const i18n = useI18n();
  const isDark = useThemeMode();

  const idRef = useRef(0);
  const nextId = useCallback(() => ++idRef.current, []);

  const [tiles, setTilesState] = useState<TileInst[]>(() =>
    boardToTiles(createBoard(ROWS, COLS, KINDS), nextId),
  );
  const tilesRef = useRef<TileInst[]>(tiles);
  const setTiles = useCallback((next: TileInst[]) => {
    tilesRef.current = next;
    setTilesState(next);
  }, []);

  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  /** 会话号：重开时 +1，用于取消仍在进行的异步消除动画 */
  const sessionRef = useRef(0);

  const [selected, setSelected] = useState<number | null>(null);
  const [hint, setHint] = useState<[number, number] | null>(null);
  const [score, setScore] = useState(0);
  const scoreRef = useRef(0);
  const [best, setBest] = useState<number>(() => {
    try {
      return Number(window.localStorage.getItem(BEST_KEY) || 0);
    } catch {
      return 0;
    }
  });
  const [combo, setCombo] = useState(0);
  const [timeLeft, setTimeLeft] = useState(GAME_TIME);
  const [started, setStarted] = useState(false);
  const [over, setOver] = useState(false);
  const movesRef = useRef(0);
  const clearedRef = useRef(0);
  const bestComboRef = useRef(0);
  const hintTimerRef = useRef<number | null>(null);

  /** 计时：开始后每秒 -1，归零结束 */
  useEffect(() => {
    if (!started || over) return;
    const id = window.setInterval(() => setTimeLeft((t) => t - 1), 1000);
    return () => window.clearInterval(id);
  }, [started, over]);

  /** 结束：记录成绩 + 更新最佳 */
  const endGame = useCallback(() => {
    setOver(true);
    setSelected(null);
    sfxLose();
    const finalScore = scoreRef.current;
    if (finalScore > 0) {
      recordScore({
        gameId: "match",
        gameTitle: "快乐消消",
        score: finalScore,
        detail: {
          moves: movesRef.current,
          cleared: clearedRef.current,
          bestCombo: bestComboRef.current,
        },
      });
    }
    setBest((prev) => {
      const nb = Math.max(prev, finalScore);
      try {
        window.localStorage.setItem(BEST_KEY, String(nb));
      } catch {
        /* ignore */
      }
      return nb;
    });
  }, []);

  useEffect(() => {
    if (started && !over && timeLeft <= 0) endGame();
  }, [timeLeft, started, over, endGame]);

  /** 级联消除：消除 → 下落 → 补块 → 再查，直到无匹配 */
  const runCascade = useCallback(
    async (initial: TileInst[]) => {
      const my = sessionRef.current;
      let current = initial;
      let cascade = 0;
      for (;;) {
        if (my !== sessionRef.current) return;
        const runs = findRuns(tilesToBoard(current));
        if (runs.length === 0) break;
        cascade++;
        setCombo(cascade);
        if (cascade > bestComboRef.current) bestComboRef.current = cascade;

        const byPos = posToId(current);
        const dyingIds = new Set<number>();
        for (const run of runs) {
          for (const i of run.indices) dyingIds.add(byPos.get(i)!);
        }
        const gain = scoreForRuns(runs, cascade);
        scoreRef.current += gain;
        setScore(scoreRef.current);
        clearedRef.current += dyingIds.size;

        // 消除动画
        setTiles(
          current.map((t) => (dyingIds.has(t.id) ? { ...t, dying: true } : t)),
        );
        sfxClear();
        await delay(300);
        if (my !== sessionRef.current) return;

        // 下落 + 顶部补块：先摆到生成位，再过渡到落点（下落动画）
        const next: TileInst[] = [];
        for (let c = 0; c < COLS; c++) {
          const col = current
            .filter((t) => t.c === c && !dyingIds.has(t.id))
            .sort((a, b) => a.r - b.r);
          let row = ROWS - 1;
          const placed: TileInst[] = [];
          for (let k = col.length - 1; k >= 0; k--) {
            placed.push({ ...col[k], r: row });
            row--;
          }
          const missing = row + 1;
          const spawnOnes: TileInst[] = [];
          for (let k = 0; k < missing; k++) {
            spawnOnes.push({
              id: nextId(),
              kind: Math.floor(Math.random() * KINDS),
              r: -(missing - k),
              c,
              fall: missing,
            });
          }
          next.push(...placed, ...spawnOnes);
        }
        // 第一阶段：幸存者瞬移新行 + 新块出现在棋盘上方
        setTiles(next);
        await delay(30);
        if (my !== sessionRef.current) return;
        // 第二阶段：新块下落 fall 行到落点
        setTiles(next.map((t) => (t.r < 0 ? { ...t, r: t.r + (t.fall ?? 0) } : t)));
        await delay(220);
        if (my !== sessionRef.current) return;

        current = next.map((t) => (t.r < 0 ? { ...t, r: t.r + (t.fall ?? 0) } : t));
      }

      setCombo(0);
      // 无步可走时自动洗牌
      const b = tilesToBoard(current);
      if (!hasAnyMove(b)) {
        const nb = shuffleBoard(b);
        setTiles(boardToTiles(nb, nextId));
        sfxRefuel();
      }
      busyRef.current = false;
      setBusy(false);
    },
    [nextId, setTiles],
  );

  /** 执行一次交换（含换回与级联） */
  const doSwap = useCallback(
    async (a: TileInst, b: TileInst) => {
      const my = sessionRef.current;
      busyRef.current = true;
      setBusy(true);
      setSelected(null);
      setHint(null);
      const swapped = tilesRef.current.map((t) => {
        if (t.id === a.id) return { ...t, r: b.r, c: b.c };
        if (t.id === b.id) return { ...t, r: a.r, c: a.c };
        return t;
      });
      setTiles(swapped);
      sfxMove();
      await delay(190);
      if (my !== sessionRef.current) return;

      if (findRuns(tilesToBoard(swapped)).length > 0) {
        movesRef.current += 1;
        await runCascade(swapped);
      } else {
        // 无匹配：换回去
        setTiles(
          swapped.map((t) => {
            if (t.id === a.id) return { ...t, r: a.r, c: a.c };
            if (t.id === b.id) return { ...t, r: b.r, c: b.c };
            return t;
          }),
        );
        sfxMismatch();
        await delay(190);
        if (my !== sessionRef.current) return;
        busyRef.current = false;
        setBusy(false);
      }
    },
    [runCascade, setTiles],
  );

  /** 点击方块：选中 / 交换 */
  const onTileClick = useCallback(
    (id: number) => {
      if (busyRef.current || !started || over) return;
      if (selected === null) {
        sfxClick();
        setSelected(id);
        return;
      }
      if (selected === id) {
        setSelected(null);
        return;
      }
      const a = tilesRef.current.find((t) => t.id === selected);
      const b = tilesRef.current.find((t) => t.id === id);
      if (!a || !b) return;
      if (!isAdjacent(tilesToBoard(tilesRef.current), a.r * COLS + a.c, b.r * COLS + b.c)) {
        sfxClick();
        setSelected(id);
        return;
      }
      void doSwap(a, b);
    },
    [selected, started, over, doSwap],
  );

  /** 提示：高亮一步可消除的交换 */
  const onHint = useCallback(() => {
    if (busyRef.current || !started || over) return;
    const mv = findHintMove(tilesToBoard(tilesRef.current));
    if (!mv) return;
    const byPos = posToId(tilesRef.current);
    const pair: [number, number] = [byPos.get(mv[0])!, byPos.get(mv[1])!];
    setHint(pair);
    if (hintTimerRef.current) window.clearTimeout(hintTimerRef.current);
    hintTimerRef.current = window.setTimeout(() => setHint(null), 1400);
  }, [started, over]);

  /** 重新开始 */
  const restart = useCallback(
    (autoStart: boolean) => {
      sessionRef.current += 1;
      if (hintTimerRef.current) window.clearTimeout(hintTimerRef.current);
      setHint(null);
      setSelected(null);
      setScore(0);
      scoreRef.current = 0;
      setCombo(0);
      setOver(false);
      movesRef.current = 0;
      clearedRef.current = 0;
      bestComboRef.current = 0;
      busyRef.current = false;
      setBusy(false);
      setTiles(boardToTiles(createBoard(ROWS, COLS, KINDS), nextId));
      setTimeLeft(GAME_TIME);
      setStarted(autoStart);
    },
    [nextId, setTiles],
  );

  const byPos = posToId(tiles);
  const posStyle = (t: TileInst): React.CSSProperties => ({
    position: "absolute",
    left: 0,
    top: 0,
    width: CELL,
    height: CELL,
    transform: `translate(${t.c * (CELL + GAP)}px, ${t.r * (CELL + GAP)}px)`,
  });

  const boardBg = isDark ? "rgba(255,255,255,0.03)" : "rgba(0,0,0,0.035)";
  const overlayBg = isDark ? "rgba(18,20,26,0.78)" : "rgba(250,248,243,0.82)";
  const overlayText = isDark ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.82)";
  const timeColor = timeLeft <= 10 && started && !over ? "#ff5a4d" : undefined;

  return (
    <GameFrame
      emoji="🍬"
      title={i18n.text("game.match.title")}
      stats={[
        { label: i18n.text("game.match.score"), value: score, colors: CHIP_GOLD },
        { label: i18n.text("game.match.best"), value: best, colors: CHIP_GREEN },
        {
          label: i18n.text("game.match.time"),
          value: timeLeft,
          colors: CHIP_BLUE,
        },
        { label: i18n.text("game.match.combo"), value: `×${Math.max(1, combo)}`, colors: CHIP_RED },
      ]}
      headerExtra={
        <>
          <GhostBtn onClick={onHint} disabled={!started || over}>
            <BulbOutlined />
            {i18n.text("game.match.hint")}
          </GhostBtn>
          <GhostBtn onClick={() => restart(false)}>
            <ReloadOutlined />
            {i18n.text("game.match.restart")}
          </GhostBtn>
        </>
      }
      help={i18n.text("game.match.help")}
      maxWidth={480}
    >
      <div
        style={{
          position: "relative",
          width: BOARD_WIDTH,
          height: BOARD_WIDTH,
          borderRadius: 16,
          background: boardBg,
          boxShadow: isDark
            ? "inset 0 1px 0 rgba(255,255,255,0.08)"
            : "inset 0 1px 0 rgba(255,255,255,0.7)",
        }}
      >
        {tiles.map((t) => {
          const k = KIND_STYLE[t.kind % KINDS];
          const isSelected = selected === t.id;
          const isHint = hint !== null && (hint[0] === t.id || hint[1] === t.id);
          const base: React.CSSProperties = {
            ...posStyle(t),
            borderRadius: 12,
            background: k.bg,
            cursor: "pointer",
            userSelect: "none",
            transition:
              "transform 0.2s cubic-bezier(0.3,0.9,0.4,1), opacity 0.24s ease, box-shadow 0.15s ease",
          };
          if (t.dying) {
            base.transform = `${base.transform} scale(0.15)`;
            base.opacity = 0.1;
          }
          if (isHint) {
            base.boxShadow = `0 0 0 3px ${isDark ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.95)"}, 0 0 18px 4px ${k.glow}`;
          } else if (isSelected) {
            base.boxShadow = `0 0 0 3px ${isDark ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.35)"}, 0 0 16px 3px ${k.glow}`;
          } else {
            base.boxShadow = `0 3px 8px rgba(0,0,0,0.22), inset 0 2px 4px rgba(255,255,255,0.4), inset 0 -3px 6px rgba(0,0,0,0.16)`;
          }
          return <div key={t.id} style={base} onClick={() => onTileClick(t.id)} />;
        })}

        {/* 开始 / 结束 遮罩 */}
        {(!started || over) && (
          <div
            className={over ? "gs-win-in" : "gs-stage-in"}
            style={{
              position: "absolute",
              inset: 0,
              borderRadius: 16,
              background: overlayBg,
              backdropFilter: "blur(2px)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              textAlign: "center",
              padding: 20,
              color: overlayText,
              zIndex: 5,
            }}
          >
            {over ? (
              <>
                <div style={{ fontSize: 30, fontWeight: 900 }}>🎉</div>
                <div style={{ fontSize: 22, fontWeight: 800 }}>{i18n.text("game.match.over.title")}</div>
                <div style={{ fontSize: 16, opacity: 0.85 }}>
                  {i18n.text("game.match.over.score", { score })} ·{" "}
                  {i18n.text("game.match.over.best", { best })}
                </div>
                <GhostBtn onClick={() => restart(true)}>
                  {i18n.text("game.match.again")}
                </GhostBtn>
              </>
            ) : (
              <>
                <div style={{ fontSize: 26, fontWeight: 900 }}>{i18n.text("game.match.idleTitle")}</div>
                <div style={{ fontSize: 14, opacity: 0.8, maxWidth: 300 }}>
                  {i18n.text("game.match.idleDesc")}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    sfxClick();
                    setStarted(true);
                    setTimeLeft(GAME_TIME);
                  }}
                  style={{
                    marginTop: 6,
                    border: "none",
                    background: "linear-gradient(135deg,#4facfe 0%,#1677ff 100%)",
                    color: "#fff",
                    borderRadius: 20,
                    padding: "9px 26px",
                    fontSize: 15,
                    fontWeight: 700,
                    cursor: "pointer",
                    boxShadow: "0 3px 10px rgba(22,119,255,0.28)",
                  }}
                >
                  {i18n.text("game.match.start")}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </GameFrame>
  );
};

export default MatchGame;
