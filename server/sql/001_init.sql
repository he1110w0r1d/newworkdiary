CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    nickname VARCHAR(100),
    role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    bio TEXT,
    avatar VARCHAR(255),
    work_profile JSONB DEFAULT '{}'::jsonb,
    llm_configs JSONB DEFAULT '[]'::jsonb,
    embedding_configs JSONB DEFAULT '[]'::jsonb,
    last_login_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agents (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    provider VARCHAR(100),
    default_color VARCHAR(20),
    skill_doc TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_agents_user ON agents(user_id);

CREATE TABLE IF NOT EXISTS api_keys (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id INT REFERENCES agents(id) ON DELETE SET NULL,
    key_hash VARCHAR(64) UNIQUE NOT NULL,
    key_mask VARCHAR(32) NOT NULL,
    scopes VARCHAR(50)[] DEFAULT '{}',
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_apikeys_hash ON api_keys(key_hash);

CREATE TABLE IF NOT EXISTS diaries (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_type VARCHAR(20) DEFAULT 'human' CHECK (source_type IN ('human', 'agent', 'system')),
    source_agent_id INT REFERENCES agents(id) ON DELETE SET NULL,
    source_session_id VARCHAR(100),
    title VARCHAR(255),
    content TEXT NOT NULL,
    summary TEXT,
    location VARCHAR(100),
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    tags VARCHAR(50)[] DEFAULT '{}',
    work_priority VARCHAR(10) DEFAULT '中' CHECK (work_priority IN ('高', '中', '低')),
    structured_meta JSONB DEFAULT '{}'::jsonb,
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_diaries_user_time ON diaries(user_id, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_diaries_source ON diaries(user_id, source_type, source_agent_id);

CREATE TABLE IF NOT EXISTS mission_timelines (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    parent_id INT REFERENCES mission_timelines(id) ON DELETE SET NULL,
    mission_type VARCHAR(20) DEFAULT 'side' CHECK (mission_type IN ('main', 'side')),
    status VARCHAR(20) DEFAULT 'in_progress' CHECK (status IN ('planned', 'in_progress', 'blocked', 'completed', 'archived')),
    progress INT DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    tags VARCHAR(50)[] DEFAULT '{}',
    color VARCHAR(20),
    ai_reason TEXT,
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_mission_timelines_user_status ON mission_timelines(user_id, status);

CREATE TABLE IF NOT EXISTS timeline_nodes (
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
    reward_meta JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_timeline_nodes_timeline ON timeline_nodes(timeline_id, start_time);

CREATE TABLE IF NOT EXISTS todos (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    priority VARCHAR(10) DEFAULT '中' CHECK (priority IN ('高', '中', '低')),
    due_date TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) DEFAULT '待办' CHECK (status IN ('待办', '已完成', '已放弃', '已转交')),
    related_diary_id INT REFERENCES diaries(id) ON DELETE SET NULL,
    related_timeline_node_id INT REFERENCES timeline_nodes(id) ON DELETE SET NULL,
    related_mission_id INT REFERENCES mission_timelines(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_todos_user_status ON todos(user_id, status);

CREATE TABLE IF NOT EXISTS todo_status_history (
    id SERIAL PRIMARY KEY,
    todo_id INT NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
    old_status VARCHAR(20),
    new_status VARCHAR(20) NOT NULL,
    reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS share_cards (
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
CREATE INDEX IF NOT EXISTS idx_share_cards_user ON share_cards(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    agent_id INT REFERENCES agents(id) ON DELETE SET NULL,
    api_key_id INT REFERENCES api_keys(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    target_type VARCHAR(50),
    target_id INT,
    request_meta JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_agent_audit_logs_user_time ON agent_audit_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_audit_logs_agent_time ON agent_audit_logs(agent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS app_settings (
    user_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme VARCHAR(50) DEFAULT '草莓薄荷',
    share_settings JSONB DEFAULT '{"generated": false, "visibility": "link"}'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- PRD 4.6 总结表
CREATE TABLE IF NOT EXISTS summaries (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('daily', 'weekly', 'monthly', 'yearly')),
    summary_date DATE NOT NULL,
    content TEXT NOT NULL,
    total_work_time INT DEFAULT 0,
    tag_distribution JSONB DEFAULT '{}'::jsonb,
    html_file_path VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_summaries_user_type_date ON summaries(user_id, type, summary_date);

-- PRD 4.7 向量索引表
CREATE TABLE IF NOT EXISTS diary_embeddings (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    diary_id INT NOT NULL REFERENCES diaries(id) ON DELETE CASCADE,
    chunk_id VARCHAR(50) NOT NULL,
    text TEXT NOT NULL,
    embedding VECTOR(1536) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_diary_chunk UNIQUE (user_id, diary_id, chunk_id)
);
CREATE INDEX IF NOT EXISTS idx_diary_embeddings_vector ON diary_embeddings USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS feedbacks (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE SET NULL,
    type VARCHAR(30) DEFAULT 'other' CHECK (type IN ('bug', 'suggestion', 'usage', 'model', 'other')),
    status VARCHAR(30) DEFAULT 'open' CHECK (status IN ('open', 'processing', 'resolved', 'closed')),
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    contact VARCHAR(255),
    admin_note TEXT,
    admin_response TEXT,
    responded_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_feedbacks_status_time ON feedbacks(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feedbacks_user_time ON feedbacks(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_activity_events (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE SET NULL,
    event_type VARCHAR(80) NOT NULL,
    target_type VARCHAR(50),
    target_id INT,
    meta JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_activity_events_user_time ON user_activity_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_events_type_time ON user_activity_events(event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS system_announcements (
    id SERIAL PRIMARY KEY,
    title VARCHAR(160) NOT NULL,
    content TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'paused')),
    starts_at TIMESTAMP WITH TIME ZONE,
    ends_at TIMESTAMP WITH TIME ZONE,
    created_by INT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_system_announcements_status_time ON system_announcements(status, starts_at, ends_at, created_at DESC);
