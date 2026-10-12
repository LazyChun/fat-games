---
name: fat-notes-plugin-dev
description: Scaffold, develop, build, and package FatNotes bespoke plugins using fat-notes-extension-cli. Covers the CLI commands, Module Federation contract, activate/deactivate lifecycle, and the full FatNotesPluginSDK surface (dataSource, query, mutation, ui, commands, store, contributions, events, backend, boards, remoteComponents). Includes optional Python backend support for custom server-side logic, plus plugin board config persistence under confs/boards/<uniqueKey> and dependency tracking via dependencies.json. Use when the user asks to create a new FatNotes plugin, add a contribution to an existing plugin, integrate with FatNotes data sources or queries, expose plugin configuration cards, or build and install a bespoke plugin bundle.
---

# FatNotes Bespoke Plugin Development

This skill teaches an agent how to build plugins for the FatNotes desktop app
using the `fat-notes-extension-cli` scaffold. FatNotes plugins are loaded into
the host at runtime via **Module Federation** and contribute UI elements into
the activity bar, primary sidebar, panel, footer, routes, and block types.

> The **secondary sidebar** is reserved for FatNotes' chat block. Any attempt
> to `registerSidebarView("secondary", ...)` is rejected by the host.

## Quick Start

```bash
# 1. Scaffold
npx fat-notes-extension-cli create my-plugin --name "My Plugin"
cd my-plugin

# 2. Install dependencies
npm install

# 3. Develop (watch mode)
npm run dev
# or
fn-ext dev

# 4. Build production bundle
npm run build
# -> dist/remoteEntry.js + chunk files
```

## CLI Commands

| Command                                                 | Effect                                  |
| ------------------------------------------------------- | --------------------------------------- |
| `fn-ext create <pluginId> [--name] [--dir] [--backend]` | Scaffold from the `templates/default/`  |
| `fn-ext build`                                          | Runs webpack + packs backend if enabled |
| `fn-ext dev`                                            | Runs `npm run dev` (watch mode)         |
| `fn-ext pack-backend`                                   | Packs backend (copy .py + vendor deps)  |

Plugin id rules: `^[a-z0-9][a-z0-9-]*$` (lowercase, digits, hyphens).
The webpack container name uses `pluginId.replace(/-/g, "_")` automatically.

## Required Plugin Entry Shape

`src/index.tsx` MUST export:

```ts
import type { Disposable, FatNotesPluginSDK } from "fat-notes-sdk";

const disposables: Disposable[] = [];

export async function activate(sdk: FatNotesPluginSDK): Promise<void> {
  // Register contributions; push every returned Disposable.
  disposables.push(
    sdk.contributions.registerActivityBarItem({
      /* ... */
    }),
  );
}

export function deactivate(): void {
  while (disposables.length) {
    try {
      disposables.pop()?.dispose();
    } catch {}
  }
}
```

Rules:

- `activate` may be async; must not throw for expected failures.
- `deactivate` **must** dispose every registered contribution/command/event.
- Never keep references to the `sdk` object after `deactivate()` returns.

## Module Federation Contract (do NOT change)

- Container name: `<plugin_safe_id>` (hyphens → underscores).
- Exposed module: `"./plugin"` → `src/index.tsx`.
- Entry filename: `remoteEntry.js`.
- `shared` must be **singleton** and match host versions exactly:

| Package             | Version  |
| ------------------- | -------- |
| `react`             | `18.2.0` |
| `react-dom`         | `18.2.0` |
| `react/jsx-runtime` | `18.2.0` |
| `react-redux`       | `9.1.2`  |
| `react-intl`        | `6.8.4`  |
| `antd`              | `6.3.1`  |

Version drift causes React hook mismatches at load time. If your plugin needs
an extra library, add it as a normal dependency (NOT shared) unless the host
also ships the exact same version.

## Contribution Points

Use `sdk.contributions.*`. Each call returns a `Disposable`.

| Method                                           | Rendered in                 |
| ------------------------------------------------ | --------------------------- |
| `registerActivityBarItem(def)`                   | Left activity bar icon      |
| `registerSidebarView("primary", def)`            | Primary sidebar             |
| `registerSidebarView("secondary", def)`          | **Blocked** (chat-reserved) |
| `registerPanelTab(def)`                          | Bottom panel tab            |
| `registerFooterItem(def)` (align `left`/`right`) | Footer status row           |
| `registerRoutePage(def)`                         | Full-page route             |
| `registerBlockType(def)`                         | Dashboard custom block type |
| `registerBlockDisplayConfig(def)`                | Block display config panel  |
| `registerSettingsPage(def)`                      | Advanced Plugins settings   |
| `registerMenu(target, items[])`                  | Contextual menus            |

The common pattern — activity-bar icon that opens a primary sidebar view —
is to give them the same `viewId`:

```ts
sdk.contributions.registerActivityBarItem({
  id: "my-plugin.main",
  title: "My Plugin",
  icon: "Puzzle",
  primarySidebarViewId: "my-plugin.view",
});
sdk.contributions.registerSidebarView("primary", {
  id: "my-plugin.view",
  title: "My Plugin",
  render: () => <MyView sdk={sdk} />,
});
```

`icon` accepts a lucide-react key (e.g. `"Puzzle"`, `"Gauge"`) or an SVG URL.

## SDK Cheat Sheet

```ts
sdk.host.version; // host version string
sdk.host.mode; // "dev" | "prod"
sdk.pluginId; // current plugin id

// Data sources
await sdk.dataSource.listDs();
await sdk.dataSource.getDs(id);

// Queries / mutations (preferred: saved ids)
await sdk.query.run<T>(queryId, { param: 1 });
await sdk.query.runRaw<T>(dsId, "select ..."); // escape hatch
await sdk.mutation.run<T>(mutationId, { payload });
await sdk.mutation.insert<T>(dsId, "my_table", { col: v });

// UI
sdk.ui.toast.success | warn | error | info;
await sdk.ui.modal.confirm({ title, content });
sdk.ui.theme.get(); // "light" | "dark" | ...
sdk.ui.i18n.t("key", { name: "x" });

// Commands
const d = sdk.commands.register("my-plugin.ping", async () => "pong");
await sdk.commands.execute("my-plugin.ping");

// Redux (read-only)
const n = sdk.store.select((s: any) => s.settings?.theme);
const d2 = sdk.store.subscribe(
  (s: any) => s.auth?.user,
  (user) => {
    /* … */
  },
);

// Event bus
const d3 = sdk.events.on("my-plugin.updated", (p) => {});
sdk.events.emit("my-plugin.updated", { id: "x" });

// Plugin board config + dependencies
await sdk.boards.getBoard("my-plugin.default");
await sdk.boards.setBoard("my-plugin.default", { boardId: "..." });
await sdk.boards.getDependencies("my-plugin.default");
await sdk.boards.setDependencies("my-plugin.default", [
  { id: "my.dep", type: "feature", version: "1.0.0" },
]);
await sdk.boards.getBoardBlocks("my-plugin.default");
await sdk.boards.addConfigCard("my-plugin.default", {
  title: "New Config Card",
  type: "text",
  dependencies: [{ id: "my.dep", type: "feature", version: "1.0.0" }],
});

// Remote host components
const PluginBlockBox = sdk.remoteComponents.PluginBlockBox;
const BlockConfigCommon = sdk.remoteComponents.BlockConfigCommon;
```

Every `onXxx` / `subscribe` / `register*` call returns a `Disposable` — push it
into the disposables array so `deactivate()` can release it.

### Plugin Board Config (New)

- `sdk.boards` persists plugin board config to:
  - `confs/boards/<uniqueKey>/file.json`
- Dependency records persist to:
  - `confs/boards/<uniqueKey>/dependencies.json`
- `uniqueKey` must be stable and unique per plugin use-case (recommended format: `<pluginId>.<scene>`).
- Host sanitizes `uniqueKey` to filesystem-safe characters (`[a-zA-Z0-9._-]`).
- `dependencies.json` items should include at least:
  - `id`: dependency id
  - `type`: dependency type (e.g. `plugin`, `feature`, `service`)
  - `version`: optional version string

### Remote Components (New)

- `sdk.remoteComponents.PluginBlockBox` is a host-exposed remote component for rendering block boards inside plugin UI.
- Typical pattern:
  - Load blocks via `sdk.boards.getBoardBlocks(uniqueKey)`
  - Render them using `<PluginBlockBox blocks={blocks} boardId={boardId} />`
- `sdk.remoteComponents.BlockConfigCommon` exposes host block-config common components so plugins can compose native-style display config UIs.

### Block Display Config Contribution (New)

- Use `sdk.contributions.registerBlockDisplayConfig` to inject plugin config UI into host `BlockConfig > DisplayConfig`.
- Set `blockType` to a concrete type (e.g. `my-plugin.gauge`) or `"*"` for all card types.
- Combine with `sdk.remoteComponents.BlockConfigCommon` to reuse host config blocks.

```tsx
disposables.push(
  sdk.contributions.registerBlockDisplayConfig({
    id: "my-plugin.gauge.display",
    blockType: "my-plugin.gauge",
    render: () => {
      const common = sdk.remoteComponents.BlockConfigCommon as Record<
        string,
        React.ComponentType<unknown>
      >;
      const BlockName = common.BlockName;
      const DisplayCollapse = common.DisplayCollapse;
      if (!BlockName || !DisplayCollapse) return null;
      return (
        <>
          <BlockName />
          <DisplayCollapse title="Gauge Config">
            <div style={{ padding: 8 }}>Plugin custom display config...</div>
          </DisplayCollapse>
        </>
      );
    },
  }),
);
```

## Project Layout (from scaffold)

```
my-plugin/
├── plugin.json              # manifest read by FatNotes installer
├── package.json
├── tsconfig.json
├── webpack.config.js        # Module Federation config
├── public/index.html        # standalone preview shell
├── src/
│   ├── bootstrap.ts         # async entry (required by MF)
│   ├── index.tsx            # activate / deactivate
│   └── PluginView.tsx       # example view component
└── types/
    └── fat-notes-sdk.d.ts   # SDK type declarations
```

- Do NOT rename `src/bootstrap.ts` or `src/index.tsx` unless you also update
  `webpack.config.js` (`entry` and `exposes["./plugin"]`).
- Do NOT switch to eager sharing — Module Federation requires the async
  `bootstrap → import("./index")` dance.

## Package & Install

1. Build: `npm run build` → `dist/` with `remoteEntry.js`.
   - If backend is enabled, `dist/backend/` is automatically populated.
2. Produce `install.zip` containing:
   - `plugin.json` (the manifest at the project root)
   - everything under `dist/` (at the zip root, not nested)
3. In FatNotes → **Extensions** → **Custom Bespoke Plugins** → **New Plugin**,
   upload `install.zip`. Files are extracted to
   `extensions/bespokePlugins/remote/<plugin-id>/` (mirror of the apps layout).

In dev mode (host `PY_MODE=dev`), the CLI can point directly at your workspace
copy — FatNotes serves `extensions/bespokePlugins/local/<id>/dist/remoteEntry.js`
via its static UI server on port `8888`.

## Common Workflows

### Add a dashboard block type

```ts
disposables.push(
  sdk.contributions.registerBlockType({
    type: "myPlugin.gauge",
    title: "Gauge",
    iconUrl: "/gauge-icon.png", // optionally provide a custom icon
    category: "chart", // place it in a specific category in the block picker
    render: ({ config }) => <Gauge config={config} />,
  }),
);
```

You can call `registerBlockType` multiple times to register multiple blocks from a single plugin. Blocks can fetch data through `sdk.query.run(...)`; persist user settings via `sdk.mutation.run(...)` against a saved mutation id.

### Add a plugin settings page

```ts
disposables.push(
  sdk.contributions.registerSettingsPage({
    id: "myPlugin.settings",
    title: "My Plugin Config",
    render: () => <SettingsPage sdk={sdk} />,
  }),
);
```

This will automatically add an entry under the "Advanced Plugins" category in FatNotes settings. You can use `sdk.config.get()` and `sdk.config.set()` inside the component to store configuration data.

### Add a full-page route

```ts
disposables.push(
  sdk.contributions.registerRoutePage({
    path: "/my-plugin/dashboard",
    title: "My Plugin Dashboard",
    render: () => <Dashboard sdk={sdk} />,
  }),
);
```

The host navigates via `sdk.commands.execute("router.push", "/my-plugin/dashboard")`
or by clicking an activity-bar item whose `primarySidebarViewId` points to
the view containing a link.

### Dev Mode Floating Add Button for Config Cards

Use this pattern so plugin users can click a floating button in dev mode to add
configuration cards and persist related dependency records:

```tsx
import { FloatButton } from "antd";

const uniqueKey = `${sdk.pluginId}.default`;
const PluginBlockBox = sdk.remoteComponents.PluginBlockBox;
const [blocks, setBlocks] = React.useState<unknown[]>([]);

const reload = async () => {
  const bs = await sdk.boards.getBoardBlocks(uniqueKey);
  setBlocks(bs);
};

const onAdd = async () => {
  await sdk.boards.addConfigCard(uniqueKey, {
    title: "New Config Card",
    type: "text",
    dependencies: [
      { id: "core.block", type: "feature", version: sdk.host.version },
    ],
  });
  await reload();
};

return (
  <div style={{ position: "relative" }}>
    <PluginBlockBox
      blocks={blocks}
      boardId={`plugin:${sdk.pluginId}:${uniqueKey}`}
      minHeight={280}
    />
    {sdk.host.mode === "dev" ? (
      <FloatButton type="primary" tooltip="Add config card" onClick={onAdd} />
    ) : null}
  </div>
);
```

## Additional Resources

- Full SDK type surface: see [sdk-reference.md](sdk-reference.md)
- Contribution recipes & complete examples: see [examples.md](examples.md)
- **Plugin backend guide**: see [backend-guide.md](backend-guide.md)
- Pitfalls & debugging tips: see [pitfalls.md](pitfalls.md)

---

## ⚠️ SDK-First Principle (IMPORTANT)

When developing a plugin, **always prefer the built-in SDK** before writing
custom backend code:

| Need                           | SDK Solution                               | Backend needed? |
| ------------------------------ | ------------------------------------------ | --------------- |
| Read/write data in a DB        | `sdk.query.run()` / `sdk.mutation.run()`   | No              |
| Execute raw SQL                | `sdk.query.runRaw(dsId, sql)`              | No              |
| Insert rows                    | `sdk.mutation.insert(dsId, table, row)`    | No              |
| Toast / confirm dialogs        | `sdk.ui.toast.*` / `sdk.ui.modal.*`        | No              |
| Theme / i18n                   | `sdk.ui.theme` / `sdk.ui.i18n`             | No              |
| Inter-plugin events            | `sdk.events.on()` / `emit()`               | No              |
| Custom block types             | `sdk.contributions.registerBlockType()`    | No              |
| Plugin settings page           | `sdk.contributions.registerSettingsPage()` | No              |
| File I/O, subprocess, ML model | -                                          | **Yes**         |
| External HTTP APIs (no CORS)   | -                                          | **Yes**         |
| CPU-intensive compute          | -                                          | **Yes**         |

**Rule:** If the SDK already covers your use case, do NOT enable backend.
Backend adds complexity (Python dependency, subprocess lifecycle, packaging).
Only use it when the frontend SDK genuinely cannot fulfill the requirement.
