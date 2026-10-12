import type { Migration } from './types.ts'

/**
 * P3 core schema. Applied migrations are immutable: the migrator stores the
 * SHA-256 of `sql` and refuses to open a database whose ledger disagrees.
 * Changes go into a new migration.
 */
export const migration0001Core: Migration = {
  version: 1,
  name: 'core',
  sql: `
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  applied_at INTEGER NOT NULL
) STRICT;

CREATE TABLE bots (
  bot_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL CHECK (length(display_name) > 0),
  avatar_variant TEXT,
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  sort_key TEXT NOT NULL,
  model_override_provider TEXT,
  model_override_model TEXT,
  model_override_effort TEXT,
  provisioning TEXT NOT NULL
    CHECK (provisioning IN ('creating', 'ready', 'needs_repair')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK ((model_override_provider IS NULL) = (model_override_model IS NULL)),
  CHECK (model_override_effort IS NULL OR model_override_model IS NOT NULL)
) STRICT;

CREATE TABLE claw_agents (
  bot_id TEXT PRIMARY KEY REFERENCES bots (bot_id),
  agent_id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  canonical_root TEXT NOT NULL,
  dsh_preset TEXT NOT NULL,
  policy_preset TEXT NOT NULL CHECK (policy_preset IN ('research', 'developer')),
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE conversations (
  conversation_id TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots (bot_id),
  kind TEXT NOT NULL CHECK (kind IN ('main')),
  created_at INTEGER NOT NULL
) STRICT;
CREATE INDEX conversations_bot ON conversations (bot_id);
CREATE UNIQUE INDEX one_main_conversation ON conversations (bot_id)
  WHERE kind = 'main';

CREATE TABLE session_bindings (
  binding_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations (conversation_id),
  dsh_session_id TEXT NOT NULL UNIQUE,
  stage TEXT NOT NULL CHECK (stage IN ('planned', 'agent_created',
    'preset_ensured', 'session_created', 'verified', 'bound', 'model_applied',
    'ready', 'needs_model', 'retired')),
  last_error TEXT,
  applied_provider TEXT,
  applied_model TEXT,
  applied_effort TEXT,
  home_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (binding_id, conversation_id),
  CHECK ((applied_provider IS NULL) = (applied_model IS NULL)),
  CHECK (applied_effort IS NULL OR applied_model IS NOT NULL)
) STRICT;
CREATE INDEX session_bindings_conversation
  ON session_bindings (conversation_id);
CREATE UNIQUE INDEX one_live_binding ON session_bindings (conversation_id)
  WHERE stage <> 'retired';

CREATE TABLE message_admissions (
  request_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations (conversation_id),
  binding_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('queue')),
  state TEXT NOT NULL CHECK (state IN ('pending', 'sending', 'accepted',
    'observed', 'rejected', 'unknown', 'withdrawn')),
  body_text TEXT,
  body_sha256 TEXT NOT NULL CHECK (length(body_sha256) = 64),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  observed_seq INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (conversation_id, client_id),
  FOREIGN KEY (binding_id, conversation_id)
    REFERENCES session_bindings (binding_id, conversation_id),
  CHECK (body_text IS NULL OR state NOT IN ('observed', 'withdrawn')),
  CHECK (body_text IS NOT NULL OR state NOT IN ('pending', 'sending', 'unknown')),
  CHECK (observed_seq IS NULL OR state = 'observed')
) STRICT;
CREATE INDEX admissions_binding ON message_admissions (binding_id);
CREATE INDEX admissions_open ON message_admissions (state)
  WHERE state IN ('pending', 'sending', 'unknown');

CREATE TABLE tags (
  tag_id TEXT PRIMARY KEY,
  label TEXT NOT NULL UNIQUE CHECK (length(label) > 0),
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE bot_tags (
  bot_id TEXT NOT NULL REFERENCES bots (bot_id),
  tag_id TEXT NOT NULL REFERENCES tags (tag_id),
  PRIMARY KEY (bot_id, tag_id)
) STRICT;
CREATE INDEX bot_tags_tag ON bot_tags (tag_id);

CREATE TABLE ui_prefs (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;
`,
}
