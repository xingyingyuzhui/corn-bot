import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { SqlExecutor, SqliteConnection } from './driver.ts'
import type { Migration } from './migrations/types.ts'

export const CORN_APPLICATION_ID = 0x434f524e // 'CORN'
export const BACKUPS_KEPT = 3

const BACKUP_FILE = /^corn-v(\d+)-(\d+)\.sqlite$/u

export function migrationChecksum(migration: Migration): string {
  return createHash('sha256').update(migration.sql, 'utf8').digest('hex')
}

export function assertMigrationList(migrations: readonly Migration[]): void {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new Error(
        `Migration ${migration.name} must have version ${index + 1}`,
      )
    }
  })
}

export type MigrationFailure =
  | { readonly status: 'from_future'; readonly userVersion: number }
  | {
      readonly status: 'schema_tampered'
      readonly reason:
        | 'ledger_missing'
        | 'ledger_mismatch'
        | 'checksum_mismatch'
    }
  | {
      readonly status: 'migration_failed'
      readonly reason: 'backup_failed' | 'migration_threw'
      readonly backupPath: string | null
      readonly cause: unknown
    }

export interface MigrationReport {
  readonly from: number
  readonly to: number
  readonly applied: readonly string[]
  readonly backupPath: string | null
}

export type MigrationOutcome =
  | { readonly ok: true; readonly report: MigrationReport }
  | { readonly ok: false; readonly failure: MigrationFailure }

export interface MigrateOptions {
  readonly migrations: readonly Migration[]
  /** Directory for pre-migration backups; `null` only for `:memory:`. */
  readonly backupDir: string | null
  readonly now: () => number
  /** Runs inside the migration transaction when creating a fresh database. */
  readonly seed: (tx: SqlExecutor) => void
}

function userVersion(connection: SqliteConnection): number {
  return Number(connection.pragma('user_version'))
}

function verifyLedger(
  connection: SqliteConnection,
  applied: readonly Migration[],
): MigrationFailure | null {
  let rows: readonly Record<string, unknown>[]
  try {
    rows = connection.all(
      'SELECT version, name, sha256 FROM schema_migrations ORDER BY version',
    )
  } catch {
    return { status: 'schema_tampered', reason: 'ledger_missing' }
  }
  if (rows.length !== applied.length) {
    return { status: 'schema_tampered', reason: 'ledger_mismatch' }
  }
  for (const [index, migration] of applied.entries()) {
    const row = rows[index]
    if (row?.version !== migration.version || row.name !== migration.name) {
      return { status: 'schema_tampered', reason: 'ledger_mismatch' }
    }
    if (row.sha256 !== migrationChecksum(migration)) {
      return { status: 'schema_tampered', reason: 'checksum_mismatch' }
    }
  }
  return null
}

function pruneBackups(backupDir: string): void {
  const backups = readdirSync(backupDir)
    .map((name) => ({ name, match: BACKUP_FILE.exec(name) }))
    .filter((entry) => entry.match !== null)
    .map((entry) => ({ name: entry.name, at: Number(entry.match?.[2]) }))
    .sort((a, b) => b.at - a.at || b.name.localeCompare(a.name))
  for (const stale of backups.slice(BACKUPS_KEPT)) {
    rmSync(join(backupDir, stale.name), { force: true })
  }
}

async function backup(
  connection: SqliteConnection,
  backupDir: string,
  from: number,
  at: number,
): Promise<string> {
  mkdirSync(backupDir, { recursive: true, mode: 0o700 })
  const destination = join(backupDir, `corn-v${from}-${at}.sqlite`)
  await connection.backupTo(destination)
  pruneBackups(backupDir)
  return destination
}

/**
 * Signal-style migration: `user_version` is the schema version, newer
 * databases are refused untouched, every pending migration plus the ledger
 * rows and the new `user_version` commit in one `BEGIN IMMEDIATE`
 * transaction, and an upgrade of existing data is preceded by a backup.
 */
export async function migrate(
  connection: SqliteConnection,
  options: MigrateOptions,
): Promise<MigrationOutcome> {
  const { migrations } = options
  assertMigrationList(migrations)
  const latest = migrations.length
  const from = userVersion(connection)

  if (from > latest) {
    return { ok: false, failure: { status: 'from_future', userVersion: from } }
  }
  if (from > 0) {
    const tampered = verifyLedger(connection, migrations.slice(0, from))
    if (tampered !== null) return { ok: false, failure: tampered }
  }
  if (from === latest) {
    return {
      ok: true,
      report: { from, to: from, applied: [], backupPath: null },
    }
  }

  let backupPath: string | null = null
  if (from > 0 && options.backupDir !== null) {
    try {
      backupPath = await backup(
        connection,
        options.backupDir,
        from,
        options.now(),
      )
    } catch (cause) {
      return {
        ok: false,
        failure: {
          status: 'migration_failed',
          reason: 'backup_failed',
          backupPath: null,
          cause,
        },
      }
    }
  }

  const pending = migrations.slice(from)
  try {
    connection.write((tx) => {
      const appliedAt = options.now()
      for (const migration of pending) {
        tx.exec(migration.sql)
        tx.run(
          `INSERT INTO schema_migrations (version, name, sha256, applied_at)
           VALUES (:version, :name, :sha256, :appliedAt)`,
          {
            version: migration.version,
            name: migration.name,
            sha256: migrationChecksum(migration),
            appliedAt,
          },
        )
      }
      if (from === 0) {
        tx.exec(`PRAGMA application_id = ${CORN_APPLICATION_ID}`)
        options.seed(tx)
      }
      if (tx.all('PRAGMA foreign_key_check').length > 0) {
        throw new Error('Migration left foreign key violations')
      }
      tx.exec(`PRAGMA user_version = ${latest}`)
    })
  } catch (cause) {
    return {
      ok: false,
      failure: {
        status: 'migration_failed',
        reason: 'migration_threw',
        backupPath,
        cause,
      },
    }
  }
  return {
    ok: true,
    report: {
      from,
      to: latest,
      applied: pending.map((migration) => migration.name),
      backupPath,
    },
  }
}
