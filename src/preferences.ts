/*
 * fat-games 本地偏好（localStorage）：记忆上次玩的游戏
 */
const DEFAULT_GAME_KEY = "fat-games.defaultGame";

export function getPreferredGameId(): string | null {
  try {
    return window.localStorage.getItem(DEFAULT_GAME_KEY);
  } catch {
    return null;
  }
}

export function setPreferredGameId(id: string | null): void {
  try {
    if (id) window.localStorage.setItem(DEFAULT_GAME_KEY, id);
    else window.localStorage.removeItem(DEFAULT_GAME_KEY);
  } catch {
    /* ignore */
  }
}
