ALTER TABLE mission_timelines
  ADD COLUMN IF NOT EXISTS parent_id INT REFERENCES mission_timelines(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mission_timelines_parent ON mission_timelines(parent_id);
