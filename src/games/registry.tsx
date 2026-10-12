/*
 * 游戏注册表：所有游戏在此集中登记（id、标题、描述、图标、组件、分类）
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
  title: string;
  desc: string;
  icon: React.ComponentType<{ style?: React.CSSProperties }>;
  category: GameCategory;
  component: React.ComponentType<{ sdk: import("fat-notes-sdk").FatNotesPluginSDK }>;
}

export const GAMES: GameDef[] = [
  {
    id: "2048",
    title: "2048",
    desc: "合并数字方块，目标 2048",
    icon: AppstoreOutlined,
    category: "益智",
    component: Game2048,
  },
  {
    id: "snake",
    title: "贪吃蛇",
    desc: "控制蛇身吃食物，越长越难",
    icon: ThunderboltOutlined,
    category: "休闲",
    component: SnakeGame,
  },
  {
    id: "minesweeper",
    title: "扫雷",
    desc: "标记地雷，揭开所有安全格",
    icon: BorderOutlined,
    category: "益智",
    component: MinesweeperGame,
  },
  {
    id: "scores",
    title: "排行榜",
    desc: "查看各游戏成绩记录与统计",
    icon: TrophyOutlined,
    category: "记录",
    component: ScoresView,
  },
];

export const GAME_IDS = GAMES.map((g) => g.id);
export const DEFAULT_GAME = GAMES[0];
