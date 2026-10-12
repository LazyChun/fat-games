/*
 * MenuView：主侧边栏（次面板）—— 游戏卡片列表（菜单）
 *
 * 点击卡片 → sdk.router.navigate("/games/<gameId>")，
 * 真正的游戏界面由工作台页 WorkPageView 在右侧工作区渲染。
 *
 * 注意：本组件被宿主直接渲染，父级没有 IntlProvider；
 * 因此外层只负责包 ThemeShell，业务与 i18n 调用全部下沉到 MenuContent，
 * 确保 useI18n() 在 IntlProvider 内部执行。
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
} from "react";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import { Empty, Input, Switch, Tag } from "antd";
import { GAMES, type GameDef } from "./games/registry";
import { CATEGORY_GRADIENTS } from "./games/gameTheme";
import { isSoundEnabled, setSoundEnabled, sfxClick } from "./games/sound";
import { pathToGameId, gameIdToPath } from "./routes";
import { getPreferredGameId, setPreferredGameId } from "./preferences";
import { matchPinyin } from "./utils";
import { useI18n } from "./hooks";
import ThemeShell from "./ThemeShell";
import styles from "./MenuView.less";

interface Props {
  sdk: FatNotesPluginSDK;
}

const MenuView: React.FC<Props> = ({ sdk }) => {
  return (
    <ThemeShell sdk={sdk} padding={10}>
      <MenuContent sdk={sdk} />
    </ThemeShell>
  );
};

/** 菜单主体（运行在 ThemeShell / IntlProvider 内部） */
const MenuContent: React.FC<Props> = ({ sdk }) => {
  const i18n = useI18n();
  const [query, setQuery] = useState("");
  const [soundOn, setSoundOn] = useState(isSoundEnabled());
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

  const placeholder = i18n.text("games.search.placeholder");
  const countText = i18n.text("games.search.count", { count: GAMES.length });
  const emptyText = i18n.text("games.empty");
  const soundLabel = i18n.text("games.sound.label");
  const soundHint = i18n.text("games.sound.hint");

  const toggleSound = (on: boolean) => {
    setSoundEnabled(on);
    setSoundOn(on);
    if (on) sfxClick();
  };

  return (
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
          placeholder={placeholder}
          allowClear
          size="small"
          className={styles.menuSearch}
        />
        <div className={styles.searchMeta}>{countText}</div>
      </div>

      <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
        {filtered.length === 0 ? (
          <Empty
            description={emptyText}
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

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "9px 6px 4px",
          borderTop: "1px solid rgba(128,128,128,0.16)",
          marginTop: 6,
          userSelect: "none",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3 }}>
            {soundLabel}
          </span>
          <span
            style={{ fontSize: 10.5, opacity: 0.55, lineHeight: 1.3 }}
          >
            {soundHint}
          </span>
        </div>
        <Switch
          size="small"
          checked={soundOn}
          onChange={toggleSound}
          aria-label={soundLabel}
        />
      </div>
    </div>
  );
};

/** 游戏卡片（选中态高亮 + 悬停上浮） */
const GameCard: React.FC<{
  game: GameDef;
  active: boolean;
  onOpen: () => void;
}> = ({ game, active, onOpen }) => {
  const i18n = useI18n();
  const Icon = game.icon;
  const title = i18n.text(game.titleKey) || game.title;
  const desc = i18n.text(game.descKey) || game.desc;
  const category = i18n.text(game.categoryKey) || game.category;
  const iconBg = CATEGORY_GRADIENTS[category] || CATEGORY_GRADIENTS["休闲"];
  return (
    <div
      onClick={onOpen}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 7,
        padding: "12px 12px 10px",
        borderRadius: 12,
        border: `1px solid ${active ? "rgba(22,119,255,0.65)" : "rgba(128,128,128,0.22)"}`,
        background: active ? "rgba(22,119,255,0.08)" : "rgba(128,128,128,0.05)",
        cursor: "pointer",
        userSelect: "none",
        boxShadow: active ? "0 4px 14px rgba(22,119,255,0.2)" : "0 1px 3px rgba(0,0,0,0.05)",
        transition:
          "transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease",
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.transform = "translateY(-2px)";
          e.currentTarget.style.borderColor = "rgba(22,119,255,0.55)";
          e.currentTarget.style.boxShadow = "0 6px 16px rgba(22,119,255,0.2)";
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.transform = "translateY(0)";
          e.currentTarget.style.borderColor = "rgba(128,128,128,0.22)";
          e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.05)";
        }
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: 9,
            background: iconBg,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 2px 6px rgba(0,0,0,0.16)",
            flexShrink: 0,
          }}
        >
          <Icon style={{ fontSize: 16, color: "#fff" }} />
        </span>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{title}</span>
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
        {desc}
      </span>
      <Tag
        color={active ? "blue" : undefined}
        style={{
          alignSelf: "flex-start",
          margin: 0,
          fontSize: 11,
          lineHeight: "16px",
          borderRadius: 8,
        }}
      >
        {category}
      </Tag>
    </div>
  );
};

export default MenuView;
