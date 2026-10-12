import type { SqlExecutor } from '../driver.ts'
import { requireText, textColumn } from '../rows.ts'

/**
 * `data_id`: random id minted with the database.
 * `home_id`: id from the DSH home marker this database was paired with.
 */
export const META_KEYS = ['data_id', 'home_id'] as const
export type MetaKey = (typeof META_KEYS)[number]

export function getMeta(tx: SqlExecutor, key: MetaKey): string | null {
  const row = tx.get('SELECT value FROM meta WHERE key = :key', { key })
  return row === undefined ? null : textColumn(row, 'meta', 'value')
}

export function setMeta(tx: SqlExecutor, key: MetaKey, value: string): void {
  tx.run(
    `INSERT INTO meta (key, value) VALUES (:key, :value)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    { key, value: requireText(value, `meta.${key}`) },
  )
}
