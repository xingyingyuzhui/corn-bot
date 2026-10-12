import type { SqlExecutor, SqlRow } from '../driver.ts'
import { LocalDbError } from '../errors.ts'
import {
  enumColumn,
  errorCodeColumn,
  integerColumn,
  requireErrorCode,
  requireId,
  requireOne,
  requireTimestamp,
  textColumn,
} from '../rows.ts'
import {
  type ModelChoice,
  modelChoiceColumns,
  modelChoiceParams,
} from './model-choice.ts'

/** Provisioning checkpoints (plan §3.6); each is written before its call. */
export const BINDING_STAGES = [
  'planned',
  'agent_created',
  'preset_ensured',
  'session_created',
  'verified',
  'bound',
  'model_applied',
  'ready',
  'needs_model',
  'retired',
] as const
export type BindingStage = (typeof BINDING_STAGES)[number]

/** Conversation ↔ DSH Session ↔ Claw agent. At most one live binding per conversation. */
export interface SessionBindingRow {
  readonly bindingId: string
  readonly conversationId: string
  readonly dshSessionId: string
  readonly stage: BindingStage
  readonly lastError: string | null
  readonly appliedModel: ModelChoice | null
  readonly homeId: string
  readonly createdAt: number
  readonly updatedAt: number
}

export interface NewSessionBinding {
  readonly bindingId: string
  readonly conversationId: string
  /** Generated and stored before `session/create` is called. */
  readonly dshSessionId: string
  readonly homeId: string
  readonly now: number
}

const COLUMNS = `binding_id, conversation_id, dsh_session_id, stage, last_error,
  applied_provider, applied_model, applied_effort, home_id, created_at,
  updated_at`

export function isLiveStage(stage: BindingStage): boolean {
  switch (stage) {
    case 'planned':
    case 'agent_created':
    case 'preset_ensured':
    case 'session_created':
    case 'verified':
    case 'bound':
    case 'model_applied':
    case 'ready':
    case 'needs_model':
      return true
    case 'retired':
      return false
    default: {
      const unreachable: never = stage
      throw new Error(`Unhandled binding stage ${String(unreachable)}`)
    }
  }
}

export function parseSessionBindingRow(row: SqlRow): SessionBindingRow {
  return {
    bindingId: textColumn(row, 'session_bindings', 'binding_id'),
    conversationId: textColumn(row, 'session_bindings', 'conversation_id'),
    dshSessionId: textColumn(row, 'session_bindings', 'dsh_session_id'),
    stage: enumColumn(BINDING_STAGES, row, 'session_bindings', 'stage'),
    lastError: errorCodeColumn(row, 'session_bindings', 'last_error'),
    appliedModel: modelChoiceColumns(row, 'session_bindings', 'applied'),
    homeId: textColumn(row, 'session_bindings', 'home_id'),
    createdAt: integerColumn(row, 'session_bindings', 'created_at'),
    updatedAt: integerColumn(row, 'session_bindings', 'updated_at'),
  }
}

export function insertSessionBinding(
  tx: SqlExecutor,
  binding: NewSessionBinding,
): SessionBindingRow {
  tx.run(
    `INSERT INTO session_bindings (binding_id, conversation_id, dsh_session_id,
       stage, home_id, created_at, updated_at)
     VALUES (:bindingId, :conversationId, :dshSessionId, 'planned', :homeId,
       :now, :now)`,
    {
      bindingId: requireId(binding.bindingId, 'bindingId'),
      conversationId: requireId(binding.conversationId, 'conversationId'),
      dshSessionId: requireId(binding.dshSessionId, 'dshSessionId'),
      homeId: requireId(binding.homeId, 'homeId'),
      now: requireTimestamp(binding.now),
    },
  )
  return requireSessionBinding(tx, binding.bindingId)
}

export function getSessionBinding(
  tx: SqlExecutor,
  bindingId: string,
): SessionBindingRow | null {
  const row = tx.get(
    `SELECT ${COLUMNS} FROM session_bindings WHERE binding_id = :bindingId`,
    { bindingId },
  )
  return row === undefined ? null : parseSessionBindingRow(row)
}

function requireSessionBinding(
  tx: SqlExecutor,
  bindingId: string,
): SessionBindingRow {
  const binding = getSessionBinding(tx, bindingId)
  if (binding === null) {
    throw new LocalDbError('not_found', 'Session binding not found')
  }
  return binding
}

export function getLiveSessionBinding(
  tx: SqlExecutor,
  conversationId: string,
): SessionBindingRow | null {
  const row = tx.get(
    `SELECT ${COLUMNS} FROM session_bindings
     WHERE conversation_id = :conversationId AND stage <> 'retired'`,
    { conversationId },
  )
  return row === undefined ? null : parseSessionBindingRow(row)
}

export function findSessionBindingBySessionId(
  tx: SqlExecutor,
  dshSessionId: string,
): SessionBindingRow | null {
  const row = tx.get(
    `SELECT ${COLUMNS} FROM session_bindings
     WHERE dsh_session_id = :dshSessionId`,
    { dshSessionId },
  )
  return row === undefined ? null : parseSessionBindingRow(row)
}

export function listLiveSessionBindings(
  tx: SqlExecutor,
): readonly SessionBindingRow[] {
  return tx
    .all(
      `SELECT ${COLUMNS} FROM session_bindings WHERE stage <> 'retired'
       ORDER BY created_at, binding_id`,
    )
    .map(parseSessionBindingRow)
}

function updateLiveBinding(
  tx: SqlExecutor,
  bindingId: string,
  assignments: string,
  params: Readonly<Record<string, string | number | null>>,
  now: number,
): SessionBindingRow {
  const { changes } = tx.run(
    `UPDATE session_bindings SET ${assignments}, updated_at = :now
     WHERE binding_id = :bindingId AND stage <> 'retired'`,
    { ...params, bindingId, now: requireTimestamp(now) },
  )
  if (changes === 0) {
    requireSessionBinding(tx, bindingId)
    throw new LocalDbError(
      'invalid_transition',
      'A retired binding cannot change',
    )
  }
  return requireSessionBinding(tx, bindingId)
}

/** Moves to `stage`; `lastError` is a closed code or `null`. Retired is terminal. */
export function setSessionBindingStage(
  tx: SqlExecutor,
  bindingId: string,
  stage: BindingStage,
  options: { readonly now: number; readonly lastError: string | null },
): SessionBindingRow {
  return updateLiveBinding(
    tx,
    bindingId,
    'stage = :stage, last_error = :lastError',
    {
      stage: requireOne(BINDING_STAGES, stage, 'stage'),
      lastError: requireErrorCode(options.lastError),
    },
    options.now,
  )
}

/** Records the model the Session was last aligned to (`null` = none applied). */
export function setSessionBindingAppliedModel(
  tx: SqlExecutor,
  bindingId: string,
  applied: ModelChoice | null,
  options: { readonly now: number },
): SessionBindingRow {
  const { provider, model, effort } = modelChoiceParams(applied, 'appliedModel')
  return updateLiveBinding(
    tx,
    bindingId,
    `applied_provider = :provider, applied_model = :model,
     applied_effort = :effort`,
    { provider, model, effort },
    options.now,
  )
}
