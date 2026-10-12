import { execFile } from 'node:child_process'
import { basename } from 'node:path'

/** One row of the OS process table. */
export interface ProcessRow {
  readonly pid: number
  readonly ppid: number
  readonly pgid: number
  /** Start time as `ps` prints it; with `pid` it names one process across snapshots. */
  readonly started: string
  /** Executable basename only; never arguments or environment. */
  readonly name: string
}

export interface ProcessTable {
  snapshot(): Promise<readonly ProcessRow[]>
  /** Never throws; a negative `pid` signals that whole process group. */
  kill(pid: number, signal: NodeJS.Signals): void
}

export type ReclaimReason = 'stop' | 'crash'

/** Names and counts only: safe for Main logs and smoke reports. */
export interface ReclaimReport {
  readonly reason: ReclaimReason
  /** Descendants recorded while the Host was alive. */
  readonly tracked: number
  /** Processes still alive after the Host exited, all sent SIGKILL. */
  readonly signalled: number
  /** Process groups led by a former descendant, sent SIGKILL. */
  readonly groups: number
  /** Signalled processes still present when the bound ran out. */
  readonly survivors: number
  readonly names: readonly string[]
  /** The process table could not be read, so nothing was signalled. */
  readonly snapshotFailed: boolean
}

const PS_TIMEOUT_MS = 1_000
const VERIFY_TICK_MS = 25
const MAX_NAMES = 8
/** `lstart` is always five fields under the C locale: `Mon Oct 12 15:48:01 2026`. */
const STARTED_FIELDS = 5

export function parsePsLine(line: string): ProcessRow | undefined {
  const fields = line.trim().split(/\s+/u)
  if (fields.length < 4 + STARTED_FIELDS) return undefined
  const [pid, ppid, pgid] = fields.slice(0, 3).map(Number)
  if (
    pid === undefined ||
    ppid === undefined ||
    pgid === undefined ||
    ![pid, ppid, pgid].every(Number.isSafeInteger)
  )
    return undefined
  return {
    pid,
    ppid,
    pgid,
    started: fields.slice(3, 3 + STARTED_FIELDS).join(' '),
    name: basename(fields.slice(3 + STARTED_FIELDS).join(' ')),
  }
}

export const systemProcessTable: ProcessTable = {
  snapshot: () =>
    new Promise((resolve, reject) => {
      execFile(
        '/bin/ps',
        ['-A', '-o', 'pid=,ppid=,pgid=,lstart=,comm='],
        {
          env: { LC_ALL: 'C' },
          timeout: PS_TIMEOUT_MS,
          maxBuffer: 16 * 1024 * 1024,
        },
        (error, stdout) => {
          if (error) reject(error)
          else
            resolve(
              stdout.split('\n').flatMap((line) => parsePsLine(line) ?? []),
            )
        },
      )
    }),
  kill: (pid, signal) => {
    try {
      process.kill(pid, signal)
    } catch {}
  },
}

/** For substituted spawns, whose pids are not real processes. */
export const NO_PROCESS_TABLE: ProcessTable = {
  snapshot: async () => [],
  kill: () => {},
}

/** Every row below `roots` by parent pid, roots excluded. */
export function descendantsOf(
  rows: readonly ProcessRow[],
  roots: Iterable<number>,
): ProcessRow[] {
  const children = new Map<number, ProcessRow[]>()
  for (const row of rows) {
    const siblings = children.get(row.ppid)
    if (siblings) siblings.push(row)
    else children.set(row.ppid, [row])
  }
  const seen = new Set(roots)
  const queue = [...seen]
  const found: ProcessRow[] = []
  for (let pid = queue.pop(); pid !== undefined; pid = queue.pop()) {
    for (const child of children.get(pid) ?? []) {
      if (seen.has(child.pid)) continue
      seen.add(child.pid)
      found.push(child)
      queue.push(child.pid)
    }
  }
  return found
}

function sameProcess(
  row: ProcessRow | undefined,
  known: ProcessRow,
): row is ProcessRow {
  return row?.started === known.started
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * The process tree below one Host. DSH starts every tool process in its own
 * session or process group (`detached` spawns and node-pty), and macOS
 * reparents them to launchd once the Host dies, so membership must be
 * recorded while the Host is alive and replayed after it exits.
 */
export class HostDescendants {
  readonly #table: ProcessTable
  readonly #hostPid: number
  #known = new Map<number, ProcessRow>()
  #flight: Promise<void> = Promise.resolve()
  #timer: ReturnType<typeof setTimeout> | undefined
  #watching = false

  constructor(table: ProcessTable, hostPid: number) {
    this.#table = table
    this.#hostPid = hostPid
  }

  get tracked(): number {
    return this.#known.size
  }

  /** Keeps the record fresh while the Host runs, so a crash can be replayed. */
  watch(intervalMs: number): void {
    if (this.#watching) return
    this.#watching = true
    const tick = () => {
      this.#timer = setTimeout(() => {
        void this.refresh().finally(() => {
          if (this.#watching) tick()
        })
      }, intervalMs)
      this.#timer.unref()
    }
    tick()
  }

  unwatch(): void {
    this.#watching = false
    clearTimeout(this.#timer)
  }

  /**
   * Adds the Host's current descendants and keeps earlier ones that are still
   * the same process, including any already reparented away from the Host.
   */
  refresh(): Promise<void> {
    this.#flight = this.#flight.then(async () => {
      const rows = await this.#snapshot()
      if (rows === undefined) return
      const alive = new Map(rows.map((row) => [row.pid, row]))
      const next = new Map<number, ProcessRow>()
      for (const known of this.#known.values()) {
        const row = alive.get(known.pid)
        if (sameProcess(row, known)) next.set(row.pid, row)
      }
      for (const row of descendantsOf(rows, [this.#hostPid]))
        next.set(row.pid, row)
      this.#known = next
    })
    return this.#flight
  }

  /** After the Host exited: SIGKILL every recorded descendant still alive, its groups and their descendants. */
  async reclaim(
    reason: ReclaimReason,
    verifyMs: number,
  ): Promise<ReclaimReport> {
    this.unwatch()
    await this.#flight
    const tracked = this.#known.size
    const rows = tracked === 0 ? [] : await this.#snapshot()
    if (rows === undefined)
      return {
        reason,
        tracked,
        signalled: 0,
        groups: 0,
        survivors: 0,
        names: [],
        snapshotFailed: true,
      }
    const { targets, groups } = this.#targets(rows)
    for (const group of groups) this.#table.kill(-group, 'SIGKILL')
    for (const row of targets) this.#table.kill(row.pid, 'SIGKILL')
    const survivors = await this.#survivors(targets, verifyMs)
    this.#known.clear()
    return {
      reason,
      tracked,
      signalled: targets.length,
      groups: groups.size,
      survivors,
      names: [...new Set(targets.map((row) => row.name))]
        .sort()
        .slice(0, MAX_NAMES),
      snapshotFailed: false,
    }
  }

  #targets(rows: readonly ProcessRow[]): {
    readonly targets: ProcessRow[]
    readonly groups: Set<number>
  } {
    const alive = new Map(rows.map((row) => [row.pid, row]))
    const ownGroup = alive.get(process.pid)?.pgid
    const groups = new Set<number>()
    const roots = new Map<number, ProcessRow>()
    for (const known of this.#known.values()) {
      const row = alive.get(known.pid)
      if (sameProcess(row, known)) roots.set(row.pid, row)
      // A live group pins its id, so a vanished leader's pid cannot have been reused.
      const leads = row
        ? sameProcess(row, known) && row.pgid === row.pid
        : rows.some((member) => member.pgid === known.pid)
      if (leads && known.pid !== ownGroup) groups.add(known.pid)
    }
    for (const row of rows) if (groups.has(row.pgid)) roots.set(row.pid, row)
    for (const row of descendantsOf(rows, roots.keys())) roots.set(row.pid, row)
    for (const pid of [process.pid, this.#hostPid, 0, 1]) roots.delete(pid)
    return { targets: [...roots.values()], groups }
  }

  async #survivors(
    targets: readonly ProcessRow[],
    verifyMs: number,
  ): Promise<number> {
    if (targets.length === 0) return 0
    const deadline = Date.now() + verifyMs
    for (;;) {
      const rows = await this.#snapshot()
      if (rows === undefined) return targets.length
      const alive = new Map(rows.map((row) => [row.pid, row]))
      const left = targets.filter((row) =>
        sameProcess(alive.get(row.pid), row),
      ).length
      if (left === 0 || Date.now() >= deadline) return left
      await delay(VERIFY_TICK_MS)
    }
  }

  async #snapshot(): Promise<readonly ProcessRow[] | undefined> {
    try {
      return await this.#table.snapshot()
    } catch {
      return undefined
    }
  }
}

/** One Main log line, or nothing when there was nothing to reclaim. */
export function formatReclaim(report: ReclaimReport): string | undefined {
  if (report.snapshotFailed)
    return `[corn-host] ${report.reason}: process table unavailable; ${report.tracked} recorded descendant(s) not reclaimed`
  if (report.signalled === 0) return undefined
  return `[corn-host] ${report.reason}: reclaimed ${report.signalled} descendant process(es) in ${report.groups} group(s) [${report.names.join(', ')}]; survivors ${report.survivors}`
}
