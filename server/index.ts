import crypto from "crypto";
import cors from "cors";
import express from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import path from "path";
import { fileURLToPath } from "url";
import { checkDatabase } from "./db";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { requireApiKey } from "./middleware/apiKeyAuth";
import { requireAdmin, requireAuth, JWT_SECRET, requireScope } from "./middleware/auth";
import { createMockSnapshot } from "./mockSnapshot";
import {
  completePostgresMission,
  createPostgresDiary,
  createPostgresMissionNode,
  createPostgresShareCard,
  createPostgresTodo,
  deletePostgresTodo,
  getLatestPostgresShareCard,
  getPostgresOnboardingMissionStatus,
  getPostgresModelConfig,
  getPostgresSnapshot,
  getPublicPostgresShareCard,
  listPostgresMissions,
  listPostgresDeletedDiaries,
  listPostgresTodoHistory,
  permanentlyDeletePostgresDiary,
  regeneratePostgresMissions,
  restorePostgresBackupSkipExisting,
  restorePostgresDiary,
  rollupPostgresMainMissionProgress,
  softDeletePostgresDiary,
  updatePostgresDiary,
  updatePostgresModelConfig,
  updatePostgresShareSettings,
  updatePostgresTheme,
  updatePostgresTodo,
  createUser,
  findUserByUsername,
  findUserById,
  getPostgresSummary,
  updatePostgresUserProfile,
  touchPostgresUserLogin,
  recordPostgresUserActivity,
  createPostgresFeedback,
  createPostgresAnnouncement,
  getActivePostgresAnnouncement,
  listPostgresFeedbacks,
  listPostgresAnnouncements,
  listPostgresUserFeedbacks,
  updatePostgresFeedback,
  updatePostgresAnnouncement,
  updatePostgresAdminUser,
  getPostgresAdminOverview,
  listPostgresAdminUsers,
  getPostgresAdminUserDetail,
  listPostgresAgentAuditLogs,
  type RestoreBackupInput,
  type RestoreStrategy,
  type FeedbackStatus,
  type FeedbackType,
  type SystemAnnouncementStatus,
} from "./repositories/postgresRepository";
import {
  createDiary,
  createTodo,
  deleteTodo,
  getModelConfig,
  getSnapshot,
  resetStore,
  updateModelConfig,
  updateShareSettings,
  updateTheme,
  updateTodo,
} from "./store";
import { buildAgentReview } from "./services/agentReview";
import {
  buildMissionPlan,
  buildOnboardingMissionPlan,
  isOnboardingComplete,
  isOnboardingMissionPlan,
} from "./services/missionPlanner";
import {
  createAgentApiKey,
  getAgentProfileByApiKey,
  listAgentApiKeys,
  recordAuditLog,
  revokeAgentApiKey,
  updateAgentProfileByApiKey,
} from "./services/apiKeys";
import {
  callEmbedding,
  callLLMChat,
  generateSummaryAndRegisterTodos,
  reindexUserDiaries,
  ragAskQuestion
} from "./services/aiService";
import type { DiaryEntry, ModelServiceConfig, ThemeName, TodoItem } from "../src/types";

const app = express();
const port = Number(process.env.API_PORT ?? 3000);
const usePostgres = Boolean(process.env.DATABASE_URL);
const allowedAgentKeyScopes = new Set([
  "diary:read",
  "diary:write",
  "todo:read",
  "todo:write",
  "timeline:read",
  "timeline:write",
  "summary:read",
  "share:write",
  "agent:read",
  "agent:write",
  "all",
]);

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use("/reports", express.static(path.join(__dirname, "public/reports")));

app.get("/api/health", async (_request, response) => {
  if (!process.env.DATABASE_URL) {
    response.json({
      ok: true,
      database: "not_configured",
      pgvector: "unknown",
      message: "API is running. Set DATABASE_URL to enable PostgreSQL checks.",
    });
    return;
  }

  try {
    const db = await checkDatabase();
    response.json({
      ok: true,
      database: "connected",
      pgvector: db.has_vector ? "enabled" : "missing",
    });
  } catch (error) {
    response.status(503).json({
      ok: false,
      database: "unavailable",
      message: error instanceof Error ? error.message : "Unknown database error",
    });
  }
});

// --- 用户登录/注册 API ---

app.post("/api/auth/register", async (request, response) => {
  if (!process.env.DATABASE_URL) {
    response.status(503).json({
      message: "DATABASE_URL 未配置，无法注册用户",
    });
    return;
  }

  const { username, password, nickname } = request.body as {
    username?: string;
    password?: string;
    nickname?: string;
  };

  if (!username || !password) {
    response.status(400).json({
      message: "用户名和密码不能为空",
    });
    return;
  }

  const trimmedUsername = username.trim().toLowerCase();
  if (trimmedUsername.length < 3 || trimmedUsername.length > 20) {
    response.status(400).json({
      message: "用户名长度需在 3 到 20 个字符之间",
    });
    return;
  }

  if (password.length < 6) {
    response.status(400).json({
      message: "密码长度不能少于 6 个字符",
    });
    return;
  }

  try {
    const existing = await findUserByUsername(trimmedUsername);
    if (existing) {
      response.status(409).json({
        message: "该用户名已被注册",
      });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await createUser(trimmedUsername, passwordHash, nickname?.trim());

    // 自动登录，生成 token
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: "30d" }
    );
    await recordPostgresUserActivity(user.id, "auth.register", "user", user.id, { role: user.role });
    await touchPostgresUserLogin(user.id);

    response.status(201).json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        status: user.status,
        nickname: user.nickname,
        bio: user.bio,
        avatar: user.avatar,
      },
    });
  } catch (error) {
    response.status(500).json({
      message: "注册失败，请稍后重试",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/api/auth/login", async (request, response) => {
  if (!process.env.DATABASE_URL) {
    // 降级支持 DEMO 登录
    response.json({
      token: "demo-jwt-token-fallback",
      user: {
        id: 1,
        username: "demo",
        nickname: "绵绵 (Demo)",
        bio: "Demo Mode",
        avatar: "",
      },
    });
    return;
  }

  const { username, password } = request.body as {
    username?: string;
    password?: string;
  };

  if (!username || !password) {
    response.status(400).json({
      message: "用户名和密码不能为空",
    });
    return;
  }

  try {
    const trimmedUsername = username.trim().toLowerCase();
    const user = await findUserByUsername(trimmedUsername);
    if (!user) {
      response.status(401).json({
        message: "用户名或密码错误",
      });
      return;
    }
    if (user.status !== "active") {
      response.status(403).json({
        message: "该账号已被禁用",
      });
      return;
    }

    // 支持旧的 DEMO 用户（如果密码匹配 demo-password-hash 并且未哈希过，兼容处理）
    let isMatch = false;
    if (user.password_hash === password) {
      isMatch = true;
    } else {
      isMatch = await bcrypt.compare(password, user.password_hash);
    }

    if (!isMatch) {
      response.status(401).json({
        message: "用户名或密码错误",
      });
      return;
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: "30d" }
    );
    await touchPostgresUserLogin(user.id);

    response.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        status: user.status,
        nickname: user.nickname,
        bio: user.bio,
        avatar: user.avatar,
      },
    });
  } catch (error) {
    response.status(500).json({
      message: "登录失败，请稍后重试",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/api/auth/me", requireAuth, async (request, response) => {
  if (!process.env.DATABASE_URL) {
    response.json({
      id: 1,
      username: "demo",
      role: "admin",
      status: "active",
      nickname: "绵绵",
      bio: "作业本本地演示用户",
      avatar: "",
    });
    return;
  }

  try {
    const user = await findUserById(request.user!.id);
    if (!user) {
      response.status(404).json({
        message: "用户不存在",
      });
      return;
    }

    response.json({
      id: user.id,
      username: user.username,
      role: user.role,
      status: user.status,
      nickname: user.nickname,
      bio: user.bio,
      avatar: user.avatar,
      workProfile: user.work_profile,
    });
  } catch (error) {
    response.status(500).json({
      message: "获取用户信息失败",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/api/announcements/current", requireAuth, async (_request, response) => {
  if (!usePostgres) {
    response.json(null);
    return;
  }

  try {
    response.json(await getActivePostgresAnnouncement());
  } catch (error) {
    response.status(503).json({
      message: "Failed to load announcement",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/api/feedbacks", requireAuth, async (request, response) => {
  const payload = request.body as {
    type?: FeedbackType;
    title?: string;
    content?: string;
    contact?: string;
  };
  const type = isFeedbackType(payload.type) ? payload.type : "other";
  const title = payload.title?.trim();
  const content = payload.content?.trim();

  if (!title || !content) {
    response.status(400).json({ message: "title and content are required" });
    return;
  }

  if (!usePostgres) {
    response.status(503).json({ message: "DATABASE_URL 未配置，无法提交反馈" });
    return;
  }

  try {
    response.status(201).json(await createPostgresFeedback(request.user!.id, {
      type,
      title: title.slice(0, 120),
      content: content.slice(0, 4000),
      contact: payload.contact?.trim().slice(0, 200),
    }));
  } catch (error) {
    response.status(503).json({
      message: "Failed to create feedback",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/api/feedbacks", requireAuth, async (request, response) => {
  if (!usePostgres) {
    response.json([]);
    return;
  }

  try {
    response.json(await listPostgresUserFeedbacks(request.user!.id));
  } catch (error) {
    response.status(503).json({
      message: "Failed to load feedbacks",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/api/admin/overview", requireAuth, requireAdmin, async (_request, response) => {
  try {
    response.json(await getPostgresAdminOverview());
  } catch (error) {
    response.status(503).json({
      message: "Failed to load admin overview",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/api/admin/users", requireAuth, requireAdmin, async (request, response) => {
  try {
    response.json(await listPostgresAdminUsers(String(request.query.search ?? ""), 100));
  } catch (error) {
    response.status(503).json({
      message: "Failed to load admin users",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/api/admin/users/:id", requireAuth, requireAdmin, async (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    response.status(400).json({ message: "Invalid user id" });
    return;
  }

  try {
    const detail = await getPostgresAdminUserDetail(id);
    if (!detail) {
      response.status(404).json({ message: "User not found" });
      return;
    }
    response.json(detail);
  } catch (error) {
    response.status(503).json({
      message: "Failed to load admin user detail",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.patch("/api/admin/users/:id", requireAuth, requireAdmin, async (request, response) => {
  const id = Number(request.params.id);
  const payload = request.body as { role?: "user" | "admin"; status?: "active" | "disabled" };
  if (!Number.isInteger(id) || id <= 0) {
    response.status(400).json({ message: "Invalid user id" });
    return;
  }
  if (payload.role !== undefined && payload.role !== "user" && payload.role !== "admin") {
    response.status(400).json({ message: "Invalid user role" });
    return;
  }
  if (payload.status !== undefined && payload.status !== "active" && payload.status !== "disabled") {
    response.status(400).json({ message: "Invalid user status" });
    return;
  }

  try {
    const user = await updatePostgresAdminUser(id, request.user!.id, {
      role: payload.role,
      status: payload.status,
    });
    if (!user) {
      response.status(404).json({ message: "User not found" });
      return;
    }
    response.json(user);
  } catch (error) {
    response.status(409).json({
      message: error instanceof Error ? error.message : "Failed to update user",
    });
  }
});

app.get("/api/admin/feedbacks", requireAuth, requireAdmin, async (request, response) => {
  const status = isFeedbackStatus(request.query.status) ? request.query.status : undefined;
  try {
    response.json(await listPostgresFeedbacks(status, 100));
  } catch (error) {
    response.status(503).json({
      message: "Failed to load feedbacks",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.patch("/api/admin/feedbacks/:id", requireAuth, requireAdmin, async (request, response) => {
  const id = Number(request.params.id);
  const payload = request.body as { status?: FeedbackStatus; adminNote?: string; adminResponse?: string };
  if (!Number.isInteger(id) || id <= 0) {
    response.status(400).json({ message: "Invalid feedback id" });
    return;
  }
  if (payload.status !== undefined && !isFeedbackStatus(payload.status)) {
    response.status(400).json({ message: "Invalid feedback status" });
    return;
  }

  try {
    const feedback = await updatePostgresFeedback(id, {
      status: payload.status,
      adminNote: payload.adminNote?.trim().slice(0, 2000),
      adminResponse: payload.adminResponse?.trim().slice(0, 4000),
    });
    if (!feedback) {
      response.status(404).json({ message: "Feedback not found" });
      return;
    }
    response.json(feedback);
  } catch (error) {
    response.status(503).json({
      message: "Failed to update feedback",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/api/admin/announcements", requireAuth, requireAdmin, async (_request, response) => {
  try {
    response.json(await listPostgresAnnouncements(50));
  } catch (error) {
    response.status(503).json({
      message: "Failed to load announcements",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/api/admin/announcements", requireAuth, requireAdmin, async (request, response) => {
  const payload = request.body as {
    title?: string;
    content?: string;
    status?: SystemAnnouncementStatus;
    startsAt?: string | null;
    endsAt?: string | null;
  };
  const title = payload.title?.trim();
  const content = payload.content?.trim();
  if (!title || !content) {
    response.status(400).json({ message: "title and content are required" });
    return;
  }
  if (payload.status !== undefined && !isAnnouncementStatus(payload.status)) {
    response.status(400).json({ message: "Invalid announcement status" });
    return;
  }

  try {
    response.status(201).json(await createPostgresAnnouncement(request.user!.id, {
      title: title.slice(0, 120),
      content: content.slice(0, 2000),
      status: payload.status,
      startsAt: payload.startsAt ?? null,
      endsAt: payload.endsAt ?? null,
    }));
  } catch (error) {
    response.status(503).json({
      message: "Failed to create announcement",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.patch("/api/admin/announcements/:id", requireAuth, requireAdmin, async (request, response) => {
  const id = Number(request.params.id);
  const payload = request.body as {
    title?: string;
    content?: string;
    status?: SystemAnnouncementStatus;
    startsAt?: string | null;
    endsAt?: string | null;
  };
  if (!Number.isInteger(id) || id <= 0) {
    response.status(400).json({ message: "Invalid announcement id" });
    return;
  }
  if (payload.status !== undefined && !isAnnouncementStatus(payload.status)) {
    response.status(400).json({ message: "Invalid announcement status" });
    return;
  }

  try {
    const announcement = await updatePostgresAnnouncement(id, request.user!.id, {
      title: payload.title?.trim().slice(0, 120),
      content: payload.content?.trim().slice(0, 2000),
      status: payload.status,
      startsAt: payload.startsAt,
      endsAt: payload.endsAt,
    });
    if (!announcement) {
      response.status(404).json({ message: "Announcement not found" });
      return;
    }
    response.json(announcement);
  } catch (error) {
    response.status(503).json({
      message: "Failed to update announcement",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/api/admin/audit-logs", requireAuth, requireAdmin, async (request, response) => {
  const rawUserId = request.query.userId;
  const userId = rawUserId === undefined ? undefined : Number(rawUserId);
  if (userId !== undefined && (!Number.isInteger(userId) || userId <= 0)) {
    response.status(400).json({ message: "Invalid user id" });
    return;
  }

  try {
    response.json(await listPostgresAgentAuditLogs(userId, 100));
  } catch (error) {
    response.status(503).json({
      message: "Failed to load audit logs",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/api/snapshot", requireAuth, requireScope(["diary:read", "todo:read"]), async (request, response) => {
  if (!process.env.DATABASE_URL) {
    response.json(createMockSnapshot());
    return;
  }

  try {
    response.json(await getPostgresSnapshot(request.user!.id));
  } catch (error) {
    response.status(503).json({
      message: "Failed to load PostgreSQL snapshot",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/api/export", requireAuth, async (request, response) => {
  try {
    const userId = request.user!.id;
    const snapshot = usePostgres ? await getPostgresSnapshot(userId) : getSnapshot();
    const missions = usePostgres ? await listPostgresMissions(userId) : buildMissionPlan(snapshot);
    const modelConfig = usePostgres ? await getPostgresModelConfig(userId) : getModelConfig();
    const latestShareCard = usePostgres ? await getLatestPostgresShareCard(userId) : null;

    response.json({
      version: 1,
      exportedAt: new Date().toISOString(),
      snapshot,
      missions,
      modelConfig,
      latestShareCard: latestShareCard ? withShareUrl(latestShareCard, request.get("origin")) : null,
    });
  } catch (error) {
    response.status(503).json({
      message: "Failed to export backup",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/api/restore/preview", requireAuth, async (request, response) => {
  try {
    const backup = request.body as Partial<{
      version: number;
      snapshot: {
        diaries?: Array<Partial<DiaryEntry>>;
        todos?: Array<Partial<TodoItem>>;
      };
      missions: {
        missions?: unknown[];
        nodes?: unknown[];
      };
      modelConfig?: Partial<ModelServiceConfig>;
      latestShareCard?: unknown;
    }>;
    const errors: string[] = [];
    const warnings: string[] = [];

    if (backup.version !== 1) {
      errors.push("仅支持 version = 1 的备份文件");
    }

    if (!backup.snapshot || !Array.isArray(backup.snapshot.diaries) || !Array.isArray(backup.snapshot.todos)) {
      errors.push("备份文件缺少 snapshot.diaries 或 snapshot.todos");
    }

    if (!backup.missions || !Array.isArray(backup.missions.missions)) {
      warnings.push("备份文件缺少任务线数据，恢复时将跳过任务线");
    }

    if (!backup.modelConfig) {
      warnings.push("备份文件缺少模型服务配置，恢复时将保留当前配置");
    }

    const userId = request.user!.id;
    const currentSnapshot = usePostgres ? await getPostgresSnapshot(userId) : getSnapshot();
    const currentMissions = usePostgres ? await listPostgresMissions(userId) : buildMissionPlan(currentSnapshot);
    const incomingDiaries = backup.snapshot?.diaries ?? [];
    const incomingTodos = backup.snapshot?.todos ?? [];
    const incomingMissionCount = backup.missions?.missions?.length ?? 0;
    const incomingMissionNodes = backup.missions?.nodes ?? [];
    const currentDiaryIds = new Set(currentSnapshot.diaries.map((entry) => entry.id));
    const currentTodoIds = new Set(currentSnapshot.todos.map((todo) => todo.id));
    const diaryMatches = incomingDiaries.filter((entry) => typeof entry.id === "number" && currentDiaryIds.has(entry.id)).length;
    const todoMatches = incomingTodos.filter((todo) => typeof todo.id === "number" && currentTodoIds.has(todo.id)).length;
    const invalidDiaries = incomingDiaries.filter((entry) => !isValidRestoreDiary(entry)).length;
    const invalidTodos = incomingTodos.filter((todo) => !isValidRestoreTodo(todo)).length;
    const invalidMissionNodes = incomingMissionNodes.filter((node) => !isValidRestoreMissionNode(node)).length;
    const shareCard = backup.latestShareCard as Partial<{
      title: string;
      publicToken: string;
      expiresAt: string | null;
    }> | null;
    const shareCardExpired = Boolean(shareCard?.expiresAt && new Date(shareCard.expiresAt).getTime() <= Date.now());

    if (invalidDiaries > 0) {
      warnings.push(`有 ${invalidDiaries} 条日记缺少 title、summary、time 或 source，正式恢复时会跳过`);
    }

    if (invalidTodos > 0) {
      warnings.push(`有 ${invalidTodos} 个待办缺少 text，正式恢复时会跳过`);
    }

    if (invalidMissionNodes > 0) {
      errors.push(`有 ${invalidMissionNodes} 个任务线节点缺少 title/time 或时间格式不正确`);
    }

    if (backup.modelConfig && !isValidRestoreModelConfig(backup.modelConfig)) {
      errors.push("模型服务配置格式不完整，需要 LLM/Embedding 路由、chatModel、embeddingModel 和 timeoutSeconds");
    }

    if (backup.latestShareCard && (!shareCard?.title || !shareCard.publicToken)) {
      errors.push("分享卡片缺少 title 或 publicToken");
    }

    if (shareCard?.expiresAt && Number.isNaN(new Date(shareCard.expiresAt).getTime())) {
      errors.push("分享卡片 expiresAt 不是有效时间");
    }

    if (diaryMatches > 0) {
      warnings.push(`有 ${diaryMatches} 条日记 ID 与当前数据重复，正式恢复时需要选择覆盖或跳过策略`);
    }

    if (todoMatches > 0) {
      warnings.push(`有 ${todoMatches} 个待办 ID 与当前数据重复，正式恢复时需要选择覆盖或跳过策略`);
    }

    response.json({
      valid: errors.length === 0,
      errors,
      warnings,
      summary: {
        diaries: {
          incoming: incomingDiaries.length,
          idMatches: diaryMatches,
          newItems: incomingDiaries.length - diaryMatches,
        },
        todos: {
          incoming: incomingTodos.length,
          idMatches: todoMatches,
          newItems: incomingTodos.length - todoMatches,
        },
        invalid: {
          diaries: invalidDiaries,
          todos: invalidTodos,
          missionNodes: invalidMissionNodes,
        },
        missions: {
          incoming: incomingMissionCount,
          nodes: incomingMissionNodes.length,
          current: currentMissions.missions.length,
          willReplace: incomingMissionCount > 0,
        },
        modelConfig: {
          willUpdate: Boolean(backup.modelConfig),
        },
        shareCard: {
          included: Boolean(backup.latestShareCard),
          willCreate: Boolean(backup.latestShareCard),
          expired: shareCardExpired,
        },
      },
    });
  } catch (error) {
    response.status(503).json({
      message: "Failed to preview restore",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/api/restore/apply", requireAuth, async (request, response) => {
  const payload = request.body as {
    strategy?: RestoreStrategy;
    backup?: Partial<{
      version: number;
      snapshot: {
        diaries?: Array<Partial<DiaryEntry>>;
        todos?: Array<Partial<TodoItem>>;
      };
      missions?: {
        missions?: unknown[];
        nodes?: unknown[];
      };
      modelConfig?: Partial<ModelServiceConfig>;
      latestShareCard?: unknown;
    }>;
  };
  const backup = payload.backup;
  const strategy = payload.strategy ?? "skip_existing";

  if (strategy !== "skip_existing" && strategy !== "overwrite_existing") {
    response.status(400).json({
      message: "Unsupported restore strategy",
    });
    return;
  }

  if (backup?.version !== 1 || !backup.snapshot || !Array.isArray(backup.snapshot.diaries) || !Array.isArray(backup.snapshot.todos)) {
    response.status(400).json({
      message: "Invalid backup file",
    });
    return;
  }

  try {
    if (usePostgres) {
      const summary = await restorePostgresBackupSkipExisting(backup as RestoreBackupInput, strategy, request.user!.id);
      response.json({
        applied: true,
        strategy,
        transaction: true,
        summary,
      });
      return;
    }

    const currentSnapshot = getSnapshot();
    const currentDiaryIds = new Set(currentSnapshot.diaries.map((entry) => entry.id));
    const currentTodoIds = new Set(currentSnapshot.todos.map((todo) => todo.id));
    let createdDiaries = 0;
    let skippedDiaries = 0;
    let createdTodos = 0;
    let skippedTodos = 0;

    for (const entry of backup.snapshot.diaries) {
      if (typeof entry.id === "number" && currentDiaryIds.has(entry.id)) {
        skippedDiaries += 1;
        continue;
      }

      if (!entry.title || !entry.summary || !entry.time || !entry.source) {
        skippedDiaries += 1;
        continue;
      }

      createDiary({
        title: entry.title,
        summary: entry.summary,
        time: entry.time,
        source: entry.source,
        tags: entry.tags ?? [],
      });
      createdDiaries += 1;
    }

    for (const todo of backup.snapshot.todos) {
      if (typeof todo.id === "number" && currentTodoIds.has(todo.id)) {
        skippedTodos += 1;
        continue;
      }

      if (!todo.text) {
        skippedTodos += 1;
        continue;
      }

      createTodo({
        text: todo.text,
        done: Boolean(todo.done),
      });
      createdTodos += 1;
    }

    let modelUpdated = false;
    if (backup.modelConfig) {
      const llmProvider = backup.modelConfig.llmProvider?.trim() || backup.modelConfig.provider?.trim() || "OpenAI Compatible";
      const llmBaseUrl = backup.modelConfig.llmBaseUrl?.trim() || backup.modelConfig.baseUrl?.trim() || "http://localhost:11434/v1";
      const embeddingProvider =
        backup.modelConfig.embeddingProvider?.trim() || backup.modelConfig.provider?.trim() || "OpenAI Compatible";
      const embeddingBaseUrl =
        backup.modelConfig.embeddingBaseUrl?.trim() || backup.modelConfig.baseUrl?.trim() || "http://localhost:11434/v1";
      const modelConfig: ModelServiceConfig = {
        provider: llmProvider,
        baseUrl: llmBaseUrl,
        llmProvider,
        llmBaseUrl,
        chatModel: backup.modelConfig.chatModel?.trim() || "llama3.1",
        llmApiKey: backup.modelConfig.llmApiKey?.trim() || backup.modelConfig.apiKey?.trim() || undefined,
        embeddingProvider,
        embeddingBaseUrl,
        embeddingModel: backup.modelConfig.embeddingModel?.trim() || "text-embedding-3-small",
        embeddingApiKey: backup.modelConfig.embeddingApiKey?.trim() || undefined,
        timeoutSeconds: Number(backup.modelConfig.timeoutSeconds ?? 60),
        apiKey: backup.modelConfig.llmApiKey?.trim() || backup.modelConfig.apiKey?.trim() || undefined,
      };
      updateModelConfig(modelConfig);
      modelUpdated = true;
    }

    response.json({
      applied: true,
      strategy: "skip_existing",
      summary: {
        diaries: { created: createdDiaries, updated: 0, skipped: skippedDiaries },
        todos: { created: createdTodos, updated: 0, skipped: skippedTodos },
        modelConfig: { updated: modelUpdated },
        missions: {
          replaced: false,
          created: 0,
          nodesCreated: 0,
          skipped: backup.missions?.missions?.length ?? 0,
        },
        shareCard: { created: false, skipped: Boolean(backup.latestShareCard) },
      },
    });
  } catch (error) {
    response.status(503).json({
      message: "Failed to apply restore",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/api/missions", requireAuth, async (request, response) => {
  try {
    if (!usePostgres) {
      response.json(buildMissionPlan(getSnapshot()));
      return;
    }

    const snapshot = await getPostgresSnapshot(request.user!.id);
    const onboardingStatus = await getPostgresOnboardingMissionStatus(request.user!.id);
    const onboardingComplete = isOnboardingComplete(onboardingStatus);
    const onboardingPlan = buildOnboardingMissionPlan(onboardingStatus);
    if (snapshot.diaries.length === 0 && snapshot.todos.length === 0) {
      const missions = await listPostgresMissions(request.user!.id);
      if (missions.missions.length > 0 || missions.nodes.length > 0) {
        const hasOnlyLegacyEmptyMission =
          missions.missions.length === 1 &&
          missions.missions[0].title === "推进「作业本工作流」主线" &&
          missions.nodes.length === 0;
        if (hasOnlyLegacyEmptyMission || isOnboardingMissionPlan(missions)) {
          response.json(await regeneratePostgresMissions(onboardingPlan, request.user!.id));
          return;
        }

        response.json(missions);
        return;
      }

      response.json(await regeneratePostgresMissions(onboardingPlan, request.user!.id));
      return;
    }

    const missions = await listPostgresMissions(request.user!.id);
    const hasOnlyCompletedRealMain =
      missions.missions.length > 0 &&
      missions.missions.some(
        (mission) =>
          mission.tone === "main" &&
          mission.status === "已完成" &&
          mission.progress < 100 &&
          mission.title.startsWith("推进「"),
      ) &&
      !missions.missions.some((mission) => mission.tone === "main" && mission.status !== "已完成");
    if (hasOnlyCompletedRealMain) {
      response.json(await regeneratePostgresMissions(buildMissionPlan(snapshot), request.user!.id));
      return;
    }

    if (isOnboardingMissionPlan(missions)) {
      const realPlan = buildMissionPlan(snapshot);
      response.json(
        await regeneratePostgresMissions(
          onboardingComplete
            ? {
                missions: [...realPlan.missions, ...onboardingPlan.missions],
                nodes: realPlan.nodes,
              }
            : onboardingPlan,
          request.user!.id,
        ),
      );
      return;
    }

    if (missions.missions.length > 0) {
      response.json(missions);
      return;
    }

    const plan = buildMissionPlan(snapshot);
    response.json(await regeneratePostgresMissions(plan, request.user!.id));
  } catch (error) {
    response.status(503).json({
      message: "Failed to load missions",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/api/missions/regenerate", requireAuth, async (request, response) => {
  try {
    const snapshot = usePostgres ? await getPostgresSnapshot(request.user!.id) : getSnapshot();
    const onboardingStatus = usePostgres ? await getPostgresOnboardingMissionStatus(request.user!.id) : undefined;
    const plan =
      usePostgres && snapshot.diaries.length === 0 && snapshot.todos.length === 0
        ? buildOnboardingMissionPlan(onboardingStatus)
        : buildMissionPlan(snapshot);

    if (!usePostgres) {
      response.status(201).json(plan);
      return;
    }

    response.status(201).json(await regeneratePostgresMissions(plan, request.user!.id));
  } catch (error) {
    response.status(503).json({
      message: "Failed to regenerate missions",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/api/missions/:id/complete", requireAuth, async (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id)) {
    response.status(400).json({
      message: "mission id must be an integer",
    });
    return;
  }

  if (!usePostgres) {
    response.status(204).send();
    return;
  }

  try {
    const mission = await completePostgresMission(id, request.user!.id);
    if (!mission) {
      response.status(404).json({
        message: "mission not found",
      });
      return;
    }

    if (mission.tone === "side") {
      await rollupPostgresMainMissionProgress(request.user!.id, mission.parentId);
    }

    response.json(mission);
  } catch (error) {
    response.status(503).json({
      message: "Failed to complete mission",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/api/agent-keys", requireAuth, async (request, response) => {
  if (!usePostgres) {
    response.status(503).json({
      message: "DATABASE_URL is required to create API keys",
    });
    return;
  }

  const payload = request.body as { name?: string; scopes?: string[]; expiresAt?: string | null };
  const name = payload.name?.trim() || "新 Agent";
  const scopes = payload.scopes?.length
    ? Array.from(new Set(payload.scopes.map((scope) => scope.trim()).filter(Boolean)))
    : ["diary:read", "diary:write", "todo:read", "todo:write", "timeline:read"];
  const expiresAt = payload.expiresAt?.trim() || null;
  const invalidScopes = scopes.filter((scope) => !allowedAgentKeyScopes.has(scope));
  if (invalidScopes.length > 0) {
    response.status(400).json({
      message: `Invalid scopes: ${invalidScopes.join(", ")}`,
    });
    return;
  }

  if (expiresAt) {
    const expiresTime = Date.parse(expiresAt);
    if (Number.isNaN(expiresTime) || expiresTime <= Date.now()) {
      response.status(400).json({
        message: "expiresAt must be a future ISO date string",
      });
      return;
    }
  }

  try {
    const key = await createAgentApiKey({ name, scopes, expiresAt, userId: request.user!.id });
    response.status(201).json(key);
  } catch (error) {
    response.status(503).json({
      message: "Failed to create Agent API key",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/api/agent-keys", requireAuth, async (request, response) => {
  if (!usePostgres) {
    response.json([]);
    return;
  }

  try {
    response.json(await listAgentApiKeys(request.user!.id));
  } catch (error) {
    response.status(503).json({
      message: "Failed to list Agent API keys",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.delete("/api/agent-keys/:id", requireAuth, async (request, response) => {
  if (!usePostgres) {
    response.status(204).send();
    return;
  }

  const id = Number(request.params.id);
  if (!Number.isInteger(id)) {
    response.status(400).json({
      message: "API key id must be an integer",
    });
    return;
  }

  try {
    const revoked = await revokeAgentApiKey(id, request.user!.id);
    if (!revoked) {
      response.status(404).json({
        message: "API key not found",
      });
      return;
    }

    response.status(204).send();
  } catch (error) {
    response.status(503).json({
      message: "Failed to revoke Agent API key",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/api/agent/audit-logs", requireAuth, async (request, response) => {
  if (!usePostgres) {
    response.json([]);
    return;
  }

  try {
    const logs = await listPostgresAgentAuditLogs(request.user!.id);
    response.json(logs);
  } catch (error) {
    response.status(503).json({
      message: "Failed to load agent audit logs",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/api/agent/profile", requireApiKey("agent:read"), async (request, response) => {
  if (!usePostgres) {
    response.status(503).json({
      message: "DATABASE_URL is required to read Agent profile",
    });
    return;
  }

  try {
    const profile = await getAgentProfileByApiKey(request.apiKey!);
    if (!profile) {
      response.status(404).json({
        message: "Agent profile not found",
      });
      return;
    }

    await recordAuditLog({
      key: request.apiKey!,
      action: "agent.read",
      targetType: "agent",
      targetId: profile.id,
    });

    response.json(profile);
  } catch (error) {
    response.status(503).json({
      message: "Failed to load Agent profile",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.patch("/api/agent/profile", requireApiKey("agent:write"), async (request, response) => {
  if (!usePostgres) {
    response.status(503).json({
      message: "DATABASE_URL is required to update Agent profile",
    });
    return;
  }

  const payload = request.body as {
    name?: string;
    description?: string | null;
    provider?: string | null;
    defaultColor?: string | null;
    skillDoc?: string | null;
  };

  if (payload.name !== undefined && payload.name.trim().length === 0) {
    response.status(400).json({
      message: "name cannot be empty",
    });
    return;
  }

  try {
    const profile = await updateAgentProfileByApiKey(request.apiKey!, payload);
    if (!profile) {
      response.status(404).json({
        message: "Agent profile not found",
      });
      return;
    }

    await recordAuditLog({
      key: request.apiKey!,
      action: "agent.update",
      targetType: "agent",
      targetId: profile.id,
      requestMeta: {
        updatedFields: Object.keys(payload),
      },
    });

    response.json(profile);
  } catch (error) {
    response.status(503).json({
      message: "Failed to update Agent profile",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/api/agent/snapshot", requireApiKey("diary:read"), requireApiKey("todo:read"), async (request, response) => {
  try {
    const snapshot = usePostgres ? await getPostgresSnapshot(request.apiKey!.user_id) : getSnapshot();

    if (request.apiKey && usePostgres) {
      await recordAuditLog({
        key: request.apiKey,
        action: "snapshot.read",
        targetType: "snapshot",
      });
    }

    response.json(snapshot);
  } catch (error) {
    response.status(503).json({
      message: "Failed to load Agent snapshot",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/api/agent/missions", requireApiKey("timeline:read"), async (request, response) => {
  try {
    if (!usePostgres) {
      response.json(buildMissionPlan(getSnapshot()));
      return;
    }

    const missions = await listPostgresMissions(request.apiKey!.user_id);
    const missionPlan =
      missions.missions.length > 0
        ? missions
        : await regeneratePostgresMissions(
            buildMissionPlan(await getPostgresSnapshot(request.apiKey!.user_id)),
            request.apiKey!.user_id,
          );

    await recordAuditLog({
      key: request.apiKey!,
      action: "mission.list",
      targetType: "mission",
    });

    response.json(missionPlan);
  } catch (error) {
    response.status(503).json({
      message: "Failed to load Agent missions",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/api/agent/mission-nodes", requireApiKey("timeline:write"), async (request, response) => {
  const payload = request.body as {
    timelineId?: number;
    missionTitle?: string;
    title?: string;
    summary?: string;
    status?: string;
    time?: string;
    source?: string;
    relatedDiaryIds?: number[];
  };

  if (!payload.title?.trim()) {
    response.status(400).json({
      message: "title is required",
    });
    return;
  }

  if (payload.time && !isValidTime(payload.time)) {
    response.status(400).json({
      message: "time must use HH:mm format",
    });
    return;
  }

  if (
    payload.relatedDiaryIds !== undefined &&
    (!Array.isArray(payload.relatedDiaryIds) ||
      payload.relatedDiaryIds.some((id) => !Number.isInteger(id) || id <= 0))
  ) {
    response.status(400).json({
      message: "relatedDiaryIds must be an array of positive integers",
    });
    return;
  }

  try {
    if (!usePostgres) {
      response.status(503).json({
        message: "DATABASE_URL is required to create mission nodes",
      });
      return;
    }

    let timelineId = payload.timelineId;
    if (!timelineId) {
      const missions = await listPostgresMissions(request.apiKey!.user_id);
      const missionPlan =
        missions.missions.length > 0
          ? missions
          : await regeneratePostgresMissions(
              buildMissionPlan(await getPostgresSnapshot(request.apiKey!.user_id)),
              request.apiKey!.user_id,
            );
      const missionTitle = payload.missionTitle?.trim();
      const matchedMission = missionTitle
        ? missionPlan.missions.find((mission) => mission.title === missionTitle) ??
          missionPlan.missions.find((mission) => mission.title.includes(missionTitle))
        : undefined;
      const mainMission = missionPlan.missions.find((mission) => mission.tone === "main") ?? missionPlan.missions[0];
      timelineId = matchedMission?.id ?? mainMission?.id;
    }

    if (!timelineId) {
      response.status(409).json({
        message: "No mission timeline is available",
      });
      return;
    }

    const node = await createPostgresMissionNode(
      {
        timelineId,
        title: payload.title.trim(),
        summary: payload.summary?.trim() || undefined,
        status: payload.status,
        time: payload.time,
        source: payload.source?.trim() || "Agent 写入",
        relatedDiaryIds: payload.relatedDiaryIds,
      },
      request.apiKey!.user_id,
    );

    if (!node) {
      response.status(404).json({
        message: "mission timeline not found",
      });
      return;
    }

    await recordAuditLog({
      key: request.apiKey!,
      action: "mission_node.create",
      targetType: "timeline_node",
      targetId: node.id,
      requestMeta: {
        timelineId,
        missionTitle: payload.missionTitle?.trim() || undefined,
      },
    });

    response.status(201).json(node);
  } catch (error) {
    response.status(503).json({
      message: "Failed to create Agent mission node",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/api/agent/summaries", requireApiKey("summary:read"), async (request, response) => {
  const { type, date } = request.query as { type?: string; date?: string };
  if (!type || !date) {
    response.status(400).json({ message: "type and date are required" });
    return;
  }

  try {
    if (!usePostgres) {
      response.json({ summary: null });
      return;
    }

    const summary = await getPostgresSummary(request.apiKey!.user_id, type, date);
    await recordAuditLog({
      key: request.apiKey!,
      action: "summary.read",
      targetType: "summary",
      targetId: summary?.id,
      requestMeta: {
        type,
        date,
      },
    });

    response.json({ summary });
  } catch (error) {
    response.status(503).json({
      message: "Failed to load Agent summary",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/api/agent/share-cards", requireApiKey("share:write"), async (request, response) => {
  const payload = request.body as { visibility?: "link" | "private" | "public"; expiry?: "never" | "7d" | "30d" };
  const visibility = payload.visibility ?? "link";
  const expiry = payload.expiry ?? "never";
  if (!isShareVisibility(visibility) || !isShareExpiry(expiry)) {
    response.status(400).json({
      message: "visibility must be link, private or public; expiry must be never, 7d or 30d",
    });
    return;
  }

  try {
    const { card, accessCode } = await createShareCardForUser({
      userId: request.apiKey!.user_id,
      visibility,
      expiry,
      origin: request.get("origin"),
    });

    if (request.apiKey && usePostgres) {
      await recordAuditLog({
        key: request.apiKey,
        action: "share_card.create",
        targetType: "share_card",
        targetId: card.id,
        requestMeta: {
          visibility,
          expiry,
        },
      });
    }

    response.status(201).json({
      ...card,
      accessCode,
    });
  } catch (error) {
    response.status(503).json({
      message: "Failed to create Agent share card",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/api/agent/diaries", requireApiKey("diary:read"), async (request, response) => {
  try {
    const snapshot = usePostgres ? await getPostgresSnapshot(request.apiKey!.user_id) : getSnapshot();

    if (request.apiKey && usePostgres) {
      await recordAuditLog({
        key: request.apiKey,
        action: "diary.list",
        targetType: "diary",
      });
    }

    response.json(snapshot.diaries);
  } catch (error) {
    response.status(503).json({
      message: "Failed to list Agent diaries",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/api/agent/diaries", requireApiKey("diary:write"), async (request, response) => {
  const payload = request.body as Partial<Omit<DiaryEntry, "id"> & { source_session_id?: string }>;
  if (!payload.title || !payload.summary || !payload.time) {
    response.status(400).json({
      message: "title, summary and time are required",
    });
    return;
  }

  const diaryPayload = {
    time: payload.time,
    title: payload.title,
    source: "agent" as const,
    summary: payload.summary,
    tags: payload.tags ?? ["Agent 回顾"],
  };

  try {
    const diary = usePostgres ? await createPostgresDiary(diaryPayload, request.apiKey!.user_id) : createDiary(diaryPayload);

    if (request.apiKey && usePostgres) {
      await recordAuditLog({
        key: request.apiKey,
        action: "diary.create",
        targetType: "diary",
        targetId: diary.id,
        requestMeta: {
          source_session_id: payload.source_session_id,
        },
      });
    }

    response.status(201).json(diary);
  } catch (error) {
    response.status(503).json({
      message: "Failed to create Agent diary",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.patch("/api/agent/diaries/:id", requireApiKey("diary:write"), async (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id)) {
    response.status(400).json({
      message: "diary id must be an integer",
    });
    return;
  }

  const patch = request.body as Partial<Omit<DiaryEntry, "id">>;
  if (!usePostgres) {
    response.status(503).json({
      message: "Agent diary editing requires PostgreSQL",
    });
    return;
  }

  try {
    const diary = await updatePostgresDiary(id, patch, request.apiKey!.user_id);
    if (!diary) {
      response.status(404).json({
        message: "diary not found",
      });
      return;
    }

    await recordAuditLog({
      key: request.apiKey!,
      action: "diary.update",
      targetType: "diary",
      targetId: diary.id,
    });

    response.json(diary);
  } catch (error) {
    response.status(503).json({
      message: "Failed to update Agent diary",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.delete("/api/agent/diaries/:id", requireApiKey("diary:write"), async (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id)) {
    response.status(400).json({
      message: "diary id must be an integer",
    });
    return;
  }

  if (!usePostgres) {
    response.status(204).send();
    return;
  }

  try {
    const diary = await softDeletePostgresDiary(id, request.apiKey!.user_id);
    if (!diary) {
      response.status(404).json({
        message: "diary not found",
      });
      return;
    }

    await recordAuditLog({
      key: request.apiKey!,
      action: "diary.delete",
      targetType: "diary",
      targetId: diary.id,
    });

    response.json(diary);
  } catch (error) {
    response.status(503).json({
      message: "Failed to delete Agent diary",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/api/agent/todos", requireApiKey("todo:read"), async (request, response) => {
  try {
    const snapshot = usePostgres ? await getPostgresSnapshot(request.apiKey!.user_id) : getSnapshot();

    if (request.apiKey && usePostgres) {
      await recordAuditLog({
        key: request.apiKey,
        action: "todo.list",
        targetType: "todo",
      });
    }

    response.json(snapshot.todos);
  } catch (error) {
    response.status(503).json({
      message: "Failed to list Agent todos",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/api/agent/todos", requireApiKey("todo:write"), async (request, response) => {
  const payload = request.body as Partial<Omit<TodoItem, "id">>;
  if (!payload.text) {
    response.status(400).json({
      message: "text is required",
    });
    return;
  }

  const todoPayload = {
    text: payload.text,
    done: payload.done ?? false,
    missionId: payload.missionId,
    missionTitle: payload.missionTitle,
  };

  try {
    const todo = usePostgres ? await createPostgresTodo(todoPayload, request.apiKey!.user_id) : createTodo(todoPayload);

    if (request.apiKey && usePostgres) {
      await recordAuditLog({
        key: request.apiKey,
        action: "todo.create",
        targetType: "todo",
        targetId: todo.id,
      });
    }

    response.status(201).json(todo);
  } catch (error) {
    response.status(503).json({
      message: "Failed to create Agent todo",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.patch("/api/agent/todos/:id", requireApiKey("todo:write"), async (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id)) {
    response.status(400).json({
      message: "todo id must be an integer",
    });
    return;
  }

  if (!usePostgres) {
    const updated = updateTodo(id, request.body as Partial<TodoItem>);
    if (!updated) {
      response.status(404).json({
        message: "todo not found",
      });
      return;
    }

    response.json(updated);
    return;
  }

  const patch = request.body as Partial<TodoItem> & { reason?: string };

  try {
    const updated = await updatePostgresTodo(id, patch, request.apiKey!.user_id, patch.reason);
    if (!updated) {
      response.status(404).json({
        message: "todo not found",
      });
      return;
    }

    await recordAuditLog({
      key: request.apiKey!,
      action: "todo.update",
      targetType: "todo",
      targetId: updated.id,
      requestMeta: {
        reason: patch.reason,
      },
    });

    response.json(updated);
  } catch (error) {
    response.status(503).json({
      message: "Failed to update Agent todo",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.delete("/api/agent/todos/:id", requireApiKey("todo:write"), async (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id)) {
    response.status(400).json({
      message: "todo id must be an integer",
    });
    return;
  }

  if (!usePostgres) {
    const deleted = deleteTodo(id);
    if (!deleted) {
      response.status(404).json({
        message: "todo not found",
      });
      return;
    }

    response.json(deleted);
    return;
  }

  try {
    const deleted = await deletePostgresTodo(id, request.apiKey!.user_id);
    if (!deleted) {
      response.status(404).json({
        message: "todo not found",
      });
      return;
    }

    await recordAuditLog({
      key: request.apiKey!,
      action: "todo.delete",
      targetType: "todo",
      targetId: deleted.id,
    });

    response.json(deleted);
  } catch (error) {
    response.status(503).json({
      message: "Failed to delete Agent todo",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/api/agent-review", requireAuth, async (request, response) => {
  try {
    const snapshot = usePostgres ? await getPostgresSnapshot(request.user!.id) : getSnapshot();
    const review = buildAgentReview(snapshot);
    const diary = usePostgres ? await createPostgresDiary(review.diary, request.user!.id) : createDiary(review.diary);
    const todo = usePostgres ? await createPostgresTodo(review.todo, request.user!.id) : createTodo(review.todo);
    if (usePostgres) {
      await recordPostgresUserActivity(request.user!.id, "agent_review.create", "diary", diary.id, { todoId: todo.id });
    }

    response.status(201).json({
      diary,
      todo,
    });
  } catch (error) {
    response.status(503).json({
      message: "Failed to run Agent review",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/api/diaries", requireAuth, requireScope("diary:write"), async (request, response) => {
  const payload = request.body as Partial<Omit<DiaryEntry, "id">>;
  if (!payload.title || !payload.summary || !payload.time || !payload.source) {
    response.status(400).json({
      message: "title, summary, time and source are required",
    });
    return;
  }

  const diaryPayload = {
    time: payload.time,
    title: payload.title,
    source: payload.source,
    summary: payload.summary,
    tags: payload.tags ?? [],
  };

  if (!usePostgres) {
    response.status(201).json(createDiary(diaryPayload));
    return;
  }

  try {
    const diary = await createPostgresDiary(diaryPayload, request.user!.id);
    await recordPostgresUserActivity(request.user!.id, "diary.create", "diary", diary.id, { source: diary.source });
    if (request.apiKey) {
      await recordAuditLog({
        key: request.apiKey,
        action: "diary.create",
        targetType: "diary",
        targetId: diary.id,
      });
    }
    response.status(201).json(diary);
  } catch (error) {
    response.status(503).json({
      message: "Failed to create diary",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.patch("/api/diaries/:id", requireAuth, requireScope("diary:write"), async (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id)) {
    response.status(400).json({
      message: "diary id must be an integer",
    });
    return;
  }

  const patch = request.body as Partial<Omit<DiaryEntry, "id">>;
  if (!usePostgres) {
    response.status(503).json({
      message: "Diary editing requires PostgreSQL in the current MVP",
    });
    return;
  }

  try {
    const diary = await updatePostgresDiary(id, patch, request.user!.id);
    if (!diary) {
      response.status(404).json({
        message: "diary not found",
      });
      return;
    }

    if (request.apiKey) {
      await recordAuditLog({
        key: request.apiKey,
        action: "diary.update",
        targetType: "diary",
        targetId: diary.id,
      });
    }

    response.json(diary);
  } catch (error) {
    response.status(503).json({
      message: "Failed to update diary",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/api/diaries/trash", requireAuth, requireScope("diary:read"), async (request, response) => {
  if (!usePostgres) {
    response.json([]);
    return;
  }

  try {
    response.json(await listPostgresDeletedDiaries(request.user!.id));
  } catch (error) {
    response.status(503).json({
      message: "Failed to load trash diaries",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.delete("/api/diaries/:id", requireAuth, requireScope("diary:write"), async (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id)) {
    response.status(400).json({
      message: "diary id must be an integer",
    });
    return;
  }

  if (!usePostgres) {
    response.status(204).send();
    return;
  }

  try {
    const diary = await softDeletePostgresDiary(id, request.user!.id);
    if (!diary) {
      response.status(404).json({
        message: "diary not found",
      });
      return;
    }

    if (request.apiKey) {
      await recordAuditLog({
        key: request.apiKey,
        action: "diary.delete",
        targetType: "diary",
        targetId: diary.id,
      });
    }

    response.json(diary);
  } catch (error) {
    response.status(503).json({
      message: "Failed to delete diary",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/api/diaries/:id/restore", requireAuth, requireScope("diary:write"), async (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id)) {
    response.status(400).json({
      message: "diary id must be an integer",
    });
    return;
  }

  if (!usePostgres) {
    response.status(204).send();
    return;
  }

  try {
    const diary = await restorePostgresDiary(id, request.user!.id);
    if (!diary) {
      response.status(404).json({
        message: "diary not found in trash",
      });
      return;
    }

    if (request.apiKey) {
      await recordAuditLog({
        key: request.apiKey,
        action: "diary.restore",
        targetType: "diary",
        targetId: diary.id,
      });
    }

    response.json(diary);
  } catch (error) {
    response.status(503).json({
      message: "Failed to restore diary",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.delete("/api/diaries/:id/permanent", requireAuth, requireScope("diary:write"), async (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id)) {
    response.status(400).json({
      message: "diary id must be an integer",
    });
    return;
  }

  if (!usePostgres) {
    response.status(204).send();
    return;
  }

  try {
    const deleted = await permanentlyDeletePostgresDiary(id, request.user!.id);
    if (!deleted) {
      response.status(404).json({
        message: "diary not found in trash",
      });
      return;
    }

    if (request.apiKey) {
      await recordAuditLog({
        key: request.apiKey,
        action: "diary.delete_permanent",
        targetType: "diary",
        targetId: id,
      });
    }

    response.status(204).send();
  } catch (error) {
    response.status(503).json({
      message: "Failed to permanently delete diary",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/api/todos", requireAuth, requireScope("todo:write"), async (request, response) => {
  const payload = request.body as Partial<Omit<TodoItem, "id">>;
  if (!payload.text) {
    response.status(400).json({
      message: "text is required",
    });
    return;
  }

  const todoPayload = {
    text: payload.text,
    done: payload.done ?? false,
    missionId: payload.missionId,
    missionTitle: payload.missionTitle,
  };

  if (!usePostgres) {
    response.status(201).json(createTodo(todoPayload));
    return;
  }

  try {
    const todo = await createPostgresTodo(todoPayload, request.user!.id);
    await recordPostgresUserActivity(request.user!.id, "todo.create", "todo", todo.id);
    if (request.apiKey) {
      await recordAuditLog({
        key: request.apiKey,
        action: "todo.create",
        targetType: "todo",
        targetId: todo.id,
      });
    }
    response.status(201).json(todo);
  } catch (error) {
    response.status(503).json({
      message: "Failed to create todo",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/api/todos/history", requireAuth, requireScope("todo:read"), async (request, response) => {
  if (!usePostgres) {
    response.json([]);
    return;
  }

  try {
    response.json(await listPostgresTodoHistory(request.user!.id));
  } catch (error) {
    response.status(503).json({
      message: "Failed to load todo status history",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.patch("/api/todos/:id", requireAuth, requireScope("todo:write"), async (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id)) {
    response.status(400).json({
      message: "todo id must be an integer",
    });
    return;
  }

  if (!usePostgres) {
    const updated = updateTodo(id, request.body as Partial<TodoItem>);
    if (!updated) {
      response.status(404).json({
        message: "todo not found",
      });
      return;
    }

    response.json(updated);
    return;
  }

  const patch = request.body as Partial<TodoItem> & { reason?: string };

  try {
    const updated = await updatePostgresTodo(id, patch, request.user!.id, patch.reason);
    if (!updated) {
      response.status(404).json({
        message: "todo not found",
      });
      return;
    }

    if (request.apiKey) {
      await recordAuditLog({
        key: request.apiKey,
        action: "todo.update",
        targetType: "todo",
        targetId: updated.id,
      });
    }

    response.json(updated);
  } catch (error) {
    response.status(503).json({
      message: "Failed to update todo",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.delete("/api/todos/:id", requireAuth, requireScope("todo:write"), async (request, response) => {
  const id = Number(request.params.id);
  if (!Number.isInteger(id)) {
    response.status(400).json({
      message: "todo id must be an integer",
    });
    return;
  }

  if (!usePostgres) {
    const deleted = deleteTodo(id);
    if (!deleted) {
      response.status(404).json({
        message: "todo not found",
      });
      return;
    }

    response.json(deleted);
    return;
  }

  try {
    const deleted = await deletePostgresTodo(id, request.user!.id);
    if (!deleted) {
      response.status(404).json({
        message: "todo not found",
      });
      return;
    }

    if (request.apiKey) {
      await recordAuditLog({
        key: request.apiKey,
        action: "todo.delete",
        targetType: "todo",
        targetId: deleted.id,
      });
    }

    response.json(deleted);
  } catch (error) {
    response.status(503).json({
      message: "Failed to delete todo",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.put("/api/settings/profile", requireAuth, async (request, response) => {
  if (!usePostgres) {
    response.status(503).json({
      message: "Profile configuration requires PostgreSQL database in the current MVP",
    });
    return;
  }

  const { nickname, bio, avatar, workProfile } = request.body as {
    nickname?: string;
    bio?: string;
    avatar?: string;
    workProfile?: Record<string, any>;
  };

  try {
    const user = await updatePostgresUserProfile(request.user!.id, { nickname, bio, avatar, workProfile });
    if (!user) {
      response.status(404).json({
        message: "User not found",
      });
      return;
    }

    response.json({
      id: user.id,
      username: user.username,
      role: user.role,
      status: user.status,
      nickname: user.nickname,
      bio: user.bio,
      avatar: user.avatar,
      workProfile: user.work_profile,
    });
  } catch (error) {
    response.status(503).json({
      message: "Failed to update profile",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.put("/api/settings/theme", requireAuth, (request, response) => {
  const theme = (request.body as { theme?: ThemeName }).theme;
  if (!theme) {
    response.status(400).json({
      message: "theme is required",
    });
    return;
  }

  if (!usePostgres) {
    updateTheme(theme);
    response.status(204).send();
    return;
  }

  updatePostgresTheme(theme, request.user!.id)
    .then(() => response.status(204).send())
    .catch((error) =>
      response.status(503).json({
        message: "Failed to update theme",
        detail: error instanceof Error ? error.message : "Unknown error",
      }),
    );
});

app.get("/api/settings/model", requireAuth, async (request, response) => {
  try {
    response.json(usePostgres ? await getPostgresModelConfig(request.user!.id) : getModelConfig());
  } catch (error) {
    response.status(503).json({
      message: "Failed to load model config",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.put("/api/settings/model", requireAuth, async (request, response) => {
  const payload = request.body as Partial<ModelServiceConfig>;
  const savedConfig = usePostgres ? await getPostgresModelConfig(request.user!.id) : getModelConfig();
  const llmProvider = payload.llmProvider?.trim() || payload.provider?.trim() || "OpenAI Compatible";
  const llmBaseUrl = payload.llmBaseUrl?.trim() || payload.baseUrl?.trim() || "http://localhost:11434/v1";
  const embeddingProvider = payload.embeddingProvider?.trim() || payload.provider?.trim() || "OpenAI Compatible";
  const embeddingBaseUrl = payload.embeddingBaseUrl?.trim() || payload.baseUrl?.trim() || "http://localhost:11434/v1";
  const config: ModelServiceConfig = {
    provider: llmProvider,
    baseUrl: llmBaseUrl,
    llmProvider,
    llmBaseUrl,
    chatModel: payload.chatModel?.trim() || "llama3.1",
    llmApiKey: payload.llmApiKey?.trim() || payload.apiKey?.trim() || savedConfig.llmApiKey || savedConfig.apiKey,
    embeddingProvider,
    embeddingBaseUrl,
    embeddingModel: payload.embeddingModel?.trim() || "text-embedding-3-small",
    embeddingApiKey: payload.embeddingApiKey?.trim() || savedConfig.embeddingApiKey,
    timeoutSeconds: Number(payload.timeoutSeconds ?? 60),
    apiKey: payload.llmApiKey?.trim() || payload.apiKey?.trim() || savedConfig.llmApiKey || savedConfig.apiKey,
  };

  if (!Number.isFinite(config.timeoutSeconds) || config.timeoutSeconds < 5 || config.timeoutSeconds > 600) {
    response.status(400).json({
      message: "timeoutSeconds must be between 5 and 600",
    });
    return;
  }

  try {
    response.json(usePostgres ? await updatePostgresModelConfig(config, request.user!.id) : updateModelConfig(config));
  } catch (error) {
    response.status(503).json({
      message: "Failed to update model config",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/api/settings/model/test", requireAuth, async (request, response) => {
  const payload = request.body as Partial<ModelServiceConfig> | undefined;
  const savedConfig = usePostgres ? await getPostgresModelConfig(request.user!.id) : getModelConfig();
  const llmProvider = payload?.llmProvider?.trim() || payload?.provider?.trim() || savedConfig.llmProvider || savedConfig.provider || "OpenAI Compatible";
  const llmBaseUrl = payload?.llmBaseUrl?.trim() || payload?.baseUrl?.trim() || savedConfig.llmBaseUrl || savedConfig.baseUrl || "http://localhost:11434/v1";
  const embeddingProvider = payload?.embeddingProvider?.trim() || savedConfig.embeddingProvider || savedConfig.provider || "OpenAI Compatible";
  const embeddingBaseUrl = payload?.embeddingBaseUrl?.trim() || savedConfig.embeddingBaseUrl || savedConfig.baseUrl || "http://localhost:11434/v1";
  const config: ModelServiceConfig = {
    ...savedConfig,
    ...payload,
    provider: llmProvider,
    baseUrl: llmBaseUrl,
    llmProvider,
    llmBaseUrl,
    chatModel: payload?.chatModel?.trim() || savedConfig.chatModel || "llama3.1",
    llmApiKey: payload?.llmApiKey?.trim() || payload?.apiKey?.trim() || savedConfig.llmApiKey || savedConfig.apiKey,
    embeddingProvider,
    embeddingBaseUrl,
    embeddingModel: payload?.embeddingModel?.trim() || savedConfig.embeddingModel || "text-embedding-3-small",
    embeddingApiKey: payload?.embeddingApiKey?.trim() || savedConfig.embeddingApiKey,
    timeoutSeconds: Number(payload?.timeoutSeconds ?? savedConfig.timeoutSeconds ?? 60),
    apiKey: payload?.llmApiKey?.trim() || payload?.apiKey?.trim() || savedConfig.llmApiKey || savedConfig.apiKey,
  };

  const result = {
    chat: await testModelPart(async () => {
      const text = await callLLMChat(
        config,
        [{ role: "user", content: "请只回复 OK，用于测试模型连通性。" }],
        "你是模型连通性检测助手。请用最短文本回复。",
      );
      return text.slice(0, 120);
    }),
    embedding: await testModelPart(async () => {
      const embedding = await callEmbedding(config, "作业本模型连通性检测");
      return `维度 ${embedding.length}`;
    }),
  };

  response.json({
    ok: result.chat.ok && result.embedding.ok,
    ...result,
  });
});

// --- AI 总结与问答 RAG API ---

app.get("/api/summaries", requireAuth, requireScope("summary:read"), async (request, response) => {
  const { type, date } = request.query as { type?: string; date?: string };
  if (!type || !date) {
    response.status(400).json({ message: "type and date are required" });
    return;
  }

  try {
    if (!usePostgres) {
      // Demo 模式不支持 summaries 存盘，返回空让前端渲染
      response.json({ summary: null });
      return;
    }

    const summary = await getPostgresSummary(request.user!.id, type, date);
    response.json({ summary });
  } catch (error) {
    response.status(503).json({
      message: "Failed to load summary",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/api/summaries", requireAuth, requireScope("summary:write"), async (request, response) => {
  const { type, date } = request.body as { type?: string; date?: string };
  if (!type || !date) {
    response.status(400).json({ message: "type and date are required" });
    return;
  }

  try {
    if (!usePostgres) {
      // Demo 模式优雅降级
      response.json({
        summary: {
          id: 9999,
          user_id: 1,
          type,
          summary_date: date,
          content: `### 工作回顾 (单机 Demo 模式)

* **累计进展**：您目前处于单机演示模式下。
* **提示**：配置 PostgreSQL 数据库后，我们将使用 pgvector 向量索引、两阶段混合 RAG 问答与大模型结合，自动生成带 Chart.js 的炫酷报表 and 建议待办。`,
          total_work_time: 480,
          tag_distribution: { "Demo": 1 },
          html_file_path: null,
          created_at: new Date().toISOString()
        },
        todos: [
          { id: Date.now(), content: "在 Demo 模式下体验工作流", priority: "中", status: "待办" }
        ]
      });
      return;
    }

    const config = await getPostgresModelConfig(request.user!.id);
    const user = await findUserById(request.user!.id);
    const workProfile = user?.work_profile ? (user.work_profile as Record<string, any>) : undefined;

    const result = await generateSummaryAndRegisterTodos(config, request.user!.id, type, date, workProfile);
    await recordPostgresUserActivity(request.user!.id, "summary.create", "summary", result.summary?.id ?? null, { type, date });
    response.json(result);
  } catch (error) {
    response.status(503).json({
      message: "Failed to generate summary",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/api/qa/ask", requireAuth, requireScope("assistant:ask"), async (request, response) => {
  const { question } = request.body as { question?: string };
  if (!question || !question.trim()) {
    response.status(400).json({ message: "question is required" });
    return;
  }

  try {
    if (!usePostgres) {
      // Demo 模式优雅降级
      response.json({
        answer: "💡 **Demo 降级提示**：当前系统运行在无 PostgreSQL 的单机 Demo 模式下，无法执行基于 `pgvector` HNSW 索引的日记两阶段向量检索与溯源。请在 `.env` 中配置 `DATABASE_URL` 以启动完整版 AI 问答助手！",
        citations: []
      });
      return;
    }

    const config = await getPostgresModelConfig(request.user!.id);
    const user = await findUserById(request.user!.id);
    const workProfile = user?.work_profile ? (user.work_profile as Record<string, any>) : undefined;

    const result = await ragAskQuestion(config, request.user!.id, question, workProfile);
    response.json(result);
  } catch (error) {
    response.status(503).json({
      message: "Failed to query AI assistant",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/api/qa/reindex", requireAuth, requireScope("assistant:write"), async (request, response) => {
  try {
    if (!usePostgres) {
      response.json({ ok: false, message: "Demo 模式下无需重建索引" });
      return;
    }

    const config = await getPostgresModelConfig(request.user!.id);
    const result = await reindexUserDiaries(config, request.user!.id);
    response.json({ ok: true, ...result });
  } catch (error) {
    response.status(503).json({
      message: "Failed to rebuild vector index",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.put("/api/share/settings", requireAuth, (request, response) => {
  const payload = request.body as { generated?: boolean; visibility?: "link" | "private" | "public" };
  if (typeof payload.generated !== "boolean" || !payload.visibility) {
    response.status(400).json({
      message: "generated and visibility are required",
    });
    return;
  }

  const shareSettings = {
    generated: payload.generated,
    visibility: payload.visibility,
  };

  if (!usePostgres) {
    updateShareSettings(shareSettings);
    response.status(204).send();
    return;
  }

  updatePostgresShareSettings(shareSettings, request.user!.id)
    .then(() => response.status(204).send())
    .catch((error) =>
      response.status(503).json({
        message: "Failed to update share settings",
        detail: error instanceof Error ? error.message : "Unknown error",
      }),
    );
});

app.get("/api/share-cards/latest", requireAuth, async (request, response) => {
  if (!usePostgres) {
    response.json(null);
    return;
  }

  try {
    const card = await getLatestPostgresShareCard(request.user!.id);
    response.json(card ? withShareUrl(card, request.get("origin")) : null);
  } catch (error) {
    response.status(503).json({
      message: "Failed to load latest share card",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.get("/api/share-cards/public/:token", async (request, response) => {
  if (!usePostgres) {
    response.status(404).json({
      message: "share card not found",
    });
    return;
  }

  try {
    const result = await getPublicPostgresShareCard(request.params.token, String(request.query.accessCode ?? ""));
    if (!result) {
      response.status(404).json({
        message: "share card not found",
      });
      return;
    }

    if ("requiresPassword" in result) {
      response.status(401).json({
        message: "请输入分享访问码",
        requiresPassword: true,
      });
      return;
    }

    response.json(withShareUrl(result.card, request.get("origin")));
  } catch (error) {
    response.status(503).json({
      message: "Failed to load public share card",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/api/share-cards", requireAuth, async (request, response) => {
  const payload = request.body as { visibility?: "link" | "private" | "public"; expiry?: "never" | "7d" | "30d" };
  const visibility = payload.visibility ?? "link";
  const expiry = payload.expiry ?? "never";
  if (!isShareVisibility(visibility) || !isShareExpiry(expiry)) {
    response.status(400).json({
      message: "visibility must be link, private or public; expiry must be never, 7d or 30d",
    });
    return;
  }

  try {
    const { card, accessCode } = await createShareCardForUser({
      userId: request.user!.id,
      visibility,
      expiry,
      origin: request.get("origin"),
    });
    await recordPostgresUserActivity(request.user!.id, "share_card.create", "share_card", card.id, { visibility, expiry });

    response.status(201).json({
      ...card,
      accessCode,
    });
  } catch (error) {
    response.status(503).json({
      message: "Failed to create share card",
      detail: error instanceof Error ? error.message : "Unknown error",
    });
  }
});

app.post("/api/dev/reset", (_request, response) => {
  response.json(resetStore());
});

if (process.env.NODE_ENV === "production") {
  const distPath = path.join(__dirname, "../dist");
  app.use(express.static(distPath));
  app.use((request, response, next) => {
    if ((request.method !== "GET" && request.method !== "HEAD") || request.path.startsWith("/api/")) {
      next();
      return;
    }

    response.sendFile(path.join(distPath, "index.html"));
  });
}

app.use((request, response) => {
  response.status(404).json({
    message: `No route for ${request.method} ${request.path}`,
  });
});

const server = app.listen(port, () => {
  console.log(`作业本 API listening on http://localhost:${port}`);
});

process.on("SIGTERM", () => {
  server.close(() => {
    process.exit(0);
  });
});

function withShareUrl<T extends { publicToken: string }>(card: T, origin?: string) {
  const publicAppUrl = process.env.PUBLIC_APP_URL ?? origin ?? "http://localhost:5173";
  return {
    ...card,
    shareUrl: `${publicAppUrl}/share/${card.publicToken}`,
  };
}

async function createShareCardForUser({
  userId,
  visibility,
  expiry,
  origin,
}: {
  userId: number;
  visibility: "link" | "private" | "public";
  expiry: "never" | "7d" | "30d";
  origin?: string;
}) {
  const expiresAt = resolveShareExpiry(expiry);
  const snapshot = usePostgres ? await getPostgresSnapshot(userId) : getSnapshot();
  const missionPlan = usePostgres ? await listPostgresMissions(userId) : buildMissionPlan(snapshot);
  const mainMission = missionPlan.missions.find((mission) => mission.tone === "main") ?? missionPlan.missions[0];
  const cardSnapshot = {
    diaryCount: snapshot.diaries.length,
    agentDiaryCount: snapshot.diaries.filter((entry) => entry.source === "agent").length,
    openTodoCount: snapshot.todos.filter((todo) => !todo.done).length,
    mainMissionTitle: mainMission?.title ?? "今日工作轨迹",
    mainMissionProgress: mainMission?.progress ?? 0,
    topTags: getTopTags(snapshot.diaries),
  };
  const token = crypto.randomBytes(8).toString("hex");
  const accessCode = visibility === "private" ? String(crypto.randomInt(100000, 1000000)) : undefined;
  const card = usePostgres
    ? await createPostgresShareCard(
        {
          title: "今天也认真发光了",
          token,
          visibility,
          accessCode,
          expiresAt,
          snapshot: cardSnapshot,
        },
        userId,
      )
    : {
        id: Date.now(),
        title: "今天也认真发光了",
        publicToken: token,
        visibility,
        requiresPassword: visibility === "private",
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt?.toISOString() ?? null,
        snapshot: cardSnapshot,
      };

  return {
    card: withShareUrl(card, origin),
    accessCode,
  };
}

function resolveShareExpiry(expiry: "never" | "7d" | "30d") {
  if (expiry === "never") return null;
  const days = expiry === "7d" ? 7 : 30;
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

function isShareVisibility(value: unknown): value is "link" | "private" | "public" {
  return value === "link" || value === "private" || value === "public";
}

function isShareExpiry(value: unknown): value is "never" | "7d" | "30d" {
  return value === "never" || value === "7d" || value === "30d";
}

function isValidRestoreDiary(entry: { title?: unknown; summary?: unknown; time?: unknown; source?: unknown }) {
  return (
    typeof entry.title === "string" &&
    entry.title.trim().length > 0 &&
    typeof entry.summary === "string" &&
    entry.summary.trim().length > 0 &&
    typeof entry.time === "string" &&
    isValidTime(entry.time) &&
    (entry.source === "human" || entry.source === "agent")
  );
}

function isValidRestoreTodo(todo: { text?: unknown }) {
  return typeof todo.text === "string" && todo.text.trim().length > 0;
}

function isValidRestoreMissionNode(node: unknown) {
  if (!node || typeof node !== "object") return false;
  const item = node as { title?: unknown; time?: unknown };
  return typeof item.title === "string" && item.title.trim().length > 0 && typeof item.time === "string" && isValidTime(item.time);
}

function isValidRestoreModelConfig(config: Partial<ModelServiceConfig>) {
  const hasLegacyRoute =
    typeof config.provider === "string" &&
    config.provider.trim().length > 0 &&
    typeof config.baseUrl === "string" &&
    config.baseUrl.trim().length > 0;
  const hasSplitRoute =
    typeof config.llmProvider === "string" &&
    config.llmProvider.trim().length > 0 &&
    typeof config.llmBaseUrl === "string" &&
    config.llmBaseUrl.trim().length > 0 &&
    typeof config.embeddingProvider === "string" &&
    config.embeddingProvider.trim().length > 0 &&
    typeof config.embeddingBaseUrl === "string" &&
    config.embeddingBaseUrl.trim().length > 0;

  return (
    (hasLegacyRoute || hasSplitRoute) &&
    typeof config.chatModel === "string" &&
    config.chatModel.trim().length > 0 &&
    typeof config.embeddingModel === "string" &&
    config.embeddingModel.trim().length > 0 &&
    typeof config.timeoutSeconds === "number" &&
    Number.isFinite(config.timeoutSeconds) &&
    config.timeoutSeconds > 0
  );
}

function isFeedbackType(value: unknown): value is FeedbackType {
  return value === "bug" || value === "suggestion" || value === "usage" || value === "model" || value === "other";
}

function isFeedbackStatus(value: unknown): value is FeedbackStatus {
  return value === "open" || value === "processing" || value === "resolved" || value === "closed";
}

function isAnnouncementStatus(value: unknown): value is SystemAnnouncementStatus {
  return value === "active" || value === "paused";
}

async function testModelPart(check: () => Promise<string>) {
  const startedAt = Date.now();
  try {
    const sample = await check();
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
      sample,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown model connection error",
    };
  }
}

function isValidTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function getTopTags(diaries: DiaryEntry[]) {
  const counts = new Map<string, number>();

  diaries.forEach((entry) => {
    entry.tags.forEach((tag) => {
      if (tag === "Agent 回顾" || tag === "自动整理") return;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    });
  });

  return [...counts.entries()]
    .sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0], "zh-CN"))
    .slice(0, 3)
    .map(([tag]) => tag);
}
