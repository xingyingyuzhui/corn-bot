import { createHash } from 'node:crypto'
import type { SqlExecutor, SqlRow } from '../driver.ts'
import { LocalDbError } from '../errors.ts'
import {
  enumColumn,
  errorCodeColumn,
  integerColumn,
  invalidInput,
  nullableIntegerColumn,
  nullableTextColumn,
  requireErrorCode,
  requireId,
  requireTimestamp,
  textColumn,
} from '../rows.ts'

export const ADMISSION_MODES = ['queue'] as const
export type AdmissionMode = (typeof ADMISSION_MODES)[number]

export const ADMISSION_STATES = [
  'pending',
  'sending',
  'accepted',
  'observed',
  'rejected',
  'unknown',
  'withdrawn',
] as const
export type AdmissionState = (typeof ADMISSION_STATES)[number]

/**
 * One user send. `requestId` is the DSH SessionRequestId, written before the
 * RPC; `clientId` dedupes repeated IPC submits per conversation.
 */
export interface MessageAdmissionRow {
  readonly requestId: string
  readonly conversationId: string
  readonly bindingId: string
  readonly clientId: string
  readonly mode: AdmissionMode
  readonly state: AdmissionState
  /** Kept only until DSH is observed holding the message (decision 5A). */
  readonly bodyText: string | null
  readonly bodySha256: string
  readonly attempts: number
  readonly observedSeq: number | null
  readonly lastError: string | null
  readonly createdAt: number
  readonly updatedAt: number
}

export interface NewMessageAdmission {
  readonly requestId: string
  readonly conversationId: string
  readonly bindingId: string
  readonly clientId: string
  readonly bodyText: string
  readonly now: number
}

export interface AdmissionTransition {
  readonly now: number
  readonly lastError?: string | null
  /** Only with `observed`: the journal seq of the `user/message`. */
  readonly observedSeq?: number
  /** Count one more RPC attempt (moving to `sending`). */
  readonly countAttempt?: boolean
}

const COLUMNS = `request_id, conversation_id, binding_id, client_id, mode, state,
  body_text, body_sha256, attempts, observed_seq, last_error, created_at,
  updated_at`

export function admissionTransitions(
  from: AdmissionState,
): readonly AdmissionState[] {
  switch (from) {
    case 'pending':
      return ['sending', 'withdrawn']
    case 'sending':
      return ['accepted', 'rejected', 'unknown', 'observed']
    case 'unknown':
      return ['sending', 'accepted', 'rejected', 'observed', 'withdrawn']
    case 'accepted':
      return ['observed', 'withdrawn']
    case 'observed':
    case 'rejected':
    case 'withdrawn':
      return []
    default: {
      const unreachable: never = from
      throw new Error(`Unhandled admission state ${String(unreachable)}`)
    }
  }
}

/** Whether the body must stay stored in `state` (it may still need resending). */
export function retainsBody(state: AdmissionState): boolean {
  switch (state) {
    case 'pending':
    case 'sending':
    case 'unknown':
    case 'accepted':
    case 'rejected':
      return true
    case 'observed':
    case 'withdrawn':
      return false
    default: {
      const unreachable: never = state
      throw new Error(`Unhandled admission state ${String(unreachable)}`)
    }
  }
}

export function bodyChecksum(bodyText: string): string {
  return createHash('sha256').update(bodyText, 'utf8').digest('hex')
}

export function parseMessageAdmissionRow(row: SqlRow): MessageAdmissionRow {
  const table = 'message_admissions'
  return {
    requestId: textColumn(row, table, 'request_id'),
    conversationId: textColumn(row, table, 'conversation_id'),
    bindingId: textColumn(row, table, 'binding_id'),
    clientId: textColumn(row, table, 'client_id'),
    mode: enumColumn(ADMISSION_MODES, row, table, 'mode'),
    state: enumColumn(ADMISSION_STATES, row, table, 'state'),
    bodyText: nullableTextColumn(row, table, 'body_text'),
    bodySha256: textColumn(row, table, 'body_sha256'),
    attempts: integerColumn(row, table, 'attempts'),
    observedSeq: nullableIntegerColumn(row, table, 'observed_seq'),
    lastError: errorCodeColumn(row, table, 'last_error'),
    createdAt: integerColumn(row, table, 'created_at'),
    updatedAt: integerColumn(row, table, 'updated_at'),
  }
}

/** Inserts a `pending` admission. A repeated `clientId` fails as `constraint`/`unique`. */
export function insertMessageAdmission(
  tx: SqlExecutor,
  admission: NewMessageAdmission,
): MessageAdmissionRow {
  tx.run(
    `INSERT INTO message_admissions (request_id, conversation_id, binding_id,
       client_id, mode, state, body_text, body_sha256, created_at, updated_at)
     VALUES (:requestId, :conversationId, :bindingId, :clientId, 'queue',
       'pending', :bodyText, :bodySha256, :now, :now)`,
    {
      requestId: requireId(admission.requestId, 'requestId'),
      conversationId: requireId(admission.conversationId, 'conversationId'),
      bindingId: requireId(admission.bindingId, 'bindingId'),
      clientId: requireId(admission.clientId, 'clientId'),
      bodyText: admission.bodyText,
      bodySha256: bodyChecksum(admission.bodyText),
      now: requireTimestamp(admission.now),
    },
  )
  return requireMessageAdmission(tx, admission.requestId)
}

export function getMessageAdmission(
  tx: SqlExecutor,
  requestId: string,
): MessageAdmissionRow | null {
  const row = tx.get(
    `SELECT ${COLUMNS} FROM message_admissions WHERE request_id = :requestId`,
    { requestId },
  )
  return row === undefined ? null : parseMessageAdmissionRow(row)
}

function requireMessageAdmission(
  tx: SqlExecutor,
  requestId: string,
): MessageAdmissionRow {
  const admission = getMessageAdmission(tx, requestId)
  if (admission === null) {
    throw new LocalDbError('not_found', 'Message admission not found')
  }
  return admission
}

export function findMessageAdmissionByClientId(
  tx: SqlExecutor,
  conversationId: string,
  clientId: string,
): MessageAdmissionRow | null {
  const row = tx.get(
    `SELECT ${COLUMNS} FROM message_admissions
     WHERE conversation_id = :conversationId AND client_id = :clientId`,
    { conversationId, clientId },
  )
  return row === undefined ? null : parseMessageAdmissionRow(row)
}

/** `pending`, `sending` and `unknown` admissions still to reconcile. */
export function listOpenMessageAdmissions(
  tx: SqlExecutor,
): readonly MessageAdmissionRow[] {
  return tx
    .all(
      `SELECT ${COLUMNS} FROM message_admissions
       WHERE state IN ('pending', 'sending', 'unknown')
       ORDER BY created_at, request_id`,
    )
    .map(parseMessageAdmissionRow)
}

/**
 * Applies one state change from `admissionTransitions`. Moving to `observed`
 * or `withdrawn` clears `body_text`; the checksum stays.
 */
export function transitionMessageAdmission(
  tx: SqlExecutor,
  requestId: string,
  to: AdmissionState,
  transition: AdmissionTransition,
): MessageAdmissionRow {
  const current = requireMessageAdmission(tx, requestId)
  if (!admissionTransitions(current.state).includes(to)) {
    throw new LocalDbError(
      'invalid_transition',
      `Admission cannot move from ${current.state} to ${to}`,
    )
  }
  if (transition.observedSeq !== undefined) {
    if (to !== 'observed' || !Number.isSafeInteger(transition.observedSeq)) {
      throw invalidInput('observedSeq')
    }
  }
  tx.run(
    `UPDATE message_admissions
     SET state = :to,
       body_text = CASE WHEN :retainBody = 1 THEN body_text ELSE NULL END,
       attempts = attempts + :attemptDelta,
       observed_seq = :observedSeq,
       last_error = :lastError,
       updated_at = :now
     WHERE request_id = :requestId AND state = :from`,
    {
      requestId,
      from: current.state,
      to,
      retainBody: retainsBody(to) ? 1 : 0,
      attemptDelta: transition.countAttempt === true ? 1 : 0,
      observedSeq: transition.observedSeq ?? null,
      lastError: requireErrorCode(transition.lastError ?? null),
      now: requireTimestamp(transition.now),
    },
  )
  return requireMessageAdmission(tx, requestId)
}
