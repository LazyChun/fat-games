/*
 * fat-games 路由定义
 *
 * 侧边栏菜单点击 → sdk.router.navigate(path)；右侧工作台页
 * （registerWorkbenchPage）根据 sdk.router.getCurrent().path 渲染对应游戏。
 *
 * 路由格式：/games/<gameId>
 */
import { GAMES } from "./games/registry";

export const ROUTE_PREFIX = "/games";

/** 游戏 id → 路由 path（未知 id 返回 null） */
export function gameIdToPath(gameId: string): string | null {
  return GAMES.some((g) => g.id === gameId) ? `${ROUTE_PREFIX}/${gameId}` : null;
}

/** path → 游戏 id（非本插件路由返回 null） */
export function pathToGameId(path: string): string | null {
  if (!path || !path.startsWith(`${ROUTE_PREFIX}/`)) return null;
  const id = path.slice(ROUTE_PREFIX.length + 1);
  return GAMES.some((g) => g.id === id) ? id : null;
}

/** 默认落地路由（首个游戏） */
export function getDefaultRoute(): string {
  return GAMES.length ? `${ROUTE_PREFIX}/${GAMES[0].id}` : ROUTE_PREFIX;
}
