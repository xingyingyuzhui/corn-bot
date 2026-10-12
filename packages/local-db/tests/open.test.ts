import assert from 'node:assert/strict'
import {
  closeSync,
  existsSync,
  openSync,
  readdirSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { MIGRATIONS } from '../src/migrations/index.ts'
import type { Migration } from '../src/migrations/types.ts'
import {
  BACKUPS_KEPT,
  CORN_APPLICATION_ID,
  migrationChecksum,
} from '../src/migrator.ts'
import { openLocalDb } from '../src/open.ts'
import { insertBot } from '../src/stores/bots.ts'
import { getMeta } from '../src/stores/meta.ts'
import {
  dbPath,
  expectReady,
  fileSha,
  openReady,
  T0,
  tempDir,
  withRaw,
} from './helpers.ts'

const LATEST = MIGRATIONS.length
const NEXT = LATEST + 1

const CORE_TABLES = [
  'bot_tags',
  'bots',
  'claw_agents',
  'conversations',
  'message_admissions',
  'meta',
  'schema_migrations',
  'session_bindings',
  'tags',
  'ui_prefs',
]

function extra(version: number, sql: string): Migration {
  return { version, name: `extra_${version}`, sql }
}

function tables(path: string): string[] {
  return withRaw(
    path,
    (raw) =>
      raw
        .all(
          "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
        )
        .map((row) => String(row.name)),
    { readOnly: true },
  )
}

function mode(path: string): number {
  return statSync(path).mode & 0o777
}

test('a fresh file migrates to the latest version with ledger, data id and 0600 mode', async (t) => {
  const dir = tempDir(t)
  const path = dbPath(dir)
  const result = await openLocalDb({ path, now: () => T0 })
  const db = expectReady(result)
  t.after(() => db.close())

  assert.deepEqual(result.status === 'ready' && result.migration, {
    from: 0,
    to: LATEST,
    applied: MIGRATIONS.map((migration) => migration.name),
    backupPath: null,
  })
  const settings = db.settings()
  assert.equal(settings.userVersion, MIGRATIONS.length)
  assert.equal(settings.applicationId, CORN_APPLICATION_ID)
  const ledger = db.read((tx) =>
    tx.all('SELECT version, name, sha256, applied_at FROM schema_migrations'),
  )
  assert.deepEqual(
    ledger.map((row) => ({ ...row })),
    MIGRATIONS.map((migration) => ({
      version: migration.version,
      name: migration.name,
      sha256: migrationChecksum(migration),
      applied_at: T0,
    })),
  )
  assert.match(
    db.read((tx) => getMeta(tx, 'data_id')) ?? '',
    /^data_[0-9a-f-]{36}$/u,
  )
  assert.equal(
    db.read((tx) => getMeta(tx, 'home_id')),
    null,
  )
  db.close()
  assert.deepEqual(tables(path), CORE_TABLES)
  assert.equal(mode(path), 0o600)
  assert.equal(existsSync(join(dir, 'backups')), false)
})

test(':memory: databases migrate too', async (t) => {
  const db = await openReady(t, { path: ':memory:' })
  const settings = db.settings()
  assert.equal(settings.userVersion, MIGRATIONS.length)
  assert.equal(settings.journalMode, 'memory')
  assert.equal(settings.foreignKeys, true)
})

test('WAL, synchronous=FULL, foreign keys, trusted_schema=OFF and busy timeout are asserted', async (t) => {
  const path = dbPath(tempDir(t))
  const db = await openReady(t, { path })
  assert.deepEqual(db.settings(), {
    journalMode: 'wal',
    synchronous: 2,
    foreignKeys: true,
    trustedSchema: false,
    busyTimeoutMs: 5000,
    applicationId: CORN_APPLICATION_ID,
    userVersion: MIGRATIONS.length,
  })
  db.write((tx) =>
    insertBot(tx, {
      botId: 'bot_wal',
      displayName: 'WAL',
      avatarVariant: null,
      sortKey: 'a',
      modelOverride: null,
      now: T0,
    }),
  )
  assert.equal(existsSync(`${path}-wal`), true)
  assert.equal(mode(`${path}-wal`), 0o600)
})

test('reopening a current database does not migrate again or back up', async (t) => {
  const dir = tempDir(t)
  const path = dbPath(dir)
  expectReady(await openLocalDb({ path, now: () => T0 })).close()
  const result = await openLocalDb({ path, now: () => T0 + 1000 })
  const db = expectReady(result)
  t.after(() => db.close())
  assert.deepEqual(result.status === 'ready' && result.migration, {
    from: LATEST,
    to: LATEST,
    applied: [],
    backupPath: null,
  })
  const appliedAt = db.read((tx) =>
    tx.all('SELECT applied_at FROM schema_migrations').map((r) => r.applied_at),
  )
  assert.deepEqual(
    appliedAt,
    MIGRATIONS.map(() => T0),
  )
  assert.equal(existsSync(join(dir, 'backups')), false)
})

test('a database from a newer Corn is refused without being written', async (t) => {
  const dir = tempDir(t)
  const path = dbPath(dir)
  expectReady(await openLocalDb({ path })).close()
  withRaw(path, (raw) => raw.exec('PRAGMA user_version = 99'))
  const before = { sha: fileSha(path), mtime: statSync(path).mtimeMs }

  const result = await openLocalDb({ path })
  assert.deepEqual(result, { status: 'from_future', userVersion: 99 })
  assert.equal(fileSha(path), before.sha)
  assert.equal(statSync(path).mtimeMs, before.mtime)
  assert.equal(existsSync(join(dir, 'backups')), false)
  assert.equal(
    withRaw(path, (raw) => raw.pragma('user_version'), { readOnly: true }),
    99,
  )
})

test('an upgrade backs up first and applies pending migrations in one step', async (t) => {
  const dir = tempDir(t)
  const path = dbPath(dir)
  expectReady(await openLocalDb({ path, now: () => T0 })).close()
  const migrations = [
    ...MIGRATIONS,
    extra(NEXT, 'CREATE TABLE extra_next (x INTEGER NOT NULL) STRICT;'),
  ]
  const result = await openLocalDb({ path, migrations, now: () => T0 + 5 })
  const db = expectReady(result)
  t.after(() => db.close())
  const backupPath = join(dir, 'backups', `corn-v${LATEST}-${T0 + 5}.sqlite`)
  assert.deepEqual(result.status === 'ready' && result.migration, {
    from: LATEST,
    to: NEXT,
    applied: [`extra_${NEXT}`],
    backupPath,
  })
  assert.equal(mode(backupPath), 0o600)
  assert.equal(statSync(join(dir, 'backups')).mode & 0o777, 0o700)
  assert.equal(
    withRaw(backupPath, (raw) => raw.pragma('user_version'), {
      readOnly: true,
    }),
    LATEST,
  )
  assert.equal(db.settings().userVersion, NEXT)
})

test('a migration that throws midway rolls back; the backup exists and opens', async (t) => {
  const dir = tempDir(t)
  const path = dbPath(dir)
  expectReady(await openLocalDb({ path, now: () => T0 })).close()
  const broken = [
    ...MIGRATIONS,
    extra(
      NEXT,
      `CREATE TABLE extra_next (x INTEGER NOT NULL) STRICT;
       INSERT INTO extra_next (x) VALUES (1);
       INSERT INTO no_such_table (x) VALUES (1);`,
    ),
  ]

  const result = await openLocalDb({
    path,
    migrations: broken,
    now: () => T0 + 7,
  })
  const backupPath = join(dir, 'backups', `corn-v${LATEST}-${T0 + 7}.sqlite`)
  assert.equal(result.status, 'migration_failed')
  assert.equal(
    result.status === 'migration_failed' && result.reason,
    'migration_threw',
  )
  assert.equal(
    result.status === 'migration_failed' && result.backupPath,
    backupPath,
  )

  assert.deepEqual(tables(path), CORE_TABLES)
  withRaw(
    path,
    (raw) => {
      assert.equal(raw.pragma('user_version'), LATEST)
      assert.equal(
        raw.all('SELECT version FROM schema_migrations').length,
        LATEST,
      )
    },
    { readOnly: true },
  )
  withRaw(
    backupPath,
    (raw) => {
      assert.equal(raw.pragma('user_version'), LATEST)
      assert.equal(raw.pragma('application_id'), CORN_APPLICATION_ID)
      assert.equal(raw.pragma('quick_check'), 'ok')
    },
    { readOnly: true },
  )
  assert.deepEqual(tables(backupPath), CORE_TABLES)

  const reopened = await openLocalDb({ path })
  assert.equal(reopened.status, 'ready')
  if (reopened.status === 'ready') reopened.db.close()
})

test('a failed first migration leaves an empty, unmarked file', async (t) => {
  const path = dbPath(tempDir(t))
  const result = await openLocalDb({
    path,
    migrations: [
      extra(1, 'CREATE TABLE a (x INTEGER) STRICT; SELECT * FROM nope;'),
    ],
  })
  assert.equal(result.status, 'migration_failed')
  assert.equal(result.status === 'migration_failed' && result.backupPath, null)
  withRaw(
    path,
    (raw) => {
      assert.equal(raw.pragma('user_version'), 0)
      assert.equal(raw.pragma('application_id'), 0)
    },
    { readOnly: true },
  )
  assert.deepEqual(tables(path), [])
})

test(`only the newest ${BACKUPS_KEPT} backups are kept`, async (t) => {
  const dir = tempDir(t)
  const path = dbPath(dir)
  let clock = T0
  const now = () => clock
  expectReady(await openLocalDb({ path, now })).close()
  const migrations: Migration[] = [...MIGRATIONS]
  for (let version = NEXT; version <= LATEST + 5; version += 1) {
    clock += 1
    migrations.push(
      extra(version, `CREATE TABLE t${version} (x INTEGER) STRICT;`),
    )
    expectReady(await openLocalDb({ path, migrations, now })).close()
  }
  assert.deepEqual(readdirSync(join(dir, 'backups')).sort(), [
    `corn-v${LATEST + 2}-${T0 + 3}.sqlite`,
    `corn-v${LATEST + 3}-${T0 + 4}.sqlite`,
    `corn-v${LATEST + 4}-${T0 + 5}.sqlite`,
  ])
})

test('an edited applied migration is refused as schema_tampered', async (t) => {
  const path = dbPath(tempDir(t))
  expectReady(await openLocalDb({ path })).close()
  const core = MIGRATIONS[0] as Migration
  const edited = [
    { ...core, sql: `${core.sql}\n-- edited` },
    ...MIGRATIONS.slice(1),
  ]
  assert.deepEqual(await openLocalDb({ path, migrations: edited }), {
    status: 'schema_tampered',
    reason: 'checksum_mismatch',
  })
})

test('a tampered or truncated ledger is refused as schema_tampered', async (t) => {
  const path = dbPath(tempDir(t))
  expectReady(await openLocalDb({ path })).close()
  withRaw(path, (raw) =>
    raw.exec(`UPDATE schema_migrations SET sha256 = '${'a'.repeat(64)}'`),
  )
  assert.deepEqual(await openLocalDb({ path }), {
    status: 'schema_tampered',
    reason: 'checksum_mismatch',
  })
  withRaw(path, (raw) => raw.exec('DELETE FROM schema_migrations'))
  assert.deepEqual(await openLocalDb({ path }), {
    status: 'schema_tampered',
    reason: 'ledger_mismatch',
  })
})

test('garbage bytes are reported as corrupt', async (t) => {
  const path = dbPath(tempDir(t))
  writeFileSync(path, Buffer.alloc(8192, 'not sqlite '))
  const before = fileSha(path)
  assert.deepEqual(await openLocalDb({ path }), {
    status: 'corrupt',
    reason: 'not_a_database',
  })
  assert.equal(fileSha(path), before)
})

test('a damaged page fails quick_check and is reported as corrupt', async (t) => {
  const path = dbPath(tempDir(t))
  const db = expectReady(await openLocalDb({ path }))
  db.close()
  const pageSize = 4096
  const fd = openSync(path, 'r+')
  writeSync(fd, Buffer.alloc(pageSize, 0xa5), 0, pageSize, pageSize)
  closeSync(fd)
  const result = await openLocalDb({ path })
  assert.equal(result.status, 'corrupt')
})

test('a SQLite file with another application_id is refused untouched', async (t) => {
  const path = dbPath(tempDir(t))
  expectReady(await openLocalDb({ path })).close()
  withRaw(path, (raw) => raw.exec('PRAGMA application_id = 42'))
  const before = fileSha(path)
  assert.deepEqual(await openLocalDb({ path }), {
    status: 'unavailable',
    reason: 'foreign_database',
  })
  assert.equal(fileSha(path), before)
})

test('a non-Corn SQLite file with application_id 0 is refused', async (t) => {
  const path = dbPath(tempDir(t))
  withRaw(path, (raw) => raw.exec('CREATE TABLE notes (body TEXT) STRICT'))
  assert.deepEqual(await openLocalDb({ path }), {
    status: 'unavailable',
    reason: 'foreign_database',
  })
})

test('a missing parent directory is reported as unavailable', async (t) => {
  const path = join(tempDir(t), 'missing', 'corn.sqlite')
  assert.deepEqual(await openLocalDb({ path }), {
    status: 'unavailable',
    reason: 'open_failed',
  })
})
