# fat-games

Funny games

A FatNotes bespoke plugin scaffolded by `fat-notes-extension-cli`.

## Install dependencies

```
npm install
```

## Build

```
npm run build
```

The production bundle (including `remoteEntry.js`) is emitted to `dist/`.

## Package & install

Zip the **contents** of `dist/` together with the top-level `plugin.json` as
`install.zip` and install it via FatNotes → Extensions → Custom Bespoke Plugins.

## Module Federation name alignment

FatNotes assigns each plugin a UUID at install time. The Module Federation
remote name the host expects is `plugin_<uuid_with_underscores>`. After
installing or registering the plugin in FatNotes:

1. Find the assigned UUID in the host plugin list.
2. Add `"mfName": "plugin_<uuid_with_underscores>"` to your **workspace** `plugin.json`.
3. Rebuild (`npm run build`). The webpack config picks up `mfName` automatically.

Alternatively, set the env var before building:

```powershell
$env:PLUGIN_MF_NAME = "plugin_<uuid_with_underscores>"
npm run dev
```

If names don't match you will see:

> `[ Federation Runtime ]: remoteEntryExports is undefined`

## File structure

- `src/index.tsx` — plugin entry; must export `activate(sdk)` and `deactivate()`.
- `src/MenuView.tsx` — 主侧边栏（次面板）：只展示游戏菜单，点击走 `sdk.router.navigate`。
- `src/WorkPageView.tsx` — 工作台整页（右侧工作区）：按当前路由渲染对应游戏。
- `src/routes.ts` — 游戏路由表（`/games/<gameId>`）与 path ⇄ gameId 互转。
- `src/games/registry.tsx` — 游戏注册表（新增游戏只需在此加一条记录）。
- `src/ThemeShell.tsx` — 跟随宿主明暗主题的 antd ConfigProvider 壳。
- `src/scoreClient.ts` — 成绩记录客户端（SQLite 落库，后端不可用降级 localStorage）。
- `plugin.json` — manifest consumed by the FatNotes installer.
- `types/fat-notes-sdk.d.ts` — SDK type declarations (mirror of host).
- `webpack.config.js` — Module Federation build (`exposes ./plugin`).

## 内置游戏（27 个，纯前端实现）

菜单按分类展示，点击卡片 → `sdk.router.navigate("/games/<gameId>")`。

| 分类 | 游戏                                                                   |
| ---- | ---------------------------------------------------------------------- |
| 益智 | 2048、扫雷、记忆翻牌、五子棋、3D 魔方、数字华容道                      |
| 休闲 | 贪吃蛇、俄罗斯方块、打地鼠、黄金矿工、乒乓、战鹰雷霆、坦克对决、逆火战轰、星舰回收、引力弹弓、冰壶、3D 台球、跨栏冲刺、反弹神射、快乐消消、老鹰抓小鸡、龟兔赛跑、剥橘子、猫狗大战、猪猪的远望 |
| 记录 | 排行榜                                                                 |

所有游戏使用统一的「游戏厅」视觉外壳（`src/games/GameFrame.tsx` +
`gameTheme.ts` + `gameAnimations.less`）：渐变舞台、统计胶囊、入场/
合并/翻转等动画，并自动适配宿主明暗主题。

> 新增游戏只需在 `src/games/registry.tsx` 加一条记录，
> 纯计算逻辑收敛到 `src/utils.ts`（不依赖 DOM，便于 `vitest` 单测）。

## 布局约定（参考 fat-tools）

活动栏项 id 必须与工作台页 id 完全一致（本插件均为 `fat-games.main`），
宿主才认为「点图标后：左侧主侧边栏 = 菜单，右侧工作区 = 功能页」：

```ts
sdk.contributions.registerActivityBarItem({ id: "fat-games.main", icon: "Gamepad" });
sdk.contributions.registerPrimarySidebar(() => <MenuView sdk={sdk} />);   // 只放菜单
sdk.contributions.registerWorkbenchPage({ id: "fat-games.main", render: () => <WorkPageView sdk={sdk} /> });
```

菜单点击 → `sdk.router.navigate("/games/<gameId>")`；`WorkPageView` 订阅
`sdk.router.onChange` 后按 `getCurrent().path` 渲染对应游戏。

## 成绩记录落库（专用 SQLite）

所有游戏的成绩统一写入专用 SQLite：`<workspace>/fatGames/history.db`
（stdlib `sqlite3`，无第三方依赖）。Python 后端 `backend/` 暴露 5 个 handler：

- `scores.add` — 写入一条成绩（按游戏各保留最近 500 条，字段自动截断）
- `scores.list` — 查询（可按 gameId 过滤，按分数倒序）
- `scores.clear` — 清空（可按 gameId）
- `scores.stats` / `scores.dbPath` — 统计与库文件路径

前端 `src/scoreClient.ts` 封装调用；后端不可用时自动降级 localStorage。
游戏结束时调用 `recordScore()` 落库。

## SDK capabilities

- `sdk.ui` — toast, modal, theme, i18n
- `sdk.commands` — register/execute commands
- `sdk.store` — read host Redux state
- `sdk.contributions` — activityBar / primary sidebar / panel / footer / routes / block types
- `sdk.events` — host/plugin event bus
- `sdk.backend` — invoke Python backend handlers (scores.\* )
- `sdk.router` — in-memory router shared across bespoke plugins

> The **secondary sidebar** is reserved for FatNotes' chat block and is not
> available to plugins.
