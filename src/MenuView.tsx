/*
 * MenuView：主侧边栏（次面板）—— 游戏卡片列表（菜单）
 *
 * 点击卡片 → sdk.router.navigate("/games/<gameId>")，
 * 真正的游戏界面由工作台页 WorkPageView 在右侧工作区渲染。
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from "react";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import { Empty, Input, Tag } from "antd";
import { GAMES, type GameDef } from "./games/registry";
import { pathToGameId, gameIdToPath } from "./routes";
import { getPreferredGameId, setPreferredGameId } from "./preferences";
import { matchPinyin } from "./utils";
import ThemeShell from "./ThemeShell";
import styles from "./MenuView.less";

interface Props {
  sdk: FatNotesPluginSDK;
}

const MenuView: React.FC<Props> = ({ sdk }) => {
  const [query, setQuery] = useState("");
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  // 订阅路由变化：卡片高亮跟随右侧工作区当前页
  useEffect(() => {
    const d = sdk.router.onChange(() => forceUpdate());
    return () => d.dispose();
  }, [sdk]);

  const currentPath = sdk.router.getCurrent().path;
  const currentGameId = pathToGameId(currentPath) ?? getPreferredGameId();

  const openGame = useCallback(
    (gameId: string) => {
      const path = gameIdToPath(gameId);
      if (!path) return;
      setPreferredGameId(gameId);
      sdk.router.navigate(path);
    },
    [sdk],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GAMES;
    return GAMES.filter(
      (g) =>
        matchPinyin(g.title, q) ||
        matchPinyin(g.desc, q) ||
        matchPinyin(g.category, q) ||
        g.id.toLowerCase().includes(q),
    );
  }, [query]);

  return (
    <ThemeShell sdk={sdk} padding={10}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "100%",
          minHeight: 0,
        }}
      >
        <div style={{ marginBottom: 8 }}>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索游戏..."
            allowClear
            size="small"
            className={styles.menuSearch}
          />
          <div className={styles.searchMeta}>共 {GAMES.length} 个游戏</div>
        </div>

        <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
          {filtered.length === 0 ? (
            <Empty
              description="没有匹配的游戏"
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                gap: 8,
                alignContent: "start",
                paddingBottom: 8,
              }}
            >
              {filtered.map((game) => (
                <GameCard
                  key={game.id}
                  game={game}
                  active={game.id === currentGameId}
                  onOpen={() => openGame(game.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </ThemeShell>
  );
};

/** 游戏卡片（选中态蓝框高亮） */
const GameCard: React.FC<{
  game: GameDef;
  active: boolean;
  onOpen: () => void;
}> = ({ game, active, onOpen }) => {
  const Icon = game.icon;
  return (
    <div
      onClick={onOpen}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: "12px 12px 10px",
        borderRadius: 10,
        border: `1px solid ${active ? "rgba(22,119,255,0.65)" : "rgba(128,128,128,0.25)"}`,
        background: active ? "rgba(22,119,255,0.08)" : "rgba(128,128,128,0.05)",
        cursor: "pointer",
        userSelect: "none",
        boxShadow: active ? "0 2px 10px rgba(22,119,255,0.18)" : "none",
        transition:
          "transform 0.12s ease, box-shadow 0.12s ease, border-color 0.12s ease",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.borderColor = "rgba(22,119,255,0.55)";
          e.currentTarget.style.boxShadow = "0 2px 10px rgba(22,119,255,0.18)";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.borderColor = "rgba(128,128,128,0.25)";
          e.currentTarget.style.boxShadow = "none";
        }
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Icon style={{ fontSize: 18, color: "#1677ff" }} />
        <span style={{ fontWeight: 600, fontSize: 13 }}>{game.title}</span>
      </div>
      <span
        style={{
          fontSize: 12,
          opacity: 0.65,
          lineHeight: 1.4,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {game.desc}
      </span>
      <Tag
        style={{
          alignSelf: "flex-start",
          margin: 0,
          fontSize: 11,
          lineHeight: "16px",
        }}
      >
        {game.category}
      </Tag>
    </div>
  );
};

export default MenuView;
