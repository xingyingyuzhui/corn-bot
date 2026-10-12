import type { SqlExecutor, SqlParams, SqlRow } from '../driver.ts'
import { LocalDbError } from '../errors.ts'
import {
  enumColumn,
  flagColumn,
  flagValue,
  integerColumn,
  nullableTextColumn,
  requireId,
  requireOne,
  requireText,
  requireTimestamp,
  textColumn,
} from '../rows.ts'
import { POLICY_PRESETS, type PolicyPreset } from './agents.ts'
import {
  type ModelChoice,
  modelChoiceColumns,
  modelChoiceParams,
} from './model-choice.ts'

export const BOT_PROVISIONING = ['creating', 'ready', 'needs_repair'] as const
export type BotProvisioning = (typeof BOT_PROVISIONING)[number]

export interface BotRow {
  readonly botId: string
  readonly displayName: string
  readonly avatarVariant: string | null
  readonly pinned: boolean
  readonly hidden: boolean
  readonly sortKey: string
  /** `null` = follow the global default model. */
  readonly modelOverride: ModelChoice | null
  /**
   * Claw policy preset chosen at creation (decision 6B), kept from step 0 so
   * a restart before `claw_agents` exists does not lose it. `null` only for
   * rows created before migration 0002 without a Claw agent.
   */
  readonly policyPreset: PolicyPreset | null
  readonly provisioning: BotProvisioning
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
}

export interface NewBot {
  readonly botId: string
  readonly displayName: string
  readonly avatarVariant: string | null
  readonly sortKey: string
  readonly modelOverride: ModelChoice | null
  /** Omitted: `null` (unknown). */
  readonly policyPreset?: PolicyPreset
  readonly now: number
}

/** Optimistic concurrency: omit to update unconditionally. */
export interface BotWriteOptions {
  readonly now: number
  readonly expectedRevision?: number
}

const COLUMNS = `bot_id, display_name, avatar_variant, pinned, hidden, sort_key,
  model_override_provider, model_override_model, model_override_effort,
  policy_preset, provisioning, revision, created_at, updated_at`

export function parseBotRow(row: SqlRow): BotRow {
  const policyPreset = nullableTextColumn(row, 'bots', 'policy_preset')
  return {
    botId: textColumn(row, 'bots', 'bot_id'),
    displayName: textColumn(row, 'bots', 'display_name'),
    avatarVariant: nullableTextColumn(row, 'bots', 'avatar_variant'),
    pinned: flagColumn(row, 'bots', 'pinned'),
    hidden: flagColumn(row, 'bots', 'hidden'),
    sortKey: textColumn(row, 'bots', 'sort_key'),
    modelOverride: modelChoiceColumns(row, 'bots', 'model_override'),
    policyPreset:
      policyPreset === null
        ? null
        : enumColumn(POLICY_PRESETS, row, 'bots', 'policy_preset'),
    provisioning: enumColumn(BOT_PROVISIONING, row, 'bots', 'provisioning'),
    revision: integerColumn(row, 'bots', 'revision'),
    createdAt: integerColumn(row, 'bots', 'created_at'),
    updatedAt: integerColumn(row, 'bots', 'updated_at'),
  }
}

export function insertBot(tx: SqlExecutor, bot: NewBot): BotRow {
  const override = modelChoiceParams(bot.modelOverride, 'modelOverride')
  const now = requireTimestamp(bot.now)
  tx.run(
    `INSERT INTO bots (bot_id, display_name, avatar_variant, sort_key,
       model_override_provider, model_override_model, model_override_effort,
       policy_preset, provisioning, created_at, updated_at)
     VALUES (:botId, :displayName, :avatarVariant, :sortKey,
       :provider, :model, :effort, :policyPreset, 'creating', :now, :now)`,
    {
      botId: requireId(bot.botId, 'botId'),
      displayName: requireText(bot.displayName, 'displayName'),
      avatarVariant: bot.avatarVariant,
      sortKey: bot.sortKey,
      ...override,
      policyPreset:
        bot.policyPreset === undefined
          ? null
          : requireOne(POLICY_PRESETS, bot.policyPreset, 'policyPreset'),
      now,
    },
  )
  return requireBot(tx, bot.botId)
}

export function getBot(tx: SqlExecutor, botId: string): BotRow | null {
  const row = tx.get(`SELECT ${COLUMNS} FROM bots WHERE bot_id = :botId`, {
    botId,
  })
  return row === undefined ? null : parseBotRow(row)
}

export function requireBot(tx: SqlExecutor, botId: string): BotRow {
  const bot = getBot(tx, botId)
  if (bot === null) throw new LocalDbError('not_found', 'Bot not found')
  return bot
}

/** Pinned first, then `sort_key`. Hidden bots only when asked (no deletes). */
export function listBots(
  tx: SqlExecutor,
  options: { readonly includeHidden: boolean },
): readonly BotRow[] {
  const where = options.includeHidden ? '' : 'WHERE hidden = 0'
  return tx
    .all(
      `SELECT ${COLUMNS} FROM bots ${where}
       ORDER BY pinned DESC, sort_key, created_at, bot_id`,
    )
    .map(parseBotRow)
}

function updateBot(
  tx: SqlExecutor,
  botId: string,
  assignments: string,
  params: SqlParams,
  options: BotWriteOptions,
): BotRow {
  const guard =
    options.expectedRevision === undefined
      ? ''
      : 'AND revision = :expectedRevision'
  const { changes } = tx.run(
    `UPDATE bots SET ${assignments}, revision = revision + 1,
       updated_at = :now
     WHERE bot_id = :botId ${guard}`,
    {
      ...params,
      botId,
      now: requireTimestamp(options.now),
      ...(options.expectedRevision === undefined
        ? {}
        : { expectedRevision: options.expectedRevision }),
    },
  )
  if (changes === 0) {
    requireBot(tx, botId)
    throw new LocalDbError('revision_conflict', 'Bot revision changed')
  }
  return requireBot(tx, botId)
}

export function updateBotProfile(
  tx: SqlExecutor,
  botId: string,
  profile: {
    readonly displayName: string
    readonly avatarVariant: string | null
  },
  options: BotWriteOptions,
): BotRow {
  return updateBot(
    tx,
    botId,
    'display_name = :displayName, avatar_variant = :avatarVariant',
    {
      displayName: requireText(profile.displayName, 'displayName'),
      avatarVariant: profile.avatarVariant,
    },
    options,
  )
}

export function setBotPinned(
  tx: SqlExecutor,
  botId: string,
  pinned: boolean,
  options: BotWriteOptions,
): BotRow {
  return updateBot(
    tx,
    botId,
    'pinned = :pinned',
    { pinned: flagValue(pinned) },
    options,
  )
}

export function setBotHidden(
  tx: SqlExecutor,
  botId: string,
  hidden: boolean,
  options: BotWriteOptions,
): BotRow {
  return updateBot(
    tx,
    botId,
    'hidden = :hidden',
    { hidden: flagValue(hidden) },
    options,
  )
}

export function setBotSortKey(
  tx: SqlExecutor,
  botId: string,
  sortKey: string,
  options: BotWriteOptions,
): BotRow {
  return updateBot(tx, botId, 'sort_key = :sortKey', { sortKey }, options)
}

export function setBotModelOverride(
  tx: SqlExecutor,
  botId: string,
  override: ModelChoice | null,
  options: BotWriteOptions,
): BotRow {
  return updateBot(
    tx,
    botId,
    `model_override_provider = :provider, model_override_model = :model,
     model_override_effort = :effort`,
    modelChoiceParams(override, 'modelOverride'),
    options,
  )
}

export function setBotProvisioning(
  tx: SqlExecutor,
  botId: string,
  provisioning: BotProvisioning,
  options: BotWriteOptions,
): BotRow {
  return updateBot(
    tx,
    botId,
    'provisioning = :provisioning',
    { provisioning },
    options,
  )
}
