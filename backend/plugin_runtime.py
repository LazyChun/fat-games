"""
FatNotes Plugin Backend Runtime

Lightweight JSON-RPC server for bespoke plugin backends.
Reads requests from stdin, dispatches to registered handlers, writes responses
to stdout. The host process communicates with this script via subprocess
stdin/stdout pipes.

Usage in your plugin's backend/main.py:

    from plugin_runtime import handler, run

    @handler("myHandler")
    def my_handler(params):
        return {"result": "ok"}

    if __name__ == "__main__":
        run()
"""

import sys
import json
import asyncio
import traceback
import os
import threading
import concurrent.futures
from urllib import request as _urlrequest
from urllib import error as _urlerror
from typing import Callable, Dict, Any, Optional

_handlers: Dict[str, Callable] = {}

# stdout 协议写出锁：并发分发后多个 worker 线程都会写响应，
# 必须整行原子写出，否则 JSON 行交错会破坏 RPC 协议 - AgentCode
_stdout_lock = threading.Lock()
_ctx_lock = threading.Lock()

# RPC 分发线程池：宿主按请求 id 异步等待响应，慢 handler（如策略预览
# 的批量计算）放入线程池执行，避免阻塞主循环拖慢后续所有请求 - AgentCode
_dispatch_pool = concurrent.futures.ThreadPoolExecutor(
    max_workers=8, thread_name_prefix="rpc-dispatch"
)

# Cached __fatHost context passed by the host with every invoke call.
# Used as a fallback when direct HTTP callbacks to the host fail, so that
# plugin config (including persisted workspaceRoot) is always available.
_cached_host_context: Optional[Dict[str, Any]] = None


def _set_host_context(ctx: Optional[Dict[str, Any]]) -> None:
    global _cached_host_context
    if isinstance(ctx, dict):
        with _ctx_lock:
            _cached_host_context = ctx


def _host_base_url() -> str:
    return (os.getenv("FAT_NOTES_PLUGIN_HOST_URL") or "").strip().rstrip("/")


def _host_plugin_id() -> str:
    return (os.getenv("FAT_NOTES_PLUGIN_ID") or "").strip()


def _host_call(
    method: str, params: Optional[Dict[str, Any]] = None, timeout: float = 10
) -> Any:
    base = _host_base_url()
    pid = _host_plugin_id()
    if not base:
        raise RuntimeError("FAT_NOTES_PLUGIN_HOST_URL is not set")
    if not pid:
        raise RuntimeError("FAT_NOTES_PLUGIN_ID is not set")
    url = f"{base}/app/pluginBackend/hostCall"
    payload = json.dumps(
        {"pluginId": pid, "method": method, "params": params or {}},
        ensure_ascii=False,
    ).encode("utf-8")
    req = _urlrequest.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    # 显式禁用代理：fat-notes 宿主侧是本机 HTTP 服务（如 127.0.0.1:8022），
    # 但子进程会继承系统代理设置（Windows 注册表 / 环境变量），导致
    # urllib.request 把请求发到代理服务器，代理无法转发到宿主端口，
    # 表现为 "Remote end closed connection without response"。
    # 通过自定义 ProxyHandler 空代理 + build_opener 强制直连。
    opener = _urlrequest.build_opener(_urlrequest.ProxyHandler({}))
    try:
        with opener.open(req, timeout=timeout) as resp:
            body = resp.read().decode("utf-8")
    except _urlerror.HTTPError as e:
        err = e.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"Host API HTTPError {e.code}: {err}") from e
    except Exception as e:
        raise RuntimeError(f"Host API request failed: {e}") from e
    try:
        data = json.loads(body)
    except Exception as e:
        raise RuntimeError(f"Host API invalid response: {body[:200]}") from e
    if isinstance(data, dict) and data.get("isOk") is False:
        raise RuntimeError(data.get("message") or "Host API call failed")
    if isinstance(data, dict):
        return data.get("data")
    return data


def host_is_reachable() -> bool:
    """探测宿主 HTTP 通道是否已经可用。

    通过一次轻量 host call 判断；已缓存 __fatHost 上下文也算就绪。
    用于 backend 启动早期判断宿主是否已能响应回调。
    """
    if _cached_host_context is not None:
        return True
    base = _host_base_url()
    pid = _host_plugin_id()
    if not base or not pid:
        return False
    try:
        _host_call("pluginConfig.get", {})
        return True
    except Exception:
        return False


def wait_for_host_ready(
    timeout: float = 30.0, poll_interval: float = 0.5
) -> bool:
    """轮询等待宿主就绪，最多等待 timeout 秒。

    backend 进程启动后，巡检等后台线程可能先于宿主 HTTP 通道就绪运行，
    此时 host_get_plugin_config / host_get_system_paths 会因 HTTP 失败返回空，
    导致 get_workspace_root() 走 Path.cwd() 兜底，解析出非预期工作区路径。
    本函数在后台线程首次执行前调用，确保宿主可达后再开始工作。

    Returns:
        True 表示宿主已就绪；False 表示超时仍未就绪（调用方应自行兜底）。
    """
    import time

    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if host_is_reachable():
            return True
        # 在等待期间也响应停止信号由调用方判断；这里仅做纯等待
        time.sleep(poll_interval)
    return False


def host_get_login_info() -> Dict[str, Any]:
    result = _host_call("auth.getLoginInfo", {})
    return result if isinstance(result, dict) else {}


def host_get_system_paths() -> Dict[str, Any]:
    """获取宿主软件的工作目录及配置路径信息。

    优先用 invoke 附带的 __fatHost.systemPaths，避免 handler 内再 HTTP 回调宿主
    （单线程 stdin RPC 下易拖满超时）。
    """
    if _cached_host_context and isinstance(_cached_host_context.get("systemPaths"), dict):
        cached = _cached_host_context["systemPaths"]
        if cached:
            return cached
    try:
        result = _host_call("system.getPaths", {})
        if isinstance(result, dict) and result:
            return result
    except Exception:
        pass
    return {}


def host_get_plugin_config() -> Dict[str, Any]:
    """读取宿主 plugin config；优先用 __fatHost.config 缓存。"""
    if _cached_host_context and isinstance(_cached_host_context.get("config"), dict):
        cached = _cached_host_context["config"]
        # 空 dict 也视为有效缓存，避免无意义的 HTTP 往返
        return cached
    try:
        result = _host_call("pluginConfig.get", {})
        if isinstance(result, dict) and result:
            return result
    except Exception:
        pass
    return {}


def host_set_plugin_config(
    config_data: Optional[Dict[str, Any]], merge: bool = True
) -> Dict[str, Any]:
    if not isinstance(config_data, dict):
        config_data = {}
    result = _host_call(
        "pluginConfig.set",
        {"config": config_data, "merge": bool(merge)},
    )
    return result if isinstance(result, dict) else {}


def host_call(method: str, params: Optional[Dict[str, Any]] = None, timeout: float = 10) -> Any:
    """通用宿主 API 调用（公开版）。

    Args:
        method: 宿主 hostCall 方法名（如 "ai.chat" / "flow.execute"）。
        params: 方法参数 dict。
        timeout: HTTP 超时秒数。LLM / flow 执行耗时较长，调用方应显式调大。
    """
    return _host_call(method, params, timeout)


def host_ai_get_models() -> list:
    """列出宿主 AI 模型（脱敏，无 apiKey）。"""
    result = _host_call("ai.getModels", {})
    return result if isinstance(result, list) else []


def host_ai_chat(
    model_id: str,
    messages: list,
    sys_prompt: Optional[str] = None,
    timeout: float = 300,
) -> Dict[str, Any]:
    """调用宿主 LLM chat 通道（与前端 sdk.ai.chat 同通道，apiKey 由宿主管理）。

    Args:
        model_id: 宿主 AI 模型 id。
        messages: [{"role": "system"|"user"|"assistant", "content": "..."}]。
        sys_prompt: 可选 system prompt（宿主会前置到 messages）。
        timeout: 默认 300s（LLM 响应可能较慢）。

    Returns:
        {"content": str, "model": str, "toolSteps": list, "iterations": int, ...}
    """
    payload: Dict[str, Any] = {"modelId": model_id, "messages": messages}
    if sys_prompt:
        payload["sysPrompt"] = sys_prompt
    result = _host_call("ai.chat", payload, timeout)
    return result if isinstance(result, dict) else {"content": str(result)}


def host_flow_list() -> list:
    """列出宿主思维 flow 摘要（id/name/description 等）。"""
    result = _host_call("flow.list", {})
    return result if isinstance(result, list) else []


def host_flow_get(flow_id: str) -> Optional[Dict[str, Any]]:
    """按 id 加载宿主完整 Flow（不存在返回 None）。"""
    if not flow_id:
        return None
    result = _host_call("flow.get", {"flowId": flow_id})
    return result if isinstance(result, dict) else None


def host_flow_execute(
    flow_id: str,
    inputs: Optional[Dict[str, Any]] = None,
    timeout: float = 600,
) -> Dict[str, Any]:
    """执行宿主思维 flow（与 /app/flow/execute 行为一致）。

    Returns:
        {"session_id", "success", "outputs", "error", "duration_ms", "execution_path"}
    """
    result = _host_call(
        "flow.execute",
        {"flowId": flow_id, "inputs": inputs or {}},
        timeout,
    )
    return result if isinstance(result, dict) else {"success": False, "error": "invalid flow.execute response"}


def handler(name: str):
    """Decorator to register a backend handler.

    Args:
        name: The handler name that the frontend will use to invoke this function
              via sdk.backend.invoke(name, params).

    Example:
        @handler("processFile")
        def process_file(params):
            file_path = params.get("path")
            # ... do work ...
            return {"status": "done"}
    """
    def decorator(fn: Callable) -> Callable:
        _handlers[name] = fn
        return fn
    return decorator


def list_handlers():
    """Return a list of all registered handler names."""
    return list(_handlers.keys())


def get_handler(name: str) -> Optional[Callable]:
    """按名取已注册的 handler 函数；不存在返回 None。

    供 mcpToolService 等模块在进程内白名单路由复用（避免重复 HTTP 往返）。 - AgentCode
    """
    return _handlers.get(name)


def _execute_handler(fn: Callable, params: Dict[str, Any]) -> Any:
    """Execute a handler function, supporting both sync and async."""
    if asyncio.iscoroutinefunction(fn):
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if loop and loop.is_running():
            # If there's already a running loop, create a new one in a thread
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as pool:
                future = pool.submit(asyncio.run, fn(params))
                return future.result()
        else:
            return asyncio.run(fn(params))
    else:
        return fn(params)


def _send_response(resp: Dict[str, Any]) -> None:
    """整行原子写出一条 RPC 响应（多线程安全）。 - AgentCode"""
    with _stdout_lock:
        print(json.dumps(resp, ensure_ascii=False))
        sys.stdout.flush()


def _dispatch_async(req_id: Any, handler_name: str, params: Dict[str, Any]) -> None:
    """在工作线程中执行 handler 并写出响应。 - AgentCode"""
    fn = _handlers.get(handler_name)
    if not fn:
        _send_response(
            {
                "id": req_id,
                "status": "error",
                "error": f"Handler not found: {handler_name}. Available: {list_handlers()}",
            }
        )
        return
    try:
        result = _execute_handler(fn, params)
        _send_response({"id": req_id, "status": "success", "result": result})
    except Exception as e:
        _send_response(
            {
                "id": req_id,
                "status": "error",
                "error": str(e),
                "traceback": traceback.format_exc(),
            }
        )


def run():
    """Main loop: read JSON-RPC requests from stdin, dispatch, write responses to stdout.

    Protocol:
        Request (one JSON object per line):
            {"id": "req-1", "handler": "handlerName", "params": {"key": "value"}}

        Response (one JSON object per line):
            {"id": "req-1", "status": "success", "result": <any>}
            {"id": "req-1", "status": "error", "error": "message", "traceback": "..."}

    业务 handler 在线程池中并发执行（宿主按请求 id 异步等待响应，
    支持乱序返回）；内置快命令（ping/list/shutdown）在主循环内联处理。

    Special handlers (built-in):
        - "__ping__": Returns {"pong": true} — used by host to check process health.
        - "__list_handlers__": Returns list of registered handler names.
        - "__shutdown__": Gracefully exits the process.
    """
    # Signal readiness to the host
    ready_msg = json.dumps({"status": "ready", "handlers": list_handlers()})
    print(ready_msg)
    sys.stdout.flush()

    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                # stdin closed — host terminated the pipe
                break

            line = line.strip()
            if not line:
                continue

            try:
                req = json.loads(line)
            except json.JSONDecodeError as e:
                _send_response({"id": None, "status": "error", "error": f"Invalid JSON: {e}"})
                continue

            req_id = req.get("id")
            handler_name = req.get("handler", "")
            params = req.get("params", {})

            # Cache __fatHost context (passed by host with every invoke call)
            # before dispatching, so host API fallbacks work even if HTTP
            # callbacks fail.
            if isinstance(params, dict) and "__fatHost" in params:
                _set_host_context(params.get("__fatHost"))

            # Built-in handlers（快命令，内联执行保证响应时延）
            if handler_name == "__ping__":
                _send_response({"id": req_id, "status": "success", "result": {"pong": True}})
            elif handler_name == "__list_handlers__":
                _send_response({"id": req_id, "status": "success", "result": list_handlers()})
            elif handler_name == "__shutdown__":
                _send_response({"id": req_id, "status": "success", "result": {"shutdown": True}})
                break
            else:
                # 业务 handler 丢入线程池并发执行，慢 handler 不阻塞主循环 - AgentCode
                _dispatch_pool.submit(_dispatch_async, req_id, handler_name, params)

        except KeyboardInterrupt:
            break
        except Exception as e:
            # Unexpected error in the main loop — try to report and continue
            try:
                _send_response({"id": None, "status": "error", "error": f"Runtime error: {e}"})
            except Exception:
                pass
