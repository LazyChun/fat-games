/*
 * RaceGame 独立预览壳（仅用于本地视觉验证，不属于插件产物）
 * 自动演示：模拟玩家"按住 12s / 松手 8s"的节奏循环（会自然积累睡意、睡着），
 * 通过读取画布像素检测"唤醒提示条"出现后自动连点唤醒；定时使用三个道具，
 * 验证完整对局流程（开始 → 睡意/唤醒 → 道具 → 胜负结算）。
 */
import React from "react";
import { createRoot } from "react-dom/client";
import ThemeShell from "../src/ThemeShell";
import RaceGame from "../src/games/RaceGame";
import type { FatNotesPluginSDK } from "fat-notes-sdk";

const mockSdk = {
  ui: {
    theme: {
      get: () => "light",
      onChange: () => ({ dispose() {} }),
    },
    i18n: {
      locale: "zh_CN",
      getMessages: () => ({}),
      onChange: () => ({ dispose() {} }),
    },
  },
} as unknown as FatNotesPluginSDK;

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(
    <ThemeShell sdk={mockSdk} padding={20}>
      <RaceGame sdk={mockSdk} />
    </ThemeShell>,
  );
}

const press = (key: string, dur = 40): void => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key }));
  setTimeout(() => window.dispatchEvent(new KeyboardEvent("keyup", { key })), dur);
};

// 0.6s 后开始比赛（仅 window.__demoEnabled===true 时）
setTimeout(() => {
  if (window.__demoEnabled === true) press(" ");
}, 600);

// 节奏循环：按住 12s / 松 8s（每 100ms 一拍，20s 周期；仅 window.__demoEnabled===true 时运行）
let tick = 0;
setInterval(() => {
  if (window.__demoEnabled !== true) return;
  tick += 1;
  const phase = tick % 200;
  if (phase < 120) {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
  } else {
    window.dispatchEvent(new KeyboardEvent("keyup", { key: " " }));
  }
}, 100);

// 睡着检测：扫描画布紫色唤醒提示条 (≈ #9b8cff) → 连点 7 次唤醒
setInterval(() => {
  if (window.__demoEnabled !== true) return;
  const c = document.querySelector("canvas");
  if (!c) return;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(0, 0, c.width, c.height).data;
  } catch {
    return;
  }
  let found = false;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (r > 100 && r < 190 && g > 100 && g < 190 && b > 210 && b - r > 50) {
      found = true;
      break;
    }
  }
  if (found) {
    for (let k = 0; k < 7; k++) {
      setTimeout(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: " " })), k * 60);
    }
  }
}, 150);

// 定时使用道具（能量够才生效）：20s 香蕉、35s 胡萝卜、50s 激将、65s 再香蕉
const ITEM_PLAN: Array<[number, string]> = [
  [20, "2"],
  [35, "1"],
  [50, "3"],
  [65, "2"],
];
for (const [at, key] of ITEM_PLAN) {
  setTimeout(() => {
    if (window.__demoEnabled === true) press(key);
  }, at * 1000);
}
