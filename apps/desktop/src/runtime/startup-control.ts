import {
  DSH_VERSION,
  type RuntimeStatus,
  type RuntimeView,
} from '../../../../packages/contracts/src/runtime.ts'
import type { AppPaths } from '../app-paths.ts'
import {
  DshHostSupervisor,
  type SupervisorOptions,
} from './dsh-host-supervisor.ts'
import type { HostAuth } from './host-auth.ts'
import { redactHostDiagnostic } from './host-readiness.ts'
import { HostRecovery } from './host-recovery.ts'
import { resolveCornModelConfig } from './model-provider.ts'

const MESSAGES: Record<RuntimeStatus, string> = {
  stopped: 'Corn 独立运行时已停止。',
  starting: '正在启动 Corn 独立运行时…',
  ready: 'Corn 独立运行时已连接。',
  recovering: '独立运行时意外退出，正在自动恢复…',
  failed: '独立运行时多次启动失败，已停止自动恢复。',
}

export interface StartupHost {
  start(): Promise<HostAuth>
  stop(): Promise<void>
}

/** Runs `run` after `delayMs`; returns a cancel function. */
export type Schedule = (run: () => void, delayMs: number) => () => void

const realSchedule: Schedule = (run, delayMs) => {
  const timer = setTimeout(run, delayMs)
  return () => clearTimeout(timer)
}

export interface StartupControlOptions {
  readonly host: StartupHost
  readonly recovery?: HostRecovery
  readonly schedule?: Schedule
}

/** Main-only owner of the App's runtime status, boot flight and recovery. */
export class StartupControl {
  readonly #host: StartupHost
  readonly #recovery: HostRecovery
  readonly #schedule: Schedule
  #view: RuntimeView = {
    status: 'starting',
    dshVersion: DSH_VERSION,
    message: MESSAGES.starting,
  }
  #auth: HostAuth | undefined
  #lastFailure: string | undefined
  #startup: Promise<void> | undefined
  #booting = false
  #cancelRecovery: (() => void) | undefined
  #cleanup: Promise<void> | undefined

  constructor(options: StartupControlOptions) {
    this.#host = options.host
    this.#recovery = options.recovery ?? new HostRecovery()
    this.#schedule = options.schedule ?? realSchedule
  }

  get view(): RuntimeView {
    return this.#view
  }

  get auth(): HostAuth | undefined {
    return this.#auth
  }

  /** Main-only, redacted; surfaced in smoke reports, never over Renderer IPC. */
  get lastFailure(): string | undefined {
    return this.#lastFailure
  }

  start(): Promise<void> {
    return this.#boot(false)
  }

  /** Supervisor callback for an unexpected Host exit. */
  hostFailed(): void {
    this.#scheduleRecovery()
  }

  shutdown(): Promise<void> {
    this.#cleanup ??= (async () => {
      this.#cancelRecovery?.()
      await this.#startup?.catch(() => {})
      await this.#host.stop()
    })()
    return this.#cleanup
  }

  #set(status: RuntimeStatus): void {
    this.#view = { status, dshVersion: DSH_VERSION, message: MESSAGES[status] }
  }

  /** One boot or restart at a time; failures feed the bounded recovery budget. */
  #boot(stopFirst: boolean): Promise<void> {
    this.#booting = true
    this.#startup = (async () => {
      try {
        if (stopFirst) await this.#host.stop()
        if (this.#cleanup) return
        this.#auth = await this.#host.start()
        this.#set('ready')
      } catch (error) {
        this.#auth = undefined
        this.#lastFailure = redactHostDiagnostic(String(error)).slice(-2_000)
        this.#booting = false
        this.#scheduleRecovery()
      } finally {
        this.#booting = false
      }
    })()
    return this.#startup
  }

  #scheduleRecovery(): void {
    if (this.#cleanup || this.#booting || this.#cancelRecovery) return
    this.#auth = undefined
    const wait = this.#recovery.nextDelay()
    if (wait === null) {
      this.#set('failed')
      return
    }
    this.#set('recovering')
    this.#cancelRecovery = this.#schedule(() => {
      this.#cancelRecovery = undefined
      void this.#boot(true)
    }, wait)
  }
}

export type AppRuntimeSeams = Pick<
  SupervisorOptions,
  'spawnHost' | 'exchangeAuth'
> & { readonly schedule?: Schedule }

export interface AppRuntime {
  readonly control: StartupControl
  readonly host: DshHostSupervisor
}

/** The App's formal runtime: one supervisor and its startup control. */
export function createAppRuntime(
  paths: Pick<AppPaths, 'home' | 'modelEnvFile' | 'profileTemplate'>,
  { schedule, ...hostSeams }: AppRuntimeSeams = {},
): AppRuntime {
  let control: StartupControl | undefined
  const host = new DshHostSupervisor(paths.home, {
    ...hostSeams,
    model: resolveCornModelConfig({
      ...process.env,
      CORN_MODEL_ENV_FILE: paths.modelEnvFile,
    }),
    profileTemplate: paths.profileTemplate,
    onFailure: () => control?.hostFailed(),
  })
  control = new StartupControl(schedule ? { host, schedule } : { host })
  return { control, host }
}
