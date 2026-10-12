# FatNotes Plugin — Examples

Concrete recipes for common plugin patterns.

## 1. Activity bar icon → primary sidebar view

```tsx
import React from "react";
import type { Disposable, FatNotesPluginSDK } from "fat-notes-sdk";

const disposables: Disposable[] = [];

function MyView({ sdk }: { sdk: FatNotesPluginSDK }) {
  return (
    <div style={{ padding: 12 }}>
      <h3>Hello from plugin</h3>
    </div>
  );
}

export async function activate(sdk: FatNotesPluginSDK) {
  disposables.push(
    sdk.contributions.registerActivityBarItem({
      id: "hello.main",
      title: "Hello",
      icon: "Sparkles",
      primarySidebarViewId: "hello.view",
    }),
  );
  disposables.push(
    sdk.contributions.registerSidebarView("primary", {
      id: "hello.view",
      title: "Hello",
      render: () => <MyView sdk={sdk} />,
    }),
  );
}

export function deactivate() {
  while (disposables.length) disposables.pop()?.dispose();
}
```

## 2. Panel tab that lists data sources

```tsx
function DsPanel({ sdk }: { sdk: FatNotesPluginSDK }) {
  const [list, setList] = React.useState<DataSourceItem[]>([]);
  React.useEffect(() => {
    sdk.dataSource
      .listDs()
      .then(setList)
      .catch((e) => sdk.ui.toast.error(e.message));
  }, []);
  return (
    <ul>
      {list.map((ds) => (
        <li key={ds.id}>
          {ds.name} ({ds.type})
        </li>
      ))}
    </ul>
  );
}

disposables.push(
  sdk.contributions.registerPanelTab({
    id: "ds-explorer.tab",
    title: "DS Explorer",
    render: () => <DsPanel sdk={sdk} />,
  }),
);
```

## 3. Running a saved query

```ts
interface Row {
  ts: string;
  value: number;
}

const rows = await sdk.query.run<Row[]>("metric.hourly", {
  from: "2025-01-01",
  to: "2025-01-02",
});
```

## 4. Inserting a metric row

```ts
await sdk.mutation.insert("ds-main", "events", {
  name: "plugin.activated",
  ts: new Date().toISOString(),
  source: sdk.pluginId,
});
```

For repeatable writes, prefer a saved mutation:

```ts
await sdk.mutation.run("events.insert", { name: "...", ts: "..." });
```

## 5. Registering multiple custom block types with custom icons

```tsx
disposables.push(
  sdk.contributions.registerBlockType({
    type: "hello.counter",
    title: "Counter",
    category: "other", // Optional, defaults to other
    defaultSize: {
      w: 8,
      h: 16,
      minW: 1,
      minH: 2,
    },
    render: ({ config }) => (
      <Counter sdk={sdk} config={config as CounterConfig} />
    ),
  }),
);

disposables.push(
  sdk.contributions.registerBlockType({
    type: "hello.gauge",
    title: "Custom Gauge",
    category: "chart", // Add to the 'chart' category in the block picker
    iconUrl: "/gauge-icon.png", // Icon served from plugin's public folder
    render: ({ config }) => <Gauge sdk={sdk} config={config as GaugeConfig} />,
  }),
);
```

These custom blocks can then be picked in the FatNotes dashboard block picker.

## 6. Registering a plugin settings page

```tsx
function MySettingsPage({ sdk }: { sdk: FatNotesPluginSDK }) {
  const [cfg, setCfg] = React.useState<Record<string, any>>({});

  React.useEffect(() => {
    sdk.config.get().then(setCfg);
  }, []);

  return (
    <div style={{ padding: 20 }}>
      <h3>My Plugin Settings</h3>
      <input
        value={cfg.apiKey || ""}
        onChange={(e) => setCfg({ ...cfg, apiKey: e.target.value })}
      />
      <button onClick={() => sdk.config.set(cfg)}>Save</button>
    </div>
  );
}

disposables.push(
  sdk.contributions.registerSettingsPage({
    id: "hello.settings",
    title: "Hello Settings", // Appears in the "Advanced Plugins" category in host settings
    render: () => <MySettingsPage sdk={sdk} />,
  }),
);
```

## 7. Registering a command + calling it from a footer item

```tsx
disposables.push(
  sdk.commands.register("hello.refresh", async () => {
    sdk.ui.toast.info("refreshed");
    return Date.now();
  }),
);

disposables.push(
  sdk.contributions.registerFooterItem({
    id: "hello.footer",
    align: "right",
    render: () => (
      <button
        style={{ all: "unset", cursor: "pointer" }}
        onClick={() => sdk.commands.execute("hello.refresh")}
      >
        Refresh
      </button>
    ),
  }),
);
```

## 8. Reacting to theme change

```ts
const d = sdk.ui.theme.onChange((theme) => {
  document
    .querySelector(`[data-plugin="${sdk.pluginId}"]`)
    ?.setAttribute("data-theme", theme);
});
disposables.push(d);
```

## 9. Using the host router

```ts
// navigate via a built-in command
await sdk.commands.execute("router.push", "/hello/dashboard");
```

## 10. Confirming before a destructive action

```ts
const ok = await sdk.ui.modal.confirm({
  title: "Delete report?",
  content: "This cannot be undone.",
});
if (ok) await sdk.mutation.run("reports.delete", { id });
```

## 11. i18n inside a plugin

```tsx
function Greeting({ sdk }: { sdk: FatNotesPluginSDK }) {
  const [locale, setLocale] = React.useState(sdk.ui.i18n.locale);
  React.useEffect(() => {
    const d = sdk.ui.i18n.onChange(setLocale);
    return () => d.dispose();
  }, []);
  return <div>{sdk.ui.i18n.t("hello.greeting", { name: "Ada" })}</div>;
}
```

Bundle your own catalog inside the plugin if the host doesn't define your keys:

```ts
const dict: Record<string, Record<string, string>> = {
  en: { "hello.greeting": "Hello, {name}!" },
  zh: { "hello.greeting": "你好, {name}!" },
};
const t = (key: string, v: Record<string, string> = {}) => {
  const lang = sdk.ui.i18n.locale.startsWith("zh") ? "zh" : "en";
  return (dict[lang][key] || key).replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "");
};
```

---

## 12. Plugin board config + config cards (New)

This recipe shows:

- Define a stable `uniqueKey`
- Persist board metadata to `confs/boards/<uniqueKey>/file.json`
- Persist dependencies to `confs/boards/<uniqueKey>/dependencies.json`
- Render blocks via host remote component `sdk.remoteComponents.PluginBlockBox`
- In dev mode, show a floating add button to add config cards

```tsx
import React from "react";
import { FloatButton } from "antd";
import type { FatNotesPluginSDK, PluginBoardDependency } from "fat-notes-sdk";

function ConfigBoard({ sdk }: { sdk: FatNotesPluginSDK }) {
  const uniqueKey = `${sdk.pluginId}.default`;
  const PluginBlockBox = sdk.remoteComponents.PluginBlockBox;

  const [blocks, setBlocks] = React.useState<unknown[]>([]);
  const [deps, setDeps] = React.useState<PluginBoardDependency[]>([]);

  const reload = React.useCallback(async () => {
    const [bs, d] = await Promise.all([
      sdk.boards.getBoardBlocks(uniqueKey),
      sdk.boards.getDependencies(uniqueKey),
    ]);
    setBlocks(bs);
    setDeps(d);
  }, [sdk]);

  React.useEffect(() => {
    reload().catch((e) => sdk.ui.toast.error(e.message));
  }, [reload]);

  const onAdd = React.useCallback(async () => {
    const dependency: PluginBoardDependency = {
      id: "core.block",
      type: "feature",
      version: sdk.host.version,
    };
    await sdk.boards.addConfigCard(uniqueKey, {
      title: "New Config Card",
      type: "text",
      dependencies: [dependency],
    });
    await reload();
  }, [reload, sdk]);

  return (
    <div style={{ padding: 12, position: "relative" }}>
      <PluginBlockBox
        blocks={blocks}
        boardId={`plugin:${sdk.pluginId}:${uniqueKey}`}
        minHeight={280}
      />
      {sdk.host.mode === "dev" ? (
        <FloatButton type="primary" tooltip="Add config card" onClick={onAdd} />
      ) : null}
      <pre style={{ marginTop: 12, background: "#00000010", padding: 8 }}>
        {JSON.stringify({ deps }, null, 2)}
      </pre>
    </div>
  );
}
```

## 13. Invoking a backend handler

> Requires `backend.enabled: true` in `plugin.json`. See [backend-guide.md](backend-guide.md).

**Python side** (`backend/main.py`):

```python
from plugin_runtime import handler, run
import os

@handler("read_file")
def read_file(params):
    path = params.get("path", "")
    if not os.path.isfile(path):
        raise FileNotFoundError(f"File not found: {path}")
    with open(path, "r", encoding="utf-8") as f:
        return {"content": f.read(), "size": os.path.getsize(path)}

if __name__ == "__main__":
    run()
```

**TypeScript side** (`src/index.tsx`):

```ts
interface FileResult {
  content: string;
  size: number;
}

const file = await sdk.backend.invoke<FileResult>("read_file", {
  path: "C:/Users/me/notes/todo.txt",
});
console.log(file.content, `(${file.size} bytes)`);
```

## 14. Backend + sidebar view (full example)

```tsx
import React from "react";
import type { Disposable, FatNotesPluginSDK } from "fat-notes-sdk";

const disposables: Disposable[] = [];

interface StatusResult {
  cpu: number;
  memory: number;
}

function SystemMonitor({ sdk }: { sdk: FatNotesPluginSDK }) {
  const [status, setStatus] = React.useState<StatusResult | null>(null);

  React.useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const s = await sdk.backend.invoke<StatusResult>("system_status");
        if (active) setStatus(s);
      } catch (e) {
        sdk.ui.toast.error(`Backend error: ${(e as Error).message}`);
      }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  if (!status) return <div>Loading...</div>;
  return (
    <div style={{ padding: 12 }}>
      <p>CPU: {status.cpu}%</p>
      <p>Memory: {status.memory}%</p>
    </div>
  );
}

export async function activate(sdk: FatNotesPluginSDK) {
  disposables.push(
    sdk.contributions.registerActivityBarItem({
      id: "sysmon.icon",
      title: "System Monitor",
      icon: "Activity",
      primarySidebarViewId: "sysmon.view",
    }),
  );
  disposables.push(
    sdk.contributions.registerSidebarView("primary", {
      id: "sysmon.view",
      title: "System Monitor",
      render: () => <SystemMonitor sdk={sdk} />,
    }),
  );
}

export function deactivate() {
  while (disposables.length) disposables.pop()?.dispose();
}
```

Corresponding `backend/main.py`:

```python
import psutil
from plugin_runtime import handler, run

@handler("system_status")
def system_status(params):
    return {
        "cpu": psutil.cpu_percent(interval=0.5),
        "memory": psutil.virtual_memory().percent,
    }

if __name__ == "__main__":
    run()
```

With `requirements.txt`:

```
psutil==5.9.8
```

## 15. Checking backend availability before invoking

```ts
const running = await sdk.backend.isRunning();
if (!running) {
  sdk.ui.toast.warn("Backend is not running. Attempting restart...");
  await sdk.backend.restart();
}
const result = await sdk.backend.invoke("my_handler", { key: "value" });
```

## 16. Registering block display config + using host common config blocks

```tsx
import React from "react";
import type { Disposable, FatNotesPluginSDK } from "fat-notes-sdk";

const disposables: Disposable[] = [];

export async function activate(sdk: FatNotesPluginSDK) {
  disposables.push(
    sdk.contributions.registerBlockDisplayConfig({
      id: "hello.counter.display",
      blockType: "hello.counter",
      render: () => {
        const common = sdk.remoteComponents.BlockConfigCommon as Record<
          string,
          React.ComponentType<unknown>
        >;
        const BlockName = common.BlockName;
        const DisplayCollapse = common.DisplayCollapse;
        const DisplayBox = common.DisplayBox;
        if (!BlockName || !DisplayCollapse || !DisplayBox) return null;
        return (
          <>
            <BlockName />
            <DisplayCollapse title="Counter Config">
              <DisplayBox title="Threshold">Plugin custom controls</DisplayBox>
            </DisplayCollapse>
          </>
        );
      },
    }),
  );
}

export function deactivate() {
  while (disposables.length) disposables.pop()?.dispose();
}
```

## 17. Getting host system paths from backend

> Requires `backend.enabled: true` in `plugin.json`. See [backend-guide.md](backend-guide.md).

**Python side** (`backend/main.py`):

```python
from plugin_runtime import handler, run, host_get_system_paths

@handler("getSystemPaths")
def get_system_paths(params):
    return host_get_system_paths()

if __name__ == "__main__":
    run()
```

**TypeScript side** (`src/index.tsx`):

```ts
interface SystemPaths {
  configAbsolutePath: string;
  lastClosedFolder: string;
}

const paths = await sdk.backend.invoke<SystemPaths>("getSystemPaths");
console.log("Config Path:", paths.configAbsolutePath);
console.log("Workspace Folder:", paths.lastClosedFolder);
```
