-- ============================================================
-- Makilab Agent — PostgreSQL Schema (Tier 3 Memory)
-- ============================================================
-- Philosophy: whitelist approach (denied by default), full audit trail,
-- all config editable from Mission Control without restart.
-- ============================================================

-- Full audit trail of every agent action
CREATE TABLE IF NOT EXISTS activity_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action     VARCHAR(255) NOT NULL,
  subagent   VARCHAR(100),
  channel    VARCHAR(50),
  details    JSONB,
  status     VARCHAR(50) NOT NULL DEFAULT 'success',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_subagent ON activity_log(subagent);

-- LLM API cost tracking per call
CREATE TABLE IF NOT EXISTS cost_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service       VARCHAR(100) NOT NULL,
  model         VARCHAR(100) NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd      DECIMAL(10,6) NOT NULL DEFAULT 0,
  task_id       UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cost_log_created_at ON cost_log(created_at DESC);

-- Agentic tasks with typed steps (workflow engine)
CREATE TABLE IF NOT EXISTS tasks (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title      TEXT NOT NULL,
  status     VARCHAR(50) NOT NULL DEFAULT 'pending',
  created_by VARCHAR(50) NOT NULL DEFAULT 'user',
  channel    VARCHAR(50) NOT NULL,
  priority   VARCHAR(20) NOT NULL DEFAULT 'medium',
  due_at     TIMESTAMPTZ,
  steps      JSONB NOT NULL DEFAULT '[]',
  context    JSONB NOT NULL DEFAULT '{}',
  git_branch VARCHAR(255),
  cron_id    VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_channel ON tasks(channel);

-- Agent config — all editable from Mission Control without restart
CREATE TABLE IF NOT EXISTS bot_config (
  key        VARCHAR(255) PRIMARY KEY,
  value      JSONB NOT NULL,
  category   VARCHAR(100) NOT NULL DEFAULT 'general',
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Permissions — whitelist (denied by default)
-- level: allowed = auto | confirm = ask user | denied = refuse + log
CREATE TABLE IF NOT EXISTS permissions (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subagent   VARCHAR(100) NOT NULL,
  action     VARCHAR(255) NOT NULL,
  level      VARCHAR(20) NOT NULL DEFAULT 'confirm',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(subagent, action)
);

-- WhatsApp session state
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status          VARCHAR(50) NOT NULL DEFAULT 'disconnected',
  connected_at    TIMESTAMPTZ,
  disconnected_at TIMESTAMPTZ,
  messages_count  INTEGER NOT NULL DEFAULT 0,
  last_message_at TIMESTAMPTZ,
  retry_count     INTEGER NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- CRON schedules — proactive tasks
CREATE TABLE IF NOT EXISTS cron_schedules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  description   TEXT,
  schedule      VARCHAR(100) NOT NULL,
  task_template JSONB NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT true,
  last_run_at   TIMESTAMPTZ,
  next_run_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- Default permissions (whitelist)
-- ============================================================
INSERT INTO permissions (subagent, action, level) VALUES
  ('obsidian', 'read',        'allowed'),
  ('obsidian', 'create',      'allowed'),
  ('obsidian', 'update',      'confirm'),
  ('obsidian', 'delete',      'denied'),
  ('gmail',    'read',        'allowed'),
  ('gmail',    'search',      'allowed'),
  ('gmail',    'send',        'confirm'),
  ('gmail',    'delete',      'denied'),
  ('karakeep', 'read',        'allowed'),
  ('karakeep', 'create',      'allowed'),
  ('karakeep', 'delete',      'confirm'),
  ('web',      'search',      'allowed'),
  ('web',      'fetch',       'allowed'),
  ('code',     'read',        'allowed'),
  ('code',     'write',       'confirm'),
  ('code',     'commit',      'allowed'),
  ('code',     'push_main',   'denied'),
  ('code',     'push_branch', 'allowed')
ON CONFLICT (subagent, action) DO NOTHING;

-- ============================================================
-- Default config
-- ============================================================
INSERT INTO bot_config (key, value, category, description) VALUES
  ('agent.max_iterations',           '10',                       'agent',    'Max iterations in agent loop'),
  ('agent.model_primary',            '"claude-sonnet-4-6"',      'llm',      'Primary LLM for conversations'),
  ('agent.model_economic',           '"google/gemini-flash-1.5"','llm',      'Economic LLM for batch tasks'),
  ('agent.model_code',               '"claude-sonnet-4-6"',      'llm',      'LLM for code generation'),
  ('llm.sensitive_force_anthropic',  'true',                     'security', 'Force Anthropic for sensitive data'),
  ('llm.daily_budget_usd',           '5.0',                      'cost',     'Daily spend alert threshold USD'),
  ('memory.max_messages',            '20',                       'memory',   'Max messages per context window'),
  ('memory.compact_threshold',       '30',                       'memory',   'Messages before compaction'),
  ('smart_capture.confidence_auto',  '0.8',                      'agent',    'Confidence for auto-filing'),
  ('smart_capture.confidence_ask',   '0.5',                      'agent',    'Confidence for asking vs inbox')
ON CONFLICT (key) DO NOTHING;

-- Default CRON (inactive — activate from Mission Control)
INSERT INTO cron_schedules (name, description, schedule, task_template, active) VALUES
  ('morning_briefing', 'Briefing matinal', '0 7 * * *',
   '{"title":"Briefing matin","priority":"high","steps":[{"subagent":"gmail","action":"search","input":{"query":"is:unread newer_than:1d"}}]}',
   false),
  ('job_alerts', 'Alertes emploi toutes les 2h', '0 */2 * * *',
   '{"title":"Alertes emploi","priority":"medium","steps":[{"subagent":"gmail","action":"search","input":{"query":"from:jobalerts-noreply@linkedin.com newer_than:2h"}}]}',
   false)
ON CONFLICT DO NOTHING;
