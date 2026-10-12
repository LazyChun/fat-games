# 游戏成绩记录存储
"""
fat-games 游戏成绩 —— 专用 SQLite 落库。

数据库文件：`<workspace>/fatGames/history.db`。

表 game_scores：
    id           自增主键
    game_id      游戏 id（如 snake / 2048 / minesweeper）
    game_title   游戏显示名（冗余，便于列表直接展示）
    player_name  玩家名（可选，缺省 "匿名"）
    score        分数（越大越好）
    detail       JSON 字符串（可选，截断后的对局详情）
    created_at   ISO 时间字符串（本地时区）
    created_ts   Unix 时间戳（排序/清理用）
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from plugin_runtime import host_get_system_paths

DB_DIR_NAME = "fatGames"
DB_FILE_NAME = "history.db"

# 每个游戏最多保留的记录条数（超出后淘汰最旧）
MAX_ROWS_PER_GAME = 500
MAX_FIELD_LEN = 2000
MAX_DETAIL_VALUE_LEN = 20000

_lock = threading.Lock()
_conn: Optional[sqlite3.Connection] = None
_cached_root: Optional[Path] = None


def _workspace_root() -> Path:
    """宿主工作区根目录解析（与 fat-tools 同策略，简化版）。"""
    import os

    global _cached_root
    if _cached_root is not None:
        return _cached_root

    env_folder = str(os.getenv("FAT_NOTES_LAST_CLOSED_FOLDER") or "").strip()
    if env_folder:
        _cached_root = Path(env_folder)
        return _cached_root

    try:
        system_paths = host_get_system_paths() or {}
    except Exception:
        system_paths = {}

    last_closed = str(system_paths.get("lastClosedFolder") or "").strip()
    if last_closed:
        _cached_root = Path(last_closed)
        return _cached_root

    config_path = str(system_paths.get("configAbsolutePath") or "").strip()
    if config_path:
        _cached_root = Path(config_path).parent
        return _cached_root

    _cached_root = Path.home() / "FatNotes"
    return _cached_root


def _db_path() -> Path:
    return _workspace_root() / DB_DIR_NAME / DB_FILE_NAME


def _get_conn() -> sqlite3.Connection:
    global _conn
    if _conn is not None:
        return _conn
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), check_same_thread=False)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS game_scores (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id      TEXT NOT NULL,
            game_title   TEXT NOT NULL DEFAULT '',
            player_name  TEXT NOT NULL DEFAULT '',
            score        REAL NOT NULL DEFAULT 0,
            detail       TEXT NOT NULL DEFAULT '',
            created_at   TEXT NOT NULL,
            created_ts   REAL NOT NULL
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_game_scores_game ON game_scores(game_id, created_ts DESC)"
    )
    conn.commit()
    _conn = conn
    return conn


def _truncate(value: Any, limit: int = MAX_FIELD_LEN) -> str:
    if value is None:
        return ""
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
    if len(text) > limit:
        return text[:limit] + "…"
    return text


def _clean_detail(detail: Any) -> str:
    if detail in (None, "", {}):
        return ""
    if isinstance(detail, str):
        return _truncate(detail)
    if isinstance(detail, dict):
        cleaned: Dict[str, Any] = {}
        for k, v in list(detail.items())[:20]:
            if isinstance(v, str):
                cleaned[str(k)[:100]] = _truncate(v, MAX_DETAIL_VALUE_LEN)
            else:
                try:
                    text = json.dumps(v, ensure_ascii=False)
                except Exception:
                    cleaned[str(k)[:100]] = _truncate(v, MAX_DETAIL_VALUE_LEN)
                    continue
                if len(text) <= MAX_DETAIL_VALUE_LEN:
                    cleaned[str(k)[:100]] = v
                else:
                    try:
                        cleaned[str(k)[:100]] = json.loads(_truncate(text, MAX_DETAIL_VALUE_LEN))
                    except Exception:
                        cleaned[str(k)[:100]] = _truncate(text, MAX_DETAIL_VALUE_LEN)
        return json.dumps(cleaned, ensure_ascii=False)
    return _truncate(detail)


def add_record(params: Dict[str, Any]) -> Dict[str, Any]:
    """写入一条游戏成绩记录，并按 MAX_ROWS_PER_GAME 修剪该游戏的旧记录。"""
    game_id = str(params.get("gameId") or "").strip()
    if not game_id:
        raise ValueError("gameId is required")
    game_title = _truncate(params.get("gameTitle") or game_id, 100)
    player_name = _truncate(params.get("playerName") or "匿名", 100)
    try:
        score = float(params.get("score") or 0)
    except (TypeError, ValueError):
        score = 0.0
    detail = _clean_detail(params.get("detail"))

    now_ts = time.time()
    now_at = datetime.fromtimestamp(now_ts).isoformat(timespec="seconds")

    with _lock:
        conn = _get_conn()
        cur = conn.execute(
            "INSERT INTO game_scores (game_id, game_title, player_name, score, detail, created_at, created_ts)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (game_id, game_title, player_name, score, detail, now_at, now_ts),
        )
        record_id = cur.lastrowid
        conn.execute(
            """
            DELETE FROM game_scores
             WHERE game_id = ?
               AND id NOT IN (
                   SELECT id FROM game_scores WHERE game_id = ?
                   ORDER BY created_ts DESC, id DESC LIMIT ?
               )
            """,
            (game_id, game_id, MAX_ROWS_PER_GAME),
        )
        conn.commit()

    return {"id": record_id, "createdAt": now_at}


def list_records(params: Dict[str, Any]) -> Dict[str, Any]:
    """查询成绩记录：可按 gameId 过滤，limit 默认 50，返回按分数倒序。"""
    game_id = str(params.get("gameId") or "").strip()
    try:
        limit = max(1, min(int(params.get("limit") or 50), 500))
    except (TypeError, ValueError):
        limit = 50

    sql = (
        "SELECT id, game_id, game_title, player_name, score, detail, created_at, created_ts"
        " FROM game_scores"
    )
    args: List[Any] = []
    if game_id:
        sql += " WHERE game_id = ?"
        args.append(game_id)
    sql += " ORDER BY score DESC, created_ts DESC, id DESC LIMIT ?"
    args.append(limit)

    with _lock:
        conn = _get_conn()
        rows = conn.execute(sql, args).fetchall()
        if game_id:
            total = conn.execute(
                "SELECT COUNT(*) FROM game_scores WHERE game_id = ?", (game_id,)
            ).fetchone()[0]
        else:
            total = conn.execute("SELECT COUNT(*) FROM game_scores").fetchone()[0]

    items = [
        {
            "id": r[0],
            "gameId": r[1],
            "gameTitle": r[2],
            "playerName": r[3],
            "score": r[4],
            "detail": (json.loads(r[5]) if r[5] else {}),
            "createdAt": r[6],
        }
        for r in rows
    ]
    return {"items": items, "total": total, "limit": limit}


def clear_records(params: Dict[str, Any]) -> Dict[str, Any]:
    """清空记录：带 gameId 只清该游戏，否则全清。"""
    game_id = str(params.get("gameId") or "").strip()
    with _lock:
        conn = _get_conn()
        if game_id:
            cur = conn.execute("DELETE FROM game_scores WHERE game_id = ?", (game_id,))
        else:
            cur = conn.execute("DELETE FROM game_scores")
        conn.commit()
        removed = cur.rowcount if cur.rowcount and cur.rowcount > 0 else 0
    return {"removed": removed}


def stats_records(_params: Dict[str, Any]) -> Dict[str, Any]:
    """各游戏成绩条数统计（用于排行榜页顶部概览）。"""
    with _lock:
        conn = _get_conn()
        rows = conn.execute(
            "SELECT game_id, game_title, COUNT(*) FROM game_scores"
            " GROUP BY game_id, game_title ORDER BY COUNT(*) DESC"
        ).fetchall()
        total = conn.execute("SELECT COUNT(*) FROM game_scores").fetchone()[0]
    return {
        "total": total,
        "items": [{"gameId": r[0], "gameTitle": r[1], "count": r[2]} for r in rows],
    }
