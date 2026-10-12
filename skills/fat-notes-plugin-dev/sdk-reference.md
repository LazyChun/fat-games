# FatNotes Plugin SDK — Reference

Complete surface of `FatNotesPluginSDK`, mirroring
`types/fat-notes-sdk.d.ts` in the scaffold.

## Top-level

```ts
interface FatNotesPluginSDK {
  host: HostInfo;
  pluginId: string;
  dataSource: DataSourceApi;
  query: QueryApi;
  mutation: MutationApi;
  ui: UiApi;
  commands: CommandsApi;
  store: StoreApi;
  contributions: ContributionsApi;
  events: EventsApi;
  backend: BackendApi;
  config: PluginConfigApi;
  boards: PluginBoardsApi;
  remoteComponents: RemoteComponentsApi;
  ai: AiApi;
}

interface HostInfo {
  version: string;
  mode: "dev" | "prod";
}
```

## Disposable

Every subscription / registration returns a `Disposable`:

```ts
interface Disposable {
  dispose(): void;
}
```

## Data Source

```ts
interface DataSourceItem {
  id: string;
  name: string;
  type: string; // "mysql" | "postgres" | "sqlite" | "timescaledb" | ...
  [key: string]: unknown;
}

interface DataSourceApi {
  listDs(): Promise<DataSourceItem[]>;
  getDs(id: string): Promise<DataSourceItem | null>;
}
```

## Query

```ts
interface QueryApi {
  run<T = unknown>(
    queryId: string,
    params?: Record<string, unknown>,
  ): Promise<T>;
  runRaw<T = unknown>(dsId: string, sql: string): Promise<T>;
}
```

Prefer saved `queryId` over raw SQL — raw SQL bypasses FatNotes' audit and
caching. Use `runRaw` only for plugin-internal diagnostics.

## Mutation

```ts
interface MutationApi {
  run<T = unknown>(
    mutationId: string,
    payload?: Record<string, unknown>,
  ): Promise<T>;
  insert<T = unknown>(
    dsId: string,
    table: string,
    row: Record<string, unknown>,
  ): Promise<T>;
}
```

## UI

```ts
interface ToastApi {
  success(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  info(msg: string): void;
}

interface ModalApi {
  confirm(options: {
    title: string;
    content?: string;
    okText?: string;
    cancelText?: string;
  }): Promise<boolean>;
}

interface ThemeApi {
  get(): "light" | "dark" | string;
  onChange(cb: (theme: string) => void): Disposable;
}

interface I18nApi {
  t(key: string, values?: Record<string, string | number>): string;
  locale: string;
  onChange(cb: (locale: string) => void): Disposable;
}

interface UiApi {
  toast: ToastApi;
  modal: ModalApi;
  theme: ThemeApi;
  i18n: I18nApi;
}
```

## Commands

```ts
interface CommandsApi {
  register(
    id: string,
    handler: (...args: unknown[]) => unknown | Promise<unknown>,
  ): Disposable;
  execute<T = unknown>(id: string, ...args: unknown[]): Promise<T>;
}
```

Conventions:

- Namespace command ids: `"<pluginId>.<verb>"`, e.g. `"my-plugin.refresh"`.
- Built-ins provided by the host (stable): `router.push`, `router.replace`,
  `extensions.openSettings`, `clipboard.write`.

## Store (read-only)

```ts
interface StoreApi {
  select<T>(selector: (state: unknown) => T): T;
  subscribe<T>(
    selector: (state: unknown) => T,
    cb: (value: T) => void,
  ): Disposable;
}
```

Do not rely on internal state shape beyond the documented `auth`, `settings`,
and `i18n` slices. Prefer `sdk.ui.theme` / `sdk.ui.i18n` over
direct state reads.

## Contributions

```ts
type SidebarSlot = "primary" | "secondary";

interface ActivityBarItemDef {
  id: string;
  title: string;
  icon: string; // lucide-react key or SVG url
  onClick?: () => void;
  primarySidebarViewId?: string;
}

interface SidebarViewDef {
  id: string;
  title: string;
  render: () => ReactNode;
}

interface PanelTabDef {
  id: string;
  title: string;
  render: () => ReactNode;
}

interface FooterItemDef {
  id: string;
  render: () => ReactNode;
  align?: "left" | "right";
}

interface RoutePageDef {
  path: string; // absolute path, start with "/"
  title: string;
  render: () => ReactNode;
}

interface BlockTypeDef {
  type: string; // must be globally unique, e.g. "my-plugin.gauge"
  title: string;
  icon?: string; // lucide-react key
  iconUrl?: string; // URL to custom icon, e.g. "/icon.png" for icon served by plugin
  category?: string; // grouping category, defaults to "plugin". "chart" enables chart relate dimensions
  index?: number; // sort weight in add-block menu; smaller comes first
  render: (props: BlockRenderProps) => ReactNode;
  actionIds?: string[]; // relate | drill | update | filter | delete | linkTo
  triggers?: Array<string | { id: string; title?: string }>;
}

interface BlockDisplayConfigDef {
  id: string; // globally unique, e.g. "my-plugin.gauge.display"
  blockType: string; // target block type, or "*" for all types
  render: () => ReactNode; // rendered in BlockConfig > DisplayConfig
}

interface SettingsPageDef {
  id: string; // globally unique, e.g. "my-plugin.settings"
  title: string; // Label shown in the host's settings UI
  render: () => ReactNode;
}

interface MenuItemDef {
  command: string;
  title?: string;
  when?: string; // host context expression
}

interface ContributionsApi {
  registerActivityBarItem(def: ActivityBarItemDef): Disposable;
  registerSidebarView(slot: SidebarSlot, def: SidebarViewDef): Disposable;
  registerPanelTab(def: PanelTabDef): Disposable;
  registerFooterItem(def: FooterItemDef): Disposable;
  registerRoutePage(def: RoutePageDef): Disposable;
  registerBlockType(def: BlockTypeDef): Disposable;
  registerBlockDisplayConfig(def: BlockDisplayConfigDef): Disposable;
  registerMenu(target: string, items: MenuItemDef[]): Disposable;
}
```

**Hard rules:**

- `id` / `type` / `path` must be globally unique — prefix with your pluginId.
- `registerSidebarView("secondary", …)` is **rejected** by the host.
- `render()` must return a stable React tree; don't create new components on
  every render.

## Events

```ts
interface EventsApi {
  on(name: string, cb: (payload: unknown) => void): Disposable;
  emit(name: string, payload?: unknown): void;
}
```

Name events with `"<pluginId>.<event>"`. The host reserves the `fatNotes.`
prefix for its own events (`fatNotes.login`, `fatNotes.logout`, etc.).

## Router

The host maintains a single global in-memory router (FatNotes is a desktop
app — there is no URL routing). Plugins navigate between pages and subscribe
to route changes via `sdk.router`.

```ts
interface RouteSnapshot {
  path: string; // e.g. "/monitor/alerts"
  params: Record<string, unknown>; // JSON-serializable payload
}

interface RouterApi {
  /** Push a new entry onto the history stack and notify subscribers. */
  navigate(path: string, params?: Record<string, unknown>): void;
  /** Replace the current entry without pushing onto the history stack. */
  replace(path: string, params?: Record<string, unknown>): void;
  /** Pop the history stack; no-op when only the root entry remains. */
  back(): void;
  /** Current route snapshot. */
  getCurrent(): RouteSnapshot;
  /** Subscribe to route changes. Returns a Disposable to unsubscribe. */
  onChange(cb: (snapshot: RouteSnapshot) => void): Disposable;
}
```

Usage notes:

- Register every route path your plugin owns via
  `sdk.contributions.registerRoutePage({ path, title, render })` during
  `activate()`. The host uses this for breadcrumbs / global navigation.
  The `render` callback may return `null` if your workbench page handles
  rendering based on `sdk.router.getCurrent().path`.
- Re-render on route changes with the `useSyncExternalStore`-style pattern:

  ```tsx
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const d = sdk.router.onChange(() => forceUpdate());
    return () => d.dispose();
  }, [sdk]);
  const { path, params } = sdk.router.getCurrent();
  ```

- `params` must be JSON-serializable. Pass full domain objects (e.g. an
  `alert` item) when navigating from a list to a detail page to avoid an
  extra backend round-trip.
- Use `replace()` for in-place param updates (e.g. switching tabs without
  polluting the back stack); use `navigate()` for distinct pages.

## Backend

```ts
interface BackendApi {
  invoke<T = unknown>(
    handler: string,
    params?: Record<string, unknown>,
  ): Promise<T>;
  isRunning(): Promise<boolean>;
  restart(): Promise<void>;
}
```

## Plugin Runtime Config

```ts
interface PluginConfigApi {
  get<T = Record<string, unknown>>(): Promise<T>;
  set<T = Record<string, unknown>>(
    config: T,
    options?: { merge?: boolean },
  ): Promise<T>;
}
```

## AI

Exposes the host's configured AI models and chat completion. Use this to
let users pick a model in your plugin's settings (e.g. "default text model",
"default image model") and to invoke the model at runtime.

```ts
interface AiModelItem {
  id: string;
  name: string;
  model?: string;
  url?: string;
  supportImages?: boolean;
  isDefault?: boolean;
  apiType?: string; // "Chat" | "DoubaoResponse" | ...
  customParams?: Record<string, unknown>;
}

interface AiChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

interface AiSkillRef {
  type: "mcp" | "tool";
  objId: string;
  name?: string;
}

interface AiChatInput {
  modelId: string;
  messages: AiChatMessage[];
  sysPrompt?: string;
  skills?: AiSkillRef[];
  toolIds?: string[];
  autoMcp?: boolean;
  toolChoice?: unknown;
  maxIterations?: number;
}

interface AiToolStep {
  iteration: number;
  toolCalls: unknown[];
  toolResults: unknown[];
}

interface AiChatResult {
  content: string;
  model: string;
  toolSteps: AiToolStep[];
  iterations: number;
  terminatedBy?: string;
}

interface AiKnowledgeBaseStorage {
  type: string;
  path?: string;
  indexName?: string;
  namespace?: string;
  customParams?: Record<string, unknown>;
}

interface AiKnowledgeBaseEmbedding {
  modelId: string;
  dims?: number;
  normalize?: boolean;
  batchSize?: number;
  customParams?: Record<string, unknown>;
}

interface AiKnowledgeBaseItem {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  langs?: string[];
  visibility?: string;
  status?: string;
  createdAt?: string;
  updatedAt?: string;
  storage: AiKnowledgeBaseStorage;
  embedding: AiKnowledgeBaseEmbedding;
  stats?: Record<string, unknown>;
}

interface AiMcpToolItem {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  tags?: string[];
  langs?: string[];
  type?: string;
  enable?: boolean;
}

interface AiSkillItem {
  id: string;
  name?: string;
  description?: string;
  icon?: string;
  tags?: string[];
  langs?: string[];
  enable?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface AiApi {
  getModels(): Promise<AiModelItem[]>;
  getModel(id: string): Promise<AiModelItem | null>;
  chat(input: AiChatInput): Promise<AiChatResult>;
  getKnowledgeBases(): Promise<AiKnowledgeBaseItem[]>;
  getMcpTools(): Promise<AiMcpToolItem[]>;
  getSkills(): Promise<AiSkillItem[]>;
}
```

Notes:

- `apiKey` is never exposed to plugins. Call `sdk.ai.chat(...)` and the host
  injects credentials server-side.
- `supportImages` indicates the model accepts image inputs (vision), not that
  it generates images. Use it to filter the model picker for vision scenarios.
- `getKnowledgeBases()` returns the host's knowledge bases — each item's
  `storage` describes the vector store. Use `id` to reference a KB in your
  plugin's agent config.
- `getMcpTools()` returns sanitized MCP tools (no `conf`). Pass `id` values to
  `sdk.ai.chat({ toolIds: [...] })` to let the model call them.
- `getSkills()` returns sanitized skills configured in the host.
- Store the user's chosen `modelId` via `sdk.config.set({ aiModelIds: {...} })`
  and resolve it at call time with `sdk.ai.getModel(id)`.

## Plugin Boards (New)

```ts
interface PluginBoardDependency {
  id: string;
  type: string;
  version?: string;
  [key: string]: unknown;
}

interface PluginBoardsApi {
  getBoard<T = Record<string, unknown>>(uniqueKey: string): Promise<T>;
  setBoard<T = Record<string, unknown>>(
    uniqueKey: string,
    config: T,
    options?: { merge?: boolean },
  ): Promise<T>;
  getDependencies(uniqueKey: string): Promise<PluginBoardDependency[]>;
  getBoardBlocks(uniqueKey: string): Promise<unknown[]>;
  setDependencies(
    uniqueKey: string,
    dependencies: PluginBoardDependency[],
    options?: { merge?: boolean },
  ): Promise<PluginBoardDependency[]>;
  addConfigCard(
    uniqueKey: string,
    options?: {
      title?: string;
      type?: string;
      layout?: { x?: number; y?: number; w?: number; h?: number };
      dependencies?: PluginBoardDependency[];
    },
  ): Promise<Record<string, unknown>>;
}
```

Persistence mapping:

- Board config: `confs/boards/<uniqueKey>/board.json`
- Dependencies: `confs/boards/<uniqueKey>/dependencies.json`

`uniqueKey` guidance:

- Must be unique and stable per plugin scenario.
- Recommended format: `<pluginId>.<scene>`, e.g. `my-plugin.default`.
- Host sanitizes illegal path characters to `_`.

`dependencies.json` guidance:

- Include at least `id` and `type`.
- Prefer including `version` for upgrade compatibility and debugging.

## Remote Components (New)

```ts
import type { ComponentType } from "react";

interface RemoteComponentsApi {
  PluginBlockBox: ComponentType<{
    blocks?: unknown[];
    boardId?: string;
    minHeight?: number;
    className?: string;
  }>;
  BlockConfigCommon: {
    DisplayBox: unknown;
    DisplayHighLight: unknown;
    BlockName: unknown;
    DisplayCollapse: unknown;
    PanelDisplay: unknown;
    DisplayMulitHighLightInput: unknown;
    LegendDisplay: unknown;
    GraphTheme: unknown;
    TooltipDisplay: unknown;
    BoxPadding: unknown;
    BoxBordersRadius: unknown;
    BoxBordersWidth: unknown;
    QueryFormatsDisplay: unknown;
    SimpleInputBox: unknown;
    ShowCount: unknown;
    DisplayValues: unknown;
    ChartDisplay: unknown;
    GradientColorsDisplay: unknown;
    ColorationSelector: unknown;
    ChartSort: unknown;
    VMLegendDisplay: unknown;
    FlowToolbarDisplay: unknown;
    FlowStyleDisplay: unknown;
    FlowRunningStyleDisplay: unknown;
    ValidateRulesSelector: unknown;
    InputStyleDisplay: unknown;
    VarNameInput: unknown;
    SelectOptionsDisplay: unknown;
    ModalFooterDisplay: unknown;
    DrawerFooterDisplay: unknown;
    RelateLabelDisplay: unknown;
    AiMarksDisplay: unknown;
  };
}
```

Typical usage:

1. Use `sdk.boards.getBoardBlocks(uniqueKey)` to fetch blocks.
2. Render with `sdk.remoteComponents.PluginBlockBox`.
3. In dev mode, call `sdk.boards.addConfigCard(...)` from a floating add button.

For display-config contribution development:

1. Register `sdk.contributions.registerBlockDisplayConfig(...)` for your block type.
2. Access host reusable config blocks via `sdk.remoteComponents.BlockConfigCommon`.
3. Compose your own config panel render tree inside plugin code.

### TimeSelector

`sdk.remoteComponents.TimeSelector` exposes the host's time-range picker. Pass the current range and an `onUpdateTime` callback to receive the user's selection. Because the component uses `react-intl` internally, render it inside an `IntlProvider` whose messages include the host catalog (merge `sdk.ui.i18n.getMessages()` with your own).

```tsx
const TimeSelector = sdk.remoteComponents.TimeSelector;

function MyPanel() {
  const [relativeTime, setRelativeTime] = React.useState("-1h");
  const [startTime, setStartTime] = React.useState("");
  const [endTime, setEndTime] = React.useState("");

  return (
    <TimeSelector
      relativeTime={relativeTime}
      startTime={startTime}
      endTime={endTime}
      showRefresh
      autoRefresh
      onUpdateTime={(rt, st, et) => {
        setRelativeTime(rt);
        setStartTime(st);
        setEndTime(et);
      }}
    />
  );
}
```

### Trend

The host trend chart is the same block used by the host's `Trend` dashboard
block. Pass a block-config `item` (the `Block.Item` shape, carrying
`properties.base.query` and `properties.trend`) and the chart will fetch and
render the data exactly as it does inside a host dashboard. The optional
`startTime` / `endTime` / `relativeTime` props wrap the chart in a
`TimeContext.Provider` so the chart queries data for the given range.

Note: `Trend` is not declared on `RemoteComponentsApi` in the current SDK —
some host builds do not expose it. Access it defensively via a type
assertion and render a fallback when absent:

```tsx
import type { TrendComponentProps } from "fat-notes-sdk";

const Trend = (
  sdk.remoteComponents as {
    Trend?: React.ComponentType<TrendComponentProps>;
  }
).Trend;

return Trend ? <Trend item={item} /> : <Empty />;
```

`properties.trend.areaFills` accepts an array of `TrendAreaFill` objects
(exported from `fat-notes-sdk`). Each one renders a colored rectangle and,
optionally, overrides the line color of every series passing through the
region.

```ts
interface TrendAreaFill {
  id?: string;
  yMin?: number; // 仅设置 yMin: 填充 yMin 以上区域
  yMax?: number; // 仅设置 yMax: 填充 yMax 以下区域
  xMin?: number; // 仅设置 xMin: 填充 xMin 以右区域
  xMax?: number; // 仅设置 xMax: 填充 xMax 以左区域
  color?: string; // 填充颜色 (默认 #ff0000)
  alpha?: number; // 填充透明度 0-1 (默认 0.2)
  fillEnabled?: boolean; // 是否启用填充颜色 (默认 true)
  lineColor?: string; // 区域内折线颜色
  lineEnabled?: boolean; // 是否启用折线颜色覆盖 (默认 false)
}
```

Usage notes:

- `fillEnabled` / `lineEnabled` 至少需勾选一项。host 的 UI 会阻止取消
  最后一个勾选项；当 plugin 直接构造 `TrendAreaFill` 时请自行保证这一
  不变量。
- 当 `lineEnabled === true` 时，host 会在折线绘制完成后按区域矩形裁剪
  并以 `lineColor` 重新描边所有可见 series（仅折线/面积图，柱状图与散
  点图不重描）。
- 旧数据（未设置 `fillEnabled` / `lineEnabled`）默认按 `fillEnabled=true`、
  `lineEnabled=false` 处理，保持向后兼容。

## Plugin Module

```ts
interface PluginModule {
  activate(sdk: FatNotesPluginSDK): void | Promise<void>;
  deactivate?(): void | Promise<void>;
}
```

The exposed `./plugin` module must satisfy `PluginModule`.
