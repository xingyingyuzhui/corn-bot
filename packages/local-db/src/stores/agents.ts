import type { SqlExecutor, SqlRow } from '../driver.ts'
import { LocalDbError } from '../errors.ts'
import {
  enumColumn,
  integerColumn,
  invalidInput,
  requireId,
  requireOne,
  requireText,
  requireTimestamp,
  textColumn,
} from '../rows.ts'

/** Claw policy preset chosen at creation (decision 6B, default research). */
export const POLICY_PRESETS = ['research', 'developer'] as const
export type PolicyPreset = (typeof POLICY_PRESETS)[number]

const AGENT_ID_PREFIX = 'wa_'
const DSH_PRESET_PREFIX = 'wa-'

/** Cached mapping of a Bot to its Claw Registry agent; Claw stays authoritative. */
export interface ClawAgentRow {
  readonly botId: string
  readonly agentId: string
  readonly workspaceId: string
  readonly canonicalRoot: string
  readonly dshPreset: string
  readonly policyPreset: PolicyPreset
  readonly createdAt: number
}

export interface NewClawAgent {
  readonly botId: string
  readonly agentId: string
  readonly workspaceId: string
  readonly canonicalRoot: string
  readonly dshPreset: string
  readonly policyPreset: PolicyPreset
  readonly now: number
}

const COLUMNS =
  'bot_id, agent_id, workspace_id, canonical_root, dsh_preset, policy_preset, created_at'

function prefixed(value: string, prefix: string): boolean {
  return value.startsWith(prefix) && value.length > prefix.length
}

export function parseClawAgentRow(row: SqlRow): ClawAgentRow {
  const agentId = textColumn(row, 'claw_agents', 'agent_id')
  const dshPreset = textColumn(row, 'claw_agents', 'dsh_preset')
  if (!prefixed(agentId, AGENT_ID_PREFIX)) {
    throw new LocalDbError('invalid_row', 'Invalid claw_agents.agent_id')
  }
  if (!prefixed(dshPreset, DSH_PRESET_PREFIX)) {
    throw new LocalDbError('invalid_row', 'Invalid claw_agents.dsh_preset')
  }
  return {
    botId: textColumn(row, 'claw_agents', 'bot_id'),
    agentId,
    workspaceId: textColumn(row, 'claw_agents', 'workspace_id'),
    canonicalRoot: textColumn(row, 'claw_agents', 'canonical_root'),
    dshPreset,
    policyPreset: enumColumn(
      POLICY_PRESETS,
      row,
      'claw_agents',
      'policy_preset',
    ),
    createdAt: integerColumn(row, 'claw_agents', 'created_at'),
  }
}

export function insertClawAgent(
  tx: SqlExecutor,
  agent: NewClawAgent,
): ClawAgentRow {
  const agentId = requireId(agent.agentId, 'agentId')
  const dshPreset = requireId(agent.dshPreset, 'dshPreset')
  if (!prefixed(agentId, AGENT_ID_PREFIX)) throw invalidInput('agentId')
  if (!prefixed(dshPreset, DSH_PRESET_PREFIX)) throw invalidInput('dshPreset')
  tx.run(
    `INSERT INTO claw_agents (${COLUMNS})
     VALUES (:botId, :agentId, :workspaceId, :canonicalRoot, :dshPreset,
       :policyPreset, :now)`,
    {
      botId: requireId(agent.botId, 'botId'),
      agentId,
      workspaceId: requireId(agent.workspaceId, 'workspaceId'),
      canonicalRoot: requireText(agent.canonicalRoot, 'canonicalRoot'),
      dshPreset,
      policyPreset: requireOne(
        POLICY_PRESETS,
        agent.policyPreset,
        'policyPreset',
      ),
      now: requireTimestamp(agent.now),
    },
  )
  const row = getClawAgent(tx, agent.botId)
  if (row === null) throw new LocalDbError('not_found', 'Claw agent not found')
  return row
}

export function getClawAgent(
  tx: SqlExecutor,
  botId: string,
): ClawAgentRow | null {
  const row = tx.get(
    `SELECT ${COLUMNS} FROM claw_agents WHERE bot_id = :botId`,
    { botId },
  )
  return row === undefined ? null : parseClawAgentRow(row)
}

export function findClawAgentByAgentId(
  tx: SqlExecutor,
  agentId: string,
): ClawAgentRow | null {
  const row = tx.get(
    `SELECT ${COLUMNS} FROM claw_agents WHERE agent_id = :agentId`,
    { agentId },
  )
  return row === undefined ? null : parseClawAgentRow(row)
}

export function listClawAgents(tx: SqlExecutor): readonly ClawAgentRow[] {
  return tx
    .all(`SELECT ${COLUMNS} FROM claw_agents ORDER BY created_at, bot_id`)
    .map(parseClawAgentRow)
}
