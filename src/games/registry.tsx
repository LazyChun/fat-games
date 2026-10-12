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
  Icon2048,
  IconTetris,
  IconSnake,
  IconMinesweeper,
  IconMemory,
  IconWhack,
  IconGomoku,
  IconRubik,
  IconGoldMiner,
  IconPingPong,
  IconThunder,
  IconTank,
  IconBackfire,
  IconScores,
} from "./gameIcons";

import Game2048 from "./Game2048";
import SnakeGame from "./SnakeGame";
import MinesweeperGame from "./MinesweeperGame";
import TetrisGame from "./TetrisGame";
import MemoryGame from "./MemoryGame";
import WhackGame from "./WhackGame";
import GomokuGame from "./GomokuGame";
import RubikCubeGame from "./RubikCubeGame";
import GoldMinerGame from "./GoldMinerGame";
import PingPongGame from "./PingPongGame";
import ThunderFighterGame from "./ThunderFighterGame";
import TankBattleGame from "./TankBattleGame";
import BackfireBomberGame from "./BackfireBomberGame";
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
    icon: Icon2048,
    component: Game2048,
  },
  {
    id: "tetris",
    title: "俄罗斯方块",
    desc: "消除横条，挑战更高等级",
    category: "休闲",
    titleKey: "game.tetris.title",
    descKey: "game.tetris.desc",
    categoryKey: "category.casual",
    icon: IconTetris,
    component: TetrisGame,
  },
  {
    id: "snake",
    title: "贪吃蛇",
    desc: "控制蛇身吃食物，越长越难",
    category: "休闲",
    titleKey: "game.snake.title",
    descKey: "game.snake.desc",
    categoryKey: "category.casual",
    icon: IconSnake,
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
    icon: IconMinesweeper,
    component: MinesweeperGame,
  },
  {
    id: "memory",
    title: "记忆翻牌",
    desc: "翻开卡片，找出所有配对",
    category: "益智",
    titleKey: "game.memory.title",
    descKey: "game.memory.desc",
    categoryKey: "category.puzzle",
    icon: IconMemory,
    component: MemoryGame,
  },
  {
    id: "whack",
    title: "打地鼠",
    desc: "手速挑战，30 秒能打多少只",
    category: "休闲",
    titleKey: "game.whack.title",
    descKey: "game.whack.desc",
    categoryKey: "category.casual",
    icon: IconWhack,
    component: WhackGame,
  },
  {
    id: "gomoku",
    title: "五子棋",
    desc: "执黑先手，与 AI 对弈五连",
    category: "益智",
    titleKey: "game.gomoku.title",
    descKey: "game.gomoku.desc",
    categoryKey: "category.puzzle",
    icon: IconGomoku,
    component: GomokuGame,
  },
  {
    id: "rubik",
    title: "3D 魔方",
    desc: "拖动视角，转动层块还原六面",
    category: "益智",
    titleKey: "game.rubik.title",
    descKey: "game.rubik.desc",
    categoryKey: "category.puzzle",
    icon: IconRubik,
    component: RubikCubeGame,
  },
  {
    id: "goldminer",
    title: "黄金矿工",
    desc: "放爪抓金块，限时凑够目标",
    category: "休闲",
    titleKey: "game.goldminer.title",
    descKey: "game.goldminer.desc",
    categoryKey: "category.casual",
    icon: IconGoldMiner,
    component: GoldMinerGame,
  },
  {
    id: "pingpong",
    title: "乒乓",
    desc: "左右击球，先得 7 分获胜",
    category: "休闲",
    titleKey: "game.pingpong.title",
    descKey: "game.pingpong.desc",
    categoryKey: "category.casual",
    icon: IconPingPong,
    component: PingPongGame,
  },
  {
    id: "thunder",
    title: "战鹰雷霆",
    desc: "驾驶战机，击落来袭敌机",
    category: "休闲",
    titleKey: "game.thunder.title",
    descKey: "game.thunder.desc",
    categoryKey: "category.casual",
    icon: IconThunder,
    component: ThunderFighterGame,
  },
  {
    id: "tankbattle",
    title: "坦克对决",
    desc: "3D 战场驾驶坦克，击毁全部敌军",
    category: "休闲",
    titleKey: "game.tankbattle.title",
    descKey: "game.tankbattle.desc",
    categoryKey: "category.casual",
    icon: IconTank,
    component: TankBattleGame,
  },
  {
    id: "backfire",
    title: "逆火战轰",
    desc: "驾驶轰炸机，投弹摧毁地面目标",
    category: "休闲",
    titleKey: "game.backfire.title",
    descKey: "game.backfire.desc",
    categoryKey: "category.casual",
    icon: IconBackfire,
    component: BackfireBomberGame,
  },
  {
    id: "scores",
    title: "排行榜",
    desc: "查看各游戏成绩记录与统计",
    category: "记录",
    titleKey: "game.scores.title",
    descKey: "game.scores.desc",
    categoryKey: "category.record",
    icon: IconScores,
    component: ScoresView,
  },
];

export const GAME_IDS = GAMES.map((g) => g.id);
export const DEFAULT_GAME = GAMES[0];
