import type { DiaryEntry, Mission, MissionNode, TodoItem } from "../../src/types";

type MissionSnapshot = {
  diaries: DiaryEntry[];
  todos: TodoItem[];
};

export type MissionPlan = {
  missions: Mission[];
  nodes: MissionNode[];
};

export type OnboardingMissionStatus = {
  llmConfigured: boolean;
  embeddingConfigured: boolean;
  diaryCreated: boolean;
  agentKeyCreated: boolean;
};

const defaultOnboardingStatus: OnboardingMissionStatus = {
  llmConfigured: false,
  embeddingConfigured: false,
  diaryCreated: false,
  agentKeyCreated: false,
};

export function isOnboardingMissionPlan(plan: MissionPlan) {
  return plan.missions.some((mission) => mission.title === "完成作业本基础配置");
}

export function isOnboardingComplete(status: Partial<OnboardingMissionStatus>) {
  return Boolean(status.llmConfigured && status.embeddingConfigured && status.diaryCreated && status.agentKeyCreated);
}

export function buildOnboardingMissionPlan(status: Partial<OnboardingMissionStatus> = {}): MissionPlan {
  const current = { ...defaultOnboardingStatus, ...status };
  const completedCount = [
    current.llmConfigured,
    current.embeddingConfigured,
    current.diaryCreated,
    current.agentKeyCreated,
  ].filter(Boolean).length;
  const mainProgress = Math.min(20 + completedCount * 20, 100);
  const mainCompleted = completedCount === 4;
  const step = (done: boolean) => ({
    progress: done ? 100 : 0,
    status: done ? "已完成" : "待推进",
  });
  const llmStep = step(current.llmConfigured);
  const embeddingStep = step(current.embeddingConfigured);
  const diaryStep = step(current.diaryCreated);
  const agentStep = step(current.agentKeyCreated);

  return {
    missions: [
      {
        title: "完成作业本基础配置",
        progress: mainProgress,
        tone: "main",
        status: mainCompleted ? "已完成" : "进行中",
        summary: `已完成 ${completedCount}/4 项基础配置：模型服务、Agent 接入和第一条日记会让作业本具备可用的 AI 工作日记能力。`,
        tags: ["新手引导", "基础配置"],
        aiReason: "系统为新账号创建的新手引导任务线，不是根据日记自动推断的工作主线。",
      },
      {
        title: "配置 LLM 生成服务",
        progress: llmStep.progress,
        tone: "side",
        status: llmStep.status,
        summary: "填写 LLM Provider、Base URL、模型名和 API Key，用于日报总结、Agent 回顾和内容结构化。",
        tags: ["LLM", "模型服务"],
        aiReason: "AI 总结和 Agent 回顾依赖生成模型。",
      },
      {
        title: "配置 Embedding 向量服务",
        progress: embeddingStep.progress,
        tone: "side",
        status: embeddingStep.status,
        summary: "填写 Embedding Provider、Base URL、模型名和 API Key，用于 RAG 检索、历史日记问答和任务线分析。",
        tags: ["Embedding", "RAG"],
        aiReason: "历史检索和语义问答依赖向量模型。",
      },
      {
        title: "写入第一条工作日记",
        progress: diaryStep.progress,
        tone: "side",
        status: diaryStep.status,
        summary: "记录一条真实工作进展，让总结、任务线和待办生成有可分析的数据来源。",
        tags: ["日记", "开始使用"],
        aiReason: "工作日记是后续任务线和总结的基础数据。",
      },
      {
        title: "生成第一个 Agent Key",
        progress: agentStep.progress,
        tone: "side",
        status: agentStep.status,
        summary: "给 Codex、Claude Code、Cursor 等 Agent 生成独立 API Key，让它们能安全写入日记和维护待办。",
        tags: ["Agent", "API Key"],
        aiReason: "Agent 接入是作业本区别于普通日记工具的关键能力。",
      },
    ],
    nodes: [
      {
        time: "09:00",
        title: "进入作业本新手配置",
        status: mainCompleted ? "已完成" : "进行中",
        source: "系统引导",
        summary: mainCompleted
          ? "基础配置已经完成，可以继续记录日记并生成真实工作任务线。"
          : "先完成 LLM、Embedding、第一条日记和 Agent Key，之后系统会根据真实日记生成工作任务线。",
      },
    ],
  };
}

export function buildMissionPlan(snapshot: MissionSnapshot): MissionPlan {
  if (snapshot.diaries.length === 0 && snapshot.todos.length === 0) {
    return buildOnboardingMissionPlan();
  }

  const topTags = getTopTags(snapshot.diaries);
  const openTodos = snapshot.todos.filter((todo) => !todo.done);
  const doneTodos = snapshot.todos.filter((todo) => todo.done);
  const completionRate = Math.round((doneTodos.length / Math.max(snapshot.todos.length, 1)) * 100);
  const recentDiaries = snapshot.diaries.slice(0, 5);
  const mainFocuses = buildMainFocuses(topTags, recentDiaries);
  const sideMissionDrafts = mainFocuses.flatMap((focus, mainIndex) => {
    const sideLabels =
      focus.source === "tag"
        ? [focus.label]
        : dedupeLabels(focus.relatedDiaries.slice(0, 2).map((entry) => getDiaryFocusLabel(entry)));
    return sideLabels.map((label, index) => {
      const relatedDiaries =
        focus.source === "tag"
          ? focus.relatedDiaries.filter((entry) => entry.tags.includes(label) || entry.title.includes(label))
          : focus.relatedDiaries.filter((entry) => getDiaryFocusLabel(entry) === label);
      const completed = relatedDiaries.some((entry) => hasCompletionSignalText(`${entry.title} ${entry.summary}`));
      return {
        label,
        source: focus.source,
        mainLabel: focus.label,
        mainIndex,
        index,
        completed,
      };
    });
  });
  const sideCompletionRate =
    sideMissionDrafts.length > 0
      ? sideMissionDrafts.filter((mission) => mission.completed).length / sideMissionDrafts.length
      : 0;
  const mainProgress = clamp(
    38 + completionRate * 0.3 + sideCompletionRate * 18 + Math.min(snapshot.diaries.length, 8) * 4,
    35,
    96,
  );
  const hasCompletionSignal = recentDiaries.some((entry) => hasCompletionSignalText(`${entry.title} ${entry.summary}`));
  const allSideMissionsCompleted = sideMissionDrafts.length > 0 && sideMissionDrafts.every((mission) => mission.completed);
  const mainCompleted =
    (hasCompletionSignal || allSideMissionsCompleted) && openTodos.length === 0 && snapshot.diaries.length > 0;

  const missions: Mission[] = [];

  mainFocuses.forEach((focus, index) => {
    const relatedSideDrafts = sideMissionDrafts.filter((draft) => draft.mainLabel === focus.label);
    const focusCompletionRate =
      relatedSideDrafts.length > 0
        ? relatedSideDrafts.filter((mission) => mission.completed).length / relatedSideDrafts.length
        : 0;
    const focusHasCompletionSignal = focus.relatedDiaries.some((entry) =>
      hasCompletionSignalText(`${entry.title} ${entry.summary}`),
    );
    const focusCompleted =
      (focusHasCompletionSignal || (relatedSideDrafts.length > 0 && relatedSideDrafts.every((mission) => mission.completed))) &&
      openTodos.length === 0;
    const focusProgress = clamp(mainProgress - index * 7 + focusCompletionRate * 12, 32, 96);
    missions.push({
      title: `推进「${focus.label}」主线`,
      progress: focusCompleted ? 100 : focusProgress,
      tone: "main",
      status: focusCompleted ? "已完成" : "进行中",
      summary: `根据 ${focus.relatedDiaries.length} 条相关日记识别，当前主线集中在 ${focus.label}。`,
      tags: focus.source === "tag" ? [focus.label] : focus.relatedDiaries.flatMap((entry) => entry.tags).slice(0, 3),
      aiReason: focusCompleted
        ? "相关日记出现明确完成信号，且当前没有开放待办，系统自动判定该主线已完成。"
        : focus.source === "tag"
          ? "由高频日记标签独立拆分出的并行主线。"
          : "由最近日记标题兜底拆分出的并行主线。",
    });
  });

  sideMissionDrafts.forEach(({ label, source, mainLabel, index, completed: sideCompleted }) => {
    missions.push({
      title: source === "tag" ? `支线：补强${label}` : `支线：推进${label}`,
      parentTitle: `推进「${mainLabel}」主线`,
      progress: sideCompleted ? 100 : clamp(42 + completionRate * 0.25 - index * 8, 20, 86),
      tone: "side",
      status: sideCompleted ? "已完成" : index === 0 ? "推进中" : "规划中",
      summary:
        source === "tag"
          ? `从相关日记中识别到「${label}」仍有延展空间，适合拆成轻量行动项持续推进。`
          : `从最近日记「${label}」拆出的支线，用来承接主线里的具体推进动作。`,
      tags: [label],
      aiReason: sideCompleted
        ? `最近「${label}」相关日记出现明确完成信号，系统自动判定该支线已完成。`
        : source === "tag"
          ? `标签「${label}」在近期记录中出现频率较高。`
          : `当前日记缺少可聚合标签，系统根据最近日记标题兜底生成支线。`,
    });
  });

  if (openTodos[0]) {
    missions.push({
      title: "支线：收束开放待办",
      progress: clamp(100 - openTodos.length * 18, 18, 76),
      tone: "side",
      status: "待推进",
      summary: `当前仍有 ${openTodos.length} 个开放待办，优先处理「${openTodos[0].text}」。`,
      tags: ["待办"],
      aiReason: "由未完成待办自动生成，用于避免任务线和行动项脱节。",
    });
  }

  const nodes = recentDiaries.map((entry) => ({
    time: entry.time,
    title: entry.title,
    missionTitle: findMissionTitleForDiary(entry, mainFocuses),
    status: entry.source === "agent" ? "已整理" : "已记录",
    source: entry.source === "agent" ? "Agent 回顾" : "人类记录",
    summary: entry.summary,
  }));

  return {
    missions,
    nodes,
  };
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

function buildMainFocuses(topTags: string[], recentDiaries: DiaryEntry[]) {
  const tagFocuses = topTags.slice(0, 3).map((label) => ({
    label,
    source: "tag" as const,
    relatedDiaries: recentDiaries.filter((entry) => entry.tags.includes(label)),
  }));

  if (tagFocuses.length > 0) return tagFocuses;

  return dedupeLabels(
    recentDiaries.slice(0, 3).map((entry) => ({
      label: getDiaryFocusLabel(entry),
      source: "diary" as const,
      relatedDiaries: [entry],
    })),
  );
}

function findMissionTitleForDiary(
  entry: DiaryEntry,
  mainFocuses: Array<{ label: string; source: "tag" | "diary"; relatedDiaries: DiaryEntry[] }>,
) {
  const matchedFocus =
    mainFocuses.find((focus) => focus.source === "tag" && entry.tags.includes(focus.label)) ??
    mainFocuses.find((focus) => focus.relatedDiaries.some((related) => related.id === entry.id)) ??
    mainFocuses[0];

  return matchedFocus ? `推进「${matchedFocus.label}」主线` : undefined;
}

function hasCompletionSignalText(text: string) {
  if (/基本完成|初步完成|大致完成|还需|仍需|需要继续|下一步|待完善|待优化|还没有完成|未完成/i.test(text)) {
    return false;
  }

  return /已完成|搞定|收尾完成|上线|部署完成|验收通过|可以交付|告一段落|mvp\s*完成/i.test(text);
}

function getDiaryFocusLabel(entry?: DiaryEntry) {
  const fallback = "作业本工作流";
  const rawLabel = entry?.title?.trim() || entry?.tags?.[0]?.trim() || fallback;
  return rawLabel.length > 18 ? `${rawLabel.slice(0, 18)}...` : rawLabel;
}

function dedupeLabels<T extends string | { label: string }>(items: T[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const label = typeof item === "string" ? item : item.label;
    if (seen.has(label)) return false;
    seen.add(label);
    return true;
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.round(Math.min(Math.max(value, min), max));
}
