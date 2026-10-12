import type {
  SetUiPrefCommand,
  UiPrefKey,
  UiPrefs,
} from '../../../../packages/contracts/src/workspace.ts'
import {
  clearUiPref,
  getUiPrefs,
  type LocalDb,
  type UiPrefKey as StoredUiPrefKey,
  setUiPref,
} from '../../../../packages/local-db/src/index.ts'

/**
 * Renderer preference keys and their database keys. `layout.sidebarWidth` is
 * stored by the database but not offered over IPC; it stays untouched here.
 */
export const STORED_UI_PREF_KEY = {
  selectedBotId: 'workspace.selectedBotId',
  detailsOpen: 'layout.detailsOpen',
  sidebarCollapsed: 'layout.sidebarCollapsed',
} as const satisfies Record<UiPrefKey, StoredUiPrefKey>

export const DEFAULT_UI_PREFS: UiPrefs = {
  selectedBotId: null,
  detailsOpen: false,
  sidebarCollapsed: false,
}

/** Stored preferences over the defaults; invalid rows already fell back in the store. */
export function readUiPrefs(db: LocalDb): UiPrefs {
  const stored = db.read((tx) => getUiPrefs(tx))
  return {
    selectedBotId:
      stored[STORED_UI_PREF_KEY.selectedBotId] ??
      DEFAULT_UI_PREFS.selectedBotId,
    detailsOpen:
      stored[STORED_UI_PREF_KEY.detailsOpen] ?? DEFAULT_UI_PREFS.detailsOpen,
    sidebarCollapsed:
      stored[STORED_UI_PREF_KEY.sidebarCollapsed] ??
      DEFAULT_UI_PREFS.sidebarCollapsed,
  }
}

/** A `null` selection removes the row, so the default applies on the next read. */
export function writeUiPref(
  db: LocalDb,
  command: SetUiPrefCommand,
  now: number,
): void {
  db.write((tx) => {
    switch (command.key) {
      case 'selectedBotId':
        if (command.value === null)
          clearUiPref(tx, STORED_UI_PREF_KEY.selectedBotId)
        else
          setUiPref(tx, STORED_UI_PREF_KEY.selectedBotId, command.value, {
            now,
          })
        return
      case 'detailsOpen':
        setUiPref(tx, STORED_UI_PREF_KEY.detailsOpen, command.value, { now })
        return
      case 'sidebarCollapsed':
        setUiPref(tx, STORED_UI_PREF_KEY.sidebarCollapsed, command.value, {
          now,
        })
        return
      default: {
        const unreachable: never = command
        throw new Error(`Unknown UI preference ${String(unreachable)}`)
      }
    }
  })
}
