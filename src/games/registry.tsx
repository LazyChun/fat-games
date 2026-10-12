/*
 * 游戏注册表：所有游戏在此集中登记（id、标题、描述、图标、组件、分类）
 *
 * 每个游戏同时提供：
 *   - title/desc/category：中文兜底文本（用于在 IntlProvider 外偶发渲染、
 *     命令行 toast、scoreClient 落库 gameTitle 等不需要 i18n 的场景）
 *   - titleKey/descKey/categoryKey：i18n key，组件在 IntlProvider 内通过
 *     useI18n().text(key) 取本地化文本
 */
import React from "react";
import {
  AppstoreOutlined,
  BorderOutlined,
  ThunderboltOutlined,
  TrophyOutlined,
} from "@ant-design/icons";

import Game2048 from "./Game2048";
import SnakeGame from "./SnakeGame";
import MinesweeperGame from "./MinesweeperGame";
import ScoresView from "./ScoresView";

export type GameCategory = "休闲" | "益智" | "记录";

export interface GameDef {
  id: string;
  /** 中文兜底标题 */
  title: string;
  /** 中文兜底描述 */
  desc: string;
  category: GameCategory;
  /** i18n key，e.g. "game.2048.title" */
  titleKey: string;
  /** i18n key，e.g. "game.2048.desc" */
  descKey: string;
  /** i18n key，e.g. "category.puzzle" */
  categoryKey: string;
  icon: React.ComponentType<{ style?: React.CSSProperties }>;
  component: React.ComponentType<{
    sdk: import("fat-notes-sdk").FatNotesPluginSDK;
  }>;
}

export const GAMES: GameDef[] = [
  {
    id: "2048",
    title: "2048",
    desc: "合并数字方块，目标 2048",
    category: "益智",
    titleKey: "game.2048.title",
    descKey: "game.2048.desc",
    categoryKey: "category.puzzle",
    icon: AppstoreOutlined,
    component: Game2048,
  },
  {
    id: "snake",
    title: "贪吃蛇",
    desc: "控制蛇身吃食物，越长越难",
    category: "休闲",
    titleKey: "game.snake.title",
    descKey: "game.snake.desc",
    categoryKey: "category.casual",
    icon: ThunderboltOutlined,
    component: SnakeGame,
  },
  {
    id: "minesweeper",
    title: "扫雷",
    desc: "标记地雷，揭开所有安全格",
    category: "益智",
    titleKey: "game.minesweeper.title",
    descKey: "game.minesweeper.desc",
    categoryKey: "category.puzzle",
    icon: BorderOutlined,
    component: MinesweeperGame,
  },
  {
    id: "scores",
    title: "排行榜",
    desc: "查看各游戏成绩记录与统计",
    category: "记录",
    titleKey: "game.scores.title",
    descKey: "game.scores.desc",
    categoryKey: "category.record",
    icon: TrophyOutlined,
    component: ScoresView,
  },
];

export const GAME_IDS = GAMES.map((g) => g.id);
export const DEFAULT_GAME = GAMES[0];
