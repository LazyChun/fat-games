/*
 * ScoresView：排行榜 / 成绩记录
 *
 * 展示各游戏成绩统计、Top 列表与按游戏过滤；可清空记录。
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Card,
  Empty,
  Popconfirm,
  Select,
  Space,
  Statistic,
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
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Card size="small" style={{ minWidth: 140 }}>
          <Statistic
            title={i18n.text("game.scores.total")}
            value={totalRecords}
          />
        </Card>
        <Card size="small" style={{ minWidth: 140 }}>
          <Statistic title={i18n.text("game.scores.games")} value={gameCount} />
        </Card>
        {stats?.items.map((it) => (
          <Card key={it.gameId} size="small" style={{ minWidth: 140 }}>
            <Statistic
              title={it.gameTitle}
              value={it.count}
              suffix={i18n.text("game.scores.recordsSuffix")}
            />
          </Card>
        ))}
      </div>

      <Card
        size="small"
        title={i18n.text("game.scores.title2")}
        extra={
          <Space>
            <Select
              value={filter}
              onChange={setFilter}
              style={{ width: 160 }}
              options={options}
            />
            <Button
              icon={<ReloadOutlined />}
              onClick={() => void reload()}
              loading={loading}
            >
              {i18n.text("game.scores.refresh")}
            </Button>
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
              <Button danger icon={<ClearOutlined />}>
                {i18n.text("common.clear")}
              </Button>
            </Popconfirm>
          </Space>
        }
      >
        {items.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={i18n.text("game.scores.empty")}
          />
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
      </Card>

      <div style={{ color: "rgba(0,0,0,0.45)", fontSize: 12 }}>
        {i18n.text("game.scores.help")}
      </div>
    </div>
  );
};

export default ScoresView;
