/*
 * RubikCubeGame：3D 魔方
 *
 * 纯 CSS 3D 渲染的 3x3 魔方：
 *   - 26 个可动块由 rubikLogic 维护四元数姿态，渲染层把逻辑坐标（y 向上）
 *     映射到 CSS 空间（y 向下：位置翻转 + 旋转轴翻转/角度取反）。
 *   - 拖拽旋转视角；点击任意色块选中所在层，用 ↻/↺ 转动该层；
 *     也可用 U/D/L/R/F/B 按钮或键盘（Shift 反向）转动。
 *   - 打乱动画逐层执行；还原成功弹出结算并记录成绩（步数）。
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  CloseOutlined,
  RedoOutlined,
  ReloadOutlined,
  RotateLeftOutlined,
  RotateRightOutlined,
} from "@ant-design/icons";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import { recordScore } from "../scoreClient";
import { useI18n } from "../hooks";
import { useThemeMode } from "../ThemeShell";
import GameFrame, {
  GhostBtn,
  PrimaryBtn,
  CHIP_BLUE,
  CHIP_GOLD,
  CHIP_GREEN,
  CHIP_RED,
} from "./GameFrame";
import {
  applyMove,
  applyMoveName,
  createCube,
  FACE_NORMALS,
  getWorldNormal,
  getWorldPos,
  isSolved,
  quatToAxisAngle,
  randomMoves,
  stickerColor,
  type Axis,
  type Cubie,
  type Dir,
  type Vec3,
} from "./rubikLogic";
import "./gameAnimations.less";

/* ------------------------------------------------------------------ */
/* 渲染常量                                                             */
/* ------------------------------------------------------------------ */

const CUBIE = 52; // 小块边长
const SP = 58; // 小块中心间距（= 边长 + 缝隙）
const HALF = CUBIE / 2;
const MOVE_MS = 180; // 一次转动的过渡时长
const SCRAMBLE_MS = 140; // 打乱动画每步间隔
const SCRAMBLE_COUNT = 20;
const LS_BEST = "fat-games.rubik.best";

/** 逻辑本地法向 → 小块内贴片 CSS 变换（CSS 空间，y 向下，已含翻转） */
const FACE_TRANSFORMS: Record<string, string> = {
  "0,1,0": `rotateX(90deg) translateZ(${HALF}px)`,
  "0,-1,0": `rotateX(-90deg) translateZ(${HALF}px)`,
  "1,0,0": `rotateY(90deg) translateZ(${HALF}px)`,
  "-1,0,0": `rotateY(-90deg) translateZ(${HALF}px)`,
  "0,0,1": `translateZ(${HALF}px)`,
  "0,0,-1": `rotateY(180deg) translateZ(${HALF}px)`,
};

/** 逻辑法向 key → 面向字母（U/D/L/R/F/B） */
const FACE_LETTERS: Record<string, string> = {
  "0,1,0": "U",
  "0,-1,0": "D",
  "1,0,0": "R",
  "-1,0,0": "L",
  "0,0,1": "F",
  "0,0,-1": "B",
};

/** 面向字母 → i18n key（face.u / face.d ...） */
const FACE_I18N_KEYS: Record<string, string> = {
  U: "game.rubik.face.u",
  D: "game.rubik.face.d",
  R: "game.rubik.face.r",
  L: "game.rubik.face.l",
  F: "game.rubik.face.f",
  B: "game.rubik.face.b",
};

interface ViewRotation {
  yaw: number;
  pitch: number;
}

/** 点击色块选出的层 */
interface LayerSelection {
  axis: Axis;
  layer: -1 | 0 | 1;
  dir: Dir; // 顺时针（面向该面外法向）的转动方向
  letter: string;
}

/** 深拷贝魔方状态（applyMoveName 原地修改） */
function cloneCube(cube: Cubie[]): Cubie[] {
  return cube.map((c) => ({ ...c, quat: { ...c.quat } }));
}

/** 小块渲染变换：逻辑坐标 → CSS 坐标（y 翻转），四元数 → rotate3d（轴翻转、角度取反） */
function cubieTransform(c: Cubie): string {
  const p = getWorldPos(c);
  const [axis, angle] = quatToAxisAngle(c.quat);
  let rot = "";
  if (angle > 1e-9) {
    rot = ` rotate3d(${axis[0]}, ${-axis[1]}, ${axis[2]}, ${-angle}rad)`;
  }
  return `translate3d(${p[0] * SP}px, ${-p[1] * SP}px, ${p[2] * SP}px)${rot}`;
}

const RubikCubeGame: React.FC<{ sdk: FatNotesPluginSDK }> = () => {
  const i18n = useI18n();
  const isDark = useThemeMode();

  // ── 状态 ──────────────────────────────────────────────────────────
  const [cube, setCube] = useState<Cubie[]>(() => createCube());
  const [view, setView] = useState<ViewRotation>({ yaw: -30, pitch: -18 });
  const [moves, setMoves] = useState(0);
  const [best, setBest] = useState<number | null>(() => {
    const v = Number(window.localStorage.getItem(LS_BEST) || 0);
    return v > 0 ? v : null;
  });
  const [scrambling, setScrambling] = useState(false);
  const [overlay, setOverlay] = useState(false);
  const [selected, setSelected] = useState<LayerSelection | null>(null);
  const [inverse, setInverse] = useState(false);
  const [dragging, setDragging] = useState(false);

  // ── 引用（供回调同步读取，避免闭包过期） ──────────────────────────
  const cubeRef = useRef<Cubie[]>(cube);
  const busyRef = useRef(false);
  const movesRef = useRef(0);
  const scramblingRef = useRef(false);
  const recordedRef = useRef(false);
  const dragRef = useRef<{
    x: number;
    y: number;
    moved: boolean;
    view0: ViewRotation;
  } | null>(null);

  const commitCube = useCallback((next: Cubie[]) => {
    cubeRef.current = next;
    setCube(next);
  }, []);

  /** 执行一次转动：克隆 → 施加 → 提交 → 计步 → 判定还原 */
  const executeMove = useCallback(
    (applier: (next: Cubie[]) => void, count = true) => {
      if (busyRef.current || scramblingRef.current) return;
      busyRef.current = true;
      const next = cloneCube(cubeRef.current);
      applier(next);
      commitCube(next);

      if (count) {
        const m = movesRef.current + 1;
        movesRef.current = m;
        setMoves(m);
        if (isSolved(next) && !recordedRef.current) {
          recordedRef.current = true;
          setOverlay(true);
          const prev = Number(window.localStorage.getItem(LS_BEST) || 0);
          const nb = prev > 0 ? Math.min(prev, m) : m;
          window.localStorage.setItem(LS_BEST, String(nb));
          setBest(nb);
          recordScore({
            gameId: "rubik",
            gameTitle: "3D 魔方",
            score: m,
            detail: { moves: m },
          });
        }
      }
      window.setTimeout(() => {
        busyRef.current = false;
      }, MOVE_MS);
    },
    [commitCube],
  );

  const doMoveName = useCallback(
    (name: string) => executeMove((next) => applyMoveName(next, name)),
    [executeMove],
  );

  /** 打乱：逐层执行动画（不计步） */
  const scramble = useCallback(() => {
    if (busyRef.current) return;
    scramblingRef.current = true;
    recordedRef.current = false;
    setScrambling(true);
    setOverlay(false);
    setSelected(null);
    movesRef.current = 0;
    setMoves(0);
    const names = randomMoves(SCRAMBLE_COUNT);
    let i = 0;
    const step = () => {
      if (!scramblingRef.current) return;
      if (i >= names.length) {
        scramblingRef.current = false;
        setScrambling(false);
        return;
      }
      const name = names[i];
      i += 1;
      busyRef.current = true;
      const next = cloneCube(cubeRef.current);
      applyMoveName(next, name);
      commitCube(next);
      window.setTimeout(() => {
        busyRef.current = false;
        step();
      }, SCRAMBLE_MS);
    };
    step();
  }, [commitCube]);

  /** 重置为还原态 */
  const reset = useCallback(() => {
    scramblingRef.current = false;
    busyRef.current = false;
    recordedRef.current = false;
    setScrambling(false);
    setOverlay(false);
    setSelected(null);
    movesRef.current = 0;
    setMoves(0);
    commitCube(createCube());
  }, [commitCube]);

  // ── 键盘：U/D/L/R/F/B，Shift 反向 ─────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (!["u", "d", "l", "r", "f", "b"].includes(k)) return;
      if (busyRef.current || scramblingRef.current) return;
      e.preventDefault();
      const base = k.toUpperCase();
      doMoveName(e.shiftKey ? `${base}'` : base);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [doMoveName]);

  // ── 拖拽视角 / 点击选层 ───────────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      moved: false,
      view0: { ...view },
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) d.moved = true;
    if (!d.moved) return;
    const yaw = d.view0.yaw + dx * 0.45;
    const pitch = Math.max(-85, Math.min(85, d.view0.pitch - dy * 0.45));
    setView({ yaw, pitch });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (!d || d.moved || scramblingRef.current || busyRef.current) return;
    // 点击：选中被点击色块所在的层
    const el = (e.target as HTMLElement).closest("[data-face]") as HTMLElement | null;
    if (!el) return;
    const cubieId = Number(el.getAttribute("data-cubie"));
    const key = el.getAttribute("data-face") || "";
    const c = cubeRef.current.find((it) => it.id === cubieId);
    if (!c || !key) return;
    const n = key.split(",").map(Number) as Vec3;
    const wn = getWorldNormal(c, n);
    const axis = (Math.abs(wn[0]) >= Math.abs(wn[1]) && Math.abs(wn[0]) >= Math.abs(wn[2])
      ? 0
      : Math.abs(wn[1]) >= Math.abs(wn[2])
        ? 1
        : 2) as Axis;
    const pos = getWorldPos(c);
    const layer = Math.max(-1, Math.min(1, pos[axis])) as -1 | 0 | 1;
    const sign = wn[axis] >= 0 ? 1 : -1;
    const letterKey = `${axis === 0 ? (sign > 0 ? "1" : "-1") : "0"},${
      axis === 1 ? (sign > 0 ? "1" : "-1") : "0"
    },${axis === 2 ? (sign > 0 ? "1" : "-1") : "0"}`;
    const letter = FACE_LETTERS[letterKey];
    if (!letter) return;
    setSelected({ axis, layer, dir: sign > 0 ? -1 : 1, letter });
  };

  /** 转动选中层 */
  const twistSelected = (dir: Dir) => {
    if (!selected) return;
    executeMove((next) => applyMove(next, selected.axis, selected.layer, dir));
    setSelected(null);
  };

  // ── 渲染辅助 ───────────────────────────────────────────────────────
  const bodyBg = isDark ? "#262a31" : "#e6e2da";
  const bodyBgHover = isDark ? "#31363f" : "#efece6";
  const statusText = scrambling
    ? i18n.text("game.rubik.status.scrambling")
    : overlay || moves === 0
      ? i18n.text("game.rubik.status.solved")
      : i18n.text("game.rubik.status.scrambled");

  const faceBtn = (letter: string) => {
    const label = inverse ? `${letter}'` : letter;
    const onClick = () => doMoveName(label);
    return (
      <button
        key={letter}
        type="button"
        onClick={onClick}
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          border: `1px solid ${isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.16)"}`,
          background: bodyBg,
          color: isDark ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.8)",
          fontSize: 16,
          fontWeight: 800,
          cursor: "pointer",
          transition: "transform 0.1s ease, background 0.1s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = bodyBgHover;
          e.currentTarget.style.transform = "translateY(-1px)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = bodyBg;
          e.currentTarget.style.transform = "translateY(0)";
        }}
      >
        {label}
      </button>
    );
  };

  return (
    <GameFrame
      emoji="🧊"
      title={i18n.text("game.rubik.title")}
      stats={[
        { label: i18n.text("game.rubik.moves"), value: moves, colors: CHIP_GOLD },
        {
          label: i18n.text("game.rubik.best"),
          value: best === null ? "—" : best,
          colors: CHIP_BLUE,
        },
        {
          label: i18n.text("game.rubik.status"),
          value: statusText,
          colors: scrambling
            ? CHIP_RED
            : overlay || moves === 0
              ? CHIP_GREEN
              : CHIP_BLUE,
        },
      ]}
      headerExtra={
        <>
          <GhostBtn onClick={scramble} disabled={scrambling}>
            <RedoOutlined />
            {i18n.text("game.rubik.scramble")}
          </GhostBtn>
          <GhostBtn onClick={reset} disabled={scrambling}>
            <ReloadOutlined />
            {i18n.text("game.rubik.reset")}
          </GhostBtn>
        </>
      }
      help={i18n.text("game.rubik.help")}
      maxWidth={620}
    >
      {/* 3D 舞台 */}
      <div
        style={{
          position: "relative",
          width: 320,
          height: 320,
          perspective: 900,
          touchAction: "none",
          cursor: dragging ? "grabbing" : "grab",
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {/* 视角旋转组（原点即立方体中心） */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: 0,
            height: 0,
            transformStyle: "preserve-3d",
            transform: `rotateX(${view.pitch}deg) rotateY(${view.yaw}deg)`,
          }}
        >
          {cube.map((c) => (
            <div
              key={c.id}
              style={{
                position: "absolute",
                left: -HALF,
                top: -HALF,
                width: CUBIE,
                height: CUBIE,
                transformStyle: "preserve-3d",
                transform: cubieTransform(c),
                transition: `transform ${MOVE_MS}ms cubic-bezier(0.35, 0.8, 0.35, 1)`,
              }}
            >
              {FACE_NORMALS.map((n) => {
                const key = `${n[0]},${n[1]},${n[2]}`;
                const color = stickerColor(c, n);
                return (
                  <div
                    key={key}
                    data-cubie={c.id}
                    data-face={key}
                    style={{
                      position: "absolute",
                      left: 0,
                      top: 0,
                      width: CUBIE,
                      height: CUBIE,
                      transform: FACE_TRANSFORMS[key],
                      backfaceVisibility: "hidden",
                      WebkitBackfaceVisibility: "hidden",
                      background: bodyBg,
                      boxShadow: isDark
                        ? "inset 0 0 0 1px rgba(255,255,255,0.06)"
                        : "inset 0 0 0 1px rgba(0,0,0,0.07)",
                      borderRadius: 5,
                    }}
                  >
                    {color && (
                      <div
                        style={{
                          position: "absolute",
                          inset: 5,
                          borderRadius: 4,
                          background: color,
                          boxShadow: "inset 0 1px 2px rgba(255,255,255,0.45), 0 1px 3px rgba(0,0,0,0.18)",
                        }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        {/* 还原结算 */}
        {overlay && (
          <div
            className="gs-win-in"
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 10,
              borderRadius: 18,
              background: isDark
                ? "rgba(20,22,26,0.86)"
                : "rgba(253,251,247,0.9)",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              alignItems: "center",
              justifyContent: "center",
              color: isDark ? "rgba(255,255,255,0.92)" : "rgba(0,0,0,0.82)",
            }}
          >
            <div style={{ fontSize: 34, lineHeight: 1.2 }}>🎉</div>
            <div style={{ fontSize: 24, fontWeight: 900 }}>
              {i18n.text("game.rubik.solved")}
            </div>
            <div style={{ fontSize: 14, opacity: 0.72 }}>
              {i18n.text("game.rubik.solvedDetail", { moves })}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <PrimaryBtn onClick={scramble}>
                <RedoOutlined />
                {i18n.text("game.rubik.again")}
              </PrimaryBtn>
              <GhostBtn onClick={() => setOverlay(false)}>
                {i18n.text("game.rubik.keep")}
              </GhostBtn>
            </div>
          </div>
        )}
      </div>

      {/* 选中层操作条 */}
      {selected && (
        <div
          className="gs-stage-in"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: isDark ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.8)",
            }}
          >
            {i18n.text("game.rubik.selected", {
              face: i18n.text(FACE_I18N_KEYS[selected.letter]),
            })}
          </span>
          <GhostBtn onClick={() => twistSelected(selected.dir)}>
            <RotateRightOutlined />
            {i18n.text("game.rubik.cw")}
          </GhostBtn>
          <GhostBtn onClick={() => twistSelected((selected.dir * -1) as Dir)}>
            <RotateLeftOutlined />
            {i18n.text("game.rubik.ccw")}
          </GhostBtn>
          <GhostBtn onClick={() => setSelected(null)}>
            <CloseOutlined />
            {i18n.text("game.rubik.cancel")}
          </GhostBtn>
        </div>
      )}

      {/* 面向按钮 */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          justifyContent: "center",
          marginTop: 2,
        }}
      >
        <GhostBtn
          onClick={() => setInverse((v) => !v)}
          disabled={scrambling}
        >
          {inverse
            ? i18n.text("game.rubik.inverse")
            : i18n.text("game.rubik.normal")}
        </GhostBtn>
        {["U", "D", "L", "R", "F", "B"].map(faceBtn)}
      </div>
    </GameFrame>
  );
};

export default RubikCubeGame;
