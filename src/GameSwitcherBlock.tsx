/*
 * 「游戏」卡片（仪表盘块类型 fat-games.game）
 *
 * 在一张仪表盘卡片内嵌渲染任选休闲游戏，并通过顶栏/底栏的切换按钮
 * （按钮组或下拉框）在多个游戏间切换：
 *   - options.gameSwitcher.games         参与切换的游戏 id 列表
 *   - options.gameSwitcher.defaultGame  默认展示的游戏 id
 *   - options.gameSwitcher.showSwitch   是否展示切换按钮
 *   - options.gameSwitcher.switchStyle 切换控件样式：segmented | select
 *   - options.gameSwitcher.switchPosition 切换按钮位置：top | bottom
 *
 * config 由宿主注入（Block.Item.options），外框（标题/背景/圆角/边框/内边距）
 * 由宿主 BlockFrame 按 commonOptions 渲染，本组件只负责内容区。
 *
 * 与 fat-chess「棋游」卡片同构；差异：
 *   - 游戏列表来自 fat-games 注册表 GAMES；
 *   - 游戏组件需要 ThemeShell（antd 主题 + IntlProvider + 明暗上下文），
 *     因此每张卡片自包一层 ThemeShell（padding 0，内容自带舞台边距）。
 */
import React, { useEffect, useMemo, useState } from "react";
import { Empty, Segmented, Select } from "antd";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import { GAMES } from "./games/registry";
import ThemeShell from "./ThemeShell";

/** 卡片私有配置（options.gameSwitcher） */
export interface GameSwitcherConf {
  /** 参与切换的游戏 id 列表；为空时回退为全部可玩游戏（排除排行榜） */
  games?: string[];
  /** 默认展示的游戏 id */
  defaultGame?: string;
  /** 是否展示切换按钮 */
  showSwitch?: boolean;
  /** 切换控件样式：segmented 按钮组（默认）| select 下拉框 */
  switchStyle?: "segmented" | "select";
  /** 切换按钮位置：top 顶部（默认）| bottom 底部 */
  switchPosition?: "top" | "bottom";
}

/** 不可作为「游戏」卡片内嵌对象的 id（排行榜是记录视图，不是可玩游戏） */
const NON_PLAYABLE_IDS = new Set(["scores"]);

/** 默认可切换游戏：注册表中剔除排行榜 */
const DEFAULT_PLAYABLE_IDS = GAMES.filter(
  (g) => !NON_PLAYABLE_IDS.has(g.id),
).map((g) => g.id);

/** 从宿主注入的 config（Block.Item.options）中收窄私有配置 */
export function normalizeGameSwitcherConf(
  config: unknown,
): GameSwitcherConf {
  const conf = (
    config as { gameSwitcher?: GameSwitcherConf } | null | undefined
  )?.gameSwitcher;
  return conf && typeof conf === "object" ? conf : {};
}

interface Props {
  /** 宿主注入的 Block.Item.options */
  config?: unknown;
  /** 是否渲染在配置抽屉预览中 */
  inConfig?: boolean;
  sdk?: FatNotesPluginSDK;
}

const GameSwitcherBlock: React.FC<Props> = ({ config, sdk }) => {
  const conf = normalizeGameSwitcherConf(config);

  // 参与切换的游戏（过滤未知 id 与排行榜；配置为空时回退全部可玩游戏）
  const available = useMemo(() => {
    const ids =
      Array.isArray(conf.games) && conf.games.length
        ? conf.games
        : DEFAULT_PLAYABLE_IDS;
    return ids
      .map((id) => GAMES.find((g) => g.id === id))
      .filter(
        (g): g is NonNullable<typeof g> =>
          !!g && !NON_PLAYABLE_IDS.has(g.id),
      );
  }, [conf.games]);

  // 默认游戏：配置值失效时回退第一个
  const initialId = useMemo(() => {
    if (
      conf.defaultGame &&
      available.some((g) => g.id === conf.defaultGame)
    ) {
      return conf.defaultGame;
    }
    return available[0]?.id;
  }, [conf.defaultGame, available]);

  const [activeId, setActiveId] = useState<string | undefined>(initialId);

  // 配置面板改了游戏集/默认游戏后，让卡片回到默认游戏
  useEffect(() => {
    setActiveId(initialId);
  }, [initialId]);

  const active = available.find((g) => g.id === activeId) || available[0];

  const renderSwitchBar = (): React.ReactNode => {
    if (!available.length) return null;
    if (conf.switchStyle === "select") {
      return (
        <Select
          size="small"
          showSearch
          virtual={false}
          listHeight={360}
          popupMatchSelectWidth={false}
          getPopupContainer={() => document.body}
          style={{ width: "100%" }}
          value={active?.id}
          onChange={(v) => setActiveId(v as string)}
          filterOption={(input, option) => {
            const q = input.trim().toLowerCase();
            if (!q) return true;
            const label =
              typeof option?.label === "string" ? option.label.toLowerCase() : "";
            const value =
              option?.value == null ? "" : String(option.value).toLowerCase();
            return label.includes(q) || value.includes(q);
          }}
          options={available.map((g) => ({
            value: g.id,
            label: g.title,
          }))}
        />
      );
    }
    return (
      <Segmented
        block
        size="small"
        value={active?.id}
        onChange={(v) => setActiveId(v as string)}
        options={available.map((g) => ({
          value: g.id,
          label: g.title,
        }))}
      />
    );
  };

  const showBar = conf.showSwitch !== false && available.length > 1;
  const barOnTop = conf.switchPosition !== "bottom";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      {showBar ? (
        <div style={{ flexShrink: 0, padding: "0 8px 4px" }}>
          {renderSwitchBar()}
        </div>
      ) : null}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
        {active && sdk ? (
          <ThemeShell sdk={sdk} padding={8}>
            <EmbeddedGame key={active.id} sdk={sdk} gameId={active.id} />
          </ThemeShell>
        ) : (
          <div
            style={{
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="尚未配置游戏"
            />
          </div>
        )}
      </div>
      {showBar && !barOnTop ? (
        <div style={{ flexShrink: 0, padding: "4px 8px 0" }}>
          {renderSwitchBar()}
        </div>
      ) : null}
    </div>
  );
};

/** 内嵌单个游戏：按 id 从注册表取出组件渲染 */
const EmbeddedGame: React.FC<{
  sdk: FatNotesPluginSDK;
  gameId: string;
}> = ({ sdk, gameId }) => {
  const game = GAMES.find((g) => g.id === gameId);
  if (!game) {
    return (
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={`未知游戏：${gameId}`}
      />
    );
  }
  const Active = game.component;
  return <Active sdk={sdk} />;
};

export default GameSwitcherBlock;
