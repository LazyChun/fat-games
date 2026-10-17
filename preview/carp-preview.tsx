/*
 * CarpGateGame 独立预览壳（仅用于本地视觉验证，不属于插件产物）
 * 自动演示：周期性「按住蓄力 → 松开跃起」，偶尔空中补一次摆尾腾跃，
 * 用于观察鲤鱼跳跃、龙门滚动、礁石与龙珠的渲染效果。
 */
import React from "react";
import { createRoot } from "react-dom/client";
import ThemeShell from "../src/ThemeShell";
import CarpGateGame from "../src/games/CarpGateGame";
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
      <CarpGateGame sdk={mockSdk} />
    </ThemeShell>,
  );
}

function press(releaseAfter: number): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
  setTimeout(() => {
    window.dispatchEvent(new KeyboardEvent("keyup", { key: " " }));
  }, releaseAfter);
}

// 开始
setTimeout(() => {
  press(180);
}, 600);

// 自动演示：按住蓄力（140~340ms）→ 松开跃起；1/4 概率空中补二段跃
function loop(): void {
  const hold = 140 + Math.random() * 200;
  press(hold);
  if (Math.random() < 0.25) {
    setTimeout(() => press(40), hold + 240);
  }
  setTimeout(loop, 320 + Math.random() * 520);
}
setTimeout(loop, 1600);
