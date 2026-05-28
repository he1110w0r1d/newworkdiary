import { pool } from "../db";
import crypto from "crypto";
import type { DiaryEntry, Mission, MissionNode, ModelServiceConfig, ThemeName, TodoItem } from "../../src/types";
import type { MissionPlan, OnboardingMissionStatus } from "../services/missionPlanner";

type ShareVisibility = "link" | "private" | "public";

type WorkDiarySnapshot = {
  diaries: DiaryEntry[];
  todos: TodoItem[];
  theme: ThemeName;
  share: {
    generated: boolean;
    visibility: ShareVisibility;
  };
};

type DiaryRow = {
  id: number;
  time: Date;
  title: string | null;
  source_type: "human" | "agent" | "system";
  summary: string | null;
  content: string;
  tags: string[] | null;
};

type TodoRow = {
  id: number;
  content: string;
  status: string;
  related_mission_id: number | null;
  mission_title: string | null;
};

type MissionRow = {
  id: number;
  parent_id: number | null;
  title: string;
  description: string | null;
  mission_type: "main" | "side";
  status: string;
  progress: number;
  tags: string[] | null;
  ai_reason: string | null;
};

type TimelineNodeRow = {
  id: number;
  timeline_id: number;
  title: string;
  summary: string | null;
  status: string;
  time: Date | null;
  ai_reason: string | null;
};

type ShareCardRow = {
  id: number;
  title: string;
  public_token: string;
  visibility: "public" | "link" | "password";
  password_hash: string | null;
  expires_at: string | null;
  content_snapshot: {
    diaryCount?: number;
    agentDiaryCount?: number;
    openTodoCount?: number;
    mainMissionTitle?: string;
    mainMissionProgress?: number;
    topTags?: string[];
  } | null;
  created_at: string;
};

export type TodoStatusHistoryItem = {
  id: number;
  todo_id: number;
  old_status: string | null;
  new_status: string;
  reason: string | null;
  created_at: string;
};

type SettingsRow = {
  theme: ThemeName | null;
  share_settings: {
    generated?: boolean;
    visibility?: ShareVisibility;
  } | null;
};

type ModelConfigRow = {
  llm_configs: Array<Partial<ModelServiceConfig>> | null;
  embedding_configs: Array<Partial<ModelServiceConfig>> | null;
};

type OnboardingStatusRow = {
  llm_configs: Array<Partial<ModelServiceConfig>> | null;
  embedding_configs: Array<Partial<ModelServiceConfig>> | null;
  diary_count: string;
  active_key_count: string;
};

export type RestoreBackupInput = Partial<{
  version: number;
  snapshot: {
    diaries?: Array<Partial<DiaryEntry>>;
    todos?: Array<Partial<TodoItem>>;
  };
  missions?: {
    missions?: Array<Partial<Mission>>;
    nodes?: Array<Partial<MissionNode>>;
  };
  modelConfig?: Partial<ModelServiceConfig>;
  latestShareCard?: Partial<{
    title: string;
    publicToken: string;
    visibility: ShareVisibility;
    expiresAt?: string | null;
    snapshot: ShareCardRow["content_snapshot"];
  }>;
}>;

export type RestoreApplySummary = {
  diaries: { created: number; updated: number; skipped: number };
  todos: { created: number; updated: number; skipped: number };
  modelConfig: { updated: boolean };
  missions: { replaced: boolean; created: number; nodesCreated: number; skipped: number };
  shareCard: { created: boolean; skipped: boolean };
};

export type RestoreStrategy = "skip_existing" | "overwrite_existing";

const DEMO_USER_ID = 1;

export async function getPostgresSnapshot(userId = DEMO_USER_ID): Promise<WorkDiarySnapshot> {
  const [diariesResult, todosResult, settingsResult] = await Promise.all([
    pool.query<DiaryRow>(
      `
        SELECT id, start_time AS time, title, source_type, summary, content, tags
        FROM diaries
        WHERE user_id = $1 AND is_deleted = FALSE
        ORDER BY start_time DESC, id DESC
        LIMIT 50
      `,
      [userId],
    ),
    pool.query<TodoRow>(
      `
        SELECT
          todos.id,
          todos.content,
          todos.status,
          todos.related_mission_id,
          mission_timelines.title AS mission_title
        FROM todos
        LEFT JOIN mission_timelines ON mission_timelines.id = todos.related_mission_id
        WHERE todos.user_id = $1
        ORDER BY todos.created_at DESC, todos.id DESC
        LIMIT 50
      `,
      [userId],
    ),
    pool.query<SettingsRow>(
      `
        SELECT theme, share_settings
        FROM app_settings
        WHERE user_id = $1
      `,
      [userId],
    ),
  ]);

  const settings = settingsResult.rows[0];

  return {
    diaries: diariesResult.rows.map(mapDiaryRow),
    todos: todosResult.rows.map(mapTodoRow),
    theme: settings?.theme ?? "草莓薄荷",
    share: {
      generated: settings?.share_settings?.generated ?? false,
      visibility: settings?.share_settings?.visibility ?? "link",
    },
  };
}

export async function getPostgresOnboardingMissionStatus(userId = DEMO_USER_ID): Promise<OnboardingMissionStatus> {
  const result = await pool.query<OnboardingStatusRow>(
    `
      SELECT
        users.llm_configs,
        users.embedding_configs,
        (
          SELECT COUNT(*)
          FROM diaries
          WHERE user_id = users.id AND is_deleted = FALSE
        )::text AS diary_count,
        (
          SELECT COUNT(*)
          FROM api_keys
          WHERE user_id = users.id
            AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        )::text AS active_key_count
      FROM users
      WHERE users.id = $1
    `,
    [userId],
  );

  const row = result.rows[0];
  const llmConfig = row?.llm_configs?.[0] ?? {};
  const embeddingConfig = row?.embedding_configs?.[0] ?? {};

  return {
    llmConfigured: Boolean(
      row?.llm_configs?.length &&
        String(llmConfig.provider ?? "").trim() &&
        String(llmConfig.baseUrl ?? "").trim() &&
        String(llmConfig.chatModel ?? "").trim(),
    ),
    embeddingConfigured: Boolean(
      row?.embedding_configs?.length &&
        String(embeddingConfig.provider ?? "").trim() &&
        String(embeddingConfig.baseUrl ?? "").trim() &&
        String(embeddingConfig.embeddingModel ?? "").trim(),
    ),
    diaryCreated: Number(row?.diary_count ?? 0) > 0,
    agentKeyCreated: Number(row?.active_key_count ?? 0) > 0,
  };
}

export async function createPostgresDiary(
  payload: Omit<DiaryEntry, "id">,
  userId = DEMO_USER_ID,
): Promise<DiaryEntry> {
  const result = await pool.query<DiaryRow>(
    `
      INSERT INTO diaries (
        user_id,
        source_type,
        title,
        content,
        summary,
        start_time,
        end_time,
        tags
      )
      VALUES ($1, $2, $3, $4, $5, CURRENT_DATE + $6::time, CURRENT_DATE + $6::time + INTERVAL '30 minutes', $7)
      RETURNING id, start_time AS time, title, source_type, summary, content, tags
    `,
    [
      userId,
      payload.source,
      payload.title,
      payload.summary,
      payload.summary,
      payload.time,
      payload.tags,
    ],
  );

  return mapDiaryRow(result.rows[0]);
}

export async function listPostgresMissions(userId = DEMO_USER_ID): Promise<MissionPlan> {
  const missionsResult = await pool.query<MissionRow>(
    `
      SELECT id, parent_id, title, description, mission_type, status, progress, tags, ai_reason
      FROM mission_timelines
      WHERE user_id = $1 AND status <> 'archived'
      ORDER BY mission_type ASC, parent_id NULLS FIRST, updated_at DESC, id DESC
    `,
    [userId],
  );

  const nodesResult = await pool.query<TimelineNodeRow>(
    `
      SELECT
        timeline_nodes.id,
        timeline_nodes.timeline_id,
        timeline_nodes.title,
        timeline_nodes.summary,
        timeline_nodes.status,
        timeline_nodes.start_time AS time,
        timeline_nodes.ai_reason
      FROM timeline_nodes
      INNER JOIN mission_timelines ON mission_timelines.id = timeline_nodes.timeline_id
      WHERE timeline_nodes.user_id = $1 AND mission_timelines.status <> 'archived'
      ORDER BY timeline_nodes.start_time DESC NULLS LAST, timeline_nodes.id DESC
      LIMIT 20
    `,
    [userId],
  );

  return {
    missions: missionsResult.rows.map(mapMissionRow),
    nodes: nodesResult.rows.map(mapTimelineNodeRow),
  };
}

export async function regeneratePostgresMissions(plan: MissionPlan, userId = DEMO_USER_ID) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM mission_timelines WHERE user_id = $1", [userId]);

    const insertedMissionIds: number[] = [];
    const firstMainMissionId = { current: undefined as number | undefined };
    const currentMainMissionId = { current: undefined as number | undefined };
    const missionTitleToId = new Map<string, number>();
    for (const mission of plan.missions) {
      const parentId =
        mission.tone === "side"
          ? mission.parentId ??
            (mission.parentTitle ? missionTitleToId.get(mission.parentTitle) : undefined) ??
            currentMainMissionId.current ??
            firstMainMissionId.current ??
            null
          : null;
      const result = await client.query<MissionRow>(
        `
          INSERT INTO mission_timelines (
            user_id,
            parent_id,
            title,
            description,
            mission_type,
            status,
            progress,
            tags,
            ai_reason,
            started_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)
          RETURNING id, parent_id, title, description, mission_type, status, progress, tags, ai_reason
        `,
        [
          userId,
          parentId,
          mission.title,
          mission.summary,
          mission.tone,
          mapMissionStatusToDb(mission.status),
          mission.progress,
          mission.tags ?? [],
          mission.aiReason ?? null,
        ],
      );
      insertedMissionIds.push(result.rows[0].id);
      missionTitleToId.set(mission.title, result.rows[0].id);
      if (mission.tone === "main" && firstMainMissionId.current === undefined) {
        firstMainMissionId.current = result.rows[0].id;
      }
      if (mission.tone === "main") {
        currentMainMissionId.current = result.rows[0].id;
      }
    }

    const mainMissionId = firstMainMissionId.current ?? insertedMissionIds[0];
    if (mainMissionId) {
      for (const node of plan.nodes) {
        const timelineId = node.missionTitle ? missionTitleToId.get(node.missionTitle) ?? mainMissionId : mainMissionId;
        await client.query(
          `
            INSERT INTO timeline_nodes (
              timeline_id,
              user_id,
              title,
              summary,
              status,
              start_time,
              ai_reason
            )
            VALUES ($1, $2, $3, $4, $5, CURRENT_DATE + $6::time, $7)
          `,
          [
            timelineId,
            userId,
            node.title,
            node.summary ?? node.source,
            mapMissionStatusToDb(node.status),
            node.time,
            node.source,
          ],
        );
      }
    }

    await client.query("COMMIT");
    return listPostgresMissions(userId);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createPostgresMissionNode(
  payload: {
    timelineId: number;
    title: string;
    summary?: string;
    status?: string;
    time?: string;
    source?: string;
    relatedDiaryIds?: number[];
  },
  userId = DEMO_USER_ID,
): Promise<MissionNode | null> {
  const timeline = await pool.query<{ id: number }>(
    `
      SELECT id
      FROM mission_timelines
      WHERE id = $1 AND user_id = $2 AND status <> 'archived'
    `,
    [payload.timelineId, userId],
  );

  if (!timeline.rows[0]) return null;

  const relatedDiaryIds = Array.from(new Set(payload.relatedDiaryIds ?? []))
    .filter((id) => Number.isInteger(id) && id > 0);
  if (relatedDiaryIds.length > 0) {
    const diaries = await pool.query<{ id: number }>(
      `
        SELECT id
        FROM diaries
        WHERE user_id = $1
          AND is_deleted = FALSE
          AND id = ANY($2::int[])
      `,
      [userId, relatedDiaryIds],
    );
    if (diaries.rows.length !== relatedDiaryIds.length) {
      throw new Error("relatedDiaryIds must belong to current user and active diaries");
    }
  }

  const result = await pool.query<TimelineNodeRow>(
    `
      INSERT INTO timeline_nodes (
        timeline_id,
        user_id,
        title,
        summary,
        status,
        start_time,
        related_diary_ids,
        ai_reason
      )
      VALUES ($1, $2, $3, $4, $5, CURRENT_DATE + $6::time, $7, $8)
      RETURNING id, timeline_id, title, summary, status, start_time AS time, ai_reason
    `,
    [
      payload.timelineId,
      userId,
      payload.title,
      payload.summary ?? null,
      mapMissionStatusToDb(payload.status ?? "进行中"),
      payload.time ?? new Date().toTimeString().slice(0, 5),
      relatedDiaryIds,
      payload.source ?? "Agent 写入",
    ],
  );

  await pool.query(
    `
      UPDATE mission_timelines
      SET updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND user_id = $2
    `,
    [payload.timelineId, userId],
  );

  return mapTimelineNodeRow(result.rows[0]);
}

export async function completePostgresMission(id: number, userId = DEMO_USER_ID): Promise<Mission | null> {
  const result = await pool.query<MissionRow>(
    `
      UPDATE mission_timelines
      SET status = 'completed',
          progress = 100,
          completed_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
        AND user_id = $2
        AND status <> 'archived'
      RETURNING id, parent_id, title, description, mission_type, status, progress, tags, ai_reason
    `,
    [id, userId],
  );

  return result.rows[0] ? mapMissionRow(result.rows[0]) : null;
}

export async function rollupPostgresMainMissionProgress(
  userId = DEMO_USER_ID,
  parentMissionId?: number | null,
): Promise<Mission | null> {
  const result = await pool.query<MissionRow>(
    `
      WITH side_stats AS (
        SELECT
          COUNT(*)::int AS side_count,
          COUNT(*) FILTER (WHERE status = 'completed' OR progress >= 100)::int AS completed_count
        FROM mission_timelines
        WHERE user_id = $1
          AND mission_type = 'side'
          AND status <> 'archived'
          AND ($2::int IS NULL OR parent_id = $2)
      ),
      open_todos AS (
        SELECT COUNT(*)::int AS open_count
        FROM todos
        WHERE user_id = $1
          AND status <> '已完成'
      )
      UPDATE mission_timelines
      SET
        progress = CASE
          WHEN side_stats.side_count > 0
            AND side_stats.completed_count = side_stats.side_count
            AND open_todos.open_count = 0
            THEN 100
          WHEN side_stats.side_count > 0
            THEN GREATEST(
              mission_timelines.progress,
              LEAST(96, ROUND(45 + side_stats.completed_count * 45.0 / side_stats.side_count)::int)
            )
          ELSE mission_timelines.progress
        END,
        status = CASE
          WHEN side_stats.side_count > 0
            AND side_stats.completed_count = side_stats.side_count
            AND open_todos.open_count = 0
            THEN 'completed'
          ELSE mission_timelines.status
        END,
        completed_at = CASE
          WHEN side_stats.side_count > 0
            AND side_stats.completed_count = side_stats.side_count
            AND open_todos.open_count = 0
            THEN COALESCE(mission_timelines.completed_at, CURRENT_TIMESTAMP)
          ELSE mission_timelines.completed_at
        END,
        updated_at = CURRENT_TIMESTAMP
      FROM side_stats, open_todos
      WHERE mission_timelines.user_id = $1
        AND mission_timelines.mission_type = 'main'
        AND mission_timelines.status NOT IN ('archived', 'completed')
        AND ($2::int IS NULL OR mission_timelines.id = $2)
      RETURNING
        mission_timelines.id,
        mission_timelines.parent_id,
        mission_timelines.title,
        mission_timelines.description,
        mission_timelines.mission_type,
        mission_timelines.status,
        mission_timelines.progress,
        mission_timelines.tags,
        mission_timelines.ai_reason
    `,
    [userId, parentMissionId ?? null],
  );

  return result.rows[0] ? mapMissionRow(result.rows[0]) : null;
}

export async function updatePostgresDiary(
  id: number,
  patch: Partial<Omit<DiaryEntry, "id">>,
  userId = DEMO_USER_ID,
): Promise<DiaryEntry | null> {
  const existing = await pool.query<DiaryRow>(
    `
      SELECT id, start_time AS time, title, source_type, summary, content, tags
      FROM diaries
      WHERE id = $1 AND user_id = $2 AND is_deleted = FALSE
    `,
    [id, userId],
  );

  if (!existing.rows[0]) return null;

  const current = mapDiaryRow(existing.rows[0]);
  const nextTime = patch.time ?? current.time;
  const nextSummary = patch.summary ?? current.summary;

  const result = await pool.query<DiaryRow>(
    `
      UPDATE diaries
      SET title = $3,
          source_type = $4,
          content = $5,
          summary = $5,
          start_time = CURRENT_DATE + $6::time,
          end_time = CURRENT_DATE + $6::time + INTERVAL '30 minutes',
          tags = $7,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND user_id = $2 AND is_deleted = FALSE
      RETURNING id, start_time AS time, title, source_type, summary, content, tags
    `,
    [
      id,
      userId,
      patch.title ?? current.title,
      patch.source ?? current.source,
      nextSummary,
      nextTime,
      patch.tags ?? current.tags,
    ],
  );

  return mapDiaryRow(result.rows[0]);
}

export async function listPostgresDeletedDiaries(userId = DEMO_USER_ID): Promise<DiaryEntry[]> {
  const result = await pool.query<DiaryRow>(
    `
      SELECT id, start_time AS time, title, source_type, summary, content, tags
      FROM diaries
      WHERE user_id = $1 AND is_deleted = TRUE
      ORDER BY updated_at DESC, id DESC
      LIMIT 50
    `,
    [userId],
  );

  return result.rows.map(mapDiaryRow);
}

export async function softDeletePostgresDiary(id: number, userId = DEMO_USER_ID) {
  const result = await pool.query<DiaryRow>(
    `
      UPDATE diaries
      SET is_deleted = TRUE,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND user_id = $2 AND is_deleted = FALSE
      RETURNING id, start_time AS time, title, source_type, summary, content, tags
    `,
    [id, userId],
  );

  return result.rows[0] ? mapDiaryRow(result.rows[0]) : null;
}

export async function restorePostgresDiary(id: number, userId = DEMO_USER_ID) {
  const result = await pool.query<DiaryRow>(
    `
      UPDATE diaries
      SET is_deleted = FALSE,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND user_id = $2 AND is_deleted = TRUE
      RETURNING id, start_time AS time, title, source_type, summary, content, tags
    `,
    [id, userId],
  );

  return result.rows[0] ? mapDiaryRow(result.rows[0]) : null;
}

export async function permanentlyDeletePostgresDiary(id: number, userId = DEMO_USER_ID) {
  const result = await pool.query(
    `
      DELETE FROM diaries
      WHERE id = $1 AND user_id = $2 AND is_deleted = TRUE
    `,
    [id, userId],
  );

  return (result.rowCount ?? 0) > 0;
}

export async function createPostgresTodo(
  payload: Omit<TodoItem, "id">,
  userId = DEMO_USER_ID,
): Promise<TodoItem> {
  const missionId = await resolvePostgresMissionId(userId, payload.missionId, payload.missionTitle);
  const result = await pool.query<TodoRow>(
    `
      INSERT INTO todos (user_id, content, status, related_mission_id)
      VALUES ($1, $2, $3, $4)
      RETURNING
        id,
        content,
        status,
        related_mission_id,
        (SELECT title FROM mission_timelines WHERE id = related_mission_id) AS mission_title
    `,
    [userId, payload.text, payload.done ? "已完成" : "待办", missionId],
  );

  return mapTodoRow(result.rows[0]);
}

export async function restorePostgresBackupSkipExisting(
  backup: RestoreBackupInput,
  strategy: RestoreStrategy = "skip_existing",
  userId = DEMO_USER_ID,
): Promise<RestoreApplySummary> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. 获取数据库中 diaries 和 todos 的现有所有者 Map，以实现跨用户的 ID 冲突安全检测
    const incomingDiaries = backup.snapshot?.diaries ?? [];
    const diaryIdsFromBackup = incomingDiaries.map(d => d.id).filter((id): id is number => typeof id === "number");
    
    const existingDiaryOwnerMap = new Map<number, number>();
    if (diaryIdsFromBackup.length > 0) {
      const result = await client.query<{ id: number; user_id: number }>(
        `SELECT id, user_id FROM diaries WHERE id = ANY($1)`,
        [diaryIdsFromBackup]
      );
      for (const row of result.rows) {
        existingDiaryOwnerMap.set(row.id, row.user_id);
      }
    }

    const incomingTodos = backup.snapshot?.todos ?? [];
    const todoIdsFromBackup = incomingTodos.map(t => t.id).filter((id): id is number => typeof id === "number");

    const existingTodoOwnerMap = new Map<number, number>();
    if (todoIdsFromBackup.length > 0) {
      const result = await client.query<{ id: number; user_id: number }>(
        `SELECT id, user_id FROM todos WHERE id = ANY($1)`,
        [todoIdsFromBackup]
      );
      for (const row of result.rows) {
        existingTodoOwnerMap.set(row.id, row.user_id);
      }
    }

    let createdDiaries = 0;
    let updatedDiaries = 0;
    let skippedDiaries = 0;
    let createdTodos = 0;
    let updatedTodos = 0;
    let skippedTodos = 0;
    let createdMissions = 0;
    let createdMissionNodes = 0;
    let missionsReplaced = false;
    let shareCardCreated = false;
    let shareCardSkipped = false;

    // 用来映射备份中日记 ID 到了数据库中实际生成的 ID
    const oldToNewDiaryIds = new Map<number, number>();

    // 2. 恢复日记
    for (const entry of incomingDiaries) {
      if (!entry.title || !entry.summary || !entry.time || !entry.source) {
        skippedDiaries += 1;
        continue;
      }

      const hasId = typeof entry.id === "number";
      const ownerId = hasId ? existingDiaryOwnerMap.get(entry.id!) : undefined;

      if (hasId && ownerId !== undefined) {
        // ID 存在于整个数据库中
        if (ownerId === userId) {
          // 属于当前用户：根据策略更新或跳过
          if (strategy === "skip_existing") {
            skippedDiaries += 1;
            oldToNewDiaryIds.set(entry.id!, entry.id!);
            continue;
          }

          await client.query(
            `
              UPDATE diaries
              SET source_type = $3,
                  title = $4,
                  content = $5,
                  summary = $6,
                  start_time = CURRENT_DATE + $7::time,
                  end_time = CURRENT_DATE + $7::time + INTERVAL '30 minutes',
                  tags = $8,
                  is_deleted = FALSE,
                  updated_at = CURRENT_TIMESTAMP
              WHERE id = $1 AND user_id = $2
            `,
            [entry.id, userId, entry.source, entry.title, entry.summary, entry.summary, entry.time, entry.tags ?? []],
          );
          updatedDiaries += 1;
          oldToNewDiaryIds.set(entry.id!, entry.id!);
        } else {
          // 属于其他用户：必须作为新日记插入，由系统自增生成 ID，以防主键冲突并实现行隔离
          const insertResult = await client.query<{ id: number }>(
            `
              INSERT INTO diaries (
                user_id,
                source_type,
                title,
                content,
                summary,
                start_time,
                end_time,
                tags
              )
              VALUES ($1, $2, $3, $4, $5, CURRENT_DATE + $6::time, CURRENT_DATE + $6::time + INTERVAL '30 minutes', $7)
              RETURNING id
            `,
            [userId, entry.source, entry.title, entry.summary, entry.summary, entry.time, entry.tags ?? []],
          );
          const newId = insertResult.rows[0].id;
          oldToNewDiaryIds.set(entry.id!, newId);
          createdDiaries += 1;
        }
      } else {
        // ID 不存在：直接插入
        if (hasId) {
          await client.query(
            `
              INSERT INTO diaries (
                id,
                user_id,
                source_type,
                title,
                content,
                summary,
                start_time,
                end_time,
                tags
              )
              VALUES ($1, $2, $3, $4, $5, $6, CURRENT_DATE + $7::time, CURRENT_DATE + $7::time + INTERVAL '30 minutes', $8)
            `,
            [entry.id, userId, entry.source, entry.title, entry.summary, entry.summary, entry.time, entry.tags ?? []],
          );
          oldToNewDiaryIds.set(entry.id!, entry.id!);
        } else {
          const insertResult = await client.query<{ id: number }>(
            `
              INSERT INTO diaries (
                user_id,
                source_type,
                title,
                content,
                summary,
                start_time,
                end_time,
                tags
              )
              VALUES ($1, $2, $3, $4, $5, CURRENT_DATE + $6::time, CURRENT_DATE + $6::time + INTERVAL '30 minutes', $7)
              RETURNING id
            `,
            [userId, entry.source, entry.title, entry.summary, entry.summary, entry.time, entry.tags ?? []],
          );
          const newId = insertResult.rows[0].id;
          oldToNewDiaryIds.set(entry.id ?? newId, newId);
        }
        createdDiaries += 1;
      }
    }

    // 3. 恢复待办
    for (const todo of incomingTodos) {
      if (!todo.text) {
        skippedTodos += 1;
        continue;
      }

      const hasId = typeof todo.id === "number";
      const ownerId = hasId ? existingTodoOwnerMap.get(todo.id!) : undefined;

      if (hasId && ownerId !== undefined) {
        if (ownerId === userId) {
          if (strategy === "skip_existing") {
            skippedTodos += 1;
            continue;
          }

          await client.query(
            `
              UPDATE todos
              SET content = $3,
                  status = $4,
                  updated_at = CURRENT_TIMESTAMP
              WHERE id = $1 AND user_id = $2
            `,
            [todo.id, userId, todo.text, todo.done ? "已完成" : "待办"],
          );
          updatedTodos += 1;
        } else {
          // 被其他用户占用，分配新 ID 写入以防主键冲突
          await client.query(
            `
              INSERT INTO todos (user_id, content, status)
              VALUES ($1, $2, $3)
            `,
            [userId, todo.text, todo.done ? "已完成" : "待办"],
          );
          createdTodos += 1;
        }
      } else {
        if (hasId) {
          await client.query(
            `
              INSERT INTO todos (id, user_id, content, status)
              VALUES ($1, $2, $3, $4)
            `,
            [todo.id, userId, todo.text, todo.done ? "已完成" : "待办"],
          );
        } else {
          await client.query(
            `
              INSERT INTO todos (user_id, content, status)
              VALUES ($1, $2, $3)
            `,
            [userId, todo.text, todo.done ? "已完成" : "待办"],
          );
        }
        createdTodos += 1;
      }
    }

    let modelUpdated = false;
    if (backup.modelConfig) {
      const modelConfig = normalizeModelConfig({
        llm_configs: [backup.modelConfig],
        embedding_configs: [backup.modelConfig],
      });

      await client.query(
        `
          UPDATE users
          SET llm_configs = $2::jsonb,
              embedding_configs = $3::jsonb,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = $1
        `,
        [
          userId,
          JSON.stringify([
            {
              provider: modelConfig.provider,
              baseUrl: modelConfig.llmBaseUrl ?? modelConfig.baseUrl,
              chatModel: modelConfig.chatModel,
              timeoutSeconds: modelConfig.timeoutSeconds,
              apiKey: modelConfig.llmApiKey ?? modelConfig.apiKey ?? null,
            },
          ]),
          JSON.stringify([
            {
              provider: modelConfig.embeddingProvider ?? modelConfig.provider,
              baseUrl: modelConfig.embeddingBaseUrl ?? modelConfig.baseUrl,
              embeddingModel: modelConfig.embeddingModel,
              timeoutSeconds: modelConfig.timeoutSeconds,
              apiKey: modelConfig.embeddingApiKey ?? null,
            },
          ]),
        ],
      );
      modelUpdated = true;
    }

    // 4. 恢复任务面板与时间线节点
    const incomingMissions = backup.missions?.missions ?? [];
    if (incomingMissions.length > 0) {
      missionsReplaced = true;
      await client.query("DELETE FROM mission_timelines WHERE user_id = $1", [userId]);

      const oldToNewMissionIds = new Map<number, number>();
      const insertedMissionIds: number[] = [];
      for (const mission of incomingMissions) {
        if (!mission.title) continue;

        const result = await client.query<{ id: number }>(
          `
            INSERT INTO mission_timelines (
              user_id,
              title,
              description,
              mission_type,
              status,
              progress,
              tags,
              ai_reason,
              started_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CURRENT_TIMESTAMP)
            RETURNING id
          `,
          [
            userId,
            mission.title,
            mission.summary ?? "",
            mission.tone === "main" ? "main" : "side",
            mapMissionStatusToDb(mission.status ?? "进行中"),
            clampProgress(mission.progress),
            Array.isArray(mission.tags) ? mission.tags : [],
            mission.aiReason ?? null,
          ],
        );
        const newMissionId = result.rows[0].id;
        insertedMissionIds.push(newMissionId);
        if (typeof mission.id === "number") {
          oldToNewMissionIds.set(mission.id, newMissionId);
        }
        createdMissions += 1;
      }

      for (const mission of incomingMissions) {
        if (typeof mission.id !== "number" || typeof mission.parentId !== "number") continue;

        const missionId = oldToNewMissionIds.get(mission.id);
        const parentId = oldToNewMissionIds.get(mission.parentId);
        if (!missionId || !parentId) continue;

        await client.query(
          `
            UPDATE mission_timelines
            SET parent_id = $3,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND user_id = $2
          `,
          [missionId, userId, parentId],
        );
      }

      const fallbackTimelineId = insertedMissionIds[0];
      for (const node of backup.missions?.nodes ?? []) {
        const timelineId =
          typeof node.timelineId === "number" ? oldToNewMissionIds.get(node.timelineId) ?? fallbackTimelineId : fallbackTimelineId;
        if (!timelineId || !node.title || !node.time) continue;

        // 对 related_diary_ids 执行 ID 映射转换，保证在 ID 重写后节点与日记的关系不丢失、不错乱
        const rawDiaryIds = Array.isArray((node as any).relatedDiaryIds)
          ? (node as any).relatedDiaryIds
          : Array.isArray((node as any).related_diary_ids)
          ? (node as any).related_diary_ids
          : [];
        const mappedDiaryIds = rawDiaryIds.map((id: number) => oldToNewDiaryIds.get(id) ?? id);

        await client.query(
          `
            INSERT INTO timeline_nodes (
              timeline_id,
              user_id,
              title,
              summary,
              status,
              start_time,
              ai_reason,
              related_diary_ids
            )
            VALUES ($1, $2, $3, $4, $5, CURRENT_DATE + $6::time, $7, $8)
          `,
          [
            timelineId,
            userId,
            node.title,
            node.summary ?? null,
            mapMissionStatusToDb(node.status ?? "进行中"),
            node.time,
            node.source ?? null,
            mappedDiaryIds,
          ],
        );
        createdMissionNodes += 1;
      }
    }

    if (backup.latestShareCard) {
      if (!backup.latestShareCard.title || !backup.latestShareCard.publicToken) {
        shareCardSkipped = true;
      } else {
        const tokenResult = await client.query<{ id: number }>(
          `
            SELECT id
            FROM share_cards
            WHERE public_token = $1
            LIMIT 1
          `,
          [backup.latestShareCard.publicToken],
        );
        const publicToken =
          tokenResult.rows.length === 0
            ? backup.latestShareCard.publicToken
            : `${backup.latestShareCard.publicToken}-${crypto.randomUUID().slice(0, 6)}`;

        await client.query(
          `
            INSERT INTO share_cards (
              user_id,
              share_type,
              source_id,
              title,
              content_snapshot,
              public_token,
              visibility,
              expires_at
            )
            VALUES ($1, 'summary', $1, $2, $3::jsonb, $4, $5, $6)
          `,
          [
            userId,
            backup.latestShareCard.title,
            JSON.stringify(backup.latestShareCard.snapshot ?? {}),
            publicToken,
            mapShareVisibilityToDb(backup.latestShareCard.visibility ?? "link"),
            backup.latestShareCard.expiresAt ?? null,
          ],
        );
        await client.query(
          `
            UPDATE app_settings
            SET share_settings = jsonb_set(
                  COALESCE(share_settings, '{}'::jsonb),
                  '{generated}',
                  'true'::jsonb,
                  true
                ),
                updated_at = CURRENT_TIMESTAMP
            WHERE user_id = $1
          `,
          [userId],
        );
        shareCardCreated = true;
      }
    }

    await client.query("SELECT setval(pg_get_serial_sequence('diaries', 'id'), COALESCE((SELECT MAX(id) FROM diaries), 1))");
    await client.query("SELECT setval(pg_get_serial_sequence('todos', 'id'), COALESCE((SELECT MAX(id) FROM todos), 1))");

    await client.query("COMMIT");

    return {
      diaries: { created: createdDiaries, updated: updatedDiaries, skipped: skippedDiaries },
      todos: { created: createdTodos, updated: updatedTodos, skipped: skippedTodos },
      modelConfig: { updated: modelUpdated },
      missions: {
        replaced: missionsReplaced,
        created: createdMissions,
        nodesCreated: createdMissionNodes,
        skipped: Math.max(0, incomingMissions.length - createdMissions),
      },
      shareCard: { created: shareCardCreated, skipped: shareCardSkipped },
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function clampProgress(progress: unknown) {
  if (typeof progress !== "number" || Number.isNaN(progress)) return 0;
  return Math.max(0, Math.min(100, Math.round(progress)));
}

export async function updatePostgresTodo(
  id: number,
  patch: Partial<TodoItem>,
  userId = DEMO_USER_ID,
  reason = "用户在前端更新待办状态",
): Promise<TodoItem | null> {
  const existing = await pool.query<TodoRow>(
    `
      SELECT
        todos.id,
        todos.content,
        todos.status,
        todos.related_mission_id,
        mission_timelines.title AS mission_title
      FROM todos
      LEFT JOIN mission_timelines ON mission_timelines.id = todos.related_mission_id
      WHERE todos.id = $1 AND todos.user_id = $2
    `,
    [id, userId],
  );

  if (!existing.rows[0]) return null;

  const nextText = patch.text ?? existing.rows[0].content;
  const nextStatus =
    typeof patch.done === "boolean" ? (patch.done ? "已完成" : "待办") : existing.rows[0].status;
  const nextMissionId =
    patch.missionId !== undefined || patch.missionTitle !== undefined
      ? await resolvePostgresMissionId(userId, patch.missionId, patch.missionTitle)
      : existing.rows[0].related_mission_id;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const result = await client.query<TodoRow>(
      `
        UPDATE todos
        SET content = $3,
            status = $4,
            related_mission_id = $5,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND user_id = $2
        RETURNING
          id,
          content,
          status,
          related_mission_id,
          (SELECT title FROM mission_timelines WHERE id = related_mission_id) AS mission_title
      `,
      [id, userId, nextText, nextStatus, nextMissionId],
    );

    if (existing.rows[0].status !== nextStatus) {
      await client.query(
        `
          INSERT INTO todo_status_history (todo_id, old_status, new_status, reason)
          VALUES ($1, $2, $3, $4)
        `,
        [id, existing.rows[0].status, nextStatus, reason],
      );
    }

    await client.query("COMMIT");
    return mapTodoRow(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deletePostgresTodo(id: number, userId = DEMO_USER_ID): Promise<TodoItem | null> {
  const result = await pool.query<TodoRow>(
    `
      DELETE FROM todos
      WHERE id = $1 AND user_id = $2
      RETURNING
        id,
        content,
        status,
        related_mission_id,
        (SELECT title FROM mission_timelines WHERE id = related_mission_id) AS mission_title
    `,
    [id, userId],
  );

  if (!result.rows[0]) return null;
  return mapTodoRow(result.rows[0]);
}

export async function listPostgresTodoHistory(
  userId = DEMO_USER_ID,
): Promise<TodoStatusHistoryItem[]> {
  const result = await pool.query<TodoStatusHistoryItem>(
    `
      SELECT
        todo_status_history.id,
        todo_status_history.todo_id,
        todo_status_history.old_status,
        todo_status_history.new_status,
        todo_status_history.reason,
        todo_status_history.created_at::text
      FROM todo_status_history
      INNER JOIN todos ON todos.id = todo_status_history.todo_id
      WHERE todos.user_id = $1
      ORDER BY todo_status_history.created_at DESC, todo_status_history.id DESC
      LIMIT 50
    `,
    [userId],
  );

  return result.rows;
}

export async function updatePostgresTheme(theme: ThemeName, userId = DEMO_USER_ID) {
  await pool.query(
    `
      INSERT INTO app_settings (user_id, theme)
      VALUES ($1, $2)
      ON CONFLICT (user_id)
      DO UPDATE SET theme = EXCLUDED.theme,
                    updated_at = CURRENT_TIMESTAMP
    `,
    [userId, theme],
  );
}

export async function updatePostgresShareSettings(
  share: WorkDiarySnapshot["share"],
  userId = DEMO_USER_ID,
) {
  await pool.query(
    `
      INSERT INTO app_settings (user_id, share_settings)
      VALUES ($1, $2::jsonb)
      ON CONFLICT (user_id)
      DO UPDATE SET share_settings = EXCLUDED.share_settings,
                    updated_at = CURRENT_TIMESTAMP
    `,
    [userId, JSON.stringify(share)],
  );
}

export async function getPostgresModelConfig(userId = DEMO_USER_ID): Promise<ModelServiceConfig> {
  const result = await pool.query<ModelConfigRow>(
    `
      SELECT llm_configs, embedding_configs
      FROM users
      WHERE id = $1
    `,
    [userId],
  );

  return normalizeModelConfig(result.rows[0]);
}

export async function updatePostgresModelConfig(
  config: ModelServiceConfig,
  userId = DEMO_USER_ID,
): Promise<ModelServiceConfig> {
  const normalized: ModelServiceConfig = {
    provider: config.llmProvider?.trim() || config.provider?.trim() || "OpenAI Compatible",
    baseUrl: config.llmBaseUrl?.trim() || config.baseUrl?.trim() || "http://localhost:11434/v1",
    llmProvider: config.llmProvider?.trim() || config.provider?.trim() || "OpenAI Compatible",
    llmBaseUrl: config.llmBaseUrl?.trim() || config.baseUrl?.trim() || "http://localhost:11434/v1",
    chatModel: config.chatModel?.trim() || "llama3.1",
    llmApiKey: config.llmApiKey?.trim() || config.apiKey?.trim() || undefined,
    embeddingProvider: config.embeddingProvider?.trim() || "OpenAI Compatible",
    embeddingBaseUrl: config.embeddingBaseUrl?.trim() || "http://localhost:11434/v1",
    embeddingModel: config.embeddingModel?.trim() || "text-embedding-3-small",
    embeddingApiKey: config.embeddingApiKey?.trim() || undefined,
    timeoutSeconds: Number(config.timeoutSeconds ?? 60),
    apiKey: config.llmApiKey?.trim() || config.apiKey?.trim() || undefined,
  };

  await pool.query(
    `
      UPDATE users
      SET llm_configs = $2::jsonb,
          embedding_configs = $3::jsonb,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `,
    [
      userId,
      JSON.stringify([
        {
          provider: normalized.llmProvider ?? normalized.provider,
          baseUrl: normalized.llmBaseUrl ?? normalized.baseUrl,
          chatModel: normalized.chatModel,
          timeoutSeconds: normalized.timeoutSeconds,
          apiKey: normalized.llmApiKey ?? normalized.apiKey ?? null,
        },
      ]),
      JSON.stringify([
        {
          provider: normalized.embeddingProvider ?? normalized.provider,
          baseUrl: normalized.embeddingBaseUrl ?? normalized.baseUrl,
          embeddingModel: normalized.embeddingModel,
          timeoutSeconds: normalized.timeoutSeconds,
          apiKey: normalized.embeddingApiKey ?? null,
        },
      ]),
    ],
  );

  return normalized;
}

export async function createPostgresShareCard(
  payload: {
    title: string;
    token: string;
    visibility: ShareVisibility;
    accessCode?: string;
    expiresAt?: Date | null;
    snapshot: NonNullable<ShareCardRow["content_snapshot"]>;
  },
  userId = DEMO_USER_ID,
) {
  const passwordHash = payload.visibility === "private" && payload.accessCode ? hashShareAccessCode(payload.accessCode) : null;
  const result = await pool.query<ShareCardRow>(
    `
      INSERT INTO share_cards (
        user_id,
        share_type,
        source_id,
        title,
        content_snapshot,
        public_token,
        visibility,
        password_hash,
        expires_at
      )
      VALUES ($1, 'summary', $1, $2, $3::jsonb, $4, $5, $6, $7)
      RETURNING id, title, public_token, visibility, password_hash, expires_at::text, content_snapshot, created_at::text
    `,
    [
      userId,
      payload.title,
      JSON.stringify(payload.snapshot),
      payload.token,
      mapShareVisibilityToDb(payload.visibility),
      passwordHash,
      payload.expiresAt ?? null,
    ],
  );

  await updatePostgresShareSettings(
    {
      generated: true,
      visibility: payload.visibility,
    },
    userId,
  );

  return mapShareCardRow(result.rows[0]);
}

export async function getLatestPostgresShareCard(userId = DEMO_USER_ID) {
  const result = await pool.query<ShareCardRow>(
    `
      SELECT id, title, public_token, visibility, password_hash, expires_at::text, content_snapshot, created_at::text
      FROM share_cards
      WHERE user_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
    [userId],
  );

  return result.rows[0] ? mapShareCardRow(result.rows[0]) : null;
}

export async function getPublicPostgresShareCard(token: string, accessCode?: string) {
  const result = await pool.query<ShareCardRow>(
    `
      SELECT id, title, public_token, visibility, password_hash, expires_at::text, content_snapshot, created_at::text
      FROM share_cards
      WHERE public_token = $1
        AND visibility IN ('public', 'link', 'password')
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
      LIMIT 1
    `,
    [token],
  );

  const row = result.rows[0];
  if (!row) return null;
  if (row.visibility === "password" && row.password_hash !== hashShareAccessCode(accessCode ?? "")) {
    return { requiresPassword: true };
  }

  return { card: mapShareCardRow(row) };
}

function mapDiaryRow(row: DiaryRow): DiaryEntry {
  return {
    id: row.id,
    time: formatTime(row.time),
    title: row.title ?? "未命名日记",
    source: row.source_type === "agent" ? "agent" : "human",
    summary: row.summary ?? row.content,
    tags: row.tags ?? [],
  };
}

function normalizeModelConfig(row?: ModelConfigRow | null): ModelServiceConfig {
  const llmConfig = row?.llm_configs?.[0] ?? {};
  const embeddingConfig = row?.embedding_configs?.[0] ?? {};
  const llmProvider = String(llmConfig.llmProvider ?? llmConfig.provider ?? "OpenAI Compatible");
  const llmBaseUrl = String(llmConfig.llmBaseUrl ?? llmConfig.baseUrl ?? "http://localhost:11434/v1");
  const llmApiKey = llmConfig.llmApiKey ?? llmConfig.apiKey;
  const embeddingProvider = String(
    embeddingConfig.embeddingProvider ??
      embeddingConfig.provider ??
      llmConfig.embeddingProvider ??
      llmConfig.provider ??
      "OpenAI Compatible",
  );
  const embeddingBaseUrl = String(
    embeddingConfig.embeddingBaseUrl ??
      embeddingConfig.baseUrl ??
      llmConfig.embeddingBaseUrl ??
      llmConfig.baseUrl ??
      "http://localhost:11434/v1",
  );
  const embeddingApiKey = embeddingConfig.embeddingApiKey ?? embeddingConfig.apiKey ?? llmConfig.embeddingApiKey;

  return {
    provider: llmProvider,
    baseUrl: llmBaseUrl,
    llmProvider,
    llmBaseUrl,
    chatModel: String(llmConfig.chatModel ?? "llama3.1"),
    llmApiKey: llmApiKey ? String(llmApiKey) : undefined,
    embeddingProvider,
    embeddingBaseUrl,
    embeddingModel: String(embeddingConfig.embeddingModel ?? llmConfig.embeddingModel ?? "text-embedding-3-small"),
    timeoutSeconds: Number(llmConfig.timeoutSeconds ?? embeddingConfig.timeoutSeconds ?? 60),
    embeddingApiKey: embeddingApiKey ? String(embeddingApiKey) : undefined,
    apiKey: llmApiKey ? String(llmApiKey) : undefined,
  };
}

async function resolvePostgresMissionId(
  userId: number,
  missionId?: number | null,
  missionTitle?: string | null,
) {
  if (missionId === null || missionTitle === null) return null;

  if (typeof missionId === "number" && Number.isInteger(missionId) && missionId > 0) {
    const result = await pool.query<{ id: number }>(
      `
        SELECT id
        FROM mission_timelines
        WHERE id = $1
          AND user_id = $2
          AND status <> 'archived'
      `,
      [missionId, userId],
    );
    return result.rows[0]?.id ?? null;
  }

  const title = missionTitle?.trim();
  if (!title) return null;

  const result = await pool.query<{ id: number }>(
    `
      SELECT id
      FROM mission_timelines
      WHERE user_id = $1
        AND status <> 'archived'
        AND (title = $2 OR title ILIKE $3)
      ORDER BY
        CASE WHEN title = $2 THEN 0 ELSE 1 END,
        mission_type ASC,
        updated_at DESC,
        id DESC
      LIMIT 1
    `,
    [userId, title, `%${title}%`],
  );

  return result.rows[0]?.id ?? null;
}

function mapTodoRow(row: TodoRow): TodoItem {
  return {
    id: row.id,
    text: row.content,
    done: row.status === "已完成",
    missionId: row.related_mission_id,
    missionTitle: row.mission_title,
  };
}

function mapMissionRow(row: MissionRow): Mission {
  return {
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    progress: row.progress,
    tone: row.mission_type === "main" ? "main" : "side",
    status: mapMissionStatusFromDb(row.status),
    summary: row.description ?? "",
    tags: row.tags ?? [],
    aiReason: row.ai_reason ?? undefined,
  };
}

function mapTimelineNodeRow(row: TimelineNodeRow): MissionNode {
  return {
    id: row.id,
    timelineId: row.timeline_id,
    time: row.time ? formatTime(row.time) : "--:--",
    title: row.title,
    status: mapMissionStatusFromDb(row.status),
    source: row.ai_reason ?? "任务线节点",
    summary: row.summary ?? undefined,
  };
}

function mapShareCardRow(row: ShareCardRow) {
  return {
    id: row.id,
    title: row.title,
    publicToken: row.public_token,
    visibility: mapShareVisibilityFromDb(row.visibility),
    requiresPassword: row.visibility === "password",
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    snapshot: row.content_snapshot ?? {},
  };
}

function hashShareAccessCode(accessCode: string) {
  return crypto.createHash("sha256").update(`zuoyeben-share:${accessCode}`).digest("hex");
}

function mapShareVisibilityToDb(visibility: ShareVisibility) {
  if (visibility === "private") return "password";
  return visibility;
}

function mapShareVisibilityFromDb(visibility: ShareCardRow["visibility"]): ShareVisibility {
  if (visibility === "password") return "private";
  return visibility;
}

function mapMissionStatusToDb(status: string) {
  const statusMap: Record<string, string> = {
    规划中: "planned",
    待推进: "planned",
    进行中: "in_progress",
    推进中: "in_progress",
    已记录: "in_progress",
    已整理: "in_progress",
    卡住: "blocked",
    已完成: "completed",
    可复盘: "completed",
  };

  return statusMap[status] ?? "in_progress";
}

function mapMissionStatusFromDb(status: string) {
  const statusMap: Record<string, string> = {
    planned: "规划中",
    in_progress: "进行中",
    blocked: "卡住",
    completed: "已完成",
    archived: "已归档",
  };

  return statusMap[status] ?? status;
}

function formatTime(value: Date) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(value);
}

export type DbUser = {
  id: number;
  username: string;
  password_hash: string;
  role: "user" | "admin";
  status: "active" | "disabled";
  nickname: string | null;
  bio: string | null;
  avatar: string | null;
  work_profile: Record<string, any> | null;
  llm_configs: any[] | null;
  embedding_configs: any[] | null;
  last_login_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export async function createUser(
  username: string,
  passwordHash: string,
  nickname?: string,
): Promise<DbUser> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const countResult = await client.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM users");
    const role = Number(countResult.rows[0]?.count ?? 0) === 0 ? "admin" : "user";
    
    const userResult = await client.query<DbUser>(
      `
        INSERT INTO users (username, password_hash, nickname, role)
        VALUES ($1, $2, $3, $4)
        RETURNING id, username, password_hash, role, status, nickname, bio, avatar, work_profile, llm_configs, embedding_configs, last_login_at, created_at, updated_at
      `,
      [username, passwordHash, nickname ?? username, role],
    );
    
    const user = userResult.rows[0];
    
    // 初始化应用设置
    await client.query(
      `
        INSERT INTO app_settings (user_id, theme, share_settings)
        VALUES ($1, '草莓薄荷', '{"generated": false, "visibility": "link"}'::jsonb)
      `,
      [user.id],
    );
    
    await client.query("COMMIT");
    return user;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function findUserByUsername(username: string): Promise<DbUser | null> {
  const result = await pool.query<DbUser>(
    `
      SELECT id, username, password_hash, role, status, nickname, bio, avatar, work_profile, llm_configs, embedding_configs, last_login_at, created_at, updated_at
      FROM users
      WHERE username = $1
    `,
    [username],
  );
  return result.rows[0] ?? null;
}

export async function findUserById(id: number): Promise<DbUser | null> {
  const result = await pool.query<DbUser>(
    `
      SELECT id, username, password_hash, role, status, nickname, bio, avatar, work_profile, llm_configs, embedding_configs, last_login_at, created_at, updated_at
      FROM users
      WHERE id = $1
    `,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function updatePostgresUserProfile(
  userId: number,
  payload: {
    nickname?: string;
    bio?: string;
    avatar?: string;
    workProfile?: Record<string, any>;
  }
): Promise<DbUser | null> {
  const fields: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (payload.nickname !== undefined) {
    fields.push(`nickname = $${paramIndex++}`);
    values.push(payload.nickname);
  }
  if (payload.bio !== undefined) {
    fields.push(`bio = $${paramIndex++}`);
    values.push(payload.bio);
  }
  if (payload.avatar !== undefined) {
    fields.push(`avatar = $${paramIndex++}`);
    values.push(payload.avatar);
  }
  if (payload.workProfile !== undefined) {
    fields.push(`work_profile = $${paramIndex++}::jsonb`);
    values.push(JSON.stringify(payload.workProfile));
  }

  if (fields.length === 0) {
    return findUserById(userId);
  }

  values.push(userId); // 用于 WHERE id = $X 的参数

  const query = `
    UPDATE users
    SET ${fields.join(", ")}, updated_at = CURRENT_TIMESTAMP
    WHERE id = $${paramIndex}
    RETURNING id, username, password_hash, role, status, nickname, bio, avatar, work_profile, llm_configs, embedding_configs, last_login_at, created_at, updated_at
  `;

  const result = await pool.query<DbUser>(query, values);
  return result.rows[0] ?? null;
}

export async function touchPostgresUserLogin(userId: number) {
  await pool.query(
    `
      UPDATE users
      SET last_login_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `,
    [userId],
  );
  await recordPostgresUserActivity(userId, "auth.login", "user", userId);
}

export async function recordPostgresUserActivity(
  userId: number | null,
  eventType: string,
  targetType?: string,
  targetId?: number | null,
  meta: Record<string, any> = {},
) {
  await pool.query(
    `
      INSERT INTO user_activity_events (user_id, event_type, target_type, target_id, meta)
      VALUES ($1, $2, $3, $4, $5::jsonb)
    `,
    [userId, eventType, targetType ?? null, targetId ?? null, JSON.stringify(meta)],
  );
}

export type FeedbackStatus = "open" | "processing" | "resolved" | "closed";
export type FeedbackType = "bug" | "suggestion" | "usage" | "model" | "other";

export type FeedbackRow = {
  id: number;
  user_id: number | null;
  username: string | null;
  type: FeedbackType;
  status: FeedbackStatus;
  title: string;
  content: string;
  contact: string | null;
  admin_note: string | null;
  admin_response: string | null;
  responded_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function createPostgresFeedback(
  userId: number | null,
  payload: { type: FeedbackType; title: string; content: string; contact?: string },
): Promise<FeedbackRow> {
  const result = await pool.query<FeedbackRow>(
    `
      INSERT INTO feedbacks (user_id, type, title, content, contact)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, user_id, NULL::text AS username, type, status, title, content, contact, admin_note, admin_response, responded_at::text, created_at::text, updated_at::text
    `,
    [userId, payload.type, payload.title, payload.content, payload.contact ?? null],
  );
  await recordPostgresUserActivity(userId, "feedback.create", "feedback", result.rows[0].id, { type: payload.type });
  return result.rows[0];
}

export async function listPostgresFeedbacks(status?: FeedbackStatus, limit = 100): Promise<FeedbackRow[]> {
  const values: any[] = [];
  const where = status ? "WHERE feedbacks.status = $1" : "";
  if (status) values.push(status);
  values.push(limit);
  const result = await pool.query<FeedbackRow>(
    `
      SELECT
        feedbacks.id,
        feedbacks.user_id,
        users.username,
        feedbacks.type,
        feedbacks.status,
        feedbacks.title,
        feedbacks.content,
        feedbacks.contact,
        feedbacks.admin_note,
        feedbacks.admin_response,
        feedbacks.responded_at::text,
        feedbacks.created_at::text,
        feedbacks.updated_at::text
      FROM feedbacks
      LEFT JOIN users ON users.id = feedbacks.user_id
      ${where}
      ORDER BY feedbacks.created_at DESC, feedbacks.id DESC
      LIMIT $${values.length}
    `,
    values,
  );
  return result.rows;
}

export async function updatePostgresFeedback(
  id: number,
  patch: { status?: FeedbackStatus; adminNote?: string; adminResponse?: string },
): Promise<FeedbackRow | null> {
  const result = await pool.query<FeedbackRow>(
    `
      UPDATE feedbacks
      SET status = COALESCE($2, status),
          admin_note = COALESCE($3, admin_note),
          admin_response = COALESCE($4, admin_response),
          responded_at = CASE WHEN $4 IS NULL THEN responded_at ELSE CURRENT_TIMESTAMP END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, user_id, NULL::text AS username, type, status, title, content, contact, admin_note, admin_response, responded_at::text, created_at::text, updated_at::text
    `,
    [id, patch.status ?? null, patch.adminNote ?? null, patch.adminResponse ?? null],
  );
  return result.rows[0] ?? null;
}

export async function listPostgresUserFeedbacks(userId: number): Promise<FeedbackRow[]> {
  const result = await pool.query<FeedbackRow>(
    `
      SELECT
        feedbacks.id,
        feedbacks.user_id,
        users.username,
        feedbacks.type,
        feedbacks.status,
        feedbacks.title,
        feedbacks.content,
        feedbacks.contact,
        feedbacks.admin_note,
        feedbacks.admin_response,
        feedbacks.responded_at::text,
        feedbacks.created_at::text,
        feedbacks.updated_at::text
      FROM feedbacks
      LEFT JOIN users ON users.id = feedbacks.user_id
      WHERE feedbacks.user_id = $1
      ORDER BY feedbacks.updated_at DESC, feedbacks.id DESC
      LIMIT 50
    `,
    [userId],
  );
  return result.rows;
}

export type SystemAnnouncementStatus = "active" | "paused";

export type SystemAnnouncementRow = {
  id: number;
  title: string;
  content: string;
  status: SystemAnnouncementStatus;
  starts_at: string | null;
  ends_at: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
};

export async function getActivePostgresAnnouncement(): Promise<SystemAnnouncementRow | null> {
  const result = await pool.query<SystemAnnouncementRow>(
    `
      SELECT id, title, content, status, starts_at::text, ends_at::text, created_by, created_at::text, updated_at::text
      FROM system_announcements
      WHERE status = 'active'
        AND (starts_at IS NULL OR starts_at <= CURRENT_TIMESTAMP)
        AND (ends_at IS NULL OR ends_at >= CURRENT_TIMESTAMP)
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `,
  );
  return result.rows[0] ?? null;
}

export async function listPostgresAnnouncements(limit = 20): Promise<SystemAnnouncementRow[]> {
  const result = await pool.query<SystemAnnouncementRow>(
    `
      SELECT id, title, content, status, starts_at::text, ends_at::text, created_by, created_at::text, updated_at::text
      FROM system_announcements
      ORDER BY created_at DESC, id DESC
      LIMIT $1
    `,
    [limit],
  );
  return result.rows;
}

export async function createPostgresAnnouncement(
  adminUserId: number,
  payload: {
    title: string;
    content: string;
    status?: SystemAnnouncementStatus;
    startsAt?: string | null;
    endsAt?: string | null;
  },
): Promise<SystemAnnouncementRow> {
  const result = await pool.query<SystemAnnouncementRow>(
    `
      INSERT INTO system_announcements (title, content, status, starts_at, ends_at, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, title, content, status, starts_at::text, ends_at::text, created_by, created_at::text, updated_at::text
    `,
    [
      payload.title,
      payload.content,
      payload.status ?? "active",
      payload.startsAt ?? null,
      payload.endsAt ?? null,
      adminUserId,
    ],
  );
  await recordPostgresUserActivity(adminUserId, "admin.announcement.create", "announcement", result.rows[0].id);
  return result.rows[0];
}

export async function updatePostgresAnnouncement(
  id: number,
  adminUserId: number,
  patch: {
    title?: string;
    content?: string;
    status?: SystemAnnouncementStatus;
    startsAt?: string | null;
    endsAt?: string | null;
  },
): Promise<SystemAnnouncementRow | null> {
  const result = await pool.query<SystemAnnouncementRow>(
    `
      UPDATE system_announcements
      SET title = COALESCE($2, title),
          content = COALESCE($3, content),
          status = COALESCE($4, status),
          starts_at = CASE WHEN $5::boolean THEN $6::timestamptz ELSE starts_at END,
          ends_at = CASE WHEN $7::boolean THEN $8::timestamptz ELSE ends_at END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, title, content, status, starts_at::text, ends_at::text, created_by, created_at::text, updated_at::text
    `,
    [
      id,
      patch.title ?? null,
      patch.content ?? null,
      patch.status ?? null,
      Object.prototype.hasOwnProperty.call(patch, "startsAt"),
      patch.startsAt ?? null,
      Object.prototype.hasOwnProperty.call(patch, "endsAt"),
      patch.endsAt ?? null,
    ],
  );
  if (result.rows[0]) {
    await recordPostgresUserActivity(adminUserId, "admin.announcement.update", "announcement", id, { status: patch.status });
  }
  return result.rows[0] ?? null;
}

export type AdminOverview = {
  totals: {
    users: number;
    activeUsersToday: number;
    activeUsers7d: number;
    activeUsers30d: number;
    retention1d: number;
    newUsersToday: number;
    newUsers7d: number;
    newUsers30d: number;
    diaries: number;
    agentDiaries: number;
    todos: number;
    summaries: number;
    shareCards: number;
    openFeedbacks: number;
  };
  daily: Array<{
    date: string;
    newUsers: number;
      activeUsers: number;
    diaries: number;
    agentDiaries: number;
    todos: number;
    summaries: number;
    shareCards: number;
    feedbacks: number;
  }>;
};

export type AdminUserListItem = {
  id: number;
  username: string;
  nickname: string | null;
  role: "user" | "admin";
  status: "active" | "disabled";
  created_at: string;
  last_login_at: string | null;
  diary_count: number;
  agent_diary_count: number;
  todo_count: number;
  api_key_count: number;
  share_card_count: number;
  mission_count: number;
  summary_count: number;
  has_llm_config: boolean;
  has_embedding_config: boolean;
};

export async function getPostgresAdminOverview(): Promise<AdminOverview> {
  const [totalsResult, dailyResult] = await Promise.all([
    pool.query<{
      users: string;
      active_users_today: string;
      active_users_7d: string;
      active_users_30d: string;
      retention_1d: string;
      new_users_today: string;
      new_users_7d: string;
      new_users_30d: string;
      diaries: string;
      agent_diaries: string;
      todos: string;
      summaries: string;
      share_cards: string;
      open_feedbacks: string;
    }>(
      `
        SELECT
          (SELECT COUNT(*) FROM users)::text AS users,
          (
            SELECT COUNT(DISTINCT user_id)
            FROM user_activity_events
            WHERE created_at >= CURRENT_DATE
              AND user_id IS NOT NULL
          )::text AS active_users_today,
          (
            SELECT COUNT(DISTINCT user_id)
            FROM user_activity_events
            WHERE created_at >= CURRENT_DATE - INTERVAL '6 days'
              AND user_id IS NOT NULL
          )::text AS active_users_7d,
          (
            SELECT COUNT(DISTINCT user_id)
            FROM user_activity_events
            WHERE created_at >= CURRENT_DATE - INTERVAL '29 days'
              AND user_id IS NOT NULL
          )::text AS active_users_30d,
          (
            WITH cohort AS (
              SELECT id FROM users WHERE created_at::date = CURRENT_DATE - INTERVAL '1 day'
            ),
            retained AS (
              SELECT COUNT(DISTINCT user_activity_events.user_id)::numeric AS count
              FROM user_activity_events
              INNER JOIN cohort ON cohort.id = user_activity_events.user_id
              WHERE user_activity_events.created_at >= CURRENT_DATE
            )
            SELECT CASE
              WHEN (SELECT COUNT(*) FROM cohort) = 0 THEN 0
              ELSE ROUND(((SELECT count FROM retained) / (SELECT COUNT(*) FROM cohort)) * 100)
            END
          )::text AS retention_1d,
          (SELECT COUNT(*) FROM users WHERE created_at >= CURRENT_DATE)::text AS new_users_today,
          (SELECT COUNT(*) FROM users WHERE created_at >= CURRENT_DATE - INTERVAL '6 days')::text AS new_users_7d,
          (SELECT COUNT(*) FROM users WHERE created_at >= CURRENT_DATE - INTERVAL '29 days')::text AS new_users_30d,
          (SELECT COUNT(*) FROM diaries WHERE is_deleted = FALSE)::text AS diaries,
          (SELECT COUNT(*) FROM diaries WHERE is_deleted = FALSE AND source_type = 'agent')::text AS agent_diaries,
          (SELECT COUNT(*) FROM todos)::text AS todos,
          (SELECT COUNT(*) FROM summaries)::text AS summaries,
          (SELECT COUNT(*) FROM share_cards)::text AS share_cards,
          (SELECT COUNT(*) FROM feedbacks WHERE status IN ('open', 'processing'))::text AS open_feedbacks
      `,
    ),
    pool.query<{
      day: string;
      new_users: string;
      active_users: string;
      diaries: string;
      agent_diaries: string;
      todos: string;
      summaries: string;
      share_cards: string;
      feedbacks: string;
    }>(
      `
        WITH days AS (
          SELECT generate_series(CURRENT_DATE - INTERVAL '13 days', CURRENT_DATE, INTERVAL '1 day')::date AS day
        )
        SELECT
          days.day::text AS day,
          COALESCE(new_users.count, 0)::text AS new_users,
          COALESCE(active_users.count, 0)::text AS active_users,
          COALESCE(diaries.count, 0)::text AS diaries,
          COALESCE(agent_diaries.count, 0)::text AS agent_diaries,
          COALESCE(todos.count, 0)::text AS todos,
          COALESCE(summaries.count, 0)::text AS summaries,
          COALESCE(share_cards.count, 0)::text AS share_cards,
          COALESCE(feedbacks.count, 0)::text AS feedbacks
        FROM days
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS count FROM users WHERE created_at::date = days.day
        ) new_users ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(DISTINCT user_id) AS count
          FROM user_activity_events
          WHERE created_at::date = days.day AND user_id IS NOT NULL
        ) active_users ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS count FROM diaries WHERE created_at::date = days.day AND is_deleted = FALSE
        ) diaries ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS count FROM diaries WHERE created_at::date = days.day AND is_deleted = FALSE AND source_type = 'agent'
        ) agent_diaries ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS count FROM todos WHERE created_at::date = days.day
        ) todos ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS count FROM summaries WHERE created_at::date = days.day
        ) summaries ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS count FROM share_cards WHERE created_at::date = days.day
        ) share_cards ON true
        LEFT JOIN LATERAL (
          SELECT COUNT(*) AS count FROM feedbacks WHERE created_at::date = days.day
        ) feedbacks ON true
        ORDER BY days.day
      `,
    ),
  ]);

  const totals = totalsResult.rows[0];
  const number = (value?: string) => Number(value ?? 0);
  return {
    totals: {
      users: number(totals?.users),
      activeUsersToday: number(totals?.active_users_today),
      activeUsers7d: number(totals?.active_users_7d),
      activeUsers30d: number(totals?.active_users_30d),
      retention1d: number(totals?.retention_1d),
      newUsersToday: number(totals?.new_users_today),
      newUsers7d: number(totals?.new_users_7d),
      newUsers30d: number(totals?.new_users_30d),
      diaries: number(totals?.diaries),
      agentDiaries: number(totals?.agent_diaries),
      todos: number(totals?.todos),
      summaries: number(totals?.summaries),
      shareCards: number(totals?.share_cards),
      openFeedbacks: number(totals?.open_feedbacks),
    },
    daily: dailyResult.rows.map((row) => ({
      date: row.day,
      newUsers: number(row.new_users),
      activeUsers: number(row.active_users),
      diaries: number(row.diaries),
      agentDiaries: number(row.agent_diaries),
      todos: number(row.todos),
      summaries: number(row.summaries),
      shareCards: number(row.share_cards),
      feedbacks: number(row.feedbacks),
    })),
  };
}

export async function listPostgresAdminUsers(search = "", limit = 100): Promise<AdminUserListItem[]> {
  const trimmedSearch = search.trim().toLowerCase();
  const result = await pool.query<any>(
    `
      SELECT
        users.id,
        users.username,
        users.nickname,
        users.role,
        users.status,
        users.created_at::text,
        users.last_login_at::text,
        COUNT(DISTINCT diaries.id)::int AS diary_count,
        COUNT(DISTINCT diaries.id) FILTER (WHERE diaries.source_type = 'agent')::int AS agent_diary_count,
        COUNT(DISTINCT todos.id)::int AS todo_count,
        COUNT(DISTINCT api_keys.id)::int AS api_key_count,
        COUNT(DISTINCT share_cards.id)::int AS share_card_count,
        COUNT(DISTINCT mission_timelines.id)::int AS mission_count,
        COUNT(DISTINCT summaries.id)::int AS summary_count,
        (jsonb_array_length(COALESCE(users.llm_configs, '[]'::jsonb)) > 0) AS has_llm_config,
        (jsonb_array_length(COALESCE(users.embedding_configs, '[]'::jsonb)) > 0) AS has_embedding_config
      FROM users
      LEFT JOIN diaries ON diaries.user_id = users.id AND diaries.is_deleted = FALSE
      LEFT JOIN todos ON todos.user_id = users.id
      LEFT JOIN api_keys ON api_keys.user_id = users.id
      LEFT JOIN share_cards ON share_cards.user_id = users.id
      LEFT JOIN mission_timelines ON mission_timelines.user_id = users.id
      LEFT JOIN summaries ON summaries.user_id = users.id
      WHERE ($1 = '' OR LOWER(users.username) LIKE '%' || $1 || '%' OR LOWER(COALESCE(users.nickname, '')) LIKE '%' || $1 || '%')
      GROUP BY users.id
      ORDER BY users.created_at DESC, users.id DESC
      LIMIT $2
    `,
    [trimmedSearch, limit],
  );
  return result.rows;
}

export async function updatePostgresAdminUser(
  userId: number,
  actorUserId: number,
  patch: { role?: "user" | "admin"; status?: "active" | "disabled" },
): Promise<AdminUserListItem | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<{ id: number; role: "user" | "admin"; status: "active" | "disabled" }>(
      "SELECT id, role, status FROM users WHERE id = $1 FOR UPDATE",
      [userId],
    );
    const current = existing.rows[0];
    if (!current) {
      await client.query("ROLLBACK");
      return null;
    }

    const nextRole = patch.role ?? current.role;
    const nextStatus = patch.status ?? current.status;
    const activeAdminCount = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM users WHERE role = 'admin' AND status = 'active'",
    );

    if (
      current.role === "admin" &&
      current.status === "active" &&
      (nextRole !== "admin" || nextStatus !== "active") &&
      Number(activeAdminCount.rows[0]?.count ?? 0) <= 1
    ) {
      throw new Error("至少需要保留 1 个可用管理员账号");
    }

    const result = await client.query(
      `
        UPDATE users
        SET role = $2,
            status = $3,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `,
      [userId, nextRole, nextStatus],
    );
    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    await client.query(
      `
        INSERT INTO user_activity_events (user_id, event_type, target_type, target_id, meta)
        VALUES ($1, 'admin.user.update', 'user', $2, $3::jsonb)
      `,
      [actorUserId, userId, JSON.stringify({ role: nextRole, status: nextStatus })],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const users = await listPostgresAdminUsers("", 500);
  return users.find((user) => user.id === userId) ?? null;
}

export async function getPostgresAdminUserDetail(userId: number) {
  const [userResult, activityResult, auditResult, diariesResult, todosResult, feedbackResult] = await Promise.all([
    pool.query<any>(
      `
        SELECT *
        FROM (
          SELECT
            users.id,
            users.username,
            users.nickname,
            users.role,
            users.status,
            users.bio,
            users.avatar,
            users.work_profile,
            users.created_at::text,
            users.last_login_at::text,
            jsonb_array_length(COALESCE(users.llm_configs, '[]'::jsonb)) AS llm_config_count,
            jsonb_array_length(COALESCE(users.embedding_configs, '[]'::jsonb)) AS embedding_config_count
          FROM users
          WHERE users.id = $1
        ) user_row
      `,
      [userId],
    ),
    pool.query(
      `
        SELECT id, event_type, target_type, target_id, meta, created_at::text
        FROM user_activity_events
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 50
      `,
      [userId],
    ),
    listPostgresAgentAuditLogs(userId, 50),
    pool.query(
      `
        SELECT id, source_type, title, summary, created_at::text
        FROM diaries
        WHERE user_id = $1 AND is_deleted = FALSE
        ORDER BY created_at DESC, id DESC
        LIMIT 8
      `,
      [userId],
    ),
    pool.query(
      `
        SELECT id, content, status, created_at::text, updated_at::text
        FROM todos
        WHERE user_id = $1
        ORDER BY updated_at DESC, id DESC
        LIMIT 8
      `,
      [userId],
    ),
    listPostgresUserFeedbacks(userId),
  ]);

  if (!userResult.rows[0]) return null;
  return {
    user: userResult.rows[0],
    activities: activityResult.rows,
    auditLogs: auditResult,
    recentDiaries: diariesResult.rows,
    recentTodos: todosResult.rows,
    feedbacks: feedbackResult,
  };
}

export interface AgentAuditLogRow {
  id: number;
  agent_name: string | null;
  key_mask: string | null;
  action: string;
  target_type: string | null;
  target_id: number | null;
  request_meta: Record<string, any>;
  created_at: string;
}

export async function listPostgresAgentAuditLogs(userId?: number, limit = 20): Promise<AgentAuditLogRow[]> {
  const whereClause = userId ? "WHERE agent_audit_logs.user_id = $1" : "";
  const params = userId ? [userId, limit] : [limit];
  const limitPlaceholder = userId ? "$2" : "$1";
  const result = await pool.query<AgentAuditLogRow>(
    `
      SELECT
        agent_audit_logs.id,
        agents.name AS agent_name,
        api_keys.key_mask,
        agent_audit_logs.action,
        agent_audit_logs.target_type,
        agent_audit_logs.target_id,
        agent_audit_logs.request_meta,
        agent_audit_logs.created_at::text
      FROM agent_audit_logs
      LEFT JOIN agents ON agents.id = agent_audit_logs.agent_id
      LEFT JOIN api_keys ON api_keys.id = agent_audit_logs.api_key_id
      ${whereClause}
      ORDER BY agent_audit_logs.created_at DESC, agent_audit_logs.id DESC
      LIMIT ${limitPlaceholder}
    `,
    params,
  );
  return result.rows;
}

// ==========================================
// AI 总结与向量索引数据库接口
// ==========================================

export interface SummaryRow {
  id: number;
  user_id: number;
  type: string;
  summary_date: Date;
  content: string;
  total_work_time: number;
  tag_distribution: Record<string, number>;
  html_file_path: string | null;
  created_at: Date;
}

export interface DiaryEmbeddingMatch {
  diary_id: number;
  chunk_id: string;
  text: string;
  title: string;
  time: string;
  tags: string[];
  distance: number;
}

export async function getPostgresSummary(
  userId: number,
  type: string,
  date: string,
): Promise<SummaryRow | null> {
  const result = await pool.query<SummaryRow>(
    `
      SELECT id, user_id, type, summary_date, content, total_work_time, tag_distribution, html_file_path, created_at
      FROM summaries
      WHERE user_id = $1 AND type = $2 AND summary_date = $3::date
    `,
    [userId, type, date],
  );
  return result.rows[0] ?? null;
}

export async function createPostgresSummary(
  userId: number,
  type: string,
  date: string,
  content: string,
  totalWorkTime: number,
  tagDistribution: Record<string, number>,
  htmlFilePath: string,
): Promise<SummaryRow> {
  const result = await pool.query<SummaryRow>(
    `
      INSERT INTO summaries (
        user_id,
        type,
        summary_date,
        content,
        total_work_time,
        tag_distribution,
        html_file_path
      )
      VALUES ($1, $2, $3::date, $4, $5, $6::jsonb, $7)
      ON CONFLICT (user_id, type, summary_date)
      DO UPDATE SET
        content = EXCLUDED.content,
        total_work_time = EXCLUDED.total_work_time,
        tag_distribution = EXCLUDED.tag_distribution,
        html_file_path = EXCLUDED.html_file_path
      RETURNING id, user_id, type, summary_date, content, total_work_time, tag_distribution, html_file_path, created_at
    `,
    [
      userId,
      type,
      date,
      content,
      totalWorkTime,
      JSON.stringify(tagDistribution),
      htmlFilePath,
    ],
  );
  return result.rows[0];
}

export async function insertPostgresDiaryEmbedding(
  userId: number,
  diaryId: number,
  chunkId: string,
  text: string,
  embedding: number[],
): Promise<void> {
  const embeddingStr = `[${embedding.join(",")}]`;
  await pool.query(
    `
      INSERT INTO diary_embeddings (
        user_id,
        diary_id,
        chunk_id,
        text,
        embedding
      )
      VALUES ($1, $2, $3, $4, $5::vector)
      ON CONFLICT (user_id, diary_id, chunk_id)
      DO UPDATE SET
        text = EXCLUDED.text,
        embedding = EXCLUDED.embedding,
        updated_at = CURRENT_TIMESTAMP
    `,
    [userId, diaryId, chunkId, text, embeddingStr],
  );
}

export async function clearPostgresDiaryEmbeddings(userId: number, diaryId: number): Promise<void> {
  await pool.query(
    `
      DELETE FROM diary_embeddings
      WHERE user_id = $1 AND diary_id = $2
    `,
    [userId, diaryId],
  );
}

export async function searchPostgresDiaryEmbeddings(
  userId: number,
  queryEmbedding: number[],
  limit: number,
  diaryIdsFilter?: number[],
): Promise<DiaryEmbeddingMatch[]> {
  const embeddingStr = `[${queryEmbedding.join(",")}]`;

  if (diaryIdsFilter && diaryIdsFilter.length > 0) {
    const result = await pool.query<{
      diary_id: number;
      chunk_id: string;
      text: string;
      title: string | null;
      time: Date;
      tags: string[] | null;
      distance: number;
    }>(
      `
        SELECT 
          de.diary_id, 
          de.chunk_id, 
          de.text, 
          d.title, 
          d.start_time AS time, 
          d.tags,
          (de.embedding <=> $2::vector) AS distance
        FROM diary_embeddings de
        INNER JOIN diaries d ON d.id = de.diary_id
        WHERE de.user_id = $1 AND d.is_deleted = FALSE AND de.diary_id = ANY($3)
        ORDER BY distance ASC
        LIMIT $4
      `,
      [userId, embeddingStr, diaryIdsFilter, limit],
    );

    return result.rows.map((row) => ({
      diary_id: row.diary_id,
      chunk_id: row.chunk_id,
      text: row.text,
      title: row.title ?? "无标题日记",
      time: row.time.toISOString(),
      tags: row.tags ?? [],
      distance: Number(row.distance),
    }));
  } else {
    const result = await pool.query<{
      diary_id: number;
      chunk_id: string;
      text: string;
      title: string | null;
      time: Date;
      tags: string[] | null;
      distance: number;
    }>(
      `
        SELECT 
          de.diary_id, 
          de.chunk_id, 
          de.text, 
          d.title, 
          d.start_time AS time, 
          d.tags,
          (de.embedding <=> $2::vector) AS distance
        FROM diary_embeddings de
        INNER JOIN diaries d ON d.id = de.diary_id
        WHERE de.user_id = $1 AND d.is_deleted = FALSE
        ORDER BY distance ASC
        LIMIT $3
      `,
      [userId, embeddingStr, limit],
    );

    return result.rows.map((row) => ({
      diary_id: row.diary_id,
      chunk_id: row.chunk_id,
      text: row.text,
      title: row.title ?? "无标题日记",
      time: row.time.toISOString(),
      tags: row.tags ?? [],
      distance: Number(row.distance),
    }));
  }
}
