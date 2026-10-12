/*
 * sound.ts - fat-games 游戏音效引擎
 *
 * 全部音效用 Web Audio API 实时合成，不依赖任何外部音频文件：
 *   - AudioContext 惰性创建（浏览器要求用户手势后才能出声）
 *   - 全局开关持久化到 localStorage（fat-games.sound）
 *   - 每种音效做最小间隔节流，防止同一帧堆叠导致爆音
 *   - 音量统一控制在 0.1~0.25，短促包络，避免刺耳
 */
type ToneOpts = {
  type?: OscillatorType;
  vol?: number;
  attack?: number;
  decay?: number;
  slideTo?: number;
  delay?: number;
};

const LS_KEY = "fat-games.sound";
const lastPlayed: Record<string, number> = {};

let ctx: AudioContext | null = null;
let soundEnabled = true;

try {
  soundEnabled = window.localStorage.getItem(LS_KEY) !== "0";
} catch {
  /* localStorage 不可用时保持默认开启 */
}

export function isSoundEnabled(): boolean {
  return soundEnabled;
}

export function setSoundEnabled(on: boolean): void {
  soundEnabled = on;
  try {
    window.localStorage.setItem(LS_KEY, on ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function getCtx(): AudioContext | null {
  if (!soundEnabled) return null;
  try {
    if (!ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

/** 节流：同一种音效在 ms 毫秒内只允许播放一次 */
function throttle(name: string, ms = 45): boolean {
  const now = performance.now();
  if (now - (lastPlayed[name] || 0) < ms) return false;
  lastPlayed[name] = now;
  return true;
}

/** 单音：正弦/方波/三角波 + 指数包络（可选滑音） */
function tone(freq: number, dur: number, opts: ToneOpts = {}): void {
  const c = getCtx();
  if (!c) return;
  const { type = "sine", vol = 0.18, attack = 0.005, decay = 0.18, slideTo, delay = 0 } = opts;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + attack + decay + 0.05);
}

/** 噪声：低通滤波白噪声，用于射击/爆炸/击中 */
function noise(dur: number, vol = 0.2, delay = 0, filterFreq = 1200): void {
  const c = getCtx();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(filterFreq, t0);
  filter.frequency.exponentialRampToValueAtTime(Math.max(60, filterFreq * 0.15), t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter);
  filter.connect(g);
  g.connect(c.destination);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
}

/* ------------------------------------------------------------------ */
/* 通用交互音效                                                        */
/* ------------------------------------------------------------------ */

/** 点击 / 落子 / 放置 */
export function sfxClick(): void {
  if (!throttle("click", 50)) return;
  tone(420, 0.09, { type: "triangle", vol: 0.16, decay: 0.08, slideTo: 300 });
}

/** 移动 / 转向（蛇转向、2048 滑动、方块移动） */
export function sfxMove(): void {
  if (!throttle("move", 60)) return;
  tone(240, 0.06, { type: "square", vol: 0.07, decay: 0.05 });
}

/** 旋转（俄罗斯方块、魔方） */
export function sfxRotate(): void {
  if (!throttle("rotate", 60)) return;
  tone(300, 0.08, { type: "triangle", vol: 0.14, decay: 0.07, slideTo: 460 });
}

/** 快速下落（俄罗斯方块硬降） */
export function sfxDrop(): void {
  if (!throttle("drop", 80)) return;
  tone(520, 0.1, { type: "square", vol: 0.1, decay: 0.09, slideTo: 180 });
}

/** 获得分数（通用加分） */
export function sfxScore(): void {
  if (!throttle("score", 90)) return;
  tone(880, 0.1, { type: "sine", vol: 0.15, decay: 0.09 });
  tone(1320, 0.14, { type: "sine", vol: 0.12, decay: 0.12, delay: 0.05 });
}

/** 吃到 / 拾取（贪吃蛇吃食物、黄金矿工抓金块） */
export function sfxEat(): void {
  if (!throttle("eat", 80)) return;
  tone(440, 0.09, { type: "triangle", vol: 0.16, decay: 0.08, slideTo: 660 });
  tone(660, 0.12, { type: "sine", vol: 0.1, decay: 0.1, delay: 0.06 });
}

/** 翻牌（记忆游戏） */
export function sfxFlip(): void {
  if (!throttle("flip", 70)) return;
  tone(520, 0.08, { type: "triangle", vol: 0.14, decay: 0.07, slideTo: 680 });
}

/** 配对成功 */
export function sfxMatch(): void {
  if (!throttle("match", 120)) return;
  tone(660, 0.12, { type: "sine", vol: 0.15, decay: 0.1 });
  tone(880, 0.16, { type: "sine", vol: 0.13, decay: 0.13, delay: 0.07 });
}

/** 配对失败 */
export function sfxMismatch(): void {
  if (!throttle("mismatch", 120)) return;
  tone(190, 0.14, { type: "square", vol: 0.08, decay: 0.12, slideTo: 130 });
}

/** 翻开格子（扫雷） */
export function sfxReveal(): void {
  if (!throttle("reveal", 60)) return;
  tone(620, 0.06, { type: "triangle", vol: 0.13, decay: 0.05, slideTo: 560 });
}

/** 插旗 / 标记（扫雷） */
export function sfxFlag(): void {
  if (!throttle("flag", 90)) return;
  tone(380, 0.09, { type: "triangle", vol: 0.15, decay: 0.08, slideTo: 520 });
}

/** 命中 / 打中（打地鼠、射击命中） */
export function sfxHit(): void {
  if (!throttle("hit", 70)) return;
  noise(0.08, 0.16, 0, 2600);
  tone(900, 0.07, { type: "square", vol: 0.08, decay: 0.06, slideTo: 500 });
}

/** 射击（战鹰、坦克开火） */
export function sfxShoot(): void {
  if (!throttle("shoot", 90)) return;
  noise(0.16, 0.14, 0, 3800);
  tone(700, 0.14, { type: "sawtooth", vol: 0.06, decay: 0.12, slideTo: 220 });
}

/** 爆炸（炸弹、飞机坠毁、坦克被击毁） */
export function sfxBoom(): void {
  if (!throttle("boom", 130)) return;
  noise(0.45, 0.26, 0, 1500);
  tone(120, 0.4, { type: "sine", vol: 0.22, decay: 0.38, slideTo: 40 });
  tone(80, 0.35, { type: "triangle", vol: 0.16, decay: 0.32, delay: 0.04 });
}

/** 胜利（通关 / 达成目标） */
export function sfxWin(): void {
  if (!throttle("win", 300)) return;
  const notes = [523, 659, 784, 1047];
  notes.forEach((f, i) => {
    tone(f, 0.16, { type: "triangle", vol: 0.16, decay: 0.13, delay: i * 0.09 });
  });
  tone(1319, 0.3, { type: "sine", vol: 0.12, decay: 0.26, delay: 0.36 });
}

/** 失败 / 游戏结束 */
export function sfxLose(): void {
  if (!throttle("lose", 300)) return;
  const notes = [392, 330, 262, 196];
  notes.forEach((f, i) => {
    tone(f, 0.2, { type: "triangle", vol: 0.14, decay: 0.18, delay: i * 0.11 });
  });
}

/** 消除（俄罗斯方块消行、2048 合并） */
export function sfxClear(): void {
  if (!throttle("clear", 110)) return;
  const notes = [660, 880, 1100];
  notes.forEach((f, i) => {
    tone(f, 0.1, { type: "sine", vol: 0.14, decay: 0.09, delay: i * 0.045 });
  });
}

/** 升级 / 进入下一关 */
export function sfxLevelUp(): void {
  if (!throttle("levelup", 260)) return;
  const notes = [523, 659, 784, 1047, 1319];
  notes.forEach((f, i) => {
    tone(f, 0.13, { type: "triangle", vol: 0.15, decay: 0.11, delay: i * 0.07 });
  });
}

/** 反弹（乒乓击球） */
export function sfxBounce(): void {
  if (!throttle("bounce", 60)) return;
  tone(300, 0.07, { type: "square", vol: 0.09, decay: 0.06, slideTo: 200 });
}

/** 着陆 / 落地 */
export function sfxLand(): void {
  if (!throttle("land", 100)) return;
  tone(200, 0.12, { type: "triangle", vol: 0.18, decay: 0.1, slideTo: 80 });
  noise(0.12, 0.1, 0, 900);
}

/** 抓取 / 勾住（黄金矿工） */
export function sfxGrab(): void {
  if (!throttle("grab", 80)) return;
  tone(300, 0.1, { type: "triangle", vol: 0.14, decay: 0.08, slideTo: 500 });
}

/** 充能 / 补给（弹弓回基地） */
export function sfxRefuel(): void {
  if (!throttle("refuel", 160)) return;
  tone(520, 0.1, { type: "sine", vol: 0.14, decay: 0.09 });
  tone(780, 0.16, { type: "sine", vol: 0.12, decay: 0.14, delay: 0.09 });
}

/** 触发引力弹弓 */
export function sfxSlingshot(): void {
  if (!throttle("slingshot", 180)) return;
  tone(300, 0.2, { type: "sawtooth", vol: 0.1, decay: 0.18, slideTo: 980 });
  tone(150, 0.24, { type: "sine", vol: 0.14, decay: 0.22, slideTo: 600, delay: 0.04 });
}

/** 警报（低能源 / 进入大气层） */
export function sfxAlarm(): void {
  if (!throttle("alarm", 260)) return;
  tone(660, 0.09, { type: "square", vol: 0.09, decay: 0.07 });
  tone(660, 0.09, { type: "square", vol: 0.09, decay: 0.07, delay: 0.14 });
}

/** 被击退 / 撞墙 / 减命 */
export function sfxHurt(): void {
  if (!throttle("hurt", 120)) return;
  tone(280, 0.16, { type: "square", vol: 0.1, decay: 0.14, slideTo: 110 });
  noise(0.14, 0.1, 0, 1400);
}

/** 金币 / 加分音（黄金矿工、战鹰得分） */
export function sfxCoin(): void {
  if (!throttle("coin", 100)) return;
  tone(988, 0.09, { type: "sine", vol: 0.15, decay: 0.08 });
  tone(1319, 0.16, { type: "sine", vol: 0.13, decay: 0.14, delay: 0.06 });
}
