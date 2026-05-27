ALTER TABLE todos
  ADD COLUMN IF NOT EXISTS related_mission_id INT REFERENCES mission_timelines(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_todos_related_mission ON todos(related_mission_id);
