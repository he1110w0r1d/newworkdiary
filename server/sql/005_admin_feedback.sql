ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at);
CREATE INDEX IF NOT EXISTS idx_users_last_login_at ON users(last_login_at);

WITH first_user AS (
  SELECT id
  FROM users
  ORDER BY created_at ASC, id ASC
  LIMIT 1
)
UPDATE users
SET role = 'admin'
WHERE id IN (SELECT id FROM first_user)
  AND NOT EXISTS (SELECT 1 FROM users WHERE role = 'admin');

CREATE TABLE IF NOT EXISTS feedbacks (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE SET NULL,
    type VARCHAR(30) DEFAULT 'other' CHECK (type IN ('bug', 'suggestion', 'usage', 'model', 'other')),
    status VARCHAR(30) DEFAULT 'open' CHECK (status IN ('open', 'processing', 'resolved', 'closed')),
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    contact VARCHAR(255),
    admin_note TEXT,
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
