/*
 * 「游戏」仪表盘卡片图标（内联 SVG data-URI）
 *
 * 宿主添加组件菜单把 iconUrl 直接塞进 <img src>，插件静态资源没有
 * 独立公开根路径，相对/绝对路径都会 404，因此用 data-URI 内联最可靠
 * （与 fat-chess/src/assets/chessIcon.ts、fat-tools toolSwitcherIcon 相同做法）。
 *
 * 配色用蓝色系，与「棋游」紫色卡片区分开。
 */

const GAMEPAD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <rect x="4" y="4" width="40" height="40" rx="10" fill="#1677ff"/>
  <path d="M14 18 h20 a6 6 0 0 1 5.8 7.6 l-1.6 5.4 a4.5 4.5 0 0 1 -8.3 1.1 l-2.1 -4.1 h-7.6 l-2.1 4.1 a4.5 4.5 0 0 1 -8.3 -1.1 l-1.6 -5.4 A6 6 0 0 1 14 18 Z" fill="#ffffff"/>
  <rect x="14.5" y="21.5" width="6" height="2" rx="1" fill="#1677ff"/>
  <rect x="16.5" y="19.5" width="2" height="6" rx="1" fill="#1677ff"/>
  <circle cx="31.5" cy="21.5" r="1.3" fill="#1677ff"/>
  <circle cx="34" cy="24" r="1.3" fill="#1677ff" opacity="0.7"/>
</svg>`;

export const GAME_BLOCK_ICON_URL = `data:image/svg+xml;utf8,${encodeURIComponent(
  GAMEPAD_SVG,
)}`;
