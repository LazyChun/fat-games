/*
 * fat-games — FatNotes 休闲游戏箱插件
 *
 * 布局参考 fat-tools：
 *   - 活动栏图标      → 选中后显示主侧边栏 + 工作台整页
 *   - 主侧边栏（次面板）→ 只放游戏菜单（MenuView），点击走 sdk.router.navigate
 *   - 工作台整页（右侧工作区）→ 按当前路由渲染对应游戏（WorkPageView）
 *
 * 内置游戏（全部纯前端实现，遵循 SDK-First 原则）：
 *   2048 / 贪吃蛇 / 扫雷 / 排行榜
 *
 * 其它贡献点：
 *   - 路由页注册（供宿主面包屑 / 全局导航识别）
 *   - 页脚状态、设置页
 *   - 命令：fat-games.ping / fat-games.openGame
 *   - 本插件页激活时隐藏右侧次侧栏与底部面板，让工作区更宽
 */
import React from "react";
import type { Disposable, FatNotesPluginSDK } from "fat-notes-sdk";
import MenuView from "./MenuView";
import WorkPageView from "./WorkPageView";
import { GAMES } from "./games/registry";
import { ROUTE_PREFIX, getDefaultRoute, gameIdToPath } from "./routes";
import { getPreferredGameId, setPreferredGameId } from "./preferences";
import { initScoreClient } from "./scoreClient";
import GameSwitcherBlock from "./GameSwitcherBlock";
import GameSwitcherDisplayConfig from "./GameSwitcherDisplayConfig";
import { GAME_BLOCK_ICON_URL } from "./assets/gameBlockIcon";

const disposables: Disposable[] = [];

/** 活动栏项 id —— 必须与工作台页 id 完全一致，宿主据此绑定右侧工作区 */
const ACTIVITY_ID = "fat-games.main";

/**
 * 逐项注册并吞掉单个贡献点的异常：
 * 某个宿主版本缺少某个 SDK 方法时，不能让它中断整个 activate()，
 * 否则后续贡献点与首屏 UI 都会一起消失。
 */
function safeRegister(label: string, fn: () => Disposable | undefined | null): void {
  try {
    const d = fn();
    if (d) disposables.push(d);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`[fat-games] 注册「${label}」失败：`, e);
  }
}

export async function activate(sdk: FatNotesPluginSDK): Promise<void> {
  // 0. 注入 SDK 引用：游戏成绩记录（SQLite 落库）依赖
  initScoreClient(sdk);

  // 1. 活动栏图标（点击后：左侧显示主侧边栏菜单 + 右侧显示工作台整页）
  safeRegister("activityBar", () =>
    sdk.contributions.registerActivityBarItem({
      id: ACTIVITY_ID,
      title: "游戏箱 fat-games",
      icon: "Gamepad",
      pluginName: "fat-games",
    }),
  );

  // 2. 主侧边栏（次面板）：只展示游戏菜单
  safeRegister("primarySidebar", () =>
    sdk.contributions.registerPrimarySidebar(() => React.createElement(MenuView, { sdk })),
  );

  // 3. 工作台整页（右侧工作区）：id 与活动栏项一致，宿主才会在右侧渲染它
  safeRegister("workbenchPage", () =>
    sdk.contributions.registerWorkbenchPage({
      id: ACTIVITY_ID,
      render: () => React.createElement(WorkPageView, { sdk }),
    }),
  );

  // 4. 路由页注册（宿主用于面包屑 / 全局导航；实际渲染由工作台页按路由分发）
  for (const game of GAMES) {
    const path = gameIdToPath(game.id);
    if (!path) continue;
    safeRegister(`route:${path}`, () =>
      sdk.contributions.registerRoutePage({
        path,
        title: game.title,
        render: () => null,
      }),
    );
  }

  // 5. 页脚状态项（显示当前游戏）
  safeRegister("footerItem", () =>
    sdk.contributions.registerFooterItem({
      id: "fat-games.footer",
      align: "right",
      render: () => {
        const preferred = getPreferredGameId();
        const game = GAMES.find((g) => g.id === preferred);
        return React.createElement(
          "span",
          { style: { opacity: 0.75 }, title: "fat-games 游戏箱" },
          `[fat-games] ${game ? game.title : "ready"}`,
        );
      },
    }),
  );

  // 6. 命令：ping
  safeRegister("command:ping", () =>
    sdk.commands.register("fat-games.ping", async () => {
      sdk.ui.toast.info(`[fat-games] pong（宿主 ${sdk.host.version}，游戏数 ${GAMES.length}）`);
      return "pong";
    }),
  );

  // 7. 命令：openGame —— 导航到对应游戏路由（右侧工作区随之切换）
  safeRegister("command:openGame", () =>
    sdk.commands.register("fat-games.openGame", async (gameId: unknown) => {
      const id = typeof gameId === "string" ? gameId : GAMES[0]?.id;
      if (!id) return false;
      const path = gameIdToPath(id);
      if (!path) {
        sdk.ui.toast.warn(`[fat-games] 未知游戏 id：${id}`);
        return false;
      }
      setPreferredGameId(id);
      sdk.router.navigate(path);
      return true;
    }),
  );

  // 8. 设置页：游戏清单说明
  safeRegister("settingsPage", () =>
    sdk.contributions.registerSettingsPage({
      id: "fat-games.settings",
      title: "fat-games 游戏箱",
      render: () =>
        React.createElement(
          "div",
          { style: { padding: 20, maxWidth: 560 } },
          React.createElement("h3", { style: { marginTop: 0 } }, "fat-games 游戏箱"),
          React.createElement(
            "p",
            null,
            `共内置 ${GAMES.length} 个休闲游戏。左侧菜单选择游戏，右侧工作区开始游玩；` +
              `游戏成绩会自动记录到排行榜。`,
          ),
          React.createElement(
            "ul",
            null,
            GAMES.map((g) =>
              React.createElement(
                "li",
                { key: g.id },
                React.createElement("b", null, g.title),
                ` — ${g.desc}（路由：${ROUTE_PREFIX}/${g.id}）`,
              ),
            ),
          ),
          React.createElement(
            "p",
            { style: { color: "#888", fontSize: 12 } },
            "提示：可通过命令 fat-games.openGame（参数为游戏 id）从任意位置快速打开指定游戏。",
          ),
        ),
    }),
  );

  // 8.5 仪表盘组件：「游戏」卡片（参考 fat-chess「棋游」的 blockType 注册方式）。
  //     挂在「其他(other)」分类下，卡片内可在多个休闲游戏间切换并直接游玩：
  //     参与切换的游戏 / 默认游戏 / 切换按钮显隐 / 按钮组或下拉框 / 顶或底，
  //     均由右侧「显示配置」面板（registerBlockDisplayConfig）配置。
  //     index=101 紧跟「棋游」(100) 之后。
  safeRegister("blockType:game", () =>
    sdk.contributions.registerBlockType({
      type: "fat-games.game",
      title: "游戏",
      iconUrl: GAME_BLOCK_ICON_URL,
      category: "other",
      index: 101,
      defaultSize: { w: 6, h: 30, minW: 4, minH: 16 },
      // 新建卡片写入 options 的默认值（宿主会深拷贝）
      defaultOptions: {
        gameSwitcher: {
          games: GAMES.filter((g) => g.id !== "scores").map((g) => g.id),
          defaultGame: "2048",
          showSwitch: true,
          switchStyle: "segmented",
          switchPosition: "top",
        },
      },
      render: (props) =>
        React.createElement(GameSwitcherBlock, {
          config: props.config,
          inConfig: props.inConfig,
          sdk,
        }),
    }),
  );

  // 8.6 「游戏」卡片的显示配置面板（组件配置抽屉 > 显示配置）
  safeRegister("blockDisplayConfig:game", () =>
    sdk.contributions.registerBlockDisplayConfig({
      id: "fat-games.game.config",
      blockType: "fat-games.game",
      render: () => React.createElement(GameSwitcherDisplayConfig, { sdk }),
    }),
  );

  // 9. 本插件页激活时隐藏右侧次侧栏与底部面板，让工作区更宽（参考 fat-tools）
  const ACTIVITY_KEY = `bespoke:${ACTIVITY_ID}`;
  const selectActivityMenuKey = (state: unknown): string | undefined => {
    if (state && typeof state === "object") {
      const frame = (state as { frame?: unknown }).frame;
      if (frame && typeof frame === "object") {
        const key = (frame as { activityMenuKey?: unknown }).activityMenuKey;
        if (typeof key === "string") return key;
      }
    }
    return undefined;
  };

  let hideSecondaryDisposable: Disposable | null = null;
  let hidePanelDisposable: Disposable | null = null;
  const syncHide = (activeKey: string | undefined): void => {
    const shouldHide = activeKey === ACTIVITY_KEY;
    if (shouldHide) {
      if (!hideSecondaryDisposable && typeof sdk.contributions.registerHideSecondarySidebar === "function") {
        hideSecondaryDisposable = sdk.contributions.registerHideSecondarySidebar();
      }
      if (!hidePanelDisposable && typeof sdk.contributions.registerHidePanel === "function") {
        hidePanelDisposable = sdk.contributions.registerHidePanel();
      }
    } else {
      hideSecondaryDisposable?.dispose();
      hideSecondaryDisposable = null;
      hidePanelDisposable?.dispose();
      hidePanelDisposable = null;
    }
  };

  try {
    syncHide(sdk.store.select(selectActivityMenuKey));
    disposables.push(
      sdk.store.subscribe(selectActivityMenuKey, (nextKey) => syncHide(nextKey)),
    );
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[fat-games] 注册布局联动失败：", e);
  }
  disposables.push({
    dispose() {
      hideSecondaryDisposable?.dispose();
      hideSecondaryDisposable = null;
      hidePanelDisposable?.dispose();
      hidePanelDisposable = null;
    },
  });

  // 首次激活时确保路由有值（工作区直接可用）
  try {
    if (!gameIdToPath(sdk.router.getCurrent().path)) {
      const preferred = getPreferredGameId();
      const landing =
        (preferred && gameIdToPath(preferred)) || getDefaultRoute();
      sdk.router.navigate(landing);
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[fat-games] 初始化路由失败：", e);
  }
}

export function deactivate(): void {
  while (disposables.length) {
    try {
      disposables.pop()?.dispose();
    } catch (e) {
      // deactivate() 绝不能抛异常
      // eslint-disable-next-line no-console
      console.warn("[fat-games] dispose error", e);
    }
  }
}
