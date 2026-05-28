import type React from "react";

export type ViewKey =
  | "dashboard"
  | "diary"
  | "missions"
  | "todos"
  | "ai"
  | "share"
  | "agent"
  | "admin"
  | "settings";

export type ThemeName = "草莓薄荷" | "理性机能" | "专业办公" | "宋韵文房" | "黑白系统";

export type DiaryEntry = {
  id: number;
  time: string;
  title: string;
  source: "human" | "agent";
  summary: string;
  tags: string[];
};

export type TodoItem = {
  id: number;
  text: string;
  done: boolean;
  missionId?: number | null;
  missionTitle?: string | null;
};

export type ModelServiceConfig = {
  provider: string;
  baseUrl: string;
  llmProvider?: string;
  llmBaseUrl?: string;
  chatModel: string;
  llmApiKey?: string;
  embeddingProvider?: string;
  embeddingBaseUrl?: string;
  embeddingModel: string;
  embeddingApiKey?: string;
  timeoutSeconds: number;
  apiKey?: string;
};

export type SearchResult = {
  id: string;
  title: string;
  description: string;
  type: string;
  target: ViewKey;
};

export type StatItem = {
  label: string;
  value: string;
  icon: React.ElementType;
};

export type Mission = {
  id?: number;
  parentId?: number | null;
  parentTitle?: string;
  title: string;
  progress: number;
  tone: "main" | "side";
  status: string;
  summary: string;
  tags?: string[];
  aiReason?: string;
};

export type MissionNode = {
  id?: number;
  timelineId?: number;
  missionTitle?: string;
  time: string;
  title: string;
  status: string;
  source: string;
  summary?: string;
};

export type User = {
  id: number;
  username: string;
  role?: "user" | "admin";
  status?: "active" | "disabled";
  nickname: string | null;
  bio: string | null;
  avatar: string | null;
  workProfile?: Record<string, any>;
};
