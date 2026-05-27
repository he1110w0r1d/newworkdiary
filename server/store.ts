import { initialDiaryEntries, initialTodos } from "../src/data/mockData";
import type { DiaryEntry, ModelServiceConfig, ThemeName, TodoItem } from "../src/types";

export type ShareVisibility = "link" | "private" | "public";

type ShareSettings = {
  generated: boolean;
  visibility: ShareVisibility;
};

let diaries: DiaryEntry[] = [...initialDiaryEntries];
let todos: TodoItem[] = [...initialTodos];
let theme: ThemeName = "草莓薄荷";
let share: ShareSettings = {
  generated: false,
  visibility: "link",
};
let modelConfig: ModelServiceConfig = {
  provider: "OpenAI Compatible",
  baseUrl: "http://localhost:11434/v1",
  llmProvider: "OpenAI Compatible",
  llmBaseUrl: "http://localhost:11434/v1",
  chatModel: "llama3.1",
  embeddingProvider: "OpenAI Compatible",
  embeddingBaseUrl: "http://localhost:11434/v1",
  embeddingModel: "text-embedding-3-small",
  timeoutSeconds: 60,
};

export function getSnapshot() {
  return {
    diaries,
    todos,
    theme,
    share,
  };
}

export function createDiary(payload: Omit<DiaryEntry, "id">) {
  const diary: DiaryEntry = {
    ...payload,
    id: Date.now(),
  };
  diaries = [diary, ...diaries];
  return diary;
}

export function createTodo(payload: Omit<TodoItem, "id">) {
  const todo: TodoItem = {
    ...payload,
    id: Date.now(),
  };
  todos = [todo, ...todos];
  return todo;
}

export function updateTodo(id: number, patch: Partial<TodoItem>) {
  const existing = todos.find((todo) => todo.id === id);
  if (!existing) return null;

  const updated = {
    ...existing,
    ...patch,
    id,
  };
  todos = todos.map((todo) => (todo.id === id ? updated : todo));
  return updated;
}

export function deleteTodo(id: number) {
  const existing = todos.find((todo) => todo.id === id);
  if (!existing) return null;

  todos = todos.filter((todo) => todo.id !== id);
  return existing;
}

export function updateTheme(nextTheme: ThemeName) {
  theme = nextTheme;
}

export function updateShareSettings(nextShare: ShareSettings) {
  share = nextShare;
}

export function getModelConfig() {
  return modelConfig;
}

export function updateModelConfig(nextConfig: ModelServiceConfig) {
  modelConfig = nextConfig;
  return modelConfig;
}

export function resetStore() {
  diaries = [...initialDiaryEntries];
  todos = [...initialTodos];
  theme = "草莓薄荷";
  share = {
    generated: false,
    visibility: "link",
  };
  modelConfig = {
    provider: "OpenAI Compatible",
    baseUrl: "http://localhost:11434/v1",
    llmProvider: "OpenAI Compatible",
    llmBaseUrl: "http://localhost:11434/v1",
    chatModel: "llama3.1",
    embeddingProvider: "OpenAI Compatible",
    embeddingBaseUrl: "http://localhost:11434/v1",
    embeddingModel: "text-embedding-3-small",
    timeoutSeconds: 60,
  };
  return getSnapshot();
}
