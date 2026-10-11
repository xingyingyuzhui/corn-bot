import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react'
import { LAYOUT, type SidebarSnapshot } from '../../app/layout-state.ts'

interface SidebarResizeHandleProps {
  /** Rendered width: the rail width while collapsed. */
  readonly width: number
  readonly preferredWidth: number
  readonly collapsed: boolean
  readonly snapshot: SidebarSnapshot
  readonly onResize: (width: number) => void
  readonly onRestore: (snapshot: SidebarSnapshot) => void
}

interface Drag {
  readonly pointerId: number
  readonly startX: number
  readonly startWidth: number
  readonly direction: 1 | -1
  readonly snapshot: SidebarSnapshot
  readonly element: HTMLElement
  readonly cursor: string
  readonly userSelect: string
  readonly stop: () => void
}

function release(drag: Drag) {
  drag.stop()
  document.body.style.cursor = drag.cursor
  document.body.style.userSelect = drag.userSelect
  if (drag.element.hasPointerCapture(drag.pointerId))
    drag.element.releasePointerCapture(drag.pointerId)
}

/**
 * Kit E58: pointer capture for the drag; pointerup, pointercancel,
 * lostpointercapture and window blur commit, Escape restores the start
 * width. The global cursor and user-select are always put back.
 */
export function SidebarResizeHandle({
  width,
  preferredWidth,
  collapsed,
  snapshot,
  onResize,
  onRestore,
}: SidebarResizeHandleProps) {
  const drag = useRef<Drag | null>(null)
  const [dragging, setDragging] = useState(false)

  const finish = (restore: boolean) => {
    const current = drag.current
    if (!current) return
    drag.current = null
    release(current)
    if (restore) onRestore(current.snapshot)
    setDragging(false)
  }

  useEffect(
    () => () => {
      if (drag.current) release(drag.current)
      drag.current = null
    },
    [],
  )

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || drag.current) return
    event.preventDefault()
    const element = event.currentTarget
    element.setPointerCapture(event.pointerId)
    const onBlur = () => finish(false)
    const onKey = (key: globalThis.KeyboardEvent) => {
      if (key.key !== 'Escape') return
      key.preventDefault()
      key.stopPropagation()
      finish(true)
    }
    window.addEventListener('blur', onBlur)
    window.addEventListener('keydown', onKey, true)
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
      direction: getComputedStyle(element).direction === 'rtl' ? -1 : 1,
      snapshot,
      element,
      cursor: document.body.style.cursor,
      userSelect: document.body.style.userSelect,
      stop: () => {
        window.removeEventListener('blur', onBlur)
        window.removeEventListener('keydown', onKey, true)
      },
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    setDragging(true)
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || event.pointerId !== current.pointerId) return
    onResize(
      current.startWidth + current.direction * (event.clientX - current.startX),
    )
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const base = collapsed ? preferredWidth : width
    const step = LAYOUT.sidebarKeyStep
    const targets: Record<string, number | undefined> = {
      ArrowLeft: collapsed ? undefined : base - step,
      ArrowRight: collapsed ? base : base + step,
      Home: LAYOUT.sidebarMinWidth,
      End: LAYOUT.sidebarMaxWidth,
    }
    const target = targets[event.key]
    if (target === undefined) return
    event.preventDefault()
    onResize(target)
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable splitter is a separator with a value, which <hr> cannot express
    <div
      role="separator"
      tabIndex={0}
      className="corn-roster__resize"
      data-dragging={dragging || undefined}
      aria-orientation="vertical"
      aria-label="调整名册宽度"
      aria-controls="corn-roster"
      aria-valuenow={width}
      aria-valuemin={LAYOUT.sidebarRailWidth}
      aria-valuemax={LAYOUT.sidebarMaxWidth}
      aria-valuetext={collapsed ? '已收起' : `${width} 像素`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => finish(false)}
      onPointerCancel={() => finish(false)}
      onLostPointerCapture={() => finish(false)}
      onKeyDown={onKeyDown}
    />
  )
}
