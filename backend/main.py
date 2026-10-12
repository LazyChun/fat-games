"""
FatNotes Bespoke Plugin — fat-games Backend Entry Point

游戏记录与排行榜专用 SQLite 后端。

前端调用方式：
    const result = await sdk.backend.invoke("scores.add", { gameId, score, playerName?, detail? });
    const result = await sdk.backend.invoke("scores.list", { gameId?, limit? });
    const result = await sdk.backend.invoke("scores.clear", { gameId? });
    const result = await sdk.backend.invoke("scores.stats", {});
    const result = await sdk.backend.invoke("scores.dbPath", {});

数据库文件：`<workspace>/fatGames/history.db`（stdlib sqlite3，无第三方依赖）。
"""

from plugin_runtime import handler, run

from service import scoreStore  # noqa: F401  （导入即注册 @handler）


@handler("scores.add")
def scores_add(params):
    """写入一条游戏成绩记录。

    params: { gameId, score, playerName?, detail? }
    """
    return scoreStore.add_record(params or {})


@handler("scores.list")
def scores_list(params):
    """查询成绩记录。params: { gameId?, limit? } → { items, total, limit }"""
    return scoreStore.list_records(params or {})


@handler("scores.clear")
def scores_clear(params):
    """清空成绩记录。params: { gameId? }（缺省全清）→ { removed }"""
    return scoreStore.clear_records(params or {})


@handler("scores.stats")
def scores_stats(_params):
    """各游戏成绩条数统计 → { total, items: [{gameId, count}] }"""
    return scoreStore.stats_records(_params or {})


@handler("scores.dbPath")
def scores_db_path(_params):
    """返回当前 SQLite 文件路径（便于排查与展示）。"""
    return {"path": str(scoreStore._db_path())}


if __name__ == "__main__":
    run()
