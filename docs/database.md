# 作业本数据库说明

作业本后端遵循 PRD 的单数据库约束：所有结构化业务数据和向量检索数据统一存储在 PostgreSQL 中，并启用 `pgvector`。

## 本地环境变量

复制 `.env.example` 为 `.env`，配置：

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/zuoyeben
API_PORT=3000
```

## 初始化数据库

确保 PostgreSQL 已创建数据库，并安装 `pgvector` 扩展可用。

```bash
npm run db:migrate
```

迁移脚本会执行：

- `CREATE EXTENSION IF NOT EXISTS vector`
- 用户、Agent、API Key
- 日记、待办、待办状态历史
- 任务时间线、时间线节点
- 分享卡片
- Agent 审计日志
- App 设置
- 总结报表 `summaries`
- 日记向量索引 `diary_embeddings`
- 演示用户与少量首页 demo 数据

## 当前状态

当前 API 已经以 PostgreSQL 作为主要持久化层：

- 配置了 `DATABASE_URL`：登录用户的数据按 `user_id` 隔离，日记、待办、任务线、分享卡片、模型配置、Agent Key、审计日志、备份恢复、AI 总结和 RAG 向量索引都写入 PostgreSQL。
- 未配置 `DATABASE_URL`：回退到内存 demo 数据，方便纯前端开发。

需要注意：AI 总结和 RAG 问答依赖 `pgvector`、模型服务配置和可用的 embedding/chat 模型；如果这些服务不可用，后端会尽量降级返回模板内容或明确错误信息。
