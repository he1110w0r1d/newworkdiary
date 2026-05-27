# 作业本 API 对接约定

当前前端已经通过 HTTP Repository 接入后端 API。未配置 `DATABASE_URL` 时，后端会进入本地 Demo 模式；配置 PostgreSQL 后，认证、用户隔离、Agent Key、审计日志、备份恢复、AI 总结与 RAG 都写入数据库。

## 环境变量

```bash
VITE_API_BASE_URL=http://localhost:3000/api
```

生产同源部署时可以不配置该变量，前端默认请求 `/api`。

## 认证

前端用户使用 JWT：

```http
Authorization: Bearer <token>
```

外部 Agent 使用 API Key：

```http
X-API-Key: wdk_xxx
Content-Type: application/json
```

默认生成的 Agent Key scopes：

```text
diary:read, diary:write, todo:read, todo:write, timeline:read
```

可选 scopes：

```text
diary:read      读取日记
diary:write     创建、更新、软删除日记
todo:read       读取待办
todo:write      创建、更新、删除待办
timeline:read   读取任务时间线
timeline:write  创建任务时间线节点
summary:read    读取工作总结，预留
share:write     生成脱敏分享卡片
agent:read      读取当前 Agent 资料
agent:write     更新当前 Agent 资料
all             完整权限，生产环境谨慎使用
```

最小权限建议：

```text
只写工作日记: diary:write
回顾上下文后写日记: diary:read, diary:write
管理待办: todo:read, todo:write
完整工作助手: diary:read, diary:write, todo:read, todo:write, timeline:read
```

### POST `/agent-keys`

为外部 Agent 创建 API Key。明文 `rawKey` 只在创建响应中返回一次。

```json
{
  "name": "Codex 工作助手",
  "scopes": ["diary:read", "diary:write", "todo:read", "todo:write", "timeline:read"],
  "expiresAt": "2026-06-24T12:00:00.000Z"
}
```

`expiresAt` 可以传 `null` 表示永不过期，但生产部署建议使用有限有效期。

## 用户接口

### POST `/auth/register`

创建用户并返回登录令牌。

```json
{
  "username": "alice",
  "password": "secret123",
  "nickname": "Alice"
}
```

### POST `/auth/login`

登录并返回令牌。

```json
{
  "username": "alice",
  "password": "secret123"
}
```

### GET `/auth/me`

读取当前登录用户资料。

## 快照与基础数据

### GET `/snapshot`

返回当前用户首页所需快照。

```json
{
  "diaries": [],
  "todos": [],
  "theme": "草莓薄荷",
  "share": {
    "generated": false,
    "visibility": "link"
  }
}
```

### POST `/diaries`

创建一条日记。

```json
{
  "time": "16:30",
  "title": "完成 Agent CRUD 接口",
  "source": "human",
  "summary": "补齐了 Agent 读写日记与待办的接口。",
  "tags": ["Agent", "API"]
}
```

### PATCH `/diaries/:id`

更新日记标题、摘要、时间、来源或标签。PostgreSQL 模式下可用。

### DELETE `/diaries/:id`

软删除日记，进入回收站。

### GET `/diaries/trash`

读取回收站日记。

### POST `/diaries/:id/restore`

恢复回收站日记。

### DELETE `/diaries/:id/permanent`

永久删除回收站日记。

### POST `/todos`

创建待办。

```json
{
  "text": "跑一轮 Docker Compose 部署验证",
  "done": false
}
```

### PATCH `/todos/:id`

更新待办内容或完成状态。

```json
{
  "done": true,
  "reason": "已完成本地构建验证"
}
```

### DELETE `/todos/:id`

删除待办。

### GET `/todos/history`

读取待办状态变更历史。

## Agent 专用接口

Agent 专用接口全部使用 `X-API-Key`，并按 scope 校验和写入审计日志。

### GET `/agent/snapshot`

读取最近日记、待办、主题和分享设置，用于 Agent 写入前的轻量上下文获取。

### GET `/agent/diaries`

读取最近日记。

### POST `/agent/diaries`

写入 Agent 日记，服务端会强制 `source` 为 `agent`。

```json
{
  "time": "18:10",
  "title": "Agent 自动回顾了产品开发进展",
  "summary": "整理了今天完成的功能、尚未解决的问题和下一步建议。",
  "tags": ["Agent 回顾", "产品开发"],
  "source_session_id": "optional-session-id"
}
```

### PATCH `/agent/diaries/:id`

更新日记。

### DELETE `/agent/diaries/:id`

软删除日记。

### GET `/agent/todos`

读取待办。

### POST `/agent/todos`

创建待办。

### PATCH `/agent/todos/:id`

更新待办内容或状态。

### DELETE `/agent/todos/:id`

删除待办。

### GET `/agent/missions`

读取当前任务时间线，需要 `timeline:read` 权限。返回结构与用户侧 `/missions` 一致。

```json
{
  "missions": [],
  "nodes": []
}
```

### POST `/agent/mission-nodes`

创建任务时间线节点，需要 `timeline:write` 权限。`timelineId` 可选；不传时会自动挂到当前主线任务。如果当前没有任务线，系统会先根据现有日记生成一份任务线。

```json
{
  "timelineId": 1,
  "title": "完成 Agent 时间线写入接口",
  "summary": "补齐 timeline:write 对应的节点写入能力。",
  "status": "进行中",
  "time": "18:30",
  "source": "Agent 自动整理",
  "relatedDiaryIds": []
}
```

### GET `/agent/summaries?type=daily&date=2026-05-25`

读取已经生成并存盘的 AI 周期总结，需要 `summary:read` 权限。该接口只读取，不会触发新的模型调用。

```json
{
  "summary": null
}
```

### POST `/agent/share-cards`

生成脱敏分享卡片，需要 `share:write` 权限。返回结构与用户侧 `/share-cards` 一致，私密分享会额外返回一次性访问码。

```json
{
  "visibility": "link",
  "expiry": "7d"
}
```

`visibility` 支持 `link`、`public`、`private`，`expiry` 支持 `never`、`7d`、`30d`。

### GET `/agent/profile`

读取当前 API Key 绑定的 Agent 资料，需要 `agent:read` 权限。

### PATCH `/agent/profile`

更新当前 API Key 绑定的 Agent 资料，需要 `agent:write` 权限。

```json
{
  "name": "Codex 工作助手",
  "description": "负责把本地开发进展写入作业本。",
  "provider": "Codex",
  "defaultColor": "#ff8fbd",
  "skillDoc": "可选的 Agent 使用说明"
}
```

## AI 与备份

### GET `/settings/model`

读取当前用户的模型路由配置。LLM 生成服务和 Embedding 向量服务可以分别使用不同供应商、Base URL 和 API Key。

### PUT `/settings/model`

```json
{
  "llmProvider": "OpenRouter",
  "llmBaseUrl": "https://openrouter.ai/api/v1",
  "chatModel": "openai/gpt-4.1-mini",
  "llmApiKey": "sk-xxx",
  "embeddingProvider": "Ollama",
  "embeddingBaseUrl": "http://localhost:11434/v1",
  "embeddingModel": "nomic-embed-text",
  "embeddingApiKey": "",
  "timeoutSeconds": 60
}
```

### POST `/summaries`

生成日报、周报、月报或年报。

```json
{
  "type": "daily",
  "date": "2026-05-25"
}
```

### POST `/qa/ask`

基于日记向量索引进行 RAG 问答。

```json
{
  "question": "今天主要推进了哪些模块？"
}
```

### POST `/qa/reindex`

重建当前用户日记向量索引。

### GET `/export`

导出当前用户备份。

### POST `/restore/preview`

预检备份文件。

### POST `/restore/apply`

应用备份，支持 `skip_existing` 和 `overwrite_existing` 策略。

## 本地开发

### POST `/dev/reset`

仅用于本地 Demo 模式，重置内存数据。生产环境不要暴露该接口。
