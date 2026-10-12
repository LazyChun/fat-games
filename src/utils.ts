/*
 * fat-games 核心纯函数库
 *
 * 游戏相关计算逻辑收敛在这里（不依赖 DOM / React），
 * 便于用 vitest 做单元测试，UI 组件只负责交互与展示。
 */

import { pinyin } from "pinyin-pro";

/* ------------------------------------------------------------------ */
/* 拼音搜索匹配                                                         */
/* ------------------------------------------------------------------ */

interface PinyinKeys {
  /** 全拼（仅小写字母数字，如 "tiankongtiao"） */
  full: string;
  /** 首字母（如 "tkt"） */
  initials: string;
}

const pinyinKeysCache = new Map<string, PinyinKeys>();

/** 生成文本的拼音检索键（全拼 + 首字母，带缓存；支持中英混排） */
export function getPinyinKeys(text: string): PinyinKeys {
  const cached = pinyinKeysCache.get(text);
  if (cached) return cached;
  const clean = (arr: string[]) =>
    arr
      .join("")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  let keys: PinyinKeys;
  try {
    const full = clean(
      pinyin(text, { toneType: "none", type: "array", nonZh: "consecutive" }),
    );
    const initials = clean(
      pinyin(text, {
        pattern: "first",
        toneType: "none",
        type: "array",
        nonZh: "consecutive",
      }),
    );
    keys = { full, initials };
  } catch {
    keys = { full: "", initials: "" };
  }
  pinyinKeysCache.set(text, keys);
  return keys;
}

/**
 * 拼音搜索匹配：query 可命中原文、全拼或拼音首字母。
 */
export function matchPinyin(text: string, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/\s+/g, "");
  if (!q) return true;
  if (text.toLowerCase().includes(q)) return true;
  const keys = getPinyinKeys(text);
  return keys.full.includes(q) || keys.initials.includes(q);
}

/* ------------------------------------------------------------------ */
/* 通用工具                                                            */
/* ------------------------------------------------------------------ */

/** 生成随机整数 [min, max] */
export function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** 格式化分数（大数加千分位） */
export function formatScore(score: number): string {
  return score.toLocaleString("en-US");
}
