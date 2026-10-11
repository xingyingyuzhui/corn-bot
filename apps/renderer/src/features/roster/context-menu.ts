import type { KeyboardEvent, MouseEvent, RefObject } from 'react'
import type { MenuHandle } from '../../shared/Menu.tsx'

/** Right-click, the ContextMenu key and Shift+F10 open the row's own menu. */
export function contextMenuHandlers(menu: RefObject<MenuHandle | null>) {
  return {
    onContextMenu: (event: MouseEvent) => {
      event.preventDefault()
      menu.current?.open()
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (
        event.key !== 'ContextMenu' &&
        !(event.shiftKey && event.key === 'F10')
      )
        return
      event.preventDefault()
      menu.current?.open()
    },
  }
}
