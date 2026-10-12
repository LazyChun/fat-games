/*
 * 游戏成绩记录客户端
 *
 * 所有游戏的成绩记录统一落库（专用 SQLite：<workspace>/fatGames/history.db，
 * 由 Python 后端 scoreStore 维护）。后端不可用时自动降级到 localStorage，
 * 保证 UI 功能不受宿主环境差异影响。
 */
import type { FatNotesPluginSDK } from "fat-notes-sdk";

export interface ScoreRecord {
  id: number;
  gameId: string;
  gameTitle: string;
  playerName: string;
  score: number;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface ScoreListResult {
  items: ScoreRecord[];
  total: number;
  limit: number;
}

export interface ScoreStats {
  total: number;
  items: { gameId: string; gameTitle: string; count: number }[];
}

const LS_KEY = "fat-games.scores";
const LS_MAX = 200;

let sdkRef: FatNotesPluginSDK | null = null;

export function initScoreClient(sdkInstance: FatNotesPluginSDK): void {
  sdkRef = sdkInstance;
}

/** 取已注入的 SDK 引用（未初始化返回 null） */
export function getSdk(): FatNotesPluginSDK | null {
  return sdkRef;
}

function sdk(): FatNotesPluginSDK {
  if (!sdkRef) throw new Error("[fat-games] score client not initialized");
  return sdkRef;
}

/** 后端是否可用（探测失败后短时间不再重试） */
let backendAvailable: boolean | null = null;
let backendCheckAt = 0;

async function ensureBackend(): Promise<boolean> {
  const now = Date.now();
  if (backendAvailable !== null && now - backendCheckAt < 30_000) return backendAvailable;
  backendCheckAt = now;
  try {
    backendAvailable = await sdk().backend.isRunning();
  } catch {
    backendAvailable = false;
  }
  return backendAvailable;
}

// ── localStorage 兜底 ─────────────────────────────────────────

function lsRead(): ScoreRecord[] {
  try {
    return JSON.parse(window.localStorage.getItem(LS_KEY) || "[]");
  } catch {
    return [];
  }
}

function lsWrite(items: ScoreRecord[]): void {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(items.slice(0, LS_MAX)));
  } catch {
    /* ignore */
  }
}

// ── 对外 API ──────────────────────────────────────────────────

export interface ScoreInput {
  gameId: string;
  gameTitle: string;
  score: number;
  playerName?: string;
  detail?: Record<string, unknown>;
}

/** 记录一次游戏成绩（fire-and-forget，失败静默降级） */
export function recordScore(input: ScoreInput): void {
  void (async () => {
    if (await ensureBackend()) {
      try {
        await sdk().backend.invoke("scores.add", input as unknown as Record<string, unknown>);
        return;
      } catch {
        backendAvailable = false;
      }
    }
    const items = lsRead();
    const record: ScoreRecord = {
      id: Date.now(),
      gameId: input.gameId,
      gameTitle: input.gameTitle,
      playerName: input.playerName || "匿名",
      score: input.score,
      detail: input.detail || {},
      createdAt: new Date().toISOString().slice(0, 19),
    };
    items.unshift(record);
    lsWrite(items);
  })();
}

/** 查询成绩记录（gameId 可选；后端不可用读 localStorage） */
export async function listScores(
  opts: { gameId?: string; limit?: number } = {},
): Promise<ScoreListResult> {
  if (await ensureBackend()) {
    try {
      const r = await sdk().backend.invoke<ScoreListResult>(
        "scores.list",
        { gameId: opts.gameId, limit: opts.limit } as Record<string, unknown>,
      );
      if (r && Array.isArray(r.items)) return r;
    } catch {
      backendAvailable = false;
    }
  }
  const all = lsRead();
  const items = opts.gameId ? all.filter((i) => i.gameId === opts.gameId) : all;
  return { items: items.slice(0, opts.limit || 50), total: items.length, limit: opts.limit || 50 };
}

/** 各游戏成绩统计 */
export async function scoreStats(): Promise<ScoreStats> {
  if (await ensureBackend()) {
    try {
      const r = await sdk().backend.invoke<ScoreStats>("scores.stats", {});
      if (r && Array.isArray(r.items)) return r;
    } catch {
      backendAvailable = false;
    }
  }
  const all = lsRead();
  const map = new Map<string, { gameId: string; gameTitle: string; count: number }>();
  for (const i of all) {
    const e = map.get(i.gameId) || { gameId: i.gameId, gameTitle: i.gameTitle, count: 0 };
    e.count += 1;
    map.set(i.gameId, e);
  }
  return { total: all.length, items: Array.from(map.values()) };
}

/** 清空成绩记录（gameId 可选） */
export async function clearScores(gameId?: string): Promise<{ removed: number }> {
  if (await ensureBackend()) {
    try {
      return await sdk().backend.invoke<{ removed: number }>("scores.clear", { gameId });
    } catch {
      backendAvailable = false;
    }
  }
  const all = lsRead();
  const kept = gameId ? all.filter((i) => i.gameId !== gameId) : [];
  const removed = all.length - kept.length;
  lsWrite(kept);
  return { removed };
}

/** SQLite 文件路径（展示用；后端不可用返回 null） */
export async function getDbPath(): Promise<string | null> {
  if (await ensureBackend()) {
    try {
      const r = await sdk().backend.invoke<{ path: string }>("scores.dbPath", {});
      return r?.path || null;
    } catch {
      backendAvailable = false;
    }
  }
  return null;
}
