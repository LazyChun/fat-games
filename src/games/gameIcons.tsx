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

/** 逆火战轰：侧视轰炸机（机身 + 座舱 + 后掠翼 + 尾翼）+ 投放的炸弹 */
export const IconBackfire: React.FC<GameIconProps> = (props) => (
  <svg {...svgProps(props)}>
    <path d="M3.8 12.4 H16.6 Q20 12.4 20.8 13 Q20 13.6 16.6 13.6 H3.8 Q2.6 13.6 2.6 13 Q2.6 12.4 3.8 12.4 Z" />
    <path d="M8 12.4 Q8.4 10.2 10.4 10.2 Q12.2 10.2 12.2 12.4" />
    <path d="M12.8 13.6 L11.4 17.4 H14.8 L16 13.6" />
    <path d="M16.2 12.4 L17.4 8.6 L18.8 12.4" />
    <path d="M8.2 16.9 V17.6" />
    <path d="M7.1 17.6 H9.3" />
    <circle cx="8.2" cy="19" r="1.5" />
  </svg>
);

/** 星舰回收：竖直着陆星舰（机身 + 机头锥 + 舷窗 + 尾翼 + 上下左右四个喷口） */
export const IconRocket: React.FC<GameIconProps> = (props) => (
  <svg {...svgProps(props)}>
    <path d="M12 3.4 L14.8 9 L19.6 10.4 L14.8 11.8 L12 17.6 L9.2 11.8 L4.4 10.4 L9.2 9 Z" />
    <path d="M12 6.8 V16.4" strokeWidth={1.2} />
    <circle cx="12" cy="9.4" r="1.7" />
    <path d="M10.4 17.6 V20.4 M13.6 17.6 V20.4 M12 20.4 V21.6" />
    <path d="M7.4 10.4 L4.6 9.2 M16.6 10.4 L19.4 9.2" />
  </svg>
);

/** 引力弹弓：探测器飞掠行星引力井，弯曲航线（行星 + 椭圆轨道弧 + 探测器） */
export const IconSlingshot: React.FC<GameIconProps> = (props) => (
  <svg {...svgProps(props)}>
    <circle cx="9" cy="14.5" r="3.4" />
    <path d="M9 17.9 V21" />
    <path d="M6.8 19.6 H11.2" />
    <path d="M18.6 7.4 Q10.6 3.6 7.4 11.2" strokeDasharray="2.4 2.2" />
    <path d="M14.8 12.4 L18.4 6.6 L19.8 12" />
    <circle cx="18.8" cy="6.4" r="1.5" fill="currentColor" stroke="none" />
  </svg>
);

/** 数字华容道：4x4 网格 + 一个可滑动的实心方块 */
export const IconSliding: React.FC<GameIconProps> = (props) => (
  <svg {...svgProps(props)}>
    <path d="M5.2 5.2 H18.8 V18.8 H5.2 Z" />
    <path d="M5.2 9.8 H18.8 M5.2 14.4 H18.8 M9.8 5.2 V18.8 M14.4 5.2 V18.8" />
    <rect
      x="9.8"
      y="5.2"
      width="4.6"
      height="4.6"
      rx="1.2"
      fill="currentColor"
      stroke="none"
    />
  </svg>
);

/** 冰壶：冰道两条边线 + 大本营同心圆 + 带手柄的冰壶 */
export const IconCurling: React.FC<GameIconProps> = (props) => (
  <svg {...svgProps(props)}>
    <path d="M4 6.6 H20 M4 17.4 H20" opacity="0.5" />
    <circle cx="8.6" cy="12" r="5.4" />
    <circle cx="8.6" cy="12" r="3.5" />
    <circle cx="8.6" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="16.4" cy="12" r="3.2" fill="currentColor" stroke="none" />
    <circle cx="16.4" cy="12" r="1.5" />
    <path d="M14.6 9.6 Q16.4 8.2 18.2 9.6" />
  </svg>
);

/** 3D 台球：球台（外框 + 毛呢 + 六袋）+ 一颗实心球 + 白球 + 球杆 */
export const IconPool: React.FC<GameIconProps> = (props) => (
  <svg {...svgProps(props)}>
    <rect x="3.2" y="4.6" width="17.6" height="14.8" rx="3.6" />
    <rect x="5.6" y="7" width="12.8" height="10" rx="2.6" />
    <circle cx="5.2" cy="6.6" r="1.05" fill="currentColor" stroke="none" opacity="0.85" />
    <circle cx="18.8" cy="6.6" r="1.05" fill="currentColor" stroke="none" opacity="0.85" />
    <circle cx="5.2" cy="17.4" r="1.05" fill="currentColor" stroke="none" opacity="0.85" />
    <circle cx="18.8" cy="17.4" r="1.05" fill="currentColor" stroke="none" opacity="0.85" />
    <circle cx="12" cy="6.6" r="1.05" fill="currentColor" stroke="none" opacity="0.85" />
    <circle cx="12" cy="17.4" r="1.05" fill="currentColor" stroke="none" opacity="0.85" />
    <circle cx="8.1" cy="13.4" r="1.7" fill="currentColor" stroke="none" />
    <circle cx="13.9" cy="13.4" r="1.7" />
    <path d="M15.6 13.4 L19.8 13.4" strokeWidth={2} />
  </svg>
);

/** 跨栏冲刺：栏架（横板 + 双腿）+ 腾空跨过的运动员 */
export const IconHurdle: React.FC<GameIconProps> = (props) => (
  <svg {...svgProps(props)}>
    <path d="M5.5 14.6 H18.5" />
    <path d="M7.5 14.6 V19.4 M16.5 14.6 V19.4" />
    <circle cx="11.6" cy="6.2" r="2" />
    <path d="M11.6 8.2 Q11.6 11.6 9.6 13.2" strokeWidth={2.4} />
    <path d="M11.4 9 L13.3 10.8" />
    <path d="M9.6 13.2 L7.8 15.2 M9.6 13.2 L11.6 15" />
  </svg>
);

/** 反弹神射：拉开的弓 + 搭弦待发的箭（弓臂 + 弓弦 + 箭杆 + 箭头） */
export const IconArchery: React.FC<GameIconProps> = (props) => (
  <svg {...svgProps(props)}>
    <path d="M5.2 5.4 Q15.6 4.2 5.2 18.6" />
    <path d="M5.2 5.4 V18.6" strokeWidth={1.2} />
    <path d="M7 11.9 L18 7.6" />
    <path d="M19.4 6.9 L15 8.9 L17.8 11.6 Z" fill="currentColor" stroke="none" />
    <path d="M7 11.9 L5.2 10.4 M7 11.9 L5.2 13.4" strokeWidth={1.2} />
  </svg>
);

/** 快乐消消：三颗糖果成排，中间一颗错位待交换 */
export const IconMatch: React.FC<GameIconProps> = (props) => (
  <svg {...svgProps(props)}>
    <rect x="3.6" y="8.2" width="6" height="6" rx="1.8" />
    <rect x="9.6" y="12" width="6" height="6" rx="1.8" fill="currentColor" stroke="none" />
    <rect x="15.6" y="8.2" width="6" height="6" rx="1.8" />
  </svg>
);

/** 老鹰抓小鸡：母鸡护着身后的小鸡（身体 + 鸡冠 + 喙 + 尾羽 + 小鸡） */
export const IconHawkChicken: React.FC<GameIconProps> = (props) => (
  <svg {...svgProps(props)}>
    <ellipse cx="10.4" cy="13.2" rx="6" ry="4.3" />
    <circle cx="15.4" cy="9.6" r="2.5" />
    <path d="M14 7.8 Q15 5.6 16 7.7 M15.2 7.2 Q16.4 5 17.4 7.1" />
    <path d="M17.6 9.6 L20.2 10 L17.6 10.7" />
    <path d="M5.6 12.4 Q3 14.6 5.2 16.8" />
    <path d="M5.4 15.4 Q3.6 15.6 4.2 14" />
    <circle cx="8.6" cy="18.9" r="2.1" />
    <path d="M10.4 18.9 L12.2 19.2 L10.4 19.6" />
  </svg>
);

/** 龟兔赛跑：前方飞奔的兔子 + 后方稳爬的乌龟（寓言名场面） */
export const IconTortoiseHare: React.FC<GameIconProps> = (props) => (
  <svg {...svgProps(props)}>
    <path d="M3 18.8 H21" strokeDasharray="3 2.4" opacity="0.65" />
    {/* 兔子（前）：身体 + 头 + 竖耳 + 圆尾 + 奔跑腿 */}
    <ellipse cx="16.6" cy="12.6" rx="3.9" ry="3.1" />
    <ellipse cx="20.3" cy="10.2" rx="2.3" ry="2" />
    <path d="M19.1 8.7 V5.3 M21.5 8.7 V5.3" />
    <circle cx="12.4" cy="12.9" r="2.5" />
    <path d="M15.6 15.3 L15 18.2 M17.5 15.3 L18 18.2" />
    {/* 乌龟（后）：壳 + 头 + 腿 */}
    <ellipse cx="6.4" cy="13.6" rx="3.3" ry="2.7" />
    <circle cx="9.5" cy="11.7" r="1.8" />
    <path d="M4.5 16 L4.5 18.4 M8.1 16 L8.1 18.4" />
  </svg>
);

/** 剥橘子：圆形橘子 + 顶部掀起的一角卷皮 + 瓣缝与果脐 */
export const IconOrange: React.FC<GameIconProps> = (props) => (
  <svg {...svgProps(props)}>
    {/* 橘子本体 */}
    <circle cx="12" cy="13.4" r="7.6" />
    {/* 瓣缝 */}
    <path d="M12 5.8 V21 M6.9 8.6 L17.1 18.2 M17.1 8.6 L6.9 18.2" opacity="0.5" />
    {/* 果脐 */}
    <circle cx="12" cy="13.4" r="1.8" fill="currentColor" stroke="none" opacity="0.5" />
    {/* 顶部掀起的一角皮（向左卷起）+ 果柄 */}
    <path d="M12 5.8 Q8.4 2.2 5.6 4.4 Q6 8.6 9.4 9.4" />
    <path d="M9.4 9.4 Q10.4 7.2 8.4 6.4" />
    <path d="M12 5.8 V3.4" />
  </svg>
);

/** 猫狗大战：猫咪（尖耳 + 胡须）与狗狗（垂耳）对峙，中间一记闪电 */
export const IconCatDog: React.FC<GameIconProps> = (props) => (
  <svg {...svgProps(props)}>
    {/* 猫（左）：圆脸 + 尖耳 + 胡须 */}
    <circle cx="8.4" cy="13.4" r="4.6" />
    <path d="M5.2 10.2 L5.8 5.6 L8.6 8.4" />
    <path d="M11.6 10.2 L11 5.6 L8.2 8.4" />
    <circle cx="6.9" cy="12.8" r="0.75" fill="currentColor" stroke="none" />
    <circle cx="9.9" cy="12.8" r="0.75" fill="currentColor" stroke="none" />
    <path d="M4.4 14.8 L6.4 15.4 M12.4 15.4 L10.4 14.8" strokeWidth={1.2} />
    {/* 狗（右）：圆脸 + 垂耳 + 鼻 */}
    <circle cx="15.8" cy="13.4" r="4.6" />
    <path d="M11.9 10.6 Q10.4 6.8 12.6 6.4 Q14.2 6.4 13.6 9.4" />
    <path d="M19.7 10.6 Q21.2 6.8 19 6.4 Q17.4 6.4 18 9.4" />
    <circle cx="15.8" cy="14.6" r="0.95" fill="currentColor" stroke="none" />
    <path d="M15.8 15.5 Q15.8 16.4 16.9 16.4" strokeWidth={1.2} />
    {/* 中间闪电 */}
    <path d="M12.1 9.6 L11.1 12.2 L12.3 12.2 L11.5 14.6" strokeWidth={1.5} />
  </svg>
);

/** 猪猪的远望：圆脸小猪 + 三角耳 + 椭圆猪鼻双鼻孔 */
export const IconPig: React.FC<GameIconProps> = (props) => (
  <svg {...svgProps(props)}>
    {/* 圆脸 */}
    <circle cx="12" cy="13.4" r="6.6" />
    {/* 三角耳 */}
    <path d="M7.4 9.6 L6.6 5.6 L10 7.6" />
    <path d="M16.6 9.6 L17.4 5.6 L14 7.6" />
    {/* 猪鼻 */}
    <ellipse cx="12" cy="14.6" rx="2.6" ry="1.8" />
    <circle cx="11.1" cy="14.6" r="0.45" fill="currentColor" stroke="none" />
    <circle cx="12.9" cy="14.6" r="0.45" fill="currentColor" stroke="none" />
    {/* 眼睛 */}
    <circle cx="9.6" cy="11.6" r="0.6" fill="currentColor" stroke="none" />
    <circle cx="14.4" cy="11.6" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);
