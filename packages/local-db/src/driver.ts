import { chmodSync } from 'node:fs'
import * as sqlite from 'node:sqlite'
import { type ConstraintKind, LocalDbError } from './errors.ts'

/**
 * The only module that touches `node:sqlite`. Swapping the driver (for
 * example to better-sqlite3, ADR-0002 triggers) only rewrites this file.
 */

type DatabaseConstructor = typeof sqlite.DatabaseSync
type DatabaseHandle = InstanceType<DatabaseConstructor>
type StatementHandle = ReturnType<DatabaseHandle['prepare']>

// Node 26 renames `DatabaseSync` to `Database` (DEP0210).
const Database: DatabaseConstructor =
  (sqlite as unknown as { readonly Database?: DatabaseConstructor }).Database ??
  sqlite.DatabaseSync

export type SqlValue = null | number | string | Uint8Array
export type SqlParams = Readonly<Record<string, SqlValue>>
export type SqlRow = Readonly<Record<string, unknown>>

export interface SqlExecutor {
  exec(sql: string): void
  run(sql: string, params?: SqlParams): { readonly changes: number }
  get(sql: string, params?: SqlParams): SqlRow | undefined
  all(sql: string, params?: SqlParams): readonly SqlRow[]
}

export interface ConnectionOptions {
  readonly readOnly?: boolean
  readonly busyTimeoutMs?: number
}

const SQLITE_CONSTRAINT = 19

export const SqliteResult = {
  busy: 5,
  corrupt: 11,
  cantOpen: 14,
  notADatabase: 26,
} as const

/** Primary SQLite result code of a driver error, or `null` for non-SQLite errors. */
export function sqliteResultCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null
  const errcode = (error as { readonly errcode?: unknown }).errcode
  return typeof errcode === 'number' ? errcode & 0xff : null
}

function constraintKind(extended: number): ConstraintKind {
  switch (extended) {
    case 2067:
      return 'unique'
    case 1555:
      return 'primary_key'
    case 787:
      return 'foreign_key'
    case 275:
      return 'check'
    case 1299:
      return 'not_null'
    case 3091:
      return 'datatype'
    default:
      return 'other'
  }
}

function translate(error: unknown): unknown {
  if (sqliteResultCode(error) !== SQLITE_CONSTRAINT) return error
  const extended = (error as { readonly errcode: number }).errcode
  const kind = constraintKind(extended)
  return new LocalDbError('constraint', `SQLite ${kind} constraint failed`, {
    constraint: kind,
    cause: error,
  })
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { readonly then?: unknown }).then === 'function'
  )
}

/**
 * Executor handed to a `write()`/`read()` callback. It refuses every call
 * once the transaction has ended, so an `await` cannot carry statements past
 * COMMIT or ROLLBACK into autocommit mode.
 */
class TransactionExecutor implements SqlExecutor {
  #active = true
  readonly #connection: SqliteConnection

  constructor(connection: SqliteConnection) {
    this.#connection = connection
  }

  end(): void {
    this.#active = false
  }

  #check(): SqliteConnection {
    if (!this.#active) {
      throw new LocalDbError(
        'transaction_closed',
        'Transaction executor used after the transaction ended',
      )
    }
    return this.#connection
  }

  exec(sql: string): void {
    this.#check().exec(sql)
  }

  run(sql: string, params?: SqlParams): { readonly changes: number } {
    return this.#check().run(sql, params)
  }

  get(sql: string, params?: SqlParams): SqlRow | undefined {
    return this.#check().get(sql, params)
  }

  all(sql: string, params?: SqlParams): readonly SqlRow[] {
    return this.#check().all(sql, params)
  }
}

export class SqliteConnection implements SqlExecutor {
  readonly location: string
  readonly #db: DatabaseHandle
  readonly #statements = new Map<string, StatementHandle>()

  private constructor(location: string, db: DatabaseHandle) {
    this.location = location
    this.#db = db
  }

  static open(
    location: string,
    options: ConnectionOptions = {},
  ): SqliteConnection {
    const db = new Database(location, {
      readOnly: options.readOnly ?? false,
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
      allowExtension: false,
      readBigInts: false,
      timeout: options.busyTimeoutMs ?? 5000,
    })
    db.enableDefensive(true)
    return new SqliteConnection(location, db)
  }

  get isOpen(): boolean {
    return this.#db.isOpen
  }

  get inTransaction(): boolean {
    return this.#db.isTransaction
  }

  #statement(sql: string): StatementHandle {
    let statement = this.#statements.get(sql)
    if (statement === undefined) {
      statement = this.#db.prepare(sql)
      this.#statements.set(sql, statement)
    }
    return statement
  }

  exec(sql: string): void {
    try {
      this.#db.exec(sql)
    } catch (error) {
      throw translate(error)
    }
  }

  run(sql: string, params: SqlParams = {}): { readonly changes: number } {
    try {
      const result = this.#statement(sql).run(params)
      return { changes: Number(result.changes) }
    } catch (error) {
      throw translate(error)
    }
  }

  get(sql: string, params: SqlParams = {}): SqlRow | undefined {
    try {
      return this.#statement(sql).get(params)
    } catch (error) {
      throw translate(error)
    }
  }

  all(sql: string, params: SqlParams = {}): readonly SqlRow[] {
    try {
      return this.#statement(sql).all(params)
    } catch (error) {
      throw translate(error)
    }
  }

  /** Value of a single-column PRAGMA, e.g. `pragma('journal_mode=WAL')`. */
  pragma(statement: string): unknown {
    const row = this.get(`PRAGMA ${statement}`)
    if (row === undefined) return undefined
    return Object.values(row)[0]
  }

  /**
   * Runs `fn` inside `BEGIN IMMEDIATE`. A thrown error rolls back and is
   * rethrown; a returned thenable rolls back and throws `async_transaction`.
   */
  write<T>(fn: (tx: SqlExecutor) => T): T {
    return this.#transaction('BEGIN IMMEDIATE', false, fn)
  }

  /** Runs `fn` in a deferred transaction with `query_only` enforced. */
  read<T>(fn: (tx: SqlExecutor) => T): T {
    return this.#transaction('BEGIN', true, fn)
  }

  #transaction<T>(
    begin: string,
    queryOnly: boolean,
    fn: (tx: SqlExecutor) => T,
  ): T {
    if (!this.#db.isOpen) {
      throw new LocalDbError('closed', 'Database connection is closed')
    }
    if (this.#db.isTransaction) {
      throw new LocalDbError(
        'nested_transaction',
        'Transactions cannot be nested',
      )
    }
    const tx = new TransactionExecutor(this)
    if (queryOnly) this.exec('PRAGMA query_only = ON')
    try {
      this.exec(begin)
      let result: T
      try {
        result = fn(tx)
        if (isThenable(result)) {
          Promise.resolve(result).catch(() => {})
          throw new LocalDbError(
            'async_transaction',
            'Transaction callbacks must be synchronous',
          )
        }
        tx.end()
        this.exec('COMMIT')
      } catch (error) {
        tx.end()
        if (this.#db.isTransaction) this.exec('ROLLBACK')
        throw error
      }
      return result
    } finally {
      if (queryOnly) this.exec('PRAGMA query_only = OFF')
    }
  }

  /** Online backup (`sqlite.backup`) to `destination`, then mode 0600. */
  async backupTo(destination: string): Promise<void> {
    await sqlite.backup(this.#db, destination)
    chmodSync(destination, 0o600)
  }

  close(): void {
    if (!this.#db.isOpen) return
    this.#statements.clear()
    this.#db.close()
  }
}
