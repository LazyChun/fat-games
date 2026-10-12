# FatNotes Plugin — Backend Guide

This guide covers the **optional** Python backend subsystem for bespoke plugins.
Backend code runs as a separate Python subprocess managed by the FatNotes host.

> **SDK-First Principle:** Only use a plugin backend when `sdk.query`, `sdk.mutation`,
> `sdk.dataSource`, and other built-in APIs cannot fulfill the requirement.
> Common backend use cases: file system access, external HTTP calls without CORS,
> CPU-heavy compute, ML inference, subprocess orchestration.

---

## Enabling Backend

### When scaffolding a new plugin

```bash
fn-ext create my-plugin --name "My Plugin" --backend
```

This sets `backend.enabled: true` in `plugin.json` and generates:

```
my-plugin/
├── backend/
│   ├── main.py              # entry point — register your handlers here
│   ├── plugin_runtime.py    # framework (DO NOT EDIT)
│   └── requirements.txt     # Python dependencies
├── plugin.json              # manifest with backend section
└── ...
```

### Adding backend to an existing plugin

1. Create the `backend/` directory with `main.py`, `plugin_runtime.py`, and
   `requirements.txt` (copy from the template or another plugin).
2. In `plugin.json`, add:
   ```json
   "backend": {
     "enabled": true,
     "entry": "backend/main.py",
     "requirements": "backend/requirements.txt",
     "depsStrategy": "vendor"
   }
   ```

---

## Backend Architecture

```
┌─────────────────────────┐         JSON-RPC (stdin/stdout)
│  FatNotes Host (Python)  │ ────────────────────────────────┐
│  pluginBackendService.py │                                 │
└─────────────────────────┘                                 ▼
                                              ┌──────────────────────┐
                                              │ Plugin Backend (Python)│
                                              │   main.py              │
                                              └──────────────────────┘
```

- The host spawns the plugin backend as a **subprocess**.
- Communication uses **JSON-RPC** over stdin/stdout (no network ports needed).
- Each plugin gets its own isolated process.
- On plugin unload, the host sends a `__shutdown__` command and terminates gracefully.

---

## Writing Handlers

Handlers are Python functions decorated with `@handler(name)`:

```python
# backend/main.py
from plugin_runtime import handler, run

@handler("hello")
def hello(params):
    name = params.get("name", "world")
    return {"message": f"Hello, {name}!"}

@handler("compute")
def compute(params):
    """CPU-heavy work that shouldn't block the UI thread."""
    data = params.get("data", [])
    result = sum(x ** 2 for x in data)
    return {"result": result}

if __name__ == "__main__":
    run()
```

### Handler rules

- `params` is always a `dict` (JSON object from the frontend).
- Return value must be JSON-serializable (dict, list, str, int, float, bool, None).
- Handlers can be sync or `async def` (the runtime handles both).
- Exceptions are caught and returned as JSON-RPC errors to the frontend.
- Built-in handlers (`__ping__`, `__list_handlers__`, `__shutdown__`) are reserved.

---

## Host APIs (Host Context)

The `plugin_runtime.py` provides built-in functions to safely query information from the host without writing complex RPC logic. Always use these when you need host-level context:

- `host_get_plugin_config() -> dict`: Returns the current plugin's saved configuration.
- `host_set_plugin_config(config_data: dict, merge: bool = True) -> dict`: Updates the current plugin's configuration.
- `host_get_system_paths() -> dict`: Returns the host's work directories and configuration paths (e.g., `configAbsolutePath` and `lastClosedFolder`).

**Example:**
```python
from plugin_runtime import handler, host_get_system_paths

@handler("getSystemPaths")
def get_system_paths(params):
    return host_get_system_paths()
```

---

## Calling Backend from Frontend

Use `sdk.backend.invoke(handler, params)`:

```ts
// In your plugin's frontend code (src/index.tsx or a component)
const result = await sdk.backend.invoke<{ message: string }>("hello", {
  name: "Alice",
});
sdk.ui.toast.success(result.message); // "Hello, Alice!"
```

### BackendApi surface

```ts
sdk.backend.invoke<T>(handler: string, params?: Record<string, unknown>): Promise<T>
sdk.backend.isRunning(): Promise<boolean>
sdk.backend.restart(): Promise<void>
```

---

## Dependencies Strategy (`depsStrategy`)

The `depsStrategy` field in `plugin.json` controls how Python dependencies
(listed in `requirements.txt`) are resolved at runtime.

### `"vendor"` (default, recommended for distribution)

Dependencies are bundled **inside** the plugin package at build time:

```bash
fn-ext build
# or manually:
fn-ext pack-backend
```

This runs `pip install -r backend/requirements.txt --target dist/backend/vendor`
during the build step. The vendor directory is included in `install.zip`.

**Pros:** Zero runtime dependency installation; works on air-gapped machines.
**Cons:** Larger plugin package size.

### `"install"` (lighter package, requires pip at runtime)

Dependencies are installed **on first activation** by the host:

```
pip install -r requirements.txt --target <plugin_dir>/vendor
```

A marker file `.deps_installed` prevents repeated installs.

**Pros:** Smaller initial download.
**Cons:** Requires internet on first run; first activation is slower.

---

## Lifecycle

1. **Plugin loads** → Host calls `POST /app/pluginBackend/start`
   - Resolves the backend directory
   - Installs deps if `depsStrategy: "install"` and not yet installed
   - Spawns subprocess: `python main.py`
   - Waits for `{"status": "ready"}` on stdout
2. **Frontend calls `sdk.backend.invoke()`** → Host proxies to subprocess via stdin
3. **Plugin unloads** → Host calls `POST /app/pluginBackend/stop`
   - Sends `__shutdown__` to the subprocess
   - Terminates the process if it doesn't exit within 5s

---

## Project Layout with Backend

```
my-plugin/
├── backend/
│   ├── main.py              # your handlers
│   ├── plugin_runtime.py    # runtime framework (do not edit)
│   ├── requirements.txt     # pip dependencies
│   └── utils.py             # (optional) your helper modules
├── dist/                    # build output
│   ├── remoteEntry.js
│   ├── backend/
│   │   ├── main.py
│   │   ├── plugin_runtime.py
│   │   └── vendor/          # (if depsStrategy=vendor) bundled deps
│   └── ...
├── src/
│   ├── bootstrap.ts
│   ├── index.tsx
│   └── PluginView.tsx
├── types/
│   └── fat-notes-sdk.d.ts
├── plugin.json
├── package.json
└── webpack.config.js
```

---

## Debugging

- **View backend logs:** The host captures stderr from the subprocess. Check
  the FatNotes developer console for `[pluginBackend]` prefixed messages.
- **Test locally:** Run `python backend/main.py` directly and paste JSON-RPC
  requests into stdin:
  ```json
  { "id": "1", "method": "hello", "params": { "name": "test" } }
  ```
  You should see the response on stdout.
- **Check status:** `sdk.backend.isRunning()` returns `false` if the process
  crashed or was never started.
- **Restart after crash:** `sdk.backend.restart()` stops and re-spawns the process.

---

## Best Practices

1. **Keep handlers small.** Each handler should do one thing.
2. **Return structured data.** Always return a dict, not a raw string.
3. **Handle errors gracefully.** Raise exceptions with clear messages.
4. **Pin versions in `requirements.txt`.** Avoid `>=` — use `==` for reproducibility.
5. **Prefer `vendor` strategy for published plugins** to avoid runtime pip issues.
6. **Never print to stdout** outside of `plugin_runtime`'s protocol — it breaks
   JSON-RPC communication. Use `print(..., file=sys.stderr)` for debugging.
7. **Never read from stdin** — `plugin_runtime.run()` owns the stdin loop.
