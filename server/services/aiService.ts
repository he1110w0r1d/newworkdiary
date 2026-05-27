import { pool } from "../db";
import type { ModelServiceConfig, DiaryEntry } from "../../src/types";
import { 
  getPostgresSummary, 
  createPostgresSummary, 
  insertPostgresDiaryEmbedding, 
  clearPostgresDiaryEmbeddings, 
  searchPostgresDiaryEmbeddings,
  SummaryRow
} from "../repositories/postgresRepository";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 静态报表托管目录
const REPORTS_DIR = path.join(__dirname, "../public/reports");

// 确保报表目录存在
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

/**
 * 原生 Fetch 调用大模型聊天接口
 */
export async function callLLMChat(
  config: ModelServiceConfig,
  messages: Array<{ role: string; content: string }>,
  systemPrompt?: string
): Promise<string> {
  const baseUrl = config.llmBaseUrl || config.baseUrl;
  const apiKey = config.llmApiKey || config.apiKey;
  const { chatModel, timeoutSeconds } = config;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), (timeoutSeconds ?? 60) * 1000);

  const requestMessages = systemPrompt 
    ? [{ role: "system", content: systemPrompt }, ...messages]
    : messages;

  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: chatModel,
        messages: requestMessages,
        temperature: 0.3,
      }),
      signal: controller.signal,
    });

    clearTimeout(id);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`LLM API returned status ${response.status}: ${errText}`);
    }

    const data = await response.json() as any;
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Invalid response structure from LLM");
    }

    return content as string;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

/**
 * 原生 Fetch 调用大模型 Embedding 接口
 */
export async function callEmbedding(
  config: ModelServiceConfig,
  text: string
): Promise<number[]> {
  const baseUrl = config.embeddingBaseUrl || config.baseUrl;
  const apiKey = config.embeddingApiKey || config.apiKey;
  const { embeddingModel, timeoutSeconds } = config;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), (timeoutSeconds ?? 60) * 1000);

  const url = `${baseUrl.replace(/\/+$/, "")}/embeddings`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: embeddingModel,
        input: text,
      }),
      signal: controller.signal,
    });

    clearTimeout(id);

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Embedding API returned status ${response.status}: ${errText}`);
    }

    const data = await response.json() as any;
    const embedding = data?.data?.[0]?.embedding;
    if (!Array.isArray(embedding)) {
      throw new Error("Invalid response structure from Embedding API");
    }

    return embedding as number[];
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

/**
 * 周期日期起止转换函数
 */
export function getPeriodRange(type: string, dateStr: string): { start: Date; end: Date } {
  const baseDate = new Date(dateStr);
  if (isNaN(baseDate.getTime())) {
    throw new Error(`Invalid date format: ${dateStr}`);
  }

  let start: Date;
  let end: Date;

  switch (type) {
    case "daily":
      start = new Date(baseDate.setHours(0, 0, 0, 0));
      end = new Date(baseDate.setHours(23, 59, 59, 999));
      break;
    case "weekly": {
      const day = baseDate.getDay();
      const diffToMonday = day === 0 ? -6 : 1 - day; // 周日是0，周一是1
      const monday = new Date(baseDate.setDate(baseDate.getDate() + diffToMonday));
      start = new Date(monday.setHours(0, 0, 0, 0));
      
      const sunday = new Date(monday.setDate(monday.getDate() + 6));
      end = new Date(sunday.setHours(23, 59, 59, 999));
      break;
    }
    case "monthly": {
      start = new Date(baseDate.getFullYear(), baseDate.getMonth(), 1, 0, 0, 0, 0);
      end = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 0, 23, 59, 59, 999);
      break;
    }
    case "yearly":
      start = new Date(baseDate.getFullYear(), 0, 1, 0, 0, 0, 0);
      end = new Date(baseDate.getFullYear(), 11, 31, 23, 59, 59, 999);
      break;
    default:
      throw new Error(`Unknown period type: ${type}`);
  }

  return { start, end };
}

/**
 * 段落敏感切片算法 (段落超 800 字切分)
 */
export function splitDiaryIntoChunks(diary: {
  id: number;
  time: string;
  title: string;
  tags: string[];
  summary: string;
  location?: string;
}): Array<{ chunkId: string; text: string }> {
  const metadata = `时间: ${diary.time}\n标题: ${diary.title}\n标签: ${diary.tags.join(", ")}${diary.location ? `\n地点: ${diary.location}` : ""}`;
  const fullText = `${metadata}\n正文内容:\n${diary.summary}`;

  if (fullText.length <= 800) {
    return [{ chunkId: `${diary.id}:0`, text: fullText }];
  }

  // 段落敏感切分
  const paragraphs = diary.summary.split(/\n+/);
  const chunks: Array<{ chunkId: string; text: string }> = [];
  let chunkIdx = 0;
  let currentBuffer = "";

  for (const para of paragraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    if (currentBuffer.length + trimmed.length > 700) {
      if (currentBuffer) {
        chunks.push({
          chunkId: `${diary.id}:${chunkIdx++}`,
          text: `${metadata}\n正文内容分片:\n${currentBuffer}`,
        });
      }
      
      if (trimmed.length > 700) {
        // 如果单段落超过700，强制按字数切断
        let offset = 0;
        while (offset < trimmed.length) {
          const part = trimmed.substring(offset, offset + 700);
          chunks.push({
            chunkId: `${diary.id}:${chunkIdx++}`,
            text: `${metadata}\n正文内容分片(接上文):\n${part}`,
          });
          offset += 700;
        }
        currentBuffer = "";
      } else {
        currentBuffer = trimmed;
      }
    } else {
      currentBuffer = currentBuffer ? `${currentBuffer}\n${trimmed}` : trimmed;
    }
  }

  if (currentBuffer) {
    chunks.push({
      chunkId: `${diary.id}:${chunkIdx++}`,
      text: `${metadata}\n正文内容分片:\n${currentBuffer}`,
    });
  }

  return chunks;
}

/**
 * HTML 代码清洗与自愈
 */
function healHTMLContent(html: string): string {
  let cleaned = html.trim();
  // 去除 markdown 的 ```html 包裹
  if (cleaned.startsWith("```html")) {
    cleaned = cleaned.substring(7);
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.substring(0, cleaned.length - 3);
  }
  cleaned = cleaned.trim();

  // 自愈：补充缺少的头部/尾部标签
  if (!cleaned.toLowerCase().includes("<!doctype html>")) {
    cleaned = `<!DOCTYPE html>\n${cleaned}`;
  }
  if (!cleaned.toLowerCase().includes("<html")) {
    cleaned = cleaned.replace("<!DOCTYPE html>", "<!DOCTYPE html>\n<html>");
  }
  if (!cleaned.toLowerCase().includes("</html>")) {
    cleaned = `${cleaned}\n</html>`;
  }
  if (!cleaned.toLowerCase().includes("<head>")) {
    cleaned = cleaned.replace("<html", "<html>\n<head>\n</head>\n<html"); // 粗略补齐，后面有更好的默认退回
  }
  if (!cleaned.toLowerCase().includes("<body>")) {
    cleaned = cleaned.replace("</head>", "</head>\n<body>");
  }
  if (!cleaned.toLowerCase().includes("</body>")) {
    cleaned = cleaned.replace("</html>", "</body>\n</html>");
  }

  return cleaned;
}

/**
 * 默认网页报表模板 (包含 Chart.js 自愈退回)
 */
function buildDefaultHtmlReport(
  type: string,
  dateStr: string,
  totalTime: number,
  diariesCount: number,
  tagDistribution: Record<string, number>,
  dailyHours: Array<{ date: string; hours: number }>,
  markdown: string
): string {
  const tagsLabels = Object.keys(tagDistribution);
  const tagsValues = Object.values(tagDistribution);

  const hoursLabels = dailyHours.map(d => d.date);
  const hoursValues = dailyHours.map(d => d.hours);

  // Markdown 转 HTML 简单渲染器
  const simpleHtmlContent = markdown
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/^\* (.*$)/gim, '<li>$1</li>')
    .replace(/^- (.*$)/gim, '<li>$1</li>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br/>');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${type.toUpperCase()} 工作总结报表 (${dateStr})</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    :root {
      --primary: #ff8fbd;
      --bg: #fff8fb;
      --text: #2c3e50;
      --panel-bg: rgba(255, 255, 255, 0.9);
      --border: rgba(255, 143, 189, 0.18);
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 24px;
      line-height: 1.6;
    }
    .container {
      max-width: 1000px;
      margin: 0 auto;
    }
    header {
      background: linear-gradient(135deg, var(--primary), #b9ead7);
      padding: 32px;
      border-radius: 16px;
      color: white;
      margin-bottom: 24px;
      box-shadow: 0 12px 24px rgba(255, 143, 189, 0.15);
    }
    header h1 { margin: 0 0 8px 0; font-size: 28px; }
    header p { margin: 0; opacity: 0.9; font-size: 16px; }
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 20px;
      margin-bottom: 24px;
    }
    .metric-card {
      background: var(--panel-bg);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      text-align: center;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.02);
    }
    .metric-card strong { display: block; font-size: 28px; color: var(--primary); margin-bottom: 4px; }
    .metric-card span { font-size: 14px; color: #7f8c8d; }
    .charts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
      gap: 24px;
      margin-bottom: 32px;
    }
    .chart-panel {
      background: var(--panel-bg);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 6px 18px rgba(0,0,0,0.02);
    }
    .chart-panel h3 { margin: 0 0 16px 0; color: var(--text); border-bottom: 2px solid var(--border); padding-bottom: 8px; }
    .content-panel {
      background: var(--panel-bg);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 32px;
      box-shadow: 0 6px 18px rgba(0,0,0,0.02);
    }
    .content-panel h2 { color: var(--primary); border-left: 4px solid var(--primary); padding-left: 12px; margin-top: 0; }
    .chart-container { position: relative; height: 300px; width: 100%; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>${type === "daily" ? "日报" : type === "weekly" ? "周报" : type === "monthly" ? "月报" : "年报"} 智能工作总结报表</h1>
      <p>周期时间段: ${dateStr}</p>
    </header>

    <div class="metrics-grid">
      <div class="metric-card">
        <strong>${(totalTime / 60).toFixed(1)}h</strong>
        <span>总计工时</span>
      </div>
      <div class="metric-card">
        <strong>${diariesCount} 条</strong>
        <span>记录条数</span>
      </div>
      <div class="metric-card">
        <strong>${tagsLabels.length} 个</strong>
        <span>使用标签</span>
      </div>
    </div>

    <div class="charts-grid">
      <div class="chart-panel">
        <h3>工作标签分布</h3>
        <div class="chart-container">
          <canvas id="tagsChart"></canvas>
        </div>
      </div>
      <div class="chart-panel">
        <h3>工时趋势</h3>
        <div class="chart-container">
          <canvas id="trendChart"></canvas>
        </div>
      </div>
    </div>

    <div class="content-panel">
      <h2>AI 总结正文</h2>
      <div>${simpleHtmlContent}</div>
    </div>
  </div>

  <script>
    // 渲染标签饼图
    const tagsCtx = document.getElementById('tagsChart').getContext('2d');
    new Chart(tagsCtx, {
      type: 'doughnut',
      data: {
        labels: ${JSON.stringify(tagsLabels)},
        datasets: [{
          data: ${JSON.stringify(tagsValues)},
          backgroundColor: ['#ff8fbd', '#b9ead7', '#ffcae4', '#d2f3e6', '#ffe6f0', '#9ae8c7'],
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false
      }
    });

    // 渲染工时柱状/折线图
    const trendCtx = document.getElementById('trendChart').getContext('2d');
    new Chart(trendCtx, {
      type: 'bar',
      data: {
        labels: ${JSON.stringify(hoursLabels)},
        datasets: [{
          label: '日工时 (小时)',
          data: ${JSON.stringify(hoursValues)},
          backgroundColor: 'rgba(255, 143, 189, 0.65)',
          borderColor: 'rgba(255, 143, 189, 1)',
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true }
        }
      }
    });
  </script>
</body>
</html>`;
}

/**
 * 核心生成总结服务（含 LLM 调用、建议待办两阶段事务插入、HTML 渲染与自愈）
 */
export async function generateSummaryAndRegisterTodos(
  config: ModelServiceConfig,
  userId: number,
  type: string,
  dateStr: string,
  workProfile?: Record<string, any>
): Promise<{ summary: SummaryRow; todos: any[] }> {
  const { start, end } = getPeriodRange(type, dateStr);

  // 1. 查询数据库中该周期的所有日记
  const diariesResult = await pool.query<{
    id: number;
    title: string;
    content: string;
    summary: string;
    start_time: Date;
    end_time: Date;
    tags: string[];
    source_type: string;
  }>(
    `
      SELECT id, title, content, summary, start_time, end_time, tags, source_type
      FROM diaries
      WHERE user_id = $1 AND start_time >= $2 AND start_time <= $3 AND is_deleted = FALSE
      ORDER BY start_time ASC
    `,
    [userId, start, end]
  );

  const entries = diariesResult.rows;

  // 2. 统计指标计算
  let totalMinutes = 0;
  const tagCounts: Record<string, number> = {};
  const dateHoursMap: Record<string, number> = {};

  entries.forEach((row) => {
    const diffMs = new Date(row.end_time).getTime() - new Date(row.start_time).getTime();
    const minutes = Math.round(diffMs / 60000);
    totalMinutes += minutes;

    // 标签统计
    if (Array.isArray(row.tags)) {
      row.tags.forEach((t) => {
        tagCounts[t] = (tagCounts[t] ?? 0) + 1;
      });
    }

    // 按天统计工时
    const dayStr = new Date(row.start_time).toLocaleDateString("zh-CN");
    dateHoursMap[dayStr] = (dateHoursMap[dayStr] ?? 0) + minutes / 60;
  });

  const dailyHours = Object.entries(dateHoursMap).map(([date, hours]) => ({
    date,
    hours: Number(hours.toFixed(2)),
  }));

  // 如果条目为空，则静默降级，不发生报错
  if (entries.length === 0) {
    const emptyContent = "该时间段内没有查找到任何日记记录，无法生成智能总结。建议在此期间记录几条工作进展。";
    const filename = `${type}_${userId}_${dateStr}.html`;
    const fullPath = path.join(REPORTS_DIR, filename);
    const htmlReport = buildDefaultHtmlReport(type, dateStr, 0, 0, {}, [], emptyContent);
    fs.writeFileSync(fullPath, htmlReport);

    const summary = await createPostgresSummary(userId, type, dateStr, emptyContent, 0, {}, `/reports/${filename}`);
    return { summary, todos: [] };
  }

  // 序列化输入日记
  const diariesSerialized = entries
    .map((e, idx) => `[日记 ${idx + 1}] ID: ${e.id}, 标题: ${e.title}, 来源: ${e.source_type}, 标签: ${e.tags.join(",")}\n内容: ${e.summary}`)
    .join("\n\n");

  const tagsText = Object.entries(tagCounts)
    .map(([tag, count]) => `${tag}(${count}次)`)
    .join(", ");

  const missionsResult = await pool.query<{
    id: number;
    title: string;
    mission_type: "main" | "side";
    status: string;
    progress: number;
    tags: string[];
  }>(
    `
      SELECT id, title, mission_type, status, progress, tags
      FROM mission_timelines
      WHERE user_id = $1
        AND status <> 'archived'
      ORDER BY mission_type ASC, updated_at DESC, id DESC
      LIMIT 12
    `,
    [userId],
  );

  const missionsSerialized =
    missionsResult.rows.length > 0
      ? missionsResult.rows
          .map(
            (mission) =>
              `- ID: ${mission.id}, 标题: ${mission.title}, 类型: ${mission.mission_type === "main" ? "主线" : "支线"}, 状态: ${mission.status}, 进度: ${mission.progress}%, 标签: ${(mission.tags ?? []).join(",")}`,
          )
          .join("\n")
      : "暂无任务线。";

  const profileText = workProfile ? JSON.stringify(workProfile) : "未设置";

  // 3. 构建大模型 Prompt
  const systemPrompt = "你是一个强大的智能效率助手。请仔细阅读用户的工作日记，进行多周期总结和建议行动提取。";
  const userPrompt = `你是一个专业的工作总结专家。你需要为用户在该周期内的工作进行结构化整理和总结。

当前用户的个人画像与术语背景是：
${profileText}

周期类型: ${type}
周期基准日期: ${dateStr}

用户在此周期的日记记录如下：
${diariesSerialized}

当前已有任务线如下：
${missionsSerialized}

工作统计数据：
- 总工时: ${totalMinutes} 分钟 (共 ${(totalMinutes / 60).toFixed(1)} 小时)
- 日记记录条数: ${entries.length} 条
- 标签频率分布: ${tagsText}

你的任务：
1. 撰写 Markdown 格式的工作总结（"markdown" 字段），包含：本周期概述、主要进展、经验教训与下一步跟进建议。
2. 识别并提取出日记中提到的“未完成/需跟进/待办”事项，形成建议待办项（"suggestedTodos" 字段），必须是动词+名词的指令性文本，需给出优先级（高/中/低），且明确给出对应哪条源日记的 ID（"relatedDiaryId" 字段，若无法关联则为 null）。
3. 对每个建议待办判断它最应该归属到哪条已有任务线。只能从“当前已有任务线”中选择标题，填入 "relatedMissionTitle"；如果确实无法判断，则填 null。不要臆造不存在的任务线标题。
4. 自动生成一个可视化网页报表（"html" 字段）。网页内必须使用 CDN 引入 Chart.js，包含一个渲染标签分布的饼图和一个渲染工时趋势的折线图。网页设计需极具现代感、毛玻璃磨砂且响应式。你可以使用以下模板思路作为参考，但可以自由加入更炫彩的样式。

请必须以严格的 JSON 格式直接响应。不要返回任何其他说明或用 markdown 格式包裹 JSON（不要用 \`\`\`json 标记）：
{
  "markdown": "具体 Markdown 格式的工作总结正文",
  "suggestedTodos": [
    { "text": "提取的待办事项描述", "priority": "高" | "中" | "低", "relatedDiaryId": 对应日记的整型 ID 或者 null, "relatedMissionTitle": "已有任务线标题或 null" }
  ],
  "html": "包含完整 HTML、CSS 和 Chart.js 脚本的响应式网页代码"
}
确保返回的 JSON 是完全合法和转义的。`;

  let responseText = "";
  let llmParsed: {
    markdown: string;
    suggestedTodos: Array<{ text: string; priority: string; relatedDiaryId: number | null; relatedMissionTitle?: string | null }>;
    html?: string;
  };

  try {
    responseText = await callLLMChat(config, [{ role: "user", content: userPrompt }], systemPrompt);
    // 去除大模型偶尔返回的 ```json 与 ``` 包裹
    let cleaned = responseText.trim();
    if (cleaned.startsWith("```json")) {
      cleaned = cleaned.substring(7);
    } else if (cleaned.startsWith("```")) {
      cleaned = cleaned.substring(3);
    }
    if (cleaned.endsWith("```")) {
      cleaned = cleaned.substring(0, cleaned.length - 3);
    }
    cleaned = cleaned.trim();
    
    llmParsed = JSON.parse(cleaned);
  } catch (error) {
    console.error("Failed to call LLM or parse summary JSON. Falling back to rule-based mock. Error:", error);
    // 降级生成
    const fallbackMarkdown = `### ${type === "daily" ? "日" : type === "weekly" ? "周" : type === "monthly" ? "月" : "年"}报智能回顾\n\n根据系统汇总，本期共完成 ${entries.length} 篇日记，累计工作工时为 ${(totalMinutes / 60).toFixed(1)} 小时。使用频次最高的标签包括：${Object.keys(tagCounts).slice(0, 3).join(", ") || "无"}。\n\n由于大模型服务未响应或返回异常，系统已触发模板自愈。`;
    llmParsed = {
      markdown: fallbackMarkdown,
      suggestedTodos: entries.slice(0, 2).map((e) => ({
        text: `继续跟进「${e.title || "今日进展"}」的相关任务`,
        priority: "中",
        relatedDiaryId: e.id,
        relatedMissionTitle: findRelatedMissionTitle(e, missionsResult.rows),
      })),
    };
  }

  // 4. 清洗与自愈 HTML 报表文件
  let finalHtml = "";
  if (llmParsed.html) {
    try {
      finalHtml = healHTMLContent(llmParsed.html);
    } catch {
      finalHtml = buildDefaultHtmlReport(type, dateStr, totalMinutes, entries.length, tagCounts, dailyHours, llmParsed.markdown);
    }
  } else {
    finalHtml = buildDefaultHtmlReport(type, dateStr, totalMinutes, entries.length, tagCounts, dailyHours, llmParsed.markdown);
  }

  // 写入本地静态托管文件
  const filename = `${type}_${userId}_${dateStr}.html`;
  const relativeFilePath = `/reports/${filename}`;
  const fullFilePath = path.join(REPORTS_DIR, filename);
  fs.writeFileSync(fullFilePath, finalHtml);

  // 5. 启动数据库单个事务，插入 summaries 表和 todos 表
  const client = await pool.connect();
  const createdTodos: any[] = [];

  try {
    await client.query("BEGIN");

    // 插入 summaries
    const summaryResult = await client.query<SummaryRow>(
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
        dateStr,
        llmParsed.markdown,
        totalMinutes,
        JSON.stringify(tagCounts),
        relativeFilePath,
      ]
    );

    const summary = summaryResult.rows[0];

    // 插入建议待办 (TODOS)，避免重复创建。如果已经有同名待办，跳过。
    if (Array.isArray(llmParsed.suggestedTodos)) {
      for (const t of llmParsed.suggestedTodos) {
        if (!t.text || !t.text.trim()) continue;

        // 查重：同个 user_id 且 content 相同且未完成的待办
        const checkExist = await client.query(
          `SELECT id FROM todos WHERE user_id = $1 AND content = $2 AND status = '待办'`,
          [userId, t.text.trim()]
        );
        if (checkExist.rows.length === 0) {
          const priority = ["高", "中", "低"].includes(t.priority) ? t.priority : "中";
          let validDiaryId: number | null = null;
          if (typeof t.relatedDiaryId === "number" && t.relatedDiaryId > 0) {
            const diaryCheck = await client.query(
              `SELECT id FROM diaries WHERE id = $1 AND user_id = $2 AND is_deleted = FALSE`,
              [t.relatedDiaryId, userId]
            );
            if (diaryCheck.rows.length > 0) {
              validDiaryId = t.relatedDiaryId;
            }
          }
          const relatedMissionId = await resolveRelatedMissionId(client, userId, t.relatedMissionTitle);

          const todoResult = await client.query(
            `
              INSERT INTO todos (
                user_id,
                content,
                priority,
                due_date,
                status,
                related_diary_id,
                related_mission_id
              )
              VALUES ($1, $2, $3, CURRENT_TIMESTAMP + INTERVAL '2 days', '待办', $4, $5)
              RETURNING id, content, priority, due_date, status, related_diary_id, related_mission_id
            `,
            [userId, t.text.trim(), priority, validDiaryId, relatedMissionId]
          );

          const insertedTodo = todoResult.rows[0];

          // 记录待办流转历史（初始状态：无 -> 待办）
          await client.query(
            `
              INSERT INTO todo_status_history (todo_id, old_status, new_status, reason)
              VALUES ($1, NULL, '待办', 'AI 总结提取并自动生成')
            `,
            [insertedTodo.id]
          );

          createdTodos.push(insertedTodo);
        }
      }
    }

    await client.query("COMMIT");

    return {
      summary,
      todos: createdTodos,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * 重建向量索引后台服务
 */
export async function reindexUserDiaries(
  config: ModelServiceConfig,
  userId: number
): Promise<{ total: number; chunks: number }> {
  // 1. 获取用户所有未删除的日记
  const diariesResult = await pool.query<{
    id: number;
    title: string;
    content: string;
    summary: string;
    start_time: Date;
    end_time: Date;
    tags: string[];
    location: string | null;
  }>(
    `
      SELECT id, title, content, summary, start_time, end_time, tags, location
      FROM diaries
      WHERE user_id = $1 AND is_deleted = FALSE
    `,
    [userId]
  );

  const diaries = diariesResult.rows;

  // 2. 清除用户原有的所有 embeddings
  await pool.query(`DELETE FROM diary_embeddings WHERE user_id = $1`, [userId]);

  let totalChunks = 0;

  // 3. 循环对日记进行切片并生成 Embedding 存入
  for (const row of diaries) {
    const formattedDiary = {
      id: row.id,
      time: row.start_time.toISOString(),
      title: row.title ?? "无标题日记",
      tags: row.tags ?? [],
      summary: row.summary ?? row.content,
      location: row.location ?? undefined,
    };

    const chunks = splitDiaryIntoChunks(formattedDiary);

    for (const chunk of chunks) {
      try {
        const embedding = await callEmbedding(config, chunk.text);
        await insertPostgresDiaryEmbedding(userId, row.id, chunk.chunkId, chunk.text, embedding);
        totalChunks++;
      } catch (err) {
        console.error(`Failed to index chunk ${chunk.chunkId} of diary ${row.id}:`, err);
      }
    }
  }

  return { total: diaries.length, chunks: totalChunks };
}

/**
 * RAG 智能两阶段检索问答系统
 */
export async function ragAskQuestion(
  config: ModelServiceConfig,
  userId: number,
  question: string,
  userProfile?: Record<string, any>
): Promise<{ answer: string; citations: Array<{ conclusion: string; docId: number; title: string }> }> {
  // --- 1. 第一阶段：时间实体提取 ---
  const currentLocalTime = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  
  const timePrompt = `你是一个时间解析助手。你的任务是从用户的查询中提取时间范围。
当前系统时间是：${currentLocalTime}。
如果用户查询包含明确的时间段或日期词汇（相对或绝对时间，比如‘今天’、‘昨天’、‘上周’、‘2026-05-22’等），请计算出起止时间范围，以 JSON 格式输出：
{
  "has_time": true,
  "start_time": "YYYY-MM-DDTHH:mm:ss.sssZ",
  "end_time": "YYYY-MM-DDTHH:mm:ss.sssZ"
}
如果用户查询中没有提及任何具体的时间或日期段，输出：
{
  "has_time": false
}
不要有任何其他解释，只输出 JSON。`;

  let timeExtraction: { has_time: boolean; start_time?: string; end_time?: string } = { has_time: false };
  try {
    const timeResponse = await callLLMChat(config, [{ role: "user", content: question }], timePrompt);
    let cleaned = timeResponse.trim();
    if (cleaned.startsWith("```json")) {
      cleaned = cleaned.substring(7);
    } else if (cleaned.startsWith("```")) {
      cleaned = cleaned.substring(3);
    }
    if (cleaned.endsWith("```")) {
      cleaned = cleaned.substring(0, cleaned.length - 3);
    }
    timeExtraction = JSON.parse(cleaned.trim());
  } catch (err) {
    console.error("Time extraction failed, falling back to full-range search:", err);
  }

  let matchedChunks: any[] = [];

  // 生成问题向量
  const questionEmbedding = await callEmbedding(config, question);

  // --- 2. 第二阶段：检索过滤与向量比对 ---
  if (timeExtraction.has_time && timeExtraction.start_time && timeExtraction.end_time) {
    // 找出该时间段范围内的日记 ID 列表
    const diariesInRange = await pool.query<{ id: number }>(
      `
        SELECT id 
        FROM diaries 
        WHERE user_id = $1 AND start_time >= $2 AND start_time <= $3 AND is_deleted = FALSE
      `,
      [userId, timeExtraction.start_time, timeExtraction.end_time]
    );

    const diaryIds = diariesInRange.rows.map((r) => r.id);
    
    if (diaryIds.length > 0) {
      // 在子集内做向量相似度计算
      matchedChunks = await searchPostgresDiaryEmbeddings(userId, questionEmbedding, 5, diaryIds);
    }
  }

  // 若子集内检索无结果，或问题中不包含时间，回退进行全量向量相似度检索
  if (matchedChunks.length === 0) {
    matchedChunks = await searchPostgresDiaryEmbeddings(userId, questionEmbedding, 5);
  }

  if (matchedChunks.length === 0) {
    return {
      answer: "在知识库中未查找到与您问题相关的任何工作记录片段。您可以先尝试在设置页面‘重建向量索引’或记录更多日记。",
      citations: [],
    };
  }

  // --- 3. 第三阶段：大模型推理问答与强溯源 ---
  const contextText = matchedChunks
    .map((chunk, idx) => `[文献片段 ${idx + 1}] (出处日记: ${chunk.title}, 时间: ${chunk.time})\n内容:\n${chunk.text}`)
    .join("\n\n");

  const profileText = userProfile ? JSON.stringify(userProfile) : "无";

  const ragPrompt = `你是一个强约束的 RAG 知识库问答助手。你的任务是根据提供的文献片段，极其严谨地回答用户的问题。
你的个人工作画像是：${profileText}。

只能根据以下给出的【文献片段】作答。如果文献中没有相关依据，必须老实回答“提供的日记片段中没有提及该信息”，不得凭空猜测或臆断。

【文献片段】：
${contextText}

【回答约束规则】：
1. 答案中如果包含来自某个片段的要点，必须在要点后打上引用角标，如【片段1】、【片段2】等。
2. 你的回答末尾，必须生成一个精确的“依据映射表”，指出每一个要点结论来源于哪一个文献片段编号。
3. 请使用极其专业、结构化的中文作答。

请以如下 JSON 格式直接响应（确保是合法的 JSON，不要包裹 \`\`\`json 标记）：
{
  "answer": "这里是回答正文，包含【片段X】角标引用",
  "citations": [
    { "conclusion": "结论要点/事实陈述", "docId": 关联日记的整型ID, "title": "关联日记的标题", "fragmentIndex": 1 }
  ]
}
确保 citations 数组内的 fragmentIndex 代表你引用的【文献片段】的数字编号（1-indexed）。`;

  try {
    const askResponse = await callLLMChat(config, [{ role: "user", content: question }], ragPrompt);
    let cleaned = askResponse.trim();
    if (cleaned.startsWith("```json")) {
      cleaned = cleaned.substring(7);
    } else if (cleaned.startsWith("```")) {
      cleaned = cleaned.substring(3);
    }
    if (cleaned.endsWith("```")) {
      cleaned = cleaned.substring(0, cleaned.length - 3);
    }
    const responseJson = JSON.parse(cleaned.trim());

    // 映射日记 ID
    const formattedCitations = (responseJson.citations || []).map((c: any) => {
      const matchedChunk = matchedChunks[c.fragmentIndex - 1];
      return {
        conclusion: c.conclusion,
        docId: matchedChunk ? matchedChunk.diary_id : (c.docId || 0),
        title: matchedChunk ? matchedChunk.title : (c.title || "工作记录"),
      };
    });

    return {
      answer: responseJson.answer,
      citations: formattedCitations,
    };
  } catch (err) {
    console.error("RAG logic failed, falling back to simple prompt response:", err);
    // 粗略退回
    return {
      answer: "检索出以下相关工作片段，但在进行大模型推理和强溯源时发生了解析异常：\n" + 
        matchedChunks.map((c, i) => `${i+1}. 「${c.title}」: ${c.text.substring(0, 150)}...`).join("\n"),
      citations: matchedChunks.map(c => ({
        conclusion: `相关日记「${c.title}」`,
        docId: c.diary_id,
        title: c.title,
      })),
    };
  }
}

function findRelatedMissionTitle(
  diary: { title: string; tags: string[] },
  missions: Array<{ title: string; tags: string[] }>,
) {
  const title = diary.title.toLowerCase();
  return (
    missions.find((mission) => (mission.tags ?? []).some((tag) => diary.tags?.includes(tag)))?.title ??
    missions.find((mission) => mission.title.toLowerCase().includes(title) || title.includes(stripMissionTitle(mission.title)))?.title ??
    null
  );
}

async function resolveRelatedMissionId(
  client: { query: typeof pool.query },
  userId: number,
  relatedMissionTitle?: string | null,
) {
  const title = relatedMissionTitle?.trim();
  if (!title) return null;

  const result = await client.query<{ id: number }>(
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

function stripMissionTitle(title: string) {
  return title
    .replace(/^推进「/, "")
    .replace(/」主线$/, "")
    .replace(/^支线：/, "")
    .replace(/^补强/, "")
    .replace(/^推进/, "")
    .trim()
    .toLowerCase();
}
