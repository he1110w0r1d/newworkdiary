# 作业本 (Agent Work Diary) 部署与运维说明

本文档详细介绍了“作业本”系统的本地单机、Docker 容器化、离线大模型联动以及远程反向代理的安全生产部署方案。

---

## 📋 目录
1. [环境变量配置](#1-环境变量配置)
2. [Docker Compose 一键部署](#2-docker-compose-一键部署)
3. [本地离线部署 (Ollama 联动)](#3-本地离线部署-ollama-联动)
4. [生产反向代理与 HTTPS 配置 (Nginx)](#4-生产反向代理与-https-配置-nginx)
5. [常见问题与运维排错](#5-常见问题与运维排错)

---

## 1. 环境变量配置

系统支持通过 `.env` 环境变量文件进行灵活配置。请在项目根目录下创建 `.env` 文件。

### ⚙️ 核心环境变量列表

| 变量名 | 必填 | 默认值 | 示例 / 说明 |
| :--- | :---: | :--- | :--- |
| `DATABASE_URL` | 否 | 无 | `postgres://user:pass@localhost:5432/zuoyeben`<br>如果不配置，系统自动降级为**单机本地 Demo 存储模式**。若需使用 AI、总结、向量检索 (RAG) 等全部核心功能，**必须**配置该项。 |
| `API_PORT` | 否 | `3000` | 后端 Express API 服务的监听端口。 |
| `VITE_API_BASE_URL` | 否 | `/api` | 前端网络请求的后端 API 基准地址。单端口部署推荐使用默认相对路径。 |
| `PUBLIC_APP_URL` | 否 | 请求来源 | 分享卡片生成公开链接时使用的应用外部访问地址，例如 `https://diary.example.com`。 |
| `JWT_SECRET` | 是 | 开发默认值 | 生产环境必须设置为足够长的随机字符串，用于签发登录 Token。 |
| `POSTGRES_PORT` | 否 | `5433` | Docker Compose 将 PostgreSQL 绑定到宿主机本地端口，默认避开常见的本机 `5432` 冲突。 |
| `NODE_ENV` | 否 | `development` | 设为 `production` 时，Express 后端会自动静态托管 `dist` 目录下的前端产物，实现单端口全栈部署。 |

---

## 2. Docker Compose 一键部署

系统已内置 `Dockerfile` 和 `docker-compose.yml`，支持通过 Docker 一键部署完整的全栈应用（包含内置 pgvector 向量支持的 PostgreSQL 数据库）。

### 🚀 部署步骤

1. **克隆代码并进入目录**：
   ```bash
   cd mobile_workdiary
   ```

2. **编写环境变量配置文件 `.env`**：
   ```env
   API_PORT=3000
   DATABASE_URL=postgres://postgres:postgres@db:5432/zuoyeben
   APP_PORT=3001
   PUBLIC_APP_URL=http://your-server-ip:3001
   JWT_SECRET=请替换为一段足够长的随机字符串
   POSTGRES_PORT=5433
   ```

3. **使用 Docker Compose 启动容器**：
   ```bash
   docker compose up -d --build
   ```
   启动前请确认 Docker Desktop / Docker Engine 已运行。Compose 默认把 Web 服务绑定到宿主机 `3001`，避免和本地开发 API 的 `3000` 冲突；数据库绑定到宿主机 `127.0.0.1:5433`，不会占用你本机常用的 PostgreSQL `5432` 端口。如果需要调整，可以修改 `.env` 中的 `APP_PORT` 和 `POSTGRES_PORT`。

4. **确认服务运行状态**：
   ```bash
   docker compose ps
   ```
   后端服务会自动执行迁移脚本（自动检测并执行 `server/sql/` 目录下的 SQL 迁移，无需手动初始化表结构）。

---

## 3. 本地离线部署 (Ollama 联动)

为了确保工作日记等高隐私敏感数据的绝对安全，推荐使用本地离线大模型（如 Ollama）进行智能 analysis 与 RAG 问答。

### 🔌 配置桥接

在 Docker 容器化环境中运行的“作业本”后端，默认无法直接通过 `localhost` 访问运行在宿主机（Host）上的 Ollama。需要通过以下方式进行网络桥接：

#### 方案一：在 `docker-compose.yml` 中配置 Host 桥接（推荐）
在 `app` 服务下配置 `extra_hosts`，将 `host.docker.internal` 映射到宿主机网关：

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    extra_hosts:
      - "host.docker.internal:host-gateway" # 桥接宿主机网络
    environment:
      DATABASE_URL: postgres://postgres:postgres@db:5432/zuoyeben
      API_PORT: 3000
      PUBLIC_APP_URL: http://localhost:${APP_PORT:-3001}
    ports:
      - "${APP_PORT:-3001}:3000"
```

#### 方案二：配置 Ollama 监听所有网卡
默认情况下，Ollama 仅监听 `127.0.0.1`。需将其配置为允许跨网卡访问：
* **macOS**：
  在终端中运行以下命令修改环境变量，并重启 Ollama 客户端：
  ```bash
  launchctl setenv OLLAMA_HOST "0.0.0.0"
  ```
* **Linux (Systemd)**：
  编辑 service 配置：
  ```bash
  sudo systemctl edit ollama.service
  ```
  在 `[Service]` 下方添加：
  ```ini
  Environment="OLLAMA_HOST=0.0.0.0"
  ```
  保存并重启服务：
  ```bash
  sudo systemctl daemon-reload
  sudo systemctl restart ollama
  ```

### 🧠 模型推荐与配置
启动后，进入系统的“**设置页 -> 大模型服务配置**”或在备份恢复中导入配置：
* **LLM 生成服务**：单独配置供应商、Base URL、对话模型和 API Key。例如 Base URL 填 `http://host.docker.internal:11434/v1`，模型填 `llama3.1` 或 `qwen2.5:7b`。
* **Embedding 向量服务**：单独配置供应商、Base URL、向量模型和 API Key。例如本地 Ollama 可填同一个 Base URL，模型填 `nomic-embed-text`；也可以让 LLM 走云端，Embedding 走本地。
* **API Key**：本地 Ollama 可留空；云端 LLM 与云端 Embedding 可以分别填写不同 Key。

---

## 4. 生产反向代理与 HTTPS 配置 (Nginx)

如果需要将作业本部署到云服务器供外网多用户登录，**强烈建议使用 HTTPS 协议**，以保证 JWT Token、工作日记和 API 密钥的传输安全。

### 🔒 Nginx 配置模版

以下是一个经典的 Nginx 反向代理配置，包含了 SSL 证书配置、前端静态托管和 API 接口转发。

```nginx
server {
    listen 80;
    server_name diary.yourdomain.com;
    # 强制跳转 HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name diary.yourdomain.com;

    # SSL 证书配置
    ssl_certificate /etc/nginx/certs/diary.yourdomain.com.crt;
    ssl_certificate_key /etc/nginx/certs/diary.yourdomain.com.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # 开启 Gzip 压缩，优化前端资源加载速度
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;

    # 1. 静态报表托管目录反向代理
    location /reports/ {
        proxy_pass http://127.0.0.1:3000/reports/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # 2. 后端 API 转发
    location /api/ {
        proxy_pass http://127.0.0.1:3000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # 延长超时时间以支持大模型慢速流式/长文本响应
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    # 3. 前端单页应用 (SPA) 路由代理
    location / {
        proxy_pass http://127.0.0.1:3000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # 支持 React Router History 模式，找不到静态文件时回退到 index.html
        try_files $uri $uri/ /index.html;
    }
}
```

---

## 5. 常见问题与运维排错

### ❓ 数据库连接失败（Database Connection Refused）
* **诊断**：检查后端容器日志：`docker compose logs app`
* **原因**：PostgreSQL 容器尚未完全启动或健康检查未通过，导致后端尝试连接时超时。
* **解决**：在 `docker-compose.yml` 中使用 `depends_on` 并设置 `condition: service_healthy`，确保数据库处于就绪状态再启动后端。

### ❓ Docker build 长时间停在 `load metadata for docker.io/library/node:22-alpine`
* **诊断**：单独执行 `docker pull node:22-alpine`。如果也没有进度，说明卡在 Docker Hub 镜像拉取或本机镜像源网络，不是项目 Dockerfile 出错。
* **解决**：
  1. 确认 Docker Desktop / Docker Engine 已完全启动。
  2. 检查 Docker Desktop 的代理或镜像源配置。
  3. 在网络恢复后先执行 `docker pull node:22-alpine` 和 `docker pull pgvector/pgvector:pg17`。
  4. 镜像拉取成功后再执行 `docker compose up -d --build`。

### ❓ AI 智能总结一直处于“生成中...”或超时失败
* **原因**：大模型服务不可用，或网络连接超时。
* **排查**：系统已实现自愈降级机制。如果大模型持续不可用，系统会将自动生成的**模板日报**及**规则待办**写入数据库并呈现，但如果页面长时无响应，请排查后台日志，确认是否是由于没有大模型 API 密钥、网络请求被墙或超时参数设置过短所致。

### ❓ 无法进行 AI 问答，提示 503 错误
* **原因**：本地向量模型接口不可用或没有重建向量索引。
* **排查**：
  1. 确认系统设置页已手动触发“**重建向量索引**”且成功（会有对应的分片数量提示）。
  2. 确认大模型配置的 `embeddingModel` 已被宿主机的大模型服务（如 Ollama）拉取：`ollama pull nomic-embed-text`。
