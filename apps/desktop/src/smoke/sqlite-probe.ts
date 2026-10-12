/**
 * ADR-0002 driver probe for desktop smoke runs: opens a scratch `node:sqlite`
 * database in the calling process, selects WAL with `synchronous=FULL`, proves
 * foreign keys are enforced, takes an online `backup()` and reads it back,
 * then checkpoints, closes and removes the scratch directory. It is evidence
 * for the driver choice, not Corn's data layer.
 */
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { backup, DatabaseSync } from 'node:sqlite'

export interface SqliteProbeFacts {
  readonly sqliteVersion: string | null
  /** `journal_mode=WAL` returned `wal` and a WAL file existed after a write. */
  readonly wal: boolean
  readonly synchronousFull: boolean
  /** `foreign_keys` read 1 and an orphan insert was rejected. */
  readonly foreignKeys: boolean
  /** The online backup reopened read-only, passed `quick_check` and held the rows. */
  readonly backupOk: boolean
  /** Electron Main (`process.type === 'browser'`), not a renderer, utility or plain Node. */
  readonly mainProcess: boolean
  /** Error code or name only; never a message or path. */
  readonly failure: string | null
}

const SQLITE_CONSTRAINT_FOREIGNKEY = 787
const SYNCHRONOUS_FULL = 2

function pragma(db: DatabaseSync, sql: string): unknown {
  const row = db.prepare(sql).get()
  return row === undefined ? undefined : Object.values(row)[0]
}

function failureCode(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    if ('code' in error && typeof error.code === 'string') return error.code
    if (error instanceof Error) return error.name
  }
  return 'unknown'
}

function orphanRejected(db: DatabaseSync): boolean {
  try {
    db.exec('INSERT INTO probe_child (id, parent_id) VALUES (2, 99)')
    return false
  } catch (error) {
    return (
      typeof error === 'object' &&
      error !== null &&
      'errcode' in error &&
      error.errcode === SQLITE_CONSTRAINT_FOREIGNKEY
    )
  }
}

function backupReadable(path: string): boolean {
  const copy = new DatabaseSync(path, { readOnly: true })
  try {
    return (
      pragma(copy, 'PRAGMA quick_check') === 'ok' &&
      pragma(copy, 'SELECT count(*) FROM probe_child WHERE parent_id = 1') === 1
    )
  } finally {
    copy.close()
  }
}

export async function probeSqlite(
  parent: string = tmpdir(),
): Promise<SqliteProbeFacts> {
  const facts: {
    -readonly [K in keyof SqliteProbeFacts]: SqliteProbeFacts[K]
  } = {
    sqliteVersion: null,
    wal: false,
    synchronousFull: false,
    foreignKeys: false,
    backupOk: false,
    mainProcess: process.type === 'browser',
    failure: null,
  }
  let dir: string | undefined
  let db: DatabaseSync | undefined
  try {
    dir = await mkdtemp(join(parent, 'corn-sqlite-probe-'))
    const path = join(dir, 'probe.sqlite')
    db = new DatabaseSync(path, { timeout: 5_000 })
    const version = pragma(db, 'SELECT sqlite_version()')
    facts.sqliteVersion = typeof version === 'string' ? version : null
    const mode = pragma(db, 'PRAGMA journal_mode=WAL')
    db.exec('PRAGMA synchronous=FULL')
    facts.synchronousFull =
      pragma(db, 'PRAGMA synchronous') === SYNCHRONOUS_FULL
    db.exec(`
      CREATE TABLE probe_parent (id INTEGER PRIMARY KEY);
      CREATE TABLE probe_child (
        id INTEGER PRIMARY KEY,
        parent_id INTEGER NOT NULL REFERENCES probe_parent (id)
      );
      INSERT INTO probe_parent (id) VALUES (1);
      INSERT INTO probe_child (id, parent_id) VALUES (1, 1);
    `)
    facts.wal = mode === 'wal' && existsSync(`${path}-wal`)
    facts.foreignKeys =
      pragma(db, 'PRAGMA foreign_keys') === 1 && orphanRejected(db)
    const copy = join(dir, 'probe-backup.sqlite')
    await backup(db, copy)
    facts.backupOk = backupReadable(copy)
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  } catch (error) {
    facts.failure = failureCode(error)
  } finally {
    if (db?.isOpen) db.close()
    if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  }
  return facts
}

export function sqliteProbePassed(facts: SqliteProbeFacts): boolean {
  return (
    facts.failure === null &&
    facts.sqliteVersion !== null &&
    facts.wal &&
    facts.synchronousFull &&
    facts.foreignKeys &&
    facts.backupOk &&
    facts.mainProcess
  )
}
