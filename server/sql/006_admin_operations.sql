ALTER TABLE feedbacks
  ADD COLUMN IF NOT EXISTS admin_response TEXT,
  ADD COLUMN IF NOT EXISTS responded_at TIMESTAMP WITH TIME ZONE;

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
