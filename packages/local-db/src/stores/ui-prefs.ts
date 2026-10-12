import type { SqlExecutor } from '../driver.ts'
import { LocalDbError } from '../errors.ts'
import { requireTimestamp, textColumn } from '../rows.ts'

/** Whitelisted, rebuildable UI preferences. Values are stored as JSON. */
export interface UiPrefs {
  readonly 'layout.sidebarWidth': number
  readonly 'layout.sidebarCollapsed': boolean
  readonly 'layout.detailsOpen': boolean
  readonly 'workspace.selectedBotId': string
}

export type UiPrefKey = keyof UiPrefs

export const UI_PREF_KEYS = [
  'layout.sidebarWidth',
  'layout.sidebarCollapsed',
  'layout.detailsOpen',
  'workspace.selectedBotId',
] as const satisfies readonly UiPrefKey[]

const SIDEBAR_WIDTH = { min: 0, max: 4096 } as const
const MAX_ID_LENGTH = 200

export function isUiPrefKey(value: string): value is UiPrefKey {
  return UI_PREF_KEYS.some((key) => key === value)
}

export function isValidUiPrefValue<K extends UiPrefKey>(
  key: K,
  value: unknown,
): value is UiPrefs[K] {
  const prefKey: UiPrefKey = key
  switch (prefKey) {
    case 'layout.sidebarWidth':
      return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= SIDEBAR_WIDTH.min &&
        value <= SIDEBAR_WIDTH.max
      )
    case 'layout.sidebarCollapsed':
    case 'layout.detailsOpen':
      return typeof value === 'boolean'
    case 'workspace.selectedBotId':
      return (
        typeof value === 'string' &&
        value.length > 0 &&
        value.length <= MAX_ID_LENGTH
      )
    default: {
      const unreachable: never = prefKey
      throw new Error(`Unhandled UI pref ${String(unreachable)}`)
    }
  }
}

export function setUiPref<K extends UiPrefKey>(
  tx: SqlExecutor,
  key: K,
  value: UiPrefs[K],
  options: { readonly now: number },
): void {
  if (!isUiPrefKey(key) || !isValidUiPrefValue(key, value)) {
    throw new LocalDbError('invalid_input', `Invalid UI pref ${key}`)
  }
  tx.run(
    `INSERT INTO ui_prefs (key, value_json, updated_at)
     VALUES (:key, :valueJson, :now)
     ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json,
       updated_at = excluded.updated_at`,
    {
      key,
      valueJson: JSON.stringify(value),
      now: requireTimestamp(options.now),
    },
  )
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * Stored preferences. Unknown keys and invalid values are skipped rather
 * than failing: preferences are rebuildable and must never block startup.
 */
export function getUiPrefs(tx: SqlExecutor): Partial<UiPrefs> {
  const prefs: Partial<Record<UiPrefKey, unknown>> = {}
  for (const row of tx.all('SELECT key, value_json FROM ui_prefs')) {
    const key = textColumn(row, 'ui_prefs', 'key')
    if (!isUiPrefKey(key)) continue
    const value = parseJson(textColumn(row, 'ui_prefs', 'value_json'))
    if (isValidUiPrefValue(key, value)) prefs[key] = value
  }
  return prefs as Partial<UiPrefs>
}
