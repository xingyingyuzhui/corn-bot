import type {
  RuntimeErrorCode,
  RuntimeStatus,
  RuntimeView,
} from '@corn-bot/contracts'
import type {
  ModelStatus,
  ModelStatusView,
} from '@corn-bot/contracts/model-settings'
import {
  type ModelStatusTone,
  modelStatusText,
  modelStatusTone,
} from '../features/settings/model-settings-controller.ts'
import type { WorkspaceRepository } from '../model/repository.ts'

/** What the Renderer knows about Main's runtime. */
export type RuntimeReading =
  /** The bridge exists but has not answered yet. */
  | { readonly kind: 'pending' }
  /** No bridge (plain browser), or the bridge call failed. */
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'host'; readonly view: RuntimeView }

export const PENDING_READING: RuntimeReading = { kind: 'pending' }
export const UNAVAILABLE_READING: RuntimeReading = { kind: 'unavailable' }

/**
 * Main's closed failure code, only while `failed`. Raw Main messages are
 * never shown.
 */
export const safeErrorCode = (view: RuntimeView): RuntimeErrorCode | null =>
  view.status === 'failed' ? (view.errorCode ?? null) : null

export function errorCodeText(code: RuntimeErrorCode): string {
  switch (code) {
    case 'model_config_invalid':
      return '开发测试模型覆盖配置不完整或无法识别'
    case 'model_config_permissions':
      return '开发测试模型覆盖文件权限过宽'
    case 'model_config_unreadable':
      return '无法读取开发测试模型覆盖文件'
    case 'runtime_home_rejected':
      return '运行时目录不属于 Corn'
    case 'runtime_home_locked':
      return '运行时目录正被另一个进程使用'
    case 'runtime_version_mismatch':
      return '运行时版本与锁定版本不一致'
    case 'runtime_patch_mismatch':
      return '运行时补丁缺失或已被改动'
    case 'claw_missing':
      return '缺少 Claw 治理组件'
    case 'claw_version_mismatch':
      return 'Claw 组件版本与锁定版本不一致'
    case 'claw_disabled':
      return 'Claw 治理组件未启用或被替换'
    case 'claw_check_failed':
      return 'Claw 治理自检未通过'
    case 'host_unavailable':
      return '运行时进程已退出或无法连接'
    default: {
      const unreachable: never = code
      throw new Error(`Unknown runtime error code ${String(unreachable)}`)
    }
  }
}

export type RuntimeTone = 'busy' | 'ok' | 'muted' | 'error'

export interface RuntimeNoticeView {
  /** Announcement dedupe key: Host status plus safe error code, or the bridge state. */
  readonly key: string
  readonly status: RuntimeStatus | 'pending' | 'unavailable'
  readonly tone: RuntimeTone
  readonly text: string
}

/** Describes the local Host only; never implies that a Bot is connected. */
const STATUS: Record<
  RuntimeStatus,
  { readonly text: string; readonly tone: RuntimeTone }
> = {
  stopped: { text: '运行时已停止', tone: 'muted' },
  starting: { text: '运行时正在启动…', tone: 'busy' },
  ready: { text: '运行时已就绪', tone: 'ok' },
  recovering: { text: '运行时意外退出，正在自动恢复…', tone: 'busy' },
  failed: { text: '运行时启动失败，已停止自动恢复', tone: 'error' },
}

export function runtimeNotice(reading: RuntimeReading): RuntimeNoticeView {
  switch (reading.kind) {
    case 'pending':
      return {
        key: 'pending',
        status: 'pending',
        tone: 'busy',
        text: '正在读取运行时状态…',
      }
    case 'unavailable':
      return {
        key: 'bridge-unavailable',
        status: 'unavailable',
        tone: 'error',
        text: '无法读取运行时状态',
      }
    case 'host': {
      const { status } = reading.view
      const code = safeErrorCode(reading.view)
      const { text, tone } = STATUS[status]
      return code === null
        ? { key: status, status, tone, text }
        : {
            key: `${status}:${code}`,
            status,
            tone,
            text: `${text}：${errorCodeText(code)}`,
          }
    }
    default: {
      const unreachable: never = reading
      throw new Error(`Unknown runtime reading ${JSON.stringify(unreachable)}`)
    }
  }
}

export type DataSource = WorkspaceRepository['label']

export const SAMPLE_NOTICE = '示例数据，未连接真实 Bot'

export function sampleNotice(source: DataSource): string | null {
  switch (source) {
    case 'fixture':
      return SAMPLE_NOTICE
    case 'live':
      return null
    default: {
      const unreachable: never = source
      throw new Error(`Unknown data source ${String(unreachable)}`)
    }
  }
}

export interface ModelNoticeView {
  /** Announcement dedupe key: status, reason and the dev override. */
  readonly key: string
  readonly status: ModelStatus
  readonly tone: ModelStatusTone
  readonly text: string
}

/**
 * The model line, separate from the Host line: only meaningful once the
 * runtime is ready, so any other runtime state suppresses it.
 */
export function modelNotice(
  reading: RuntimeReading,
  model: ModelStatusView | null,
): ModelNoticeView | null {
  if (model === null || reading.kind !== 'host') return null
  if (reading.view.status !== 'ready') return null
  return {
    key: `${model.status}:${model.reason}:${model.devOverride}`,
    status: model.status,
    tone: modelStatusTone(model),
    text: modelStatusText(model),
  }
}

export interface Announcement {
  readonly source: DataSource | null
  readonly runtimeKey: string | null
  readonly modelKey: string | null
  readonly text: string
  /** Bumped whenever something is spoken, so equal text is still re-inserted. */
  readonly count: number
}

export const SILENT: Announcement = {
  source: null,
  runtimeKey: null,
  modelKey: null,
  text: '',
  count: 0,
}

/**
 * Compares with the previous announcement only, never a history: the sample
 * source is spoken first and whenever it changes, the runtime whenever its
 * key differs from the last one spoken, and the model line likewise while the
 * runtime is ready. Pending readings and model checks are never spoken; a
 * runtime that leaves `ready` forgets the model key, so the model is spoken
 * again with the next `ready`. Returns `previous` itself when there is nothing
 * new to say.
 */
export function nextAnnouncement(
  previous: Announcement,
  source: DataSource,
  reading: RuntimeReading,
  model: ModelStatusView | null,
): Announcement {
  const runtime = reading.kind === 'pending' ? null : runtimeNotice(reading)
  const modelLine = modelNotice(reading, model)
  const spokenModel = modelLine?.status === 'checking' ? null : modelLine
  const modelKey =
    modelLine === null ? null : (spokenModel?.key ?? previous.modelKey)
  const sourceChanged = source !== previous.source
  const runtimeChanged = runtime !== null && runtime.key !== previous.runtimeKey
  const modelChanged =
    spokenModel !== null && spokenModel.key !== previous.modelKey
  if (!sourceChanged && !runtimeChanged && !modelChanged)
    return modelKey === previous.modelKey ? previous : { ...previous, modelKey }
  const parts = [
    sourceChanged ? sampleNotice(source) : null,
    runtimeChanged ? runtime.text : null,
    modelChanged ? spokenModel.text : null,
  ].filter((part) => part !== null)
  if (parts.length === 0) return { ...previous, source, modelKey }
  return {
    source,
    runtimeKey: runtime?.key ?? previous.runtimeKey,
    modelKey,
    text: parts.join('。'),
    count: previous.count + 1,
  }
}
