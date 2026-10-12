import type { ModelSelection } from '../../../../packages/contracts/src/model-settings.ts'
import type { DeliveryState } from '../../../../packages/contracts/src/workspace.ts'
import { RemoteError } from '../../../../packages/dsh-adapter/src/remote-error.ts'
import { isPlainRecord } from '../../../../packages/dsh-adapter/src/session-wire.ts'
import type {
  AdmissionState,
  MessageAdmissionRow,
} from '../../../../packages/local-db/src/index.ts'
import type { AdmissionView } from './conversation-projector.ts'

/**
 * Pure helpers of `ChatService`: the request/message id pairing, the closed
 * failure codes an admission keeps, prompt-error classification and the
 * non-activating `session/projections` probe. Nothing here logs or keeps
 * message text beyond the view it returns.
 */

const REQUEST_PREFIX = 'req_'
const MESSAGE_PREFIX = 'msg_'

/** The DSH `SessionRequestId` Main mints (and persists) before any RPC. */
export const mintRequestId = (uuid: string): string =>
  `${REQUEST_PREFIX}${uuid}`

/**
 * The Renderer's message id of a Corn request, derived (not stored) so the
 * optimistic bubble and the durable `user/message` keep one id.
 */
export function messageIdFor(requestId: string): string | undefined {
  return requestId.startsWith(REQUEST_PREFIX) &&
    requestId.length > REQUEST_PREFIX.length
    ? `${MESSAGE_PREFIX}${requestId.slice(REQUEST_PREFIX.length)}`
    : undefined
}

export function requestIdFor(messageId: string): string | undefined {
  return messageId.startsWith(MESSAGE_PREFIX) &&
    messageId.length > MESSAGE_PREFIX.length
    ? `${REQUEST_PREFIX}${messageId.slice(MESSAGE_PREFIX.length)}`
    : undefined
}

/** Closed `message_admissions.last_error` codes; Host text never lands. */
export const SEND_FAILURES = [
  /** Refused before the RPC: no live Host generation. */
  'runtime_not_ready',
  'binding_broken',
  'model_unavailable',
  'host_error',
  /** Left `pending` by an earlier process: it never reached the wire. */
  'not_sent',
  /** The Host generation ended while the request was in flight. */
  'host_lost',
  /** Timeout, disconnect or 5xx: DSH may or may not hold the request. */
  'host_unreachable',
  'session_busy',
  'session_not_found',
  'bad_request',
  'host_rejected',
] as const
export type SendFailure = (typeof SEND_FAILURES)[number]

export type PromptOutcome =
  | { readonly kind: 'rejected'; readonly code: SendFailure }
  | { readonly kind: 'unknown'; readonly code: SendFailure }

/** DSH errors that may follow a partial admission; treated as unknown. */
const UNCERTAIN_REMOTE = new Set([
  'gateway/internal',
  'gateway/timeout',
  'gateway/unavailable',
])

/**
 * A closed DSH `RemoteError` is a refusal: DSH admitted nothing. Transport
 * failures (timeouts, disconnects, HTTP status, unreadable replies) leave the
 * outcome unknown, so only the same `requestId` may ever be retried.
 */
export function classifyPromptError(error: unknown): PromptOutcome {
  if (!(error instanceof RemoteError))
    return { kind: 'unknown', code: 'host_unreachable' }
  const { code } = error
  if (code === 'corn/endpoint-denied' || code === 'corn/invalid-request')
    return { kind: 'rejected', code: 'bad_request' }
  if (code.startsWith('corn/') || UNCERTAIN_REMOTE.has(code))
    return { kind: 'unknown', code: 'host_unreachable' }
  switch (code) {
    case 'session/agent-busy':
      return { kind: 'rejected', code: 'session_busy' }
    case 'session/not-found':
      return { kind: 'rejected', code: 'session_not_found' }
    case 'gateway/bad-request':
      return { kind: 'rejected', code: 'bad_request' }
    default:
      return { kind: 'rejected', code: 'host_rejected' }
  }
}

const FAILURE_TEXT: Readonly<Record<SendFailure, string>> = {
  runtime_not_ready: '运行时未就绪，未发送',
  binding_broken: '会话需要修复，未发送',
  model_unavailable: '模型不可用，未发送',
  host_error: '发送失败，可重发',
  not_sent: '运行时重启前未发出，可重发',
  host_lost: '未确认送达，可重发',
  host_unreachable: '未确认送达，可重发',
  session_busy: '会话忙，可稍后重发',
  session_not_found: '会话需要修复，未发送',
  bad_request: '消息未被接受',
  host_rejected: '消息未被接受，可重发',
}

const UNCONFIRMED = '未确认送达，可重发'

function failureText(row: MessageAdmissionRow): string {
  const code = row.lastError
  if (code !== null && (SEND_FAILURES as readonly string[]).includes(code))
    return FAILURE_TEXT[code as SendFailure]
  return row.state === 'unknown' ? UNCONFIRMED : FAILURE_TEXT.host_error
}

function deliveryOf(state: AdmissionState): DeliveryState | undefined {
  switch (state) {
    case 'pending':
      return 'queued'
    case 'sending':
      return 'dispatching'
    case 'accepted':
      return 'accepted'
    case 'rejected':
    case 'unknown':
      return 'failed'
    case 'observed':
    case 'withdrawn':
      return undefined
    default: {
      const unreachable: never = state
      throw new Error(`Unhandled admission state ${String(unreachable)}`)
    }
  }
}

/** The bubble of a send DSH has not been seen holding; `undefined` once settled. */
export function admissionView(
  row: MessageAdmissionRow,
): AdmissionView | undefined {
  const delivery = deliveryOf(row.state)
  const messageId = messageIdFor(row.requestId)
  if (
    delivery === undefined ||
    messageId === undefined ||
    row.bodyText === null
  )
    return undefined
  return {
    messageId,
    requestId: row.requestId,
    text: row.bodyText,
    delivery,
    ...(delivery === 'failed' ? { failure: failureText(row) } : {}),
  }
}

/** What the non-activating `session/projections` says about one Session. */
export interface SessionProbe {
  readonly asOfSeq: number
  /** `modelSelection.next`: what the next request would use, if known. */
  readonly modelSelection: ModelSelection | null
  /** Pending inbox message ids keyed by the request id that admitted them. */
  readonly inbox: ReadonlyMap<string, string>
}

function selectionOf(value: unknown): ModelSelection | null {
  if (
    !isPlainRecord(value) ||
    typeof value.provider !== 'string' ||
    value.provider.length === 0 ||
    typeof value.model !== 'string' ||
    value.model.length === 0 ||
    (value.reasoningEffort !== undefined &&
      typeof value.reasoningEffort !== 'string')
  )
    return null
  return {
    provider: value.provider,
    model: value.model,
    ...(typeof value.reasoningEffort === 'string'
      ? { reasoningEffort: value.reasoningEffort }
      : {}),
  }
}

/**
 * Parses a `session/projections` reply (dsh-v0.2.0-rc.2: `inbox` is
 * `{next-turn, next-step}` of `UserMessage`, `modelSelection` is
 * `{lastUsed, next}`). `null` means DSH does not know the Session.
 */
export function parseSessionProbe(raw: unknown): SessionProbe | null {
  if (raw === null) return null
  if (
    !isPlainRecord(raw) ||
    !Number.isSafeInteger(raw.asOfSeq) ||
    (raw.asOfSeq as number) < -1 ||
    !isPlainRecord(raw.values)
  )
    throw new RemoteError(
      'corn/invalid-response',
      'Invalid Session projections',
    )
  const inbox = new Map<string, string>()
  const lists = isPlainRecord(raw.values.inbox) ? raw.values.inbox : {}
  for (const target of ['next-turn', 'next-step'] as const) {
    const list = lists[target]
    if (!Array.isArray(list)) continue
    for (const message of list) {
      if (!isPlainRecord(message) || typeof message.id !== 'string') continue
      const source = message.source
      if (
        isPlainRecord(source) &&
        source.kind === 'user' &&
        typeof source.rpcId === 'string'
      )
        inbox.set(source.rpcId, message.id)
    }
  }
  const selection = raw.values.modelSelection
  return {
    asOfSeq: raw.asOfSeq as number,
    modelSelection: isPlainRecord(selection)
      ? selectionOf(selection.next)
      : null,
    inbox,
  }
}
