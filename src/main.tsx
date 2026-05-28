import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactDOM from "react-dom/client";
import { toPng } from "html-to-image";
import QRCode from "qrcode";
import {
  Bell,
  Bot,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Database,
  Download,
  Flag,
  Heart,
  Home,
  Image,
  KeyRound,
  Leaf,
  Link,
  Lock,
  MessageSquareText,
  Moon,
  PenLine,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  Sparkles,
  Star,
  TerminalSquare,
  RefreshCw,
  Trash2,
  Upload,
  Users,
  WandSparkles,
  X,
} from "lucide-react";
import {
  initialDiaryEntries,
  initialTodos,
} from "./data/mockData";
import { usePersistentState } from "./hooks/usePersistentState";
import { STORAGE_KEYS } from "./lib/storageKeys";
import { API_BASE_URL, ApiError, apiRequest } from "./lib/apiClient";
import {
  createAgentApiKey,
  createDiary,
  completeMission,
  createShareCard,
  createTodo,
  type AgentApiKeyResponse,
  deleteDiary,
  deleteTodo,
  exportBackup,
  getLatestShareCard,
  getModelConfig,
  getPublicShareCard,
  getWorkDiarySnapshot,
  listMissions,
  listTrashDiaries,
  listTodoStatusHistory,
  listAgentApiKeys,
  permanentlyDeleteDiary,
  previewRestoreBackup,
  requestAgentReview,
  regenerateMissions,
  restoreDiary,
  revokeAgentApiKey,
  type AgentApiKeyListItem,
  type RestoreApplyResponse,
  type RestorePreviewResponse,
  type ShareCardResponse,
  type ShareExpiryPreset,
  type TodoStatusHistoryItem,
  updateTodoStatus,
  updateDiary,
  updateModelConfig,
  updateTodoText,
  applyRestoreBackup,
  createFeedback,
  getAdminOverview,
  listAdminAuditLogs,
  listAdminFeedbacks,
  listAdminUsers,
  updateUserProfile,
  listAgentAuditLogs,
  type AgentAuditLogRow,
  type AdminOverviewResponse,
  type AdminUserListItem,
  type FeedbackItem,
  type FeedbackStatus,
  type FeedbackType,
  type ModelConnectionTestResponse,
  testModelConnection,
  updateAdminFeedback,
} from "./repositories/workDiaryRepository";
import "./styles.css";
import type { DiaryEntry, Mission, MissionNode, ModelServiceConfig, SearchResult, StatItem, ThemeName, TodoItem, ViewKey, User } from "./types";

function Root() {
  const shareToken = getShareTokenFromPath();

  if (shareToken) {
    return <PublicSharePage token={shareToken} />;
  }

  return <App />;
}

function getShareTokenFromPath() {
  const match = window.location.pathname.match(/^\/share\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function App() {
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const saved = localStorage.getItem("wd_user");
    try {
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const confettiCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);

  const [entries, setEntries] = usePersistentState<DiaryEntry[]>(
    STORAGE_KEYS.diaries,
    initialDiaryEntries,
  );
  const [trashEntries, setTrashEntries] = useState<DiaryEntry[]>([]);
  const [todoItems, setTodoItems] = usePersistentState<TodoItem[]>(STORAGE_KEYS.todos, initialTodos);
  const [missionItems, setMissionItems] = useState<Mission[]>([]);
  const [missionTimelineNodes, setMissionTimelineNodes] = useState<MissionNode[]>([]);
  const [activeView, setActiveView] = useState<ViewKey>("dashboard");
  const [diaryFilter, setDiaryFilter] = useState<"all" | "human" | "agent">("all");
  const [diaryMode, setDiaryMode] = useState<"active" | "trash">("active");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTheme, setSelectedTheme] = usePersistentState<ThemeName>(
    STORAGE_KEYS.theme,
    "草莓薄荷",
  );
  const [isComposerOpen, setComposerOpen] = useState(false);
  const [pendingTodoChange, setPendingTodoChange] = useState<{
    todo: TodoItem;
    nextDone: boolean;
  } | null>(null);
  const [editingDiary, setEditingDiary] = useState<DiaryEntry | null>(null);
  const [shareGenerated, setShareGenerated] = usePersistentState(STORAGE_KEYS.shareGenerated, false);
  const [shareVisibility, setShareVisibility] = usePersistentState<"link" | "private" | "public">(
    STORAGE_KEYS.shareVisibility,
    "link",
  );
  const [shareCard, setShareCard] = useState<ShareCardResponse | null>(null);
  const [agentConnectionCount, setAgentConnectionCount] = useState(0);
  const [modelConfig, setModelConfig] = useState<ModelServiceConfig>({
    provider: "OpenAI Compatible",
    baseUrl: "http://localhost:11434/v1",
    llmProvider: "OpenAI Compatible",
    llmBaseUrl: "http://localhost:11434/v1",
    chatModel: "llama3.1",
    embeddingProvider: "OpenAI Compatible",
    embeddingBaseUrl: "http://localhost:11434/v1",
    embeddingModel: "text-embedding-3-small",
    timeoutSeconds: 60,
  });
  const [quickTodo, setQuickTodo] = useState("把分享卡片导出成 PNG");
  const [reward, setReward] = useState("今天也认真发光");
  const [draft, setDraft] = useState({
    title: "",
    summary: "",
    tags: "",
  });

  // 获取当前登录用户，如果鉴权失败则会抛出 401 触发全局事件弹出登录框
  async function loadUser() {
    try {
      const user = await apiRequest<User>("/auth/me");
      setCurrentUser(user);
      localStorage.setItem("wd_user", JSON.stringify(user));
      
      // 加载其他用户专属数据
      void loadSnapshot();
      void loadMissions();
      void loadLatestShareCard();
      void loadModelConfig();
      void loadAgentConnectionCount();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setShowAuthModal(true);
      } else {
        // 其他网络错误或服务不可用，降级读取本地/默认数据
        void loadSnapshot();
        void loadMissions();
        void loadLatestShareCard();
        void loadModelConfig();
        void loadAgentConnectionCount();
      }
    }
  }

  useEffect(() => {
    void loadUser();
  }, []);

  // 监听全局 401 unauthorized 事件
  useEffect(() => {
    const handleUnauthorized = () => {
      localStorage.removeItem("wd_auth_token");
      localStorage.removeItem("wd_user");
      setCurrentUser(null);
      setShowAuthModal(true);
    };
    window.addEventListener("unauthorized", handleUnauthorized);
    return () => {
      window.removeEventListener("unauthorized", handleUnauthorized);
    };
  }, []);

  async function loadSnapshot() {
    try {
      const snapshot = await getWorkDiarySnapshot();
      setEntries(snapshot.diaries);
      setTodoItems(snapshot.todos);
      setSelectedTheme(snapshot.theme);
      setShareGenerated(snapshot.share.generated);
      setShareVisibility(snapshot.share.visibility);
      setTrashEntries(await listTrashDiaries());
    } catch {
      // Keep local persisted MVP data when the API is unavailable.
    }
  }

  async function loadMissions() {
    try {
      const plan = await listMissions();
      setMissionItems(plan.missions);
      setMissionTimelineNodes(plan.nodes);
    } catch {
      // Keep bundled mission examples when the API is unavailable.
    }
  }

  async function loadLatestShareCard() {
    try {
      setShareCard(await getLatestShareCard());
    } catch {
      // Keep the local preview when share card API is unavailable.
    }
  }

  async function loadModelConfig() {
    try {
      setModelConfig(await getModelConfig());
    } catch {
      // Keep bundled defaults when model config API is unavailable.
    }
  }

  async function loadAgentConnectionCount() {
    try {
      const keys = await listAgentApiKeys();
      const now = Date.now();
      const activeAgentIds = new Set(
        keys
          .filter((key) => !key.expires_at || new Date(key.expires_at).getTime() > now)
          .map((key) => key.agent_id ?? `key-${key.id}`),
      );
      setAgentConnectionCount(activeAgentIds.size);
    } catch {
      setAgentConnectionCount(0);
    }
  }

  const stats = useMemo(() => {
    const humanCount = entries.filter((entry) => entry.source === "human").length;
    const agentCount = entries.filter((entry) => entry.source === "agent").length;
    const openTodos = todoItems.filter((todo) => !todo.done).length;

    return [
      { label: "今日专注", value: `${(4.8 + entries.length * 0.35).toFixed(1)}h`, icon: Clock3 },
      { label: "人类日记", value: String(humanCount), icon: MessageSquareText },
      { label: "Agent 日记", value: String(agentCount), icon: Bot },
      { label: "待办小任务", value: String(openTodos), icon: ClipboardList },
    ];
  }, [entries, todoItems]);

  const searchResults = useMemo(() => {
    const keyword = searchQuery.trim().toLowerCase();
    if (!keyword) return [];

    const diaryResults: SearchResult[] = entries
      .filter((entry) =>
        [entry.title, entry.summary, entry.source, ...entry.tags]
          .join(" ")
          .toLowerCase()
          .includes(keyword),
      )
      .map((entry) => ({
        id: `diary-${entry.id}`,
        title: entry.title,
        description: `${entry.time} · ${entry.source === "human" ? "人类记录" : "Agent 回顾"} · ${entry.summary}`,
        type: "日记",
        target: "diary",
      }));

    const todoResults: SearchResult[] = todoItems
      .filter((todo) => todo.text.toLowerCase().includes(keyword))
      .map((todo) => ({
        id: `todo-${todo.id}`,
        title: todo.text,
        description: todo.done ? "已完成的小目标" : "开放中的小目标",
        type: "待办",
        target: "todos",
      }));

    const missionResults: SearchResult[] = missionItems
      .filter((mission) => [mission.title, mission.summary, mission.status].join(" ").toLowerCase().includes(keyword))
      .map((mission) => ({
        id: `mission-${mission.title}`,
        title: mission.title,
        description: `${mission.status} · 进度 ${mission.progress}%`,
        type: "任务线",
        target: "missions",
      }));

    const staticItems: SearchResult[] = [
      {
        id: "agent-key",
        title: "Agent Key 接入",
        description: "查看 API Key、Agent 身份和 Skill 使用说明",
        type: "Agent",
        target: "agent",
      },
      {
        id: "share-card",
        title: "朋友圈分享卡片",
        description: "生成带二维码的分享卡片并设置隐私范围",
        type: "分享",
        target: "share",
      },
      {
        id: "settings-db",
        title: "PostgreSQL + pgvector",
        description: "查看单数据库部署状态和备份恢复入口",
        type: "设置",
        target: "settings",
      },
    ];
    const staticResults = staticItems.filter((item) =>
      [item.title, item.description, item.type].join(" ").toLowerCase().includes(keyword),
    );

    return [...diaryResults, ...todoResults, ...missionResults, ...staticResults].slice(0, 8);
  }, [entries, missionItems, searchQuery, todoItems]);

  function getCurrentTime() {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date());
  }

  async function addHumanDiary() {
    const title = draft.title.trim();
    const summary = draft.summary.trim();
    if (!title || !summary) return;

    try {
      const diary = await createDiary({
        time: getCurrentTime(),
        title,
        source: "human",
        summary,
        tags: draft.tags
          .split(/[,，]/)
          .map((tag) => tag.trim())
          .filter(Boolean)
          .slice(0, 6),
      });

      setEntries((current) => [diary, ...current]);
      await loadSnapshot();
      setReward("+8 小花值，日记已写入");
      setDraft({ title: "", summary: "", tags: "" });
      setComposerOpen(false);
    } catch (error) {
      setReward(error instanceof Error ? error.message : "日记写入失败");
    }
  }

  async function runAgentReview() {
    try {
      const { diary, todo } = await requestAgentReview();
      setEntries((current) => [diary, ...current]);
      setTodoItems((current) => [todo, ...current]);
      await loadSnapshot();
      await loadMissions();
      setReward("+12 小花值，Agent 已完成回顾");
    } catch (error) {
      setReward(error instanceof Error ? error.message : "Agent 回顾写入失败");
    }
  }

  function requestTodoToggle(id: number) {
    const todo = todoItems.find((item) => item.id === id);
    if (!todo) return;
    setPendingTodoChange({
      todo,
      nextDone: !todo.done,
    });
  }

  async function confirmTodoChange(reason: string) {
    if (!pendingTodoChange) return;
    const { todo, nextDone } = pendingTodoChange;

    const updated = await updateTodoStatus(todo.id, nextDone, reason);
    setTodoItems((current) => current.map((item) => (item.id === todo.id ? updated : item)));
    void loadSnapshot();
    if (nextDone) {
      triggerConfetti();
      setReward("🎉 小目标完成啦！奖励一朵小红花 🌸");
    } else {
      setReward("小目标已重新打开");
    }
    setPendingTodoChange(null);
  }

  function triggerConfetti() {
    const canvas = confettiCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const colors = ["#ff597b", "#38bdf8", "#22c55e", "#f59e0b", "#a855f7", "#ec4899"];
    const particles: Array<{
      x: number;
      y: number;
      size: number;
      color: string;
      speedX: number;
      speedY: number;
      rotation: number;
      rotationSpeed: number;
      shape: "circle" | "square" | "triangle";
    }> = [];

    const particleCount = 80;

    for (let i = 0; i < particleCount; i++) {
      const isLeft = Math.random() > 0.5;
      particles.push({
        x: isLeft ? 0 : canvas.width,
        y: canvas.height * 0.8,
        size: Math.random() * 8 + 6,
        color: colors[Math.floor(Math.random() * colors.length)],
        speedX: (isLeft ? 1 : -1) * (Math.random() * 12 + 8),
        speedY: -(Math.random() * 18 + 12),
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 8,
        shape: ["circle", "square", "triangle"][Math.floor(Math.random() * 3)] as any,
      });
    }

    const gravity = 0.45;
    const friction = 0.985;

    function update() {
      if (!ctx || !canvas) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let alive = false;
      for (const p of particles) {
        p.speedX *= friction;
        p.speedY += gravity;
        p.x += p.speedX;
        p.y += p.speedY;
        p.rotation += p.rotationSpeed;

        if (p.y < canvas.height && p.x > -50 && p.x < canvas.width + 50) {
          alive = true;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate((p.rotation * Math.PI) / 180);
          ctx.fillStyle = p.color;

          if (p.shape === "circle") {
            ctx.beginPath();
            ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
            ctx.fill();
          } else if (p.shape === "square") {
            ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
          } else {
            ctx.beginPath();
            ctx.moveTo(0, -p.size / 2);
            ctx.lineTo(p.size / 2, p.size / 2);
            ctx.lineTo(-p.size / 2, p.size / 2);
            ctx.closePath();
            ctx.fill();
          }
          ctx.restore();
        }
      }

      if (alive) {
        requestAnimationFrame(update);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }

    update();
  }

  async function handleUpdateProfile(payload: {
    nickname?: string;
    bio?: string;
    avatar?: string;
    workProfile?: Record<string, any>;
  }) {
    try {
      const updated = await updateUserProfile(payload);
      if (currentUser) {
        const newUser: User = {
          ...currentUser,
          nickname: updated.nickname,
          bio: updated.bio,
          avatar: updated.avatar,
          workProfile: updated.workProfile,
        };
        setCurrentUser(newUser);
        localStorage.setItem("wd_user", JSON.stringify(newUser));
        setReward("个人资料与工作画像已成功更新");
      }
    } catch (err) {
      setReward(err instanceof Error ? err.message : "更新个人资料失败");
    }
  }

  async function addQuickTodo() {
    const text = quickTodo.trim();
    if (!text) return;

    try {
      const todo = await createTodo({ text, done: false });
      setTodoItems((current) => [todo, ...current]);
      await loadSnapshot();
      setQuickTodo("");
      setReward("+3 小花值，新增小目标");
    } catch (error) {
      setReward(error instanceof Error ? error.message : "待办写入失败");
    }
  }

  async function handleUpdateTodoText(id: number, text: string) {
    const finalText = text.trim();
    if (!finalText) {
      setReward("待办内容不能为空");
      return;
    }

    try {
      const updated = await updateTodoText(id, finalText);
      setTodoItems((current) => current.map((todo) => (todo.id === id ? updated : todo)));
      await loadSnapshot();
      setReward("待办已更新");
    } catch (error) {
      setReward(error instanceof Error ? error.message : "待办更新失败");
    }
  }

  async function handleDeleteTodo(id: number) {
    try {
      await deleteTodo(id);
      setTodoItems((current) => current.filter((todo) => todo.id !== id));
      await loadSnapshot();
      setReward("待办已删除");
    } catch (error) {
      setReward(error instanceof Error ? error.message : "待办删除失败");
    }
  }

  async function handleRegenerateMissions() {
    try {
      const plan = await regenerateMissions();
      setMissionItems(plan.missions);
      setMissionTimelineNodes(plan.nodes);
      setReward("任务线已重新整理");
    } catch (error) {
      setReward(error instanceof Error ? error.message : "任务线整理失败");
    }
  }

  async function handleCompleteMission(id: number) {
    try {
      await completeMission(id);
      await loadMissions();
      setReward("任务线已标记完成");
    } catch (error) {
      setReward(error instanceof Error ? error.message : "任务线完成失败");
    }
  }

  async function handleGenerateShareCard(expiry: ShareExpiryPreset = "never") {
    try {
      const card = await createShareCard(shareVisibility, expiry);
      setShareCard(card);
      setShareGenerated(true);
      await loadSnapshot();
      triggerConfetti();
      setReward("朋友圈卡片已经生成");
    } catch (error) {
      setReward(error instanceof Error ? error.message : "分享卡片生成失败");
    }
  }

  async function handleSaveModelConfig(config: ModelServiceConfig) {
    try {
      const saved = await updateModelConfig(config);
      setModelConfig(saved);
      setReward("模型服务配置已保存");
    } catch (error) {
      setReward(error instanceof Error ? error.message : "模型服务配置保存失败");
    }
  }

  async function handleExportBackup() {
    try {
      const backup = await exportBackup();
      const content = JSON.stringify(backup, null, 2);
      const blob = new Blob([content], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `zuoyeben-backup-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setReward("备份 JSON 已导出");
    } catch (error) {
      setReward(error instanceof Error ? error.message : "备份导出失败");
    }
  }

  async function handlePreviewRestore(file: File) {
    try {
      const text = await file.text();
      const backup = JSON.parse(text) as unknown;
      const preview = await previewRestoreBackup(backup);
      setReward(preview.valid ? "恢复预检通过" : "恢复预检发现问题");
      return preview;
    } catch (error) {
      setReward(error instanceof Error ? error.message : "恢复预检失败");
      throw error;
    }
  }

  async function handleApplyRestore(backup: unknown, strategy: RestoreApplyResponse["strategy"]) {
    try {
      const result = await applyRestoreBackup(backup, strategy);
      await loadSnapshot();
      await loadMissions();
      await loadModelConfig();
      setReward(
        `恢复完成：新增 ${result.summary.diaries.created} 条日记、更新 ${result.summary.diaries.updated} 条日记`,
      );
      return result;
    } catch (error) {
      setReward(error instanceof Error ? error.message : "正式恢复失败");
      throw error;
    }
  }

  function resetDemoData() {
    setEntries(initialDiaryEntries);
    setTrashEntries([]);
    setTodoItems(initialTodos);
    setShareGenerated(false);
    setShareVisibility("link");
    setSelectedTheme("草莓薄荷");
    setReward("演示数据已重置");
  }

  function handleLoginSuccess(token: string, user: typeof currentUser) {
    localStorage.setItem("wd_auth_token", token);
    localStorage.setItem("wd_user", JSON.stringify(user));
    setCurrentUser(user);
    setShowAuthModal(false);
    
    // 重新加载快照等数据
    void loadSnapshot();
    void loadMissions();
    void loadLatestShareCard();
    void loadModelConfig();
    void loadAgentConnectionCount();
    setReward(`欢迎回来，${user?.nickname || user?.username}`);
  }

  function handleLogout() {
    localStorage.removeItem("wd_auth_token");
    localStorage.removeItem("wd_user");
    setCurrentUser(null);
    resetDemoData();
    setShowAuthModal(true);
    setReward("已退出登录");
  }

  async function handleDeleteDiary(id: number) {
    await deleteDiary(id);
    await loadSnapshot();
    setReward("日记已移入回收站");
  }

  async function handleRestoreDiary(id: number) {
    await restoreDiary(id);
    await loadSnapshot();
    setReward("日记已还原");
  }

  async function handlePermanentDeleteDiary(id: number) {
    await permanentlyDeleteDiary(id);
    await loadSnapshot();
    setReward("日记已彻底删除");
  }

  async function handleClearTrash() {
    if (trashEntries.length === 0) return;
    const confirmed = window.confirm(`确定要彻底删除回收站中的 ${trashEntries.length} 条日记吗？这个操作不可恢复。`);
    if (!confirmed) return;

    await Promise.all(trashEntries.map((entry) => permanentlyDeleteDiary(entry.id)));
    await loadSnapshot();
    setDiaryMode("active");
    setReward("回收站已清空");
  }

  async function handleUpdateDiary(id: number, patch: Partial<Omit<DiaryEntry, "id">>) {
    const updated = await updateDiary(id, patch);
    setEntries((current) => current.map((entry) => (entry.id === id ? updated : entry)));
    await loadSnapshot();
    setEditingDiary(null);
    setReward("日记已更新");
  }

  const filteredEntries = entries.filter((entry) => diaryFilter === "all" || entry.source === diaryFilter);

  return (
    <main className="app-shell" data-theme={themeToKey(selectedTheme)}>
      <canvas id="confetti-canvas" ref={confettiCanvasRef} />
      <Sidebar activeView={activeView} currentUser={currentUser} onChangeView={setActiveView} />
      <section className="workspace">
        <Topbar
          query={searchQuery}
          setQuery={setSearchQuery}
          results={searchResults}
          onOpenResult={(target) => {
            setActiveView(target);
            setSearchQuery("");
          }}
          currentUser={currentUser}
          agentConnectionCount={agentConnectionCount}
          onLogout={handleLogout}
          onLoginClick={() => setShowAuthModal(true)}
        />
        {activeView === "dashboard" && (
          <DashboardView
            entries={entries}
            stats={stats}
            todoItems={todoItems}
            reward={reward}
            shareGenerated={shareGenerated}
            shareCard={shareCard}
            onOpenComposer={() => setComposerOpen(true)}
            onRunAgentReview={runAgentReview}
            onToggleTodo={requestTodoToggle}
            onGenerateShare={() => {
              void handleGenerateShareCard();
            }}
            missions={missionItems}
          />
        )}
        {activeView === "diary" && (
          <DiaryView
            entries={filteredEntries}
            trashEntries={trashEntries}
            filter={diaryFilter}
            setFilter={setDiaryFilter}
            mode={diaryMode}
            setMode={setDiaryMode}
            onOpenComposer={() => setComposerOpen(true)}
            onRunAgentReview={runAgentReview}
            onEditDiary={setEditingDiary}
            onDeleteDiary={handleDeleteDiary}
            onRestoreDiary={handleRestoreDiary}
            onPermanentDeleteDiary={handlePermanentDeleteDiary}
            onClearTrash={handleClearTrash}
          />
        )}
        {activeView === "agent" && <AgentKeyView onAgentKeysChanged={loadAgentConnectionCount} />}
        {activeView === "admin" && currentUser?.role === "admin" && <AdminView />}
        {activeView === "todos" && (
          <TodosView
            todoItems={todoItems}
            missions={missionItems}
            quickTodo={quickTodo}
            setQuickTodo={setQuickTodo}
            onAddTodo={addQuickTodo}
            onToggleTodo={requestTodoToggle}
            onUpdateTodo={handleUpdateTodoText}
            onDeleteTodo={handleDeleteTodo}
          />
        )}
        {activeView === "share" && (
          <ShareView
            entries={entries}
            shareGenerated={shareGenerated}
            shareCard={shareCard}
            shareVisibility={shareVisibility}
            setShareVisibility={setShareVisibility}
            onGenerateShare={handleGenerateShareCard}
          />
        )}
        {activeView === "missions" && (
          <MissionsView
            missions={missionItems}
            missionNodes={missionTimelineNodes}
            todoItems={todoItems}
            entries={entries}
            onOpenDiaryEvidence={(entry) => {
              setDiaryFilter("all");
              setDiaryMode("active");
              setSearchQuery(entry.title);
              setActiveView("diary");
            }}
            onRegenerateMissions={handleRegenerateMissions}
            onCompleteMission={handleCompleteMission}
          />
        )}
        {activeView === "ai" && (
          <AIReviewView
            entries={entries}
            todoItems={todoItems}
            onRefreshData={loadSnapshot}
          />
        )}
        {activeView === "settings" && (
          <SettingsView
            currentUser={currentUser}
            onUpdateProfile={handleUpdateProfile}
            selectedTheme={selectedTheme}
            setSelectedTheme={setSelectedTheme}
            onResetDemoData={resetDemoData}
            modelConfig={modelConfig}
            onSaveModelConfig={handleSaveModelConfig}
            onExportBackup={handleExportBackup}
            onPreviewRestore={handlePreviewRestore}
            onApplyRestore={handleApplyRestore}
          />
        )}
        {activeView !== "dashboard" &&
          activeView !== "diary" &&
          activeView !== "agent" &&
          activeView !== "admin" &&
          activeView !== "todos" &&
          activeView !== "share" &&
          activeView !== "missions" &&
          activeView !== "ai" &&
          activeView !== "settings" && (
          <PlaceholderView view={activeView} />
        )}
      </section>
      {isComposerOpen && (
        <DiaryComposer
          draft={draft}
          setDraft={setDraft}
          onClose={() => setComposerOpen(false)}
          onSubmit={addHumanDiary}
        />
      )}
      {pendingTodoChange && (
        <TodoReasonModal
          todo={pendingTodoChange.todo}
          nextDone={pendingTodoChange.nextDone}
          onClose={() => setPendingTodoChange(null)}
          onSubmit={confirmTodoChange}
        />
      )}
      {editingDiary && (
        <DiaryEditModal
          entry={editingDiary}
          onClose={() => setEditingDiary(null)}
          onSubmit={handleUpdateDiary}
        />
      )}
      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onLoginSuccess={handleLoginSuccess}
          allowClose={currentUser !== null}
        />
      )}
    </main>
  );
}

function DashboardView({
  entries,
  stats,
  todoItems,
  reward,
  shareGenerated,
  shareCard,
  onOpenComposer,
  onRunAgentReview,
  onToggleTodo,
  onGenerateShare,
  missions,
}: {
  entries: DiaryEntry[];
  stats: StatItem[];
  todoItems: TodoItem[];
  reward: string;
  shareGenerated: boolean;
  shareCard: ShareCardResponse | null;
  onOpenComposer: () => void;
  onRunAgentReview: () => void;
  onToggleTodo: (id: number) => void;
  onGenerateShare: () => void;
  missions: Mission[];
}) {
  return (
    <>
      <div className="hero-strip">
        <div>
          <p className="eyebrow">今日工作小花园</p>
          <h1>作业本</h1>
          <p className="hero-copy">
            记录你和 Agent 一起完成的每一步，把散落的努力整理成漂亮的工作轨迹。
          </p>
        </div>
        <div className="hero-actions">
          <button className="primary-btn" onClick={onOpenComposer}>
            <PenLine size={18} />
            写一条日记
          </button>
          <button className="soft-btn" onClick={onRunAgentReview}>
            <WandSparkles size={18} />
            让 Agent 回顾
          </button>
        </div>
        <div className="hero-notebook-card" aria-label="今日作业本摘要">
          <span>Today's Page</span>
          <strong>{entries.length} 条记录</strong>
          <p>{todoItems.filter((todo) => !todo.done).length} 个小目标待完成</p>
          <div className="mini-page-lines" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
        </div>
        <div className="floating-sticker sticker-one">{reward}</div>
        <div className="floating-sticker sticker-two">+12 小花值</div>
      </div>

      <StatsGrid stats={stats} />

      <div className="dashboard-grid">
        <section className="panel timeline-panel">
          <PanelTitle icon={<CalendarDays size={18} />} title="今日双线日记" action="日记流" />
          <div className="timeline-list">
            {entries.map((entry) => (
              <DiaryCard key={entry.id} entry={entry} />
            ))}
          </div>
        </section>

        <MissionPanel missions={missions} />
        <InsightPanel />
        <TodoPanel todoItems={todoItems} onToggleTodo={onToggleTodo} />
        <SharePreview
          entries={entries}
          shareGenerated={shareGenerated}
          shareCard={shareCard}
          onGenerateShare={onGenerateShare}
        />
      </div>
    </>
  );
}

function Sidebar({
  activeView,
  currentUser,
  onChangeView,
}: {
  activeView: ViewKey;
  currentUser: User | null;
  onChangeView: (view: ViewKey) => void;
}) {
  const navItems = [
    { icon: Home, label: "今日", view: "dashboard" },
    { icon: PenLine, label: "日记", view: "diary" },
    { icon: Star, label: "任务线", view: "missions" },
    { icon: ClipboardList, label: "待办", view: "todos" },
    { icon: Bot, label: "AI 回顾", view: "ai" },
    { icon: Image, label: "分享卡片", view: "share" },
    { icon: KeyRound, label: "Agent Key", view: "agent" },
    ...(currentUser?.role === "admin" ? [{ icon: ShieldCheck, label: "后台", view: "admin" }] : []),
    { icon: Settings, label: "设置", view: "settings" },
  ];

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <Leaf size={22} />
        </div>
        <div>
          <strong>作业本</strong>
          <span>Agent Work Diary</span>
        </div>
      </div>
      <nav>
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              className={activeView === item.view ? "nav-item active" : "nav-item"}
              key={item.label}
              onClick={() => onChangeView(item.view as ViewKey)}
            >
              <Icon size={18} />
              {item.label}
            </button>
          );
        })}
      </nav>
      <div className="sidebar-card">
        <Sparkles size={18} />
        <strong>草莓薄荷主题</strong>
        <p>少女感工作台已启用</p>
      </div>
    </aside>
  );
}

function Topbar({
  query,
  setQuery,
  results,
  onOpenResult,
  currentUser,
  agentConnectionCount,
  onLogout,
  onLoginClick,
}: {
  query: string;
  setQuery: (query: string) => void;
  results: SearchResult[];
  onOpenResult: (target: ViewKey) => void;
  currentUser: User | null;
  agentConnectionCount: number;
  onLogout: () => void;
  onLoginClick: () => void;
}) {
  const isSearching = query.trim().length > 0;
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const isDemo = !currentUser || currentUser.username === "demo";
  const userInitial = (currentUser?.nickname || currentUser?.username || "G").slice(0, 1);

  return (
    <header className="topbar">
      <div className="search-box">
        <Search size={18} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索日记、任务、Agent 回顾..."
        />
        {isSearching && (
          <div className="search-popover">
            {results.length > 0 ? (
              results.map((result) => (
                <button key={result.id} onClick={() => onOpenResult(result.target)}>
                  <span>{result.type}</span>
                  <strong>{result.title}</strong>
                  <p>{result.description}</p>
                </button>
              ))
            ) : (
              <div className="search-empty">
                <Sparkles size={18} />
                <strong>没有找到相关内容</strong>
                <p>换个关键词试试，比如 Agent、分享、PostgreSQL。</p>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="topbar-actions">
        <button className="icon-btn">
          <Moon size={18} />
        </button>
        <button className="agent-pill">
          <span />
          {agentConnectionCount} 个 Agent 已连接
        </button>
        <button className="icon-btn">
          <Bell size={18} />
        </button>
        {isDemo ? (
          <button className="soft-btn login-btn" onClick={onLoginClick} style={{ gap: "6px", height: "36px", borderRadius: "10px" }}>
            <Lock size={14} />
            登录 / 注册
          </button>
        ) : (
          <div className="user-dropdown-container" ref={dropdownRef}>
            <div className="avatar clickable" onClick={() => setDropdownOpen(!dropdownOpen)}>
              {userInitial}
            </div>
            {dropdownOpen && (
              <div className="user-dropdown">
                <div className="user-info-section">
                  <div className="avatar large">{userInitial}</div>
                  <div className="user-detail">
                    <strong>{currentUser?.nickname || currentUser?.username}</strong>
                    <span>@{currentUser?.username}</span>
                  </div>
                </div>
                <div className="dropdown-divider" />
                <button className="dropdown-item logout" onClick={() => { setDropdownOpen(false); onLogout(); }}>
                  退出登录
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}

function MissionPanel({ missions }: { missions: Mission[] }) {
  const mainMission = missions.find((mission) => mission.tone === "main") ?? missions[0];
  const sideMissions = missions;

  return (
    <section className="panel mission-panel">
      <PanelTitle icon={<Sparkles size={18} />} title="主线与支线任务" action="任务线" />
      {mainMission ? (
        <>
          <div className="mission-main">
            <div className="mission-badge">主线任务</div>
            <h2>{mainMission.title}</h2>
            <div className="progress-track">
              <span style={{ width: `${mainMission.progress}%` }} />
            </div>
            <p>{mainMission.summary}</p>
          </div>
          <div className="mission-list">
            {sideMissions.map((mission) => (
              <div className="mission-item" key={mission.id ?? mission.title}>
                <div>
                  <span className={mission.tone === "main" ? "dot dot-pink" : "dot dot-mint"} />
                  {mission.title}
                </div>
                <strong>{mission.progress}%</strong>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className="key-empty mission-empty">
          <Flag size={22} />
          <strong>暂无任务线</strong>
          <p>进入任务线页面，点击 AI 重新整理后会生成真实主线和支线。</p>
        </div>
      )}
    </section>
  );
}

function InsightPanel() {
  return (
    <section className="panel insight-panel">
      <PanelTitle icon={<Bot size={18} />} title="今日温柔总结" action="AI 摘要" />
      <p>
        今天的重点从 PRD 梳理转向体验落地，产品的情绪价值开始变清楚：
        它既能认真记录工作，也能把成果变成愿意分享的小卡片。
      </p>
      <div className="mini-chart" aria-label="工作分布图">
        <span className="bar bar-one" />
        <span className="bar bar-two" />
        <span className="bar bar-three" />
        <span className="bar bar-four" />
      </div>
    </section>
  );
}

function TodoPanel({
  todoItems,
  onToggleTodo,
}: {
  todoItems: TodoItem[];
  onToggleTodo: (id: number) => void;
}) {
  return (
    <section className="panel todo-panel">
      <PanelTitle icon={<ClipboardList size={18} />} title="小目标清单" action="待办同步" />
      <div className="todo-list">
        {todoItems.map((todo) => (
          <label className={todo.done ? "todo-row done" : "todo-row"} key={todo.id}>
            <input type="checkbox" checked={todo.done} onChange={() => onToggleTodo(todo.id)} />
            <span className={todo.done ? "checkbox checked" : "checkbox"}>
              {todo.done && <CheckCircle2 size={16} />}
            </span>
            <span>{todo.text}</span>
          </label>
        ))}
      </div>
    </section>
  );
}

function SharePreview({
  entries,
  shareGenerated,
  shareCard,
  onGenerateShare,
}: {
  entries: DiaryEntry[];
  shareGenerated: boolean;
  shareCard: ShareCardResponse | null;
  onGenerateShare: () => void;
}) {
  return (
    <section className="share-card">
      <div className="share-inner">
        <div className="share-topline">
          <Heart size={16} />
          {shareGenerated ? "卡片已生成" : "今日分享卡片"}
        </div>
        <h2>今天也认真发光了</h2>
        <p>
          {entries.length} 条日记 · {entries.filter((entry) => entry.source === "agent").length} 个
          Agent 回顾 · 主线推进 72%
        </p>
        <div className="qr-wrap">
          {shareCard ? <ShareQr value={shareCard.shareUrl} /> : <div className="fake-qr" />}
          <span>{shareCard ? "扫码查看我的工作小花园" : "生成后显示分享二维码"}</span>
        </div>
        <button onClick={onGenerateShare}>
          <Share2 size={16} />
          {shareGenerated ? "重新生成卡片" : "生成朋友圈卡片"}
        </button>
      </div>
    </section>
  );
}

function DiaryView({
  entries,
  trashEntries,
  filter,
  setFilter,
  mode,
  setMode,
  onOpenComposer,
  onRunAgentReview,
  onEditDiary,
  onDeleteDiary,
  onRestoreDiary,
  onPermanentDeleteDiary,
  onClearTrash,
}: {
  entries: DiaryEntry[];
  trashEntries: DiaryEntry[];
  filter: "all" | "human" | "agent";
  setFilter: (filter: "all" | "human" | "agent") => void;
  mode: "active" | "trash";
  setMode: (mode: "active" | "trash") => void;
  onOpenComposer: () => void;
  onRunAgentReview: () => void;
  onEditDiary: (entry: DiaryEntry) => void;
  onDeleteDiary: (id: number) => Promise<void>;
  onRestoreDiary: (id: number) => Promise<void>;
  onPermanentDeleteDiary: (id: number) => Promise<void>;
  onClearTrash: () => Promise<void>;
}) {
  const visibleEntries = (mode === "active" ? entries : trashEntries).filter(
    (entry) => filter === "all" || entry.source === filter,
  );

  function handleFilterChange(nextFilter: "all" | "human" | "agent") {
    setFilter(nextFilter);
    setMode("active");
  }

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="Diary Garden"
        title="日记管理"
        copy="把人类主动记录和 Agent 自动回顾放在同一个工作本里，按来源快速筛选。"
      >
        <button className="primary-btn" onClick={onOpenComposer}>
          <Plus size={18} />
          新增日记
        </button>
        <button className="soft-btn" onClick={onRunAgentReview}>
          <Bot size={18} />
          Agent 回顾
        </button>
      </PageHeader>
      <div className="diary-toolbar">
        <div className="segment-control" aria-label="日记来源筛选">
          {[
            { label: "全部", value: "all" },
            { label: "人类记录", value: "human" },
            { label: "Agent 回顾", value: "agent" },
          ].map((item) => (
            <button
              className={filter === item.value && mode === "active" ? "active" : ""}
              key={item.value}
              onClick={() => handleFilterChange(item.value as "all" | "human" | "agent")}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="trash-tools">
          <button
            className={mode === "trash" ? "trash-mode-btn active" : "trash-mode-btn"}
            onClick={() => setMode(mode === "trash" ? "active" : "trash")}
          >
            <Trash2 size={16} />
            回收站 {trashEntries.length}
          </button>
          {mode === "trash" && trashEntries.length > 0 && (
            <button className="trash-clear-btn" onClick={() => void onClearTrash()}>
              清空回收站
            </button>
          )}
        </div>
      </div>
      <div className={mode === "trash" ? "diary-mode-banner trash" : "diary-mode-banner"}>
        <span>{mode === "trash" ? "当前查看：回收站" : "当前查看：正常日记"}</span>
        <strong>
          {mode === "trash"
            ? "这里的日记可还原或彻底删除"
            : filter === "all"
              ? "显示全部来源"
              : filter === "human"
                ? "仅显示人类主动记录"
                : "仅显示 Agent 自动回顾"}
        </strong>
      </div>
      <section className="panel">
        <div className="timeline-list diary-page-list">
          {visibleEntries.length > 0 ? (
            visibleEntries.map((entry) => (
              <DiaryCard
                key={entry.id}
                entry={entry}
                mode={mode}
                onEdit={onEditDiary}
                onDelete={onDeleteDiary}
                onRestore={onRestoreDiary}
                onPermanentDelete={onPermanentDeleteDiary}
              />
            ))
          ) : (
            <div className="key-empty diary-empty">
              <Trash2 size={22} />
              <p>{mode === "trash" ? "回收站是空的。" : "还没有符合条件的日记。"}</p>
            </div>
          )}
        </div>
      </section>
    </section>
  );
}

function AgentKeyView({ onAgentKeysChanged }: { onAgentKeysChanged?: () => void | Promise<void> }) {
  const scopeOptions = [
    { value: "diary:read", label: "读日记", desc: "读取最近日记和上下文" },
    { value: "diary:write", label: "写日记", desc: "创建、更新、删除日记" },
    { value: "todo:read", label: "读待办", desc: "读取待办列表" },
    { value: "todo:write", label: "写待办", desc: "创建、更新、删除待办" },
    { value: "timeline:read", label: "读任务线", desc: "读取主线和支线任务" },
    { value: "timeline:write", label: "写任务线", desc: "创建任务线节点" },
    { value: "summary:read", label: "读总结", desc: "读取 AI 周期总结" },
    { value: "share:write", label: "生成分享", desc: "创建脱敏分享卡片" },
    { value: "agent:read", label: "读身份", desc: "读取当前 Agent 资料" },
    { value: "agent:write", label: "改身份", desc: "更新 Agent 名称和描述" },
  ];
  const [generatedKey, setGeneratedKey] = useState<AgentApiKeyResponse | null>(null);
  const [agentKeys, setAgentKeys] = useState<AgentApiKeyListItem[]>([]);
  const [agentName, setAgentName] = useState("Codex 工作助手");
  const [keyExpiryPreset, setKeyExpiryPreset] = useState<"never" | "7d" | "30d" | "90d">("30d");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(scopeOptions.map((scope) => scope.value));
  const [isCreating, setIsCreating] = useState(false);
  const [isLoadingKeys, setIsLoadingKeys] = useState(false);
  const [error, setError] = useState("");
  const [skillActionMessage, setSkillActionMessage] = useState("");
  const skillText = buildAgentSkillDoc(generatedKey?.rawKey, generatedKey?.scopes ?? selectedScopes);

  const [auditLogs, setAuditLogs] = useState<AgentAuditLogRow[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);

  useEffect(() => {
    void refreshKeys();
    void refreshAuditLogs();
  }, []);

  async function refreshKeys() {
    setIsLoadingKeys(true);
    setError("");

    try {
      setAgentKeys(await listAgentApiKeys());
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "加载 API Key 失败");
    } finally {
      setIsLoadingKeys(false);
    }
  }

  async function refreshAuditLogs() {
    setIsLoadingLogs(true);
    try {
      setAuditLogs(await listAgentAuditLogs());
    } catch (caughtError) {
      console.error("加载审计日志失败", caughtError);
    } finally {
      setIsLoadingLogs(false);
    }
  }

  async function handleCreateKey() {
    if (selectedScopes.length === 0) {
      setError("请至少选择一个权限");
      return;
    }

    setIsCreating(true);
    setError("");

    try {
      setGeneratedKey(await createAgentApiKey({
        name: agentName,
        scopes: selectedScopes,
        expiresAt: buildApiKeyExpiryDate(keyExpiryPreset),
      }));
      await refreshKeys();
      await refreshAuditLogs();
      await onAgentKeysChanged?.();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "生成 API Key 失败");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleRevokeKey(id: number) {
    setError("");

    try {
      await revokeAgentApiKey(id);
      await refreshKeys();
      await refreshAuditLogs();
      await onAgentKeysChanged?.();
      if (generatedKey?.api_key_id === id) {
        setGeneratedKey(null);
      }
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "吊销 API Key 失败");
    }
  }

  async function copySkillDoc() {
    try {
      await navigator.clipboard.writeText(skillText);
      setSkillActionMessage("Skill 文档已复制");
    } catch (caughtError) {
      setSkillActionMessage(caughtError instanceof Error ? caughtError.message : "复制失败");
    }
  }

  function downloadSkillDoc() {
    const blob = new Blob([skillText], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "zuoyeben-agent-skill.md";
    anchor.click();
    URL.revokeObjectURL(url);
    setSkillActionMessage("Skill 文档已下载");
  }

  function toggleScope(scope: string) {
    setSelectedScopes((currentScopes) =>
      currentScopes.includes(scope)
        ? currentScopes.filter((item) => item !== scope)
        : [...currentScopes, scope]
    );
  }

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="Agent Access"
        title="Agent Key 接入"
        copy="给不同 Agent 生成独立身份和权限，让它们安全地帮你写工作日记。"
      />
      <div className="agent-grid">
        <section className="panel agent-key-create-card">
          <PanelTitle icon={<KeyRound size={18} />} title="生成新 Key" action="一次显示" />
          <div className="agent-key-form">
            <label>
              Agent 名称
              <input
                value={agentName}
                onChange={(event) => setAgentName(event.target.value)}
                placeholder="Codex 工作助手"
              />
            </label>
            <label>
              有效期
              <select
                value={keyExpiryPreset}
                onChange={(event) => setKeyExpiryPreset(event.target.value as "never" | "7d" | "30d" | "90d")}
              >
                <option value="30d">30 天</option>
                <option value="7d">7 天</option>
                <option value="90d">90 天</option>
                <option value="never">永不过期</option>
              </select>
            </label>
          </div>
          <div className="scope-picker">
            {scopeOptions.map((scope) => (
              <label className="scope-option" key={scope.value}>
                <input
                  type="checkbox"
                  checked={selectedScopes.includes(scope.value)}
                  onChange={() => toggleScope(scope.value)}
                />
                <span>
                  <strong>{scope.label}</strong>
                  <small>{scope.value} · {scope.desc}</small>
                </span>
              </label>
            ))}
          </div>
          <button className="primary-btn full-width-btn" onClick={handleCreateKey} disabled={isCreating}>
            <KeyRound size={18} />
            {isCreating ? "生成中..." : "生成 API Key"}
          </button>
          <p className="hint-text">建议为不同 Agent 单独生成 Key，后续可通过审计日志追踪每个 Agent 的读写动作。</p>
        </section>
        <section className="panel agent-card">
          <PanelTitle icon={<Bot size={18} />} title="已连接 Agent" action={isLoadingKeys ? "加载中" : "Key 管理"} />
          {agentKeys.length > 0 ? (
            agentKeys.map((key) => (
              <div className="agent-row" key={key.id}>
                <div className="agent-avatar">{key.agent_name?.slice(0, 1) ?? "A"}</div>
                <div>
                  <strong>{key.agent_name ?? "未命名 Agent"}</strong>
                  <span>
                    {key.key_mask} · Scopes: {key.scopes.join(", ")}
                  </span>
                  <span>{key.expires_at ? `有效期至 ${formatFullDateTime(key.expires_at)}` : "永不过期"}</span>
                </div>
                <button className="mini-danger-btn" onClick={() => void handleRevokeKey(key.id)}>
                  吊销
                </button>
              </div>
            ))
          ) : (
            <div className="key-empty">
              <Bot size={22} />
              <p>还没有可用的 Agent Key，生成一个后会出现在这里。</p>
            </div>
          )}
        </section>
        <section className="panel skill-panel">
          <PanelTitle icon={<TerminalSquare size={18} />} title="Skill 使用说明" action="Markdown" />
          <pre>{skillText}</pre>
          <div className="skill-actions">
            <button className="soft-btn" onClick={() => void copySkillDoc()}>
              <ClipboardList size={18} />
              复制文档
            </button>
            <button className="soft-btn" onClick={downloadSkillDoc}>
              <Download size={18} />
              下载 Markdown
            </button>
          </div>
          {skillActionMessage && <p className="success-text">{skillActionMessage}</p>}
        </section>
        <section className="panel api-key-panel">
          <PanelTitle icon={<KeyRound size={18} />} title="新生成的 Key" action="仅显示一次" />
          {generatedKey ? (
            <>
              <div className="key-box">
                <span>{generatedKey.key_mask}</span>
                <code>{generatedKey.rawKey}</code>
              </div>
              <pre>{`curl -X POST ${API_BASE_URL}/agent/diaries \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${generatedKey.rawKey}" \\
  -d '{"time":"18:10","title":"Agent 自动写入测试","summary":"Agent 通过 API Key 写入了一条工作日记。","tags":["Agent","API"]}'`}</pre>
            </>
          ) : (
            <div className="key-empty">
              <KeyRound size={22} />
              <p>点击上方按钮生成一个可用于 Agent 管理日记和待办的 API Key。</p>
            </div>
          )}
          {error && <p className="error-text">{error}</p>}
        </section>
        <section className="panel audit-logs-panel">
          <PanelTitle icon={<ShieldCheck size={18} />} title="API 审计日志" action="安全审计" />
          <div className="audit-logs-table-wrapper">
            {isLoadingLogs ? (
              <div className="key-empty">加载中...</div>
            ) : auditLogs.length > 0 ? (
              <table className="audit-logs-table">
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>Agent</th>
                    <th>动作</th>
                    <th>目标数据</th>
                    <th>详情/元数据</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map((log) => {
                    const isWrite = ["create", "update", "delete", "toggle", "restore", "overwrite"].some(
                      (kw) => log.action.toLowerCase().includes(kw)
                    );
                    const dateStr = new Date(log.created_at).toLocaleString("zh-CN", {
                      hour12: false,
                    });
                    return (
                      <tr key={log.id}>
                        <td>{dateStr}</td>
                        <td>
                          <strong>{log.agent_name || "未知 Agent"}</strong>
                          <span style={{ fontSize: "11px", color: "var(--muted)", marginLeft: "6px" }}>
                            ({log.key_mask || "-"})
                          </span>
                        </td>
                        <td>
                          <span className={`audit-badge ${isWrite ? "write" : "read"}`}>
                            {log.action}
                          </span>
                        </td>
                        <td>
                          <span style={{ textTransform: "capitalize" }}>
                            {log.target_type}
                          </span>
                          {log.target_id ? ` (ID: ${log.target_id})` : ""}
                        </td>
                        <td>
                          <span className="audit-meta-code">
                            {JSON.stringify(log.request_meta)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div className="key-empty">
                <ShieldCheck size={22} />
                <p>暂无安全审计日志，当 Agent 通过 API Key 请求接口时会记录在这里。</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function buildAgentSkillDoc(rawKey?: string, scopes: string[] = ["diary:read", "diary:write", "todo:read", "todo:write", "timeline:read"]) {
  const displayKey = rawKey ?? "wdk_请先在作业本里生成_API_Key";
  const hasScope = (scope: string) => scopes.includes("all") || scopes.includes(scope);
  const diaryWriteSection = hasScope("diary:write")
    ? `
## 写入 Agent 日记

POST ${API_BASE_URL}/agent/diaries

请求体：

\`\`\`json
{
  "time": "18:10",
  "title": "Agent 自动回顾了产品开发进展",
  "summary": "整理了今天完成的功能、尚未解决的问题和下一步建议。",
  "tags": ["Agent 回顾", "产品开发"],
  "source_session_id": "optional-session-id"
}
\`\`\`

要求：

- title 用一句话描述这条日记的主题
- summary 写成用户能直接回顾的工作摘要
- time 使用 24 小时制 HH:mm
- tags 保持 2 到 6 个，优先使用真实主题词
- 不要写入 API Key、访问令牌、密码、完整提示词或完整私密对话
`
    : "";
  const diaryReadSection = hasScope("diary:read")
    ? `
## 读取日记

\`\`\`http
GET ${API_BASE_URL}/agent/diaries
\`\`\`
`
    : "";
  const diaryMaintainSection = hasScope("diary:write")
    ? `
## 维护日记

更新一条日记：

\`\`\`http
PATCH ${API_BASE_URL}/agent/diaries/:id
\`\`\`

\`\`\`json
{
  "title": "更新后的标题",
  "summary": "补充更准确的工作进展和后续动作。",
  "tags": ["Agent 回顾", "修订"]
}
\`\`\`

删除一条日记会进入回收站：

\`\`\`http
DELETE ${API_BASE_URL}/agent/diaries/:id
\`\`\`
`
    : "";
  const todoSection = hasScope("todo:read") || hasScope("todo:write")
    ? `
## 待办管理

${hasScope("todo:read") ? `\`\`\`http
GET ${API_BASE_URL}/agent/todos
\`\`\`` : ""}

${hasScope("todo:write") ? `\`\`\`http
POST ${API_BASE_URL}/agent/todos
PATCH ${API_BASE_URL}/agent/todos/:id
DELETE ${API_BASE_URL}/agent/todos/:id
\`\`\`

创建待办：

\`\`\`json
{
  "text": "明天验证 Docker Compose 生产部署",
  "done": false,
  "missionTitle": "推进「部署」主线"
}
\`\`\`

missionTitle 和 missionId 可选。推荐先 GET /agent/missions，选择最相关的主线或支线，把待办绑定到那条任务线；如果不确定，可以不传，系统会先作为普通待办保存。

更新待办状态时尽量提供 reason，便于审计与复盘：

\`\`\`json
{
  "done": true,
  "reason": "已完成本地构建验证"
}
\`\`\`` : ""}
`
    : "";
  const snapshotSection = hasScope("diary:read") && hasScope("todo:read")
    ? `
## 快照读取

\`\`\`http
GET ${API_BASE_URL}/agent/snapshot
\`\`\`

用于在写入前获取最近日记、待办、主题和分享状态。只读取必要上下文，不要把完整数据转发给第三方服务。
`
    : "";
  const missionSection = hasScope("timeline:read")
    ? `
## 任务时间线读取

\`\`\`http
GET ${API_BASE_URL}/agent/missions
\`\`\`

返回主线任务、支线任务和时间线节点。用于 Agent 在写日记或拆待办前理解当前工作脉络。
`
    : "";
  const missionWriteSection = hasScope("timeline:write")
    ? `
## 任务时间线写入

\`\`\`http
POST ${API_BASE_URL}/agent/mission-nodes
\`\`\`

\`\`\`json
{
  "missionTitle": "推进「作业本项目」主线",
  "title": "完成 Agent 时间线写入接口",
  "summary": "补齐 timeline:write 对应的节点写入能力。",
  "status": "进行中",
  "time": "18:30",
  "source": "Agent 自动整理",
  "relatedDiaryIds": []
}
\`\`\`

timelineId 和 missionTitle 都可选。推荐先 GET /agent/missions，选择正在推进的主线或支线，把 missionTitle 填为对应任务线标题；如果已知 id，也可以直接传 timelineId。两者都不传时系统会自动挂到当前主线任务。写入节点前优先读取任务线，避免重复创建相同节点。
`
    : "";
  const summarySection = hasScope("summary:read")
    ? `
## AI 总结读取

\`\`\`http
GET ${API_BASE_URL}/agent/summaries?type=daily&date=2026-05-25
\`\`\`

type 支持 daily、weekly、monthly、yearly。读取总结前不要自动生成新总结，避免在未经用户同意时触发模型调用。
`
    : "";
  const shareSection = hasScope("share:write")
    ? `
## 分享卡片生成

\`\`\`http
POST ${API_BASE_URL}/agent/share-cards
\`\`\`

\`\`\`json
{
  "visibility": "link",
  "expiry": "7d"
}
\`\`\`

visibility 支持 link、public、private；expiry 支持 never、7d、30d。分享卡片只包含脱敏统计和任务摘要，不包含原始日记、API Key、模型配置或完整交互内容。
`
    : "";
  const agentProfileSection = hasScope("agent:read") || hasScope("agent:write")
    ? `
## Agent 身份资料

${hasScope("agent:read") ? `\`\`\`http
GET ${API_BASE_URL}/agent/profile
\`\`\`` : ""}

${hasScope("agent:write") ? `\`\`\`http
PATCH ${API_BASE_URL}/agent/profile
\`\`\`

\`\`\`json
{
  "name": "Codex 工作助手",
  "description": "负责把本地开发进展写入作业本。",
  "provider": "Codex",
  "defaultColor": "#ff8fbd"
}
\`\`\`` : ""}
`
    : "";
  const curlSection = hasScope("diary:write")
    ? `
## curl 示例

\`\`\`bash
curl -X POST ${API_BASE_URL}/agent/diaries \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${displayKey}" \\
  -d '{"time":"18:10","title":"Agent 自动写入测试","summary":"Agent 通过 API Key 写入了一条工作日记。","tags":["Agent 回顾","API"]}'

${hasScope("todo:write") ? `curl -X POST ${API_BASE_URL}/agent/todos \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: ${displayKey}" \\
  -d '{"text":"把 Agent CRUD 接口跑一轮集成测试","done":false,"missionTitle":"推进「Agent」主线"}'` : ""}
\`\`\`
`
    : "";

  return `# 作业本 Agent Skill

## 目标

当你是用户的 AI Agent 时，把当天重要工作进展、决策、阻塞、复盘和下一步动作写入作业本。写入内容要克制、结构化、可回顾，不要记录隐私密钥、完整原始聊天或无关闲聊。

## 连接信息

- API Base: ${API_BASE_URL}
- Header: X-API-Key: ${displayKey}
- Content-Type: application/json
- 当前 Key 权限: ${scopes.join(", ")}

${diaryWriteSection}${diaryReadSection}${diaryMaintainSection}${todoSection}${snapshotSection}${missionSection}${missionWriteSection}${summarySection}${shareSection}${agentProfileSection}

## 推荐触发时机

- 完成一项明确任务后
- 用户让你总结当天工作时
- 你发现新的阻塞、决策或待办时
- 长会话结束前
${curlSection}
`;
}

function MissionsView({
  missions,
  missionNodes,
  todoItems,
  entries,
  onOpenDiaryEvidence,
  onRegenerateMissions,
  onCompleteMission,
}: {
  missions: Mission[];
  missionNodes: MissionNode[];
  todoItems: TodoItem[];
  entries: DiaryEntry[];
  onOpenDiaryEvidence: (entry: DiaryEntry) => void;
  onRegenerateMissions: () => void;
  onCompleteMission: (id: number) => void;
}) {
  const [completedFilter, setCompletedFilter] = useState<"all" | "main" | "side">("all");
  const completedMissions = useMemo(
    () => missions.filter((mission) => mission.status === "已完成" && mission.progress >= 100),
    [missions],
  );
  const visibleCompletedMissions = useMemo(
    () =>
      completedMissions.filter((mission) => {
        if (completedFilter === "main") return mission.tone === "main";
        if (completedFilter === "side") return mission.tone !== "main";
        return true;
      }),
    [completedFilter, completedMissions],
  );
  const completedMainCount = completedMissions.filter((mission) => mission.tone === "main").length;
  const completedSideCount = completedMissions.length - completedMainCount;
  const recentCompletedMissions = visibleCompletedMissions.slice(0, 6);
  const activeMissions = useMemo(
    () => missions.filter((mission) => mission.status !== "已完成" || mission.progress < 100),
    [missions],
  );
  const activeMainMissions = useMemo(
    () => activeMissions.filter((mission) => mission.tone === "main"),
    [activeMissions],
  );
  const fallbackMainMission = activeMissions[0];
  const [selectedMainId, setSelectedMainId] = useState<number | null>(null);
  const selectedMainMission =
    activeMainMissions.find((mission) => mission.id === selectedMainId) ?? activeMainMissions[0] ?? fallbackMainMission;
  const selectedMissionId = selectedMainMission?.id ?? null;
  const sideMissions = activeMissions.filter((mission) => {
    if (mission.tone === "main") return false;
    if (!selectedMissionId) return true;
    return mission.parentId === selectedMissionId || mission.parentId == null;
  });
  const visibleMissionNodes = selectedMissionId
    ? missionNodes.filter((node) => node.timelineId === selectedMissionId)
    : missionNodes;
  const selectedSideMissions = selectedMissionId
    ? activeMissions.filter((mission) => mission.tone !== "main" && mission.parentId === selectedMissionId)
    : [];
  const selectedMissionIds = new Set(
    [selectedMainMission, ...selectedSideMissions]
      .map((mission) => mission?.id)
      .filter((id): id is number => typeof id === "number"),
  );
  const selectedMissionTitles = new Set(
    [selectedMainMission, ...selectedSideMissions]
      .map((mission) => mission?.title)
      .filter((title): title is string => Boolean(title)),
  );
  const relatedTodos = todoItems.filter((todo) => {
    if (todo.missionId && selectedMissionIds.has(todo.missionId)) return true;
    if (todo.missionTitle && selectedMissionTitles.has(todo.missionTitle)) return true;
    return false;
  });
  const openRelatedTodoCount = relatedTodos.filter((todo) => !todo.done).length;
  const relatedDiaries = useMemo(() => {
    const selectedMissions = [selectedMainMission, ...selectedSideMissions].filter(Boolean) as Mission[];
    const keywords = new Set<string>();

    selectedMissions.forEach((mission) => {
      stripMissionTitle(mission.title)
        .split(/[「」\s,，、：:]+/)
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length >= 2)
        .forEach((item) => keywords.add(item));
      (mission.tags ?? [])
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
        .forEach((tag) => keywords.add(tag));
    });

    if (keywords.size === 0) return [];

    return entries
      .map((entry) => {
        const haystack = [entry.title, entry.summary, ...entry.tags].join(" ").toLowerCase();
        const score = Array.from(keywords).reduce((sum, keyword) => (haystack.includes(keyword) ? sum + 1 : sum), 0);
        return { entry, score };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.entry.id - a.entry.id)
      .slice(0, 3)
      .map((item) => item.entry);
  }, [entries, selectedMainMission, selectedSideMissions]);

  useEffect(() => {
    if (!activeMainMissions.length) {
      setSelectedMainId(null);
      return;
    }

    if (!activeMainMissions.some((mission) => mission.id === selectedMainId)) {
      setSelectedMainId(activeMainMissions[0].id ?? null);
    }
  }, [activeMainMissions, selectedMainId]);

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="Mission Timeline"
        title="任务线"
        copy="把零散日记整理成主线和支线，看到每天具体推进了什么、哪里还卡着。"
      >
        <button className="primary-btn" onClick={onRegenerateMissions}>
          <WandSparkles size={18} />
          AI 重新整理
        </button>
      </PageHeader>
      <div className="mission-page-grid">
        <section className="panel mission-focus">
          <PanelTitle icon={<Flag size={18} />} title="当前主线" action={selectedMainMission ? "进行中" : "待生成"} />
          {selectedMainMission ? (
            <>
              {activeMainMissions.length > 0 && (
                <div className="main-mission-tabs" aria-label="并行主线">
                  {activeMainMissions.map((mission) => (
                    <button
                      key={mission.id ?? mission.title}
                      className={mission.id === selectedMissionId ? "active" : ""}
                      onClick={() => setSelectedMainId(mission.id ?? null)}
                    >
                      <Flag size={14} />
                      <span>{mission.title}</span>
                      <strong>{mission.progress}%</strong>
                      <small>{activeMissions.filter((item) => item.parentId === mission.id && item.tone !== "main").length} 条支线</small>
                    </button>
                  ))}
                </div>
              )}
              <div className="mission-main mission-main-large">
                <div className="mission-badge">主线任务</div>
                <h2>{selectedMainMission.title}</h2>
                <div className="progress-track">
                  <span style={{ width: `${selectedMainMission.progress}%` }} />
                </div>
                <p>{selectedMainMission.summary}</p>
                {selectedMainMission.id && (
                  <button className="soft-btn mission-complete-btn" onClick={() => onCompleteMission(selectedMainMission.id!)}>
                    <CheckCircle2 size={18} />
                    标记完成
                  </button>
                )}
              </div>
              <div className="mission-evidence-grid">
                <article className="mission-evidence-card">
                  <div>
                    <ClipboardList size={18} />
                    <strong>关联待办</strong>
                    <span>{relatedTodos.length > 0 ? `${openRelatedTodoCount} 个待完成` : "暂无绑定"}</span>
                  </div>
                  {relatedTodos.length > 0 ? (
                    <ul>
                      {relatedTodos.slice(0, 4).map((todo) => (
                        <li key={todo.id} className={todo.done ? "done" : ""}>
                          <CheckCircle2 size={14} />
                          <span>{todo.text}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>从 AI 总结或待办页创建待办时绑定主线/支线后，会在这里形成证据链。</p>
                  )}
                </article>
                <article className="mission-evidence-card">
                  <div>
                    <MessageSquareText size={18} />
                    <strong>推进节点</strong>
                    <span>{visibleMissionNodes.length} 条记录</span>
                  </div>
                  <p>
                    {visibleMissionNodes.length > 0
                      ? "这些节点来自日记与 Agent 记录，会作为判断任务进展的依据。"
                      : "重新整理任务线后，会把关键日记沉淀成推进节点。"}
                  </p>
                </article>
                <article className="mission-evidence-card mission-diary-evidence">
                  <div>
                    <PenLine size={18} />
                    <strong>关联日记</strong>
                    <span>{relatedDiaries.length > 0 ? `${relatedDiaries.length} 条片段` : "待沉淀"}</span>
                  </div>
                  {relatedDiaries.length > 0 ? (
                    <ul>
                      {relatedDiaries.map((entry) => (
                        <li key={entry.id} className="mission-diary-evidence-item">
                          <span>{entry.source === "agent" ? "Agent" : "人类"}</span>
                          <button onClick={() => onOpenDiaryEvidence(entry)}>
                            <strong>{entry.title}</strong>
                            <p>{entry.summary}</p>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>当日记标题、摘要或标签命中任务线关键词时，会在这里显示来源片段。</p>
                  )}
                </article>
              </div>
              <div className="mission-node-list">
                {visibleMissionNodes.length > 0 ? (
                  visibleMissionNodes.map((node) => (
                    <article className="mission-node" key={node.id ?? node.title}>
                      <span className="node-time">{node.time}</span>
                      <div>
                        <strong>{node.title}</strong>
                        <p>{node.summary ?? node.source}</p>
                      </div>
                      <em>{node.status}</em>
                    </article>
                  ))
                ) : (
                  <div className="key-empty mission-empty">
                    <Clock3 size={22} />
                    <strong>暂无时间线节点</strong>
                    <p>重新整理后，系统会根据日记生成节点。</p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="key-empty mission-empty mission-empty-large">
              <Flag size={28} />
              <strong>暂无真实任务线</strong>
              <p>当前没有从日记生成的主线任务。点击右上角 AI 重新整理，系统会基于你的真实日记生成任务线。</p>
              <button className="primary-btn" onClick={onRegenerateMissions}>
                <WandSparkles size={18} />
                AI 重新整理
              </button>
            </div>
          )}
        </section>
        <section className="panel">
          <PanelTitle icon={<Star size={18} />} title="支线任务" action={sideMissions.length > 0 ? "探索中" : "待生成"} />
          <div className="mission-list mission-list-expanded">
            {sideMissions.length > 0 ? (
              sideMissions.map((mission) => (
                <div className="mission-item mission-card-row" key={mission.id ?? mission.title}>
                  <div>
                    <span className={mission.tone === "main" ? "dot dot-pink" : "dot dot-mint"} />
                    <section>
                      <strong>{mission.title}</strong>
                      <p>{mission.summary}</p>
                      {mission.parentTitle && <em className="mission-parent-chip">归属：{mission.parentTitle}</em>}
                    </section>
                  </div>
                  <div className="mission-card-meta">
                    <strong>{mission.progress}%</strong>
                    {mission.id && (
                      <button className="soft-btn mission-inline-complete" onClick={() => onCompleteMission(mission.id!)}>
                        <CheckCircle2 size={14} />
                        标记完成
                      </button>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="key-empty mission-empty">
                <Star size={22} />
                <strong>暂无支线任务</strong>
                <p>当日记中出现辅助探索或临时事项时，会整理为支线。</p>
              </div>
            )}
          </div>
        </section>
        <section className="panel completed-missions-panel">
          <PanelTitle
            icon={<CheckCircle2 size={18} />}
            title="已完成任务线"
            action={`${visibleCompletedMissions.length}/${completedMissions.length} 条`}
          />
          <div className="mission-achievement-summary">
            <span>
              <strong>{completedMissions.length}</strong>
              <small>总归档</small>
            </span>
            <span>
              <strong>{completedMainCount}</strong>
              <small>主线</small>
            </span>
            <span>
              <strong>{completedSideCount}</strong>
              <small>支线</small>
            </span>
          </div>
          <div className="mission-archive-filters" aria-label="已完成任务线筛选">
            {[
              { value: "all", label: "全部" },
              { value: "main", label: "主线" },
              { value: "side", label: "支线" },
            ].map((option) => (
              <button
                key={option.value}
                className={completedFilter === option.value ? "active" : ""}
                onClick={() => setCompletedFilter(option.value as "all" | "main" | "side")}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="mission-list mission-list-expanded">
            {visibleCompletedMissions.length > 0 ? (
              visibleCompletedMissions.map((mission) => (
                <div className="mission-achievement-card" key={mission.id ?? mission.title}>
                  <div className="mission-achievement-medal">
                    <CheckCircle2 size={18} />
                  </div>
                  <div className="mission-achievement-body">
                    <div className="mission-achievement-head">
                      <strong>{mission.title}</strong>
                      <span>{mission.progress}%</span>
                    </div>
                    <p>{mission.summary}</p>
                    <div className="progress-track compact">
                      <span style={{ width: `${mission.progress}%` }} />
                    </div>
                    <div className="mission-achievement-tags">
                      <em className="mission-type-chip">{mission.tone === "main" ? "已完成主线" : "已完成支线"}</em>
                      {mission.parentTitle && <em className="mission-parent-chip completed">归属：{mission.parentTitle}</em>}
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="key-empty mission-empty">
                <CheckCircle2 size={22} />
                <strong>{completedMissions.length > 0 ? "当前筛选暂无记录" : "暂无已完成任务线"}</strong>
                <p>{completedMissions.length > 0 ? "切换筛选可以查看其他已完成任务。" : "完成配置或工作主线后，会在这里保留记录。"}</p>
              </div>
            )}
          </div>
        </section>
        <section className="panel mission-wall-panel">
          <PanelTitle icon={<Sparkles size={18} />} title="成就墙" action={completedMissions.length > 0 ? "已点亮" : "等待点亮"} />
          {completedMissions.length > 0 ? (
            <div className="mission-wall">
              <div className="mission-wall-hero">
                <span>ACHIEVEMENT</span>
                <strong>{completedMissions.length}</strong>
                <p>已完成任务线被保存在这里，后续可以继续扩展成独立归档时间轴。</p>
              </div>
              <div className="mission-wall-timeline">
                {recentCompletedMissions.map((mission, index) => (
                  <article className="mission-wall-item" key={mission.id ?? mission.title}>
                    <i>{String(index + 1).padStart(2, "0")}</i>
                    <section>
                      <strong>{mission.title}</strong>
                      <p>{mission.summary}</p>
                      <div>
                        <em>{mission.tone === "main" ? "主线成就" : "支线成就"}</em>
                        <span>{mission.progress}%</span>
                      </div>
                    </section>
                  </article>
                ))}
              </div>
            </div>
          ) : (
            <div className="key-empty mission-empty">
              <Sparkles size={22} />
              <strong>暂无成就</strong>
              <p>完成主线或支线后，会在这里生成可回看的成就归档。</p>
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function AIReviewView({
  entries,
  todoItems,
  onRefreshData,
}: {
  entries: DiaryEntry[];
  todoItems: TodoItem[];
  onRefreshData?: () => Promise<void>;
}) {
  const [periodType, setPeriodType] = useState<"daily" | "weekly" | "monthly" | "yearly">("daily");
  const [baseDate, setBaseDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [summaryData, setSummaryData] = useState<{
    id?: number;
    content: string;
    total_work_time: number;
    tag_distribution: Record<string, number>;
    html_file_path?: string | null;
  } | null>(null);
  const [extractedTodos, setExtractedTodos] = useState<Array<{ id: number; content: string; priority: string; status: string }>>([]);
  const [errorMsg, setErrorMsg] = useState("");

  // QA 状态
  const [question, setQuestion] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [qaAnswer, setQaAnswer] = useState("");
  const [qaCitations, setQaCitations] = useState<Array<{ conclusion: string; docId: number; title: string }>>([]);
  const [qaError, setQaError] = useState("");

  // 推荐的预设问题
  const suggestedQuestions = [
    "今天作业本主要推进了哪些模块？",
    "什么是 Google Stitch 的生成逻辑？",
    "最近的工作主要是围绕哪些标签展开的？",
  ];

  const loadingSteps = [
    "🔍 正在检索该周期的所有日记记录...",
    "🧠 正在调用大模型提炼关键工作成果...",
    "📊 正在汇总分析每日工时与标签频次...",
    "📝 正在智能识别未完成的目标提取待办...",
    "💾 正在将建议待办通过事务级方式写入数据库...",
    "🎨 正在动态渲染 Chart.js 可视化报表网页...",
    "✨ 总结构建完成，正在自愈清洗格式并呈现..."
  ];

  const loadSummary = useCallback(
    async (typeStr = periodType, dateStr = baseDate) => {
      setIsLoading(true);
      setErrorMsg("");
      setSummaryData(null);
      setExtractedTodos([]);
      try {
        const res = await apiRequest<{ summary: any }>("/summaries?type=" + typeStr + "&date=" + dateStr);
        if (res.summary) {
          setSummaryData(res.summary);
        }
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : "获取总结数据失败");
      } finally {
        setIsLoading(false);
      }
    },
    [periodType, baseDate]
  );

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  async function handleGenerateSummary() {
    setIsLoading(true);
    setErrorMsg("");
    setLoadingStep(0);

    const timer = setInterval(() => {
      setLoadingStep((prev) => (prev < loadingSteps.length - 1 ? prev + 1 : prev));
    }, 1200);

    try {
      const res = await apiRequest<{ summary: any; todos: any[] }>("/summaries", {
        method: "POST",
        body: { type: periodType, date: baseDate },
      });
      if (res.summary) {
        setSummaryData(res.summary);
        if (res.todos) {
          setExtractedTodos(res.todos);
        }
        if (onRefreshData) {
          await onRefreshData();
        }
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "生成总结失败");
    } finally {
      clearInterval(timer);
      setIsLoading(false);
    }
  }

  async function handleAskQuestion(qText = question) {
    const targetQ = qText.trim();
    if (!targetQ) return;
    setIsAsking(true);
    setQaError("");
    setQaAnswer("");
    setQaCitations([]);
    try {
      const res = await apiRequest<{ answer: string; citations: any[] }>("/qa/ask", {
        method: "POST",
        body: { question: targetQ },
      });
      setQaAnswer(res.answer);
      setQaCitations(res.citations || []);
    } catch (err) {
      setQaError(err instanceof Error ? err.message : "RAG 检索问答失败");
    } finally {
      setIsAsking(false);
    }
  }

  function renderTextWithCitations(text: string) {
    const regex = /【片段(\d+)】/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(text)) !== null) {
      const matchIndex = match.index;
      if (matchIndex > lastIndex) {
        parts.push(text.substring(lastIndex, matchIndex));
      }
      const fragmentNum = match[1];
      parts.push(
        <span key={matchIndex} className="citation-badge" title={`引用片段 ${fragmentNum}`}>
          [{fragmentNum}]
        </span>
      );
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }

    return parts.length > 0 ? parts : text;
  }

  function renderMarkdown(md: string) {
    if (!md) return null;
    const lines = md.split("\n");
    return lines.map((line, idx) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("### ")) {
        return <h3 key={idx} className="ai-markdown-h3">{trimmed.substring(4)}</h3>;
      }
      if (trimmed.startsWith("## ")) {
        return <h2 key={idx} className="ai-markdown-h2">{trimmed.substring(3)}</h2>;
      }
      if (trimmed.startsWith("# ")) {
        return <h1 key={idx} className="ai-markdown-h1">{trimmed.substring(2)}</h1>;
      }
      if (trimmed.startsWith("* ") || trimmed.startsWith("- ")) {
        return (
          <li key={idx} className="ai-markdown-li">
            {renderTextWithCitations(trimmed.substring(2))}
          </li>
        );
      }
      if (trimmed === "") {
        return <div key={idx} className="ai-markdown-gap" />;
      }
      return <p key={idx} className="ai-markdown-p">{renderTextWithCitations(line)}</p>;
    });
  }

  const periodLabels = {
    daily: "日报",
    weekly: "周报",
    monthly: "月报",
    yearly: "年报",
  };

  const reportUrl = buildReportUrl(summaryData?.html_file_path);

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="AI Review"
        title="AI 智能回顾"
        copy="利用 pgvector RAG 检索用户工作日记并提取行动待办，生成可视化报表。"
      >
        <div className="ai-controls-wrapper">
          <div className="period-pill-group">
            {(["daily", "weekly", "monthly", "yearly"] as const).map((type) => (
              <button
                key={type}
                className={periodType === type ? "period-pill active" : "period-pill"}
                onClick={() => {
                  setPeriodType(type);
                  void loadSummary(type, baseDate);
                }}
              >
                {periodLabels[type]}
              </button>
            ))}
          </div>
          <div className="date-picker-wrap">
            <input
              type="date"
              className="ai-date-picker"
              value={baseDate}
              onChange={(e) => {
                const val = e.target.value;
                setBaseDate(val);
                void loadSummary(periodType, val);
              }}
            />
            <button
              className="soft-btn"
              onClick={() => {
                const today = new Date().toISOString().split("T")[0];
                setBaseDate(today);
                void loadSummary(periodType, today);
              }}
            >
              今天
            </button>
          </div>
        </div>
      </PageHeader>

      <div className="ai-grid">
        <section className="panel ai-summary-card">
          <PanelTitle
            icon={<Bot size={18} />}
            title={`${periodLabels[periodType]}智能回顾`}
            action={summaryData ? "已生成" : "未生成"}
          />
          {isLoading ? (
            <div className="ai-loading-state">
              <div className="spinner-glow" />
              <p className="loading-text">{loadingSteps[loadingStep]}</p>
              <div className="loading-bar-container">
                <div
                  className="loading-bar-fill"
                  style={{ width: `${((loadingStep + 1) / loadingSteps.length) * 100}%` }}
                />
              </div>
            </div>
          ) : errorMsg ? (
            <div className="ai-empty-state error">
              <p>加载失败: {errorMsg}</p>
              <button className="primary-btn" onClick={() => void loadSummary()}>
                重试
              </button>
            </div>
          ) : summaryData ? (
            <div className="ai-summary-content">
              <div className="ai-markdown-body">{renderMarkdown(summaryData.content)}</div>
              
              <div className="summary-metrics">
                <span>⏱️ 总累计工时: {Math.round(summaryData.total_work_time / 60)} 小时</span>
                <span>🏷️ 涉及分类: {Object.keys(summaryData.tag_distribution || {}).length} 个</span>
              </div>

              {summaryData.tag_distribution && Object.keys(summaryData.tag_distribution).length > 0 && (
                <div className="tag-frequency-section">
                  <strong>核心标签频率：</strong>
                  <div className="tag-frequency-badges">
                    {Object.entries(summaryData.tag_distribution).map(([tag, count]) => (
                      <span key={tag} className="tag-freq-badge">
                        {tag} <span className="freq-count">({count}次)</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {reportUrl && (
                <a
                  href={reportUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="primary-btn html-report-btn"
                  style={{ marginTop: "1.5rem", display: "inline-flex", textDecoration: "none" }}
                >
                  <WandSparkles size={18} />
                  查看可视化网页报表 (Chart.js)
                </a>
              )}
            </div>
          ) : (
            <div className="ai-empty-state">
              <Bot size={40} className="empty-bot-icon" />
              <h3>暂无当前周期总结</h3>
              <p>系统未检测到该时段的已存盘总结。点击下方按钮，开始使用 AI 进行智能梳理。</p>
              <button className="primary-btn" onClick={() => void handleGenerateSummary()}>
                <Sparkles size={18} />
                生成当前周期总结
              </button>
            </div>
          )}
        </section>

        <section className="panel ai-todos-card">
          <PanelTitle icon={<ClipboardList size={18} />} title="智能建议待办" action="自动入库" />
          {isLoading ? (
            <div className="shimmer-todo-list">
              <div className="shimmer-row" />
              <div className="shimmer-row" />
              <div className="shimmer-row" />
            </div>
          ) : extractedTodos.length > 0 ? (
            <div className="suggestion-list active-list">
              <p className="hint-text">本周期生成时已自动入库下列待办，可前往“待办”看板流转它们：</p>
              {extractedTodos.map((todo) => (
                <div className={`suggestion-item prio-${todo.priority}`} key={todo.id}>
                  <CheckCircle2 size={16} />
                  <span>{todo.content}</span>
                  <span className="prio-tag">{todo.priority}优先级</span>
                </div>
              ))}
            </div>
          ) : summaryData ? (
            <div className="ai-todo-empty">
              <p>该周期总结未提取出额外需要跟进的目标待办。</p>
            </div>
          ) : (
            <div className="ai-todo-empty">
              <p>生成当前周期的智能总结后，系统会自动在此提取和展示需跟进的待办目标。</p>
            </div>
          )}
        </section>

        <section className="panel rag-card">
          <PanelTitle icon={<Search size={18} />} title="RAG 问答追踪" action="时间感知检索" />
          <div className="question-box">
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="问点什么... 例如：今天作业本主要推进了哪些模块？"
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleAskQuestion();
              }}
              disabled={isAsking}
            />
            <button className="primary-btn" onClick={() => void handleAskQuestion()} disabled={isAsking || !question.trim()}>
              <WandSparkles size={18} />
              {isAsking ? "分析中..." : "问一下"}
            </button>
          </div>

          <div className="suggested-q-chips">
            {suggestedQuestions.map((q) => (
              <button
                key={q}
                className="q-chip"
                onClick={() => {
                  setQuestion(q);
                  void handleAskQuestion(q);
                }}
                disabled={isAsking}
              >
                {q}
              </button>
            ))}
          </div>

          <div className="answer-preview">
            <strong>智能回答</strong>
            {isAsking ? (
              <div className="shimmer-answer">
                <div className="shimmer-line" />
                <div className="shimmer-line half" />
              </div>
            ) : qaError ? (
              <p className="error-text">问答发生错误: {qaError}</p>
            ) : qaAnswer ? (
              <div className="answer-text">{renderMarkdown(qaAnswer)}</div>
            ) : (
              <p className="answer-placeholder">支持时间实体解析与向量混合检索，尝试提问开始你的回顾之旅。</p>
            )}

            {qaCitations.length > 0 && !isAsking && (
              <div className="citations-list">
                <div className="citations-header">📚 依据引用文献映射：</div>
                <div className="citations-grid">
                  {qaCitations.map((cit, idx) => (
                    <article key={idx} className="citation-card">
                      <span className="cit-badge">[{idx + 1}]</span>
                      <div className="cit-body">
                        <strong className="cit-conclusion">{cit.conclusion}</strong>
                        <span className="cit-source">
                          📖 出处日记：<strong>{cit.title}</strong> (ID: {cit.docId})
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function TodosView({
  todoItems,
  missions,
  quickTodo,
  setQuickTodo,
  onAddTodo,
  onToggleTodo,
  onUpdateTodo,
  onDeleteTodo,
}: {
  todoItems: TodoItem[];
  missions: Mission[];
  quickTodo: string;
  setQuickTodo: (value: string) => void;
  onAddTodo: () => void;
  onToggleTodo: (id: number) => void;
  onUpdateTodo: (id: number, text: string) => Promise<void>;
  onDeleteTodo: (id: number) => Promise<void>;
}) {
  const openTodos = todoItems.filter((todo) => !todo.done);
  const doneTodos = todoItems.filter((todo) => todo.done);
  const missionMatches = useMemo(() => buildTodoMissionMatches(todoItems, missions), [todoItems, missions]);
  const [history, setHistory] = useState<TodoStatusHistoryItem[]>([]);
  const [historyError, setHistoryError] = useState("");

  useEffect(() => {
    void refreshHistory();
  }, [todoItems]);

  async function refreshHistory() {
    try {
      setHistory(await listTodoStatusHistory());
      setHistoryError("");
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "加载待办历史失败");
    }
  }

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="Tiny Tasks"
        title="待办小目标"
        copy="从日记里提取可执行的小目标，也可以手动补充。完成后给一点轻量反馈，但不打扰工作节奏。"
      />
      <section className="todo-board">
        <div className="panel todo-compose">
          <PanelTitle icon={<Plus size={18} />} title="快速新增" action="来自日记" />
          <div className="inline-form">
            <input
              value={quickTodo}
              onChange={(event) => setQuickTodo(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onAddTodo();
              }}
              placeholder="输入一个今天可以完成的小目标"
            />
            <button className="primary-btn" onClick={onAddTodo}>
              <Plus size={18} />
              添加
            </button>
          </div>
          <div className="todo-metric-row">
            <span>开放中 {openTodos.length}</span>
            <span>已完成 {doneTodos.length}</span>
            <span>完成率 {Math.round((doneTodos.length / Math.max(todoItems.length, 1)) * 100)}%</span>
          </div>
        </div>
        <section className="panel">
          <PanelTitle icon={<ClipboardList size={18} />} title="开放小目标" action="优先级" />
          <div className="todo-list">
            {openTodos.map((todo) => (
              <TodoRow
                key={todo.id}
                todo={todo}
                mission={missionMatches.get(todo.id)}
                onToggleTodo={onToggleTodo}
                onUpdateTodo={onUpdateTodo}
                onDeleteTodo={onDeleteTodo}
              />
            ))}
          </div>
        </section>
        <section className="panel">
          <PanelTitle icon={<CheckCircle2 size={18} />} title="已完成" action="归档" />
          <div className="todo-list">
            {doneTodos.map((todo) => (
              <TodoRow
                key={todo.id}
                todo={todo}
                mission={missionMatches.get(todo.id)}
                onToggleTodo={onToggleTodo}
                onUpdateTodo={onUpdateTodo}
                onDeleteTodo={onDeleteTodo}
              />
            ))}
          </div>
        </section>
        <section className="panel todo-history-panel">
          <PanelTitle icon={<Clock3 size={18} />} title="状态变更记录" action={`${history.length} 条`} />
          {history.length > 0 ? (
            <div className="history-list">
              {history.map((item) => (
                <article className="history-row" key={item.id}>
                  <strong>
                    #{item.todo_id} {item.old_status ?? "空"} → {item.new_status}
                  </strong>
                  <p>{item.reason ?? "无原因记录"}</p>
                  <span>{item.created_at}</span>
                </article>
              ))}
            </div>
          ) : (
            <div className="key-empty">
              <Clock3 size={22} />
              <p>{historyError || "还没有状态变更记录。"}</p>
            </div>
          )}
        </section>
      </section>
    </section>
  );
}

function TodoRow({
  todo,
  mission,
  onToggleTodo,
  onUpdateTodo,
  onDeleteTodo,
}: {
  todo: TodoItem;
  mission?: Mission;
  onToggleTodo: (id: number) => void;
  onUpdateTodo: (id: number, text: string) => Promise<void>;
  onDeleteTodo: (id: number) => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(todo.text);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setDraft(todo.text);
  }, [todo.text]);

  async function saveTodoText() {
    setIsSubmitting(true);
    try {
      await onUpdateTodo(todo.id, draft);
      setIsEditing(false);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className={todo.done ? "todo-row done" : "todo-row"}>
      <button
        className={todo.done ? "checkbox checked" : "checkbox"}
        onClick={() => onToggleTodo(todo.id)}
        aria-label={todo.done ? "重新打开待办" : "完成待办"}
      >
        {todo.done && <CheckCircle2 size={16} />}
      </button>
      {isEditing ? (
        <input
          className="todo-edit-input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void saveTodoText();
            if (event.key === "Escape") {
              setDraft(todo.text);
              setIsEditing(false);
            }
          }}
          autoFocus
        />
      ) : (
        <span>
          {todo.text}
          {mission && <em className="todo-mission-chip">{mission.tone === "main" ? "主线" : "支线"} · {mission.title}</em>}
        </span>
      )}
      <div className="todo-actions">
        {isEditing ? (
          <>
            <button onClick={() => void saveTodoText()} disabled={isSubmitting}>
              <CheckCircle2 size={15} />
              保存
            </button>
            <button
              onClick={() => {
                setDraft(todo.text);
                setIsEditing(false);
              }}
            >
              <X size={15} />
              取消
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setIsEditing(true)}>
              <PenLine size={15} />
              编辑
            </button>
            <button className="danger" onClick={() => void onDeleteTodo(todo.id)}>
              <Trash2 size={15} />
              删除
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function TodoReasonModal({
  todo,
  nextDone,
  onClose,
  onSubmit,
}: {
  todo: TodoItem;
  nextDone: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState(nextDone ? "完成了这个小目标" : "需要重新跟进");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    const finalReason = reason.trim();
    if (!finalReason) {
      setError("请填写变更原因");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      await onSubmit(finalReason);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "状态更新失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="diary-modal" role="dialog" aria-modal="true" aria-labelledby="todo-reason-title">
        <div className="modal-title">
          <div>
            <span>待办状态流转</span>
            <h2 id="todo-reason-title">{nextDone ? "确认完成小目标" : "重新打开小目标"}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭弹窗">
            <X size={18} />
          </button>
        </div>
        <div className="reason-target">
          <strong>{todo.text}</strong>
          <span>{todo.done ? "已完成" : "待办"} → {nextDone ? "已完成" : "待办"}</span>
        </div>
        <label>
          变更原因
          <textarea
            value={reason}
            rows={3}
            onChange={(event) => setReason(event.target.value)}
            placeholder="例如：已完成验证并提交，或需要重新跟进。"
          />
        </label>
        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          <button className="soft-btn" onClick={onClose}>
            取消
          </button>
          <button className="primary-btn" onClick={() => void handleSubmit()} disabled={isSubmitting}>
            <CheckCircle2 size={18} />
            {isSubmitting ? "保存中..." : "确认变更"}
          </button>
        </div>
      </section>
    </div>
  );
}

function DiaryEditModal({
  entry,
  onClose,
  onSubmit,
}: {
  entry: DiaryEntry;
  onClose: () => void;
  onSubmit: (id: number, patch: Partial<Omit<DiaryEntry, "id">>) => Promise<void>;
}) {
  const [draft, setDraft] = useState({
    title: entry.title,
    summary: entry.summary,
    time: entry.time,
    tags: entry.tags.join(", "),
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit() {
    const title = draft.title.trim();
    const summary = draft.summary.trim();

    if (!title || !summary) {
      setError("请填写标题和内容摘要");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      await onSubmit(entry.id, {
        title,
        summary,
        time: draft.time.trim() || entry.time,
        source: entry.source,
        tags: draft.tags
          .split(/[,，]/)
          .map((tag) => tag.trim())
          .filter(Boolean)
          .slice(0, 6),
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "日记保存失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="diary-modal" role="dialog" aria-modal="true" aria-labelledby="diary-edit-title">
        <div className="modal-title">
          <div>
            <span>{entry.source === "human" ? "人类主动记录" : "Agent 自动回顾"}</span>
            <h2 id="diary-edit-title">编辑日记</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭弹窗">
            <X size={18} />
          </button>
        </div>
        <label>
          标题
          <input
            value={draft.title}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
          />
        </label>
        <label>
          内容摘要
          <textarea
            value={draft.summary}
            rows={5}
            onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))}
          />
        </label>
        <label>
          时间
          <input
            value={draft.time}
            onChange={(event) => setDraft((current) => ({ ...current, time: event.target.value }))}
            placeholder="例如：11:20"
          />
        </label>
        <label>
          标签
          <input
            value={draft.tags}
            onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))}
            placeholder="用逗号分隔，最多 6 个"
          />
        </label>
        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          <button className="soft-btn" onClick={onClose}>
            取消
          </button>
          <button className="primary-btn" onClick={() => void handleSubmit()} disabled={isSubmitting}>
            <CheckCircle2 size={18} />
            {isSubmitting ? "保存中..." : "保存修改"}
          </button>
        </div>
      </section>
    </div>
  );
}

function ShareView({
  entries,
  shareGenerated,
  shareCard,
  shareVisibility,
  setShareVisibility,
  onGenerateShare,
}: {
  entries: DiaryEntry[];
  shareGenerated: boolean;
  shareCard: ShareCardResponse | null;
  shareVisibility: "link" | "private" | "public";
  setShareVisibility: (value: "link" | "private" | "public") => void;
  onGenerateShare: (expiry?: ShareExpiryPreset) => void | Promise<void>;
}) {
  const [shareExpiry, setShareExpiry] = useState<ShareExpiryPreset>("never");
  const [shareTemplate, setShareTemplate] = useState<"diary" | "fresh" | "report" | "spark" | "badge">("diary");
  const [isExporting, setIsExporting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [exportError, setExportError] = useState("");
  const [shareActionMessage, setShareActionMessage] = useState("");
  const cardRef = useRef<HTMLElement | null>(null);
  const visibilityOptions = [
    { value: "link", label: "链接可见", icon: Link },
    { value: "private", label: "密码访问", icon: Lock },
    { value: "public", label: "公开展示", icon: Share2 },
  ] as const;
  const expiryOptions = [
    { value: "never", label: "永久有效" },
    { value: "7d", label: "7 天" },
    { value: "30d", label: "30 天" },
  ] as const;
  const templateOptions = [
    { value: "diary", label: "少女手帐" },
    { value: "fresh", label: "薄荷清爽" },
    { value: "report", label: "任务战报" },
    { value: "spark", label: "闪闪营业" },
    { value: "badge", label: "成就徽章" },
  ] as const;
  const templateCopy = {
    diary: {
      topline: shareGenerated ? "朋友圈卡片已就绪" : "卡片预览",
      title: "今天也认真发光了",
      missionLabel: "今日主线",
      qrHint: "扫码查看我的工作小花园",
    },
    fresh: {
      topline: shareGenerated ? "清爽进度已打包" : "薄荷预览",
      title: "把今天整理得清清爽爽",
      missionLabel: "今日推进",
      qrHint: "扫码看我的清爽工作流",
    },
    report: {
      topline: shareGenerated ? "任务战报已生成" : "战报预览",
      title: "今日任务推进报告",
      missionLabel: "核心任务",
      qrHint: "扫码查看我的任务战报",
    },
    spark: {
      topline: shareGenerated ? "今日高光已封存" : "高光预览",
      title: "今日份高光营业中",
      missionLabel: "最亮主线",
      qrHint: "扫码领取我的今日高光",
    },
    badge: {
      topline: shareGenerated ? "成就徽章已点亮" : "徽章预览",
      title: "解锁一枚努力徽章",
      missionLabel: "徽章任务",
      qrHint: "扫码查看这枚工作徽章",
    },
  } satisfies Record<typeof shareTemplate, { topline: string; title: string; missionLabel: string; qrHint: string }>;
  const activeTemplateCopy = templateCopy[shareTemplate];
  const diaryCount = shareCard?.snapshot.diaryCount ?? entries.length;
  const agentDiaryCount = shareCard?.snapshot.agentDiaryCount ?? entries.filter((entry) => entry.source === "agent").length;
  const mainMissionProgress = shareCard?.snapshot.mainMissionProgress ?? 72;
  const shareAchievements = [
    { label: "今日记录", value: diaryCount },
    { label: "Agent 回顾", value: agentDiaryCount },
    { label: "主线推进", value: `${mainMissionProgress}%` },
  ];

  async function generateShareCard() {
    try {
      setIsGenerating(true);
      setShareActionMessage("");
      await onGenerateShare(shareExpiry);
      setShareActionMessage("卡片已生成，可以复制链接或下载图片。");
    } finally {
      setIsGenerating(false);
    }
  }

  async function copyShareLink() {
    if (!shareCard) return;

    try {
      await navigator.clipboard.writeText(shareCard.shareUrl);
      setShareActionMessage("分享链接已复制。");
    } catch {
      setShareActionMessage("当前浏览器不允许自动复制，可以手动复制二维码旁的链接。");
    }
  }

  async function exportShareImage() {
    if (!cardRef.current || !shareCard) return;

    try {
      setIsExporting(true);
      setExportError("");
      const dataUrl = await toPng(cardRef.current, {
        cacheBust: true,
        pixelRatio: 2,
        backgroundColor: "#fff8fb",
      });
      const anchor = document.createElement("a");
      anchor.href = dataUrl;
      anchor.download = `zuoyeben-share-${new Date().toISOString().slice(0, 10)}.png`;
      anchor.click();
      setShareActionMessage("图片已导出，适合直接发朋友圈。");
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "分享卡片导出失败");
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="Share Moment"
        title="分享卡片"
        copy="把一天的努力生成一张可以分享的卡片。默认只展示摘要和进度，不暴露原始日记与 Agent 交互。"
      >
        <button className="primary-btn" onClick={() => void generateShareCard()} disabled={isGenerating}>
          <Image size={18} />
          {isGenerating ? "生成中..." : shareGenerated ? "重新生成" : "生成卡片"}
        </button>
      </PageHeader>
      <div className="share-page-grid">
        <section className={`share-card share-card-large share-template-${shareTemplate}`} ref={cardRef}>
          <div className="share-card-charm charm-ribbon" aria-hidden="true" />
          <div className="share-card-charm charm-heart" aria-hidden="true">
            ♡
          </div>
          <div className="share-stamp" aria-hidden="true">
            <span>DONE</span>
            <strong>{shareCard?.snapshot.mainMissionProgress ?? 72}%</strong>
          </div>
          <div className="share-inner">
            <div className="share-washi" aria-hidden="true" />
            <div className="share-topline">
              <Heart size={16} />
              {activeTemplateCopy.topline}
            </div>
            <h2>{activeTemplateCopy.title}</h2>
            <p>
              {diaryCount} 条日记 ·{" "}
              {agentDiaryCount} 个
              Agent 回顾 · 主线推进 {mainMissionProgress}%
            </p>
            <div className="share-achievement-strip">
              {shareAchievements.map((item) => (
                <span key={item.label}>
                  <strong>{item.value}</strong>
                  <small>{item.label}</small>
                </span>
              ))}
            </div>
            <div className="share-stats">
              <span>{shareCard?.snapshot.openTodoCount ?? 2} 个开放小目标</span>
              <span>{shareCard?.snapshot.topTags?.[0] ?? "产品定位"}</span>
              <span>{shareVisibility === "private" ? "密码访问" : shareVisibility === "public" ? "公开展示" : "链接可见"}</span>
              <span>{shareCard?.expiresAt ? `到期 ${formatDateTime(shareCard.expiresAt)}` : "永久有效"}</span>
            </div>
            <div className="share-mission-card">
              <span>{activeTemplateCopy.missionLabel}</span>
              <strong>{shareCard?.snapshot.mainMissionTitle ?? "把工作轨迹整理成漂亮的作业本"}</strong>
              <div className="share-progress">
                <i style={{ width: `${mainMissionProgress}%` }} />
              </div>
            </div>
            <div className="share-tag-strip">
              {(shareCard?.snapshot.topTags?.length ? shareCard.snapshot.topTags : ["产品定位", "Agent 协作", "作业本"])
                .slice(0, 3)
                .map((tag) => (
                  <span key={tag}>#{tag}</span>
                ))}
            </div>
            <div className="qr-wrap">
              {shareCard ? <ShareQr value={shareCard.shareUrl} /> : <div className="fake-qr" />}
              <span>{shareCard ? shareCard.shareUrl : activeTemplateCopy.qrHint}</span>
            </div>
          </div>
        </section>
        <section className="panel share-settings">
          <PanelTitle icon={<Lock size={18} />} title="隐私设置" action="分享前检查" />
          <div className="visibility-grid">
            {visibilityOptions.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  className={shareVisibility === option.value ? "visibility-card active" : "visibility-card"}
                  key={option.value}
                  onClick={() => setShareVisibility(option.value)}
                >
                  <Icon size={18} />
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
          <div className="expiry-grid">
            {expiryOptions.map((option) => (
              <button
                className={shareExpiry === option.value ? "visibility-card active" : "visibility-card"}
                key={option.value}
                onClick={() => setShareExpiry(option.value)}
              >
                <Clock3 size={18} />
                <span>{option.label}</span>
              </button>
            ))}
          </div>
          <PanelTitle icon={<Sparkles size={18} />} title="卡片模板" action={templateOptions.find((item) => item.value === shareTemplate)?.label ?? "模板"} />
          <div className="template-grid">
            {templateOptions.map((option) => (
              <button
                className={shareTemplate === option.value ? "template-card active" : "template-card"}
                key={option.value}
                onClick={() => setShareTemplate(option.value)}
              >
                <span className={`template-preview template-${option.value}`} />
                <strong>{option.label}</strong>
              </button>
            ))}
          </div>
          <div className="privacy-note">
            <strong>默认脱敏</strong>
            <p>隐藏 API Key、模型配置、完整原始交互，只保留 AI 整理后的摘要和统计。</p>
          </div>
          {shareCard && (
            <div className="share-celebration">
              <Sparkles size={18} />
              <div>
                <strong>卡片已准备好</strong>
                <p>二维码、公开链接和今日成就已经同步更新。</p>
              </div>
            </div>
          )}
          {shareCard?.accessCode && (
            <div className="access-code-box">
              <span>分享访问码</span>
              <strong>{shareCard.accessCode}</strong>
            </div>
          )}
          <div className="share-action-row">
            <button className="primary-btn" onClick={() => void generateShareCard()} disabled={isGenerating}>
              <Share2 size={18} />
              {isGenerating ? "生成中..." : shareGenerated ? "重新生成卡片" : "生成朋友圈卡片"}
            </button>
            <button className="soft-btn" onClick={() => void copyShareLink()} disabled={!shareCard}>
              <Link size={18} />
              复制链接
            </button>
            <button className="soft-btn" onClick={() => void exportShareImage()} disabled={!shareCard || isExporting}>
              <Download size={18} />
              {isExporting ? "导出中..." : "下载图片"}
            </button>
          </div>
          {shareActionMessage && <p className="success-text">{shareActionMessage}</p>}
          {exportError && <p className="error-text">{exportError}</p>}
        </section>
      </div>
    </section>
  );
}

function ShareQr({ value }: { value: string }) {
  const [svg, setSvg] = useState("");

  useEffect(() => {
    let isActive = true;

    QRCode.toString(value, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 1,
      width: 160,
      color: {
        dark: "#202126",
        light: "#fff8fb",
      },
    })
      .then((nextSvg) => {
        if (isActive) setSvg(nextSvg);
      })
      .catch(() => {
        if (isActive) setSvg("");
      });

    return () => {
      isActive = false;
    };
  }, [value]);

  if (!svg) {
    return <div className="qr-loading" aria-label="二维码生成中" />;
  }

  return <div className="share-qr" aria-label="分享二维码" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function AdminView() {
  const [overview, setOverview] = useState<AdminOverviewResponse | null>(null);
  const [users, setUsers] = useState<AdminUserListItem[]>([]);
  const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AgentAuditLogRow[]>([]);
  const [userSearch, setUserSearch] = useState("");
  const [feedbackFilter, setFeedbackFilter] = useState<FeedbackStatus | "all">("all");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const loadAdminData = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const [nextOverview, nextUsers, nextFeedbacks, nextAuditLogs] = await Promise.all([
        getAdminOverview(),
        listAdminUsers(userSearch),
        listAdminFeedbacks(feedbackFilter === "all" ? undefined : feedbackFilter),
        listAdminAuditLogs(),
      ]);
      setOverview(nextOverview);
      setUsers(nextUsers);
      setFeedbacks(nextFeedbacks);
      setAuditLogs(nextAuditLogs);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "后台数据加载失败");
    } finally {
      setIsLoading(false);
    }
  }, [feedbackFilter, userSearch]);

  useEffect(() => {
    void loadAdminData();
  }, [loadAdminData]);

  async function updateFeedbackStatus(id: number, status: FeedbackStatus) {
    try {
      const updated = await updateAdminFeedback(id, { status });
      setFeedbacks((current) => current.map((item) => (item.id === id ? updated : item)));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "反馈状态更新失败");
    }
  }

  const totals = overview?.totals;
  const adminStats: StatItem[] = [
    { label: "总用户", value: String(totals?.users ?? 0), icon: Users },
    { label: "今日新增", value: String(totals?.newUsersToday ?? 0), icon: Plus },
    { label: "7日活跃", value: String(totals?.activeUsers7d ?? 0), icon: Sparkles },
    { label: "待处理反馈", value: String(totals?.openFeedbacks ?? 0), icon: MessageSquareText },
  ];

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="Admin Console"
        title="后台管理"
        copy="查看用户增长、使用频率、反馈处理和 Agent 调用审计。"
      >
        <button className="soft-btn" onClick={() => void loadAdminData()}>
          <RefreshCw size={18} />
          {isLoading ? "刷新中..." : "刷新"}
        </button>
      </PageHeader>
      {error && <p className="error-text">{error}</p>}
      <StatsGrid stats={adminStats} />
      <div className="admin-grid">
        <section className="panel admin-wide">
          <PanelTitle icon={<CalendarDays size={18} />} title="近 14 天趋势" action="Daily" />
          <div className="admin-daily-grid">
            {(overview?.daily ?? []).map((day) => (
              <article className="admin-daily-card" key={day.date}>
                <strong>{day.date.slice(5)}</strong>
                <span>新增 {day.newUsers}</span>
                <span>活跃 {day.activeUsers}</span>
                <span>日记 {day.diaries}</span>
                <span>反馈 {day.feedbacks}</span>
              </article>
            ))}
          </div>
        </section>
        <section className="panel admin-wide">
          <PanelTitle icon={<Users size={18} />} title="用户列表" action={`${users.length} 人`} />
          <div className="inline-form admin-search">
            <input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="搜索用户名或昵称" />
            <button className="soft-btn" onClick={() => void loadAdminData()}>
              搜索
            </button>
          </div>
          <div className="admin-table">
            {users.map((user) => (
              <article className="admin-user-row" key={user.id}>
                <div>
                  <strong>{user.nickname || user.username}</strong>
                  <span>@{user.username} · {user.role} · {user.status}</span>
                  <span>注册 {formatDateTime(user.created_at)} · 最近登录 {user.last_login_at ? formatDateTime(user.last_login_at) : "暂无"}</span>
                </div>
                <div className="admin-user-metrics">
                  <span>日记 {user.diary_count}</span>
                  <span>Agent {user.agent_diary_count}</span>
                  <span>待办 {user.todo_count}</span>
                  <span>Key {user.api_key_count}</span>
                  <span>分享 {user.share_card_count}</span>
                  <span>{user.has_llm_config ? "LLM 已配" : "LLM 未配"}</span>
                  <span>{user.has_embedding_config ? "Embedding 已配" : "Embedding 未配"}</span>
                </div>
              </article>
            ))}
          </div>
        </section>
        <section className="panel">
          <PanelTitle icon={<MessageSquareText size={18} />} title="问题反馈" action={`${feedbacks.length} 条`} />
          <div className="mission-archive-filters">
            {(["all", "open", "processing", "resolved", "closed"] as const).map((status) => (
              <button
                key={status}
                className={feedbackFilter === status ? "active" : ""}
                onClick={() => setFeedbackFilter(status)}
              >
                {status === "all" ? "全部" : status}
              </button>
            ))}
          </div>
          <div className="admin-feedback-list">
            {feedbacks.length > 0 ? (
              feedbacks.map((feedback) => (
                <article className="admin-feedback-card" key={feedback.id}>
                  <strong>{feedback.title}</strong>
                  <p>{feedback.content}</p>
                  <span>{feedback.type} · {feedback.status} · {feedback.username ?? "匿名"}</span>
                  <div>
                    {(["open", "processing", "resolved", "closed"] as const).map((status) => (
                      <button className="mini-danger-btn" key={status} onClick={() => void updateFeedbackStatus(feedback.id, status)}>
                        {status}
                      </button>
                    ))}
                  </div>
                </article>
              ))
            ) : (
              <div className="key-empty">
                <MessageSquareText size={22} />
                <strong>暂无反馈</strong>
                <p>用户提交的问题和建议会显示在这里。</p>
              </div>
            )}
          </div>
        </section>
        <section className="panel">
          <PanelTitle icon={<TerminalSquare size={18} />} title="Agent 调用审计" action={`${auditLogs.length} 条`} />
          <div className="admin-audit-list">
            {auditLogs.length > 0 ? (
              auditLogs.map((log) => (
                <article className="admin-audit-row" key={log.id}>
                  <strong>{log.action}</strong>
                  <span>{log.agent_name ?? "Agent"} · {log.key_mask ?? "key"} · {formatDateTime(log.created_at)}</span>
                  <p>{log.target_type ?? "target"} #{log.target_id ?? "-"}</p>
                </article>
              ))
            ) : (
              <div className="key-empty">
                <TerminalSquare size={22} />
                <strong>暂无审计记录</strong>
                <p>Agent 通过 API Key 操作后会留下审计记录。</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function PublicSharePage({ token }: { token: string }) {
  const [card, setCard] = useState<ShareCardResponse | null>(null);
  const [error, setError] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [requiresPassword, setRequiresPassword] = useState(false);

  useEffect(() => {
    void loadCard();
  }, [token]);

  async function loadCard() {
    try {
      setCard(await getPublicShareCard(token, accessCode));
      setError("");
      setRequiresPassword(false);
    } catch (caughtError) {
      if (caughtError instanceof ApiError && caughtError.status === 401) {
        setRequiresPassword(true);
        setError("");
        return;
      }
      setError(caughtError instanceof Error ? caughtError.message : "分享卡片不存在");
    }
  }

  return (
    <main className="public-share-shell" data-theme="strawberry-mint">
      <section className="public-share-card">
        {card ? (
          <>
            <div className="share-card-charm charm-ribbon" aria-hidden="true" />
            <div className="share-card-charm charm-heart" aria-hidden="true">
              ♡
            </div>
            <div className="share-stamp" aria-hidden="true">
              <span>DONE</span>
              <strong>{card.snapshot.mainMissionProgress ?? 0}%</strong>
            </div>
            <div className="share-topline">
              <Heart size={16} />
              作业本分享卡片
            </div>
            <h1>{card.title}</h1>
            <p>
              {card.snapshot.diaryCount ?? 0} 条日记 · {card.snapshot.agentDiaryCount ?? 0} 个 Agent 回顾 · 主线推进{" "}
              {card.snapshot.mainMissionProgress ?? 0}%
            </p>
            <div className="public-share-mission">
              <span>当前主线</span>
              <strong>{card.snapshot.mainMissionTitle ?? "今日工作轨迹"}</strong>
              <div className="share-progress">
                <i style={{ width: `${card.snapshot.mainMissionProgress ?? 0}%` }} />
              </div>
            </div>
            <div className="share-stats">
              <span>{card.snapshot.openTodoCount ?? 0} 个开放小目标</span>
              {(card.snapshot.topTags ?? []).slice(0, 2).map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
            <div className="qr-wrap">
              <ShareQr value={card.shareUrl} />
              <span>{card.shareUrl}</span>
            </div>
          </>
        ) : (
          <div className="public-share-empty">
            <Sparkles size={28} />
            <h1>{requiresPassword ? "输入访问码" : error || "正在打开分享卡片"}</h1>
            <p>这张卡片只展示脱敏后的摘要数据，不包含原始日记、API Key 或完整交互内容。</p>
            {requiresPassword && (
              <div className="public-access-form">
                <input
                  value={accessCode}
                  onChange={(event) => setAccessCode(event.target.value)}
                  placeholder="6 位访问码"
                  inputMode="numeric"
                />
                <button className="primary-btn" onClick={() => void loadCard()}>
                  <Lock size={18} />
                  查看卡片
                </button>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}

function SettingsView({
  currentUser,
  onUpdateProfile,
  selectedTheme,
  setSelectedTheme,
  onResetDemoData,
  modelConfig,
  onSaveModelConfig,
  onExportBackup,
  onPreviewRestore,
  onApplyRestore,
}: {
  currentUser: User | null;
  onUpdateProfile: (payload: {
    nickname?: string;
    bio?: string;
    avatar?: string;
    workProfile?: Record<string, any>;
  }) => Promise<void>;
  selectedTheme: ThemeName;
  setSelectedTheme: (theme: ThemeName) => void;
  onResetDemoData: () => void;
  modelConfig: ModelServiceConfig;
  onSaveModelConfig: (config: ModelServiceConfig) => Promise<void>;
  onExportBackup: () => Promise<void>;
  onPreviewRestore: (file: File) => Promise<RestorePreviewResponse>;
  onApplyRestore: (backup: unknown, strategy: RestoreApplyResponse["strategy"]) => Promise<RestoreApplyResponse>;
}) {
  const [profileNickname, setProfileNickname] = useState(currentUser?.nickname || "");
  const [profileBio, setProfileBio] = useState(currentUser?.bio || "");
  const [profileAvatar, setProfileAvatar] = useState(currentUser?.avatar || "");
  const [profileIndustry, setProfileIndustry] = useState(currentUser?.workProfile?.industryBackground || "");
  const [profileRole, setProfileRole] = useState(currentUser?.workProfile?.jobRole || "");
  const [profileTerms, setProfileTerms] = useState(currentUser?.workProfile?.specializedTerms || "");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [profileSuccess, setProfileSuccess] = useState(false);
  const [feedbackType, setFeedbackType] = useState<FeedbackType>("bug");
  const [feedbackTitle, setFeedbackTitle] = useState("");
  const [feedbackContent, setFeedbackContent] = useState("");
  const [feedbackContact, setFeedbackContact] = useState("");
  const [feedbackStatusText, setFeedbackStatusText] = useState("");

  useEffect(() => {
    if (currentUser) {
      setProfileNickname(currentUser.nickname || "");
      setProfileBio(currentUser.bio || "");
      setProfileAvatar(currentUser.avatar || "");
      setProfileIndustry(currentUser.workProfile?.industryBackground || "");
      setProfileRole(currentUser.workProfile?.jobRole || "");
      setProfileTerms(currentUser.workProfile?.specializedTerms || "");
    }
  }, [currentUser]);

  async function saveUserProfile() {
    setIsSavingProfile(true);
    setProfileError("");
    setProfileSuccess(false);

    try {
      await onUpdateProfile({
        nickname: profileNickname.trim() || undefined,
        bio: profileBio.trim() || undefined,
        avatar: profileAvatar.trim() || undefined,
        workProfile: {
          industryBackground: profileIndustry.trim(),
          jobRole: profileRole.trim(),
          specializedTerms: profileTerms.trim(),
        },
      });
      setProfileSuccess(true);
      setTimeout(() => setProfileSuccess(false), 3000);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "保存个人资料失败");
    } finally {
      setIsSavingProfile(false);
    }
  }

  async function submitFeedback() {
    if (!feedbackTitle.trim() || !feedbackContent.trim()) {
      setFeedbackStatusText("请填写反馈标题和具体内容");
      return;
    }

    try {
      await createFeedback({
        type: feedbackType,
        title: feedbackTitle.trim(),
        content: feedbackContent.trim(),
        contact: feedbackContact.trim() || undefined,
      });
      setFeedbackTitle("");
      setFeedbackContent("");
      setFeedbackContact("");
      setFeedbackStatusText("反馈已提交，管理员会在后台处理。");
    } catch (error) {
      setFeedbackStatusText(error instanceof Error ? error.message : "反馈提交失败");
    }
  }

  const [modelDraft, setModelDraft] = useState<ModelServiceConfig>(modelConfig);
  const [isSavingModel, setIsSavingModel] = useState(false);
  const [isTestingModel, setIsTestingModel] = useState(false);
  const [modelError, setModelError] = useState("");
  const [modelTestResult, setModelTestResult] = useState<ModelConnectionTestResponse | null>(null);
  const [restorePreview, setRestorePreview] = useState<RestorePreviewResponse | null>(null);
  const [restoreBackup, setRestoreBackup] = useState<unknown>(null);
  const [restoreApplyResult, setRestoreApplyResult] = useState<RestoreApplyResponse | null>(null);
  const [restoreError, setRestoreError] = useState("");
  const [isApplyingRestore, setIsApplyingRestore] = useState(false);
  const [restoreStrategy, setRestoreStrategy] = useState<RestoreApplyResponse["strategy"]>("skip_existing");

  const [isReindexing, setIsReindexing] = useState(false);
  const [reindexResult, setReindexResult] = useState<{ total: number; chunks: number } | null>(null);
  const [reindexError, setReindexError] = useState("");

  useEffect(() => {
    setModelDraft(modelConfig);
  }, [modelConfig]);

  async function handleReindex() {
    setIsReindexing(true);
    setReindexResult(null);
    setReindexError("");
    try {
      const res = await apiRequest<{ ok: boolean; total: number; chunks: number; message?: string }>("/qa/reindex", {
        method: "POST"
      });
      if (res.ok) {
        setReindexResult({ total: res.total, chunks: res.chunks });
      } else {
        setReindexError(res.message || "重建索引失败");
      }
    } catch (error) {
      setReindexError(error instanceof Error ? error.message : "重建索引失败");
    } finally {
      setIsReindexing(false);
    }
  }

  async function saveModelConfig() {
    if (!modelDraft.chatModel.trim() || !modelDraft.embeddingModel.trim()) {
      setModelError("请填写生成模型和 Embedding 模型");
      return;
    }

    setIsSavingModel(true);
    setModelError("");

    try {
      const llmProvider = modelDraft.llmProvider?.trim() || modelDraft.provider.trim() || "OpenAI Compatible";
      const llmBaseUrl = modelDraft.llmBaseUrl?.trim() || modelDraft.baseUrl.trim() || "http://localhost:11434/v1";
      const embeddingProvider =
        modelDraft.embeddingProvider?.trim() || modelDraft.provider.trim() || "OpenAI Compatible";
      const embeddingBaseUrl =
        modelDraft.embeddingBaseUrl?.trim() || modelDraft.baseUrl.trim() || "http://localhost:11434/v1";
      await onSaveModelConfig({
        ...modelDraft,
        provider: llmProvider,
        baseUrl: llmBaseUrl,
        llmProvider,
        llmBaseUrl,
        chatModel: modelDraft.chatModel.trim(),
        llmApiKey: modelDraft.llmApiKey?.trim() || modelDraft.apiKey?.trim() || undefined,
        embeddingProvider,
        embeddingBaseUrl,
        embeddingModel: modelDraft.embeddingModel.trim(),
        embeddingApiKey: modelDraft.embeddingApiKey?.trim() || undefined,
        timeoutSeconds: Number(modelDraft.timeoutSeconds),
        apiKey: modelDraft.llmApiKey?.trim() || modelDraft.apiKey?.trim() || undefined,
      });
    } catch (error) {
      setModelError(error instanceof Error ? error.message : "模型配置保存失败");
    } finally {
      setIsSavingModel(false);
    }
  }

  async function handleTestModelConnection() {
    setIsTestingModel(true);
    setModelError("");
    setModelTestResult(null);

    try {
      const llmProvider = modelDraft.llmProvider?.trim() || modelDraft.provider.trim() || "OpenAI Compatible";
      const llmBaseUrl = modelDraft.llmBaseUrl?.trim() || modelDraft.baseUrl.trim() || "http://localhost:11434/v1";
      const embeddingProvider =
        modelDraft.embeddingProvider?.trim() || modelDraft.provider.trim() || "OpenAI Compatible";
      const embeddingBaseUrl =
        modelDraft.embeddingBaseUrl?.trim() || modelDraft.baseUrl.trim() || "http://localhost:11434/v1";
      setModelTestResult(await testModelConnection({
        ...modelDraft,
        provider: llmProvider,
        baseUrl: llmBaseUrl,
        llmProvider,
        llmBaseUrl,
        chatModel: modelDraft.chatModel.trim(),
        llmApiKey: modelDraft.llmApiKey?.trim() || modelDraft.apiKey?.trim() || undefined,
        embeddingProvider,
        embeddingBaseUrl,
        embeddingModel: modelDraft.embeddingModel.trim(),
        embeddingApiKey: modelDraft.embeddingApiKey?.trim() || undefined,
        timeoutSeconds: Number(modelDraft.timeoutSeconds),
        apiKey: modelDraft.llmApiKey?.trim() || modelDraft.apiKey?.trim() || undefined,
      }));
    } catch (error) {
      setModelError(error instanceof Error ? error.message : "模型连通性检测失败");
    } finally {
      setIsTestingModel(false);
    }
  }

  async function handleRestoreFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setRestoreError("");
    setRestorePreview(null);
    setRestoreBackup(null);
    setRestoreApplyResult(null);

    try {
      const preview = await onPreviewRestore(file);
      const text = await file.text();
      setRestorePreview(preview);
      setRestoreBackup(JSON.parse(text) as unknown);
    } catch (error) {
      setRestoreError(error instanceof Error ? error.message : "恢复预检失败");
    }
  }

  async function applyRestore() {
    if (!restoreBackup || !restorePreview?.valid) return;

    setIsApplyingRestore(true);
    setRestoreError("");

    try {
      setRestoreApplyResult(await onApplyRestore(restoreBackup, restoreStrategy));
    } catch (error) {
      setRestoreError(error instanceof Error ? error.message : "正式恢复失败");
    } finally {
      setIsApplyingRestore(false);
    }
  }

  const themes = [
    {
      name: "草莓薄荷",
      desc: "少女感、可分享、适合先发版",
      swatches: ["#ff8fbd", "#b9ead7", "#fff8fb"],
    },
    {
      name: "理性机能",
      desc: "深色科技感，适合 Agent 重度用户",
      swatches: ["#111827", "#38bdf8", "#22c55e"],
    },
    {
      name: "专业办公",
      desc: "商务、克制、适合长期工作使用",
      swatches: ["#1e3a8a", "#f8fafc", "#10b981"],
    },
    {
      name: "宋韵文房",
      desc: "宣纸、黛青、朱砂，现代宋式审美",
      swatches: ["#f8f3e7", "#233f46", "#b23a30"],
    },
    {
      name: "黑白系统",
      desc: "跟随系统亮暗色，极简黑白灰",
      swatches: ["#ffffff", "#111111", "#777777"],
    },
  ] satisfies {
    name: ThemeName;
    desc: string;
    swatches: string[];
  }[];

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="Preferences"
        title="设置"
        copy="先把本地部署、主题、模型服务和数据安全这些基础能力放到正确的位置。"
      />
      <div className="settings-grid">
        <section className="panel settings-wide">
          <PanelTitle icon={<Sparkles size={18} />} title="主题皮肤" action={selectedTheme} />
          <div className="theme-grid">
            {themes.map((theme) => (
              <button
                className={selectedTheme === theme.name ? "theme-card active" : "theme-card"}
                key={theme.name}
                onClick={() => setSelectedTheme(theme.name)}
              >
                <div className="swatches">
                  {theme.swatches.map((color) => (
                    <span key={color} style={{ background: color }} />
                  ))}
                </div>
                <strong>{theme.name}</strong>
                <p>{theme.desc}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="panel settings-wide">
          <PanelTitle icon={<ShieldCheck size={18} />} title="个人资料与工作画像" action="Work Profile" />
          <div className="model-config-form">
            <div className="profile-form-grid">
              <div>
                <div className="profile-section-title">基本信息</div>
                <label>
                  昵称
                  <input
                    value={profileNickname}
                    onChange={(event) => setProfileNickname(event.target.value)}
                    placeholder="例如：小明"
                  />
                </label>
                <label style={{ marginTop: "10px" }}>
                  头像 (Emoji 或 URL)
                  <input
                    value={profileAvatar}
                    onChange={(event) => setProfileAvatar(event.target.value)}
                    placeholder="例如：👨‍💻 或 https://..."
                  />
                </label>
                <label style={{ marginTop: "10px" }}>
                  个人简介
                  <input
                    value={profileBio}
                    onChange={(event) => setProfileBio(event.target.value)}
                    placeholder="用一句话介绍你自己"
                  />
                </label>
              </div>

              <div>
                <div className="profile-section-title">专业工作画像 (Work Profile)</div>
                <label>
                  行业背景
                  <input
                    value={profileIndustry}
                    onChange={(event) => setProfileIndustry(event.target.value)}
                    placeholder="例如：新能源汽车、移动互联网、智能硬件"
                  />
                </label>
                <label style={{ marginTop: "10px" }}>
                  岗位角色
                  <input
                    value={profileRole}
                    onChange={(event) => setProfileRole(event.target.value)}
                    placeholder="例如：资深前端工程师、技术专家、产品经理"
                  />
                </label>
                <label style={{ marginTop: "10px" }}>
                  常用专业术语 (以逗号分隔)
                  <input
                    value={profileTerms}
                    onChange={(event) => setProfileTerms(event.target.value)}
                    placeholder="例如：RAG, Next.js, Webpack, HNSW, DDL"
                  />
                </label>
              </div>
            </div>
            
            {profileError && <p className="error-text">{profileError}</p>}
            {profileSuccess && (
              <p className="success-text" style={{ color: "var(--mint-deep, #059669)", fontSize: "13px", margin: "5px 0" }}>
                ✓ 个人资料与工作画像保存成功
              </p>
            )}
            
            <button 
              className="primary-btn" 
              onClick={() => void saveUserProfile()} 
              disabled={isSavingProfile}
              style={{ marginTop: "10px", justifySelf: "start" }}
            >
              <CheckCircle2 size={18} />
              {isSavingProfile ? "保存中..." : "保存画像配置"}
            </button>
          </div>
        </section>

        <section className="panel">
          <PanelTitle icon={<MessageSquareText size={18} />} title="问题反馈" action="Feedback" />
          <div className="model-config-form">
            <label>
              类型
              <select
                value={feedbackType}
                onChange={(event) => setFeedbackType(event.target.value as FeedbackType)}
              >
                <option value="bug">Bug</option>
                <option value="suggestion">功能建议</option>
                <option value="usage">使用问题</option>
                <option value="model">模型问题</option>
                <option value="other">其他</option>
              </select>
            </label>
            <label>
              标题
              <input
                value={feedbackTitle}
                onChange={(event) => setFeedbackTitle(event.target.value)}
                placeholder="一句话说明问题"
              />
            </label>
            <label>
              具体内容
              <textarea
                value={feedbackContent}
                rows={5}
                onChange={(event) => setFeedbackContent(event.target.value)}
                placeholder="描述复现步骤、期望结果或你的建议"
              />
            </label>
            <label>
              联系方式（可选）
              <input
                value={feedbackContact}
                onChange={(event) => setFeedbackContact(event.target.value)}
                placeholder="邮箱 / 微信 / 其他联系方式"
              />
            </label>
            <button className="primary-btn" onClick={() => void submitFeedback()}>
              <MessageSquareText size={18} />
              提交反馈
            </button>
            {feedbackStatusText && <p className="success-text">{feedbackStatusText}</p>}
          </div>
        </section>

        <section className="panel">
          <PanelTitle icon={<Bot size={18} />} title="模型服务" action="模型路由" />
          <div className="model-config-form">
            <div className="model-route-group">
              <div className="profile-section-title">LLM 生成服务</div>
              <label>
                供应商
                <input
                  value={modelDraft.llmProvider ?? modelDraft.provider}
                  placeholder="OpenAI Compatible / OpenRouter / Ollama"
                  onChange={(event) =>
                    setModelDraft((current) => ({
                      ...current,
                      llmProvider: event.target.value,
                      provider: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                LLM Base URL
                <input
                  value={modelDraft.llmBaseUrl ?? modelDraft.baseUrl}
                  placeholder="https://openrouter.ai/api/v1"
                  onChange={(event) =>
                    setModelDraft((current) => ({
                      ...current,
                      llmBaseUrl: event.target.value,
                      baseUrl: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                生成模型
                <input
                  value={modelDraft.chatModel}
                  placeholder="gpt-4.1-mini / qwen-plus / llama3.1"
                  onChange={(event) => setModelDraft((current) => ({ ...current, chatModel: event.target.value }))}
                />
              </label>
              <label>
                LLM API Key
                <input
                  type="password"
                  placeholder={modelDraft.llmApiKey || modelDraft.apiKey ? "已配置，留空则不变" : "本地模型可留空"}
                  value={modelDraft.llmApiKey || ""}
                  onChange={(event) => setModelDraft((current) => ({ ...current, llmApiKey: event.target.value }))}
                />
              </label>
            </div>

            <div className="model-route-group">
              <div className="profile-section-title">Embedding 向量服务</div>
              <label>
                供应商
                <input
                  value={modelDraft.embeddingProvider ?? modelDraft.provider}
                  placeholder="OpenAI / Ollama / 自定义兼容服务"
                  onChange={(event) =>
                    setModelDraft((current) => ({ ...current, embeddingProvider: event.target.value }))
                  }
                />
              </label>
              <label>
                Embedding Base URL
                <input
                  value={modelDraft.embeddingBaseUrl ?? modelDraft.baseUrl}
                  placeholder="http://localhost:11434/v1"
                  onChange={(event) =>
                    setModelDraft((current) => ({ ...current, embeddingBaseUrl: event.target.value }))
                  }
                />
              </label>
              <label>
                Embedding 模型
                <input
                  value={modelDraft.embeddingModel}
                  placeholder="text-embedding-3-small / nomic-embed-text"
                  onChange={(event) => setModelDraft((current) => ({ ...current, embeddingModel: event.target.value }))}
                />
              </label>
              <label>
                Embedding API Key
                <input
                  type="password"
                  placeholder={modelDraft.embeddingApiKey ? "已配置，留空则不变" : "本地模型可留空"}
                  value={modelDraft.embeddingApiKey || ""}
                  onChange={(event) =>
                    setModelDraft((current) => ({ ...current, embeddingApiKey: event.target.value }))
                  }
                />
              </label>
            </div>
            <label>
              超时时间
              <input
                type="number"
                min={5}
                max={600}
                value={modelDraft.timeoutSeconds}
                onChange={(event) =>
                  setModelDraft((current) => ({ ...current, timeoutSeconds: Number(event.target.value) }))
                }
              />
            </label>
            {modelError && <p className="error-text">{modelError}</p>}
            <button className="primary-btn" onClick={() => void saveModelConfig()} disabled={isSavingModel}>
              <CheckCircle2 size={18} />
              {isSavingModel ? "保存中..." : "保存模型配置"}
            </button>
            <button className="soft-btn" onClick={() => void handleTestModelConnection()} disabled={isTestingModel}>
              <WandSparkles size={18} />
              {isTestingModel ? "检测中..." : "检测模型连接"}
            </button>
            {modelTestResult && <ModelConnectionResult result={modelTestResult} />}
          </div>
        </section>

        <section className="panel">
          <PanelTitle icon={<Database size={18} />} title="数据库状态" action="PostgreSQL" />
          <div className="database-card">
            <Database size={28} />
            <div>
              <strong>单一 PostgreSQL + pgvector</strong>
              <p>结构化业务数据和向量索引统一存储，避免多数据库同步问题。</p>
            </div>
          </div>
          <div className="status-pills">
            <span>PostgreSQL 已连接</span>
            <span>pgvector 已启用</span>
            <span>备份任务空闲</span>
          </div>
          <div className="reindex-box" style={{ marginTop: "1rem", paddingTop: "1rem", borderTop: "1px solid var(--border-color, rgba(0,0,0,0.06))" }}>
            <button 
              className="soft-btn" 
              onClick={handleReindex} 
              disabled={isReindexing}
              style={{ width: "100%", justifyContent: "center" }}
            >
              <RefreshCw size={18} className={isReindexing ? "spin" : ""} />
              {isReindexing ? "重建向量索引中..." : "重建向量索引"}
            </button>
            {reindexResult && (
              <p className="success-text" style={{ fontSize: "0.8rem", marginTop: "0.5rem", color: "var(--success-color, #10b981)" }}>
                重建成功：已索引 {reindexResult.total} 篇日记，共 {reindexResult.chunks} 个分片。
              </p>
            )}
            {reindexError && (
              <p className="error-text" style={{ fontSize: "0.8rem", marginTop: "0.5rem" }}>
                {reindexError}
              </p>
            )}
          </div>
        </section>

        <section className="panel">
          <PanelTitle icon={<ShieldCheck size={18} />} title="数据安全" action="Dry-run" />
          <div className="backup-actions">
            <button className="soft-btn" onClick={() => void onExportBackup()}>
              <Download size={18} />
              导出备份
            </button>
            <label className="soft-btn file-action">
              <Upload size={18} />
              恢复预检
              <input type="file" accept="application/json,.json" onChange={(event) => void handleRestoreFile(event)} />
            </label>
            <button className="soft-btn" onClick={onResetDemoData}>
              <RotateCcw size={18} />
              重置演示数据
            </button>
          </div>
          {restorePreview && (
            <RestorePreviewPanel
              preview={restorePreview}
              applyResult={restoreApplyResult}
              isApplying={isApplyingRestore}
              strategy={restoreStrategy}
              onStrategyChange={setRestoreStrategy}
              onApply={applyRestore}
            />
          )}
          {restoreError && <p className="error-text">{restoreError}</p>}
          <div className="privacy-note">
            <strong>恢复策略</strong>
            <p>恢复前先 dry-run，展示预计新增、覆盖、冲突和损坏文件，真正写入时用单个 SQL 事务。</p>
          </div>
        </section>
      </div>
    </section>
  );
}

function RestorePreviewPanel({
  preview,
  applyResult,
  isApplying,
  strategy,
  onStrategyChange,
  onApply,
}: {
  preview: RestorePreviewResponse;
  applyResult: RestoreApplyResponse | null;
  isApplying: boolean;
  strategy: RestoreApplyResponse["strategy"];
  onStrategyChange: (strategy: RestoreApplyResponse["strategy"]) => void;
  onApply: () => void;
}) {
  return (
    <div className={preview.valid ? "restore-preview" : "restore-preview blocked"}>
      <strong>{preview.valid ? "预检通过" : "预检未通过"}</strong>
      <div className="restore-grid">
        <span>日记 {preview.summary.diaries.incoming} 条</span>
        <span>待办 {preview.summary.todos.incoming} 个</span>
        <span>
          任务线 {preview.summary.missions.incoming} 条 / 节点 {preview.summary.missions.nodes} 个
        </span>
        <span>{preview.summary.modelConfig.willUpdate ? "更新模型配置" : "保留模型配置"}</span>
      </div>
      <p>
        新日记 {preview.summary.diaries.newItems} 条，重复日记 {preview.summary.diaries.idMatches} 条；新待办{" "}
        {preview.summary.todos.newItems} 个，重复待办 {preview.summary.todos.idMatches} 个。
      </p>
      <p>
        无效项：日记 {preview.summary.invalid.diaries} 条，待办 {preview.summary.invalid.todos} 个，任务节点{" "}
        {preview.summary.invalid.missionNodes} 个；分享卡片
        {preview.summary.shareCard.included
          ? preview.summary.shareCard.expired
            ? "已过期"
            : "可恢复"
          : "未包含"}
        。
      </p>
      {[...preview.errors, ...preview.warnings].length > 0 && (
        <ul>
          {[...preview.errors, ...preview.warnings].map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      <div className="restore-strategy-grid">
        <button
          className={strategy === "skip_existing" ? "visibility-card active" : "visibility-card"}
          onClick={() => onStrategyChange("skip_existing")}
        >
          <ShieldCheck size={18} />
          <span>跳过重复</span>
        </button>
        <button
          className={strategy === "overwrite_existing" ? "visibility-card active" : "visibility-card"}
          onClick={() => onStrategyChange("overwrite_existing")}
        >
          <RotateCcw size={18} />
          <span>覆盖重复</span>
        </button>
      </div>
      {applyResult ? (
        <p>
          已恢复：新增日记 {applyResult.summary.diaries.created} 条，更新日记 {applyResult.summary.diaries.updated} 条；新增待办{" "}
          {applyResult.summary.todos.created} 个，更新待办 {applyResult.summary.todos.updated} 个；跳过重复日记{" "}
          {applyResult.summary.diaries.skipped} 条，跳过重复待办 {applyResult.summary.todos.skipped} 个。任务线
          {applyResult.summary.missions.replaced
            ? `已替换为 ${applyResult.summary.missions.created} 条主线/支线、${applyResult.summary.missions.nodesCreated} 个节点`
            : "未替换"}
          ；分享卡片{applyResult.summary.shareCard.created ? "已恢复" : "未恢复"}。
        </p>
      ) : (
        <button className="primary-btn" onClick={onApply} disabled={!preview.valid || isApplying}>
          <Upload size={18} />
          {isApplying ? "恢复中..." : strategy === "overwrite_existing" ? "正式恢复（覆盖重复）" : "正式恢复（跳过重复）"}
        </button>
      )}
    </div>
  );
}

function ModelConnectionResult({ result }: { result: ModelConnectionTestResponse }) {
  return (
    <div className={result.ok ? "model-test-result" : "model-test-result blocked"}>
      <strong>{result.ok ? "模型连接正常" : "模型连接需要处理"}</strong>
      <div className="model-test-grid">
        <ModelTestRow label="Chat" item={result.chat} />
        <ModelTestRow label="Embedding" item={result.embedding} />
      </div>
    </div>
  );
}

function ModelTestRow({
  label,
  item,
}: {
  label: string;
  item: ModelConnectionTestResponse["chat"];
}) {
  return (
    <div className={item.ok ? "model-test-row ok" : "model-test-row failed"}>
      <span>{label}</span>
      <strong>{item.ok ? `通过 · ${item.latencyMs}ms` : `失败 · ${item.latencyMs}ms`}</strong>
      <p>{item.ok ? item.sample : item.error}</p>
    </div>
  );
}

function themeToKey(theme: ThemeName) {
  const themeMap: Record<ThemeName, string> = {
    草莓薄荷: "strawberry-mint",
    理性机能: "rational-tech",
    专业办公: "business",
    宋韵文房: "song-study",
    黑白系统: "system-mono",
  };

  return themeMap[theme];
}

function buildApiKeyExpiryDate(preset: "never" | "7d" | "30d" | "90d") {
  if (preset === "never") return null;
  const days = Number(preset.replace("d", ""));
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + days);
  return expiresAt.toISOString();
}

function formatFullDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function buildReportUrl(path?: string | null) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;

  const filename = path.split("/").filter(Boolean).pop();
  if (!filename) return null;

  const apiOrigin = API_BASE_URL.replace(/\/+$/, "").replace(/\/api$/, "");
  return `${apiOrigin || ""}/reports/${filename}`;
}

function buildTodoMissionMatches(todos: TodoItem[], missions: Mission[]) {
  const activeMissions = missions.filter((mission) => mission.status !== "已完成" || mission.progress < 100);
  const matches = new Map<number, Mission>();

  todos.forEach((todo) => {
    const boundMission = todo.missionId
      ? activeMissions.find((mission) => mission.id === todo.missionId)
      : todo.missionTitle
        ? activeMissions.find((mission) => mission.title === todo.missionTitle)
        : undefined;
    if (boundMission) {
      matches.set(todo.id, boundMission);
      return;
    }

    const text = todo.text.toLowerCase();
    const matchedMission = activeMissions.find((mission) => {
      const title = mission.title.toLowerCase();
      const titleHit = title.includes(text) || text.includes(stripMissionTitle(title));
      const tagHit = (mission.tags ?? []).some((tag) => tag && text.includes(tag.toLowerCase()));
      return titleHit || tagHit;
    });

    if (matchedMission) matches.set(todo.id, matchedMission);
  });

  return matches;
}

function stripMissionTitle(title: string) {
  return title
    .replace(/^推进「/, "")
    .replace(/」主线$/, "")
    .replace(/^支线：/, "")
    .replace(/^补强/, "")
    .replace(/^推进/, "")
    .trim();
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="config-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function PlaceholderView({ view }: { view: ViewKey }) {
  const labels: Record<ViewKey, string> = {
    dashboard: "今日",
    diary: "日记",
    missions: "任务线",
    todos: "待办",
    ai: "AI 回顾",
    share: "分享卡片",
    agent: "Agent Key",
    admin: "后台",
    settings: "设置",
  };

  return (
    <section className="page-stack">
      <PageHeader
        eyebrow="Coming Next"
        title={labels[view]}
        copy="这个模块的导航已经接好，下一步会把真实列表、详情和表单逐步补上。"
      />
      <section className="panel empty-state">
        <Sparkles size={28} />
        <h2>{labels[view]}模块准备中</h2>
        <p>先把工作流骨架立起来，再一块一块接 API 和复杂交互。</p>
      </section>
    </section>
  );
}

function PageHeader({
  eyebrow,
  title,
  copy,
  children,
}: {
  eyebrow: string;
  title: string;
  copy: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{copy}</p>
      </div>
      {children && <div className="hero-actions">{children}</div>}
    </header>
  );
}

function StatsGrid({
  stats,
}: {
  stats: StatItem[];
}) {
  return (
    <div className="stats-grid">
      {stats.map((stat) => {
        const Icon = stat.icon;
        return (
          <article className="stat-card" key={stat.label}>
            <div className="stat-icon">
              <Icon size={20} />
            </div>
            <div>
              <span>{stat.label}</span>
              <strong>{stat.value}</strong>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function DiaryComposer({
  draft,
  setDraft,
  onClose,
  onSubmit,
}: {
  draft: { title: string; summary: string; tags: string };
  setDraft: React.Dispatch<React.SetStateAction<{ title: string; summary: string; tags: string }>>;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const canSubmit = Boolean(draft.title.trim() && draft.summary.trim());

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="diary-modal" role="dialog" aria-modal="true" aria-labelledby="diary-title">
        <div className="modal-title">
          <div>
            <span>人类主动记录</span>
            <h2 id="diary-title">写一条今天的小日记</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭弹窗">
            <X size={18} />
          </button>
        </div>
        <label>
          标题
          <input
            value={draft.title}
            placeholder="例如：完成模型服务配置"
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
          />
        </label>
        <label>
          内容摘要
          <textarea
            value={draft.summary}
            placeholder="写下今天完成了什么、遇到什么问题、下一步准备做什么。"
            rows={4}
            onChange={(event) =>
              setDraft((current) => ({ ...current, summary: event.target.value }))
            }
          />
        </label>
        <label>
          标签
          <input
            value={draft.tags}
            placeholder="例如：模型配置, Agent, RAG"
            onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))}
          />
        </label>
        <div className="modal-actions">
          <button className="soft-btn" onClick={onClose}>
            先不写
          </button>
          <button className="primary-btn" onClick={onSubmit} disabled={!canSubmit}>
            <Plus size={18} />
            写入时间线
          </button>
        </div>
      </section>
    </div>
  );
}

function DiaryCard({
  entry,
  mode = "active",
  onEdit,
  onDelete,
  onRestore,
  onPermanentDelete,
}: {
  entry: DiaryEntry;
  mode?: "active" | "trash";
  onEdit?: (entry: DiaryEntry) => void;
  onDelete?: (id: number) => Promise<void>;
  onRestore?: (id: number) => Promise<void>;
  onPermanentDelete?: (id: number) => Promise<void>;
}) {
  return (
    <article className={`diary-card ${entry.source}`}>
      <div className="time-chip">{entry.time}</div>
      <div className="diary-content">
        <div className="diary-header">
          <h3>{entry.title}</h3>
          <span>{entry.source === "human" ? "人类记录" : "Agent 回顾"}</span>
        </div>
        <p>{entry.summary}</p>
        <div className="tag-row">
          {entry.tags.map((tag) => (
            <span key={tag}>{tag}</span>
          ))}
        </div>
        {(onDelete || onRestore || onPermanentDelete) && (
          <div className="diary-actions">
            {mode === "active" ? (
              <>
                <button onClick={() => onEdit?.(entry)}>
                  <PenLine size={15} />
                  编辑
                </button>
                <button onClick={() => void onDelete?.(entry.id)}>
                  <Trash2 size={15} />
                  移入回收站
                </button>
              </>
            ) : (
              <>
                <button onClick={() => void onRestore?.(entry.id)}>
                  <RotateCcw size={15} />
                  还原
                </button>
                <button className="danger" onClick={() => void onPermanentDelete?.(entry.id)}>
                  <Trash2 size={15} />
                  彻底删除
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function PanelTitle({
  icon,
  title,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  action: string;
}) {
  return (
    <div className="panel-title">
      <div>
        {icon}
        <strong>{title}</strong>
      </div>
      <span className="panel-action" title={action}>
        {action}
      </span>
    </div>
  );
}

function AuthModal({
  onClose,
  onLoginSuccess,
  allowClose,
}: {
  onClose: () => void;
  onLoginSuccess: (token: string, user: any) => void;
  allowClose: boolean;
}) {
  const [isRegister, setIsRegister] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [nickname, setNickname] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const url = isRegister ? "/auth/register" : "/auth/login";
      const body = isRegister 
        ? { username, password, nickname: nickname || undefined }
        : { username, password };

      const response = await apiRequest<{ token: string; user: any }>(url, {
        method: "POST",
        body,
      });

      onLoginSuccess(response.token, response.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : "请求失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-backdrop">
      <div className="auth-glass">
        {allowClose && (
          <button className="auth-close-btn" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        )}
        <div className="auth-header">
          <div className="auth-logo">
            <Leaf size={24} />
          </div>
          <h2>{isRegister ? "创建你的作业本账户" : "欢迎回到作业本"}</h2>
          <p>{isRegister ? "开始记录你和 Agent 的协作花园" : "输入凭证继续管理你的工作轨迹"}</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="auth-error-msg">{error}</div>}

          <div className="form-group">
            <label htmlFor="auth-username">用户名</label>
            <input
              id="auth-username"
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="请输入 3-20 位用户名"
              autoComplete="username"
            />
          </div>

          {isRegister && (
            <div className="form-group">
              <label htmlFor="auth-nickname">昵称</label>
              <input
                id="auth-nickname"
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                placeholder="起个好听的昵称吧 (可选)"
                autoComplete="nickname"
              />
            </div>
          )}

          <div className="form-group">
            <label htmlFor="auth-password">密码</label>
            <div className="password-input-wrapper">
              <input
                id="auth-password"
                type={showPassword ? "text" : "password"}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isRegister ? "长度不小于 6 位" : "请输入密码"}
                autoComplete={isRegister ? "new-password" : "current-password"}
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? "隐藏" : "显示"}
              </button>
            </div>
          </div>

          <button type="submit" className="primary-btn auth-submit-btn" disabled={loading}>
            {loading ? "处理中..." : isRegister ? "注册并登录" : "立即登录"}
          </button>
        </form>

        <div className="auth-footer">
          {isRegister ? (
            <p>
              已有账户？{" "}
              <button onClick={() => { setIsRegister(false); setError(""); }}>立即登录</button>
            </p>
          ) : (
            <p>
              没有账户？{" "}
              <button onClick={() => { setIsRegister(true); setError(""); }}>创建账户</button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
