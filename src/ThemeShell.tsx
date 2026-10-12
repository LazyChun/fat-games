/*
 * ThemeShell：跟随宿主 light/dark 主题，为插件内的 antd 组件注入对应算法。
 */
import React, { useEffect, useMemo, useState } from "react";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import { ConfigProvider, theme as antdTheme } from "antd";

interface Props {
  sdk: FatNotesPluginSDK;
  /** 内边距，默认 12 */
  padding?: number;
  children: React.ReactNode;
}

const ThemeShell: React.FC<Props> = ({ sdk, padding = 12, children }) => {
  const [theme, setTheme] = useState<string>(() => {
    try {
      return sdk.ui.theme.get();
    } catch {
      return "light";
    }
  });

  useEffect(() => {
    let disposed = false;
    const d = sdk.ui.theme.onChange((next) => {
      if (!disposed) setTheme(next);
    });
    return () => {
      disposed = true;
      d.dispose();
    };
  }, [sdk]);

  const isDark = theme === "dark";

  const themeConfig = useMemo(
    () => ({
      algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      token: { fontSize: 13 },
    }),
    [isDark],
  );

  return (
    <ConfigProvider theme={themeConfig}>
      <div
        style={{
          height: "100%",
          minHeight: 0,
          padding,
          boxSizing: "border-box",
          overflow: "auto",
          color: isDark ? "rgba(255,255,255,0.88)" : "rgba(0,0,0,0.88)",
        }}
      >
        {children}
      </div>
    </ConfigProvider>
  );
};

export default ThemeShell;
