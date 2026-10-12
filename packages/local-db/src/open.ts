import { randomUUID } from 'node:crypto'
import { chmodSync, closeSync, existsSync, openSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  type SqlExecutor,
  SqliteConnection,
  SqliteResult,
  sqliteResultCode,
} from './driver.ts'
import { MIGRATIONS, type Migration } from './migrations/index.ts'
import {
  CORN_APPLICATION_ID,
  type MigrationFailure,
  type MigrationReport,
  migrate,
} from './migrator.ts'
import { setMeta } from './stores/meta.ts'

export const MEMORY_LOCATION = ':memory:'
export const BUSY_TIMEOUT_MS = 5000
const SYNCHRONOUS_FULL = 2

export type LocalDbFailure =
  | {
      readonly status: 'corrupt'
      readonly reason: 'not_a_database' | 'integrity_check_failed'
    }
  | {
      readonly status: 'unavailable'
      readonly reason: 'foreign_database' | 'open_failed' | 'pragma_rejected'
    }
  | MigrationFailure

export type LocalDbFailureStatus = LocalDbFailure['status']

export type LocalDbOpenResult =
  | {
      readonly status: 'ready'
      readonly db: LocalDb
      readonly migration: MigrationReport
    }
  | LocalDbFailure

export interface OpenLocalDbOptions {
  /** Database file path, or `:memory:` for tests. The parent must exist. */
  readonly path: string
  /** Defaults to `<dirname(path)>/backups`. */
  readonly backupDir?: string
  readonly now?: () => number
  /** Shipped migrations unless overridden (tests only). */
  readonly migrations?: readonly Migration[]
}

export interface LocalDbSettings {
  readonly journalMode: string
  readonly synchronous: number
  readonly foreignKeys: boolean
  readonly trustedSchema: boolean
  readonly busyTimeoutMs: number
  readonly applicationId: number
  readonly userVersion: number
}

/** An open, migrated Corn database. Main is its only writer. */
export class LocalDb {
  readonly #connection: SqliteConnection

  constructor(connection: SqliteConnection) {
    this.#connection = connection
  }

  get location(): string {
    return this.#connection.location
  }

  get isOpen(): boolean {
    return this.#connection.isOpen
  }

  write<T>(fn: (tx: SqlExecutor) => T): T {
    return this.#connection.write(fn)
  }

  read<T>(fn: (tx: SqlExecutor) => T): T {
    return this.#connection.read(fn)
  }

  settings(): LocalDbSettings {
    const connection = this.#connection
    return {
      journalMode: String(connection.pragma('journal_mode')),
      synchronous: Number(connection.pragma('synchronous')),
      foreignKeys: Number(connection.pragma('foreign_keys')) === 1,
      trustedSchema: Number(connection.pragma('trusted_schema')) === 1,
      busyTimeoutMs: Number(connection.pragma('busy_timeout')),
      applicationId: Number(connection.pragma('application_id')),
      userVersion: Number(connection.pragma('user_version')),
    }
  }

  /** `wal_checkpoint(TRUNCATE)` then close; safe to call twice. */
  close(): void {
    if (!this.#connection.isOpen) return
    if (this.#connection.location !== MEMORY_LOCATION) {
      this.#connection.pragma('wal_checkpoint(TRUNCATE)')
    }
    this.#connection.close()
  }
}

interface HeaderProbe {
  readonly applicationId: number
  readonly userVersion: number
  readonly schemaObjects: number
}

function readHeader(connection: SqliteConnection): HeaderProbe {
  return {
    applicationId: Number(connection.pragma('application_id')),
    userVersion: Number(connection.pragma('user_version')),
    schemaObjects: Number(
      connection.get('SELECT count(*) AS n FROM sqlite_schema')?.n,
    ),
  }
}

function quickCheckPassed(connection: SqliteConnection): boolean {
  const rows = connection.all('PRAGMA quick_check')
  return rows.length === 1 && rows[0]?.quick_check === 'ok'
}

/** `null` = acceptable (fresh or a Corn database this code can migrate). */
function classifyHeader(
  header: HeaderProbe,
  latest: number,
): LocalDbFailure | null {
  if (header.applicationId === CORN_APPLICATION_ID) {
    if (header.userVersion > latest) {
      return { status: 'from_future', userVersion: header.userVersion }
    }
    if (header.userVersion === 0) {
      return { status: 'schema_tampered', reason: 'ledger_mismatch' }
    }
    return null
  }
  const fresh =
    header.applicationId === 0 &&
    header.userVersion === 0 &&
    header.schemaObjects === 0
  return fresh ? null : { status: 'unavailable', reason: 'foreign_database' }
}

function failureFromError(error: unknown): LocalDbFailure {
  switch (sqliteResultCode(error)) {
    case SqliteResult.notADatabase:
      return { status: 'corrupt', reason: 'not_a_database' }
    case SqliteResult.corrupt:
      return { status: 'corrupt', reason: 'integrity_check_failed' }
    default:
      return { status: 'unavailable', reason: 'open_failed' }
  }
}

/**
 * Inspects an existing file through a read-only connection, so a refused
 * database (foreign, from the future, corrupt) is never written to.
 */
function probeExisting(path: string, latest: number): LocalDbFailure | null {
  let connection: SqliteConnection | null = null
  try {
    connection = SqliteConnection.open(path, {
      readOnly: true,
      busyTimeoutMs: BUSY_TIMEOUT_MS,
    })
    const refused = classifyHeader(readHeader(connection), latest)
    if (refused !== null) return refused
    return quickCheckPassed(connection)
      ? null
      : { status: 'corrupt', reason: 'integrity_check_failed' }
  } catch (error) {
    return failureFromError(error)
  } finally {
    connection?.close()
  }
}

function restrictFileModes(path: string): void {
  closeSync(openSync(path, 'a', 0o600))
  for (const file of [path, `${path}-wal`, `${path}-shm`]) {
    if (existsSync(file)) chmodSync(file, 0o600)
  }
}

function configure(connection: SqliteConnection, memory: boolean): boolean {
  const journal = String(connection.pragma('journal_mode = WAL')).toLowerCase()
  if (journal !== (memory ? 'memory' : 'wal')) return false
  connection.exec('PRAGMA synchronous = FULL')
  connection.exec('PRAGMA trusted_schema = OFF')
  return (
    Number(connection.pragma('synchronous')) === SYNCHRONOUS_FULL &&
    Number(connection.pragma('foreign_keys')) === 1 &&
    Number(connection.pragma('trusted_schema')) === 0 &&
    Number(connection.pragma('busy_timeout')) === BUSY_TIMEOUT_MS
  )
}

/**
 * Opens the Corn database: refuse foreign/future/corrupt files without
 * writing, enable WAL + `synchronous=FULL` + foreign keys, then migrate.
 * Never throws for data problems; the result carries a closed status.
 */
export async function openLocalDb(
  options: OpenLocalDbOptions,
): Promise<LocalDbOpenResult> {
  const migrations = options.migrations ?? MIGRATIONS
  const now = options.now ?? Date.now
  const memory = options.path === MEMORY_LOCATION

  if (!memory) {
    if (existsSync(options.path) && statSync(options.path).size > 0) {
      const refused = probeExisting(options.path, migrations.length)
      if (refused !== null) return refused
    }
    try {
      restrictFileModes(options.path)
    } catch {
      return { status: 'unavailable', reason: 'open_failed' }
    }
  }

  let connection: SqliteConnection
  try {
    connection = SqliteConnection.open(options.path, {
      busyTimeoutMs: BUSY_TIMEOUT_MS,
    })
  } catch (error) {
    return failureFromError(error)
  }

  try {
    if (memory) {
      const refused = classifyHeader(readHeader(connection), migrations.length)
      if (refused !== null) {
        connection.close()
        return refused
      }
    }
    if (!configure(connection, memory)) {
      connection.close()
      return { status: 'unavailable', reason: 'pragma_rejected' }
    }
    const outcome = await migrate(connection, {
      migrations,
      backupDir: memory
        ? null
        : (options.backupDir ?? join(dirname(options.path), 'backups')),
      now,
      seed: (tx) => setMeta(tx, 'data_id', `data_${randomUUID()}`),
    })
    if (!outcome.ok) {
      connection.close()
      return outcome.failure
    }
    return {
      status: 'ready',
      db: new LocalDb(connection),
      migration: outcome.report,
    }
  } catch (error) {
    connection.close()
    return failureFromError(error)
  }
}
