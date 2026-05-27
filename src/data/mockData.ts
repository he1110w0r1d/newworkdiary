import type { DiaryEntry, Mission, MissionNode, TodoItem } from "../types";

export const initialDiaryEntries: DiaryEntry[] = [
  {
    id: 1,
    time: "09:20",
    title: "整理 Agent 日记产品方向",
    source: "human",
    summary: "确认产品从普通工作日记升级为人类和 Agent 共同写入的工作记忆中心。",
    tags: ["产品定位", "PRD"],
  },
  {
    id: 2,
    time: "10:48",
    title: "Agent 回顾了交互内容",
    source: "agent",
    summary: "提炼出 API Key、Skill 文档、双来源日记和任务时间线四个核心模块。",
    tags: ["Agent 回顾", "结构化"],
  },
  {
    id: 3,
    time: "14:15",
    title: "确定草莓薄荷主题",
    source: "human",
    summary: "女性主题走少女感，强调精致、可分享、完成任务有轻量正反馈。",
    tags: ["主题设计", "分享"],
  },
];

export const missions: Mission[] = [
  {
    title: "完成作业本 Web 首页 MVP",
    progress: 72,
    tone: "main",
    status: "进行中",
    summary: "首页、日记、待办、分享和 Agent Key 骨架已经成形。",
  },
  {
    title: "设计 Agent Skill 使用说明",
    progress: 48,
    tone: "side",
    status: "推进中",
    summary: "已明确 API Key、Scope、source_type 和写入格式。",
  },
  {
    title: "生成朋友圈分享卡片模板",
    progress: 64,
    tone: "side",
    status: "可预览",
    summary: "完成草莓薄荷风格分享卡片预览和隐私设置。",
  },
];

export const missionNodes: MissionNode[] = [
  { time: "09:20", title: "确定 Agent 工作日记定位", status: "已完成", source: "人类记录" },
  { time: "10:48", title: "整理 API Key 与 Skill 接入方式", status: "已完成", source: "Agent 回顾" },
  { time: "14:15", title: "落地草莓薄荷主题首页", status: "进行中", source: "人类记录" },
  { time: "16:10", title: "补齐待办与分享页面", status: "已完成", source: "Agent 回顾" },
];

export const initialTodos: TodoItem[] = [
  { id: 1, text: "补充 Agent 写入日记接口字段", done: false },
  { id: 2, text: "确认分享卡片隐私默认值", done: true },
  { id: 3, text: "把任务线和待办的关联规则写进开发文档", done: false },
];
