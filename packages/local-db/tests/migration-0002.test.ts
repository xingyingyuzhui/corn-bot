import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'node:test'
import { isLocalDbError } from '../src/errors.ts'
import { MIGRATIONS } from '../src/migrations/index.ts'
import type { Migration } from '../src/migrations/types.ts'
import { migrationChecksum } from '../src/migrator.ts'
import { openLocalDb } from '../src/open.ts'
import {
  getSessionBinding,
  markClawCreateAttempt,
  setSessionBindingStage,
} from '../src/stores/bindings.ts'
import { getBot, insertBot } from '../src/stores/bots.ts'
import {
  dbPath,
  expectReady,
  openReady,
  seedChat,
  T0,
  tempDir,
  withRaw,
} from './helpers.ts'

const CORE = MIGRATIONS[0] as Migration
/** Applied migrations are immutable; this pins 0001 as shipped. */
const CORE_SHA256 =
  '46ca517453cc38172d926191ee3a7b109329fcabd050bacc3e8994c082f30ce0'

const isCode = (code: string, constraint?: string) => (error: unknown) =>
  isLocalDbError(error) &&
  error.code === code &&
  (constraint === undefined || error.constraint === constraint)

function columns(path: string, table: string): string[] {
  return withRaw(
    path,
    (raw) =>
      raw
        .all(`SELECT name FROM pragma_table_info('${table}') ORDER BY cid`)
        .map((row) => String(row.name)),
    { readOnly: true },
  )
}

/** v1 rows written with 0001's columns only, as a shipped 0001 build would. */
function seedV1(path: string): void {
  withRaw(path, (raw) => {
    raw.exec(`
      INSERT INTO bots (bot_id, display_name, sort_key, provisioning,
        created_at, updated_at)
      VALUES ('bot_ready', 'Ready', 'a', 'ready', ${T0}, ${T0}),
             ('bot_lost', 'Lost', 'b', 'needs_repair', ${T0}, ${T0}),
             ('bot_new', 'New', 'c', 'creating', ${T0}, ${T0});
      INSERT INTO claw_agents (bot_id, agent_id, workspace_id, canonical_root,
        dsh_preset, policy_preset, created_at)
      VALUES ('bot_ready', 'wa_1', 'ws_1', '/claw/one', 'wa-one', 'developer',
        ${T0});
      INSERT INTO conversations (conversation_id, bot_id, kind, created_at)
      VALUES ('conv_ready', 'bot_ready', 'main', ${T0}),
             ('conv_lost', 'bot_lost', 'main', ${T0}),
             ('conv_new', 'bot_new', 'main', ${T0});
      INSERT INTO session_bindings (binding_id, conversation_id, dsh_session_id,
        stage, last_error, home_id, created_at, updated_at)
      VALUES ('bind_ready', 'conv_ready', 'corn-ready', 'ready', NULL, 'home',
               ${T0}, ${T0 + 1}),
             ('bind_lost', 'conv_lost', 'corn-lost', 'planned',
               'claw_create_unknown', 'home', ${T0}, ${T0 + 2}),
             ('bind_new', 'conv_new', 'corn-new', 'planned', NULL, 'home',
               ${T0}, ${T0 + 3});
    `)
  })
}

test('0001 is unchanged; 0002 is appended', () => {
  assert.equal(migrationChecksum(CORE), CORE_SHA256)
  assert.deepEqual(
    MIGRATIONS.map((migration) => [migration.version, migration.name]),
    [
      [1, 'core'],
      [2, 'provisioner_intent'],
    ],
  )
})

test('a fresh install lands on 0002 with both columns', async (t) => {
  const dir = tempDir(t)
  const path = dbPath(dir)
  const result = await openLocalDb({ path, now: () => T0 })
  const db = expectReady(result)
  assert.deepEqual(result.status === 'ready' && result.migration, {
    from: 0,
    to: 2,
    applied: ['core', 'provisioner_intent'],
    backupPath: null,
  })
  assert.equal(db.settings().userVersion, 2)
  db.close()
  assert.ok(columns(path, 'bots').includes('policy_preset'))
  assert.ok(
    columns(path, 'session_bindings').includes('claw_create_attempted_at'),
  )
})

test('0001 → 0002 backs up first, then adds and backfills the columns', async (t) => {
  const dir = tempDir(t)
  const path = dbPath(dir)
  expectReady(
    await openLocalDb({ path, migrations: [CORE], now: () => T0 }),
  ).close()
  seedV1(path)

  const result = await openLocalDb({ path, now: () => T0 + 9 })
  const db = expectReady(result)
  t.after(() => db.close())
  const backupPath = join(dir, 'backups', `corn-v1-${T0 + 9}.sqlite`)
  assert.deepEqual(result.status === 'ready' && result.migration, {
    from: 1,
    to: 2,
    applied: ['provisioner_intent'],
    backupPath,
  })

  // The backup is the untouched v1 database.
  withRaw(
    backupPath,
    (raw) => {
      assert.equal(raw.pragma('user_version'), 1)
      assert.equal(raw.pragma('quick_check'), 'ok')
      assert.equal(raw.all('SELECT version FROM schema_migrations').length, 1)
    },
    { readOnly: true },
  )
  assert.equal(columns(backupPath, 'bots').includes('policy_preset'), false)

  const ledger = db.read((tx) =>
    tx.all('SELECT version, sha256, applied_at FROM schema_migrations'),
  )
  assert.deepEqual(
    ledger.map((row) => ({ ...row })),
    [
      { version: 1, sha256: CORE_SHA256, applied_at: T0 },
      {
        version: 2,
        sha256: migrationChecksum(MIGRATIONS[1] as Migration),
        applied_at: T0 + 9,
      },
    ],
  )

  db.read((tx) => {
    // A provisioned Bot inherits the preset its Claw agent was created with.
    assert.equal(getBot(tx, 'bot_ready')?.policyPreset, 'developer')
    assert.equal(getBot(tx, 'bot_lost')?.policyPreset, null)
    assert.equal(getBot(tx, 'bot_new')?.policyPreset, null)
    // Only a binding waiting on an unknown create gets an attempt time.
    assert.equal(
      getSessionBinding(tx, 'bind_lost')?.clawCreateAttemptedAt,
      T0 + 2,
    )
    assert.equal(
      getSessionBinding(tx, 'bind_ready')?.clawCreateAttemptedAt,
      null,
    )
    assert.equal(getSessionBinding(tx, 'bind_new')?.clawCreateAttemptedAt, null)
    // Untouched v1 data.
    assert.equal(getSessionBinding(tx, 'bind_lost')?.updatedAt, T0 + 2)
    assert.equal(getBot(tx, 'bot_ready')?.revision, 1)
  })

  // Reopening does not migrate or back up again.
  db.close()
  const again = await openLocalDb({ path, now: () => T0 + 20 })
  const reopened = expectReady(again)
  t.after(() => reopened.close())
  assert.deepEqual(again.status === 'ready' && again.migration, {
    from: 2,
    to: 2,
    applied: [],
    backupPath: null,
  })
})

test('the new columns are CHECK-constrained', async (t) => {
  const db = await openReady(t, { path: ':memory:' })
  seedChat(db)
  assert.throws(
    () =>
      db.write((tx) =>
        tx.run(
          "UPDATE bots SET policy_preset = 'admin' WHERE bot_id = 'bot_1'",
        ),
      ),
    isCode('constraint', 'check'),
  )
  assert.throws(
    () =>
      db.write((tx) =>
        tx.run(
          "UPDATE session_bindings SET claw_create_attempted_at = -1 WHERE binding_id = 'bind_1'",
        ),
      ),
    isCode('constraint', 'check'),
  )
})

test('insertBot stores the policy preset; omitted is null; others are refused', async (t) => {
  const db = await openReady(t, { path: ':memory:' })
  const base = {
    displayName: 'B',
    avatarVariant: null,
    sortKey: 'a',
    modelOverride: null,
    now: T0,
  }
  db.write((tx) => {
    insertBot(tx, { ...base, botId: 'bot_dev', policyPreset: 'developer' })
    insertBot(tx, { ...base, botId: 'bot_none' })
  })
  db.read((tx) => {
    assert.equal(getBot(tx, 'bot_dev')?.policyPreset, 'developer')
    assert.equal(getBot(tx, 'bot_none')?.policyPreset, null)
  })
  assert.throws(
    () =>
      db.write((tx) =>
        insertBot(tx, {
          ...base,
          botId: 'bot_bad',
          policyPreset: 'admin' as never,
        }),
      ),
    isCode('invalid_input'),
  )
})

test('markClawCreateAttempt checkpoints a planned binding only', async (t) => {
  const db = await openReady(t, { path: ':memory:' })
  const { bindingId } = seedChat(db)
  const row = db.write((tx) =>
    markClawCreateAttempt(tx, bindingId, {
      now: T0 + 50,
      lastError: 'claw_create_unknown',
    }),
  )
  assert.equal(row.stage, 'planned')
  assert.equal(row.lastError, 'claw_create_unknown')
  assert.equal(row.clawCreateAttemptedAt, T0 + 50)
  assert.equal(row.updatedAt, T0 + 50)

  // Later writes move updated_at, never the attempt time.
  const later = db.write((tx) =>
    setSessionBindingStage(tx, bindingId, 'planned', {
      now: T0 + 90,
      lastError: 'claw_create_unknown',
    }),
  )
  assert.equal(later.clawCreateAttemptedAt, T0 + 50)

  db.write((tx) =>
    setSessionBindingStage(tx, bindingId, 'agent_created', {
      now: T0 + 100,
      lastError: null,
    }),
  )
  assert.throws(
    () =>
      db.write((tx) =>
        markClawCreateAttempt(tx, bindingId, {
          now: T0 + 200,
          lastError: 'claw_create_unknown',
        }),
      ),
    isCode('invalid_transition'),
  )
  const planned = seedChat(db, '2')
  assert.throws(
    () =>
      db.write((tx) =>
        markClawCreateAttempt(tx, planned.bindingId, {
          now: T0 + 200,
          lastError: 'Not A Code',
        }),
      ),
    isCode('invalid_input'),
  )
})
