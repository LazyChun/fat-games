/*
 * gameIcons：左侧菜单卡片专属图标集
 *
 * 每个游戏一个手绘 SVG 图标（24x24 viewBox，线性风格，currentColor 描边），
 * 直接表达该游戏的核心形象，替代 @ant-design/icons 的通用图标。
 * 组件接口与 antd 图标一致：接收 style，尺寸跟随 fontSize（width/height: 1em）。
 */
import React from "react";

export interface GameIconProps {
  style?: React.CSSProperties;
}

/** 统一 SVG 基础属性：尺寸跟随 fontSize、颜色跟随 currentColor */
const svgProps = (
  props: GameIconProps,
  extra?: React.SVGProps<SVGSVGElement>,
): React.SVGProps<SVGSVGElement> => ({
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.8,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  width: "1em",
  height: "1em",
  style: props.style,
  ...extra,
});

/** 2048：2x2 数字方块网格，左上格实心 */
export const Icon2048: React.FC<GameIconProps> = (props) => (
  <svg {...svgProps(props)}>
    <rect
      x="3.5"
      y="3.5"
      width="7.4"
      height="7.4"
      rx="1.6"
      fill="currentColor"
      stroke="none"
    />
    <rect x="13.1" y="3.5" width="7.4" height="7.4" rx="1.6" />
    <rect x="3.5" y="13.1" width="7.4" height="7.4" rx="1.6" />
    <rect x="13.1" y="13.1" width="7.4" height="7.4" rx="1.6" />
  </svg>
);

/** 俄罗斯方块：T 形四格方块 */
export const IconTetris: React.FC<GameIconProps> = (props) => (
  <svg {...svgProps(props)}>
    <rect x="4" y="4" width="5" height="5" rx="1.2" />
    <rect x="9.5" y="4" width="5" height="5" rx="1.2" />
    <rect x="15" y="4" width="5" height="5" rx="1.2" />
    <rect x="9.5" y="9.5" width="5" height="5" rx="1.2" />
  </svg>
);

/** 贪吃蛇：S 形蛇身 + 圆环蛇头 + 眼睛 */
export const IconSnake: React.FC<GameIconProps> = (props) => (
  <svg {...svgProps(props)}>
    <path
      d="M4.5 14 Q7.8 14.2 8.6 11.8 Q9.4 9.4 11.8 9.4 Q14.2 9.4 15.2 11.6 Q15.9 13.3 17.5 12"
      strokeWidth={2.3}
    />
    <circle cx="17.7" cy="9.5" r="2.7" />
    <circle cx="18.6" cy="8.5" r="0.7" fill="currentColor" stroke="none" />
  </svg>
);

/** 扫雷：地雷（弹体 + 引线 + 四根触角） */
export const IconMinesweeper: React.FC<GameIconProps> = (props) => (
  <svg {...svgProps(props)}>
    <circle cx="12" cy="13.6" r="5.2" />
    <path d="M12 8.4 V4.8" />
    <circle cx="12" cy="3.9" r="1" fill="currentColor" stroke="none" />
    <path d="M8 10.6 L5 8.8" />
    <path d="M16 10.6 L19 8.8" />
    <path d="M7.4 15.4 L4.6 16.2" />
    <path d="M16.6 15.4 L19.4 16.2" />
  </svg>
);

/** 记忆翻牌：一张倾斜的背面卡 + 一张带心形的正面卡 */
export const IconMemory: React.FC<GameIconProps> = (props) => (
  <svg {...svgProps(props)}>
    <g transform="rotate(-10 8.6 12.2)">
      <rect x="4" y="6.2" width="9.2" height="12" rx="1.6" />
      <path d="M5.6 9.6 h3.2 M5.6 12.4 h3.2 M5.6 15.2 h3.2" />
    </g>
    <rect x="11" y="5" width="9.2" height="12" rx="1.6" />
    <path d="M15.6 9.6 c-1-1.1-2.7-.2-2.7 1.2 0 1.5 2.7 3.1 2.7 3.1 s2.7-1.6 2.7-3.1 c0-1.4-1.7-2.3-2.7-1.2z" />
  </svg>
);

/** 打地鼠：洞口 + 探出头的地鼠（耳朵、眼睛、鼻子） */
export const IconWhack: React.FC<GameIconProps> = (props) => (
  <svg {...svgProps(props)}>
    <path d="M4.5 18.6 Q4.5 12.8 12 12.8 Q19.5 12.8 19.5 18.6" />
    <circle cx="12" cy="11.2" r="4.1" />
    <circle cx="9.2" cy="8" r="1.7" />
    <circle cx="14.8" cy="8" r="1.7" />
    <circle cx="10.7" cy="11.2" r="0.7" fill="currentColor" stroke="none" />
    <circle cx="13.3" cy="11.2" r="0.7" fill="currentColor" stroke="none" />
    <circle cx="12" cy="13" r="0.9" fill="currentColor" stroke="none" />
  </svg>
);

/** 五子棋：棋盘交叉线 + 黑子白子 */
export const IconGomoku: React.FC<GameIconProps> = (props) => (
  <svg {...svgProps(props)}>
    <path d="M10 6.2 V17.8 M14 6.2 V17.8 M6.2 10 H17.8 M6.2 14 H17.8" />
    <circle cx="10" cy="10" r="2.4" fill="currentColor" stroke="none" />
    <circle cx="14" cy="14" r="2.4" />
  </svg>
);

/** 3D 魔方：3x3 九宫格，对角两格实心 */
export const IconRubik: React.FC<GameIconProps> = (props) => (
  <svg {...svgProps(props)}>
    <path d="M7 7 H18 M7 12.5 H18 M7 18 H18 M7 7 V18 M12.5 7 V18 M18 7 V18" />
    <rect
      x="7"
      y="7"
      width="5.5"
      height="5.5"
      fill="currentColor"
      stroke="none"
    />
    <rect
      x="12.5"
      y="12.5"
      width="5.5"
      height="5.5"
      fill="currentColor"
      stroke="none"
    />
  </svg>
);

/** 黄金矿工：金块宝石 + 刻面 */
export const IconGoldMiner: React.FC<GameIconProps> = (props) => (
  <svg {...svgProps(props)}>
    <path d="M12 4.2 L17.8 9 L14.6 19.2 H9.4 L6.2 9 Z" />
    <path d="M12 4.2 L9.1 9 L12 13.6 L14.9 9 Z" />
    <path d="M9.1 9 H14.9 M10.1 19.2 L10.6 13.6 M13.9 19.2 L13.4 13.6" />
  </svg>
);

/** 乒乓：左右两个球拍 + 中间小球 */
export const IconPingPong: React.FC<GameIconProps> = (props) => (
  <svg {...svgProps(props)}>
    <circle cx="7" cy="9.8" r="3.7" />
    <path d="M7 13.5 V17.6" />
    <circle cx="17" cy="14.2" r="3.7" />
    <path d="M17 10.5 V6.4" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
  </svg>
);

/** 战鹰雷霆：向上飞行的战斗机（机翼 + 机身中轴） */
export const IconThunder: React.FC<GameIconProps> = (props) => (
  <svg {...svgProps(props)}>
    <path d="M12 3.2 L15.2 9.8 L20.5 11.8 L15.2 13.8 L12 20.8 L8.8 13.8 L3.5 11.8 L8.8 9.8 Z" />
    <path d="M12 6.6 V18.6" strokeWidth={1.2} />
  </svg>
);

/** 排行榜：奖杯（杯身 + 双把手 + 底座） */
export const IconScores: React.FC<GameIconProps> = (props) => (
  <svg {...svgProps(props)}>
    <path d="M8.2 4.8 H15.8 V9.6 C15.8 12.6 14 13.9 12 13.9 C10 13.9 8.2 12.6 8.2 9.6 Z" />
    <path d="M8.2 6.2 H5.6 C5.6 9.2 6.7 10.8 8.2 11.4" />
    <path d="M15.8 6.2 H18.4 C18.4 9.2 17.3 10.8 15.8 11.4" />
    <path d="M10.6 13.9 H13.4 V16 H10.6 Z" />
    <path d="M8.6 16 H15.4 V18.4 H8.6 Z" />
  </svg>
);

/** 坦克对决：俯视坦克（履带车身 + 炮塔 + 炮管） */
export const IconTank: React.FC<GameIconProps> = (props) => (
  <svg {...svgProps(props)}>
    <rect x="3.2" y="7.6" width="17.6" height="8.8" rx="3.4" />
    <path d="M6.8 7.6 V5.4 M17.2 7.6 V5.4 M6.8 18.6 V16.4 M17.2 18.6 V16.4" />
    <circle cx="12" cy="12" r="4.8" />
    <path d="M16 12 H20.8" strokeWidth={2.2} />
    <circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none" />
  </svg>
);
