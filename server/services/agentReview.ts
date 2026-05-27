import type { DiaryEntry, TodoItem } from "../../src/types";

type ReviewSnapshot = {
  diaries: DiaryEntry[];
  todos: TodoItem[];
};

export type AgentReviewResult = {
  diary: Omit<DiaryEntry, "id">;
  todo: Omit<TodoItem, "id">;
};

export function buildAgentReview(snapshot: ReviewSnapshot): AgentReviewResult {
  const humanDiaries = snapshot.diaries.filter((entry) => entry.source === "human");
  const agentDiaries = snapshot.diaries.filter((entry) => entry.source === "agent");
  const openTodos = snapshot.todos.filter((todo) => !todo.done);
  const doneTodos = snapshot.todos.filter((todo) => todo.done);
  const topTags = getTopTags(snapshot.diaries);
  const latestHuman = humanDiaries[0];
  const focusText = topTags.length > 0 ? topTags.join("、") : latestHuman?.title ?? "今天的工作推进";
  const progressText =
    doneTodos.length > 0
      ? `已完成 ${doneTodos.length} 个小目标，开放 ${openTodos.length} 个待办`
      : `目前还有 ${openTodos.length} 个开放待办等待推进`;
  const sourceText =
    humanDiaries.length > 0
      ? `人类主动记录了 ${humanDiaries.length} 条内容`
      : "今天还缺少人类主动记录";
  const agentText =
    agentDiaries.length > 0 ? `Agent 已补充 ${agentDiaries.length} 条回顾` : "Agent 正在建立第一条回顾";
  const nextTodo = buildNextTodo(openTodos, topTags, latestHuman);

  return {
    diary: {
      time: getCurrentTime(),
      title: `Agent 回顾：${focusText}`,
      source: "agent",
      summary: `${sourceText}，${agentText}。当前主线集中在 ${focusText}，${progressText}。建议下一步先收束一个最小可验证动作，再继续扩展体验。`,
      tags: ["Agent 回顾", "自动整理", ...topTags].slice(0, 6),
    },
    todo: {
      text: nextTodo,
      done: false,
    },
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

function buildNextTodo(openTodos: TodoItem[], topTags: string[], latestHuman?: DiaryEntry) {
  if (openTodos.length > 0) {
    return `收束开放小目标：${openTodos[0].text}`;
  }

  if (topTags[0]) {
    return `围绕「${topTags[0]}」补一条可验证的小进展`;
  }

  if (latestHuman) {
    return `把「${latestHuman.title}」拆成一个 30 分钟内能完成的小目标`;
  }

  return "写下今天最重要的一条工作进展";
}

function getCurrentTime() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date());
}
