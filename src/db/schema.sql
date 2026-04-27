-- Run once on Railway PostgreSQL instance
-- psql $DATABASE_URL < src/db/schema.sql

CREATE TABLE IF NOT EXISTS agent_runs (
  id            SERIAL PRIMARY KEY,
  agent_id      TEXT        NOT NULL,
  trigger       TEXT        NOT NULL,
  status        TEXT        NOT NULL CHECK (status IN ('success','error','approval_pending')),
  input_summary TEXT,
  output_summary TEXT,
  duration_ms   INTEGER,
  tokens_used   INTEGER,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_agent_id  ON agent_runs(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_created_at ON agent_runs(created_at DESC);

-- ─── Job queue (for deferred / scheduled runs) ───────────────────────────────
CREATE TABLE IF NOT EXISTS job_queue (
  id         SERIAL PRIMARY KEY,
  agent_id   TEXT        NOT NULL,
  payload    JSONB       NOT NULL,
  status     TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed')),
  run_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  done_at    TIMESTAMPTZ,
  error      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_queue_status_run_at ON job_queue(status, run_at);

-- ─── Approval queue (outputs awaiting Sam 1-click) ───────────────────────────
CREATE TABLE IF NOT EXISTS approval_queue (
  id           SERIAL PRIMARY KEY,
  agent_id     TEXT        NOT NULL,
  run_id       INTEGER     REFERENCES agent_runs(id),
  output_type  TEXT        NOT NULL,  -- 'broadcast','review_response','owner_report', etc.
  payload      JSONB       NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','edited','rejected')),
  teams_msg_id TEXT,                  -- Teams message ID for in-message approval
  approved_by  TEXT,
  approved_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approval_queue_status ON approval_queue(status, created_at DESC);

-- ─── Agent state (key/value store per agent+building) ────────────────────────
CREATE TABLE IF NOT EXISTS agent_state (
  agent_id    TEXT        NOT NULL,
  building_id TEXT        NOT NULL,
  key         TEXT        NOT NULL,
  value       JSONB       NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (agent_id, building_id, key)
);
