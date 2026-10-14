/*
 * HurdleGame 独立预览壳（仅用于本地视觉验证，不属于插件产物）
 * 自动演示：通过读取画布像素，在栏架临近时起跳（高栏蓄力、连栏二段跳），
 * 尽量模拟真实玩家跑进中后期，便于观察栏架密度变化。
 */
import React from "react";
import { createRoot } from "react-dom/client";
import ThemeShell from "../src/ThemeShell";
import HurdleGame from "../src/games/HurdleGame";
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
      <HurdleGame sdk={mockSdk} />
    </ThemeShell>,
  );
}

// 0.6s 后开始
setTimeout(() => {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
  window.dispatchEvent(new KeyboardEvent("keyup", { key: " " }));
}, 600);

const RUN = 92;

function press(releaseAfter: number): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
  setTimeout(() => {
    window.dispatchEvent(new KeyboardEvent("keyup", { key: " " }));
  }, releaseAfter);
}

// 每 40ms 读一次画面：找跑者前方最近的栏架横条，判断距离与高度后起跳
// 省体力策略：低/中栏一律轻点；只有超高栏（>78）才蓄力；连栏才用二段跳
setInterval(() => {
  const c = document.querySelector("canvas");
  if (!c) return;
  const ctx = c.getContext("2d");
  let d: Uint8ClampedArray;
  try {
    d = ctx.getImageData(0, 0, c.width, c.height).data;
  } catch {
    return;
  }
  const W = c.width;
  let nearX = -1;
  let nearY = -1;
  outer: for (let x = RUN + 14; x < RUN + 300; x++) {
    for (let y = 150; y < 250; y++) {
      const i = (y * W + x) * 4;
      if (d[i] > 225 && d[i] - d[i + 1] > 145 && d[i] - d[i + 2] > 145) {
        nearX = x;
        nearY = y;
        break outer;
      }
    }
  }
  if (nearX < 0) return;

  // 判断是否已腾空：跑者身位处不是跑道红
  const hip = (188 * W + RUN) * 4;
  const inAir = !(d[hip] > 180 && d[hip] - d[hip + 1] > 60);

  const dist = nearX - RUN;
  const height = 268 - (nearY + 3); // 栏高估算
  if (inAir) {
    // 连栏：前方很近还有栏 -> 二段跳
    if (dist < 70 && dist > 12) press(50);
    return;
  }
  if (dist >= 60 && dist <= 150) {
    if (height > 78) press(240); // 超高栏：蓄力
    else press(50); // 其余：轻点
  }
}, 40);
