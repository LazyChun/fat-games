/*
 * ScoresView：排行榜 / 成绩记录
 *
 * 展示各游戏成绩统计、Top 列表与按游戏过滤；可清空记录。
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Empty,
  Popconfirm,
  Select,
  Table,
  Tag,
  Tooltip,
} from "antd";
import { ClearOutlined, ReloadOutlined } from "@ant-design/icons";
import type { FatNotesPluginSDK } from "fat-notes-sdk";
import {
  clearScores,
  listScores,
  scoreStats,
  type ScoreRecord,
  type ScoreStats,
} from "../scoreClient";
import { useI18n } from "../hooks";
import GameFrame, { GhostBtn, StatChip, CHIP_GOLD, CHIP_BLUE } from "./GameFrame";

interface Option {
  label: string;
  value: string;
}

const ScoresView: React.FC<{ sdk: FatNotesPluginSDK }> = () => {
  const i18n = useI18n();
  const [items, setItems] = useState<ScoreRecord[]>([]);
  const [stats, setStats] = useState<ScoreStats | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [list, st] = await Promise.all([
        listScores({
          gameId: filter === "all" ? undefined : filter,
          limit: 100,
        }),
        scoreStats(),
      ]);
      setItems(list.items);
      setStats(st);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  // 加载/过滤变化时刷新
  useEffect(() => {
    void reload();
  }, [reload]);

  // 游戏下拉选项
  const options: Option[] = useMemo(() => {
    const opts: Option[] = [
      { label: i18n.text("game.scores.filterAll"), value: "all" },
    ];
    if (stats) {
      for (const it of stats.items) {
        opts.push({ label: it.gameTitle, value: it.gameId });
      }
    }
    return opts;
  }, [stats, i18n]);

  const handleClear = useCallback(async () => {
    await clearScores(filter === "all" ? undefined : filter);
    await reload();
  }, [filter, reload]);

  const columns = useMemo(
    () => [
      {
        title: i18n.text("game.scores.col.game"),
        dataIndex: "gameTitle",
        key: "gameTitle",
        width: 120,
        render: (text: string, record: ScoreRecord) => (
          <Tag color="blue">{record.gameTitle}</Tag>
        ),
      },
      {
        title: i18n.text("game.scores.col.player"),
        dataIndex: "playerName",
        key: "playerName",
        width: 120,
        ellipsis: true,
      },
      {
        title: i18n.text("game.scores.col.score"),
        dataIndex: "score",
        key: "score",
        width: 100,
        align: "right" as const,
        sorter: (a: ScoreRecord, b: ScoreRecord) => a.score - b.score,
        render: (score: number) => score.toLocaleString("en-US"),
      },
      {
        title: i18n.text("game.scores.col.detail"),
        dataIndex: "detail",
        key: "detail",
        render: (detail: Record<string, unknown>) => {
          if (!detail || Object.keys(detail).length === 0) return "—";
          return (
            <Tooltip
              title={Object.entries(detail)
                .map(([k, v]) => `${k}: ${String(v)}`)
                .join("\n")}
            >
              <span style={{ cursor: "help", color: "#1677ff" }}>
                {Object.entries(detail)
                  .map(([k, v]) => `${k}=${String(v)}`)
                  .join(", ")}
              </span>
            </Tooltip>
          );
        },
      },
      {
        title: i18n.text("game.scores.col.time"),
        dataIndex: "createdAt",
        key: "createdAt",
        width: 180,
      },
    ],
    [i18n],
  );

  const totalRecords = stats?.total ?? 0;
  const gameCount = stats?.items.length ?? 0;

  return (
    <GameFrame
      emoji="🏆"
      title={i18n.text("game.scores.title2")}
      stats={[
        { label: i18n.text("game.scores.total"), value: totalRecords, colors: CHIP_GOLD },
        { label: i18n.text("game.scores.games"), value: gameCount, colors: CHIP_BLUE },
      ]}
      headerExtra={
        <>
          <Select
            value={filter}
            onChange={setFilter}
            style={{ width: 140 }}
            options={options}
          />
          <GhostBtn onClick={() => void reload()} disabled={loading}>
            <ReloadOutlined />
            {i18n.text("game.scores.refresh")}
          </GhostBtn>
          <Popconfirm
            title={i18n.text("game.scores.confirmTitle")}
            description={
              filter === "all"
                ? i18n.text("game.scores.confirmClearAll")
                : i18n.text("game.scores.confirmClearFiltered")
            }
            okText={i18n.text("common.clear")}
            cancelText={i18n.text("common.cancel")}
            okButtonProps={{ danger: true }}
            onConfirm={() => void handleClear()}
          >
            <GhostBtn onClick={() => undefined}>
              <ClearOutlined />
              {i18n.text("common.clear")}
            </GhostBtn>
          </Popconfirm>
        </>
      }
      help={i18n.text("game.scores.help")}
      maxWidth={860}
      padded={false}
    >
      <div style={{ width: "100%" }}>
        {stats && stats.items.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              marginBottom: 12,
            }}
          >
            {stats.items.map((it) => (
              <StatChip
                key={it.gameId}
                label={it.gameTitle}
                value={it.count}
              />
            ))}
          </div>
        )}
        {items.length === 0 ? (
          <div style={{ padding: "30px 0" }}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={i18n.text("game.scores.empty")}
            />
          </div>
        ) : (
          <Table
            rowKey={(r) => String(r.id)}
            columns={columns}
            dataSource={items}
            loading={loading}
            size="small"
            pagination={{ pageSize: 10, showSizeChanger: false }}
          />
        )}
      </div>
    </GameFrame>
  );
};

export default ScoresView;
