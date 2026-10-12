import type { SqlExecutor, SqlRow } from '../driver.ts'
import { LocalDbError } from '../errors.ts'
import {
  integerColumn,
  requireId,
  requireText,
  requireTimestamp,
  textColumn,
} from '../rows.ts'

export interface TagRow {
  readonly tagId: string
  readonly label: string
  readonly createdAt: number
}

export function parseTagRow(row: SqlRow): TagRow {
  return {
    tagId: textColumn(row, 'tags', 'tag_id'),
    label: textColumn(row, 'tags', 'label'),
    createdAt: integerColumn(row, 'tags', 'created_at'),
  }
}

/** A repeated label fails as `constraint`/`unique`. */
export function createTag(
  tx: SqlExecutor,
  tag: { readonly tagId: string; readonly label: string; readonly now: number },
): TagRow {
  tx.run(
    'INSERT INTO tags (tag_id, label, created_at) VALUES (:tagId, :label, :now)',
    {
      tagId: requireId(tag.tagId, 'tagId'),
      label: requireText(tag.label, 'label'),
      now: requireTimestamp(tag.now),
    },
  )
  return { tagId: tag.tagId, label: tag.label, createdAt: tag.now }
}

export function listTags(tx: SqlExecutor): readonly TagRow[] {
  return tx
    .all(
      'SELECT tag_id, label, created_at FROM tags ORDER BY created_at, tag_id',
    )
    .map(parseTagRow)
}

/** Replaces the Bot's tag set. Unknown Bot or tag ids fail on foreign keys. */
export function setBotTags(
  tx: SqlExecutor,
  botId: string,
  tagIds: readonly string[],
): void {
  if (new Set(tagIds).size !== tagIds.length) {
    throw new LocalDbError('invalid_input', 'Duplicate tag id')
  }
  tx.run('DELETE FROM bot_tags WHERE bot_id = :botId', { botId })
  for (const tagId of tagIds) {
    tx.run('INSERT INTO bot_tags (bot_id, tag_id) VALUES (:botId, :tagId)', {
      botId: requireId(botId, 'botId'),
      tagId: requireId(tagId, 'tagId'),
    })
  }
}

export function listBotTagIds(
  tx: SqlExecutor,
  botId: string,
): readonly string[] {
  return tx
    .all(
      `SELECT bot_tags.tag_id FROM bot_tags
       JOIN tags ON tags.tag_id = bot_tags.tag_id
       WHERE bot_tags.bot_id = :botId
       ORDER BY tags.created_at, tags.tag_id`,
      { botId },
    )
    .map((row) => textColumn(row, 'bot_tags', 'tag_id'))
}
