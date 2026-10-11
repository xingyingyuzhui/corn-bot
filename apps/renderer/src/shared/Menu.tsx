import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
  useId,
  useImperativeHandle,
  useRef,
} from 'react'
import { useNotice } from './notice.tsx'
import './menu.css'

export interface MenuItem {
  readonly id: string
  readonly label: string
  readonly onSelect?: () => void
  /** Visible but not connected yet: selecting announces this reason. */
  readonly unavailable?: string
  readonly tone?: 'danger'
}

export interface MenuHandle {
  /** Opens the menu from elsewhere, e.g. a row's context-menu event. */
  open(): void
}

interface MenuProps {
  readonly label: string
  readonly items: readonly MenuItem[]
  readonly triggerClassName: string
  readonly trigger: ReactNode
  readonly align?: 'start' | 'end'
  readonly ref?: Ref<MenuHandle>
}

const ITEM = '[role="menuitem"]'

/**
 * Popover menu (native `popover="auto"` + CSS anchor positioning): the
 * trigger toggles it through `popoverTarget`, light dismiss and Escape come
 * from the platform; arrow keys loop, Home/End jump,
 * Tab closes, and focus returns to the trigger when the menu closes.
 */
export function Menu({
  label,
  items,
  triggerClassName,
  trigger,
  align = 'end',
  ref,
}: MenuProps) {
  const notify = useNotice()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const menuId = `${id}-menu`
  const anchor = `--corn-menu-${id.replace(/[^a-zA-Z0-9-]/gu, '')}`

  const focusItem = (index: number) => {
    const list = menuRef.current?.querySelectorAll<HTMLElement>(ITEM)
    if (!list?.length) return
    list[(index + list.length) % list.length]?.focus()
  }
  const show = () => menuRef.current?.showPopover()
  const hide = () => menuRef.current?.hidePopover()

  useImperativeHandle(ref, () => ({ open: show }))

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = [
      ...(menuRef.current?.querySelectorAll<HTMLElement>(ITEM) ?? []),
    ]
    const index = list.indexOf(document.activeElement as HTMLElement)
    const moves: Record<string, number | undefined> = {
      ArrowDown: index + 1,
      ArrowUp: index - 1,
      Home: 0,
      End: list.length - 1,
    }
    const target = moves[event.key]
    if (target !== undefined) {
      event.preventDefault()
      focusItem(target)
    } else if (event.key === 'Tab') {
      hide()
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClassName}
        aria-label={label}
        aria-haspopup="menu"
        title={label}
        style={{ anchorName: anchor } as CSSProperties}
        popoverTarget={menuId}
      >
        {trigger}
      </button>
      <div
        ref={menuRef}
        id={menuId}
        role="menu"
        aria-label={label}
        className="corn-menu"
        data-align={align}
        popover="auto"
        style={{ positionAnchor: anchor } as CSSProperties}
        onKeyDown={onKeyDown}
        onToggle={(event) => {
          if (event.newState === 'open') focusItem(0)
          else if (menuRef.current?.contains(document.activeElement))
            triggerRef.current?.focus()
        }}
      >
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="corn-menu__item"
            data-tone={item.tone}
            aria-disabled={item.unavailable ? true : undefined}
            aria-description={item.unavailable}
            onClick={() => {
              hide()
              if (item.unavailable) notify(item.unavailable)
              else item.onSelect?.()
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </>
  )
}
