import type { RuntimeStatus, RuntimeView } from '@corn-bot/contracts'
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
 * Safe, closed failure codes from Main. Empty until the runtime contract
 * defines them: then alias the contract union here, read the field in
 * `safeErrorCode` and word each code in `errorCodeText`. Raw Main messages
 * are never shown.
 */
export type RuntimeErrorCode = never

export const safeErrorCode = (_view: RuntimeView): RuntimeErrorCode | null =>
  null

export function errorCodeText(code: RuntimeErrorCode): string {
  switch (code) {
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

export interface Announcement {
  readonly source: DataSource | null
  readonly runtimeKey: string | null
  readonly text: string
  /** Bumped whenever something is spoken, so equal text is still re-inserted. */
  readonly count: number
}

export const SILENT: Announcement = {
  source: null,
  runtimeKey: null,
  text: '',
  count: 0,
}

/**
 * Compares with the previous announcement only, never a history: the sample
 * source is spoken first and whenever it changes, the runtime whenever its
 * key differs from the last one spoken. A pending reading is never spoken.
 * Returns `previous` itself when there is nothing new to say.
 */
export function nextAnnouncement(
  previous: Announcement,
  source: DataSource,
  reading: RuntimeReading,
): Announcement {
  const runtime = reading.kind === 'pending' ? null : runtimeNotice(reading)
  const sourceChanged = source !== previous.source
  const runtimeChanged = runtime !== null && runtime.key !== previous.runtimeKey
  if (!sourceChanged && !runtimeChanged) return previous
  const parts = [
    sourceChanged ? sampleNotice(source) : null,
    runtimeChanged ? runtime.text : null,
  ].filter((part) => part !== null)
  if (parts.length === 0) return { ...previous, source }
  return {
    source,
    runtimeKey: runtime?.key ?? previous.runtimeKey,
    text: parts.join('。'),
    count: previous.count + 1,
  }
}
