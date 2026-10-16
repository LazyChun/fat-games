/*
 * detectiveLogic.ts — 逍遥警探（打字缉凶）纯逻辑
 *
 * 玩法：警局通缉令上的嫌犯举着罪名标签从右侧潜逃，向左移动；
 * 玩家直接敲键盘字母，拼出罪名的全拼即可当场逮捕。
 * 嫌犯溜过左侧「逃逸线」扣 1 条命，3 条命耗尽游戏结束。
 *
 * 本文件只放不依赖 DOM / React 的纯函数与常量，便于单测。
 */
import { pinyin } from "pinyin-pro";

/* ------------------------------------------------------------------ */
/* 舞台常量                                                            */
/* ------------------------------------------------------------------ */

/** 舞台逻辑宽高（px，与组件内舞台容器一致） */
export const STAGE_W = 520;
export const STAGE_H = 340;

/** 逃逸线 x：嫌犯中心到达此线即视为逃逸 */
export const ESCAPE_X = 16;

/** 横向跑道数与各道顶部 y */
export const LANES = 3;
export const LANE_Y = [52, 146, 240];

/** 初始生命 */
export const START_LIVES = 3;

/** 场上同时存在的嫌犯上限 */
export const MAX_SUSPECTS = 4;

/** 嫌犯表情池 */
export const SUSPECT_FACES = ["🥷", "👺", "🕴️", "🧑‍🦯", "👤", "🕵️"];

/* ------------------------------------------------------------------ */
/* 词库（刑侦主题罪名/线索词，两字为主，少量三字）                        */
/* ------------------------------------------------------------------ */

export const WORD_POOL: string[] = [
  // 两字词
  "警察", "侦探", "凶手", "盗窃", "诈骗", "抢劫",
  "指纹", "证据", "线索", "手铐", "监狱", "法庭",
  "证人", "目击", "追捕", "逃犯", "罪犯", "脚印",
  "监控", "审讯", "卧底", "通缉", "赃款", "凶器",
  "走私", "贩毒", "越狱", "绑架", "勒索", "伪造",
  "间谍", "笔录", "警笛", "警车", "警徽", "鉴定",
  "取证", "蹲守", "伏击", "线人", "黑帮", "赃物",
  "销赃", "入室", "动机", "作案", "逮捕", "拘留",
  "悬案", "结案", "串供", "翻供",
  // 三字词
  "嫌疑人", "被害人", "保险箱", "通缉令", "逮捕令",
  "连环案", "不在场", "监控头",
];

/* ------------------------------------------------------------------ */
/* 拼音（带缓存）                                                       */
/* ------------------------------------------------------------------ */

const pinyinCache = new Map<string, string>();

/** 取词语全拼（无调、小写、无空格），如 "警察" -> "jingcha" */
export function wordPinyin(word: string): string {
  const hit = pinyinCache.get(word);
  if (hit) return hit;
  let py = "";
  try {
    py = pinyin(word, { toneType: "none", type: "string" })
      .replace(/\s+/g, "")
      .toLowerCase();
  } catch {
    py = "";
  }
  pinyinCache.set(word, py);
  return py;
}

/* ------------------------------------------------------------------ */
/* 嫌犯实体                                                            */
/* ------------------------------------------------------------------ */

export interface Suspect {
  id: number;
  /** 罪名（中文展示） */
  word: string;
  /** 全拼无调 */
  pinyin: string;
  /** 表情 */
  face: string;
  /** 当前 x（舞台坐标，px） */
  x: number;
  /** 跑道下标 0..LANES-1 */
  lane: number;
}

let nextId = 1;

/** 从词库挑一个未用过的词（一轮用完自动重置） */
export function pickWord(used: Set<string>): { word: string; pinyin: string } {
  const avail = WORD_POOL.filter((w) => !used.has(w));
  const pool = avail.length > 0 ? avail : WORD_POOL;
  const word = pool[Math.floor(Math.random() * pool.length)];
  return { word, pinyin: wordPinyin(word) };
}

/** 生成一名新嫌犯：从右边界外入场，挑一条不拥挤的跑道 */
export function spawnSuspect(
  suspects: Suspect[],
  used: Set<string>,
): { suspect: Suspect; used: Set<string> } {
  const { word, pinyin } = pickWord(used);
  const nextUsed = new Set(used);
  nextUsed.add(word);

  // 优先选当前最空的跑道，避免同叠
  const laneCount = [0, 0, 0];
  for (const s of suspects) laneCount[s.lane] += 1;
  let lane = 0;
  let min = Infinity;
  for (let i = 0; i < LANES; i++) {
    if (laneCount[i] < min) {
      min = laneCount[i];
      lane = i;
    }
  }

  const suspect: Suspect = {
    id: nextId++,
    word,
    pinyin,
    face: SUSPECT_FACES[Math.floor(Math.random() * SUSPECT_FACES.length)],
    x: STAGE_W + 20,
    lane,
  };
  return { suspect, used: nextUsed };
}

/* ------------------------------------------------------------------ */
/* 难度曲线                                                            */
/* ------------------------------------------------------------------ */

/** 移动速度（px/s）：随存活时间线性加快，封顶 */
export function speedAt(elapsedSec: number): number {
  return Math.min(48, 16 + elapsedSec * 0.5);
}

/** 出怪间隔（ms）：随存活时间缩短，封顶 */
export function spawnIntervalAt(elapsedSec: number): number {
  return Math.max(1100, 2300 - elapsedSec * 22);
}

/* ------------------------------------------------------------------ */
/* 键盘匹配                                                            */
/* ------------------------------------------------------------------ */

export type KeyOutcome =
  | { type: "none" }
  | { type: "activate"; suspectId: number }
  | { type: "advance"; suspectId: number; typedLen: number }
  | { type: "arrest"; suspectId: number; word: string; points: number }
  | { type: "error" };

export interface KeyState {
  suspects: Suspect[];
  activeId: number | null;
  typedLen: number;
  /** 当前连击数（逮捕前已连续逮捕次数） */
  combo: number;
}

export interface KeyResult {
  outcome: KeyOutcome;
  activeId: number | null;
  typedLen: number;
  combo: number;
}

/**
 * 处理一次按键（key 必须是单字母 a-z）。
 *
 * 规则：
 *  - 无激活目标时：所有以该字母开头的嫌犯中，选最靠左（最接近逃逸线）的激活；
 *  - 有激活目标：匹配下一个字母则推进；匹配不上但有其他词可以「接管」当前前缀，
 *    则切换目标；否则判错——连击清零、放弃当前输入。
 */
export function handleKey(key: string, state: KeyState): KeyResult {
  const c = key.toLowerCase();
  const { suspects, activeId, typedLen, combo } = state;

  const fail = (): KeyResult => ({
    outcome: { type: "error" },
    activeId: null,
    typedLen: 0,
    combo: 0,
  });

  // ── 已有激活目标 ──────────────────────────────────────────
  if (activeId !== null) {
    const cur = suspects.find((s) => s.id === activeId);
    if (!cur) {
      // 激活目标已消失（逃逸/被逮捕），重新走无激活逻辑
      return handleKey(c, { suspects, activeId: null, typedLen: 0, combo });
    }
    // 1) 正确推进
    if (cur.pinyin[typedLen] === c) {
      const nextLen = typedLen + 1;
      if (nextLen >= cur.pinyin.length) {
        const points = cur.pinyin.length * 10 + combo * 5;
        return {
          outcome: { type: "arrest", suspectId: cur.id, word: cur.word, points },
          activeId: null,
          typedLen: 0,
          combo: combo + 1,
        };
      }
      return {
        outcome: { type: "advance", suspectId: cur.id, typedLen: nextLen },
        activeId: cur.id,
        typedLen: nextLen,
        combo,
      };
    }
    // 2) 其他嫌犯可以接管当前前缀（如 jingcha 打到 "jin" 时按 "g"，
    //    场上若有 jingdi 则切换过去，不判错）
    const prefix = cur.pinyin.slice(0, typedLen);
    const takers = suspects
      .filter(
        (s) =>
          s.id !== cur.id &&
          s.pinyin.length > typedLen &&
          s.pinyin.startsWith(prefix) &&
          s.pinyin[typedLen] === c,
      )
      .sort((a, b) => a.x - b.x);
    if (takers.length > 0) {
      const t = takers[0];
      const nextLen = typedLen + 1;
      return {
        outcome: { type: "advance", suspectId: t.id, typedLen: nextLen },
        activeId: t.id,
        typedLen: nextLen,
        combo,
      };
    }
    // 3) 判错
    return fail();
  }

  // ── 无激活目标：从以 c 开头的嫌犯中挑最危险（最左）的 ──────
  const starters = suspects
    .filter((s) => s.pinyin[0] === c)
    .sort((a, b) => a.x - b.x);
  if (starters.length === 0) return fail();

  const target = starters[0];
  if (target.pinyin.length <= 1) {
    const points = target.pinyin.length * 10 + combo * 5;
    return {
      outcome: { type: "arrest", suspectId: target.id, word: target.word, points },
      activeId: null,
      typedLen: 0,
      combo: combo + 1,
    };
  }
  return {
    outcome: { type: "activate", suspectId: target.id },
    activeId: target.id,
    typedLen: 1,
    combo,
  };
}
