/*
 * GameFrame：游戏统一舞台外壳
 *
 * 所有游戏共用的视觉容器：
 *   - 渐变背景 + 圆角 + 内阴影的“舞台”
 *   - 顶部标题栏（emoji + 标题 + 右侧操作区）
 *   - 统计胶囊行（StatChip）
 *   - 底部操作提示
 * 传入的 children 居中渲染，超出宽度时自适应缩小。
 */
import React, { useMemo } from "react";
import {
  STAGE_BG_DARK,
  STAGE_BG_LIGHT,
  STAGE_BORDER_DARK,
  STAGE_BORDER_LIGHT,
  STAGE_SHADOW,
  type ChipColors,
} from "./gameTheme";
import { useThemeMode } from "../ThemeShell";
import { sfxClick } from "./sound";
import "./gameAnimations.less";

// 供各游戏直接使用：统计胶囊配色
export {
  CHIP_GOLD,
  CHIP_GREEN,
  CHIP_BLUE,
  CHIP_PURPLE,
  CHIP_RED,
} from "./gameTheme";

export interface StatChipItem {
  label: string;
  value: React.ReactNode;
  colors?: ChipColors;
}

interface Props {
  /** 标题 emoji 图标 */
  emoji: string;
  title: string;
  /** 标题栏右侧操作区（按钮等） */
  headerExtra?: React.ReactNode;
  /** 统计胶囊行 */
  stats?: StatChipItem[];
  /** 底部操作提示 */
  help?: string;
  /** 舞台最大宽度（默认 560，棋盘类游戏可传更宽） */
  maxWidth?: number;
  /** 内容区是否上下留白居中（默认 true） */
  padded?: boolean;
  children: React.ReactNode;
}

/** 统计胶囊：渐变底 + 标签/数值 */
export function StatChip({
  label,
  value,
  colors,
}: {
  label: string;
  value: React.ReactNode;
  colors?: ChipColors;
}): React.ReactElement {
  const c = colors;
  const style: React.CSSProperties = c
    ? {
        background: c.bg,
        boxShadow: "0 3px 10px rgba(0,0,0,0.14)",
      }
    : {
        background: "rgba(128,128,128,0.08)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
      };
  const labelColor = c ? c.label : "rgba(0,0,0,0.5)";
  const valueColor = c ? c.value : "rgba(0,0,0,0.85)";
  return (
    <div
      style={{
        ...style,
        minWidth: 88,
        padding: "7px 14px",
        borderRadius: 14,
        display: "flex",
        flexDirection: "column",
        gap: 1,
        lineHeight: 1.25,
      }}
    >
      <span style={{ fontSize: 11, color: labelColor }}>{label}</span>
      <span
        style={{ fontSize: 19, fontWeight: 800, color: valueColor }}
      >
        {value}
      </span>
    </div>
  );
}

/** 主操作按钮（渐变蓝） */
export function PrimaryBtn({
  onClick,
  children,
  disabled,
  danger,
}: {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  danger?: boolean;
}): React.ReactElement {
  const bg = danger
    ? "linear-gradient(135deg, #ff7a70 0%, #e5484d 100%)"
    : "linear-gradient(135deg, #4facfe 0%, #1677ff 100%)";
  return (
    <button
      type="button"
      onClick={() => {
        sfxClick();
        onClick();
      }}
      disabled={disabled}
      style={{
        background: bg,
        color: "#fff",
        border: "none",
        borderRadius: 20,
        padding: "7px 18px",
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        boxShadow: "0 3px 10px rgba(22,119,255,0.28)",
        transition: "transform 0.12s ease, box-shadow 0.12s ease, opacity 0.12s ease",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.transform = "translateY(-1px)";
          e.currentTarget.style.boxShadow = "0 5px 14px rgba(22,119,255,0.35)";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "0 3px 10px rgba(22,119,255,0.28)";
      }}
    >
      {children}
    </button>
  );
}

/** 次操作按钮（浅色描边） */
export function GhostBtn({
  onClick,
  children,
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}): React.ReactElement {
  const isDark = useThemeMode();
  return (
    <button
      type="button"
      onClick={() => {
        sfxClick();
        onClick();
      }}
      disabled={disabled}
      style={{
        background: isDark ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.9)",
        color: isDark ? "rgba(255,255,255,0.88)" : "rgba(0,0,0,0.75)",
        border: `1px solid ${isDark ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.18)"}`,
        borderRadius: 20,
        padding: "6px 16px",
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
        transition: "transform 0.12s ease, box-shadow 0.12s ease",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.transform = "translateY(-1px)";
          e.currentTarget.style.boxShadow = "0 4px 12px rgba(0,0,0,0.12)";
        }
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {children}
    </button>
  );
}

const GameFrame: React.FC<Props> = ({
  emoji,
  title,
  headerExtra,
  stats,
  help,
  maxWidth = 560,
  padded = true,
  children,
}) => {
  const isDark = useThemeMode();

  const stageStyle = useMemo<React.CSSProperties>(
    () => ({
      background: isDark ? STAGE_BG_DARK : STAGE_BG_LIGHT,
      border: `1px solid ${isDark ? STAGE_BORDER_DARK : STAGE_BORDER_LIGHT}`,
      boxShadow: STAGE_SHADOW,
      borderRadius: 18,
      maxWidth,
      alignSelf: "center",
      width: "100%",
      overflow: "hidden",
    }),
    [isDark, maxWidth],
  );

  return (
    <div
      className="gs-stage-in"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 14,
      }}
    >
      <div style={stageStyle}>
        {/* 标题栏 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "12px 16px",
            borderBottom: `1px solid ${isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.06)"}`,
          }}
        >
          <span style={{ fontSize: 22, lineHeight: 1 }}>{emoji}</span>
          <span
            style={{
              fontSize: 16,
              fontWeight: 800,
              color: isDark ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.85)",
            }}
          >
            {title}
          </span>
          <div style={{ flex: 1 }} />
          {headerExtra}
        </div>

        {/* 统计行 */}
        {stats && stats.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              padding: "12px 16px 0",
            }}
          >
            {stats.map((s, idx) => (
              <StatChip
                key={idx}
                label={s.label}
                value={s.value}
                colors={s.colors}
              />
            ))}
          </div>
        )}

        {/* 内容区 */}
        <div
          style={{
            padding: padded ? "16px 16px 18px" : "10px 16px 16px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          {children}
        </div>
      </div>

      {help && (
        <div
          style={{
            fontSize: 12,
            color: isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.5)",
            textAlign: "center",
            padding: "0 12px",
            maxWidth,
          }}
        >
          {help}
        </div>
      )}
    </div>
  );
};

export default GameFrame;
