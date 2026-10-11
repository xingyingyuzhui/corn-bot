import {
  DSH_VERSION,
  type RuntimeErrorCode,
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
import { runtimeFailureOf } from './runtime-failure.ts'

const MESSAGES: Record<RuntimeStatus, string> = {
  stopped: 'Corn 独立运行时已停止。',
  starting: '正在启动 Corn 独立运行时…',
  ready: 'Corn 独立运行时已连接。',
  recovering: '独立运行时意外退出，正在自动恢复…',
  failed: '独立运行时多次启动失败，已停止自动恢复。',
}

function failureMessage(code: RuntimeErrorCode): string {
  switch (code) {
    case 'model_config_invalid':
      return '模型配置不完整或服务商无效，请修正后重新启动 Corn Bot。'
    case 'model_config_permissions':
      return '模型配置文件权限不正确（需仅本人可读），请修正后重新启动。'
    case 'model_config_unreadable':
      return '无法读取模型配置文件，请检查后重新启动。'
    case 'runtime_home_rejected':
      return 'Corn 运行时目录不属于 Corn Bot，已拒绝使用。'
    case 'runtime_home_locked':
      return 'Corn 运行时目录正被其他进程占用。'
    case 'runtime_version_mismatch':
      return '内置运行时版本与锁定版本不一致。'
    case 'claw_missing':
      return 'Corn profile 缺少 Claw 治理组件，需要修复 Corn profile。'
    case 'claw_version_mismatch':
      return 'Corn profile 的 Claw 治理组件版本不匹配，需要修复 Corn profile。'
    case 'claw_disabled':
      return 'Corn profile 未启用 Claw 治理组件，需要修复 Corn profile。'
    case 'claw_check_failed':
      return 'Claw 治理能力检查未通过，已停止运行时。'
    case 'host_unavailable':
      return MESSAGES.failed
    default: {
      const unreachable: never = code
      throw new Error(`Unknown runtime error code ${String(unreachable)}`)
    }
  }
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

  #set(status: RuntimeStatus, errorCode?: RuntimeErrorCode): void {
    this.#view =
      status === 'failed' && errorCode !== undefined
        ? {
            status,
            dshVersion: DSH_VERSION,
            message: failureMessage(errorCode),
            errorCode,
          }
        : { status, dshVersion: DSH_VERSION, message: MESSAGES[status] }
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
        this.#booting = false
        const failure = runtimeFailureOf(error)
        this.#lastFailure = redactHostDiagnostic(
          `${failure.code}: ${failure.message}`,
        ).slice(-2_000)
        if (failure.terminal) this.#set('failed', failure.code)
        else this.#scheduleRecovery()
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
      this.#set('failed', 'host_unavailable')
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
    modelEnvFile: paths.modelEnvFile,
    profileTemplate: paths.profileTemplate,
    onFailure: () => control?.hostFailed(),
  })
  control = new StartupControl(schedule ? { host, schedule } : { host })
  return { control, host }
}
