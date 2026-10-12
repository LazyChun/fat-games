/*
 * ThemeShell：跟随宿主 light/dark 主题，为插件内的 antd 组件注入对应算法，
 * 并通过 IntlProvider 提供国际化（参考 fat-stock 的 InitSdk 模式）。
 */
import React, { useEffect, useMemo, useState } from "react";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import { ConfigProvider, theme as antdTheme } from "antd";
import { IntlProvider } from "react-intl";
import cn from "./locales/zh_CN";
import en from "./locales/en_US";

interface Props {
  sdk: FatNotesPluginSDK;
  /** 内边距，默认 12 */
  padding?: number;
  children: React.ReactNode;
}

const DEFAULT_LOCALE = "zh_CN";

/** 将宿主 locale 归一化为当前插件支持的语言包 key */
const normalizeLocale = (locale?: string): string => {
  if (!locale) return DEFAULT_LOCALE;
  const normalized = locale.replace("-", "_");
  if (normalized === "zh_CN" || normalized.startsWith("zh")) return "zh_CN";
  if (normalized === "en_US" || normalized.startsWith("en")) return "en_US";
  return DEFAULT_LOCALE;
};

const LANG_MAP: Record<string, Record<string, string>> = {
  zh_CN: cn,
  en_US: en,
};

const ThemeShell: React.FC<Props> = ({ sdk, padding = 12, children }) => {
  const [theme, setTheme] = useState<string>(() => {
    try {
      return sdk.ui.theme.get();
    } catch {
      return "light";
    }
  });

  const [locale, setLocale] = useState<string>(() =>
    normalizeLocale(sdk.ui.i18n.locale),
  );
  const [hostMessages, setHostMessages] = useState<Record<string, string>>({});

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

  useEffect(() => {
    const applyLocale = (nextLocale: string) => {
      const normalized = normalizeLocale(nextLocale);
      setLocale(normalized);
      try {
        setHostMessages(sdk.ui.i18n.getMessages() || {});
      } catch {
        setHostMessages({});
      }
    };
    applyLocale(sdk.ui.i18n.locale);
    const disposable = sdk.ui.i18n.onChange(applyLocale);
    return () => disposable.dispose();
  }, [sdk]);

  const isDark = theme === "dark";

  const themeConfig = useMemo(
    () => ({
      algorithm: isDark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
      token: { fontSize: 13 },
    }),
    [isDark],
  );

  const messages = useMemo(() => {
    const pluginMessages = LANG_MAP[locale] || LANG_MAP[DEFAULT_LOCALE];
    return { ...hostMessages, ...pluginMessages };
  }, [hostMessages, locale]);

  return (
    <ConfigProvider theme={themeConfig}>
      <IntlProvider locale={locale.replace("_", "-")} messages={messages}>
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
      </IntlProvider>
    </ConfigProvider>
  );
};

export default ThemeShell;
