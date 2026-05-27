# Agent 工作日记管理系统（Agent Work Diary App）产品需求文档 (PRD)

## 1. 文档概述 (Introduction)

### 1.1 目的
本文档详细定义了“Agent 工作日记管理系统（Agent Work Diary App）”的产品需求，旨在指导开发 Agent 重新构建并实现一个集“人类主动记录、Agent 自动回顾、待办追踪、任务时间线、AI 智能总结、高精度 RAG 语义问答、分享传播以及可靠数据备份”于一体的 Web 工作流管理应用。

### 1.2 产品定位与架构
这是一款面向 AI Agent 使用者、开发者、项目经理及知识工作者的智能效率工具。产品形态以**可本地部署的 Web 应用**为主，支持在本机、私有服务器、NAS、云主机或容器环境中部署；用户也可以通过自有域名、反向代理、内网穿透或云端部署方式实现跨设备、跨网络访问。
为了降低系统复杂度、简化部署运维，并提供强一致性的关系数据保障，**系统全面统一使用单一的 PostgreSQL 数据库**。
*   **结构化业务数据**（用户、日记、待办、总结、历史记录等）采用传统的关系型表存储，并设立严格的外键与事务约束。
*   **非结构化向量数据**（日记 Chunk 的 Embeddings）依托 PostgreSQL 的 **`pgvector` 扩展**进行混合存储与近邻检索，实现“一库多用”。
*   **Agent 接入能力**通过 Open API、API Key、Skill 使用说明和审计日志提供，让不同设备、不同网络环境下运行的 Agent 都能安全写入和读取用户授权范围内的工作日记。

---

## 2. 用户角色与场景 (User Personas & Scenarios)

*   **AI Agent 使用者**: 日常在多个 Agent、多个设备、多个工作流中完成任务，希望有一个统一的工作日记中心记录“我做了什么、Agent 帮我做了什么、任务推进到哪里”。
*   **普通用户**: 每天主动记录零散的工作内容，希望系统根据自然语言描述自动结构化整理，生成格式化工整的总结汇报，并随时通过对话唤回历史工作细节。
*   **外部 Agent / 自动化工具**: 通过 API Key 和 Skill 文档接入系统，读取上下文、写入工作过程、更新任务状态、生成当天的 Agent 回顾日记。
*   **团队管理者 / 高级用户**: 通过 API 接口批量读取日记及总结数据，或在多个设备和网络环境中维护长期工作记忆。

---

## 3. 功能需求 (Functional Requirements)

### 3.1 账号、配置与工作画像 (Settings & User Profiles)

#### 3.1.1 个人资料与工作画像 (Work Profile)
*   **需求**: 用户可以配置自己的昵称、头像、简介，以及**工作画像 (Work Profile)**。工作画像包含行业背景、岗位角色、常用术语等。
*   **AI 联动**: 该画像会在生成工作总结或进行 RAG 问答时作为系统提示词（System Prompt）的一部分输入给 LLM，确保 AI 生成的内容契合用户的专业语境。
*   **存储**: 在 PostgreSQL 中，工作画像推荐以 `JSONB` 格式直接存储在用户表中，便于灵活扩展。

#### 3.1.2 LLM & Embedding 服务配置
*   **需求**: 支持配置多种大语言模型（生成）与嵌入模型（向量化）服务。
    *   **大模型支持**: 
        *   本地大模型（基于 Ollama 协议，配置 API 地址和模型名称，如 `llama3`）。
        *   云端大模型（通过自定义 API 端点与 API Key 接入，兼容 OpenAI / OpenRouter 协议）。
    *   **Embedding 支持**:
        *   本地 Embedding 模型（Ollama）。
        *   云端 Embedding（OpenAI 等）。
*   **参数配置**: 针对每个模型可配置 `timeout`（超时时间）、`temperature`（温度）、`maxTokens`（最大输出 token 数）等，配置信息以 `JSONB` 数组形式存入数据库。

---

### 3.2 日记管理模块 (Diary Management)

*   **基础 CURD**: 支持新建、编辑、查看、删除日记。
*   **双路径写入**:
    *   **人类主动记录**: 用户输入自然语言描述，系统调用 LLM 将其结构化整理为标题、正文、时间段、标签、优先级、关联任务等字段后写入日记。
    *   **Agent 自动回顾**: 外部 Agent 或 App 内置 Agent 回顾当天与用户的交互、执行过程、产出物和未完成事项，形成 Agent 日记并写入当天日记流。
*   **属性维度**: 每条日记支持：
    *   `content` (文本内容，必填)。
    *   `start_time` & `end_time` (工作起止时间，支持具体到分钟，用于计算精确工作时长)。
    *   `location` (工作地点，选填)。
    *   `tags` (标签，以文本数组 `varchar[]` 或 `JSONB` 存储，选填)。
    *   `work_priority` (工作优先级：高/中/低)。
    *   `source_type` (来源类型：`human` 人类主动记录、`agent` Agent 自动记录、`system` 系统生成)。
    *   `source_agent_id` (来源 Agent ID，可为空，用于标识是哪一个 Agent 写入)。
    *   `source_session_id` (来源会话或任务运行 ID，可为空，用于追溯 Agent 的一次执行过程)。
    *   `structured_meta` (结构化补充信息，JSONB，用于存储产出物、链接、模型、置信度、原始摘要等扩展信息)。
*   **来源视觉区分**: 日记列表、时间线和日历视图中必须通过颜色、图标或左侧标识条区分人类日记与 Agent 日记。默认建议：人类日记使用蓝/绿色系，Agent 日记使用紫/橙色系，系统生成内容使用灰色系。
*   **回收站机制**: 
    *   普通删除仅将日记标记为 `is_deleted = true` 并移入回收站。
    *   回收站支持“一键彻底删除”与“还原”功能。
*   **日历视图**: 提供直观的日历组件，在对应日期格内展示当日的日记条数、总工时与待办概览，点击可直接跳入详情或快速新建。

---

### 3.3 待办事项模块 (Todo Management)

*   **基础属性**: 待办项包含 `content`（内容）、`due_date`（截止日期）、`priority`（优先级：高/中/低）、`status`（状态）和 `related_diary_id`（关联的源日记外键 ID，可为空）。
*   **与任务时间线的关系**: 待办是用户可以手动勾选、延期、放弃或转交的“原子行动项”；任务时间线是系统根据多条日记聚合出来的“工作脉络/任务剧情线”。一个待办可以关联到某个任务时间线节点，但二者不互相替代。
*   **状态流转与历史追溯**: 
    *   支持四种状态：**待办、已完成、已放弃、已转交**。
    *   用户更改状态时，必须弹窗输入“变更原因”（Reason）。
    *   系统需记录状态变更历史，包含：变更前状态、变更后状态、操作时间、变更原因。
    *   **数据库设计要求**: 历史记录应专门设计一个子表（如 `todo_status_history`），通过外键关联主待办表，支持级联删除。

---

### 3.4 🤖 智能工作总结 (AI Summary)

这是本系统的核心 AI 功能，流程如下：

#### 3.4.1 多周期总结生成
*   **周期**: 支持 **每日 (Daily)、每周 (Weekly)、每月 (Monthly)、每年 (Yearly)** 总结。
*   **数据采集**: 系统提取该时间段内该用户所有未删除的日记记录。
*   **统计准备**: 在 PostgreSQL 中通过 SQL 聚合函数快速计算总工时、条目数、标签分布（以 SQL 聚合得出各个标签出现的频次）。

#### 3.4.2 智能待办转化 (未闭环意图提取)
*   **两阶段提取法**:
    1.  **首轮分析**: LLM 逐句分析日记，区分“事实”与“意图”，过滤掉纯情绪或已关闭的事项。
    2.  **JSON 提取**: LLM 根据日记中“未完成/需跟进/计划明日”的表述，智能转化为具体的、指令性（动词+名词）的待办事项，并输出严格的 JSON。
    3.  **格式防呆与入库**: 后端必须包含稳健的 JSON 解析器。解析成功后，**启动数据库事务**，将提取出的建议待办以关系型记录插入待办表中，并正确写入 `related_diary_id` 关联外键。

#### 3.4.3 精美网页可视化报表生成
*   **动态 HTML**: LLM 在生成 Markdown 格式总结正文的同时，会利用专门的 HTML 提示词模板，自动设计并输出包含 CSS 样式和 JavaScript 的完整响应式 HTML 报表网页。
*   **图表可视化**: 网页中必须嵌入 **Chart.js**，以饼图展示标签分布，以折线图/柱状图展示每日工时趋势。
*   **HTML 结构自愈**: 后端必须自动清洗 LLM 输出的代码，补齐缺失的 `<html>`、`<head>`、`<body>` 等闭合标签。如果生成彻底失败，自动回退到内置的默认 HTML 报表模板。
*   **静态存储**: 生成的 HTML 页面路径存储在总结表的字段中，文件保存在本地，支持用户在前端一键查看或下载。

---

### 3.5 🔍 智能知识库问答检索 (RAG QA)

通过对话方式检索历史日记内容：

#### 3.5.1 向量重建索引 (Reindex)
*   **切片处理**: 将日记拼接地点、标签、精确时间范围后，采用段落敏感的切片策略（默认每片最大 800 字）。
*   **嵌入存储**: 调用配置的 Embedding 模型生成向量，将其插入本库的 `diary_embeddings` 表中（`embedding` 字段类型为 `vector`）。

#### 3.5.2 智能混合检索 (Time-aware Retrieval)
1.  **时间实体提取**: 提取用户问题中的时间概念（相对时间或绝对时间）。
2.  **两阶段过滤**:
    *   如果提取出明确的时间范围，**利用 SQL 的 `WHERE start_time >= ? AND end_time < ?` 直接过滤出符合条件的日记 ID 列表**，在此子集内做向量相似度计算（使用 `<=>` 算子）。
    *   如果子集检索无结果，或问题中未包含时间词，则回退进行**全量向量相似度检索**（取前 K 个最相似片段）。

#### 3.5.3 推理回答与强溯源限制
*   **提示词约束**: 强制 LLM 严格依据检索到的片段作答，若依据不足必须直接说明，不能臆测。
*   **强溯源呈现**: 
    *   答案中的每个事实要点，必须标明引用的片段编号，如 `【片段1】`。
    *   回答末尾必须附带**依据映射表**（形式为：`结论要点 -> 片段编号`），方便用户追溯验证。

---

### 3.6 💾 数据备份与恢复 (Backup & Restore)

*   **全配置 Zip 打包**: 
    *   系统应能将用户在 PostgreSQL 中的所有关联表数据（用户、日记、待办、总结等）导出为 `data.json`。
    *   将 LLM 与嵌入配置导出为 `config/llm-settings.json`。
    *   可选将系统配置 `.env` 导出为 `env/.env`。
    *   上述文件统一打包为 `.zip` 格式备份包供用户下载。
*   **防灾干跑校验 (Dry-Run)**:
    *   用户在恢复备份前，系统必须支持 `dryRun=true` 校验。
    *   解析备份包数据，并与数据库中现存的记录（基于表主键 `id`）比对。
    *   **预检报告**: 返回详细的干跑计划（预计新增、预计覆盖、有无损坏或冲突）。
*   **事务保障的恢复策略**: 
    *   `merge` (合并模式：基于 ID 去重，保留本地已存在的，仅导入不冲突的新数据)。
    *   `overwrite` (覆盖模式：相同 ID 的旧数据会被备份数据强制重写)。
    *   **核心安全机制**: 恢复数据操作**必须包装在单个 SQL 数据库事务 (Transaction) 中**。如果任何一张表导入出错，立即进行 Rollback，保障数据库不处于半损坏状态。
*   **异步任务管理**: 备份和还原操作由后端异步执行，提供 `progressId` 查询接口，支持前端实时渲染进度百分比和执行日志。

---

### 3.7 🔑 开放 API 服务 (Open API)

*   **API Key 授权机制**: 
    *   用户在个人设置页面可以生成前缀为 `wdk_` 的 API Key，支持自定义过期时间。
    *   外部请求需在 Header 中携带 `X-API-Key: wdk_xxx`。
    *   API Key 可以绑定到一个 Agent 身份，便于区分不同 Agent 的写入来源、权限范围和审计记录。
*   **细粒度权限控制 (Scopes)**: API Key 支持绑定不同的 Scope 权限，系统在中间件中进行强校验：
    *   `all`: 完整访问所有接口。
    *   `diary:read` / `diary:write`: 日记读写权限。
    *   `todo:read` / `todo:write`: 待办事项读写权限.
    *   `summary:read`: 工作总结的读取权限。
    *   `timeline:read` / `timeline:write`: 任务时间线读写权限。
    *   `agent:read` / `agent:write`: Agent 资料和接入配置读写权限。
    *   `share:write`: 生成分享卡片权限。
*   **Agent Skill 引导**:
    *   系统需在设置页生成一份面向 Agent 的 Skill 使用说明，包含 API Base URL、认证方式、Scope 说明、日记写入格式、待办更新格式、错误处理方式和示例请求。
    *   Skill 文档中不得直接展示完整 API Key，只允许在首次生成时展示一次明文密钥。
    *   Agent 写入日记时必须传入 `source_type=agent`，并尽量提供 `source_session_id`、任务名称、交互摘要和产出物链接。

---

### 3.8 🧭 任务时间线与游戏化反馈 (Mission Timeline)

*   **任务时间线定义**: App 内置 Agent 定期分析用户和 Agent 写入的日记，将碎片化记录聚合为“主线任务”和“支线任务”。
    *   **主线任务**: 长期、重要、跨多天推进的目标，例如“完成工作日记 App MVP”。
    *   **支线任务**: 临时、探索性或辅助性任务，例如“调研 Google Stitch 原型能力”。
*   **时间线节点**: 每个任务由多个节点组成，节点来源于一条或多条日记，包含标题、摘要、开始时间、结束时间、状态、关联日记、关联待办、AI 提炼理由。
*   **节点状态**: 支持 `planned`（计划中）、`in_progress`（进行中）、`blocked`（受阻）、`completed`（已完成）、`archived`（已归档）。
*   **正向反馈**:
    *   当用户完成待办或任务节点时，界面给予轻量正反馈，例如完成动画、成就提示、连续记录天数、任务进度条、经验值或徽章。
    *   游戏化反馈必须克制，不应干扰工作流，也不应把严肃工作界面做成娱乐化页面。
*   **冲突处理**:
    *   如果 AI 生成的任务节点与现有待办重复，系统应提示“可关联已有待办”而不是直接重复创建。
    *   任务时间线负责展示工作脉络，待办负责执行管理；生成待办时优先关联已有任务节点。

---

### 3.9 🌐 Web 前端、主题与本地部署体验

*   **产品形态**: 系统以 Web 应用为主要交互界面，支持桌面端优先的响应式布局，同时兼容移动端访问。
*   **部署方式**:
    *   支持本地开发部署、Docker Compose 部署、私有服务器部署。
    *   前端应通过环境变量配置后端 API 地址，便于用户在不同网络环境中部署。
    *   对跨网络访问场景，文档需给出 HTTPS、反向代理、内网穿透或云主机部署建议。
*   **主题系统**: 前端必须提供主题切换能力，至少包含：
    1.  **商务风格**: 克制、专业、稳定，适合企业和项目管理场景，推荐深蓝、灰白、浅灰、少量绿色/蓝色强调色。
    2.  **粉蓝风格**: 柔和、现代、轻快，推荐浅粉、浅蓝、白色、淡紫辅助色，保持专业可读。
    3.  **中国风**: 现代中国风，推荐朱砂红、墨黑、宣纸白、黛青、浅金点缀，使用留白、细线、印章感标签，但交互仍保持现代 Web App 风格。
    4.  **黑白系统主题**: 根据系统 `prefers-color-scheme` 自动切换黑/白模式，黑白灰建立层级，确保图表、输入框、卡片和文本在亮色/暗色模式下均清晰可读。
*   **页面布局**:
    *   桌面端建议采用左侧导航 + 顶部工具栏 + 主内容区 + 可选右侧详情栏。
    *   移动端使用底部导航或折叠菜单。
    *   首页第一屏必须直接展示工作台内容，包括今日记录、Agent 写入状态、任务时间线摘要和待办概览。

---

### 3.10 📣 分享卡片与传播 (Share Card)

*   **分享目标**: 用户可以将某天总结、某个任务时间线进展、某个成就或工作成果生成分享卡片，用于社交传播或团队汇报。
*   **卡片内容**:
    *   标题、日期、总工时、主线任务进度、关键成果、标签、用户昵称或头像。
    *   自动生成二维码，二维码指向公开分享页或只读分享链接。
    *   可选择是否展示由 Agent 写入的内容，默认隐藏敏感原文，仅展示摘要。
*   **隐私控制**:
    *   分享前必须预览。
    *   支持公开、链接可见、密码访问、过期时间。
    *   分享内容必须脱敏，默认不包含 API Key、模型配置、完整原始交互记录。
*   **导出形式**: 支持生成 PNG 图片和公开 Web 分享页。

---

## 4. PostgreSQL 关系数据库表结构设计 (Database DDL Design)

为了让开发 Agent 能够直接建表，系统必须使用如下的 PostgreSQL 关系型结构（以下提供 DDL 参考）：

### 4.1 用户表 (`users`)
```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    nickname VARCHAR(100),
    bio TEXT,
    avatar VARCHAR(255),
    work_profile JSONB DEFAULT '{}'::jsonb, -- 工作画像，存储行业、术语等偏好
    llm_configs JSONB DEFAULT '[]'::jsonb,  -- 大模型配置数组
    embedding_configs JSONB DEFAULT '[]'::jsonb, -- 嵌入模型配置数组
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### 4.2 API 密钥表 (`api_keys`)
```sql
CREATE TABLE api_keys (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id INT,
    key_hash VARCHAR(64) UNIQUE NOT NULL, -- SHA256后的API Key哈希
    key_mask VARCHAR(15) NOT NULL,        -- 明文掩码，如 wdk_abc...xyz 用于展示
    scopes VARCHAR(50)[] DEFAULT '{}',    -- 权限数组，如 {'diary:read', 'todo:write'}
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_apikeys_hash ON api_keys(key_hash);
```

> 注意：`api_keys.agent_id` 在 `agents` 表创建后添加外键约束，或在实际迁移中调整建表顺序。

### 4.2.1 Agent 身份表 (`agents`)
```sql
CREATE TABLE agents (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    provider VARCHAR(100),             -- 如 Codex、Claude Code、Cursor、自定义 Agent
    default_color VARCHAR(20),         -- 前端用于区分该 Agent 的默认颜色
    skill_doc TEXT,                    -- 面向该 Agent 的使用说明或 Skill 内容
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_agents_user ON agents(user_id);

ALTER TABLE api_keys
ADD CONSTRAINT fk_api_keys_agent
FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL;
```

### 4.2.2 Agent API 审计日志表 (`agent_audit_logs`)
```sql
CREATE TABLE agent_audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id INT REFERENCES agents(id) ON DELETE SET NULL,
    api_key_id INT REFERENCES api_keys(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,      -- 如 diary.create、todo.update、timeline.read
    target_type VARCHAR(50),
    target_id INT,
    request_meta JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_agent_audit_logs_user_time ON agent_audit_logs(user_id, created_at DESC);
CREATE INDEX idx_agent_audit_logs_agent_time ON agent_audit_logs(agent_id, created_at DESC);
```

### 4.3 日记表 (`diaries`)
```sql
CREATE TABLE diaries (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_type VARCHAR(20) DEFAULT 'human' CHECK (source_type IN ('human', 'agent', 'system')),
    source_agent_id INT REFERENCES agents(id) ON DELETE SET NULL,
    source_session_id VARCHAR(100),
    title VARCHAR(255),
    content TEXT NOT NULL,
    location VARCHAR(100),
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    tags VARCHAR(50)[] DEFAULT '{}', -- 日记标签数组
    work_priority VARCHAR(10) DEFAULT '中' CHECK (work_priority IN ('高', '中', '低')),
    structured_meta JSONB DEFAULT '{}'::jsonb,
    is_deleted BOOLEAN DEFAULT FALSE,
    dify_doc_id VARCHAR(100),       -- Dify 文档ID
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_diaries_user_time ON diaries(user_id, start_time, end_time);
CREATE INDEX idx_diaries_source ON diaries(user_id, source_type, source_agent_id);
```

### 4.4 待办事项表 (`todos`)
```sql
CREATE TABLE todos (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    priority VARCHAR(10) DEFAULT '中' CHECK (priority IN ('高', '中', '低')),
    due_date TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(20) DEFAULT '待办' CHECK (status IN ('待办', '已完成', '已放弃', '已转交')),
    related_diary_id INT REFERENCES diaries(id) ON DELETE SET NULL, -- 关联日记
    related_timeline_node_id INT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_todos_user_status ON todos(user_id, status);
```

> 注意：`todos.related_timeline_node_id` 在 `timeline_nodes` 表创建后添加外键约束，或在实际迁移中调整建表顺序。

### 4.5 待办流转历史表 (`todo_status_history`)
```sql
CREATE TABLE todo_status_history (
    id SERIAL PRIMARY KEY,
    todo_id INT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    old_status VARCHAR(20),
    new_status VARCHAR(20) NOT NULL,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### 4.6 总结表 (`summaries`)
```sql
CREATE TABLE summaries (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('daily', 'weekly', 'monthly', 'yearly')),
    summary_date DATE NOT NULL,
    content TEXT NOT NULL,            -- Markdown 格式内容
    total_work_time INT DEFAULT 0,    -- 累计分钟工时
    tag_distribution JSONB DEFAULT '{}'::jsonb, -- 标签统计
    html_file_path VARCHAR(255),      -- 可视化网页文件存储路径
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_summaries_user_type_date ON summaries(user_id, type, summary_date);
```

### 4.6.1 任务时间线表 (`mission_timelines`)
```sql
CREATE TABLE mission_timelines (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    mission_type VARCHAR(20) DEFAULT 'side' CHECK (mission_type IN ('main', 'side')),
    status VARCHAR(20) DEFAULT 'in_progress' CHECK (status IN ('planned', 'in_progress', 'blocked', 'completed', 'archived')),
    progress INT DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    tags VARCHAR(50)[] DEFAULT '{}',
    color VARCHAR(20),
    ai_reason TEXT,                  -- AI 为什么将这些日记聚合为该任务线
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_mission_timelines_user_status ON mission_timelines(user_id, status);
```

### 4.6.2 时间线节点表 (`timeline_nodes`)
```sql
CREATE TABLE timeline_nodes (
    id SERIAL PRIMARY KEY,
    timeline_id INT NOT NULL REFERENCES mission_timelines(id) ON DELETE CASCADE,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    summary TEXT,
    status VARCHAR(20) DEFAULT 'in_progress' CHECK (status IN ('planned', 'in_progress', 'blocked', 'completed', 'archived')),
    start_time TIMESTAMP WITH TIME ZONE,
    end_time TIMESTAMP WITH TIME ZONE,
    related_diary_ids INT[] DEFAULT '{}',
    ai_reason TEXT,
    reward_meta JSONB DEFAULT '{}'::jsonb, -- 完成动画、徽章、经验值等轻量游戏化信息
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_timeline_nodes_timeline ON timeline_nodes(timeline_id, start_time);

ALTER TABLE todos
ADD CONSTRAINT fk_todos_timeline_node
FOREIGN KEY (related_timeline_node_id) REFERENCES timeline_nodes(id) ON DELETE SET NULL;
```

### 4.6.3 分享卡片表 (`share_cards`)
```sql
CREATE TABLE share_cards (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    share_type VARCHAR(20) NOT NULL CHECK (share_type IN ('summary', 'timeline', 'achievement')),
    source_id INT NOT NULL,
    title VARCHAR(255) NOT NULL,
    content_snapshot JSONB DEFAULT '{}'::jsonb,
    image_path VARCHAR(255),
    public_token VARCHAR(80) UNIQUE NOT NULL,
    visibility VARCHAR(20) DEFAULT 'link' CHECK (visibility IN ('public', 'link', 'password')),
    password_hash VARCHAR(255),
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_share_cards_user ON share_cards(user_id, created_at DESC);
```

### 4.7 向量索引表 (`diary_embeddings`)
```sql
-- 启用向量扩展
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE diary_embeddings (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    diary_id INT NOT NULL REFERENCES diaries(id) ON DELETE CASCADE,
    chunk_id VARCHAR(50) NOT NULL, -- 如 "日记ID:分片序号"
    text TEXT NOT NULL,
    embedding VECTOR(1536) NOT NULL, -- 维数应可动态支持，此处以1536维为例
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_diary_chunk UNIQUE (user_id, diary_id, chunk_id)
);
CREATE INDEX idx_diary_embeddings_vector ON diary_embeddings USING hnsw (embedding vector_cosine_ops);
```

---

## 5. 非功能性需求 (Non-Functional Requirements)

*   **完全的单数据库依赖**: 杜绝跨数据库的数据不一致问题。确保系统的本地安装包只需安装一个 PostgreSQL 服务（启用 `pgvector`）即可运行。
*   **事务的完备性**: 
    *   在生成待办时、或在恢复数据备份时，涉及多表写入的操作必须在单一 SQL 事务中执行，失败自动 Rollback。
*   **网络隔离环境部署友好度**: 必须支持完全离线的 Ollama 部署环境。
*   **跨网络访问安全**:
    *   如果用户通过公网域名、反向代理或内网穿透暴露服务，必须启用 HTTPS。
    *   API Key 只允许存储哈希，不允许数据库保存明文。
    *   Agent 写入、删除、更新等关键操作必须记录审计日志。
    *   分享页默认不暴露原始日记全文，不暴露 Agent 原始交互记录，不暴露模型配置与密钥。
*   **容错性**:
    *   如果 LLM 输出的总结格式有轻微偏差，后端 HTML 网页解析器需有自愈能力，必要时自动 fallback 到内置的静态 HTML 样式。

---

## 6. 可行性与竞品观察 (Feasibility & Competitive Notes)

### 6.1 可行性判断

*   **整体可行**: 人类主动记录、Agent 通过 API 写入、AI 总结、RAG 检索、待办提取、分享卡片都可以在单一 PostgreSQL + pgvector 架构下实现。
*   **建议 MVP 优先级**:
    1.  Web 工作台、日记 CRUD、双来源日记颜色区分。
    2.  API Key、Agent 身份、Agent Skill 文档、Agent 写入日记接口。
    3.  AI 结构化整理、日总结、待办提取。
    4.  任务时间线、轻量正反馈。
    5.  分享卡片、RAG 问答、备份恢复。
*   **主要技术风险**:
    *   Agent 自动回顾需要外部 Agent 主动提供会话摘要；系统无法天然获取所有 Agent 的上下文，除非通过插件、Skill 或用户授权接入。
    *   跨网络访问不是单纯前端能力，需要部署文档、安全配置、HTTPS、反向代理或云主机支持。
    *   任务时间线与待办容易重复，必须坚持“任务线是工作脉络，待办是可执行行动项”的边界。
    *   分享功能必须默认脱敏，否则工作日记很容易泄漏敏感信息。

### 6.2 竞品与差异化

*   **AI 日记类**: 市面上已有 AI Journal、情绪日记、生活记录产品，常见能力是语音/文本记录、自动摘要、情绪或主题分析。它们更偏个人反思，不强调外部 Agent 写入。
*   **工作日志类**: 一些 Work Journal 产品支持日常工作记录、职业档案、AI 总结，但通常仍以人类手动记录为主。
*   **Agent Memory 类**: Agent 记忆产品强调给 Agent 提供长期记忆、执行历史和上下文检索，但通常不是以用户可视化工作日记、任务时间线和分享传播为核心。
*   **本产品差异点**:
    *   以“AI Agent 使用者”为核心人群，而不是泛泛的日记用户。
    *   同时支持人类日记和 Agent 日记，并在同一条时间流中区分展示。
    *   通过 API Key + Skill 文档把系统变成 Agent 可写入的工作记忆入口。
    *   用主线/支线任务时间线把碎片日记转化为可持续推进的工作脉络。
    *   通过分享卡片和二维码把个人成果包装成可传播内容。
