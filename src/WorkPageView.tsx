/*
 * WorkPageView：工作台整页（右侧工作区）
 *
 * 通过 registerWorkbenchPage 注册（id 与活动栏项 id 一致），
 * 根据 sdk.router.getCurrent().path 渲染对应游戏的完整界面。
 *
 * 注意：本组件被宿主直接渲染，父级没有 IntlProvider；
 * 外层只负责包 ThemeShell，业务与 i18n 调用下沉到 WorkPageContent，
 * 确保 useI18n() 在 IntlProvider 内部执行。
 */
import React, { useEffect, useMemo, useReducer } from "react";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import { Empty } from "antd";
import { GAMES } from "./games/registry";
import { getDefaultRoute, pathToGameId, gameIdToPath } from "./routes";
import { getPreferredGameId } from "./preferences";
import { useI18n } from "./hooks";
import ThemeShell from "./ThemeShell";

interface Props {
  sdk: FatNotesPluginSDK;
}

const WorkPageView: React.FC<Props> = ({ sdk }) => {
  return (
    <ThemeShell sdk={sdk} padding={16}>
      <WorkPageContent sdk={sdk} />
    </ThemeShell>
  );
};

/** 工作台主体（运行在 ThemeShell / IntlProvider 内部） */
const WorkPageContent: React.FC<Props> = ({ sdk }) => {
  const i18n = useI18n();
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    const d = sdk.router.onChange(() => forceUpdate());
    return () => d.dispose();
  }, [sdk]);

  const { path } = sdk.router.getCurrent();
  const gameId = pathToGameId(path);
  const game = useMemo(
    () => GAMES.find((g) => g.id === gameId) || null,
    [gameId],
  );

  // 当前路由不属于本插件时，兜底导航到记忆的游戏
  useEffect(() => {
    if (pathToGameId(sdk.router.getCurrent().path)) return;
    const preferred = getPreferredGameId();
    const landing = (preferred && gameIdToPath(preferred)) || getDefaultRoute();
    sdk.router.navigate(landing);
  }, [sdk, path]);

  if (!game) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={i18n.text("games.loading")}
      />
    );
  }

  const Active = game.component;
  return <Active sdk={sdk} />;
};

export default WorkPageView;
