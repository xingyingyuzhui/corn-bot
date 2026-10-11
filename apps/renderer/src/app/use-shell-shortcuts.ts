import { type Dispatch, useEffect, useEffectEvent } from 'react'
import { adjacentBotId } from '../features/roster/roster-order.ts'
import type { LayoutAction, LayoutState } from './layout-state.ts'
import {
  matchShortcut,
  platformOf,
  type ShortcutMatch,
  shouldRunShortcut,
} from './shortcuts.ts'

export const COMPOSER_FIELD_ID = 'corn-composer-field'

interface ShellShortcutOptions {
  readonly state: LayoutState
  readonly dispatch: Dispatch<LayoutAction>
  readonly botId: string
  readonly sidebarCollapsed: boolean
  /** Same order the roster renders, so Mod+1…9 matches what is on screen. */
  readonly visibleOrder: readonly string[]
}

const platform = platformOf(
  typeof navigator === 'undefined' ? '' : navigator.platform,
)

/** Window-level listener for the implemented global shortcuts. */
export function useShellShortcuts(options: ShellShortcutOptions) {
  const run = useEffectEvent((match: ShortcutMatch): boolean => {
    const { state, dispatch, botId, sidebarCollapsed, visibleOrder } = options
    const id = match.definition.id
    switch (id) {
      case 'focus-search':
        if (sidebarCollapsed) dispatch({ type: 'toggle-sidebar' })
        dispatch({ type: 'open-roster-search' })
        return true
      case 'new-bot':
        dispatch({ type: 'open-overlay', overlay: { kind: 'create-bot' } })
        return true
      case 'focus-input': {
        const field = document.getElementById(COMPOSER_FIELD_ID)
        field?.focus()
        return field !== null
      }
      case 'toggle-sidebar':
        dispatch({ type: 'toggle-sidebar' })
        return true
      case 'toggle-details':
        dispatch({ type: state.detailsOpen ? 'close-details' : 'open-details' })
        return true
      case 'open-settings':
        dispatch({
          type: 'open-overlay',
          overlay: { kind: 'settings', section: 'general' },
        })
        return true
      case 'bot-settings':
        dispatch({
          type: 'open-overlay',
          overlay: { kind: 'bot-profile', botId },
        })
        return true
      case 'previous-bot':
      case 'next-bot': {
        const next = adjacentBotId(
          visibleOrder,
          botId,
          id === 'next-bot' ? 1 : -1,
        )
        if (next) dispatch({ type: 'select-bot', botId: next })
        return true
      }
      case 'select-nth-bot': {
        const next = visibleOrder[(match.position ?? 0) - 1]
        if (next) dispatch({ type: 'select-bot', botId: next })
        return true
      }
      case 'send':
      case 'command-palette':
      case 'find-in-chat':
      case 'navigate-back':
      case 'navigate-forward':
      case 'add-selection':
      case 'open-tools':
      case 'open-skills':
      case 'cycle-bots':
        return false
      default: {
        const unreachable: never = id
        throw new Error(`Unhandled shortcut ${String(unreachable)}`)
      }
    }
  })

  const overlayOpen = options.state.overlay !== null

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const match = matchShortcut(event, platform)
      if (!match) return
      const target = event.target instanceof Element ? event.target : null
      const allowed = shouldRunShortcut(match, {
        overlayOpen:
          overlayOpen || document.querySelector('dialog[open]') !== null,
        composing: event.isComposing || event.keyCode === 229,
        inMenu: target?.closest('[role="menu"]') != null,
        repeat: event.repeat,
      })
      if (allowed && run(match)) event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [overlayOpen])
}
