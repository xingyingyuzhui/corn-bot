import { type ChildProcess, type SpawnOptions, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { DSH_VERSION } from '../../../../packages/contracts/src/runtime.ts'
import { HostAuth } from './host-auth.ts'
import { parseReadinessLine, redactHostDiagnostic } from './host-readiness.ts'
import {
  type CornModelConfig,
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
import { HostStoppedError, RuntimeFailure } from './runtime-failure.ts'

const require = createRequire(import.meta.url)
const cliManifest = require.resolve('@deepseek-ai/dsh/package.json')
const cliEntry = join(dirname(cliManifest), 'lib', 'bin.js')
const READINESS_TIMEOUT_MS = 45_000
const STOP_GRACE_MS = 8_000

export type SpawnHost = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess

export interface SupervisorOptions {
  readonly onFailure?: (message: string) => void
  /** `undefined` resolves the private Corn model configuration at each start; `null` boots keyless. */
  readonly model?: CornModelConfig | null
  /** Private model file the App selected; read lazily inside each start. */
  readonly modelEnvFile?: string
  /** Verified bundled profile used instead of DSH's online template on first start. */
  readonly profileTemplate?: string | undefined
  /** Test seam; production spawns the bundled DSH CLI. */
  readonly spawnHost?: SpawnHost
  /** Test seam; production performs the launch-token exchange. */
  readonly exchangeAuth?: (
    launch: URL,
    signal: AbortSignal,
  ) => Promise<HostAuth>
}

/** One spawned Host process; every startup step is bound to its lifetime. */
class ChildLife {
  readonly child: ChildProcess
  /** Aborted when the child exits or errors, or when a stop is requested. */
  readonly controller = new AbortController()
  readonly exited: Promise<void>
  /** Set only at the startup commit point; later exits are crashes. */
  committed = false
  stopping = false
  reported = false

  constructor(child: ChildProcess) {
    this.child = child
    this.exited = new Promise((resolve) => {
      child.once('close', () => resolve())
      child.on('error', () => {
        if (child.pid === undefined) resolve()
      })
    })
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
  readonly modelEnvFile: string | undefined
  readonly profileTemplate: string | undefined
  readonly #spawnHost: SpawnHost
  readonly #exchangeAuth: (
    launch: URL,
    signal: AbortSignal,
  ) => Promise<HostAuth>

  constructor(home: string, options: SupervisorOptions = {}) {
    this.home = home
    this.onFailure = options.onFailure ?? (() => {})
    this.model = options.model
    this.modelEnvFile = options.modelEnvFile
    this.profileTemplate = options.profileTemplate
    this.#spawnHost = options.spawnHost ?? spawn
    this.#exchangeAuth = options.exchangeAuth ?? HostAuth.exchange
  }

  /** Main-only process ownership diagnostics; never exposed over Renderer IPC. */
  get processId(): number | undefined {
    return this.#life?.child.pid
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
    if (this.#startFlight || this.#life || this.#stopFlight)
      return Promise.reject(new Error('Host is already started or stopping'))
    this.#startFlight = this.#start().finally(() => {
      this.#startFlight = undefined
    })
    return this.#startFlight
  }

  async #start(): Promise<HostAuth> {
    this.#diagnostic = ''
    const manifest = require(cliManifest) as { version: string }
    if (manifest.version !== DSH_VERSION)
      throw new RuntimeFailure(
        'runtime_version_mismatch',
        'Installed DSH runtime differs from the locked version',
      )
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
      const model = this.#resolveModel()
      const patch = await writeIsolationPatch(this.home, model)
      const args = [cliEntry, CORN_PROFILE]
      const profile = join(this.home, 'profiles', CORN_PROFILE)
      if (this.profileTemplate)
        await materializeProfile(this.profileTemplate, profile)
      // Otherwise DSH creates this named profile from its own shipped template, never the user's profile.
      else if (!existsSync(join(profile, 'package.json')))
        args.push('--from-default-profile', 'web')
      args.push('--patch', patch, '--no-open', '--port', '0')
      this.#throwIfStopRequested()
      const life = this.#spawn(args, model)
      const launch = await this.#readiness(life)
      const auth = await this.#exchangeAuth(launch, life.signal)
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
    const life = new ChildLife(child)
    this.#life = life
    child.on('error', (error) => {
      life.controller.abort(
        new RuntimeFailure(
          'host_unavailable',
          `DSH process error: ${error.message}`,
          { cause: error },
        ),
      )
    })
    child.once('close', (code, signal) => {
      const message = `DSH exited (${String(code ?? signal)}): ${this.#life === life ? this.#diagnostic : ''}`
      life.controller.abort(new RuntimeFailure('host_unavailable', message))
      if (!life.committed || life.stopping || life.reported) return
      life.reported = true
      this.onFailure(message)
    })
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
      if (this.#life !== life) return
      this.#diagnostic = redactHostDiagnostic(
        (this.#diagnostic + chunk).slice(-16_384),
      )
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

  #resolveModel(): CornModelConfig | null {
    if (this.model !== undefined) return this.model
    return resolveCornModelConfig(
      this.modelEnvFile === undefined
        ? process.env
        : { ...process.env, CORN_MODEL_ENV_FILE: this.modelEnvFile },
    )
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

  async #stop(): Promise<void> {
    const life = this.#life
    try {
      if (life) {
        life.stopping = true
        life.controller.abort(new HostStoppedError())
        const { child } = life
        if (child.exitCode === null && child.signalCode === null) {
          child.kill('SIGTERM')
          let timer: ReturnType<typeof setTimeout> | undefined
          const exited = await Promise.race([
            life.exited.then(() => true),
            new Promise<false>((resolve) => {
              timer = setTimeout(() => resolve(false), STOP_GRACE_MS)
            }),
          ])
          clearTimeout(timer)
          if (!exited) {
            child.kill('SIGKILL')
            await life.exited
          }
        }
      }
      await this.#release?.()
    } finally {
      this.#release = undefined
      this.#life = undefined
    }
  }
}
