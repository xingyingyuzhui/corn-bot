import type { SqlExecutor, SqlRow } from '../driver.ts'
import { LocalDbError } from '../errors.ts'
import {
  enumColumn,
  integerColumn,
  requireId,
  requireTimestamp,
  textColumn,
} from '../rows.ts'

/** One main conversation per Bot in P3 (decision 14A); `kind` leaves room. */
export const CONVERSATION_KINDS = ['main'] as const
export type ConversationKind = (typeof CONVERSATION_KINDS)[number]

export interface ConversationRow {
  readonly conversationId: string
  readonly botId: string
  readonly kind: ConversationKind
  readonly createdAt: number
}

const COLUMNS = 'conversation_id, bot_id, kind, created_at'

export function parseConversationRow(row: SqlRow): ConversationRow {
  return {
    conversationId: textColumn(row, 'conversations', 'conversation_id'),
    botId: textColumn(row, 'conversations', 'bot_id'),
    kind: enumColumn(CONVERSATION_KINDS, row, 'conversations', 'kind'),
    createdAt: integerColumn(row, 'conversations', 'created_at'),
  }
}

export function insertMainConversation(
  tx: SqlExecutor,
  conversation: {
    readonly conversationId: string
    readonly botId: string
    readonly now: number
  },
): ConversationRow {
  tx.run(
    `INSERT INTO conversations (conversation_id, bot_id, kind, created_at)
     VALUES (:conversationId, :botId, 'main', :now)`,
    {
      conversationId: requireId(conversation.conversationId, 'conversationId'),
      botId: requireId(conversation.botId, 'botId'),
      now: requireTimestamp(conversation.now),
    },
  )
  const row = getConversation(tx, conversation.conversationId)
  if (row === null) {
    throw new LocalDbError('not_found', 'Conversation not found')
  }
  return row
}

export function getConversation(
  tx: SqlExecutor,
  conversationId: string,
): ConversationRow | null {
  const row = tx.get(
    `SELECT ${COLUMNS} FROM conversations
     WHERE conversation_id = :conversationId`,
    { conversationId },
  )
  return row === undefined ? null : parseConversationRow(row)
}

export function getMainConversation(
  tx: SqlExecutor,
  botId: string,
): ConversationRow | null {
  const row = tx.get(
    `SELECT ${COLUMNS} FROM conversations
     WHERE bot_id = :botId AND kind = 'main'`,
    { botId },
  )
  return row === undefined ? null : parseConversationRow(row)
}
