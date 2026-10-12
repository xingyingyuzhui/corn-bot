import { type ChildProcess, type SpawnOptions, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { DSH_VERSION } from '../../../../packages/contracts/src/runtime.ts'
import { DSH_PATCHES, type DshPatch, verifyDshPatches } from './dsh-patch.ts'
import { HostAuth } from './host-auth.ts'
import {
  formatReclaim,
  HostDescendants,
  NO_PROCESS_TABLE,
  type ProcessTable,
  type ReclaimReason,
  type ReclaimReport,
  systemProcessTable,
} from './host-descendants.ts'
import {
  parseReadinessLine,
  parseSkippedBundleLine,
  redactHostDiagnostic,
} from './host-readiness.ts'
import {
  type CornModelConfig,
  type ModelOverrideFacts,
  overrideFacts,
  resolveCornModelConfig,
} from './model-provider.ts'
import { acquireProcessLock } from './process-lock.ts'
import {
  CORN_PROFILE,
  claimCornHome,
  cornHostEnvironment,
  writeIsolationPatch,
} from './profile-bootstrap.ts'
import { materializeProfile } from './profile-template.ts'
import {
  HostStoppedError,
  HostStopTimeoutError,
  RuntimeFailure,
} from './runtime-failure.ts'

const require = createRequire(import.meta.url)
/** DSH's own first bundle resolution anchor (`INSTALL_ANCHOR` in its CLI). */
export const DSH_INSTALL_ANCHOR = require.resolve(
  '@deepseek-ai/dsh/package.json',
)
const cliEntry = join(dirname(DSH_INSTALL_ANCHOR), 'lib', 'bin.js')
const READINESS_TIMEOUT_MS = 45_000
const STOP_TIMEOUTS: StopTimeouts = { graceMs: 8_000, killMs: 5_000 }
/** How stale the descendant record may be when the Host dies without a stop. */
const DESCENDANT_POLL_MS = 2_000

function logReclaim(report: ReclaimReport): void {
  const line = formatReclaim(report)
  if (line !== undefined) console.info(line)
}

export interface StopTimeouts {
  /** SIGTERM → SIGKILL. */
  readonly graceMs: number
  /** SIGKILL → confirmed exit, then exit → stdio close. */
  readonly killMs: number
}

async function settlesWithin(
  promise: Promise<void>,
  ms: number,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(resolve, ms, false)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export type SpawnHost = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess

export interface AdmissionContext {
  readonly auth: HostAuth
  /** Aborted when this child exits or a stop is requested. */
  readonly signal: AbortSignal
  /** Profile bundles this child reported as skipped on stderr. */
  readonly skippedBundles: ReadonlySet<string>
}

/** What a Host must satisfy before and after authentication to count as started. */
export interface HostAdmission {
  /** `overlays` are the `--patch` files this start passes, in argv order. */
  beforeSpawn(
    home: string,
    profile: string,
    overlays: readonly string[],
  ): Promise<void>
  afterAuth(context: AdmissionContext): Promise<void>
}

export interface SupervisorOptions {
  /** Chosen explicitly by every caller: the App's governed entry or a setup-only bootstrap. */
  readonly admission: HostAdmission
  readonly onFailure?: (message: string) => void
  /** Explicit model for a script-driven smoke; absent or `null` boots keyless unless `devModelOverrideFile` is set. */
  readonly model?: CornModelConfig | null
  /**
   * Development-only override file, read lazily inside each start. The App
   * passes one only for an unpackaged build started with an explicit path;
   * production and the default development App boot keyless.
   */
  readonly devModelOverrideFile?: string | undefined
  /** Verified bundled profile used instead of DSH's online template on first start. */
  readonly profileTemplate?: string | undefined
  /** Test seam; production spawns the bundled DSH CLI. */
  readonly spawnHost?: SpawnHost
  /** Test seam; production performs the launch-token exchange. */
  readonly exchangeAuth?: (
    launch: URL,
    signal: AbortSignal,
  ) => Promise<HostAuth>
  /** Test seam; production uses `STOP_TIMEOUTS`. */
  readonly stopTimeouts?: StopTimeouts
  /** Test seam; production verifies the locked `DSH_PATCHES`. */
  readonly dshPatches?: readonly DshPatch[]
  /** Test seam; production reads `ps`. A substituted `spawnHost` defaults to no table. */
  readonly processTable?: ProcessTable
  /** Test seam; production uses `DESCENDANT_POLL_MS`. */
  readonly descendantPollMs?: number
  /** Receives every descendant reclaim; production logs non-empty ones. */
  readonly onReclaim?: (report: ReclaimReport) => void
}

async function seedProfile(template: string, profile: string): Promise<void> {
  try {
    await materializeProfile(template, profile)
  } catch (error) {
    throw new RuntimeFailure(
      'claw_missing',
      'Bundled Corn profile template failed verification',
      { cause: error },
    )
  }
}

/** One spawned Host process; every startup step is bound to its lifetime. */
class ChildLife {
  readonly child: ChildProcess
  /** Aborted at the child's `exit` (not its pipe `close`) or error, or when a stop is requested. */
  readonly controller = new AbortController()
  /** The process is gone (`exit`, `close` or a failed spawn); its pipes may still be open. */
  readonly exited: Promise<void>
  /** The process is gone and its stdio pipes are closed. */
  readonly closed: Promise<void>
  exitConfirmed = false
  /** Set only at the startup commit point; later exits are crashes. */
  committed = false
  stopping = false
  killed = false
  reported = false
  readonly skippedBundles = new Set<string>()
  stderrPending = ''
  /** Absent when the spawn published no pid. */
  readonly descendants: HostDescendants | undefined
  reclaimed: Promise<void> | undefined

  constructor(child: ChildProcess, table: ProcessTable) {
    this.child = child
    this.descendants =
      child.pid === undefined
        ? undefined
        : new HostDescendants(table, child.pid)
    let exited!: () => void
    this.exited = new Promise((resolve) => {
      exited = () => {
        this.exitConfirmed = true
        resolve()
      }
    })
    this.closed = new Promise((resolve) => {
      const closed = () => {
        exited()
        resolve()
      }
      child.once('close', closed)
      child.on('error', () => {
        if (child.pid === undefined) closed()
      })
    })
    child.once('exit', exited)
  }

  get signal(): AbortSignal {
    return this.controller.signal
  }
}

export class DshHostSupervisor {
  #life: ChildLife | undefined
  #release: (() => Promise<void>) | undefined
  #stopRequested = false
  #startFlight: Promise<HostAuth> | undefined
  #stopFlight: Promise<void> | undefined
  #diagnostic = ''
  #spawnCount = 0

  readonly home: string
  readonly onFailure: (message: string) => void
  readonly model: CornModelConfig | null | undefined
  readonly devModelOverrideFile: string | undefined
  readonly profileTemplate: string | undefined
  #modelOverride: ModelOverrideFacts | null = null
  readonly #admission: HostAdmission
  readonly #stopTimeouts: StopTimeouts
  readonly #dshPatches: readonly DshPatch[]
  readonly #spawnHost: SpawnHost
  readonly #processTable: ProcessTable
  readonly #descendantPollMs: number
  readonly #onReclaim: (report: ReclaimReport) => void
  readonly #exchangeAuth: (
    launch: URL,
    signal: AbortSignal,
  ) => Promise<HostAuth>

  constructor(home: string, options: SupervisorOptions) {
    this.home = home
    this.#admission = options.admission
    this.onFailure = options.onFailure ?? (() => {})
    this.model = options.model
    this.devModelOverrideFile = options.devModelOverrideFile
    this.profileTemplate = options.profileTemplate
    this.#stopTimeouts = options.stopTimeouts ?? STOP_TIMEOUTS
    this.#dshPatches = options.dshPatches ?? DSH_PATCHES
    this.#spawnHost = options.spawnHost ?? spawn
    this.#processTable =
      options.processTable ??
      (options.spawnHost ? NO_PROCESS_TABLE : systemProcessTable)
    this.#descendantPollMs = options.descendantPollMs ?? DESCENDANT_POLL_MS
    this.#onReclaim = options.onReclaim ?? logReclaim
    this.#exchangeAuth = options.exchangeAuth ?? HostAuth.exchange
  }

  /** Main-only process ownership diagnostics; never exposed over Renderer IPC. */
  get processId(): number | undefined {
    return this.#life?.child.pid
  }

  /** What the current start injected for a model override; never carries the key. */
  get modelOverride(): ModelOverrideFacts | null {
    return this.#modelOverride
  }

  /** Main-only diagnostic: Host processes spawned by this supervisor. */
  get spawnCount(): number {
    return this.#spawnCount
  }

  /** The committed child is still alive; false during startup and after any exit. */
  get running(): boolean {
    const life = this.#life
    return life?.committed === true && !life.signal.aborted
  }

  start(): Promise<HostAuth> {
    if (this.#startFlight || this.#stopFlight)
      return Promise.reject(new Error('Host is already started or stopping'))
    const life = this.#life
    if (life?.stopping)
      return Promise.reject(new HostStopTimeoutError(life.child.pid))
    if (life) return Promise.reject(new Error('Host is already started'))
    this.#startFlight = this.#start().finally(() => {
      this.#startFlight = undefined
    })
    return this.#startFlight
  }

  async #start(): Promise<HostAuth> {
    this.#diagnostic = ''
    const manifest = require(DSH_INSTALL_ANCHOR) as { version: string }
    if (manifest.version !== DSH_VERSION)
      throw new RuntimeFailure(
        'runtime_version_mismatch',
        'Installed DSH runtime differs from the locked version',
      )
    await verifyDshPatches(DSH_INSTALL_ANCHOR, this.#dshPatches)
    try {
      await claimCornHome(this.home)
    } catch (error) {
      throw new RuntimeFailure(
        'runtime_home_rejected',
        'Corn runtime home is not an isolated Corn-owned directory',
        { cause: error },
      )
    }
    try {
      this.#release = await acquireProcessLock(this.home)
    } catch (error) {
      throw new RuntimeFailure(
        'runtime_home_locked',
        'Corn runtime home is locked by another owner',
        { cause: error },
      )
    }
    try {
      this.#throwIfStopRequested()
      this.#modelOverride = null
      const model = this.#resolveModel()
      this.#modelOverride = model && overrideFacts(model)
      const patch = await writeIsolationPatch(this.home, model)
      const args = [cliEntry, CORN_PROFILE]
      const profile = join(this.home, 'profiles', CORN_PROFILE)
      if (this.profileTemplate) await seedProfile(this.profileTemplate, profile)
      // Otherwise DSH creates this named profile from its own shipped template, never the user's profile.
      else if (!existsSync(join(profile, 'package.json')))
        args.push('--from-default-profile', 'web')
      args.push('--patch', patch, '--no-open', '--port', '0')
      await this.#admission.beforeSpawn(this.home, profile, [patch])
      this.#throwIfStopRequested()
      const life = this.#spawn(args, model)
      const launch = await this.#readiness(life)
      const auth = await this.#exchangeAuth(launch, life.signal)
      life.signal.throwIfAborted()
      await this.#admission.afterAuth({
        auth,
        signal: life.signal,
        skippedBundles: life.skippedBundles,
      })
      life.signal.throwIfAborted()
      life.committed = true
      return auth
    } catch (error) {
      const failure = this.#startFailure(error)
      await this.#stop()
      throw failure
    }
  }

  #throwIfStopRequested(): void {
    if (this.#stopRequested) throw new HostStoppedError()
  }

  /** A stop always wins; otherwise the child's own exit explains whatever step it interrupted. */
  #startFailure(error: unknown): unknown {
    if (this.#stopRequested || error instanceof HostStoppedError)
      return new HostStoppedError()
    const signal = this.#life?.signal
    return signal?.aborted ? signal.reason : error
  }

  #spawn(args: readonly string[], model: CornModelConfig | null): ChildLife {
    this.#spawnCount++
    const child = this.#spawnHost(process.execPath, args, {
      cwd: this.home,
      env: cornHostEnvironment(this.home, model),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const life = new ChildLife(child, this.#processTable)
    this.#life = life
    life.descendants?.watch(this.#descendantPollMs)
    void life.exited.then(() => {
      if (!life.stopping) void this.#reclaim(life, 'crash')
    })
    child.on('error', (error) => {
      life.controller.abort(
        new RuntimeFailure(
          'host_unavailable',
          `DSH process error: ${error.message}`,
          { cause: error },
        ),
      )
    })
    // `exit` ends this generation even if a descendant keeps the pipes open; a later `close` only finds it reported.
    const ended = (code: number | null, signal: NodeJS.Signals | null) => {
      const message = `DSH exited (${String(code ?? signal)}): ${this.#life === life ? this.#diagnostic : ''}`
      life.controller.abort(new RuntimeFailure('host_unavailable', message))
      if (!life.committed || life.stopping || life.reported) return
      life.reported = true
      this.onFailure(message)
    }
    child.once('exit', ended)
    child.once('close', ended)
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      if (this.#life !== life) return
      this.#diagnostic = redactHostDiagnostic(
        (this.#diagnostic + chunk).slice(-16_384),
      )
      const lines = (life.stderrPending + chunk).split(/\r?\n/u)
      life.stderrPending = (lines.pop() ?? '').slice(-16_384)
      for (const line of lines) {
        const skipped = parseSkippedBundleLine(line)
        if (skipped !== undefined) life.skippedBundles.add(skipped)
      }
    })
    return life
  }

  #readiness(life: ChildLife): Promise<URL> {
    const { child, signal } = life
    return new Promise<URL>((resolve, reject) => {
      let pending = ''
      const settle = () => {
        clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
        child.stdout?.off('data', onData)
        // Keep draining so a chatty Host never blocks on a full pipe.
        child.stdout?.resume()
      }
      const fail = (error: unknown) => {
        settle()
        reject(error)
      }
      const onAbort = () => fail(signal.reason)
      const onData = (chunk: string) => {
        pending += chunk
        const lines = pending.split(/\r?\n/u)
        pending = lines.pop() ?? ''
        if (pending.length > 128 * 1024) {
          fail(
            new RuntimeFailure(
              'host_unavailable',
              'DSH startup line exceeded its limit',
            ),
          )
          return
        }
        for (const line of lines) {
          let ready: URL | undefined
          try {
            ready = parseReadinessLine(line)
          } catch (error) {
            fail(error)
            return
          }
          if (ready) {
            settle()
            resolve(ready)
            return
          }
        }
      }
      const timer = setTimeout(
        () =>
          fail(
            new RuntimeFailure(
              'host_unavailable',
              'DSH readiness deadline exceeded',
            ),
          ),
        READINESS_TIMEOUT_MS,
      )
      if (signal.aborted) {
        fail(signal.reason)
        return
      }
      signal.addEventListener('abort', onAbort, { once: true })
      child.stdout?.setEncoding('utf8').on('data', onData)
    })
  }

  /** Never consults the process environment: only an explicit model or override file. */
  #resolveModel(): CornModelConfig | null {
    if (this.model !== undefined) return this.model
    if (this.devModelOverrideFile === undefined) return null
    return resolveCornModelConfig({
      CORN_MODEL_ENV_FILE: this.devModelOverrideFile,
    })
  }

  /** Cancels any in-flight start (readiness, auth) before stopping its child. */
  stop(): Promise<void> {
    this.#stopFlight ??= (async () => {
      this.#stopRequested = true
      const life = this.#life
      if (life) {
        life.stopping = true
        life.controller.abort(new HostStoppedError())
      }
      try {
        await this.#startFlight?.catch(() => {})
        await this.#stop()
      } finally {
        this.#stopRequested = false
      }
    })().finally(() => {
      this.#stopFlight = undefined
    })
    return this.#stopFlight
  }

  /**
   * An unconfirmed child keeps `#life` and the home lock, so a later stop can
   * retry and no start can replace it.
   */
  async #stop(): Promise<void> {
    const life = this.#life
    if (life) {
      life.stopping = true
      life.controller.abort(new HostStoppedError())
      await this.#terminate(life)
    }
    try {
      await this.#release?.()
    } finally {
      this.#release = undefined
      this.#life = undefined
    }
  }

  /**
   * TERM → grace → KILL → bounded wait for exit; a confirmed exit then reclaims
   * the Host's descendants and gets a bounded wait for its pipes. Each signal
   * is preceded by a fresh descendant record while the tree is still intact.
   */
  async #terminate(life: ChildLife): Promise<void> {
    const { child } = life
    const { graceMs, killMs } = this.#stopTimeouts
    if (!life.exitConfirmed) {
      if (!life.killed) {
        await life.descendants?.refresh()
        child.kill('SIGTERM')
        if (await settlesWithin(life.exited, graceMs)) return this.#settle(life)
      }
      life.killed = true
      await life.descendants?.refresh()
      child.kill('SIGKILL')
      if (!(await settlesWithin(life.exited, killMs)))
        throw new HostStopTimeoutError(child.pid)
    }
    await this.#settle(life)
  }

  async #settle(life: ChildLife): Promise<void> {
    await this.#reclaim(life, 'stop')
    await this.#drain(life)
  }

  /** Once per child, after its exit; a crash reclaim started earlier is reused by the stop. */
  #reclaim(life: ChildLife, reason: ReclaimReason): Promise<void> {
    const { descendants } = life
    life.reclaimed ??= descendants
      ? descendants
          .reclaim(reason, this.#stopTimeouts.killMs)
          .then(this.#onReclaim)
          .catch(() => {})
      : Promise.resolve()
    return life.reclaimed
  }

  async #drain(life: ChildLife): Promise<void> {
    if (await settlesWithin(life.closed, this.#stopTimeouts.killMs)) return
    life.child.stdout?.destroy()
    life.child.stderr?.destroy()
  }
}
