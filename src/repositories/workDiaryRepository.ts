import { apiRequest } from "../lib/apiClient";
import type { DiaryEntry, Mission, MissionNode, ModelServiceConfig, ThemeName, TodoItem } from "../types";

export type ShareVisibility = "link" | "private" | "public";
export type ShareExpiryPreset = "never" | "7d" | "30d";

export type WorkDiarySnapshot = {
  diaries: DiaryEntry[];
  todos: TodoItem[];
  theme: ThemeName;
  share: {
    generated: boolean;
    visibility: ShareVisibility;
  };
};

export type MissionPlanResponse = {
  missions: Mission[];
  nodes: MissionNode[];
};

export type ShareCardResponse = {
  id: number;
  title: string;
  publicToken: string;
  shareUrl: string;
  visibility: ShareVisibility;
  requiresPassword?: boolean;
  accessCode?: string;
  createdAt: string;
  expiresAt: string | null;
  snapshot: {
    diaryCount?: number;
    agentDiaryCount?: number;
    openTodoCount?: number;
    mainMissionTitle?: string;
    mainMissionProgress?: number;
    topTags?: string[];
  };
};

export type BackupExportResponse = {
  version: number;
  exportedAt: string;
  snapshot: WorkDiarySnapshot;
  missions: MissionPlanResponse;
  modelConfig: ModelServiceConfig;
  latestShareCard: ShareCardResponse | null;
};

export type RestorePreviewResponse = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  summary: {
    diaries: { incoming: number; idMatches: number; newItems: number };
    todos: { incoming: number; idMatches: number; newItems: number };
    invalid: { diaries: number; todos: number; missionNodes: number };
    missions: { incoming: number; nodes: number; current: number; willReplace: boolean };
    modelConfig: { willUpdate: boolean };
    shareCard: { included: boolean; willCreate: boolean; expired: boolean };
  };
};

export type RestoreApplyResponse = {
  applied: true;
  strategy: "skip_existing" | "overwrite_existing";
  summary: {
    diaries: { created: number; updated: number; skipped: number };
    todos: { created: number; updated: number; skipped: number };
    modelConfig: { updated: boolean };
    missions: { replaced: boolean; created: number; nodesCreated: number; skipped: number };
    shareCard: { created: boolean; skipped: boolean };
  };
};

export type CreateDiaryPayload = Omit<DiaryEntry, "id">;
export type CreateTodoPayload = Omit<TodoItem, "id">;

export interface WorkDiaryRepository {
  getSnapshot(): Promise<WorkDiarySnapshot>;
  createDiary(payload: CreateDiaryPayload): Promise<DiaryEntry>;
  createTodo(payload: CreateTodoPayload): Promise<TodoItem>;
  updateTodo(id: number, patch: Partial<TodoItem>): Promise<TodoItem>;
  updateTheme(theme: ThemeName): Promise<void>;
  updateShareSettings(settings: WorkDiarySnapshot["share"]): Promise<void>;
}

export type AgentApiKeyResponse = {
  api_key_id: number;
  agent_id: number;
  key_mask: string;
  scopes: string[];
  rawKey: string;
  expires_at: string | null;
};

export type AgentApiKeyListItem = {
  id: number;
  agent_id: number | null;
  agent_name: string | null;
  key_mask: string;
  scopes: string[];
  expires_at: string | null;
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

export type AgentReviewResponse = {
  diary: DiaryEntry;
  todo: TodoItem;
};

export type ModelConnectionTestResponse = {
  ok: boolean;
  chat: {
    ok: boolean;
    latencyMs: number;
    sample?: string;
    error?: string;
  };
  embedding: {
    ok: boolean;
    latencyMs: number;
    sample?: string;
    error?: string;
  };
};

export async function createAgentApiKey(options: { name?: string; scopes?: string[]; expiresAt?: string | null } = {}) {
  return apiRequest<AgentApiKeyResponse>("/agent-keys", {
    method: "POST",
    body: {
      name: options.name?.trim() || "Codex 工作助手",
      scopes: options.scopes?.length
        ? options.scopes
        : ["diary:read", "diary:write", "todo:read", "todo:write", "timeline:read"],
      expiresAt: options.expiresAt ?? null,
    },
  });
}

export async function listAgentApiKeys() {
  return apiRequest<AgentApiKeyListItem[]>("/agent-keys");
}

export async function revokeAgentApiKey(id: number) {
  return apiRequest<void>(`/agent-keys/${id}`, {
    method: "DELETE",
  });
}

export async function listTodoStatusHistory() {
  return apiRequest<TodoStatusHistoryItem[]>("/todos/history");
}

export async function updateTodoStatus(id: number, done: boolean, reason: string) {
  return apiRequest<TodoItem>(`/todos/${id}`, {
    method: "PATCH",
    body: {
      done,
      reason,
    },
  });
}

export async function updateTodoText(id: number, text: string) {
  return apiRequest<TodoItem>(`/todos/${id}`, {
    method: "PATCH",
    body: {
      text,
    },
  });
}

export async function deleteTodo(id: number) {
  return apiRequest<TodoItem>(`/todos/${id}`, {
    method: "DELETE",
  });
}

export async function getWorkDiarySnapshot() {
  return apiRequest<WorkDiarySnapshot>("/snapshot");
}

export async function getModelConfig() {
  return apiRequest<ModelServiceConfig>("/settings/model");
}

export async function exportBackup() {
  return apiRequest<BackupExportResponse>("/export");
}

export async function previewRestoreBackup(backup: unknown) {
  return apiRequest<RestorePreviewResponse>("/restore/preview", {
    method: "POST",
    body: backup,
  });
}

export async function applyRestoreBackup(backup: unknown, strategy: RestoreApplyResponse["strategy"] = "skip_existing") {
  return apiRequest<RestoreApplyResponse>("/restore/apply", {
    method: "POST",
    body: {
      backup,
      strategy,
    },
  });
}

export async function updateModelConfig(config: ModelServiceConfig) {
  return apiRequest<ModelServiceConfig>("/settings/model", {
    method: "PUT",
    body: config,
  });
}

export async function testModelConnection(config: ModelServiceConfig) {
  return apiRequest<ModelConnectionTestResponse>("/settings/model/test", {
    method: "POST",
    body: config,
  });
}

export async function createDiary(payload: CreateDiaryPayload) {
  return apiRequest<DiaryEntry>("/diaries", {
    method: "POST",
    body: payload,
  });
}

export async function createTodo(payload: CreateTodoPayload) {
  return apiRequest<TodoItem>("/todos", {
    method: "POST",
    body: payload,
  });
}

export async function requestAgentReview() {
  return apiRequest<AgentReviewResponse>("/agent-review", {
    method: "POST",
  });
}

export async function listMissions() {
  return apiRequest<MissionPlanResponse>("/missions");
}

export async function regenerateMissions() {
  return apiRequest<MissionPlanResponse>("/missions/regenerate", {
    method: "POST",
  });
}

export async function completeMission(id: number) {
  return apiRequest<Mission>(`/missions/${id}/complete`, {
    method: "POST",
  });
}

export async function getLatestShareCard() {
  return apiRequest<ShareCardResponse | null>("/share-cards/latest");
}

export async function createShareCard(visibility: ShareVisibility, expiry: ShareExpiryPreset = "never") {
  return apiRequest<ShareCardResponse>("/share-cards", {
    method: "POST",
    body: {
      visibility,
      expiry,
    },
  });
}

export async function getPublicShareCard(token: string, accessCode?: string) {
  const query = accessCode ? `?accessCode=${encodeURIComponent(accessCode)}` : "";
  return apiRequest<ShareCardResponse>(`/share-cards/public/${token}${query}`);
}

export async function listTrashDiaries() {
  return apiRequest<DiaryEntry[]>("/diaries/trash");
}

export async function deleteDiary(id: number) {
  return apiRequest<DiaryEntry>(`/diaries/${id}`, {
    method: "DELETE",
  });
}

export async function updateDiary(id: number, patch: Partial<Omit<DiaryEntry, "id">>) {
  return apiRequest<DiaryEntry>(`/diaries/${id}`, {
    method: "PATCH",
    body: patch,
  });
}

export async function restoreDiary(id: number) {
  return apiRequest<DiaryEntry>(`/diaries/${id}/restore`, {
    method: "POST",
  });
}

export async function permanentlyDeleteDiary(id: number) {
  return apiRequest<void>(`/diaries/${id}/permanent`, {
    method: "DELETE",
  });
}

export function createHttpWorkDiaryRepository(apiKey?: string): WorkDiaryRepository {
  return {
    getSnapshot: () => apiRequest<WorkDiarySnapshot>("/snapshot", { apiKey }),
    createDiary: (payload) => apiRequest<DiaryEntry>("/diaries", { method: "POST", body: payload, apiKey }),
    createTodo: (payload) => apiRequest<TodoItem>("/todos", { method: "POST", body: payload, apiKey }),
    updateTodo: (id, patch) =>
      apiRequest<TodoItem>(`/todos/${id}`, { method: "PATCH", body: patch, apiKey }),
    updateTheme: (theme) =>
      apiRequest<void>("/settings/theme", { method: "PUT", body: { theme }, apiKey }),
    updateShareSettings: (settings) =>
      apiRequest<void>("/share/settings", { method: "PUT", body: settings, apiKey }),
  };
}

export interface AgentAuditLogRow {
  id: number;
  agent_name: string | null;
  key_mask: string | null;
  action: string;
  target_type: string;
  target_id: number;
  request_meta: Record<string, any>;
  created_at: string;
}

export async function listAgentAuditLogs(): Promise<AgentAuditLogRow[]> {
  return apiRequest<AgentAuditLogRow[]>("/agent/audit-logs");
}

export async function updateUserProfile(payload: {
  nickname?: string;
  bio?: string;
  avatar?: string;
  workProfile?: Record<string, any>;
}) {
  return apiRequest<any>("/settings/profile", {
    method: "PUT",
    body: payload,
  });
}
