import { createHash } from 'node:crypto'
import type {
  ApprovalStatus,
  FeedItem,
} from '../../../../packages/contracts/src/workspace.ts'
import {
  isPlainRecord,
  type WireEvent,
} from '../../../../packages/dsh-adapter/src/session-wire.ts'

/**
 * Pure mapping from durable DSH Session events (dsh-v0.2.0-rc.2
 * `SessionEventMap`) to Renderer feed items. Model text is carried only in
 * message bubbles; tool arguments, tool output, approval reasons and failure
 * text never reach an item.
 */

/** Ordered durable log types that never render (dsh-v0.2.0-rc.2 `KNOWN_SESSION_EVENT_TYPES`). */
const SILENT_EVENT_TYPES: ReadonlySet<string> = new Set([
  'agent-preset/selected',
  'agent/inbox/spliced',
  'approval/policy',
  'assistant/attempt',
  'command/done',
  'command/run',
  'compaction/end',
  'compaction/prune',
  'compaction/start',
  'compaction/summary',
  'deliverables/presented',
  'developer/message',
  'feedback/message-delete',
  'feedback/message-put',
  'feedback/record',
  'goal/change',
  'hook/invoked',
  'hook/result',
  'image/offload',
  'llm/retry',
  'llm/retry-started',
  'model/selection',
  'permission/preset',
  'plan/mode',
  'request/context',
  'request/header',
  'sandbox/mode',
  'schedule/change',
  'session-log-deepseek/delivery-accepted',
  'session/end-seed',
  'session/title',
  'session/title-llm-request',
  'step/end',
  'step/start',
  'subagent/catalog',
  'subagent/descriptor',
  'subagent/model-selection-policy',
  'system/message',
  'team/member',
  'team/message/delivered',
  'team/message/queued',
  'team/task',
  'todo/write',
  'tool-workflow/agent-end',
  'tool-workflow/agent-start',
  'tool-workflow/run-end',
  'tool-workflow/run-start',
  'tool/ptc-dispatch',
  'tool/ptc-dispatch-start',
  'turn/start',
  'web/deepseek-search-llm-request',
  'workspace/changes',
])

/** Durable approval identity, for the live overlay only; never crosses IPC. */
export interface ApprovalRef {
  readonly approvalId: string
  readonly callId?: string
}

/** Live state the approval broker holds for a card that is not decided yet. */
export interface ApprovalOverlay {
  readonly handle: string
  readonly status: ApprovalStatus
}

export interface ItemContext {
  /** Stable opaque id for an internal key; the same key always yields the same id. */
  readonly mintId: (key: string) => string
  /** The Main-issued message id of an admitted request, when Corn sent it. */
  readonly messageIdFor: (requestId: string) => string | undefined
  readonly approvalOverlay: (ref: ApprovalRef) => ApprovalOverlay | undefined
  /** Settlements held back while their live attempt is still streaming. */
  readonly held: (seq: number) => boolean
}

export interface ProjectedItems {
  readonly items: readonly FeedItem[]
  /** Events skipped because this build does not know them (no content kept). */
  readonly unknownEvents: number
}

const TOOL_NAME = /^[A-Za-z0-9][\w.:-]{0,63}$/u

export const NOTICE_TEXT = {
  unsupported: '这里有一条记录暂不支持显示',
  turnAborted: '已停止当前回复，排队消息仍在',
  turnInterrupted: '运行时中断，本轮回复未完成',
  turnBlocked: '本轮被拦截，未继续回复',
  turnError: '回复失败',
  turnMaxTokens: '回复达到长度上限',
  turnEnded: '本轮已结束',
  approvalTitle: '需要你的确认',
} as const

export const toolLabel = (name: unknown): string =>
  typeof name === 'string' && TOOL_NAME.test(name) ? `工具 ${name}` : '工具'

export const toolNotice = (
  label: string,
  phase: 'running' | 'done' | 'failed',
): { readonly tone: 'info' | 'error'; readonly text: string } => {
  switch (phase) {
    case 'running':
      return { tone: 'info', text: `正在使用${label}` }
    case 'done':
      return { tone: 'info', text: `已使用${label}` }
    case 'failed':
      return { tone: 'error', text: `${label}执行失败` }
    default: {
      const unreachable: never = phase
      throw new Error(`Unknown tool phase ${String(unreachable)}`)
    }
  }
}

/** Joins the `text` blocks of a message `content` array; other blocks are dropped. */
export function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        isPlainRecord(block) &&
        block.type === 'text' &&
        typeof block.text === 'string' &&
        block.text.length > 0,
    )
    .map((block) => block.text)
    .join('\n\n')
}

/** The Renderer's paragraph rule: blank lines separate paragraphs. */
export const paragraphsOf = (text: string): readonly string[] =>
  text.length > 0 ? text.split(/\n{2,}/u) : []

/** `SessionRequestId` echoed on a Corn-sent `user/message` as `source.rpcId`. */
export function userRequestId(event: WireEvent): string | undefined {
  if (event.type !== 'user/message' || !isPlainRecord(event.data))
    return undefined
  const source = event.data.source
  return isPlainRecord(source) &&
    source.kind === 'user' &&
    typeof source.rpcId === 'string' &&
    source.rpcId.length > 0
    ? source.rpcId
    : undefined
}

const isUserSource = (data: Record<string, unknown>): boolean =>
  isPlainRecord(data.source) && data.source.kind === 'user'

function turnEndNotice(
  reason: unknown,
): { readonly tone: 'info' | 'error'; readonly text: string } | undefined {
  const kind = isPlainRecord(reason) ? reason.kind : undefined
  switch (kind) {
    case 'completed':
    case 'forked':
      return undefined
    case 'aborted':
      return { tone: 'info', text: NOTICE_TEXT.turnAborted }
    case 'interrupted':
      return { tone: 'error', text: NOTICE_TEXT.turnInterrupted }
    case 'blocked':
      return { tone: 'info', text: NOTICE_TEXT.turnBlocked }
    case 'error':
      return { tone: 'error', text: NOTICE_TEXT.turnError }
    case 'max-tokens':
      return { tone: 'info', text: NOTICE_TEXT.turnMaxTokens }
    default:
      // Merge-extensible upstream: a reason this build does not know stays neutral.
      return { tone: 'info', text: NOTICE_TEXT.turnEnded }
  }
}

function decidedStatus(outcome: unknown): ApprovalStatus | undefined {
  switch (outcome) {
    case 'allowed-once':
    case 'rejected':
    case 'cancelled':
      return outcome
    case 'unavailable':
      // Fail-closed upstream: nobody answered and the tool did not run.
      return 'cancelled'
    default:
      return undefined
  }
}

const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0

/**
 * Projects one contiguous run of durable events. Deterministic: the same
 * records and context always yield the same items, so a rebuild from a fresh
 * snapshot never duplicates or reorders what was already shown.
 */
export function projectRecords(
  records: readonly WireEvent[],
  context: ItemContext,
): ProjectedItems {
  const items: FeedItem[] = []
  const tools = new Map<string, { index: number; label: string }>()
  const approvals = new Map<string, number>()
  let unknownEvents = 0
  for (const event of records) {
    const data = isPlainRecord(event.data) ? event.data : {}
    const eventId = context.mintId(`event:${event.seq}`)
    switch (event.type) {
      case 'user/message': {
        if (event.surfaceOp !== 'append' || !isUserSource(data)) break
        const text = textOf(data.content)
        if (text.length === 0) break
        const requestId = userRequestId(event)
        items.push({
          kind: 'message',
          id:
            (requestId === undefined
              ? undefined
              : context.messageIdFor(requestId)) ?? eventId,
          author: 'user',
          paragraphs: paragraphsOf(text),
        })
        break
      }
      case 'assistant/message': {
        if (event.surfaceOp !== 'append' || context.held(event.seq)) break
        const message = isPlainRecord(data.message) ? data.message : {}
        const text = textOf(message.content)
        if (text.length === 0) break
        items.push({
          kind: 'message',
          id: eventId,
          author: 'bot',
          paragraphs: paragraphsOf(text),
        })
        break
      }
      case 'tool/call': {
        if (!isId(data.callId) || tools.has(data.callId)) break
        const label = toolLabel(data.name)
        tools.set(data.callId, { index: items.length, label })
        items.push({
          kind: 'notice',
          id: context.mintId(`tool:${data.callId}`),
          ...toolNotice(label, 'running'),
        })
        break
      }
      case 'tool/result': {
        const message = isPlainRecord(data.message) ? data.message : {}
        const callId = isPlainRecord(message.source)
          ? message.source.callId
          : message.toolCallId
        const call = isId(callId) ? tools.get(callId) : undefined
        const current = call === undefined ? undefined : items[call.index]
        if (call === undefined || current?.kind !== 'notice') break
        items[call.index] = {
          ...current,
          ...toolNotice(
            call.label,
            message.isError === true ? 'failed' : 'done',
          ),
        }
        break
      }
      case 'approval/asked': {
        if (!isId(data.id) || approvals.has(data.id)) break
        const id = context.mintId(`approval:${data.id}`)
        const overlay = context.approvalOverlay({
          approvalId: data.id,
          ...(isId(data.callId) ? { callId: data.callId } : {}),
        })
        approvals.set(data.id, items.length)
        items.push({
          kind: 'approval',
          id,
          handle: overlay?.handle ?? id,
          title: NOTICE_TEXT.approvalTitle,
          detail: toolLabel(data.toolName),
          status: overlay?.status ?? 'pending',
        })
        break
      }
      case 'approval/decided': {
        const index = isId(data.id) ? approvals.get(data.id) : undefined
        const status = decidedStatus(data.outcome)
        const current = index === undefined ? undefined : items[index]
        if (index === undefined || status === undefined) break
        // Only the durable decision is terminal; it overrides any live overlay.
        if (current?.kind === 'approval') items[index] = { ...current, status }
        break
      }
      case 'turn/end': {
        const notice = turnEndNotice(data.reason)
        if (notice !== undefined)
          items.push({ kind: 'notice', id: eventId, ...notice })
        break
      }
      default:
        if (SILENT_EVENT_TYPES.has(event.type)) break
        unknownEvents += 1
        if (!event.ignorable)
          items.push({
            kind: 'notice',
            id: eventId,
            tone: 'info',
            text: NOTICE_TEXT.unsupported,
          })
    }
  }
  return { items, unknownEvents }
}

/**
 * Opaque, stable feed ids: a digest of a Corn-owned scope and an internal key,
 * so DSH seqs, call ids and attempt ids never reach the Renderer.
 */
export function opaqueItemIds(scope: string): (key: string) => string {
  return (key) =>
    `i_${createHash('sha256').update(`${scope}\u0000${key}`).digest('hex').slice(0, 32)}`
}
