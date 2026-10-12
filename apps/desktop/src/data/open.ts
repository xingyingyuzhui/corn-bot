import type {
  DataStatus,
  DataStatusView,
  WorkspaceResult,
} from '../../../../packages/contracts/src/workspace.ts'
import {
  getMeta,
  type LocalDb,
  type LocalDbFailure,
  type LocalDbOpenResult,
  listLiveSessionBindings,
  type OpenLocalDbOptions,
  openLocalDb,
  type SessionBindingRow,
  setMeta,
  setSessionBindingStage,
} from '../../../../packages/local-db/src/index.ts'
import { acquireProcessLock } from '../runtime/process-lock.ts'
import { readCornHomeId } from '../runtime/profile-bootstrap.ts'
import {
  assertIsolatedDataDir,
  claimDataDir,
  DATA_LOCK_FILE,
  dataPaths,
} from './paths.ts'

/** Closed `last_error` on bindings minted for another DSH home. */
export const HOME_MISMATCH = 'home_mismatch'

/**
 * How the database relates to the current DSH home marker.
 * `unverified`: no readable `homeId` yet (the Host claims the home at start)
 * or no database; `mismatch`: the database was paired with another home.
 */
export type HomeCheck = 'unverified' | 'matched' | 'mismatch'

type Release = () => Promise<void>

export interface CornDataOptions {
  readonly dir: string
  /** The Corn DSH home; the data directory must not overlap it. */
  readonly home: string
  readonly openDb?: (options: OpenLocalDbOptions) => Promise<LocalDbOpenResult>
  readonly lock?: (dir: string, file: string) => Promise<Release>
  readonly readHomeId?: (home: string) => Promise<string | undefined>
  readonly now?: () => number
  /** Receives closed status and reason codes only, never paths or driver text. */
  readonly log?: (line: string) => void
}

/** Closed reason for logs; driver causes and paths are dropped. */
function failureReason(failure: LocalDbFailure): string {
  switch (failure.status) {
    case 'corrupt':
    case 'unavailable':
    case 'schema_tampered':
    case 'migration_failed':
      return failure.reason
    case 'from_future':
      return `user_version_${failure.userVersion}`
    default: {
      const unreachable: never = failure
      throw new Error(`Unknown data failure ${String(unreachable)}`)
    }
  }
}

const DATA_UNAVAILABLE = {
  ok: false,
  error: { code: 'data_unavailable' },
} as const

/**
 * Main's owner of Corn's local database: the isolated directory, its process
 * lock, open + migrate, the DSH home pairing and checkpoint-on-close. Opening
 * never throws; any failure becomes a closed `DataStatus`, the database stays
 * closed and Bot management and chat stay disabled. Nothing is repaired or
 * deleted automatically.
 */
export class CornData {
  readonly #dir: string
  readonly #home: string
  readonly #openDb: NonNullable<CornDataOptions['openDb']>
  readonly #lock: NonNullable<CornDataOptions['lock']>
  readonly #readHomeId: NonNullable<CornDataOptions['readHomeId']>
  readonly #now: () => number
  readonly #log: (line: string) => void
  #status: DataStatus = 'opening'
  #db: LocalDb | undefined
  #release: Release | undefined
  #homeId: string | undefined
  #homeCheck: HomeCheck = 'unverified'
  #opening: Promise<DataStatus> | undefined
  #closing: Promise<void> | undefined

  constructor(options: CornDataOptions) {
    this.#dir = options.dir
    this.#home = options.home
    this.#openDb = options.openDb ?? openLocalDb
    this.#lock = options.lock ?? acquireProcessLock
    this.#readHomeId = options.readHomeId ?? readCornHomeId
    this.#now = options.now ?? Date.now
    this.#log = options.log ?? ((line) => console.warn(line))
  }

  get status(): DataStatus {
    return this.#status
  }

  view(): DataStatusView {
    return { status: this.#status }
  }

  get homeCheck(): HomeCheck {
    return this.#homeCheck
  }

  /** The verified current home id new bindings must carry; absent until verified. */
  get homeId(): string | undefined {
    return this.#homeId
  }

  /** The open database, only while `ready`. */
  get db(): LocalDb | undefined {
    return this.#status === 'ready' ? this.#db : undefined
  }

  /** Workspace commands start here: anything but `ready` is `data_unavailable`. */
  available(): WorkspaceResult<LocalDb> {
    const db = this.db
    return db ? { ok: true, value: db } : DATA_UNAVAILABLE
  }

  /** Only bindings minted for the verified current home may be used. */
  isBindingUsable(binding: Pick<SessionBindingRow, 'homeId'>): boolean {
    return this.#homeId !== undefined && binding.homeId === this.#homeId
  }

  /** Single flight; resolves to the resulting status and never rejects. */
  open(): Promise<DataStatus> {
    this.#opening ??= this.#open().catch(() =>
      this.#fail('unavailable', 'open_threw'),
    )
    return this.#opening
  }

  async #open(): Promise<DataStatus> {
    if (this.#closing) return this.#status
    let paths: ReturnType<typeof dataPaths>
    try {
      paths = dataPaths(assertIsolatedDataDir(this.#dir, this.#home))
      await claimDataDir(paths)
    } catch {
      return this.#fail('unavailable', 'data_dir_rejected')
    }
    try {
      this.#release = await this.#lock(paths.dir, DATA_LOCK_FILE)
    } catch {
      return this.#fail('locked', 'data_locked')
    }
    if (this.#closing) {
      await this.#releaseLock()
      return this.#status
    }
    let result: LocalDbOpenResult
    try {
      result = await this.#openDb({
        path: paths.database,
        backupDir: paths.backups,
        now: this.#now,
      })
    } catch {
      result = { status: 'unavailable', reason: 'open_failed' }
    }
    if (result.status !== 'ready') {
      await this.#releaseLock()
      return this.#fail(result.status, failureReason(result))
    }
    if (this.#closing) {
      result.db.close()
      await this.#releaseLock()
      return this.#status
    }
    this.#db = result.db
    this.#status = 'ready'
    await this.verifyHome()
    return this.#status
  }

  /**
   * Reads the DSH home marker (never writes the home) and pairs the database
   * with it on first use. Live bindings minted for another home are marked
   * `home_mismatch` and stay unusable; the mark clears when their home is
   * current again. The database keeps its first pairing.
   */
  async verifyHome(): Promise<HomeCheck> {
    const db = this.db
    if (!db) return this.#homeCheck
    let homeId: string | undefined
    try {
      homeId = await this.#readHomeId(this.#home)
    } catch {
      homeId = undefined
    }
    if (this.db !== db) return this.#homeCheck
    if (homeId === undefined) {
      this.#homeId = undefined
      this.#homeCheck = 'unverified'
      return this.#homeCheck
    }
    const current = homeId
    const now = this.#now()
    const check = db.write((tx): HomeCheck => {
      const paired = getMeta(tx, 'home_id')
      if (paired === null) setMeta(tx, 'home_id', current)
      for (const binding of listLiveSessionBindings(tx)) {
        const inHome = binding.homeId === current
        const marked = binding.lastError === HOME_MISMATCH
        if (inHome === marked)
          setSessionBindingStage(tx, binding.bindingId, binding.stage, {
            now,
            lastError: inHome ? null : HOME_MISMATCH,
          })
      }
      return paired === null || paired === current ? 'matched' : 'mismatch'
    })
    this.#homeId = current
    this.#homeCheck = check
    if (check === 'mismatch') this.#log(`Corn data home check: ${check}`)
    return check
  }

  /** `wal_checkpoint(TRUNCATE)`, close, release the lock. Single flight. */
  close(): Promise<void> {
    this.#closing ??= (async () => {
      await this.#opening
      const db = this.#db
      this.#db = undefined
      this.#homeId = undefined
      if (this.#status === 'ready') this.#status = 'unavailable'
      try {
        db?.close()
      } finally {
        await this.#releaseLock()
      }
    })()
    return this.#closing
  }

  async #releaseLock(): Promise<void> {
    const release = this.#release
    this.#release = undefined
    await release?.()
  }

  #fail(
    status: Exclude<DataStatus, 'ready' | 'opening'>,
    reason: string,
  ): DataStatus {
    this.#status = status
    this.#log(`Corn data ${status}: ${reason}`)
    return status
  }
}
