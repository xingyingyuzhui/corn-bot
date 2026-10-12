import type { Migration } from './types.ts'

/**
 * Provisioning intent that must survive a restart before Claw answers:
 * - `bots.policy_preset`: the draft's Claw policy preset (decision 6B), known
 *   at step 0, before `claw_agents` exists. Backfilled from `claw_agents`.
 * - `session_bindings.claw_create_attempted_at`: Corn clock when the
 *   non-idempotent `registry/create` was checkpointed; the 16A adoption window.
 *   Backfilled from `updated_at` for bindings already waiting on an unknown create.
 */
export const migration0002ProvisionerIntent: Migration = {
  version: 2,
  name: 'provisioner_intent',
  sql: `
ALTER TABLE bots ADD COLUMN policy_preset TEXT
  CHECK (policy_preset IS NULL OR policy_preset IN ('research', 'developer'));

UPDATE bots SET policy_preset = (
  SELECT policy_preset FROM claw_agents WHERE claw_agents.bot_id = bots.bot_id
);

ALTER TABLE session_bindings ADD COLUMN claw_create_attempted_at INTEGER
  CHECK (claw_create_attempted_at IS NULL OR claw_create_attempted_at >= 0);

UPDATE session_bindings SET claw_create_attempted_at = updated_at
  WHERE stage = 'planned' AND last_error = 'claw_create_unknown';
`,
}
